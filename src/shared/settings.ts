/**
 * Settings shape and defaults. Pure data and pure functions only — no Electron imports — so
 * this is testable without a running app.
 */

export interface Settings {
  /** Ollama is the daily driver and the core path must work offline (ADR 0001). */
  provider: 'ollama' | 'openai';
  ollamaBaseUrl: string;
  ollamaModel: string;
  /** Optional cloud on-ramp. Never a dependency. */
  openaiApiKey: string;
  openaiModel: string;

  /**
   * Model for the sentiment classification call (emotions.md §4.4). Empty means "use whatever
   * model this turn is using" — a separate small one is faster, since it runs before every
   * reply, but it must not be a second thing to configure before Navi works at all.
   *
   * This is also where NAV-98's `local_thinking_model` / `cloud_thinking_model` question lands.
   * Those keys were half of a two-tier design NAV-59 had already collapsed: one model per
   * provider is the whole story for replies, and the only genuine second model is this one,
   * which does a different job rather than the same job better. They are not carried across.
   */
  sentimentModel: string;

  personality: string;
  /** The user's own standing instructions. Renders into prompt Layer 4, fenced. */
  systemPrompt: string;

  /** Global summon hotkey. Shift+Cmd+N is the one that reliably registers on macOS (ADR 0001). */
  hotkey: string;

  /** Frames per second while nothing is happening. See renderer/loop.ts. */
  idleFps: number;
  /** Frames per second while Navi is speaking, thinking or being interacted with. */
  activeFps: number;

  /**
   * Whether she speaks her replies (NAV-104). Off by default, and that is a judgement rather
   * than caution: piper is a Python module the user may not have, and a companion whose first
   * act on first launch is to talk out loud at you has made a decision that was yours.
   */
  voiceOutput: boolean;
  /** Whether the talk key listens at all. */
  voiceInput: boolean;

  /**
   * The talk key.
   *
   * NAV-98 asked whether `enable_push_to_talk` survived the port. It does, as `voiceInput` —
   * but not as the mode switch it used to be. In the Godot build it chose between push-to-talk
   * and voice activity detection, NAV-69 removed the second option, and the setting was left
   * behind always reading true. Here there is one way to talk to her and this is whether it is
   * on.
   *
   * It is a press-to-start, press-again-to-stop key rather than a held one, and that is forced:
   * `globalShortcut` reports key presses and never key releases, so a held key would start a
   * recording nothing could end. The alternative is a key that only works while Navi has focus,
   * and the overlay is click-through and never has focus (ADR 0001).
   */
  voiceHotkey: string;
  /** Piper voice, by the stem of its `.onnx` file in `bin/voices`. */
  voiceName: string;
  /** 1.0 is the voice's own pace; 1.5 is half again as fast. */
  voiceSpeed: number;
  /** Whisper model, by filename in `bin`. */
  speechModel: string;

  /**
   * Whether first run has been completed (NAV-92).
   *
   * A flag rather than an inference from "is anything configured", because the two questions
   * differ: a user who read the guide, chose the local path and has not started Ollama yet has
   * finished onboarding and still has nothing configured. Inferring would put the window back
   * in their face every launch until they complied.
   */
  onboarded: boolean;

  /**
   * Applications Navi is allowed to act in, comma-separated (NAV-91).
   *
   * Empty by default, which denies everything: the allowlist is the gate's only source of yes,
   * and a default that allowed anything would be a gate that opened itself. `DENIED_APPS` is
   * not user-editable and overrides anything named here.
   */
  allowedApps: string;

  /**
   * The kill switch. Held stopped across a restart on purpose: a user who hit it because
   * something was going wrong should not find her acting again after a relaunch.
   */
  halted: boolean;

  /** Global shortcut that halts anything in flight, immediately. */
  killHotkey: string;
}

export const DEFAULTS: Settings = {
  provider: 'ollama',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2:3b',
  openaiApiKey: '',
  openaiModel: 'gpt-4o-mini',
  sentimentModel: '',
  personality: '',
  systemPrompt: '',
  hotkey: 'Shift+Command+N',
  idleFps: 30,
  activeFps: 60,
  voiceOutput: false,
  voiceInput: false,
  voiceHotkey: 'Shift+Command+V',
  voiceName: 'en_US-amy-medium',
  voiceSpeed: 1,
  speechModel: 'ggml-base.en.bin',
  onboarded: false,
  allowedApps: '',
  halted: false,
  killHotkey: 'Shift+Command+Escape',
};

export const PROVIDERS: readonly Settings['provider'][] = ['ollama', 'openai'];

/**
 * Frame rates the loop will accept. The ceiling is not a preference: ADR 0001's idle CPU result
 * passed its bar with little room, so an unbounded number here is a way to fail that bar from
 * the settings window. The floor stops a zero freezing the fairy mid-hover.
 */
export const FPS_MIN = 1;
export const FPS_MAX = 120;

/** Speech rate bounds. Below the floor she is unbearable; above the ceiling, unintelligible. */
export const SPEED_MIN = 0.5;
export const SPEED_MAX = 2;

const fps = (value: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(FPS_MAX, Math.max(FPS_MIN, Math.round(value))) : fallback;

/**
 * Merges stored settings over the defaults, dropping unknown keys and keys whose stored type no
 * longer matches. A settings file written by an older build should degrade to defaults rather
 * than propagate a value the rest of the app will misread.
 *
 * It is also the validator for anything the settings window sends back, so the checks below are
 * on values a person can type: an unknown provider name, a frame rate outside what the loop
 * will honour, a URL with a space on the end of it.
 */
export function coerce(stored: unknown): Settings {
  const out: Settings = { ...DEFAULTS };
  if (stored === null || typeof stored !== 'object') return out;

  for (const [key, value] of Object.entries(stored)) {
    if (!(key in DEFAULTS)) continue;
    const k = key as keyof Settings;
    if (typeof value !== typeof DEFAULTS[k]) continue;
    // Safe: the typeof check above establishes the value matches this key's type.
    (out as unknown as Record<string, unknown>)[k] = typeof value === 'string' ? value.trim() : value;
  }

  // typeof is not enough for these: 'banana' is as much a string as 'ollama' is, and the
  // provider seam would quietly fall through to Ollama rather than say so.
  if (!PROVIDERS.includes(out.provider)) out.provider = DEFAULTS.provider;
  out.idleFps = fps(out.idleFps, DEFAULTS.idleFps);
  out.activeFps = fps(out.activeFps, DEFAULTS.activeFps);
  // A zero here divides into piper's length_scale; a negative one reverses nothing and confuses
  // everything. Bounded to a range a person would actually want to listen to.
  out.voiceSpeed = Number.isFinite(out.voiceSpeed)
    ? Math.min(SPEED_MAX, Math.max(SPEED_MIN, out.voiceSpeed))
    : DEFAULTS.voiceSpeed;

  return out;
}

/**
 * Applies a patch from the settings window on top of what is stored.
 *
 * Only keys the patch actually carries are touched, which is what lets the settings window
 * leave the API key alone: it never receives one, so it never sends one back, and a save from
 * a window that cannot see the key cannot erase it. A value of the wrong type keeps the stored
 * one rather than resetting to the default — a bad edit should cost the edit, not the setting.
 */
export function applyUpdate(current: Settings, patch: unknown): Settings {
  const merged: Record<string, unknown> = { ...current };
  if (patch !== null && typeof patch === 'object') {
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULTS)) continue;
      if (typeof value !== typeof DEFAULTS[key as keyof Settings]) continue;
      merged[key] = value;
    }
  }
  return coerce(merged);
}

/**
 * Settings as the settings window is allowed to see them.
 *
 * The API key stays in the main process (NAV-81: route nothing derived from settings to the
 * renderer unredacted). The window is told whether one is set, which is all it needs to render
 * the field, and it edits the key by sending a new one — never by echoing back the old one.
 */
export interface SettingsView {
  settings: Settings;
  hasOpenaiApiKey: boolean;
}

export function view(settings: Settings): SettingsView {
  return {
    settings: { ...settings, openaiApiKey: '' },
    hasOpenaiApiKey: settings.openaiApiKey !== '',
  };
}
