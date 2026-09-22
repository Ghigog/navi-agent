/**
 * The activity signal's debounce (NAV-109): the general form of "opened League" is *the
 * foreground application changed*, and that is the whole signal — no window titles, no content,
 * no per-keystroke anything. What she sees once it fires is NAV-103's existing capture, not a
 * new sensor.
 *
 * Pure and synchronous, the way `interruption.ts` is pure: no clock, no timer, no helper
 * process, so the alt-tab case is provable with plain numbers. `main/activity.ts` is the only
 * caller and the only thing that polls anything.
 */

import type { AppInfo } from './ui-protocol.js';

export interface ActivityEvent {
  app: AppInfo;
  at: number;
}

export interface ActivityDebounceState {
  /** The app an event was last confirmed for — or established as the silent baseline. Null before the first sample. */
  confirmed: string | null;
  /** A candidate seen since `confirmed`, and when it was first seen. Reset by any other app arriving. */
  pending: { app: AppInfo; since: number } | null;
}

export const INITIAL_ACTIVITY_STATE: ActivityDebounceState = { confirmed: null, pending: null };

export interface SampleResult {
  state: ActivityDebounceState;
  event: ActivityEvent | null;
}

/**
 * Feeds one sample of the foreground app into the debounce. `app: null` means undetermined —
 * the helper could not answer, or nothing currently has focus — and is never treated as a
 * change: it neither confirms a candidate nor resets one already building.
 *
 * The first-ever sample only establishes a baseline; there is nothing for it to have changed
 * from, so it produces no event. After that, a different app has to hold for `debounceMs`
 * before it counts — rapid alt-tabbing keeps restarting the window on whichever app is current
 * and never reaches it.
 */
export function sample(state: ActivityDebounceState, app: AppInfo | null, now: number, debounceMs: number): SampleResult {
  if (app === null) return { state, event: null };

  if (state.confirmed === null) {
    return { state: { confirmed: app.bundleId, pending: null }, event: null };
  }

  if (app.bundleId === state.confirmed) {
    return { state: { confirmed: state.confirmed, pending: null }, event: null };
  }

  if (state.pending === null || state.pending.app.bundleId !== app.bundleId) {
    return { state: { confirmed: state.confirmed, pending: { app, since: now } }, event: null };
  }

  if (now - state.pending.since < debounceMs) return { state, event: null };

  return { state: { confirmed: app.bundleId, pending: null }, event: { app, at: now } };
}
