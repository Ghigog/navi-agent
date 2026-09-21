import { describe, expect, it } from 'vitest';
import {
  buildAuthUrl,
  CALENDAR_SCOPE,
  classifyTokenError,
  generatePkce,
  generateState,
  isExpired,
  parseRedirect,
  statusMessage,
} from '../src/shared/calendar-oauth.js';

function base64urlOf(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('generatePkce', () => {
  it('produces a verifier long enough for PKCE and a matching S256 challenge', async () => {
    const { verifier, challenge } = await generatePkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);

    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    expect(challenge).toBe(base64urlOf(new Uint8Array(digest)));
  });

  it('never reuses a verifier across calls', async () => {
    const a = await generatePkce();
    const b = await generatePkce();
    expect(a.verifier).not.toBe(b.verifier);
  });
});

describe('generateState', () => {
  it('differs on every call and carries no padding', () => {
    const a = generateState();
    const b = generateState();
    expect(a).not.toBe(b);
    expect(a).not.toContain('=');
  });
});

describe('buildAuthUrl', () => {
  const url = new URL(
    buildAuthUrl({
      clientId: 'client-123',
      redirectUri: 'http://127.0.0.1:53682/callback',
      challenge: 'chal-abc',
      state: 'state-xyz',
    }),
  );

  it('asks for the read-only scope and nothing else', () => {
    expect(url.searchParams.get('scope')).toBe(CALENDAR_SCOPE);
  });

  it('carries PKCE, not a client secret', () => {
    expect(url.searchParams.get('code_challenge')).toBe('chal-abc');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('asks for offline access, which is what makes a refresh token come back', () => {
    expect(url.searchParams.get('access_type')).toBe('offline');
  });

  it('round-trips the client id, redirect and state', () => {
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:53682/callback');
    expect(url.searchParams.get('state')).toBe('state-xyz');
  });
});

describe('parseRedirect', () => {
  const state = 'expected-state';

  it('reads the code when the state matches', () => {
    const result = parseRedirect(new URLSearchParams({ code: 'auth-code', state }), state);
    expect(result).toEqual({ ok: true, code: 'auth-code' });
  });

  it('rejects a callback carrying the wrong state, even with a code attached', () => {
    // The security property this exists for: a stray or forged callback must not be trusted
    // just because it happens to carry something that looks like a code.
    const result = parseRedirect(new URLSearchParams({ code: 'auth-code', state: 'someone-elses' }), state);
    expect(result).toEqual({ ok: false, reason: 'state-mismatch', detail: 'someone-elses' });
  });

  it('reports a declined consent screen', () => {
    const result = parseRedirect(new URLSearchParams({ error: 'access_denied', state }), state);
    expect(result).toEqual({ ok: false, reason: 'declined', detail: 'access_denied' });
  });

  it('names a Workspace admin block specifically, not as a generic failure', () => {
    const result = parseRedirect(new URLSearchParams({ error: 'admin_policy_enforced', state }), state);
    expect(result).toEqual({ ok: false, reason: 'admin-blocked', detail: 'admin_policy_enforced' });
  });

  it('treats neither a code nor an error as malformed', () => {
    const result = parseRedirect(new URLSearchParams({ state }), state);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('malformed');
  });
});

describe('classifyTokenError', () => {
  it('reads invalid_grant as a revoked grant', () => {
    expect(classifyTokenError({ error: 'invalid_grant' })).toBe('revoked');
  });

  it('reads an admin-policy error as an admin block', () => {
    expect(classifyTokenError({ error: 'admin_policy_enforced' })).toBe('admin-blocked');
    expect(classifyTokenError({ error: 'unauthorized_client' })).toBe('admin-blocked');
  });

  it('falls back to other for anything unrecognised, including a missing field', () => {
    expect(classifyTokenError({ error: 'server_error' })).toBe('other');
    expect(classifyTokenError({})).toBe('other');
  });
});

describe('isExpired', () => {
  it('is false well before expiry', () => {
    expect(isExpired(1_000_000, 0)).toBe(false);
  });

  it('is true inside the refresh skew window, before the stated expiry', () => {
    expect(isExpired(100_000, 99_990)).toBe(true);
  });

  it('is true once past the stated expiry', () => {
    expect(isExpired(100_000, 200_000)).toBe(true);
  });
});

describe('statusMessage', () => {
  it('has nothing to say for a healthy or absent connection', () => {
    expect(statusMessage({ state: 'connected' })).toBeNull();
    expect(statusMessage({ state: 'disconnected' })).toBeNull();
  });

  it('names a revoked grant as something to reconnect, not silence', () => {
    expect(statusMessage({ state: 'reconnect-required' })).toMatch(/reconnect/i);
  });

  it('names an admin block specifically', () => {
    expect(statusMessage({ state: 'admin-blocked' })).toMatch(/admin/i);
  });
});
