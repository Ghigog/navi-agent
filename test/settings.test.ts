import { describe, expect, it } from 'vitest';
import {
  ambientEnabled,
  applyUpdate,
  coerce,
  DEFAULTS,
  FPS_MAX,
  FPS_MIN,
  SPEED_MAX,
  SPEED_MIN,
  view,
} from '../src/shared/settings.js';
import { DEFAULT_BUFFER_MINUTES } from '../src/shared/calendar.js';

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

describe('voice settings (NAV-104)', () => {
  it('starts silent, in both directions', () => {
    // Neither speaking nor listening on first launch. Both need a binary the user may not have,
    // and a companion whose first act is to talk out loud has made a decision that was theirs.
    expect(DEFAULTS.voiceOutput).toBe(false);
    expect(DEFAULTS.voiceInput).toBe(false);
  });

  it('keeps the speech rate inside a range worth listening to', () => {
    expect(coerce({ voiceSpeed: 12 }).voiceSpeed).toBe(SPEED_MAX);
    expect(coerce({ voiceSpeed: 0.01 }).voiceSpeed).toBe(SPEED_MIN);
    // A zero would divide into piper's length_scale, which is where the clamp actually earns
    // its keep rather than merely being tidy.
    expect(coerce({ voiceSpeed: 0 }).voiceSpeed).toBe(SPEED_MIN);
    expect(coerce({ voiceSpeed: -2 }).voiceSpeed).toBe(SPEED_MIN);
  });

  it('keeps a rate the user actually chose', () => {
    expect(coerce({ voiceSpeed: 1.4 }).voiceSpeed).toBeCloseTo(1.4, 6);
  });

  it('does not carry NAV-98\'s thinking-model keys across', () => {
    const stored = coerce({ local_thinking_model: 'x', cloud_thinking_model: 'y' });
    expect(Object.keys(stored)).not.toContain('local_thinking_model');
    expect(Object.keys(stored)).not.toContain('cloud_thinking_model');
  });
});

describe('presence settings (NAV-113)', () => {
  it('starts off: paused is false, but so is everything it would gate', () => {
    // Not a contradiction — off by default (NAV-97) is what actually stops anything happening,
    // the same way `ambientPaused: false` alone. `noticeActivity: false` is the reason nothing
    // reads the foreground app yet, not the pause switch.
    expect(DEFAULTS.ambientPaused).toBe(false);
    expect(DEFAULTS.noticeActivity).toBe(false);
  });

  it('has no quiet hours by default — equal start and end, which inQuietHours already reads as off', () => {
    expect(DEFAULTS.quietHoursStart).toBe(DEFAULTS.quietHoursEnd);
  });

  it('wraps a quiet-hours minute into a single day rather than propagating an out-of-range one', () => {
    expect(coerce({ quietHoursStart: 1500 }).quietHoursStart).toBe(1500 - 1440);
    expect(coerce({ quietHoursStart: -30 }).quietHoursStart).toBe(1440 - 30);
    expect(coerce({ quietHoursEnd: Number.NaN }).quietHoursEnd).toBe(DEFAULTS.quietHoursEnd);
  });

  it('keeps an ordinary minute-of-day value untouched', () => {
    expect(coerce({ quietHoursStart: 1320 }).quietHoursStart).toBe(1320);
  });

  describe('ambientEnabled', () => {
    it('is true until the pause switch is on', () => {
      expect(ambientEnabled({ ...DEFAULTS, ambientPaused: false })).toBe(true);
      expect(ambientEnabled({ ...DEFAULTS, ambientPaused: true })).toBe(false);
    });
  });
});

describe('calendar picking, the default buffer and per-event overrides (T-1)', () => {
  it('reads only "primary" by default, the only calendar this app ever read before', () => {
    expect(DEFAULTS.selectedCalendars).toBe('primary');
  });

  it('defaults the leave-by buffer to what calendar.ts always used', () => {
    expect(DEFAULTS.defaultBufferMinutes).toBe(DEFAULT_BUFFER_MINUTES);
  });

  it('has no per-event overrides by default', () => {
    expect(DEFAULTS.eventBufferOverrides).toBe('');
  });

  it('keeps a chosen calendar list and trims a pasted one, the same as allowedApps', () => {
    expect(coerce({ selectedCalendars: 'work, family@group.calendar.google.com' }).selectedCalendars).toBe(
      'work, family@group.calendar.google.com',
    );
    expect(coerce({ selectedCalendars: '  primary ' }).selectedCalendars).toBe('primary');
  });

  it('rounds a default buffer and floors it at zero rather than going negative', () => {
    expect(coerce({ defaultBufferMinutes: 12.6 }).defaultBufferMinutes).toBe(13);
    expect(coerce({ defaultBufferMinutes: -5 }).defaultBufferMinutes).toBe(0);
    expect(coerce({ defaultBufferMinutes: Number.NaN }).defaultBufferMinutes).toBe(DEFAULTS.defaultBufferMinutes);
  });

  it('keeps a well-formed event override list', () => {
    expect(coerce({ eventBufferOverrides: 'evt-1=25,evt-2=5' }).eventBufferOverrides).toBe('evt-1=25,evt-2=5');
  });

  it('a settings-window save changes only the field it carries, like every other patch', () => {
    const next = applyUpdate(DEFAULTS, { selectedCalendars: 'work' });
    expect(next.selectedCalendars).toBe('work');
    expect(next.defaultBufferMinutes).toBe(DEFAULTS.defaultBufferMinutes);
  });
});
