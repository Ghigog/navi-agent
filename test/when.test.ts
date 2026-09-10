/**
 * Resolving "in 20 minutes" (NAV-100).
 *
 * Two rules, and the tests are mostly about the second one. Resolve at write time, so a
 * misreading is visible immediately rather than at the moment the reminder does not fire. And
 * reject rather than guess: a reminder set for a time the user did not mean is worse than a
 * clarifying question, because they will not find out until it is too late.
 */

import { describe, expect, it } from 'vitest';
import { AFTERNOON_HOUR, DEFAULT_HOUR, EVENING_HOUR, clockTime, describeWhen, resolveWhen } from '../src/shared/when.js';

/** A Wednesday, at half past ten in the morning, local time. */
const NOW = new Date(2026, 8, 9, 10, 30, 0, 0).getTime();
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The resolved instant, or a failure the test can print. */
function when(text: string, now = NOW): number {
  const result = resolveWhen(text, now);
  if (!result.ok) throw new Error(`expected "${text}" to resolve, got: ${result.reason}`);
  return result.at;
}

const local = (d: Date): string => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}`;

describe('relative offsets', () => {
  it('reads minutes, hours and days', () => {
    expect(when('in 20 minutes')).toBe(NOW + 20 * MINUTE);
    expect(when('in 2 hours')).toBe(NOW + 2 * HOUR);
    expect(when('in 3 days')).toBe(NOW + 3 * DAY);
    expect(when('in 1 week')).toBe(NOW + 7 * DAY);
  });

  it('reads the numbers people write as words', () => {
    expect(when('in an hour')).toBe(NOW + HOUR);
    expect(when('in five minutes')).toBe(NOW + 5 * MINUTE);
    expect(when('in half an hour')).toBe(NOW + 30 * MINUTE);
  });

  it('tolerates the hedging people put in front of a number', () => {
    expect(when('in about 20 minutes')).toBe(NOW + 20 * MINUTE);
    expect(when('in around 2 hours')).toBe(NOW + 2 * HOUR);
  });

  it('does not read "in 3 hours" as a clock time', () => {
    // The mistake that makes a reminder fire at a plausible-looking wrong moment.
    expect(when('in 3 hours')).toBe(NOW + 3 * HOUR);
  });
});

describe('clock times', () => {
  it('reads am, pm, 24-hour and noon', () => {
    expect(local(new Date(when('at 3pm')))).toBe('2026-9-9 15:0');
    expect(local(new Date(when('at 15:30')))).toBe('2026-9-9 15:30');
    expect(local(new Date(when('at noon')))).toBe('2026-9-9 12:0');
  });

  it('means tomorrow when the time has already gone today', () => {
    // At half past ten in the morning, "at 8" is tomorrow morning, and everybody knows it.
    expect(local(new Date(when('at 8am')))).toBe('2026-9-10 8:0');
  });

  it('ignores a bare number that is not a clock time', () => {
    expect(clockTime('in 3 hours')).toBeNull();
    expect(clockTime('at 3')).toEqual({ hour: 3, minute: 0 });
    expect(clockTime('15:30')).toEqual({ hour: 15, minute: 30 });
  });

  it('refuses an hour that is not one', () => {
    expect(clockTime('at 41:00')).toBeNull();
  });
});

describe('named days', () => {
  it('defaults to the morning when no clock time is given', () => {
    expect(local(new Date(when('tomorrow')))).toBe(`2026-9-10 ${DEFAULT_HOUR}:0`);
  });

  it('takes a clock time with the day', () => {
    expect(local(new Date(when('tomorrow at 3pm')))).toBe('2026-9-10 15:0');
  });

  it('reads a part of the day', () => {
    expect(local(new Date(when('tomorrow morning')))).toBe(`2026-9-10 ${DEFAULT_HOUR}:0`);
    expect(local(new Date(when('tomorrow afternoon')))).toBe(`2026-9-10 ${AFTERNOON_HOUR}:0`);
    expect(local(new Date(when('tonight')))).toBe(`2026-9-9 ${EVENING_HOUR}:0`);
  });

  it('finds the next named weekday', () => {
    // Wednesday the 9th; Friday is the 11th.
    expect(local(new Date(when('on friday')))).toBe(`2026-9-11 ${DEFAULT_HOUR}:0`);
    expect(local(new Date(when('friday at 2pm')))).toBe('2026-9-11 14:0');
  });

  it('takes "next friday" past the one this week', () => {
    expect(local(new Date(when('next friday')))).toBe(`2026-9-18 ${DEFAULT_HOUR}:0`);
  });

  it('means a week today when the named day is today', () => {
    expect(local(new Date(when('wednesday')))).toBe(`2026-9-16 ${DEFAULT_HOUR}:0`);
  });
});

describe('rejecting rather than guessing', () => {
  it('refuses the words that look like a time and are not one', () => {
    for (const vague of ['later', 'soon', 'sometime', 'in a bit', 'when I get a chance', 'eventually']) {
      const result = resolveWhen(vague, NOW);
      expect(result.ok, vague).toBe(false);
      // The reason is shown to the user through the model, so it has to ask rather than state.
      if (!result.ok) expect(result.reason).toMatch(/ask them/);
    }
  });

  it('refuses a time that has already passed', () => {
    const result = resolveWhen('2020-01-01 09:00', NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/already passed/);
  });

  it('refuses nothing at all', () => {
    expect(resolveWhen('', NOW).ok).toBe(false);
    expect(resolveWhen('the usual place', NOW).ok).toBe(false);
  });

  it('takes an explicit timestamp, which is what a model should send for a date', () => {
    expect(local(new Date(when('2026-12-25 08:00')))).toBe('2026-12-25 8:0');
  });
});

describe('describeWhen', () => {
  it('says it back in the terms the user used', () => {
    expect(describeWhen(NOW + 20 * MINUTE, NOW)).toBe('in 20 minutes');
    expect(describeWhen(NOW + 4 * HOUR, NOW)).toMatch(/^today at /);
    expect(describeWhen(NOW + 25 * HOUR, NOW)).toMatch(/^tomorrow at /);
    expect(describeWhen(NOW + 5 * DAY, NOW)).toMatch(/at /);
  });

  it('never says "in 0 minutes"', () => {
    expect(describeWhen(NOW + 100, NOW)).toBe('in 1 minutes');
  });
});
