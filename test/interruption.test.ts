/**
 * The interruption gate (NAV-110).
 *
 * The point of this file is the negative space: mostly `mayAsk: false`. Section 5's whole design
 * rests on the model never being asked unless code has already decided it is allowed to be, so
 * these tests exercise the gate on its own, with a stub standing in for NAV-111, before that
 * ticket exists to try it against.
 */

import { describe, expect, it } from 'vitest';
import {
  BACKOFF_STEP_MS,
  DAILY_CAP,
  INITIAL_INTERRUPTION_STATE,
  MIN_GAP_MS,
  currentMinGapMs,
  factsFor,
  inQuietHours,
  mayInterrupt,
  quietHoursFrom,
  remarkMade,
  remarkResponded,
  type GateInput,
  type InterruptionState,
  type QuietHours,
} from '../src/shared/interruption.js';
import { DEFAULTS } from '../src/shared/settings.js';
import { applySync, EMPTY_CACHE, minutesUntilLeaveBy, type CommitmentCache, type GoogleEvent } from '../src/shared/calendar.js';

const NOW = new Date(2026, 8, 22, 10, 0).getTime(); // a Tuesday, 10:00 local
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function input(over: Partial<GateInput> = {}): GateInput {
  return {
    state: INITIAL_INTERRUPTION_STATE,
    now: NOW,
    changed: true,
    relevant: true,
    subject: 'league-of-legends',
    quietHours: null,
    muted: false,
    ...over,
  };
}

describe('silent by default', () => {
  it('says no to an empty, unremarkable input rather than needing a reason to refuse', () => {
    const decision = mayInterrupt(input({ changed: false, relevant: false }));
    expect(decision.mayAsk).toBe(false);
  });

  it('nothing changed means no model call, ever, however relevant it might be', () => {
    const decision = mayInterrupt(input({ changed: false, relevant: true }));
    expect(decision.mayAsk).toBe(false);
    expect(decision.reason).toMatch(/nothing changed/i);
  });

  it('changed but not relevant is still silent', () => {
    const decision = mayInterrupt(input({ changed: true, relevant: false }));
    expect(decision.mayAsk).toBe(false);
  });

  it('changed and relevant, with a clean budget, is eligible', () => {
    const decision = mayInterrupt(input());
    expect(decision.mayAsk).toBe(true);
  });
});

describe('the pre-filter is the cost control', () => {
  it('an idle hour with nothing changing never once asks', () => {
    let calls = 0;
    for (let t = NOW; t < NOW + HOUR; t += MINUTE) {
      const decision = mayInterrupt(input({ now: t, changed: false, relevant: false }));
      if (decision.mayAsk) calls++;
    }
    expect(calls).toBe(0);
  });
});

describe('the daily cap and minimum gap', () => {
  it('hold under fifty attempts inside an hour', () => {
    let state = INITIAL_INTERRUPTION_STATE;
    let asked = 0;

    for (let i = 0; i < 50; i++) {
      const now = NOW + i * (HOUR / 50);
      const decision = mayInterrupt(input({ state, now, subject: `subject-${i}` }));
      if (decision.mayAsk) {
        asked++;
        state = remarkMade(state, now, `subject-${i}`);
      }
    }

    expect(asked).toBeLessThanOrEqual(DAILY_CAP);
  });

  it('refuses a second remark inside the minimum gap even with budget and a new subject left', () => {
    const afterOne = remarkMade(INITIAL_INTERRUPTION_STATE, NOW, 'first-thing');
    const decision = mayInterrupt(input({ state: afterOne, now: NOW + MIN_GAP_MS - MINUTE, subject: 'second-thing' }));
    expect(decision.mayAsk).toBe(false);
    expect(decision.reason).toMatch(/too soon/i);
  });

  it('allows the next remark once the minimum gap has fully elapsed', () => {
    const afterOne = remarkMade(INITIAL_INTERRUPTION_STATE, NOW, 'first-thing');
    const decision = mayInterrupt(input({ state: afterOne, now: NOW + MIN_GAP_MS, subject: 'second-thing' }));
    expect(decision.mayAsk).toBe(true);
  });

  it('refuses once the daily cap is spent, even with the gap satisfied', () => {
    let state = INITIAL_INTERRUPTION_STATE;
    for (let i = 0; i < DAILY_CAP; i++) {
      state = remarkMade(state, NOW + i * MIN_GAP_MS * 2, `subject-${i}`);
    }
    const decision = mayInterrupt(input({ state, now: NOW + DAILY_CAP * MIN_GAP_MS * 2, subject: 'one-more' }));
    expect(decision.mayAsk).toBe(false);
    expect(decision.reason).toMatch(/cap/i);
  });

  it('the cap resets on a new day', () => {
    let state = INITIAL_INTERRUPTION_STATE;
    for (let i = 0; i < DAILY_CAP; i++) {
      state = remarkMade(state, NOW + i * MIN_GAP_MS * 2, `subject-${i}`);
    }
    const tomorrow = NOW + 24 * HOUR;
    const decision = mayInterrupt(input({ state, now: tomorrow, subject: 'fresh-subject' }));
    expect(decision.mayAsk).toBe(true);
  });
});

describe('backing off when ignored or dismissed', () => {
  it('widens the minimum gap after an ignored remark', () => {
    const base = currentMinGapMs(INITIAL_INTERRUPTION_STATE);
    const afterIgnored = remarkResponded(INITIAL_INTERRUPTION_STATE, 'ignored');
    expect(currentMinGapMs(afterIgnored)).toBe(base + BACKOFF_STEP_MS);
  });

  it('widens further after each of a run of dismissals, measurably', () => {
    let state = INITIAL_INTERRUPTION_STATE;
    const gaps: number[] = [currentMinGapMs(state)];
    for (let i = 0; i < 3; i++) {
      state = remarkResponded(state, 'dismissed');
      gaps.push(currentMinGapMs(state));
    }
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]!).toBeGreaterThan(gaps[i - 1]!);
  });

  it('a remark that would be eligible on the plain gap is refused once backoff has widened it', () => {
    const dismissedTwice = remarkResponded(remarkResponded(INITIAL_INTERRUPTION_STATE, 'dismissed'), 'dismissed');
    const afterRemark = remarkMade(dismissedTwice, NOW, 'first-thing');

    const decision = mayInterrupt(input({ state: afterRemark, now: NOW + MIN_GAP_MS, subject: 'second-thing' }));
    expect(decision.mayAsk).toBe(false);
  });

  it('an acknowledged remark resets the backoff', () => {
    const worn = remarkResponded(remarkResponded(INITIAL_INTERRUPTION_STATE, 'dismissed'), 'dismissed');
    const acknowledged = remarkResponded(worn, 'acknowledged');
    expect(currentMinGapMs(acknowledged)).toBe(MIN_GAP_MS);
  });
});

describe('never twice about the same thing', () => {
  it('a subject already raised today is not raised again, budget and gap notwithstanding', () => {
    const afterOne = remarkMade(INITIAL_INTERRUPTION_STATE, NOW, 'league-of-legends');
    const decision = mayInterrupt(input({ state: afterOne, now: NOW + MIN_GAP_MS, subject: 'league-of-legends' }));
    expect(decision.mayAsk).toBe(false);
    expect(decision.reason).toMatch(/already raised/i);
  });

  it('is closed the moment the remark is made, whatever the user goes on to do about it', () => {
    const madeAndIgnored = remarkResponded(remarkMade(INITIAL_INTERRUPTION_STATE, NOW, 'league-of-legends'), 'ignored');
    const decision = mayInterrupt(input({ state: madeAndIgnored, now: NOW + 6 * HOUR, subject: 'league-of-legends' }));
    expect(decision.mayAsk).toBe(false);
  });

  it('a different subject on the same day is unaffected', () => {
    const afterOne = remarkMade(INITIAL_INTERRUPTION_STATE, NOW, 'league-of-legends');
    const decision = mayInterrupt(input({ state: afterOne, now: NOW + MIN_GAP_MS, subject: 'something-else' }));
    expect(decision.mayAsk).toBe(true);
  });

  it('the same subject may be raised again the next day', () => {
    const afterOne = remarkMade(INITIAL_INTERRUPTION_STATE, NOW, 'league-of-legends');
    const decision = mayInterrupt(input({ state: afterOne, now: NOW + 24 * HOUR, subject: 'league-of-legends' }));
    expect(decision.mayAsk).toBe(true);
  });
});

describe('quiet hours', () => {
  const window: QuietHours = { startMinute: 22 * 60, endMinute: 7 * 60 }; // 22:00–07:00, wraps midnight

  it('suppress an otherwise-eligible remark', () => {
    const at2300 = new Date(2026, 8, 22, 23, 0).getTime();
    const decision = mayInterrupt(input({ now: at2300, quietHours: window }));
    expect(decision.mayAsk).toBe(false);
    expect(decision.reason).toMatch(/quiet hours/i);
  });

  it('wrap past midnight correctly', () => {
    const at0300 = new Date(2026, 8, 22, 3, 0).getTime();
    expect(inQuietHours(window, at0300)).toBe(true);
  });

  it('do not apply outside the window', () => {
    const atNoon = new Date(2026, 8, 22, 12, 0).getTime();
    expect(inQuietHours(window, atNoon)).toBe(false);
  });

  it('have no override — a remark cannot be forced through', () => {
    const at2300 = new Date(2026, 8, 22, 23, 0).getTime();
    // Nothing in GateInput can flip this back to true: there is no field that outranks it.
    const decision = mayInterrupt(input({ now: at2300, quietHours: window, relevant: true, changed: true }));
    expect(decision.mayAsk).toBe(false);
  });

  it('null quiet hours never suppress anything on their own', () => {
    expect(inQuietHours(null, NOW)).toBe(false);
  });

  it('a zero-length window is treated as no quiet hours at all', () => {
    expect(inQuietHours({ startMinute: 60, endMinute: 60 }, NOW)).toBe(false);
  });
});

describe('muted (NAV-115)', () => {
  it('suppresses an otherwise-eligible remark', () => {
    const decision = mayInterrupt(input({ muted: true }));
    expect(decision.mayAsk).toBe(false);
    expect(decision.reason).toMatch(/mut/i);
  });

  it('is checked independently of the daily cap and the minimum gap — nothing here can wear it off', () => {
    const decision = mayInterrupt(input({ state: INITIAL_INTERRUPTION_STATE, muted: true, now: NOW + 30 * 24 * HOUR }));
    expect(decision.mayAsk).toBe(false);
  });

  it('an unmuted subject is unaffected', () => {
    const decision = mayInterrupt(input({ muted: false }));
    expect(decision.mayAsk).toBe(true);
  });
});

describe('the facts handed to NAV-111', () => {
  function eventIn(hours: number, overrides: Partial<GoogleEvent> = {}): GoogleEvent {
    return {
      id: 'evt-1',
      summary: 'Standup',
      status: 'confirmed',
      start: { dateTime: new Date(NOW + hours * HOUR).toISOString() },
      end: { dateTime: new Date(NOW + hours * HOUR + 30 * MINUTE).toISOString() },
      ...overrides,
    };
  }

  function cacheWith(...events: GoogleEvent[]): CommitmentCache {
    return applySync(EMPTY_CACHE, 'primary', { events, nextSyncToken: 'tok-1' }, NOW);
  }

  it('are all null when nothing is coming', () => {
    const facts = factsFor(EMPTY_CACHE, NOW);
    expect(facts.commitment).toBeNull();
    expect(facts.minutesUntilLeaveBy).toBeNull();
  });

  it('carry an already-computed number, not a raw commitment a model would have to subtract', () => {
    const cache = cacheWith(eventIn(2));
    const facts = factsFor(cache, NOW);

    // A stub standing in for NAV-111: it only ever reads a field, it never does arithmetic.
    const stubJudge = (f: ReturnType<typeof factsFor>) => f.minutesUntilLeaveBy;

    expect(typeof facts.minutesUntilLeaveBy).toBe('number');
    expect(stubJudge(facts)).toBe(minutesUntilLeaveBy(cache, NOW));
    expect(facts.commitment).toEqual({ title: 'Standup', start: NOW + 2 * HOUR });
  });

  it('name the soonest commitment when more than one is cached', () => {
    const cache = cacheWith(eventIn(4, { id: 'evt-2', summary: 'Dentist' }), eventIn(1, { id: 'evt-3', summary: 'Sync' }));
    const facts = factsFor(cache, NOW);
    expect(facts.commitment?.title).toBe('Sync');
  });
});

describe('day rollover', () => {
  it('does not mutate the state handed in', () => {
    const before: InterruptionState = { ...INITIAL_INTERRUPTION_STATE, day: dayKeyOf(NOW), remarksToday: 2 };
    const frozen = { ...before };
    mayInterrupt(input({ state: before, now: NOW + 24 * HOUR }));
    expect(before).toEqual(frozen);
  });
});

function dayKeyOf(now: number): string {
  return new Date(now).toDateString();
}

describe('quietHoursFrom (NAV-113)', () => {
  it('derives straight from whatever Settings currently holds — nothing cached in between', () => {
    // "Reaches the gate without a restart" is this being pure: two calls against two different
    // settings values give two different answers, with no state anywhere to go stale.
    const off = quietHoursFrom(DEFAULTS);
    expect(inQuietHours(off, new Date(2026, 8, 22, 23, 0).getTime())).toBe(false);

    const overnight = quietHoursFrom({ quietHoursStart: 22 * 60, quietHoursEnd: 7 * 60 });
    expect(inQuietHours(overnight, new Date(2026, 8, 22, 23, 0).getTime())).toBe(true);
    expect(inQuietHours(overnight, new Date(2026, 8, 22, 12, 0).getTime())).toBe(false);
  });

  it('mayInterrupt reads it the same way it reads anything else in GateInput', () => {
    const quietHours = quietHoursFrom({ quietHoursStart: 22 * 60, quietHoursEnd: 7 * 60 });
    const decision = mayInterrupt(input({ now: new Date(2026, 8, 22, 23, 30).getTime(), quietHours }));
    expect(decision.mayAsk).toBe(false);
    expect(decision.reason).toMatch(/quiet hours/i);
  });
});
