import { describe, expect, it } from 'vitest';
import { coerce, DEFAULTS } from '../src/shared/settings.js';

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
