/**
 * Settings, and the prompt inspector.
 *
 * Two things in one window because they answer each other: almost every setting here ends up
 * as text in the prompt, and the Prompt tab is where you check that it did. NAV-85 built the
 * inspector for exactly this — the Godot build had no way to see its assembled prompt, which
 * is how two contradictory pointing instructions coexisted for months.
 *
 * There is no Save button. Fields commit on change, the way a preferences window does, and the
 * main process is what validates them — `shared/settings.ts` is the authority on what a frame
 * rate or a provider name may be, not this file.
 *
 * The API key is the one field that does not round-trip. The window is told whether a key is
 * set and never what it is (NAV-81), so it sends a key only when the user types a new one, and
 * a save from here cannot erase one it could not see.
 */

import { factTokens, FACT_BUDGET, MAX_EPISODES, type Memory } from '../shared/memory.js';
import { upcoming, type Notes } from '../shared/notes.js';
import { describeWhen } from '../shared/when.js';
import { describeEntry, type AuditEntry } from '../shared/policy.js';

import type { PromptRecord } from '../prompt/inspector.js';
import type { SettingsView } from '../shared/settings.js';

declare global {
  interface Window {
    naviSettings?: {
      get(): Promise<SettingsView>;
      save(patch: Record<string, unknown>): Promise<{
        view: SettingsView;
        hotkeyRegistered: boolean;
        voiceHotkeyRegistered: boolean;
      }>;
      lastPrompt(): Promise<PromptRecord | null>;
      memory(): Promise<Memory>;
      memoryForget(id: string): Promise<Memory>;
      memoryRemember(text: string): Promise<Memory>;
      memoryReset(): Promise<Memory>;
      notes(): Promise<Notes>;
      noteDelete(id: string): Promise<Notes>;
      policyLog(): Promise<AuditEntry[]>;
      policyHalted(): Promise<boolean>;
      policyResume(): Promise<boolean>;
      emotion(): Promise<string>;
      resetEmotion(): Promise<string>;
      copy(text: string): Promise<void>;
      openOnboarding(): void;
      close(): void;
    };
  }
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const panels = { settings: $('panel-settings'), prompt: $('panel-prompt'), memory: $('panel-memory') };
const tabs = {
  settings: $<HTMLButtonElement>('tab-settings'),
  prompt: $<HTMLButtonElement>('tab-prompt'),
  memory: $<HTMLButtonElement>('tab-memory'),
};
const saved = $('saved');
const warning = $('warning');
const relationship = $('relationship');
const keyInput = $<HTMLInputElement>('openaiApiKey');
const keyNote = $('key-note');
const providerNote = $('provider-note');

/** Every input that maps straight onto a settings key. The key field is handled on its own. */
const bound = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-setting]')];

let current: SettingsView | null = null;

type TabName = 'settings' | 'prompt' | 'memory';

function showTab(name: TabName): void {
  for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== name;
  for (const [key, tab] of Object.entries(tabs)) tab.setAttribute('aria-selected', String(key === name));
  if (name === 'prompt') void loadPrompt();
  if (name === 'memory') void loadMemory();
}

function flashSaved(): void {
  saved.classList.add('on');
  setTimeout(() => saved.classList.remove('on'), 1100);
}

function render(view: SettingsView): void {
  current = view;
  const s = view.settings;

  for (const el of bound) {
    const key = el.dataset['setting'] as keyof typeof s;
    // A checkbox carries its value in `checked`; writing a boolean into `value` would put the
    // string "false" in the box and read back as truthy.
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(s[key]);
    else el.value = String(s[key]);
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('#provider button')) {
    button.setAttribute('aria-pressed', String(button.dataset['provider'] === s.provider));
  }
  for (const field of document.querySelectorAll<HTMLElement>('[data-provider-only]')) {
    field.hidden = field.dataset['providerOnly'] !== s.provider;
  }

  providerNote.textContent =
    s.provider === 'ollama'
      ? 'Everything you say stays on this machine.'
      : 'What you say is sent to OpenAI. Ollama is the offline path.';

  keyInput.value = '';
  keyInput.placeholder = view.hasOpenaiApiKey ? '•••••••••••••• saved' : 'sk-…';
  keyNote.textContent = view.hasOpenaiApiKey
    ? 'A key is saved. Type a new one to replace it; leaving this empty keeps it.'
    : 'Stored on this machine, and never shown again once saved.';
}

async function save(patch: Record<string, unknown>): Promise<void> {
  const result = await window.naviSettings?.save(patch);
  if (!result) return;
  render(result.view);
  // The hotkeys are the settings that can be rejected by something outside Navi. An accelerator
  // another app already owns fails silently, and the user is left pressing a key that does
  // nothing with no idea why.
  const s = result.view.settings;
  warning.textContent = !result.hotkeyRegistered
    ? `Another app owns ${s.hotkey}. Clicking her still opens the chat.`
    : !result.voiceHotkeyRegistered
      ? `Another app owns ${s.voiceHotkey}. Pick a different talk key.`
      : '';
  flashSaved();
}

// The guide stays reachable after first run: the local-path setup instructions are the only
// place they exist, and someone who started on cloud is exactly who needs them (NAV-92).
$('open-onboarding').addEventListener('click', () => window.naviSettings?.openOnboarding());

for (const el of bound) {
  el.addEventListener('change', () => {
    const key = el.dataset['setting'] as string;
    const value =
      el instanceof HTMLInputElement && el.type === 'checkbox'
        ? el.checked
        : el instanceof HTMLInputElement && el.type === 'number'
          ? Number(el.value)
          : el.value;
    void save({ [key]: value });
  });
}

for (const button of document.querySelectorAll<HTMLButtonElement>('#provider button')) {
  button.addEventListener('click', () => void save({ provider: button.dataset['provider'] }));
}

keyInput.addEventListener('change', () => {
  // Empty means "leave whatever is stored alone", which is why it is not sent. Clearing a key
  // is the button next to it, so that it takes an action rather than an absence.
  if (keyInput.value.trim() === '') return;
  void save({ openaiApiKey: keyInput.value.trim() });
});

$('clear-key').addEventListener('click', () => void save({ openaiApiKey: '' }));

// Two-step rather than a dialog: the second click is the confirmation, and clicking anywhere
// else disarms it. Wiping a relationship someone has been building deserves the pause.
const resetButton = $<HTMLButtonElement>('reset-emotion');
const disarm = (): void => {
  resetButton.dataset['armed'] = 'false';
  resetButton.textContent = 'Start over';
};
resetButton.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (resetButton.dataset['armed'] !== 'true') {
    resetButton.dataset['armed'] = 'true';
    resetButton.textContent = 'Really start over?';
    return;
  }
  relationship.textContent = (await window.naviSettings?.resetEmotion()) ?? '';
  disarm();
  flashSaved();
});
document.addEventListener('click', disarm);

async function loadPrompt(): Promise<void> {
  const record = await window.naviSettings?.lastPrompt();
  const body = $('prompt-body');
  const when = $('prompt-when');
  body.textContent = '';

  if (!record) {
    when.textContent = 'No prompt yet.';
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Say something to her, then come back. This shows the exact prompt she was sent.';
    body.append(empty);
    return;
  }

  when.textContent = `${new Date(record.at).toLocaleTimeString()} · ~${record.estimatedTokens} tokens (estimated)`;

  for (const section of record.sections) {
    const wrapper = document.createElement('div');
    wrapper.className = 'layer';

    const heading = document.createElement('h3');
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = `LAYER ${section.layer}`;
    heading.append(n, document.createTextNode(section.title));

    const pre = document.createElement('pre');
    pre.textContent = section.body;

    wrapper.append(heading, pre);
    body.append(wrapper);
  }
}

$('refresh-prompt').addEventListener('click', () => void loadPrompt());
$('copy-prompt').addEventListener('click', async () => {
  const record = await window.naviSettings?.lastPrompt();
  if (!record) return;
  await window.naviSettings?.copy(record.prompt);
  flashSaved();
});

tabs.settings.addEventListener('click', () => showTab('settings'));
tabs.prompt.addEventListener('click', () => showTab('prompt'));
tabs.memory.addEventListener('click', () => showTab('memory'));

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // Fields commit on blur, so closing straight from a focused one would throw away what was
  // just typed. The first Escape leaves the field, which saves it; the second closes.
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    active.blur();
    return;
  }
  window.naviSettings?.close();
});

void (async () => {
  const view = await window.naviSettings?.get();
  if (view) render(view);
  relationship.textContent = (await window.naviSettings?.emotion()) ?? '';
})();

// ---------------------------------------------------------------------------
// The memory viewer (NAV-93)
// ---------------------------------------------------------------------------

const memoryAdd = $<HTMLInputElement>('memory-add');
const memoryBody = $('memory-body');
const memoryBudget = $('memory-budget');

/**
 * One row per thing she knows, with its own delete.
 *
 * Preferences are shown but not individually deletable: they are a capped, newest-wins list
 * that she rewrites as she learns, so the honest control over them is "forget everything" and
 * telling her plainly, not a delete button on a value that will be replaced anyway.
 */
function memoryGroup(title: string, items: Array<{ id?: string; text: string; at?: number }>): HTMLElement {
  const group = document.createElement('div');
  group.className = 'memory-group';

  const heading = document.createElement('h3');
  heading.textContent = `${title} (${items.length})`;
  group.append(heading);

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'memory-item';

    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = item.text;
    row.append(text);

    if (item.at !== undefined && item.at > 0) {
      const when = document.createElement('span');
      when.className = 'when';
      when.textContent = new Date(item.at).toLocaleDateString();
      row.append(when);
    }

    if (item.id !== undefined) {
      const remove = document.createElement('button');
      remove.className = 'plain';
      remove.textContent = 'Forget';
      remove.addEventListener('click', async () => {
        // A note id is prefixed; memory ids are not. One button, two stores, and the id says
        // which — rather than a flag threaded through every caller.
        if (item.id!.startsWith('n')) await window.naviSettings?.noteDelete(item.id!);
        else await window.naviSettings?.memoryForget(item.id!);
        await loadMemory();
        flashSaved();
      });
      row.append(remove);
    }

    group.append(row);
  }

  return group;
}

/** Returns whether it put anything on screen, so the empty state can be decided once. */
function renderMemory(memory: Memory | undefined): boolean {
  memoryBody.textContent = '';
  if (!memory) return false;

  const preferences = [
    ...memory.relationship.likes.map((text) => ({ text: `liked: ${text}` })),
    ...memory.relationship.dislikes.map((text) => ({ text: `disliked: ${text}` })),
  ];

  if (memory.facts.length === 0 && memory.episodes.length === 0 && preferences.length === 0) {
    memoryBudget.textContent = '';
    // Not the empty state yet: notes are a different store, and having none of one is not
    // having none of the other.
    return false;
  }

  if (preferences.length > 0) memoryBody.append(memoryGroup('What you like', preferences));
  if (memory.facts.length > 0) memoryBody.append(memoryGroup('Facts', memory.facts));
  if (memory.episodes.length > 0) {
    // Newest first: what she did most recently is what you came here to check.
    const episodes = [...memory.episodes].sort((a, b) => b.at - a.at);
    memoryBody.append(memoryGroup('Sessions', episodes));
  }

  // Stated because the whole store exists to stay small, and a number is the only honest way to
  // say whether it has.
  memoryBudget.textContent =
    `~${factTokens(memory.facts)} of ${FACT_BUDGET} tokens of facts · ` +
    `${memory.episodes.length} sessions, at most ${MAX_EPISODES} recalled per message`;
  return true;
}

/**
 * The user's own notes, in the same viewer.
 *
 * Rendered separately from memory rather than merged into it, because the difference is the
 * point: memory is what she inferred and is consolidated and decayed; these are what the user
 * wrote and are never touched by a schedule. There is no "forget everything" here for the same
 * reason — they go one at a time and deliberately.
 */
function renderNotes(store: Notes | undefined): boolean {
  if (!store || store.notes.length === 0) return false;

  const now = Date.now();
  const pending = new Set(upcoming(store, now).map((n) => n.id));
  const items = [...store.notes]
    .sort((a, b) => b.at - a.at)
    .map((note) => ({
      id: note.id,
      text:
        note.due === undefined
          ? note.text
          : `${note.text} — ${pending.has(note.id) ? describeWhen(note.due, now) : 'done'}`,
      at: note.at,
    }));

  memoryBody.append(memoryGroup('Your notes', items));
  return true;
}

async function loadMemory(): Promise<void> {
  const hasMemory = renderMemory(await window.naviSettings?.memory());
  const hasNotes = renderNotes(await window.naviSettings?.notes());

  if (!hasMemory && !hasNotes) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'She does not know anything about you yet. Tell her something, or ask her to remember.';
    memoryBody.append(empty);
  }
}

$('memory-save').addEventListener('click', async () => {
  const text = memoryAdd.value.trim();
  if (text === '') return;
  memoryAdd.value = '';
  await window.naviSettings?.memoryRemember(text);
  await loadMemory();
  flashSaved();
});

memoryAdd.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('memory-save').click();
});

const memoryReset = $<HTMLButtonElement>('memory-reset');
const disarmMemory = (): void => {
  memoryReset.dataset['armed'] = 'false';
  memoryReset.textContent = 'Forget everything';
};
memoryReset.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (memoryReset.dataset['armed'] !== 'true') {
    memoryReset.dataset['armed'] = 'true';
    memoryReset.textContent = 'Really forget everything?';
    return;
  }
  await window.naviSettings?.memoryReset();
  await loadMemory();
  disarmMemory();
  flashSaved();
});
document.addEventListener('click', disarmMemory);

// ---------------------------------------------------------------------------
// The safety gate (NAV-91)
// ---------------------------------------------------------------------------

const haltedState = $('halted-state');
const resumeButton = $<HTMLButtonElement>('resume');
const policyLog = $('policy-log');

function renderHalted(halted: boolean): void {
  // Precise about what "stopped" means: pressing it cancels the reply, her voice and anything
  // in flight, and she will not act on the machine again until this button is pressed. She can
  // still be talked to — halting a conversation is not what an emergency stop is for.
  haltedState.textContent = halted
    ? 'Stopped. She will not touch anything on your machine until you start her again. You can still talk to her.'
    : 'Running. She has not been stopped.';
  haltedState.classList.toggle('stopped', halted);
  // Starting her again is deliberately its own act rather than something the stop key toggles:
  // the moment you need the stop key is not a moment to be one keystroke from undoing it.
  resumeButton.hidden = !halted;
}

async function loadPolicy(): Promise<void> {
  renderHalted((await window.naviSettings?.policyHalted()) ?? false);

  const log = (await window.naviSettings?.policyLog()) ?? [];
  policyLog.replaceChildren();

  if (log.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'Nothing yet. She has not tried to do anything to your machine.';
    policyLog.append(empty);
    return;
  }

  // Newest first: what just happened is what you opened this to see.
  for (const entry of [...log].reverse()) {
    const line = document.createElement('div');
    line.textContent = describeEntry(entry);
    policyLog.append(line);
  }
}

resumeButton.addEventListener('click', async () => {
  renderHalted((await window.naviSettings?.policyResume()) ?? false);
  flashSaved();
});
$('refresh-log').addEventListener('click', () => void loadPolicy());

void loadPolicy();
