import { describe, expect, it } from 'vitest';
import {
  MAX_ACTIVITY_LOG_ENTRIES,
  MAX_JUDGEMENT_LOG_ENTRIES,
  recordActivity,
  recordJudgement,
  type ActivityLogEntry,
  type JudgementLogEntry,
} from '../src/shared/ambient-log.js';

const app = { bundleId: 'com.apple.Terminal', name: 'Terminal' };

function activityEntry(at: number): ActivityLogEntry {
  return { app, at };
}

function judgementEntry(at: number): JudgementLogEntry {
  return { at, facts: { now: at, minutesUntilLeaveBy: null, commitment: null }, outcome: 'gated', reason: 'Quiet hours.', remark: null };
}

describe('the ambient log (NAV-118)', () => {
  it('keeps entries in order, oldest first', () => {
    const log = [0, 1, 2].reduce<ActivityLogEntry[]>((acc, i) => recordActivity(acc, activityEntry(i)), []);
    expect(log.map((e) => e.at)).toEqual([0, 1, 2]);
  });

  it('bounds the activity log, dropping the oldest first', () => {
    let log: ActivityLogEntry[] = [];
    for (let i = 0; i < MAX_ACTIVITY_LOG_ENTRIES + 5; i++) log = recordActivity(log, activityEntry(i));
    expect(log).toHaveLength(MAX_ACTIVITY_LOG_ENTRIES);
    expect(log[0]?.at).toBe(5);
    expect(log.at(-1)?.at).toBe(MAX_ACTIVITY_LOG_ENTRIES + 4);
  });

  it('bounds the judgement log the same way, and keeps silent outcomes — the whole point of the log', () => {
    let log: JudgementLogEntry[] = [];
    for (let i = 0; i < MAX_JUDGEMENT_LOG_ENTRIES + 3; i++) log = recordJudgement(log, judgementEntry(i));
    expect(log).toHaveLength(MAX_JUDGEMENT_LOG_ENTRIES);
    expect(log[0]?.at).toBe(3);
    expect(log.every((e) => e.outcome === 'gated')).toBe(true);
  });

  it('never mutates the log it was handed', () => {
    const log = recordActivity([], activityEntry(0));
    const next = recordActivity(log, activityEntry(1));
    expect(log).toHaveLength(1);
    expect(next).toHaveLength(2);
  });
});
