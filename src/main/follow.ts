/**
 * Cursor following, and the flight primitive pointing is built on (NAV-102).
 *
 * The window position is the main process's to own, so this runs here rather than in the
 * renderer — the renderer cannot move its own window, and asking it to would put the decision
 * on the far side of an IPC hop from the cursor sample that drives it.
 *
 * It imports nothing from Electron, in the same way and for the same reason as
 * `conversation.ts`: the window arrives as a three-method port and the cursor as a source, so
 * a whole follow-pause-fly-restore cycle runs under test without a display.
 *
 * Ported from the Godot build's `FollowController.gd`, now deleted (NAV-105). That version also
 * carried `navigate_sequence` and the arrow drawing; the arrow arrived with NAV-103's `point_to`,
 * as `onFlight` below. A sequence of points is NAV-106, which is a *found* ticket — the guidance
 * feature it belongs to shipped in Godot across five tickets and the port's plan never mentioned
 * it, because the only tickets referring to it were closed as superseded by the migration.
 */

import type { Point } from '../shared/geometry.js';
import { centreOn, ease, followTarget, FOLLOW_OFFSET, LERP_SPEED, settled } from '../shared/motion.js';
import type { CursorSource } from './cursor.js';

/** The window, reduced to what following needs. `BrowserWindow` satisfies it. */
export interface FollowWindow {
  getBounds(): { x: number; y: number; width: number; height: number };
  setPosition(x: number, y: number): void;
  isDestroyed(): boolean;
}

/**
 * Why she is standing still. A set rather than a boolean because the reasons overlap — the
 * chat window can be open while something else has also asked her to hold — and a boolean
 * would have whichever ended last decide for both.
 */
export type PauseReason = 'chat';

/** How long she holds a flight target before following again, when a caller does not say. */
export const DEFAULT_HOLD_MS = 1500;

/**
 * A flight that has not arrived in this long is not going to. Exponential easing converges in
 * about 1.3 seconds across a whole screen, so this is a stuck-state guard rather than a budget.
 */
export const MAX_FLIGHT_MS = 5000;

export interface FollowOptions {
  window: FollowWindow;
  cursor: CursorSource;
  offset?: Point;
  speed?: number;
  /**
   * Called while she is flying, with the target expressed relative to the centre of her window,
   * and once with `null` when the flight ends (NAV-103).
   *
   * This exists because of a real gap: the renderer draws in window coordinates and is never
   * told where its window is on screen, so it cannot work out which way "over there" is. Rather
   * than teaching the renderer about screen space, the main process — which already knows both
   * numbers, on the tick that moves her — does the subtraction and sends the answer.
   */
  onFlight?: (relative: Point | null) => void;
}

export interface Follow {
  setPaused(reason: PauseReason, paused: boolean): void;
  /** False while paused or flying. */
  isFollowing(): boolean;
  isFlying(): boolean;
  /**
   * Suspends following, eases her body onto `point`, holds there, then follows again.
   *
   * Resolves once she has held and following is restored, so a caller can await the whole
   * gesture. It never rejects: a pointing gesture that goes wrong must cost the gesture, not
   * the turn that asked for it.
   */
  flyTo(point: Point, opts?: { hold?: number }): Promise<void>;
  /** Ends a flight early and restores following. */
  abort(): void;
  stop(): void;
}

interface Flight {
  /** Where the *window* is going: the target, offset so her body lands on it. */
  target: Point;
  /** Where she is pointing at, in screen coordinates. What the user actually cares about. */
  destination: Point;
  hold: number;
  startedAt: number | null;
  arrivedAt: number | null;
  resolve: () => void;
}

export function createFollow(opts: FollowOptions): Follow {
  const { window: win, cursor } = opts;
  const offset = opts.offset ?? FOLLOW_OFFSET;
  const speed = opts.speed ?? LERP_SPEED;

  const paused = new Set<PauseReason>();
  let flight: Flight | null = null;

  // The sub-pixel position, kept separately from the window's own integer bounds. Rounding
  // every frame and easing from the rounded value is what made the Godot build jitter, and is
  // why `FollowController.gd` keeps a float position too.
  let pos: Point | null = null;
  // What we last asked the window for, so a tick that changes nothing costs no window call.
  let applied: Point | null = null;
  let last: number | null = null;

  const land = (): void => {
    const done = flight;
    flight = null;
    if (done) {
      opts.onFlight?.(null);
      done.resolve();
    }
  };

  const tick = (cursorPoint: Point, t: number): void => {
    if (win.isDestroyed()) return;

    const bounds = win.getBounds();
    // If anything else moved the window — a first tick, a drag, a display change — ease from
    // where she actually is rather than from where we last thought we put her.
    if (pos === null || applied === null || bounds.x !== applied.x || bounds.y !== applied.y) {
      pos = { x: bounds.x, y: bounds.y };
      applied = { x: bounds.x, y: bounds.y };
    }

    const dt = last === null ? 0 : t - last;
    last = t;
    if (dt <= 0) return;

    if (flight !== null && flight.startedAt === null) flight.startedAt = t;

    // A flight outranks a pause. Pointing at something is most useful exactly when the chat
    // window is open, which is the pause that would otherwise swallow it.
    const target = flight !== null ? flight.target : paused.size === 0 ? followTarget(cursorPoint, offset) : null;
    if (target === null) return;

    const stuck = flight !== null && flight.startedAt !== null && t - flight.startedAt > MAX_FLIGHT_MS;
    const next = stuck ? target : ease(pos, target, dt, speed);
    pos = settled(next, target) ? { ...target } : next;

    const x = Math.round(pos.x);
    const y = Math.round(pos.y);
    if (x !== applied.x || y !== applied.y) {
      win.setPosition(x, y);
      applied = { x, y };
    }

    if (flight !== null) {
      // Her body, not her window's corner: the window is 200px of mostly transparent aura, and
      // an arrow drawn from its corner points from nowhere the user can see.
      opts.onFlight?.({
        x: flight.destination.x - (pos.x + bounds.width / 2),
        y: flight.destination.y - (pos.y + bounds.height / 2),
      });

      if (settled(pos, flight.target)) {
        if (flight.arrivedAt === null) flight.arrivedAt = t;
        if (t - flight.arrivedAt >= flight.hold) land();
      }
    }
  };

  const unsubscribe = cursor.subscribe(tick);

  return {
    setPaused(reason, isPaused) {
      if (isPaused) paused.add(reason);
      else paused.delete(reason);
    },
    isFollowing: () => flight === null && paused.size === 0,
    isFlying: () => flight !== null,
    flyTo(point, flyOpts) {
      // A second flight replaces the first rather than queueing behind it: the newer target is
      // the one the user just asked about.
      land();
      const bounds = win.getBounds();
      return new Promise<void>((resolve) => {
        flight = {
          target: centreOn(point, bounds),
          destination: { ...point },
          hold: flyOpts?.hold ?? DEFAULT_HOLD_MS,
          startedAt: null,
          arrivedAt: null,
          resolve,
        };
      });
    },
    abort: land,
    stop() {
      unsubscribe();
      land();
    },
  };
}
