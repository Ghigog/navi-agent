import { describe, expect, it } from 'vitest';
import {
  EMPTY_OUTCOME_LOG,
  MAX_OUTCOME_ENTRIES,
  coerceOutcomeLog,
  isMuted,
  muteActivity,
  muteSubject,
  recordOutcome,
  unmuteActivity,
  unmuteSubject,
  type OutcomeEntry,
  type OutcomeLog,
} from '../src/shared/outcome-log.js';

function entry(at: number, over: Partial<OutcomeEntry> = {}): OutcomeEntry {
  return { at, subject: 'com.riotgames.LeagueofLegends', activity: 'League of Legends', remark: 'You have been at it a while.', outcome: 'dismissed', ...over };
}

describe('the outcome log (NAV-115)', () => {
  it('keeps entries in order, oldest first', () => {
    const log = [0, 1, 2].reduce<OutcomeLog>((acc, i) => recordOutcome(acc, entry(i)), EMPTY_OUTCOME_LOG);
    expect(log.entries.map((e) => e.at)).toEqual([0, 1, 2]);
  });

  it('bounds entries, dropping the oldest first — mutes are untouched by the bound', () => {
    let log = muteSubject(EMPTY_OUTCOME_LOG, 'com.riotgames.LeagueofLegends');
    for (let i = 0; i < MAX_OUTCOME_ENTRIES + 5; i++) log = recordOutcome(log, entry(i));
    expect(log.entries).toHaveLength(MAX_OUTCOME_ENTRIES);
    expect(log.entries[0]?.at).toBe(5);
    expect(log.mutedSubjects).toEqual(['com.riotgames.LeagueofLegends']);
  });

  it('never mutates the log it was handed', () => {
    const log = recordOutcome(EMPTY_OUTCOME_LOG, entry(0));
    const next = recordOutcome(log, entry(1));
    expect(log.entries).toHaveLength(1);
    expect(next.entries).toHaveLength(2);
  });

  describe('muting', () => {
    it('a subject mute is permanent and only affects that subject', () => {
      const log = muteSubject(EMPTY_OUTCOME_LOG, 'com.riotgames.LeagueofLegends');
      expect(isMuted(log, 'com.riotgames.LeagueofLegends', 'League of Legends')).toBe(true);
      expect(isMuted(log, 'com.other.App', 'League of Legends')).toBe(false);
    });

    it('an activity mute is independent of subject and stops it regardless of bundle id', () => {
      const log = muteActivity(EMPTY_OUTCOME_LOG, 'League of Legends');
      expect(isMuted(log, 'com.riotgames.LeagueofLegends', 'League of Legends')).toBe(true);
      expect(isMuted(log, 'com.riotgames.LeagueofLegends', 'Something Else')).toBe(false);
    });

    it('muting twice is idempotent', () => {
      const log = muteSubject(muteSubject(EMPTY_OUTCOME_LOG, 'x'), 'x');
      expect(log.mutedSubjects).toEqual(['x']);
    });

    it('unmuting removes exactly the one named and leaves others untouched', () => {
      const log = muteSubject(muteSubject(EMPTY_OUTCOME_LOG, 'x'), 'y');
      const next = unmuteSubject(log, 'x');
      expect(next.mutedSubjects).toEqual(['y']);
    });

    it('unmuting an activity works the same way', () => {
      const log = muteActivity(muteActivity(EMPTY_OUTCOME_LOG, 'a'), 'b');
      const next = unmuteActivity(log, 'a');
      expect(next.mutedActivities).toEqual(['b']);
    });

    it('unmuting something never muted is a no-op, not an error', () => {
      expect(unmuteSubject(EMPTY_OUTCOME_LOG, 'nothing').mutedSubjects).toEqual([]);
    });
  });

  describe('coerceOutcomeLog', () => {
    it('degrades a garbage shape to empty rather than throwing', () => {
      expect(coerceOutcomeLog(null)).toEqual(EMPTY_OUTCOME_LOG);
      expect(coerceOutcomeLog('nonsense')).toEqual(EMPTY_OUTCOME_LOG);
      expect(coerceOutcomeLog({})).toEqual(EMPTY_OUTCOME_LOG);
    });

    it('round-trips a well-formed log', () => {
      const log = muteActivity(muteSubject(recordOutcome(EMPTY_OUTCOME_LOG, entry(1)), 'subj'), 'act');
      expect(coerceOutcomeLog(JSON.parse(JSON.stringify(log)))).toEqual(log);
    });

    it('drops entries with an unrecognised outcome rather than propagating a bad shape', () => {
      const stored = { entries: [{ at: 1, subject: 's', activity: 'a', remark: 'r', outcome: 'maybe' }], mutedSubjects: [], mutedActivities: [] };
      expect(coerceOutcomeLog(stored).entries).toEqual([]);
    });

    it('de-duplicates a mute list read from disk', () => {
      const stored = { entries: [], mutedSubjects: ['x', 'x'], mutedActivities: [] };
      expect(coerceOutcomeLog(stored).mutedSubjects).toEqual(['x']);
    });
  });
});
