/**
 * Frame pacing with an idle throttle.
 *
 * ADR 0001's weakest result: the spike idled at 2.4-2.6% CPU against a 5% bar, over a sample of
 * only ~1.5 minutes. The ADR requires throttling the idle loop during the port — the fairy does
 * not need 60fps to hover — and requires treating a regression past those numbers as a defect.
 *
 * So: run at `activeFps` while something is happening, drop to `idleFps` otherwise. Drawing is
 * skipped between frames; rAF still fires at display rate, which is what lets it come back up
 * to full rate the instant the user touches her.
 */

export interface LoopOptions {
  idleFps: number;
  activeFps: number;
  /** Called once per frame that survives the throttle. `dt` is ms since the previous drawn frame. */
  render(t: number, dt: number): void;
  /** Defaults to requestAnimationFrame; injectable for tests. */
  schedule?: (cb: (t: number) => void) => void;
}

export interface Loop {
  start(): void;
  stop(): void;
  /**
   * Marks the fairy busy for `ms`, running at `activeFps` until it expires. Call on user
   * interaction, on a streaming reply, on a tool running — anything with motion the user is
   * actually watching.
   */
  markActive(ms?: number): void;
  isActive(t: number): boolean;
}

export const DEFAULT_ACTIVE_MS = 2000;

export function createLoop(opts: LoopOptions): Loop {
  const schedule = opts.schedule ?? ((cb) => requestAnimationFrame(cb));

  let running = false;
  let lastDrawn = 0;
  let activeUntil = 0;

  const isActive = (t: number): boolean => t < activeUntil;

  const frame = (t: number): void => {
    if (!running) return;

    const fps = isActive(t) ? opts.activeFps : opts.idleFps;
    const interval = 1000 / fps;
    const dt = t - lastDrawn;

    // `>= interval - 0.5` rather than `>= interval`: rAF timestamps land a hair under the
    // nominal interval often enough that a strict compare drops every other frame and halves
    // the effective rate.
    if (lastDrawn === 0 || dt >= interval - 0.5) {
      opts.render(t, lastDrawn === 0 ? interval : dt);
      lastDrawn = t;
    }

    schedule(frame);
  };

  return {
    start() {
      if (running) return;
      running = true;
      lastDrawn = 0;
      schedule(frame);
    },
    stop() {
      running = false;
    },
    markActive(ms = DEFAULT_ACTIVE_MS) {
      activeUntil = Math.max(activeUntil, performance.now() + ms);
    },
    isActive,
  };
}
