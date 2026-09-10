import { describe, expect, it } from 'vitest';
import { redact } from '../src/shared/redact.js';

/** Shape-accurate stand-in for the key that actually leaked. Not a real credential. */
const KEY = `sk-proj-${'0'.repeat(44)}`;

describe('redact', () => {
  it('masks a representative key by name', () => {
    const out = redact({ openaiApiKey: KEY }) as Record<string, unknown>;
    expect(out['openaiApiKey']).toBe(`<redacted:${KEY.length} chars>`);
    expect(JSON.stringify(out)).not.toContain(KEY);
  });

  it('masks every secret-ish name', () => {
    const out = redact({
      cloudApiKey: 'abcdef',
      authToken: 'abcdef',
      clientSecret: 'abcdef',
      dbPassword: 'abcdef',
      awsCredential: 'abcdef',
    }) as Record<string, unknown>;
    for (const [name, value] of Object.entries(out)) {
      expect(value, name).toBe('<redacted:6 chars>');
    }
  });

  it('leaves ordinary settings legible', () => {
    const out = redact({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      ttsRate: 1.4,
      thinking: true,
    }) as Record<string, unknown>;
    expect(out).toEqual({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      ttsRate: 1.4,
      thinking: true,
    });
  });

  it('keeps an unset key distinguishable from a set one', () => {
    const out = redact({ cloudApiKey: '', openaiApiKey: 'x' }) as Record<string, unknown>;
    expect(out['cloudApiKey']).toBe('');
    expect(out['openaiApiKey']).toBe('<redacted:1 chars>');
  });

  it('masks a credential hiding under an innocuous name', () => {
    // The exact class of bug that caused NAV-81: a secret somewhere nobody thought to look.
    expect(JSON.stringify(redact({ notes: KEY }))).not.toContain(KEY);
  });

  it('reaches into nested objects and arrays', () => {
    const out = redact({
      providers: [
        { name: 'openai', apiKey: KEY },
        { name: 'ollama', apiKey: '' },
      ],
    }) as { providers: Array<Record<string, unknown>> };
    expect(JSON.stringify(out)).not.toContain(KEY);
    expect(out.providers[0]?.['name']).toBe('openai');
  });

  it('does not mutate its argument', () => {
    const original = { openaiApiKey: KEY };
    redact(original);
    expect(original.openaiApiKey).toBe(KEY);
  });

  it('passes null and undefined through', () => {
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
  });
});
