/**
 * The interruption gate (NAV-110), the half of section 5's decision engine that is code and not
 * a model.
 *
 * **Whether she may speak at all is decided here. Whether there is anything worth saying is
 * NAV-111's, and the two must never be the same decision** — a model asked to police its own
 * interruption frequency drifts, and every drift costs trust that is slow to earn back. Closest
 * existing relative is `policy.ts`: pure, deny-by-default, and not something a caller can argue
 * with.
 *
 * Silent by default is the point, not a fallback: `mayInterrupt` returns false for everything
 * until a caller supplies a reason it should not, because off is a decision the user makes
 * (NAV-97) and a companion who talks first without being invited has taken a decision that was
 * theirs.
 *
 * Pure and synchronous — no I/O, no model, no Electron import — so a test can fake the clock and
 * fire this fifty times in a millisecond, the way `policy.ts` and `leave-by.ts` already do.
 */

import { DEFAULT_BUFFER_MINUTES, minutesUntilLeaveBy, nextCommitment, type CommitmentCache } from './calendar.js';
import type { Settings } from './settings.js';

// ---------------------------------------------------------------------------
// Budget state
// ---------------------------------------------------------------------------

export interface InterruptionState {
  /** Local calendar day the counters below belong to (`Date#toDateString`). Rolls over on read. */
  day: string;
  /** Remarks made today, against the daily cap. */
  remarksToday: number;
  /** When the last remark was made, of any day — the minimum-gap clock. */
  lastRemarkAt: number | null;
  /** Subjects already raised today. Raising one closes it; the response does not reopen it. */
  closedSubjects: readonly string[];
  /**
   * Consecutive remarks that were ignored or dismissed rather than engaged with. Widens the
   * minimum gap; an acknowledged remark resets it. Not reset by the day rolling over — a run of
   * ignored remarks says something about the last few, not about the calendar.
   */
  missedStreak: number;
}

export const INITIAL_INTERRUPTION_STATE: InterruptionState = {
  day: '',
  remarksToday: 0,
  lastRemarkAt: null,
  closedSubjects: [],
  missedStreak: 0,
};

/** A small number, on purpose: this is a companion who occasionally notices something, not a feed. */
export const DAILY_CAP = 3;

/** The floor between two remarks with no backoff in effect. */
export const MIN_GAP_MS = 45 * 60_000;

/** Added to the floor per remark in the current ignored/dismissed streak. */
export const BACKOFF_STEP_MS = 30 * 60_000;

/** Caps the streak's effect so backoff does not silence her for the rest of the week. */
export const MAX_BACKOFF_STREAK = 6;

function dayKey(now: number): string {
  return new Date(now).toDateString();
}

/** Rolls the daily counters over when `now` falls on a different day than the state was last touched. */
function rolledToday(state: InterruptionState, now: number): InterruptionState {
  const key = dayKey(now);
  if (state.day === key) return state;
  return { ...state, day: key, remarksToday: 0, closedSubjects: [] };
}

/** The minimum gap currently in force, given the ignored/dismissed streak. */
export function currentMinGapMs(state: InterruptionState): number {
  return MIN_GAP_MS + Math.min(state.missedStreak, MAX_BACKOFF_STREAK) * BACKOFF_STEP_MS;
}

// ---------------------------------------------------------------------------
// Quiet hours
// ---------------------------------------------------------------------------

export interface QuietHours {
  /** Minutes since local midnight, inclusive. */
  startMinute: number;
  /** Minutes since local midnight, exclusive. Less than `startMinute` means the window wraps past midnight. */
  endMinute: number;
}

/**
 * Quiet hours straight from Settings (NAV-113), read fresh on every call rather than cached
 * anywhere — a change made in the settings window has to reach `mayInterrupt` without a restart.
 */
export function quietHoursFrom(settings: Pick<Settings, 'quietHoursStart' | 'quietHoursEnd'>): QuietHours {
  return { startMinute: settings.quietHoursStart, endMinute: settings.quietHoursEnd };
}

/** Quiet hours suppress everything, with no override — not even for the model. There is no such thing as an urgent nudge here. */
export function inQuietHours(quiet: QuietHours | null, now: number): boolean {
  if (quiet === null || quiet.startMinute === quiet.endMinute) return false;
  const d = new Date(now);
  const minute = d.getHours() * 60 + d.getMinutes();
  const { startMinute, endMinute } = quiet;
  if (startMinute < endMinute) return minute >= startMinute && minute < endMinute;
  return minute >= startMinute || minute < endMinute; // wraps past midnight
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export interface GateInput {
  state: InterruptionState;
  now: number;
  /** NAV-109's pre-filter: the foreground application (or similar) changed since it was last checked. */
  changed: boolean;
  /** What changed is one worth thinking about at all — a hint, not a rule that decides anything on its own. */
  relevant: boolean;
  /** Identifies what a remark would be about (e.g. the app, or the commitment id), for the "never twice" rule. */
  subject: string;
  quietHours: QuietHours | null;
  /**
   * NAV-115's permanent suppression, already resolved by the caller (`isMuted` against the
   * outcome log) — this file stays pure and never reads that store itself. Checked ahead of the
   * daily cap and the minimum gap: a mute is not a backoff that eventually lifts, it is "never",
   * until the user removes it.
   */
  muted: boolean;
}

export interface GateDecision {
  /** Whether NAV-111's judgement call may even be made. Everything upstream of the model reads this and stops here if it is false. */
  mayAsk: boolean;
  /** Why, in a sentence — for the transparency panel (NAV-118), not for parsing. */
  reason: string;
}

export function mayInterrupt(input: GateInput): GateDecision {
  const state = rolledToday(input.state, input.now);

  if (inQuietHours(input.quietHours, input.now)) {
    return { mayAsk: false, reason: 'Quiet hours.' };
  }
  if (!input.changed) {
    return { mayAsk: false, reason: 'Nothing changed.' };
  }
  if (!input.relevant) {
    return { mayAsk: false, reason: 'What changed is not relevant.' };
  }
  if (input.muted) {
    return { mayAsk: false, reason: 'Muted.' };
  }
  if (state.closedSubjects.includes(input.subject)) {
    return { mayAsk: false, reason: 'Already raised today.' };
  }
  if (state.remarksToday >= DAILY_CAP) {
    return { mayAsk: false, reason: 'Daily cap reached.' };
  }
  if (state.lastRemarkAt !== null && input.now - state.lastRemarkAt < currentMinGapMs(state)) {
    return { mayAsk: false, reason: 'Too soon since the last remark.' };
  }

  return { mayAsk: true, reason: 'Eligible.' };
}

// ---------------------------------------------------------------------------
// Recording what happened
// ---------------------------------------------------------------------------

/** Called once NAV-111 actually says something. Closes the subject for the day and starts the minimum gap. */
export function remarkMade(state: InterruptionState, now: number, subject: string): InterruptionState {
  const rolled = rolledToday(state, now);
  return {
    ...rolled,
    remarksToday: rolled.remarksToday + 1,
    lastRemarkAt: now,
    closedSubjects: [...rolled.closedSubjects, subject],
  };
}

/**
 * How the user responded to a remark once made. `acknowledged` covers both agreeing and
 * overriding — either way she was heard, which is what resets the backoff; `ignored` (NAV-112's
 * bubble collapsing unanswered) and `dismissed` (an explicit close) both widen it. The subject is
 * closed for the day regardless — that happened already, at `remarkMade`.
 */
export type RemarkResponse = 'acknowledged' | 'ignored' | 'dismissed';

export function remarkResponded(state: InterruptionState, response: RemarkResponse): InterruptionState {
  return { ...state, missedStreak: response === 'acknowledged' ? 0 : state.missedStreak + 1 };
}

// ---------------------------------------------------------------------------
// The facts NAV-111 is handed
// ---------------------------------------------------------------------------

/**
 * What NAV-111 is allowed to know about the calendar, computed here so the model is never the
 * thing subtracting a start time from a clock — the same reasoning as `calendar.ts`'s own
 * `minutesUntilLeaveBy`, which this simply carries forward into one bundle.
 */
export interface Facts {
  now: number;
  /** Minutes until the user should leave for the next commitment, or null if none is coming. Negative once that moment has passed. */
  minutesUntilLeaveBy: number | null;
  /** The commitment itself, named and timed, so NAV-111 can refer to it without recomputing anything. Null if none is coming. */
  commitment: { title: string; start: number } | null;
}

export function factsFor(cache: CommitmentCache, now: number, defaultBufferMinutes: number = DEFAULT_BUFFER_MINUTES): Facts {
  const next = nextCommitment(cache, now);
  return {
    now,
    minutesUntilLeaveBy: minutesUntilLeaveBy(cache, now, defaultBufferMinutes),
    commitment: next === null ? null : { title: next.title, start: next.start },
  };
}
