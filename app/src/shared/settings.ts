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

/**
 * Merges stored settings over the defaults, dropping unknown keys and keys whose stored type no
 * longer matches. A settings file written by an older build should degrade to defaults rather
 * than propagate a value the rest of the app will misread.
 */
export function coerce(stored: unknown): Settings {
  const out: Settings = { ...DEFAULTS };
  if (stored === null || typeof stored !== 'object') return out;

  for (const [key, value] of Object.entries(stored)) {
    if (!(key in DEFAULTS)) continue;
    const k = key as keyof Settings;
    if (typeof value !== typeof DEFAULTS[k]) continue;
    // Safe: the typeof check above establishes the value matches this key's type.
    (out as unknown as Record<string, unknown>)[k] = value;
  }
  return out;
}
