/**
 * The math behind connecting a Google Calendar (NAV-108): PKCE, the auth URL, and reading what
 * Google's redirect or its token endpoint is actually telling us.
 *
 * Import-free like the rest of `shared/`, using the global Web Crypto API
 * (`crypto.getRandomValues`, `crypto.subtle`) rather than `node:crypto` so this stays usable from
 * a browser context the way every other file here is — Electron's main process and a modern
 * renderer both have it on `globalThis` with nothing to import.
 */

/** Read-only, the narrowest scope that reads events. Never ask for write access. */
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

/** How early to refresh before an access token's stated expiry actually arrives. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * Errors Google reports, from either the consent redirect or the token endpoint, that mean a
 * Workspace admin has blocked third-party OAuth for this account — not a network problem, not a
 * declined consent screen, a deliberate org-wide policy. The requirement is to name this
 * specifically rather than show the generic "connection failed" a dropped request would.
 */
const ADMIN_BLOCKED_ERRORS = new Set(['admin_policy_enforced', 'unauthorized_client', 'org_internal']);

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(): string {
  // 32 bytes lands well inside PKCE's required 43-128 character verifier length once encoded.
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export interface PkceChallenge {
  verifier: string;
  challenge: string;
}

/** A fresh verifier and its S256 challenge. A new pair every connection attempt, never reused. */
export async function generatePkce(): Promise<PkceChallenge> {
  const verifier = randomToken();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

/** An unguessable value round-tripped through the redirect, so a stray callback can't be trusted. */
export function generateState(): string {
  return randomToken();
}

export interface AuthUrlParams {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}

export function buildAuthUrl(params: AuthUrlParams): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', CALENDAR_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('code_challenge', params.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', params.state);
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

export type RedirectResult =
  | { ok: true; code: string }
  | { ok: false; reason: 'declined' | 'admin-blocked' | 'state-mismatch' | 'malformed'; detail: string };

/**
 * What the loopback server actually received. State is checked before the code is trusted at
 * all — a callback carrying the right shape but the wrong state is not this connection attempt's.
 */
export function parseRedirect(query: URLSearchParams, expectedState: string): RedirectResult {
  const error = query.get('error');
  if (error !== null) {
    if (ADMIN_BLOCKED_ERRORS.has(error)) return { ok: false, reason: 'admin-blocked', detail: error };
    if (error === 'access_denied') return { ok: false, reason: 'declined', detail: error };
    return { ok: false, reason: 'malformed', detail: error };
  }

  const state = query.get('state');
  if (state !== expectedState) return { ok: false, reason: 'state-mismatch', detail: state ?? '(missing)' };

  const code = query.get('code');
  if (code === null || code === '') {
    return { ok: false, reason: 'malformed', detail: 'redirect carried neither a code nor an error' };
  }

  return { ok: true, code };
}

export interface TokenErrorBody {
  error?: unknown;
}

export type TokenFailure = 'revoked' | 'admin-blocked' | 'other';

/**
 * Why a token exchange or refresh failed. `invalid_grant` is Google's shape for "this refresh
 * token no longer works" — expired, revoked from the user's Google Account page, or a scope that
 * changed — and every one of those needs the same answer: reconnect, not a silent stop.
 */
export function classifyTokenError(body: TokenErrorBody): TokenFailure {
  const error = typeof body.error === 'string' ? body.error : '';
  if (error === 'invalid_grant') return 'revoked';
  if (ADMIN_BLOCKED_ERRORS.has(error)) return 'admin-blocked';
  return 'other';
}

/** True once `expiresAt` is close enough that a call started now would land after it. */
export function isExpired(expiresAt: number, now: number): boolean {
  return now >= expiresAt - EXPIRY_SKEW_MS;
}

export type CalendarStatus =
  | { state: 'disconnected' }
  | { state: 'connected' }
  | { state: 'reconnect-required' }
  | { state: 'admin-blocked' };

/** The line a future settings panel shows for a status that needs the user to do something. Null for the two that don't. */
export function statusMessage(status: CalendarStatus): string | null {
  if (status.state === 'reconnect-required') {
    return 'Navi lost access to your Google Calendar. Reconnect it in Settings.';
  }
  if (status.state === 'admin-blocked') {
    return 'Your Google Workspace admin has blocked third-party calendar access for this account.';
  }
  return null;
}
