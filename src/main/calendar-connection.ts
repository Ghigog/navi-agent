/**
 * Connecting a Google Calendar (NAV-108).
 *
 * The connection only — reading events on a schedule and deciding which of them count is
 * NAV-117. This is PKCE plus a loopback redirect (the installed-app flow), a refresh that
 * happens without the user noticing, and three failure paths that must not be the same generic
 * "connection failed": a declined consent screen, a revoked grant, and a Workspace admin who
 * blocked third-party OAuth org-wide.
 *
 * No Electron import, the way `reminders.ts` has none: the loopback port, the clock and the
 * token store all arrive as dependencies, so the exchange and every failure path run under test
 * with no network and no browser. `calendar-store.ts` is the real token store, built on
 * `safeStorage`; that file is wiring, and this one is where the actual decisions are.
 */

import { createServer } from 'node:http';
import {
  buildAuthUrl,
  classifyTokenError,
  generatePkce,
  generateState,
  isExpired,
  parseRedirect,
  type CalendarStatus,
  type TokenErrorBody,
} from '../shared/calendar-oauth.js';

export interface CalendarTokens {
  refreshToken: string;
  accessToken: string;
  /** Epoch ms. */
  expiresAt: number;
}

export interface CalendarTokenStore {
  load(): CalendarTokens | null;
  save(tokens: CalendarTokens): void;
  clear(): void;
}

export interface RedirectListener {
  close(): void;
}

interface TokenResponse {
  ok: boolean;
  body: Record<string, unknown>;
}

export interface CalendarConnectionDeps {
  /**
   * NAV-108: a Desktop-app OAuth client ID is meant to ship inside the artifact — Google's own
   * docs say so, because PKCE (not a client secret) is what actually protects this client type's
   * token exchange. That is a deliberate, documented decision, made explicit here so nobody has
   * to work out later whether it repeats NAV-81's mistake (a live key committed by accident). It
   * does not: NAV-81's key worked on its own; this ID is useless to anyone without the user's own
   * consent screen approval, on their own account, completing a loopback exchange on their own
   * machine.
   */
  clientId: string;
  /** Google's console still issues one for Desktop clients even though PKCE is the real protection; the field is required. */
  clientSecret: string;
  port: number;
  tokenStore: CalendarTokenStore;
  openUrl: (url: string) => void;
  now?: () => number;
  listen?: (port: number, onRedirect: (query: URLSearchParams) => void) => RedirectListener;
  exchangeToken?: (body: URLSearchParams) => Promise<TokenResponse>;
  readOneEvent?: (accessToken: string) => Promise<boolean>;
  revokeToken?: (refreshToken: string) => Promise<void>;
}

export interface CalendarConnection {
  connect(): Promise<CalendarStatus>;
  disconnect(): Promise<void>;
  status(): CalendarStatus;
  /** The access token to call the Calendar API with, refreshing first if it has expired. Null means reconnecting is needed. */
  ensureAccessToken(): Promise<string | null>;
}

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const EVENTS_ENDPOINT = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

async function defaultExchangeToken(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, body: json };
}

/** Proof of life, per the acceptance criteria: one event, read, not stored. */
async function defaultReadOneEvent(accessToken: string): Promise<boolean> {
  const url = new URL(EVENTS_ENDPOINT);
  url.searchParams.set('maxResults', '1');
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('timeMin', new Date().toISOString());
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  return res.ok;
}

async function defaultRevokeToken(token: string): Promise<void> {
  // Best-effort: a revoke that Google never sees still has to leave nothing behind locally.
  await fetch(REVOKE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined);
}

function defaultListen(port: number, onRedirect: (query: URLSearchParams) => void): RedirectListener {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    res.setHeader('Content-Type', 'text/plain');
    res.end(url.searchParams.get('error') ? 'Navi could not connect. Close this tab.' : 'Connected. Close this tab.');
    server.close();
    onRedirect(url.searchParams);
  });
  server.once('error', (err) => console.error('calendar: loopback server failed to start:', err));
  server.listen(port, '127.0.0.1');
  return { close: () => server.close() };
}

export function createCalendarConnection(deps: CalendarConnectionDeps): CalendarConnection {
  const now = deps.now ?? (() => Date.now());
  const listen = deps.listen ?? defaultListen;
  const exchangeToken = deps.exchangeToken ?? defaultExchangeToken;
  const readOneEvent = deps.readOneEvent ?? defaultReadOneEvent;
  const revokeToken = deps.revokeToken ?? defaultRevokeToken;
  const redirectUri = `http://127.0.0.1:${deps.port}/callback`;

  /** Set only by a failure that must survive until the user acts — a declined screen is not one of these. */
  let lastFailure: 'reconnect-required' | 'admin-blocked' | null = null;

  const status = (): CalendarStatus => {
    if (lastFailure === 'admin-blocked') return { state: 'admin-blocked' };
    if (lastFailure === 'reconnect-required') return { state: 'reconnect-required' };
    return deps.tokenStore.load() !== null ? { state: 'connected' } : { state: 'disconnected' };
  };

  const refresh = async (tokens: CalendarTokens): Promise<string | null> => {
    const { ok, body } = await exchangeToken(
      new URLSearchParams({
        client_id: deps.clientId,
        client_secret: deps.clientSecret,
        refresh_token: tokens.refreshToken,
        grant_type: 'refresh_token',
      }),
    );

    if (!ok) {
      const failure = classifyTokenError(body as TokenErrorBody);
      if (failure === 'revoked') {
        // A dead refresh token buys nothing by staying on disk — every future call would fail
        // the same way, silently, which is exactly what "surface as a reconnect prompt" forbids.
        lastFailure = 'reconnect-required';
        deps.tokenStore.clear();
      } else if (failure === 'admin-blocked') {
        // Left in place: an admin can lift the block, and the same token works again if they do.
        lastFailure = 'admin-blocked';
      }
      return null;
    }

    const accessToken = body['access_token'];
    const expiresIn = body['expires_in'];
    if (typeof accessToken !== 'string' || typeof expiresIn !== 'number') return null;

    lastFailure = null;
    deps.tokenStore.save({ refreshToken: tokens.refreshToken, accessToken, expiresAt: now() + expiresIn * 1000 });
    return accessToken;
  };

  const ensureAccessToken = async (): Promise<string | null> => {
    const tokens = deps.tokenStore.load();
    if (!tokens) return null;
    if (!isExpired(tokens.expiresAt, now())) return tokens.accessToken;
    return refresh(tokens);
  };

  const connect = async (): Promise<CalendarStatus> => {
    // Not configured: nothing to open, and opening a browser at a blank client id would only
    // confuse whoever clicked "connect".
    if (deps.clientId === '') {
      console.warn('calendar: no OAuth client configured — see calendar-connection.ts');
      return status();
    }

    const pkce = await generatePkce();
    const state = generateState();

    const redirect = await new Promise<URLSearchParams>((resolve) => {
      const listener = listen(deps.port, (query) => {
        listener.close();
        resolve(query);
      });
      deps.openUrl(buildAuthUrl({ clientId: deps.clientId, redirectUri, challenge: pkce.challenge, state }));
    });

    const parsed = parseRedirect(redirect, state);
    if (!parsed.ok) {
      lastFailure = parsed.reason === 'admin-blocked' ? 'admin-blocked' : null;
      return status();
    }

    const { ok, body } = await exchangeToken(
      new URLSearchParams({
        client_id: deps.clientId,
        client_secret: deps.clientSecret,
        code: parsed.code,
        code_verifier: pkce.verifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    );

    if (!ok) {
      lastFailure = classifyTokenError(body as TokenErrorBody) === 'admin-blocked' ? 'admin-blocked' : null;
      return status();
    }

    const accessToken = body['access_token'];
    const refreshToken = body['refresh_token'];
    const expiresIn = body['expires_in'];
    if (typeof accessToken !== 'string' || typeof refreshToken !== 'string' || typeof expiresIn !== 'number') {
      return status();
    }

    // The acceptance criterion is "one event readable as proof of life" — a token that exchanges
    // fine but can't actually read anything is not a working connection.
    if (!(await readOneEvent(accessToken))) return status();

    lastFailure = null;
    deps.tokenStore.save({ refreshToken, accessToken, expiresAt: now() + expiresIn * 1000 });
    return status();
  };

  const disconnect = async (): Promise<void> => {
    const tokens = deps.tokenStore.load();
    if (tokens) await revokeToken(tokens.refreshToken);
    deps.tokenStore.clear();
    lastFailure = null;
  };

  return { connect, disconnect, status, ensureAccessToken };
}
