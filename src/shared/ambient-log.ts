/**
 * The ambient log (NAV-118): a bounded record of the activity signal and the judgement calls it
 * feeds, kept for the "what Navi sees" panel. **It deliberately keeps the ones that ended in
 * silence** — a system that only shows its interruptions cannot be audited for the thing that
 * actually matters, how often it nearly spoke and did not (backlog.md).
 *
 * In-memory only, the same as `policy.ts`'s audit log and for the same reason: this is not the
 * durable, per-subject record NAV-115 is meant to build, and a caller in `main/index.ts` holds
 * it exactly the way `gate.ts` holds its own log. Pure and bounded here so the bounding itself is
 * testable without Electron.
 */

import type { ActivityEvent } from './activity.js';
import type { CalendarStatus } from './calendar-oauth.js';
import type { CommitmentCache } from './calendar.js';
import type { Facts } from './interruption.js';

export type ActivityLogEntry = ActivityEvent;

/** Bounded the same way `policy.ts#MAX_AUDIT_ENTRIES` is: oldest first out. */
export const MAX_ACTIVITY_LOG_ENTRIES = 30;

export function recordActivity(log: readonly ActivityLogEntry[], entry: ActivityLogEntry): ActivityLogEntry[] {
  const next = [...log, entry];
  return next.length > MAX_ACTIVITY_LOG_ENTRIES ? next.slice(next.length - MAX_ACTIVITY_LOG_ENTRIES) : next;
}

/**
 * Why a turn ended where it did. `gated` never reached NAV-111 at all — NAV-110's gate is what
 * stopped it, and `reason` is its own sentence. `unavailable` reached the gate's yes but found no
 * cloud provider configured. `silent` is NAV-111's own call. `spoke` is the one outcome that was
 * not silence.
 */
export type JudgementOutcome = 'gated' | 'unavailable' | 'silent' | 'spoke';

export interface JudgementLogEntry {
  at: number;
  /** What NAV-111 was, or would have been, handed — present even when it was never called. */
  facts: Facts;
  outcome: JudgementOutcome;
  reason: string;
  remark: string | null;
}

export const MAX_JUDGEMENT_LOG_ENTRIES = 30;

export function recordJudgement(log: readonly JudgementLogEntry[], entry: JudgementLogEntry): JudgementLogEntry[] {
  const next = [...log, entry];
  return next.length > MAX_JUDGEMENT_LOG_ENTRIES ? next.slice(next.length - MAX_JUDGEMENT_LOG_ENTRIES) : next;
}

/** What `main/index.ts#ambient:snapshot` answers with, and what the settings window renders (NAV-118). */
export interface AmbientSnapshot {
  calendar: CommitmentCache;
  calendarStatus: CalendarStatus;
  activity: readonly ActivityLogEntry[];
  judgements: readonly JudgementLogEntry[];
  hasCloudProvider: boolean;
}
