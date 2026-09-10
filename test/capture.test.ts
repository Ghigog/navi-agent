/**
 * The crop arithmetic (NAV-103, carrying NAV-99).
 *
 * These are the tests that would have caught the original bug. It was never a capture failure —
 * the picture was fine — it was a question of which rectangle of it Navi was shown.
 */

import { describe, expect, it } from 'vitest';
import { cropRect, normalisedToScreen, CROP_POINTS, POINT_GRID } from '../src/shared/capture.js';

const DISPLAY = { x: 0, y: 0, width: 1440, height: 900 };
const RETINA = { width: 2880, height: 1800 };
const PLAIN = { width: 1440, height: 900 };

/** The centre of a rectangle, which is the thing the crop is supposed to get right. */
function centre(r: { x: number; y: number; width: number; height: number }) {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

describe('cropRect', () => {
  it('centres on the anchor', () => {
    const rect = cropRect({ x: 700, y: 400 }, DISPLAY, PLAIN);
    expect(centre(rect)).toEqual({ x: 700, y: 400 });
  });

  it('scales the anchor into image pixels on a HiDPI display', () => {
    // The bug this pins: on Retina, using screen points as image pixels puts the crop at half
    // the offset, which reads as "she looked up and to the left of what I meant".
    const rect = cropRect({ x: 700, y: 400 }, DISPLAY, RETINA);
    expect(centre(rect)).toEqual({ x: 1400, y: 800 });
    expect(rect.width).toBe(CROP_POINTS * 2);
  });

  it('covers the same amount of screen whatever the pixel density', () => {
    const plain = cropRect({ x: 700, y: 400 }, DISPLAY, PLAIN);
    const retina = cropRect({ x: 700, y: 400 }, DISPLAY, RETINA);
    expect(retina.width / RETINA.width).toBeCloseTo(plain.width / PLAIN.width, 6);
  });

  it('offsets the anchor by the display origin on a second monitor', () => {
    const second = { x: 1440, y: 0, width: 1920, height: 1080 };
    const rect = cropRect({ x: 1440 + 960, y: 540 }, second, { width: 1920, height: 1080 });
    expect(centre(rect)).toEqual({ x: 960, y: 540 });
  });

  it('clamps into the image rather than running off the corner', () => {
    const rect = cropRect({ x: 0, y: 0 }, DISPLAY, PLAIN);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    expect(rect.width).toBe(CROP_POINTS);

    const far = cropRect({ x: 1440, y: 900 }, DISPLAY, PLAIN);
    expect(far.x + far.width).toBe(PLAIN.width);
    expect(far.y + far.height).toBe(PLAIN.height);
  });

  it('returns the whole image when the display is smaller than the crop', () => {
    const small = { x: 0, y: 0, width: 200, height: 120 };
    const rect = cropRect({ x: 100, y: 60 }, small, { width: 200, height: 120 });
    expect(rect).toEqual({ x: 0, y: 0, width: 200, height: 120 });
  });

  it('measures the crop in screen points even when the capture came back downscaled', () => {
    // A thumbnail an eighth of the display still shows the same 400 points of desk, just with
    // an eighth of the detail. The crop must not be 400 *pixels* of it.
    const thumbnail = { width: 180, height: 113 };
    const rect = cropRect({ x: 700, y: 400 }, DISPLAY, thumbnail);
    expect(rect.width / thumbnail.width).toBeCloseTo(CROP_POINTS / DISPLAY.width, 2);
  });
});

describe('normalisedToScreen', () => {
  it('maps the grid onto the display', () => {
    expect(normalisedToScreen(0, 0, DISPLAY)).toEqual({ x: 0, y: 0 });
    expect(normalisedToScreen(POINT_GRID, POINT_GRID, DISPLAY)).toEqual({ x: 1440, y: 900 });
    expect(normalisedToScreen(500, 500, DISPLAY)).toEqual({ x: 720, y: 450 });
  });

  it('lands on the right monitor', () => {
    const second = { x: 1440, y: 0, width: 1920, height: 1080 };
    expect(normalisedToScreen(500, 500, second)).toEqual({ x: 2400, y: 540 });
  });

  it('clamps a model that invents a coordinate off the end of the grid', () => {
    expect(normalisedToScreen(-40, 12000, DISPLAY)).toEqual({ x: 0, y: 900 });
  });
});
