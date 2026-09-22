/**
 * Polling the foreground app (NAV-109) and feeding it through `shared/activity.ts`'s debounce.
 *
 * Same shape as `calendar-sync.ts`: the clock, the timer and the read all arrive as
 * dependencies, so this runs under test with no helper process and no real clock. The timer
 * re-arms after each poll settles rather than running a fixed interval, for the same reason —
 * a slow read should not pile polls up behind it.
 *
 * `enabled()` is checked before every poll, not just at `start()`. Off means the signal is not
 * collected at all — no read happens — which is the property NAV-113's pause switch needs; a
 * poller that keeps reading and merely discards the result would still be the thing it claims
 * to have turned off.
 */

import { INITIAL_ACTIVITY_STATE, sample, type ActivityDebounceState, type ActivityEvent } from '../shared/activity.js';
import type { AppInfo } from '../shared/ui-protocol.js';

/** How often to sample the foreground app. Cheap enough that this costs nothing next to the idle render loop. */
export const POLL_MS = 2_000;

/** How long a different app has to hold the foreground before it counts as a change. Alt-tabbing between two windows is not five decisions. */
export const DEBOUNCE_MS = 3_000;

export interface ActivitySignalDeps {
  /** NAV-90's `frontmostApp`. Null means undetermined — never treated as a change. */
  frontmostApp(): Promise<AppInfo | null>;
  /** Called once per confirmed change. Never called for the initial baseline. */
  onChange(event: ActivityEvent): void;
  /** False means paused (NAV-113) or the feature is off. Checked before every poll. */
  enabled(): boolean;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  pollMs?: number;
  debounceMs?: number;
}

export interface ActivitySignal {
  /** Arms the poll. Call once at launch, or whenever the feature is turned on. */
  start(): void;
  stop(): void;
}

export function createActivitySignal(deps: ActivitySignalDeps): ActivitySignal {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle));
  const pollMs = deps.pollMs ?? POLL_MS;
  const debounceMs = deps.debounceMs ?? DEBOUNCE_MS;

  let handle: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let state: ActivityDebounceState = INITIAL_ACTIVITY_STATE;

  const disarm = (): void => {
    if (handle !== null) clearTimer(handle);
    handle = null;
  };

  const arm = (): void => {
    disarm();
    if (!running) return;
    handle = setTimer(poll, pollMs);
  };

  const poll = (): void => {
    if (!running || !deps.enabled()) {
      arm();
      return;
    }
    void deps
      .frontmostApp()
      .then((app) => {
        if (!running) return;
        const result = sample(state, app, now(), debounceMs);
        state = result.state;
        if (result.event !== null) deps.onChange(result.event);
      })
      .finally(arm);
  };

  return {
    start(): void {
      if (running) return;
      running = true;
      state = INITIAL_ACTIVITY_STATE;
      arm();
    },
    stop(): void {
      running = false;
      disarm();
    },
  };
}
