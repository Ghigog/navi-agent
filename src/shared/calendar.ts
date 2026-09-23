/**
 * The commitment cache (NAV-117): what counts as a commitment, and the arithmetic around it.
 *
 * NAV-108's other half. Given a working connection, this file decides which raw Google Calendar
 * events are commitments at all, keeps a bounded 24-hour local picture of them, and exposes the
 * one number NAV-110 actually needs — time available before the next one — as a pure function.
 * That last part is deliberate: NAV-110 hands this number to a model, and the model must never be
 * the one computing it.
 *
 * Pure, like `notes.ts` and `memory.ts`. `main/calendar-sync.ts` drives it against the network and
 * a clock; `main/calendar-cache-store.ts` persists it, its own file per this section's storage
 * decision — commitments are neither inferred (memory, consolidated and decayed) nor the user's
 * own words (notes, never pruned).
 */

/** Default buffer before an event with no location. */
export const DEFAULT_BUFFER_MINUTES = 10;
/** Default buffer before an event that has one — more warning to actually get there. */
export const LOCATION_BUFFER_MINUTES = 15;

/** How far ahead the cache looks. Nothing beyond this is kept. */
export const HORIZON_MS = 24 * 60 * 60 * 1000;

export interface CommitmentEvent {
  id: string;
  title: string;
  /** Epoch ms. */
  start: number;
  end: number;
  location: string | null;
  /** Which calendar (Settings' `selectedCalendars`, T-1) this event was read from. Scopes a full resync to just that calendar's slice of the cache. */
  calendarId: string;
  /** Minutes before start to treat as "should already be leaving". Set per event in Settings (NAV-113); overrides the default/location buffer when present. */
  bufferMinutes?: number;
}

export interface CommitmentCache {
  events: CommitmentEvent[];
  /** Google's incremental sync token, per calendar id (T-1). A calendar with no entry syncs full next time. */
  syncTokens: Readonly<Record<string, string>>;
  /** When this cache was last refreshed, or null before the first sync. */
  syncedAt: number | null;
}

export const EMPTY_CACHE: CommitmentCache = { events: [], syncTokens: {}, syncedAt: null };

/** Google Calendar API's event shape, trimmed to only what this file reads. */
export interface GoogleEvent {
  id: string;
  summary?: string;
  /** 'confirmed' | 'tentative' | 'cancelled'. */
  status?: string;
  /** 'opaque' (busy, the default) | 'transparent' (marked "free"). */
  transparency?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  location?: string;
  attendees?: { self?: boolean; responseStatus?: string }[];
}

function selfDeclined(event: GoogleEvent): boolean {
  return event.attendees?.some((a) => a.self === true && a.responseStatus === 'declined') ?? false;
}

/**
 * Whether a raw event counts as a commitment at all — confirmed, busy, timed. All-day events carry
 * a `date` rather than a `dateTime` and are excluded on that alone, deliberately: a day full of
 * "free" blocks or all-day placeholders is not a day full of commitments.
 */
export function isCommitment(event: GoogleEvent): boolean {
  if (event.status === 'cancelled' || event.status === 'tentative') return false;
  if (event.transparency === 'transparent') return false;
  if (selfDeclined(event)) return false;
  if (event.start?.dateTime === undefined || event.end?.dateTime === undefined) return false;
  return true;
}

function toEpochMs(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Converts a raw event already known to pass `isCommitment` into the shape the cache stores. */
export function toCommitmentEvent(event: GoogleEvent, calendarId: string, bufferOverrideMinutes?: number): CommitmentEvent | null {
  const start = toEpochMs(event.start?.dateTime ?? '');
  const end = toEpochMs(event.end?.dateTime ?? '');
  if (start === null || end === null) return null;
  return {
    id: event.id,
    title: event.summary ?? '(untitled)',
    start,
    end,
    location: event.location?.trim() || null,
    calendarId,
    ...(bufferOverrideMinutes === undefined ? {} : { bufferMinutes: bufferOverrideMinutes }),
  };
}

/**
 * The buffer to apply before this event: its own override, else the location default, else
 * `defaultMinutes` — Settings' `defaultBufferMinutes` (T-1), read fresh by every caller so a
 * change takes effect without a restart. Callers that predate that setting get the same
 * `DEFAULT_BUFFER_MINUTES` this always used.
 */
export function bufferMinutesFor(event: CommitmentEvent, defaultMinutes: number = DEFAULT_BUFFER_MINUTES): number {
  if (event.bufferMinutes !== undefined) return event.bufferMinutes;
  return event.location !== null ? LOCATION_BUFFER_MINUTES : defaultMinutes;
}

/** When the user needs to leave for this event, as an epoch ms. */
export function leaveByTime(event: CommitmentEvent, defaultMinutes: number = DEFAULT_BUFFER_MINUTES): number {
  return event.start - bufferMinutesFor(event, defaultMinutes) * 60_000;
}

/** The soonest commitment that has not yet ended, or null if there is none. */
export function nextCommitment(cache: CommitmentCache, now: number): CommitmentEvent | null {
  const upcoming = cache.events.filter((e) => e.end > now).sort((a, b) => a.start - b.start);
  return upcoming[0] ?? null;
}

/**
 * Minutes until the user needs to leave for the next commitment, or null if none is coming within
 * the cache's horizon. Negative once the buffer window has already started.
 *
 * This is the number NAV-110 is handed. It is computed here, once, so nothing downstream — least
 * of all a model — is ever asked to do the arithmetic itself.
 */
export function minutesUntilLeaveBy(cache: CommitmentCache, now: number, defaultMinutes: number = DEFAULT_BUFFER_MINUTES): number | null {
  const next = nextCommitment(cache, now);
  if (next === null) return null;
  return (leaveByTime(next, defaultMinutes) - now) / 60_000;
}

/**
 * One incremental (or full) page of events from one calendar, folded into the cache.
 *
 * A `status: 'cancelled'` event, or one that no longer passes `isCommitment` (declined after being
 * accepted, marked tentative, whatever), removes that id from the cache rather than being dropped
 * silently — that is what an incremental sync page actually means. Anything outside the 24-hour
 * horizon from `now` is pruned every sync, since the horizon itself moves.
 *
 * `calendarId` (T-1) is only used to record which calendar's sync token this page advances —
 * `main/calendar-sync.ts` is what decides whether a page is a full or incremental one for that
 * calendar, and strips that calendar's stale slice first with `stripCalendar` when it is full, the
 * same way this used to start from `EMPTY_CACHE` for an expired token when there was only ever one
 * calendar to sync.
 */
export function applySync(
  cache: CommitmentCache,
  calendarId: string,
  page: { events: readonly GoogleEvent[]; nextSyncToken: string },
  now: number,
  bufferOverrides: Readonly<Record<string, number>> = {},
): CommitmentCache {
  const byId = new Map(cache.events.map((e) => [e.id, e]));

  for (const raw of page.events) {
    if (!isCommitment(raw)) {
      byId.delete(raw.id);
      continue;
    }
    const parsed = toCommitmentEvent(raw, calendarId, bufferOverrides[raw.id]);
    if (parsed === null) {
      byId.delete(raw.id);
      continue;
    }
    byId.set(raw.id, parsed);
  }

  const horizon = now + HORIZON_MS;
  const events = [...byId.values()]
    .filter((e) => e.end > now && e.start < horizon)
    .sort((a, b) => a.start - b.start);

  return { events, syncTokens: { ...cache.syncTokens, [calendarId]: page.nextSyncToken }, syncedAt: now };
}

/** Drops one calendar's events from the cache, leaving every other calendar's untouched. */
export function stripCalendar(cache: CommitmentCache, calendarId: string): CommitmentCache {
  return { ...cache, events: cache.events.filter((e) => e.calendarId !== calendarId) };
}

/**
 * Parses Settings' `eventBufferOverrides` (T-1): a comma-separated list of `eventId=minutes`
 * pairs, the same free-text shape `allowedApps` already uses for a list a person types by hand.
 * A pair that does not parse is dropped rather than failing the whole list — one bad entry should
 * cost itself, not every override around it.
 */
export function parseBufferOverrides(raw: string): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const pair of raw.split(',')) {
    const [id, minutes] = pair.split('=').map((part) => part.trim());
    if (!id || minutes === undefined || minutes === '') continue;
    const n = Number(minutes);
    if (Number.isFinite(n)) out[id] = n;
  }
  return out;
}

/** Same rule as every other store: a shape that no longer matches degrades to empty, never propagates. */
export function coerceCache(stored: unknown): CommitmentCache {
  if (stored === null || typeof stored !== 'object') return EMPTY_CACHE;
  const raw = stored as { events?: unknown; syncTokens?: unknown; syncedAt?: unknown };
  if (!Array.isArray(raw.events)) return EMPTY_CACHE;

  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

  const events = raw.events
    .map((e) => e as Partial<CommitmentEvent>)
    .filter((e) => typeof e.id === 'string' && typeof e.calendarId === 'string' && num(e.start) !== undefined && num(e.end) !== undefined)
    .map(
      (e): CommitmentEvent => ({
        id: str(e.id),
        title: str(e.title) || '(untitled)',
        start: num(e.start)!,
        end: num(e.end)!,
        location: typeof e.location === 'string' ? e.location : null,
        calendarId: str(e.calendarId),
        ...(num(e.bufferMinutes) === undefined ? {} : { bufferMinutes: num(e.bufferMinutes)! }),
      }),
    );

  const syncTokens: Record<string, string> = {};
  if (raw.syncTokens !== null && typeof raw.syncTokens === 'object' && !Array.isArray(raw.syncTokens)) {
    for (const [k, v] of Object.entries(raw.syncTokens as Record<string, unknown>)) {
      if (typeof v === 'string') syncTokens[k] = v;
    }
  }

  return {
    events,
    syncTokens,
    syncedAt: num(raw.syncedAt) ?? null,
  };
}
