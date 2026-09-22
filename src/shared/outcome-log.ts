/**
 * The outcome log (NAV-115).
 *
 * **The PRD's learning half is cut** — blending a p90 out of three sessions is the maximum of
 * three numbers wearing a statistical hat, not a model. What survives is the log itself, because
 * the controls the user actually needs — mute this, stop raising that — have to remember
 * something, and that is this file's whole job.
 *
 * Two different things share one store and must not be confused. `entries` is a bounded history,
 * the same shape `policy.ts#MAX_AUDIT_ENTRIES` already tests for — trimming the oldest one costs
 * nothing NAV-110 depends on. `mutedSubjects` and `mutedActivities` are the opposite: never
 * bounded, never dropped on their own, because a mute is a standing instruction, not a fact that
 * ages out. `main/outcome-log-store.ts` persists both to disk for the same reason
 * `main/notes-store.ts` does — a mute set and then lost on restart is a promise broken silently.
 *
 * `subject` and `activity` are the two identifiers `shared/interruption.ts#GateInput` already
 * distinguishes: `subject` is `event.app.bundleId` today, the precise thing "never twice" already
 * keys on, and the bubble's own "Stop bringing this up" button mutes at this level. `activity` is
 * `event.app.name`, the broader, readable grouping NAV-113 mutes by — the same pair a future
 * calendar-based subject would still fit, since neither is tied to being an app.
 *
 * **"Overridden" in this ticket's acceptance criteria is `dismissed` here.** `interruption.ts`
 * already has a three-way `RemarkResponse` — `acknowledged` | `ignored` | `dismissed` — and
 * inventing a second vocabulary for the same three outcomes would be the kind of duplicate
 * abstraction this codebase avoids elsewhere. This file reuses it rather than adding one.
 *
 * Pure. No clock is read in here — every function takes `at` from its caller, the same discipline
 * `interruption.ts` and `policy.ts` already hold to.
 */

import type { RemarkResponse } from './interruption.js';

export interface OutcomeEntry {
  at: number;
  subject: string;
  activity: string;
  remark: string;
  outcome: RemarkResponse;
}

export interface OutcomeLog {
  entries: OutcomeEntry[];
  mutedSubjects: string[];
  mutedActivities: string[];
}

export const EMPTY_OUTCOME_LOG: OutcomeLog = { entries: [], mutedSubjects: [], mutedActivities: [] };

/** Bounded the same way `policy.ts#MAX_AUDIT_ENTRIES` is. The mute lists below are never subject to this. */
export const MAX_OUTCOME_ENTRIES = 500;

export function recordOutcome(log: OutcomeLog, entry: OutcomeEntry): OutcomeLog {
  const entries = [...log.entries, entry];
  return {
    ...log,
    entries: entries.length > MAX_OUTCOME_ENTRIES ? entries.slice(entries.length - MAX_OUTCOME_ENTRIES) : entries,
  };
}

function added(list: readonly string[], value: string): string[] {
  return list.includes(value) ? [...list] : [...list, value];
}

/** "Stop bringing this up" (this ticket's first acceptance criterion): permanent, and only this subject. */
export function muteSubject(log: OutcomeLog, subject: string): OutcomeLog {
  return { ...log, mutedSubjects: added(log.mutedSubjects, subject) };
}

export function unmuteSubject(log: OutcomeLog, subject: string): OutcomeLog {
  return { ...log, mutedSubjects: log.mutedSubjects.filter((s) => s !== subject) };
}

/** The broader mute NAV-113 surfaces. Stops future remarks; `entries` already written are untouched. */
export function muteActivity(log: OutcomeLog, activity: string): OutcomeLog {
  return { ...log, mutedActivities: added(log.mutedActivities, activity) };
}

export function unmuteActivity(log: OutcomeLog, activity: string): OutcomeLog {
  return { ...log, mutedActivities: log.mutedActivities.filter((a) => a !== activity) };
}

/** What `interruption.ts#mayInterrupt` checks before it spends anything else on a decision. */
export function isMuted(log: OutcomeLog, subject: string, activity: string): boolean {
  return log.mutedSubjects.includes(subject) || log.mutedActivities.includes(activity);
}

const OUTCOMES: readonly RemarkResponse[] = ['acknowledged', 'ignored', 'dismissed'];

/** Same rule as every other file that reads a file: degrade, never propagate a shape. */
export function coerceOutcomeLog(stored: unknown): OutcomeLog {
  if (stored === null || typeof stored !== 'object') return { ...EMPTY_OUTCOME_LOG };
  const raw = stored as Partial<Record<keyof OutcomeLog, unknown>>;

  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const strings = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === 'string'))] : []);

  const entries = Array.isArray(raw.entries)
    ? raw.entries
        .map((e) => e as Partial<OutcomeEntry>)
        .filter((e) => typeof e.subject === 'string' && typeof e.outcome === 'string' && OUTCOMES.includes(e.outcome as RemarkResponse))
        .map((e) => ({
          at: num(e.at),
          subject: str(e.subject),
          activity: str(e.activity),
          remark: str(e.remark),
          outcome: e.outcome as RemarkResponse,
        }))
    : [];

  return {
    entries: entries.length > MAX_OUTCOME_ENTRIES ? entries.slice(entries.length - MAX_OUTCOME_ENTRIES) : entries,
    mutedSubjects: strings(raw.mutedSubjects),
    mutedActivities: strings(raw.mutedActivities),
  };
}
