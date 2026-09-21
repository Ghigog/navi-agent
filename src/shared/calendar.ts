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
  /** Minutes before start to treat as "should already be leaving". Set per event in Settings (NAV-113); overrides the default/location buffer when present. */
  bufferMinutes?: number;
}

export interface CommitmentCache {
  events: CommitmentEvent[];
  /** Google's incremental sync token. Null means the next sync must be a full one. */
  syncToken: string | null;
  /** When this cache was last refreshed, or null before the first sync. */
  syncedAt: number | null;
}

export const EMPTY_CACHE: CommitmentCache = { events: [], syncToken: null, syncedAt: null };

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
export function toCommitmentEvent(event: GoogleEvent, bufferOverrideMinutes?: number): CommitmentEvent | null {
  const start = toEpochMs(event.start?.dateTime ?? '');
  const end = toEpochMs(event.end?.dateTime ?? '');
  if (start === null || end === null) return null;
  return {
    id: event.id,
    title: event.summary ?? '(untitled)',
    start,
    end,
    location: event.location?.trim() || null,
    ...(bufferOverrideMinutes === undefined ? {} : { bufferMinutes: bufferOverrideMinutes }),
  };
}

/** The buffer to apply before this event: its own override, else the location default, else the plain default. */
export function bufferMinutesFor(event: CommitmentEvent): number {
  if (event.bufferMinutes !== undefined) return event.bufferMinutes;
  return event.location !== null ? LOCATION_BUFFER_MINUTES : DEFAULT_BUFFER_MINUTES;
}

/** When the user needs to leave for this event, as an epoch ms. */
export function leaveByTime(event: CommitmentEvent): number {
  return event.start - bufferMinutesFor(event) * 60_000;
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
export function minutesUntilLeaveBy(cache: CommitmentCache, now: number): number | null {
  const next = nextCommitment(cache, now);
  if (next === null) return null;
  return (leaveByTime(next) - now) / 60_000;
}

/**
 * One incremental (or full) page of events from Google, folded into the cache.
 *
 * A `status: 'cancelled'` event, or one that no longer passes `isCommitment` (declined after being
 * accepted, marked tentative, whatever), removes that id from the cache rather than being dropped
 * silently — that is what an incremental sync page actually means. Anything outside the 24-hour
 * horizon from `now` is pruned every sync, since the horizon itself moves.
 */
export function applySync(
  cache: CommitmentCache,
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
    const parsed = toCommitmentEvent(raw, bufferOverrides[raw.id]);
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

  return { events, syncToken: page.nextSyncToken, syncedAt: now };
}

/** Same rule as every other store: a shape that no longer matches degrades to empty, never propagates. */
export function coerceCache(stored: unknown): CommitmentCache {
  if (stored === null || typeof stored !== 'object') return EMPTY_CACHE;
  const raw = stored as { events?: unknown; syncToken?: unknown; syncedAt?: unknown };
  if (!Array.isArray(raw.events)) return EMPTY_CACHE;

  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

  const events = raw.events
    .map((e) => e as Partial<CommitmentEvent>)
    .filter((e) => typeof e.id === 'string' && num(e.start) !== undefined && num(e.end) !== undefined)
    .map(
      (e): CommitmentEvent => ({
        id: str(e.id),
        title: str(e.title) || '(untitled)',
        start: num(e.start)!,
        end: num(e.end)!,
        location: typeof e.location === 'string' ? e.location : null,
        ...(num(e.bufferMinutes) === undefined ? {} : { bufferMinutes: num(e.bufferMinutes)! }),
      }),
    );

  return {
    events,
    syncToken: typeof raw.syncToken === 'string' ? raw.syncToken : null,
    syncedAt: num(raw.syncedAt) ?? null,
  };
}
