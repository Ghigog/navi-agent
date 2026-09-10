/**
 * Firing reminders (NAV-100).
 *
 * One timer, armed for the next reminder due, rather than a poll. A permanent one-second
 * interval is exactly the idle work ADR 0001's CPU bar exists to keep out, and a reminder store
 * knows precisely when it next has something to say.
 *
 * Two properties the ticket asks for, and both are structural here rather than incidental:
 *
 *   **It survives a restart.** The store is on disk and `start()` sweeps it, so anything that
 *   came due while the app was closed fires on the next launch rather than being lost. A
 *   reminder that only exists in memory is not a reminder.
 *
 *   **It fires while Navi is unfocused.** Nothing here depends on a window having the keyboard;
 *   the caller is handed the notes and decides how she says them.
 *
 * No Electron import: the store arrives as two functions and the clock as one, so a reminder
 * set for next Tuesday can be fired in a millisecond under test.
 */

import { dueNow, markFired, nextDue, type Note, type Notes } from '../shared/notes.js';

export interface ReminderDeps {
  read(): Notes;
  write(next: Notes): void;
  /** Called with everything that has come due. Never called with an empty list. */
  fire(notes: readonly Note[]): void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

/**
 * The longest a single timer is allowed to run.
 *
 * `setTimeout` overflows past about 24.8 days and fires immediately, which for a reminder set
 * for next month would mean firing it now. Chaining shorter waits also re-reads the clock along
 * the way, so a laptop that slept through the intended moment still catches up.
 */
export const MAX_TIMER_MS = 6 * 60 * 60 * 1000;

export interface Reminders {
  /** Sweeps anything already due, then arms for the next. Call once at launch. */
  start(): void;
  /** Re-arms after a write. Cheap, and safe to call on every change. */
  refresh(): void;
  stop(): void;
  /** When the timer is currently set for, or null. For tests and for logging. */
  armedFor(): number | null;
}

export function createReminders(deps: ReminderDeps): Reminders {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle));

  let handle: ReturnType<typeof setTimeout> | null = null;
  let armed: number | null = null;

  const disarm = (): void => {
    if (handle !== null) clearTimer(handle);
    handle = null;
    armed = null;
  };

  const sweep = (): void => {
    const store = deps.read();
    const ready = dueNow(store, now());

    if (ready.length > 0) {
      // Marked before firing, not after. If saying it throws, the reminder has still been
      // delivered once and must not arrive again on the next tick, forever.
      deps.write(markFired(store, ready.map((n) => n.id), now()));
      deps.fire(ready);
    }

    arm();
  };

  const arm = (): void => {
    disarm();
    const next = nextDue(deps.read(), now());
    if (next === null) return;

    armed = next;
    // Clamped, and chained rather than one long wait: setTimeout overflows past ~24.8 days and
    // would fire a reminder for next month immediately. Re-reading the clock on each hop also
    // means a laptop that slept through the moment catches up on waking.
    const wait = Math.min(MAX_TIMER_MS, Math.max(0, next - now()));
    handle = setTimer(sweep, wait);
  };

  return {
    start: sweep,
    refresh: arm,
    stop: disarm,
    armedFor: () => armed,
  };
}
