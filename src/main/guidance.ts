/**
 * Step-by-step guidance (NAV-106).
 *
 * `main/follow.ts` has carried a comment since NAV-103 saying its Godot ancestor's
 * `navigate_sequence` has no caller yet. This is the caller: `agent/guidance.ts`'s `guide_through`
 * tool hands this a validated, already-bounded sequence and awaits the whole walk-through, and
 * this is what actually flies her from step to step, waits on the user rather than a timer, and
 * can be broken off mid-flight.
 *
 * Ported from the Godot build's `GuidanceController.gd`, now deleted (NAV-105), with one
 * deliberate change: that version auto-advanced on a timer, which was wrong on its own terms — a
 * step that advances while the user is still looking for the thing is worse than no guidance at
 * all. Here the user drives it, by keypress or click; the timeout below is only a backstop for a
 * walk-through nobody is responding to any more.
 *
 * No Electron import, for the same reason `follow.ts` and `conversation.ts` have none: flying,
 * pausing and waiting on the user arrive as a small dependency, so a whole run — several steps,
 * an abort mid-flight, a timeout backstop — plays out in a few milliseconds of test.
 */

import type { Point } from '../shared/geometry.js';
import type { PauseReason } from './follow.js';

/** The reason `follow.setPaused` is given for the duration of a run. Not `'chat'` — see its ticket. */
export const GUIDANCE_PAUSE: PauseReason = 'guidance';

/**
 * How long a step waits for the user before moving on anyway.
 *
 * A backstop, not a pace-setter — that distinction is the whole point of NAV-106 over the Godot
 * behaviour. Generous, because the reason to wait at all is that the user is doing something
 * else: reading the step, finding the thing on their own screen.
 */
export const ADVANCE_TIMEOUT_MS = 20_000;

export interface GuidanceStep {
  text: string;
  point: Point;
}

/** The slice of `Follow` a run needs. `main/index.ts`'s real one satisfies this as-is. */
export interface GuidanceFollow {
  flyTo(point: Point, opts?: { hold?: number }): Promise<void>;
  setPaused(reason: PauseReason, paused: boolean): void;
  /** Lands whatever flight is in progress immediately, so an abort mid-flight does not wait it out. */
  abort(): void;
}

export interface GuidanceDeps {
  follow: GuidanceFollow;
  /** Speaks one step's text in full, when voice output is on. Absent means voice is off. */
  speak?(text: string): void;
  /** Stops her mid-sentence. Called on abort so an abandoned run does not keep talking. */
  stopSpeaking?(): void;
  /** Told which step she has just reached, so the chat window can show it and offer to advance. */
  onStep?(step: { index: number; total: number; text: string }): void;
  /** Told when the run ends, however it ends: finished, aborted, or given an empty sequence. */
  onEnd?(): void;
  timeoutMs?: number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface Guidance {
  /** Runs the sequence, one step at a time. Resolves once it ends, however it ends. */
  run(steps: readonly GuidanceStep[]): Promise<{ shown: number }>;
  /** The user asked to move on: a keypress or a click. Does nothing when nothing is waiting. */
  advance(): void;
  /** Ends the run early: Escape, or the kill switch. Does nothing when nothing is running. */
  abort(): void;
  active(): boolean;
}

export function createGuidance(deps: GuidanceDeps): Guidance {
  const timeoutMs = deps.timeoutMs ?? ADVANCE_TIMEOUT_MS;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle));

  let running = false;
  // Resolves the current wait, whether the user advanced or the backstop fired. Cleared once
  // used so an abort between steps has nothing stale to call.
  let release: (() => void) | null = null;

  const waitForAdvance = (): Promise<void> =>
    new Promise((resolve) => {
      const handle = setTimer(() => {
        release = null;
        resolve();
      }, timeoutMs);
      release = () => {
        clearTimer(handle);
        release = null;
        resolve();
      };
    });

  return {
    active: () => running,

    advance() {
      release?.();
    },

    abort() {
      if (!running) return;
      running = false;
      deps.stopSpeaking?.();
      // Lands the in-progress flight so a caller awaiting `run()` is released now rather than
      // whenever `follow`'s own stuck-flight guard would have got round to it.
      deps.follow.abort();
      release?.();
    },

    async run(steps) {
      running = true;
      deps.follow.setPaused(GUIDANCE_PAUSE, true);
      let shown = 0;

      try {
        for (const step of steps) {
          if (!running) break;
          // No hold here: the wait below is the hold, and it is the user's to end.
          await deps.follow.flyTo(step.point, { hold: 0 });
          if (!running) break;

          shown++;
          deps.onStep?.({ index: shown - 1, total: steps.length, text: step.text });
          deps.speak?.(step.text);

          await waitForAdvance();
        }
      } finally {
        running = false;
        deps.follow.setPaused(GUIDANCE_PAUSE, false);
        deps.onEnd?.();
      }

      return { shown };
    },
  };
}
