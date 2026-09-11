/**
 * Main process entry.
 *
 * The agent lives here rather than behind a socket: ADR 0001 rejected splitting Navi into two
 * stateful halves precisely so conversation state and UI state cannot drift apart.
 *
 * This file is wiring and nothing else. What a turn does is `conversation.ts`, which takes all
 * of this as dependencies and therefore runs under test without Electron; what a setting may
 * be is `shared/settings.ts`; what the windows are is `overlay.ts`, `chat-window.ts` and
 * `settings-window.ts`. Keep decisions out of here.
 */

import { app, clipboard, globalShortcut, ipcMain, screen, shell, type BrowserWindow } from 'electron';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOverlay } from './overlay.js';
import { createChatWindow, type ChatWindow } from './chat-window.js';
import { createSettingsWindow, type SettingsWindow } from './settings-window.js';
import { createOnboardingWindow, type OnboardingWindow } from './onboarding-window.js';
import { ollamaModels, ollamaReachable, permissions, request } from './permissions.js';
import { blockers, type OnboardingState, type PermissionKind } from '../shared/onboarding.js';
import { attachClickThrough, type ClickThrough } from './click-through.js';
import { createCursorSource, type CursorSource } from './cursor.js';
import { createFollow, type Follow } from './follow.js';
import { createGuidance, type Guidance } from './guidance.js';
import { createConversation, type Conversation } from './conversation.js';
import { load, save } from './settings-store.js';
import { load as loadEmotion, record as recordEmotion, reset as resetEmotion } from './emotion-store.js';
import { load as loadMemory, reset as resetMemory, save as saveMemory } from './memory-store.js';
import { createMemoryTools } from '../agent/recall.js';
import { createNoteTools } from '../agent/notes.js';
import { load as loadNotes, save as saveNotes } from './notes-store.js';
import { createReminders, type Reminders } from './reminders.js';
import { createGate, type Gate } from './gate.js';
import { addNote, addReminder, deleteNote, searchNotes, upcoming } from '../shared/notes.js';
import { forget, markUsed, prefer, recall, recordEpisode, remember } from '../shared/memory.js';
import { createProvider } from '../agent/client.js';
import { ToolRegistry } from '../agent/tools.js';
import { createScreenTools } from '../agent/screen.js';
import { createGuidanceTool } from '../agent/guidance.js';
import { createScreenPort } from './screen.js';
import { dismissCursorMarker, showCursorMarker } from './marker.js';
import { createSpeaker, createTranscriber, type Speaker } from './voice.js';
import { createPlayer, createRunner, speakerPaths, whisperPaths } from './exec.js';
import { lastPrompt } from '../prompt/inspector.js';
import { describe, tintFor, type Emotion } from '../shared/emotion.js';
import { emojiFor } from '../shared/emoji.js';
import { view, type Settings } from '../shared/settings.js';

let win: BrowserWindow | null = null;
let chat: ChatWindow | null = null;
let settings: SettingsWindow | null = null;
let onboarding: OnboardingWindow | null = null;
let clickThrough: ClickThrough | null = null;
let cursor: CursorSource | null = null;
let follow: Follow | null = null;
let guidance: Guidance | null = null;
let speaker: Speaker | null = null;
// Declared out here because the chat window's close handler ends the session, and the window is
// built before the conversation that owns one.
let conversation: Conversation | null = null;
let reminders: Reminders | null = null;
/** What she was feeling last, so a change can be spotted (emotions.md §9.2). */
let lastEmotion: Emotion | null = null;
let gate: Gate | null = null;

/** Pending confirmation cards, keyed by the id the chat window answers with (NAV-91). */
const pendingConfirmations = new Map<number, (said: boolean) => void>();
let nextConfirmation = 0;

app.whenReady().then(() => {
  const current = load();

  win = createOverlay();
  // One poll, two readers. Click-through and following both act on the cursor, and two timers
  // would sample it at two rates and disagree about where it is (NAV-102).
  cursor = createCursorSource({ read: () => screen.getCursorScreenPoint(), fps: current.idleFps });
  clickThrough = attachClickThrough(win, cursor);
  follow = createFollow({
    window: win,
    cursor,
    // The renderer draws the pointing arrow but cannot know which way to aim it; this is the
    // one place that knows both her window's position and where she is going (NAV-103).
    onFlight: (relative) => win?.webContents.send('point', relative),
  });
  chat = createChatWindow({
    onVisibility: (open) => {
      follow?.setPaused('chat', open);
      // Closing the chat ends the session, which is when it gets summarised into memory. It is
      // the one model call nobody is waiting for, so it runs unawaited and failing silently.
      if (!open) void conversation?.endSession();
    },
  });
  settings = createSettingsWindow();
  onboarding = createOnboardingWindow();

  // Tools reach the model as native schemas and the model picks; nothing here or anywhere else
  // inspects the user's text to choose one (NAV-83).
  const registry = new ToolRegistry();
  const screenPort = createScreenPort();
  const screenTools = createScreenTools({
    screen: screenPort,
    cursor: () => cursor?.current() ?? screen.getCursorScreenPoint(),
    // Never rejects — a pointing gesture that goes wrong costs the gesture, not the turn.
    point: async (target) => follow?.flyTo(target),
    markAnchor: showCursorMarker,
  });
  for (const tool of screenTools.tools) registry.register(tool);

  /**
   * Step-by-step guidance (NAV-106). `guidance` is the sequencing controller built on `follow`;
   * `guide_through` is the tool that validates and bounds what a model sends it. `speak` and
   * `stopSpeaking` close over `speaker`, which does not exist yet at this point in startup —
   * safe, because neither is called until a walk-through actually runs, well after it does.
   */
  guidance = createGuidance({
    follow,
    speak: (text) => {
      if (load().voiceOutput) {
        speaker?.push(`${text} `);
        void speaker?.finish();
      }
    },
    stopSpeaking: () => speaker?.stop(),
    onStep: (step) => chat?.send('chat:event', { type: 'guide', ...step }),
    onEnd: () => chat?.send('chat:event', { type: 'guideEnd' }),
  });
  registry.register(
    createGuidanceTool({
      displayAt: (p) => screenPort.displayAt(p),
      cursor: () => cursor?.current() ?? screen.getCursorScreenPoint(),
      guide: (steps) => guidance?.run(steps) ?? Promise.resolve({ shown: 0 }),
    }),
  );

  /**
   * Memory (NAV-93). Every write goes through the store so it reaches disk immediately: she
   * says "I'll remember that" and then the process is killed, and the promise should hold.
   */
  const memory = {
    recall: (query: string) => {
      const result = recall(loadMemory(), query);
      return { lines: result.lines, used: result.used };
    },
    used: (ids: readonly string[]) => {
      saveMemory(markUsed(loadMemory(), [...ids]));
    },
    episode: (text: string) => {
      saveMemory(recordEpisode(loadMemory(), text));
    },
    prefer: (text: string, liked: boolean) => {
      saveMemory(prefer(loadMemory(), text, liked));
    },
  };

  /**
   * Notes and reminders (NAV-100). A separate store from memory, because these are the user's
   * own words and must never be consolidated or decayed away.
   */
  reminders = createReminders({
    read: loadNotes,
    write: (next) => saveNotes(next),
    fire: (due) => {
      for (const note of due) {
        // Shown in the chat, and the window is opened for it: a reminder nobody sees is not a
        // reminder. She says it aloud too when voice is on, which is the case it is for.
        chat?.send('chat:event', { type: 'reminder', text: note.text });
        if (load().voiceOutput) {
          speaker?.push(`You asked me to remind you: ${note.text}. `);
          void speaker?.finish();
        }
      }
      if (win) chat?.show(win);
      win?.webContents.send('summoned');
    },
  });

  for (const tool of createNoteTools({
    save: (text, tags) => {
      const result = addNote(loadNotes(), text, tags);
      saveNotes(result.store);
      return result.note;
    },
    remind: (text, due) => {
      const result = addReminder(loadNotes(), text, due);
      saveNotes(result.store);
      // A reminder set for sooner than the one the timer is waiting on has to move it.
      reminders?.refresh();
      return result.note;
    },
    search: (query) => searchNotes(loadNotes(), query),
    upcoming: () => upcoming(loadNotes()),
  })) {
    registry.register(tool);
  }

  for (const tool of createMemoryTools({
    remember: (text) => {
      saveMemory(remember(loadMemory(), text));
      return text;
    },
    prefer: (text, liked) => {
      saveMemory(prefer(loadMemory(), text, liked));
    },
  })) {
    registry.register(tool);
  }

  /**
   * Voice (NAV-104).
   *
   * The speaker is rebuilt on a settings change rather than reading settings per sentence: the
   * voice model is a file path resolved once, and swapping voices mid-reply would be a stranger
   * thing to do than finishing the sentence in the old one.
   */
  const runner = createRunner();
  const play = createPlayer(runner);
  const buildSpeaker = (s: Settings): Speaker =>
    createSpeaker({
      runner,
      paths: speakerPaths(s.voiceName),
      play,
      cleanup: (file) => unlink(file).catch(() => undefined),
      onError: (message) => chat?.send('chat:event', { type: 'error', message }),
      speed: s.voiceSpeed,
    });
  speaker = buildSpeaker(current);

  conversation = createConversation({
    settings: load,
    createProvider,
    registry,
    emotion: { load: loadEmotion, record: recordEmotion },
    memory,
    onSend: () => {
      // NAV-99: the crop is centred on where the cursor was when they asked, not on where it
      // has drifted to by the time the model gets round to asking for a picture.
      screenTools.freeze();
      // And NAV-91's per-turn write budget refills. It is per *turn* rather than per session
      // because a model that has decided to click will sometimes decide to click forever, and
      // the natural unit of "she has done enough" is one thing the user asked for.
      gate?.beginTurn();
    },
    emit: (event) => {
      chat?.send('chat:event', event);

      // She speaks a sentence at a time as it finishes, rather than waiting for the reply and
      // then reading it out — which would undo the point of streaming the text.
      if (load().voiceOutput) {
        if (event.type === 'start') speaker?.stop();
        if (event.type === 'delta') speaker?.push(event.text);
        if (event.type === 'done') {
          if (event.cancelled) speaker?.stop();
          else void speaker?.finish();
        }
        if (event.type === 'error') speaker?.stop();
      }

      // The fairy shows the same state the chat window does — she is the one having the
      // conversation, and the chat window is only where the words are.
      if (event.type === 'emotion') {
        win?.webContents.send('tint', event.tint);
        // Only on a change (emotions.md §9.2). An emoji on every turn is wallpaper; one on a
        // change is a reaction. The main process owns this because it is the side that
        // remembers what she was feeling a moment ago.
        const char = emojiFor(lastEmotion, event.emotion as Emotion);
        lastEmotion = event.emotion as Emotion;
        if (char !== null) win?.webContents.send('emoji', char);
      }
      if (event.type === 'start') win?.webContents.send('busy', true);
      if (event.type === 'done' || event.type === 'error') win?.webContents.send('busy', false);
    },
  });

  /**
   * Shift+Cmd+N by default. The Swift daemon's old default, Shift+Ctrl+Alt+Space, collides
   * with macOS input-source switching and does not reliably register (ADR 0001).
   *
   * Returns whether it took, because the settings window says so: an accelerator another app
   * already owns fails silently otherwise, and the user is left pressing a key that does
   * nothing with no idea why.
   */
  const registerHotkey = (accelerator: string): boolean => {
    // Clears the talk key too, which is why every caller re-registers it afterwards. One
    // `unregisterAll` is simpler than tracking which accelerator was registered last.
    globalShortcut.unregisterAll();
    const ok = globalShortcut.register(accelerator, () => {
      win?.webContents.send('summoned');
      if (win) chat?.toggle(win);
    });
    if (!ok) console.warn(`could not register hotkey ${accelerator} — another app owns it`);
    return ok;
  };

  const sendRates = (s: Settings): void => {
    win?.webContents.send('rates', { idle: s.idleFps, active: s.activeFps });
    // The cursor poll is a permanent timer, so it is measured against ADR 0001's idle CPU bar
    // like the render loop is, and it moves with the same setting.
    cursor?.setRate(s.idleFps);
  };

  /**
   * The talk key (NAV-104).
   *
   * Press to start, press again to stop, because `globalShortcut` reports presses and never
   * releases — a held key would start a recording nothing could end. It has to be a global
   * shortcut for the same reason the summon key is one: the overlay is click-through and never
   * holds the keyboard.
   *
   * The chat window does the recording and hands back WAV bytes; see `renderer/mic.ts`.
   */
  let listening = false;
  const setListening = (on: boolean): void => {
    listening = on;
    chat?.send('voice:listen', on);
    chat?.send('chat:event', { type: 'listening', on });
    // She should look like she is paying attention, not like she is thinking.
    win?.webContents.send('busy', on);
  };

  /**
   * The kill switch (NAV-91).
   *
   * A global shortcut, because the moment you need it is the moment Navi has the focus and is
   * doing something you did not want. It halts everything in flight and is remembered across a
   * restart: a user who hit it because something was going wrong should not find her acting
   * again after a relaunch.
   */
  const registerKillHotkey = (settings: Settings): boolean => {
    const ok = globalShortcut.register(settings.killHotkey, () => {
      gate?.halt();
      save({ halted: true });
      dismissCursorMarker();
      // Everything in flight, not only the acting: a turn she is mid-way through is part of
      // what the user just told her to stop.
      conversation?.cancel();
      guidance?.abort();
      speaker?.stop();
      for (const [id, resolve] of pendingConfirmations) {
        pendingConfirmations.delete(id);
        resolve(false);
      }
      chat?.send('chat:event', {
        type: 'error',
        message:
          'Stopped. Navi will not touch anything on your machine until you start her again in ' +
          'Settings. You can still talk to her.',
      });
    });
    if (!ok) console.warn(`could not register kill switch ${settings.killHotkey} — another app owns it`);
    return ok;
  };

  const registerVoiceHotkey = (settings: Settings): boolean => {
    if (!settings.voiceInput) return true;
    const ok = globalShortcut.register(settings.voiceHotkey, () => setListening(!listening));
    if (!ok) console.warn(`could not register talk key ${settings.voiceHotkey} — another app owns it`);
    return ok;
  };

  registerHotkey(current.hotkey);
  registerVoiceHotkey(current);
  registerKillHotkey(current);

  // She wakes up in the state she was left in, at the frame rates that were configured. Sent
  // once the renderer is listening — before that the fairy draws in its neutral colour at the
  // default rates and would keep both.
  const emotion = loadEmotion();
  // Seeded from the restored state, so waking up in the mood she was left in is not itself
  // reported as a change on the first turn.
  lastEmotion = emotion.emotion;
  win.webContents.once('did-finish-load', () => {
    win?.webContents.send('tint', tintFor(emotion));
    sendRates(current);
  });

  ipcMain.on('chat:ready', () => conversation?.describeState());
  ipcMain.on('chat:send', (_e, text: unknown) => {
    // The renderer is ours, but the boundary is still a boundary.
    if (typeof text === 'string') void conversation?.send(text);
  });
  ipcMain.on('chat:cancel', () => {
    conversation?.cancel();
    // Escape is "get out of what is happening now" (chat.ts), and a walk-through in progress is
    // exactly that — the tool call it runs inside is still the thing `cancel` means to stop.
    guidance?.abort();
  });
  ipcMain.on('guidance:advance', () => guidance?.advance());
  /**
   * The approval loop (NAV-101). Explicit, because being told beats being guessed at: the
   * sentiment classifier can notice praise, and noticing is not the same as being told.
   */
  ipcMain.on('chat:approve', (_e, liked: unknown) => {
    if (typeof liked === 'boolean') conversation?.approve(liked);
  });
  ipcMain.on('chat:confirm', (_e, payload: unknown) => {
    if (payload === null || typeof payload !== 'object') return;
    const { id, said } = payload as { id?: unknown; said?: unknown };
    if (typeof id !== 'number' || typeof said !== 'boolean') return;

    const resolve = pendingConfirmations.get(id);
    pendingConfirmations.delete(id);
    resolve?.(said);
  });

  /** The audit log, for the panel that shows it. Read-only from the renderer's side. */
  ipcMain.handle('policy:log', () => gate?.log() ?? []);
  ipcMain.handle('policy:halted', () => gate?.halted() ?? false);
  ipcMain.handle('policy:resume', () => {
    gate?.resume();
    save({ halted: false });
    win?.webContents.send('acting', false);
    return false;
  });
  ipcMain.on('chat:hide', () => chat?.hide());
  ipcMain.on('chat:open', () => {
    if (win) chat?.show(win);
  });

  /**
   * A finished recording. Transcribed locally, then sent as an ordinary turn — so everything
   * downstream, the cursor freeze included, behaves exactly as it does for typing.
   */
  ipcMain.on('voice:audio', async (_e, wav: unknown) => {
    setListening(false);
    if (!(wav instanceof Uint8Array) || wav.byteLength === 0) return;

    const file = join(tmpdir(), `navi-take-${Date.now()}.wav`);
    try {
      await writeFile(file, wav);
      const s = load();
      const transcriber = createTranscriber({ runner, ...whisperPaths(s.speechModel) });
      const { text, error } = await transcriber.transcribe(file);

      if (error !== undefined) {
        chat?.send('chat:event', { type: 'error', message: error });
        return;
      }
      if (text === '') {
        chat?.send('chat:event', { type: 'error', message: 'Navi did not catch that.' });
        return;
      }

      // Shown as the user's own message, because that is what it is — the chat window renders
      // typed messages itself and never sees the ones that arrive this way.
      chat?.send('voice:transcript', text);
      if (win) chat?.show(win);
      void conversation?.send(text);
    } finally {
      await unlink(file).catch(() => undefined);
    }
  });

  ipcMain.on('voice:error', (_e, message: unknown) => {
    setListening(false);
    if (typeof message === 'string') chat?.send('chat:event', { type: 'error', message });
  });

  /**
   * First run (NAV-92).
   *
   * Everything the guide shows, in one call, so the checklist cannot render a provider state
   * and a permission state read a second apart.
   */
  const onboardingState = async (): Promise<OnboardingState & { ollamaModels: string[] }> => {
    const s = load();
    const reachable = s.provider === 'ollama' ? await ollamaReachable(s.ollamaBaseUrl) : false;
    return {
      provider: { provider: s.provider, hasKey: s.openaiApiKey !== '', ollamaReachable: reachable },
      permissions: permissions(),
      wantsVoiceInput: s.voiceInput,
      ollamaModels: reachable ? await ollamaModels(s.ollamaBaseUrl) : [],
    };
  };

  ipcMain.handle('onboarding:status', onboardingState);
  ipcMain.handle('onboarding:request', (_e, kind: unknown) => {
    const kinds: PermissionKind[] = ['screen', 'accessibility', 'microphone'];
    if (typeof kind !== 'string' || !kinds.includes(kind as PermissionKind)) return 'unknown';
    return request(kind as PermissionKind);
  });
  ipcMain.handle('onboarding:open', (_e, url: unknown) => {
    // Only the two links the guide offers. An IPC channel that opens any URL the renderer names
    // is a channel that opens any URL anything reaching the renderer names.
    const allowed = ['https://ollama.com/download', 'https://platform.openai.com/api-keys'];
    if (typeof url === 'string' && allowed.includes(url)) void shell.openExternal(url);
  });
  ipcMain.on('onboarding:finish', () => {
    save({ onboarded: true });
    onboarding?.hide();
    if (win) chat?.show(win);
  });
  ipcMain.on('onboarding:open', () => onboarding?.show());

  ipcMain.on('settings:open', () => settings?.show());
  ipcMain.on('settings:close', () => settings?.hide());

  ipcMain.handle('settings:get', () => view(load()));
  ipcMain.handle('settings:save', (_e, patch: unknown) => {
    const next = save(patch);
    // Everything that reads a setting once rather than per turn has to be told it changed.
    const hotkeyRegistered = registerHotkey(next.hotkey);
    const voiceHotkeyRegistered = registerVoiceHotkey(next);
    registerKillHotkey(next);
    sendRates(next);
    speaker?.stop();
    speaker = buildSpeaker(next);
    conversation?.describeState();
    return { view: view(next), hotkeyRegistered, voiceHotkeyRegistered };
  });

  /** The memory viewer (NAV-93): anything she remembers, the user can see and remove. */
  ipcMain.handle('memory:get', () => loadMemory());
  ipcMain.handle('memory:forget', (_e, id: unknown) => {
    if (typeof id === 'string') saveMemory(forget(loadMemory(), id));
    return loadMemory();
  });
  ipcMain.handle('memory:remember', (_e, text: unknown) => {
    if (typeof text === 'string' && text.trim() !== '') saveMemory(remember(loadMemory(), text));
    return loadMemory();
  });
  ipcMain.handle('memory:reset', () => resetMemory());

  /**
   * Notes in the viewer alongside memory (NAV-100). No reset: these are the user's own words,
   * so they go one at a time and deliberately, never with a single button.
   */
  ipcMain.handle('notes:get', () => loadNotes());
  ipcMain.handle('notes:delete', (_e, id: unknown) => {
    if (typeof id === 'string') saveNotes(deleteNote(loadNotes(), id));
    reminders?.refresh();
    return loadNotes();
  });

  ipcMain.handle('prompt:last', () => lastPrompt());
  ipcMain.handle('emotion:get', () => describe(loadEmotion()));
  ipcMain.handle('emotion:reset', () => {
    const state = resetEmotion();
    // Repaints the fairy and the chat header from the state she has just been given.
    conversation?.describeState();
    return describe(state);
  });
  ipcMain.handle('clipboard:write', (_e, text: unknown) => {
    if (typeof text === 'string') clipboard.writeText(text);
  });

  /**
   * A new user gets the guide, once. Everyone else gets a fairy.
   *
   * Deferred to the overlay finishing its load so the guide opens over a Navi who is already on
   * screen: the window is about her, and appearing before she does reads as a setup wizard for
   * something you have not met.
   */
  if (!current.onboarded) {
    win.webContents.once('did-finish-load', () => onboarding?.show());
  } else {
    // Not a nag — one line in the chat, on the first turn that needs something missing. A
    // permission granted after first run is the common case, so this is checked at launch
    // rather than trusted from the flag.
    void onboardingState().then((state) => {
      for (const problem of blockers(state)) {
        chat?.send('chat:event', { type: 'error', message: problem.message });
      }
    });
  }

  /**
   * The safety gate (NAV-91). It has nothing to gate yet — NAV-90's helper does not exist — and
   * it is here first on purpose: a gate written after the capability is a gate written to let
   * the existing behaviour through. When the write tools arrive they call `gate.attempt` and do
   * nothing else about safety.
   */
  gate = createGate({
    allowedApps: () =>
      load()
        .allowedApps.split(',')
        .map((a) => a.trim())
        .filter((a) => a !== ''),
    confirm: (action, decision) =>
      new Promise<boolean>((resolve) => {
        const id = nextConfirmation++;
        pendingConfirmations.set(id, resolve);
        if (win) chat?.show(win);
        chat?.send('chat:event', {
          type: 'confirm',
          id,
          action: action.name,
          app: action.app ?? '',
          detail: action.detail ?? '',
          reason: decision.reason,
        });
      }),
    // The user must always know when she is reaching outside her own window.
    onActing: (acting) => win?.webContents.send('acting', acting),
    onAudit: (entry) => console.log('action:', entry.verdict, entry.action.name, entry.reason),
  });
  if (current.halted) gate.halt();

  // Sweeps anything that came due while the app was closed, then arms for the next one.
  reminders.start();

  // The overlay is the app. It has no frame and cannot be closed by hand, but if it ever goes
  // away the hidden windows must not keep the process alive with nothing on screen.
  win.on('closed', () => app.quit());
});

app.on('before-quit', () => {
  // Last chance to remember the session. Unawaited: `before-quit` will not hold for it, and a
  // summary is worth attempting rather than worth delaying a quit for.
  void conversation?.endSession();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  reminders?.stop();
  guidance?.abort();
  speaker?.stop();
  clickThrough?.stop();
  follow?.stop();
  cursor?.stop();
});

// The overlay is the app. Closing it means quitting, including on macOS.
app.on('window-all-closed', () => app.quit());
