#!/usr/bin/env node
// Proves the OAuth shape NAV-108 will build for real: PKCE, a loopback redirect, one event read.
// Throwaway — no token storage, no refresh, no error taxonomy. NAV-108 owns all of that; this
// only answers "does the flow work at all" before a session is spent building it properly.
//
// Needs a Google Cloud project with the Calendar API enabled and an OAuth client of type
// "Desktop app" (installed-app flow — the client id is not a secret for this client type, but
// see README.md for why it still doesn't belong hardcoded here). Set:
//
//   GOOGLE_CLIENT_ID=...      node spike/nav-107/oauth.mjs
//   GOOGLE_CLIENT_SECRET=...  (Google's console still issues one for Desktop clients; PKCE is
//                              what actually protects the exchange, but the field is required)
//
// This opens no browser automatically — it prints a URL. Visit it, approve, and the loopback
// server below catches the redirect.

import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function waitForRedirect(port) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      res.setHeader('Content-Type', 'text/plain');
      res.end(error ? `Denied: ${error}. Close this tab.` : 'Connected. Close this tab.');
      server.close();

      if (error) reject(new Error(error));
      else if (code) resolve(code);
      else reject(new Error('Redirect carried neither a code nor an error.'));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error(
      'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first — see the comment at the top of this ' +
        'file for how to get them. There is no way to prove an OAuth flow without an OAuth client.',
    );
    process.exitCode = 1;
    return;
  }

  const port = 53682; // arbitrary fixed local port for this throwaway script only
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(16));

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPE);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('prompt', 'consent');

  console.log('Visit this URL and approve access:\n');
  console.log(authUrl.toString());
  console.log(`\nWaiting on ${redirectUri} ...`);

  const code = await waitForRedirect(port);

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    console.error(`Token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
    process.exitCode = 1;
    return;
  }

  const tokens = await tokenRes.json();
  console.log('\nToken exchange succeeded. (Not printing the token itself.)');

  const now = new Date().toISOString();
  const eventsUrl = new URL(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
  );
  eventsUrl.searchParams.set('timeMin', now);
  eventsUrl.searchParams.set('maxResults', '1');
  eventsUrl.searchParams.set('singleEvents', 'true');
  eventsUrl.searchParams.set('orderBy', 'startTime');

  const eventsRes = await fetch(eventsUrl, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!eventsRes.ok) {
    console.error(`Calendar read failed: ${eventsRes.status} ${await eventsRes.text()}`);
    process.exitCode = 1;
    return;
  }

  const events = await eventsRes.json();
  const next = events.items?.[0];
  console.log(
    next
      ? `\nNext event: "${next.summary ?? '(untitled)'}" at ${next.start?.dateTime ?? next.start?.date}`
      : '\nNo upcoming events found (the flow worked; the calendar is just empty).',
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
