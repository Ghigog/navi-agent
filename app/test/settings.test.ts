import { describe, expect, it } from 'vitest';
import { applyUpdate, coerce, DEFAULTS, FPS_MAX, FPS_MIN, view } from '../src/shared/settings.js';

describe('coerce', () => {
  it('returns defaults for junk', () => {
    expect(coerce(null)).toEqual(DEFAULTS);
    expect(coerce('nonsense')).toEqual(DEFAULTS);
    expect(coerce(42)).toEqual(DEFAULTS);
  });

  it('keeps stored values that match the expected type', () => {
    expect(coerce({ ollamaModel: 'gemma4:e4b' }).ollamaModel).toBe('gemma4:e4b');
  });

  it('drops keys the current build does not know about', () => {
    const out = coerce({ enablePushToTalk: true }) as unknown as Record<string, unknown>;
    expect(out['enablePushToTalk']).toBeUndefined();
  });

  it('falls back to the default when a stored value has the wrong type', () => {
    // A settings file from an older build should degrade, not propagate a value the rest of
    // the app will misread.
    expect(coerce({ idleFps: 'fast' }).idleFps).toBe(DEFAULTS.idleFps);
  });

  it('does not mutate DEFAULTS', () => {
    coerce({ personality: 'Annoying' });
    expect(DEFAULTS.personality).toBe('');
  });
});

describe('coerce, as the validator for what the settings window sends back', () => {
  it('rejects a provider name the seam does not know', () => {
    // typeof is not enough here: 'banana' is as much a string as 'ollama', and createProvider
    // would quietly fall through to Ollama rather than say anything.
    expect(coerce({ provider: 'banana' }).provider).toBe(DEFAULTS.provider);
    expect(coerce({ provider: 'openai' }).provider).toBe('openai');
  });

  it('bounds the frame rates', () => {
    // ADR 0001's idle CPU result passed with little room. An unbounded number here is a way to
    // fail that bar from the settings window.
    expect(coerce({ idleFps: 9000 }).idleFps).toBe(FPS_MAX);
    expect(coerce({ idleFps: 0 }).idleFps).toBe(FPS_MIN);
    expect(coerce({ activeFps: -5 }).activeFps).toBe(FPS_MIN);
    expect(coerce({ idleFps: 24.6 }).idleFps).toBe(25);
    expect(coerce({ idleFps: Number.NaN }).idleFps).toBe(DEFAULTS.idleFps);
  });

  it('trims a pasted value', () => {
    // A trailing space on a URL is not a different server, it is a broken one.
    expect(coerce({ ollamaBaseUrl: '  http://localhost:11434 ' }).ollamaBaseUrl).toBe('http://localhost:11434');
  });
});

describe('applyUpdate', () => {
  const stored = { ...DEFAULTS, openaiApiKey: 'sk-secret', ollamaModel: 'gemma4:e4b' };

  it('changes only what the patch carries', () => {
    const next = applyUpdate(stored, { personality: 'Impatient' });
    expect(next.personality).toBe('Impatient');
    expect(next.ollamaModel).toBe('gemma4:e4b');
  });

  it('leaves a key a window that never saw one cannot name', () => {
    // The settings window is not sent the API key, so it never sends one back. A save from it
    // must not therefore erase one.
    expect(applyUpdate(stored, { provider: 'openai' }).openaiApiKey).toBe('sk-secret');
  });

  it('clears the key when the patch asks for it explicitly', () => {
    expect(applyUpdate(stored, { openaiApiKey: '' }).openaiApiKey).toBe('');
  });

  it('keeps the stored value when a patched one is the wrong type', () => {
    // A bad edit should cost the edit, not the setting.
    expect(applyUpdate(stored, { ollamaModel: 42 }).ollamaModel).toBe('gemma4:e4b');
  });

  it('ignores junk instead of wiping everything', () => {
    expect(applyUpdate(stored, null)).toEqual(stored);
    expect(applyUpdate(stored, 'nonsense')).toEqual(stored);
    expect(applyUpdate(stored, { nonsense: true })).toEqual(stored);
  });

  it('validates the patch, not just the stored file', () => {
    expect(applyUpdate(stored, { idleFps: 9000 }).idleFps).toBe(FPS_MAX);
    expect(applyUpdate(stored, { provider: 'banana' }).provider).toBe(DEFAULTS.provider);
  });
});

describe('view', () => {
  it('never carries the key to the renderer', () => {
    // NAV-81: nothing derived from settings reaches a renderer with a credential in it.
    const v = view({ ...DEFAULTS, openaiApiKey: 'sk-secret' });
    expect(v.settings.openaiApiKey).toBe('');
    expect(JSON.stringify(v)).not.toContain('sk-secret');
  });

  it('still says whether one is set, which is what the field needs', () => {
    expect(view({ ...DEFAULTS, openaiApiKey: 'sk-secret' }).hasOpenaiApiKey).toBe(true);
    expect(view({ ...DEFAULTS }).hasOpenaiApiKey).toBe(false);
  });

  it('does not mutate what it was given', () => {
    const settings = { ...DEFAULTS, openaiApiKey: 'sk-secret' };
    view(settings);
    expect(settings.openaiApiKey).toBe('sk-secret');
  });
});
