import { describe, expect, it, vi } from 'vitest';
import {
  createCalendarConnection,
  type CalendarTokenStore,
  type CalendarTokens,
} from '../src/main/calendar-connection.js';

/** An in-memory token store, standing in for calendar-store.ts's safeStorage-backed one. */
function fakeTokenStore(initial: CalendarTokens | null = null): CalendarTokenStore {
  let stored = initial;
  return {
    load: () => stored,
    save: (t) => {
      stored = t;
    },
    clear: () => {
      stored = null;
    },
  };
}

interface Harness {
  capturedUrl: string | null;
  redirectQuery: URLSearchParams;
  connect: ReturnType<typeof createCalendarConnection>['connect'];
  disconnect: ReturnType<typeof createCalendarConnection>['disconnect'];
  status: ReturnType<typeof createCalendarConnection>['status'];
  ensureAccessToken: ReturnType<typeof createCalendarConnection>['ensureAccessToken'];
  exchangeToken: ReturnType<typeof vi.fn>;
  readOneEvent: ReturnType<typeof vi.fn>;
  revokeToken: ReturnType<typeof vi.fn>;
  tokenStore: CalendarTokenStore;
}

/**
 * Builds a connection with every network and browser edge faked, so a whole flow can run
 * synchronously under test. `redirectQuery` is read fresh by `listen` each time — a test can
 * mutate it before calling `connect()` to control what the loopback "receives".
 */
function harness(opts: {
  tokenStore?: CalendarTokenStore;
  now?: () => number;
  exchangeOk?: boolean;
  exchangeBody?: Record<string, unknown>;
  readOneEventOk?: boolean;
  redirectError?: string;
}): Harness {
  let capturedUrl: string | null = null;
  const state = { value: '' };
  const redirectQuery = new URLSearchParams();
  if (opts.redirectError !== undefined) redirectQuery.set('error', opts.redirectError);
  else redirectQuery.set('code', 'auth-code-1');

  const exchangeToken = vi.fn(async () => ({
    ok: opts.exchangeOk ?? true,
    body: opts.exchangeBody ?? { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 },
  }));
  const readOneEvent = vi.fn(async () => opts.readOneEventOk ?? true);
  const revokeToken = vi.fn(async () => undefined);
  const tokenStore = opts.tokenStore ?? fakeTokenStore();

  const conn = createCalendarConnection({
    clientId: 'client-123',
    clientSecret: 'secret-456',
    port: 53682,
    tokenStore,
    ...(opts.now ? { now: opts.now } : {}),
    openUrl: (url) => {
      capturedUrl = url;
    },
    listen: (_port, onRedirect) => {
      queueMicrotask(() => {
        // The real state Google would echo back is whatever the connection put in the auth URL
        // it just opened — captured here rather than guessed, so a state-mismatch bug would show
        // up as a failing test rather than being masked by the harness itself agreeing with it.
        const url = new URL(capturedUrl!);
        state.value = url.searchParams.get('state')!;
        if (!redirectQuery.has('state')) redirectQuery.set('state', state.value);
        onRedirect(redirectQuery);
      });
      return { close: () => undefined };
    },
    exchangeToken,
    readOneEvent,
    revokeToken,
  });

  return {
    get capturedUrl() {
      return capturedUrl;
    },
    redirectQuery,
    connect: conn.connect,
    disconnect: conn.disconnect,
    status: conn.status,
    ensureAccessToken: conn.ensureAccessToken,
    exchangeToken,
    readOneEvent,
    revokeToken,
    tokenStore,
  };
}

describe('connect', () => {
  it('ends connected once the exchange succeeds and one event reads back', async () => {
    const h = harness({ now: () => 0 });
    expect(await h.connect()).toEqual({ state: 'connected' });
    expect(h.tokenStore.load()).toEqual({ refreshToken: 'refresh-1', accessToken: 'access-1', expiresAt: 3_600_000 });
  });

  it('opens an auth URL carrying a non-empty state', async () => {
    const h = harness({});
    await h.connect();
    expect(h.capturedUrl).not.toBeNull();
    expect(new URL(h.capturedUrl!).searchParams.get('state')).not.toBe('');
  });

  it('does not save anything if the code exchange fails', async () => {
    const h = harness({ exchangeOk: false, exchangeBody: { error: 'server_error' } });
    expect(await h.connect()).toEqual({ state: 'disconnected' });
    expect(h.tokenStore.load()).toBeNull();
  });

  it('does not save anything if the proof-of-life read fails', async () => {
    const h = harness({ readOneEventOk: false });
    expect(await h.connect()).toEqual({ state: 'disconnected' });
    expect(h.tokenStore.load()).toBeNull();
  });

  it('reports a declined consent screen as disconnected, without attempting an exchange', async () => {
    const h = harness({ redirectError: 'access_denied' });
    expect(await h.connect()).toEqual({ state: 'disconnected' });
    expect(h.exchangeToken).not.toHaveBeenCalled();
  });

  it('names a Workspace admin block from the redirect specifically', async () => {
    const h = harness({ redirectError: 'admin_policy_enforced' });
    expect(await h.connect()).toEqual({ state: 'admin-blocked' });
    expect(h.exchangeToken).not.toHaveBeenCalled();
  });

  it('names a Workspace admin block surfaced at the token endpoint too', async () => {
    const h = harness({ exchangeOk: false, exchangeBody: { error: 'admin_policy_enforced' } });
    expect(await h.connect()).toEqual({ state: 'admin-blocked' });
  });

  it('does nothing when the OAuth client is not configured', async () => {
    const conn = createCalendarConnection({
      clientId: '',
      clientSecret: '',
      port: 53682,
      tokenStore: fakeTokenStore(),
      openUrl: () => {
        throw new Error('must not open a browser with no client configured');
      },
    });
    expect(await conn.connect()).toEqual({ state: 'disconnected' });
  });
});

describe('ensureAccessToken', () => {
  it('returns the cached access token without a network call while it is still fresh', async () => {
    const h = harness({
      tokenStore: fakeTokenStore({ refreshToken: 'r', accessToken: 'still-good', expiresAt: 1_000_000 }),
      now: () => 0,
    });
    expect(await h.ensureAccessToken()).toBe('still-good');
    expect(h.exchangeToken).not.toHaveBeenCalled();
  });

  it('refreshes transparently once the access token has expired', async () => {
    const h = harness({
      tokenStore: fakeTokenStore({ refreshToken: 'r', accessToken: 'stale', expiresAt: 100 }),
      now: () => 1_000_000,
      exchangeBody: { access_token: 'fresh', expires_in: 3600 },
    });
    expect(await h.ensureAccessToken()).toBe('fresh');
    expect(h.tokenStore.load()).toEqual({ refreshToken: 'r', accessToken: 'fresh', expiresAt: 1_000_000 + 3_600_000 });
  });

  it('is null with nothing connected, and never calls the network', async () => {
    const h = harness({ tokenStore: fakeTokenStore(null) });
    expect(await h.ensureAccessToken()).toBeNull();
    expect(h.exchangeToken).not.toHaveBeenCalled();
  });

  it('surfaces a revoked grant as reconnect-required and clears the dead token, not silence', async () => {
    const h = harness({
      tokenStore: fakeTokenStore({ refreshToken: 'r', accessToken: 'stale', expiresAt: 100 }),
      now: () => 1_000_000,
      exchangeOk: false,
      exchangeBody: { error: 'invalid_grant' },
    });
    expect(await h.ensureAccessToken()).toBeNull();
    expect(h.status()).toEqual({ state: 'reconnect-required' });
    expect(h.tokenStore.load()).toBeNull();
  });

  it('surfaces an admin block without discarding the token a lifted block would still use', async () => {
    const h = harness({
      tokenStore: fakeTokenStore({ refreshToken: 'r', accessToken: 'stale', expiresAt: 100 }),
      now: () => 1_000_000,
      exchangeOk: false,
      exchangeBody: { error: 'admin_policy_enforced' },
    });
    expect(await h.ensureAccessToken()).toBeNull();
    expect(h.status()).toEqual({ state: 'admin-blocked' });
    expect(h.tokenStore.load()).not.toBeNull();
  });
});

describe('disconnect', () => {
  it('revokes the token and clears the store', async () => {
    const h = harness({ tokenStore: fakeTokenStore({ refreshToken: 'r', accessToken: 'a', expiresAt: 999 }) });
    await h.disconnect();
    expect(h.revokeToken).toHaveBeenCalledWith('r');
    expect(h.tokenStore.load()).toBeNull();
    expect(h.status()).toEqual({ state: 'disconnected' });
  });

  it('is a harmless no-op with nothing connected', async () => {
    const h = harness({ tokenStore: fakeTokenStore(null) });
    await h.disconnect();
    expect(h.revokeToken).not.toHaveBeenCalled();
    expect(h.tokenStore.load()).toBeNull();
  });

  it('clears a reconnect-required or admin-blocked status too', async () => {
    const h = harness({
      tokenStore: fakeTokenStore({ refreshToken: 'r', accessToken: 'stale', expiresAt: 100 }),
      now: () => 1_000_000,
      exchangeOk: false,
      exchangeBody: { error: 'invalid_grant' },
    });
    await h.ensureAccessToken();
    expect(h.status()).toEqual({ state: 'reconnect-required' });
    await h.disconnect();
    expect(h.status()).toEqual({ state: 'disconnected' });
  });
});
