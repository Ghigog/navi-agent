import { describe, expect, it, vi } from 'vitest';
import { createLoop } from '../src/renderer/loop.js';

/**
 * Drives the loop over a simulated 60Hz display and reports how many frames were actually
 * drawn, which is the number the ADR's CPU budget depends on.
 */
function run(opts: { idleFps: number; activeFps: number; ms: number; markActiveAt?: number[] }) {
  const drawn: number[] = [];
  // A queue rather than a single slot: it mirrors how rAF actually behaves, and it sidesteps
  // TypeScript narrowing a `let` that is only ever assigned inside a callback.
  const queue: Array<(t: number) => void> = [];

  const loop = createLoop({
    idleFps: opts.idleFps,
    activeFps: opts.activeFps,
    render: (t) => drawn.push(t),
    schedule: (cb) => {
      queue.push(cb);
    },
  });

  loop.start();
  const step = 1000 / 60;
  for (let t = 0; t <= opts.ms; t += step) {
    if (opts.markActiveAt?.some((at) => Math.abs(at - t) < step / 2)) {
      vi.spyOn(performance, 'now').mockReturnValue(t);
      loop.markActive(500);
    }
    queue.shift()?.(t);
  }
  vi.restoreAllMocks();
  return drawn;
}

describe('idle throttle (ADR 0001 required mitigation)', () => {
  it('draws roughly idleFps frames per second when nothing is happening', () => {
    const drawn = run({ idleFps: 30, activeFps: 60, ms: 1000 });
    // 30fps over one second, allowing a frame either side for boundary alignment.
    expect(drawn.length).toBeGreaterThanOrEqual(29);
    expect(drawn.length).toBeLessThanOrEqual(32);
  });

  it('halves the drawn frames versus running flat out, which is the point', () => {
    const idle = run({ idleFps: 30, activeFps: 60, ms: 1000 });
    const flat = run({ idleFps: 60, activeFps: 60, ms: 1000 });
    expect(idle.length).toBeLessThan(flat.length * 0.6);
  });

  it('does not drop every other frame when rAF timestamps land just under the interval', () => {
    // The bug this guards: a strict `dt >= interval` compare against a 60Hz clock yields 30fps
    // when you asked for 60.
    const drawn = run({ idleFps: 60, activeFps: 60, ms: 1000 });
    expect(drawn.length).toBeGreaterThanOrEqual(58);
  });

  it('runs at activeFps while marked active', () => {
    const drawn = run({ idleFps: 30, activeFps: 60, ms: 500, markActiveAt: [0] });
    expect(drawn.length).toBeGreaterThanOrEqual(29);
  });

  it('stops drawing after stop()', () => {
    const queue: Array<(t: number) => void> = [];
    const drawn: number[] = [];
    const loop = createLoop({
      idleFps: 30,
      activeFps: 60,
      render: (t) => drawn.push(t),
      schedule: (cb) => {
        queue.push(cb);
      },
    });
    loop.start();
    queue.shift()?.(0);
    const before = drawn.length;
    loop.stop();
    queue.shift()?.(100);
    expect(drawn.length).toBe(before);
  });
});

describe('setRates', () => {
  it('takes effect without restarting the loop', () => {
    // The settings window edits frame rates while the fairy is on screen. A rate that only
    // applied on the next launch would be a control that appears to do nothing.
    const drawn: number[] = [];
    const queue: Array<(t: number) => void> = [];
    const loop = createLoop({
      idleFps: 60,
      activeFps: 60,
      render: (t) => drawn.push(t),
      schedule: (cb) => {
        queue.push(cb);
      },
    });

    loop.start();
    const step = 1000 / 60;
    for (let t = 0; t <= 1000; t += step) queue.shift()?.(t);
    const atSixty = drawn.length;

    loop.setRates(10, 60);
    drawn.length = 0;
    for (let t = 1000; t <= 2000; t += step) queue.shift()?.(t);

    expect(atSixty).toBeGreaterThanOrEqual(59);
    expect(drawn.length).toBeLessThanOrEqual(12);
    expect(drawn.length).toBeGreaterThanOrEqual(9);
  });
});
