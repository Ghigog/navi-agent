/**
 * Turning "in 20 minutes" into a timestamp (NAV-100).
 *
 * Resolved **at write time**, which is the whole point of this file existing. The alternative —
 * storing "tomorrow morning" and working out what it meant when the reminder is due — asks a 3B
 * local model to do date arithmetic against a clock, at the moment the answer has to be right,
 * with nobody watching. Resolving now means the model's only job is to hand over the words the
 * user said, and a wrong answer is visible immediately: Navi says when she will remind you.
 *
 * The other rule is **reject rather than guess**. "Later", "soon", "when I get a chance" are not
 * times. A reminder set for a moment the user did not mean is worse than a clarifying question,
 * because they will not find out until it does not fire.
 *
 * Pure, and every function takes `now`, so a test can sit at any instant it likes.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** When a day-level expression means, with no time of day given. */
export const DEFAULT_HOUR = 9;
/** "Tonight", and "this evening". */
export const EVENING_HOUR = 20;
/** "This afternoon". */
export const AFTERNOON_HOUR = 14;

export type Resolution =
  | { ok: true; at: number }
  /** `reason` is written to be shown to the user through the model, so it asks rather than states. */
  | { ok: false; reason: string };

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, forty_five: 45, sixty: 60, half: 0.5,
};

/** Words that look like a time and are not one. Matching them is how "reject rather than guess" works. */
const VAGUE = /\b(later|soon|sometime|some time|eventually|in a (bit|while|moment)|when (i|you)\b|before long|shortly|whenever|at some point)\b/;

const count = (raw: string): number | null => {
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric;
  return NUMBER_WORDS[raw.toLowerCase()] ?? null;
};

/**
 * Sets a clock time on a date, in local time.
 *
 * Local rather than UTC on purpose: "at 3pm" means three in the afternoon where the user is
 * sitting, and a reminder that fires at 3pm UTC is a reminder that fires at the wrong time
 * everywhere except one meridian.
 */
function at(base: Date, hour: number, minute = 0): Date {
  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d;
}

/**
 * Reads a clock time out of a phrase: "3pm", "15:30", "at 9", "noon".
 *
 * Returns null when there is no time of day in it, which is different from there being no time
 * *at all* — "tomorrow" has a day and no clock, and gets `DEFAULT_HOUR`.
 */
export function clockTime(text: string): { hour: number; minute: number } | null {
  if (/\bnoon|midday\b/.test(text)) return { hour: 12, minute: 0 };
  if (/\bmidnight\b/.test(text)) return { hour: 0, minute: 0 };

  const match = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/.exec(text);
  if (!match) return null;

  const [, rawHour, rawMinute, meridiem] = match;
  let hour = Number(rawHour);
  const minute = rawMinute === undefined ? 0 : Number(rawMinute);
  if (hour > 23 || minute > 59) return null;

  // A bare number with no am/pm and no colon is only a clock time if something said "at". "in 3
  // hours" must not be read as "at 3 o'clock", which is the mistake that makes a reminder fire
  // at a plausible-looking wrong moment.
  const explicit = meridiem !== undefined || rawMinute !== undefined || /\bat\s+\d/.test(text);
  if (!explicit) return null;

  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  return { hour, minute };
}

function partOfDay(text: string): number | null {
  if (/\bmorning\b/.test(text)) return DEFAULT_HOUR;
  if (/\bafternoon\b/.test(text)) return AFTERNOON_HOUR;
  if (/\b(evening|tonight)\b/.test(text)) return EVENING_HOUR;
  return null;
}

/**
 * Resolves a natural-language time to an instant, or says it cannot.
 *
 * Order matters: relative offsets first, because "in 3 hours" contains a number that the clock
 * reader would otherwise be tempted by; then named days; then a bare clock time, which means
 * today if it is still ahead and tomorrow if it is not.
 */
export function resolveWhen(text: string, now = Date.now()): Resolution {
  const raw = text.trim();
  if (raw === '') return { ok: false, reason: 'no time was given' };

  const lower = raw.toLowerCase();
  const nowDate = new Date(now);

  // An explicit timestamp, which is what a model should send when the user gave a date.
  const iso = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/.exec(raw);
  if (iso) {
    const parsed = new Date(raw.replace(' ', 'T'));
    if (!Number.isNaN(parsed.getTime())) return future(parsed.getTime(), now);
  }

  if (VAGUE.test(lower)) {
    return { ok: false, reason: `"${raw}" is not a specific time — ask them when they actually mean` };
  }

  // "in 20 minutes", "in half an hour", "in a couple of days"
  const relative = /\bin\s+(?:about\s+|around\s+)?([a-z0-9]+)(?:\s+an?)?\s*(second|minute|min|hour|hr|day|week|month)s?\b/.exec(lower);
  if (relative) {
    const n = count(relative[1]!);
    if (n === null) return { ok: false, reason: `could not read "${relative[1]}" as a number of ${relative[2]}s` };

    const unit = relative[2]!;
    const ms =
      unit.startsWith('sec') ? 1000
      : unit.startsWith('min') ? MINUTE
      : unit.startsWith('h') ? HOUR
      : unit === 'day' ? DAY
      : unit === 'week' ? 7 * DAY
      : 30 * DAY;
    return future(now + n * ms, now);
  }

  const clock = clockTime(lower);
  const hour = clock?.hour ?? partOfDay(lower);
  const minute = clock?.minute ?? 0;

  if (/\btomorrow\b/.test(lower)) {
    return future(at(new Date(now + DAY), hour ?? DEFAULT_HOUR, minute).getTime(), now);
  }
  if (/\btoday\b/.test(lower) && hour !== null) {
    return future(at(nowDate, hour, minute).getTime(), now);
  }

  // "on friday", "next monday". "next" pushes past this week's one, which is what people mean
  // by it even when today is Wednesday and Friday is still ahead.
  const named = /\b(next\s+)?(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/.exec(lower);
  if (named) {
    const target = WEEKDAYS[named[2]!]!;
    const candidate = at(nowDate, hour ?? DEFAULT_HOUR, minute);
    let delta = (target - candidate.getDay() + 7) % 7;
    if (delta === 0 && candidate.getTime() <= now) delta = 7;
    if (named[1] !== undefined && delta < 7) delta += 7;
    return future(candidate.getTime() + delta * DAY, now);
  }

  if (/\bnext week\b/.test(lower)) {
    return future(at(new Date(now + 7 * DAY), hour ?? DEFAULT_HOUR, minute).getTime(), now);
  }

  // A bare clock time: today if it is still ahead, tomorrow if it has gone. "Remind me at 8" at
  // nine in the evening means tomorrow morning, and everybody knows it.
  if (hour !== null) {
    const todayAt = at(nowDate, hour, minute).getTime();
    return { ok: true, at: todayAt > now ? todayAt : todayAt + DAY };
  }

  return { ok: false, reason: `could not work out when "${raw}" is — ask them for a specific time` };
}

function future(when: number, now: number): Resolution {
  if (!Number.isFinite(when)) return { ok: false, reason: 'that is not a time' };
  if (when <= now) return { ok: false, reason: 'that time has already passed — ask them when they meant' };
  return { ok: true, at: when };
}

/**
 * How Navi should say a time back.
 *
 * She always says it, because saying it is the check: resolving at write time means a
 * misreading is visible immediately rather than at the moment the reminder does not fire.
 */
export function describeWhen(when: number, now = Date.now()): string {
  const delta = when - now;
  if (delta < HOUR) return `in ${Math.max(1, Math.round(delta / MINUTE))} minutes`;

  const date = new Date(when);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (delta < DAY && new Date(now).getDate() === date.getDate()) return `today at ${time}`;
  if (delta < 2 * DAY) return `tomorrow at ${time}`;
  return `${date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} at ${time}`;
}
