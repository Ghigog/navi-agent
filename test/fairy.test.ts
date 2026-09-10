import { describe, expect, it } from 'vitest';
import { createFairy, POINTER_TIP } from '../src/renderer/fairy.js';

/**
 * A canvas with just enough surface for `createFairy`'s constructor path, so the sizing rules
 * can be tested without a DOM. Only `scale` is called before the first frame.
 */
function stubCanvas() {
  const scaled: number[][] = [];
  const canvas = {
    width: 0,
    height: 0,
    style: {} as Record<string, string>,
    getContext: () => ({
      scale: (x: number, y: number) => {
        scaled.push([x, y]);
      },
    }),
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, raw: canvas, scaled };
}

describe('canvas sizing', () => {
  it('scales the backing store with dpr but lays the element out at the window size', () => {
    const { canvas, raw, scaled } = stubCanvas();
    createFairy(canvas, { size: 200, dpr: 2 });

    // Device pixels, so she is drawn at full Retina resolution.
    expect([raw.width, raw.height]).toEqual([400, 400]);
    // CSS pixels, so she fits the 200px window. This is the pair that has to differ.
    expect([raw.style['width'], raw.style['height']]).toEqual(['200px', '200px']);
    expect(scaled).toEqual([[2, 2]]);
  });

  it('never lays out larger than the window it lives in', () => {
    // The regression: a canvas with no CSS size lays out at its attribute size. On a Retina
    // display that made her a 400px element inside a 200px window, and the overlay showed her
    // top-left quarter. Every automated run is dpr 1, where the two numbers are equal and the
    // bug is invisible — so it survived to the first launch on a real display.
    for (const dpr of [1, 2, 3]) {
      const { canvas, raw } = stubCanvas();
      createFairy(canvas, { size: 200, dpr });

      expect(raw.style['width']).toBe('200px');
      expect(raw.width).toBe(200 * dpr);
    }
  });

  it('honours a size other than the default', () => {
    const { canvas, raw } = stubCanvas();
    createFairy(canvas, { size: 120, dpr: 2 });
    expect([raw.width, raw.style['width']]).toEqual([240, '120px']);
  });
});

/** A canvas that records the drawing calls, so a frame can be inspected rather than watched. */
function recordingCanvas() {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const record = (op: string) => (...args: unknown[]) => {
    calls.push({ op, args });
  };
  const ctx: Record<string, unknown> = {
    createRadialGradient: () => ({ addColorStop: () => {} }),
    clearRect: record('clearRect'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    arc: record('arc'),
    ellipse: record('ellipse'),
    fill: record('fill'),
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    rotate: record('rotate'),
    scale: record('scale'),
  };
  const canvas = { width: 0, height: 0, style: {} as Record<string, string>, getContext: () => ctx };
  return { canvas: canvas as unknown as HTMLCanvasElement, calls };
}

describe('the pointing arrow (NAV-103)', () => {
  /** The arrow is the only thing in a frame that starts a path with `moveTo`. */
  const arrowFrames = (calls: Array<{ op: string; args: unknown[] }>) =>
    calls.filter((c) => c.op === 'moveTo');

  it('draws nothing when she is not pointing', () => {
    const { canvas, calls } = recordingCanvas();
    const fairy = createFairy(canvas, { size: 200, dpr: 1 });
    fairy.draw(0, 16);
    expect(arrowFrames(calls)).toHaveLength(0);
  });

  it('aims along the direction it is given', () => {
    const { canvas, calls } = recordingCanvas();
    const fairy = createFairy(canvas, { size: 200, dpr: 1 });

    fairy.setPointer({ x: 0, y: 300 });
    fairy.draw(0, 16);

    // Straight down is a quarter turn, and the tip sits on the far edge of her aura. The last
    // rotation in the frame is the arrow's; the earlier ones are her wings flapping.
    const rotation = calls.filter((c) => c.op === 'rotate').at(-1);
    expect(rotation?.args[0]).toBeCloseTo(Math.PI / 2, 6);
    expect(arrowFrames(calls)[0]?.args).toEqual([POINTER_TIP, 0]);
  });

  it('stops drawing once she has arrived, so it never points at itself', () => {
    const { canvas, calls } = recordingCanvas();
    const fairy = createFairy(canvas, { size: 200, dpr: 1 });

    fairy.setPointer({ x: 1, y: 1 });
    fairy.draw(0, 16);
    expect(arrowFrames(calls)).toHaveLength(0);
  });

  it('clears when the flight ends', () => {
    const { canvas, calls } = recordingCanvas();
    const fairy = createFairy(canvas, { size: 200, dpr: 1 });

    fairy.setPointer({ x: 0, y: 300 });
    fairy.draw(0, 16);
    expect(arrowFrames(calls)).toHaveLength(1);

    fairy.setPointer(null);
    fairy.draw(16, 16);
    expect(arrowFrames(calls)).toHaveLength(1);
  });
});
