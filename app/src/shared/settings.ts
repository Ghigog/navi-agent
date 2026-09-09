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
};

export const PROVIDERS: readonly Settings['provider'][] = ['ollama', 'openai'];

/**
 * Frame rates the loop will accept. The ceiling is not a preference: ADR 0001's idle CPU result
 * passed its bar with little room, so an unbounded number here is a way to fail that bar from
 * the settings window. The floor stops a zero freezing the fairy mid-hover.
 */
export const FPS_MIN = 1;
export const FPS_MAX = 120;

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

  // typeof is not enough for these three: 'banana' is as much a string as 'ollama' is, and the
  // provider seam would quietly fall through to Ollama rather than say so.
  if (!PROVIDERS.includes(out.provider)) out.provider = DEFAULTS.provider;
  out.idleFps = fps(out.idleFps, DEFAULTS.idleFps);
  out.activeFps = fps(out.activeFps, DEFAULTS.activeFps);

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
