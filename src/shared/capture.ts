/**
 * Screen-capture geometry (NAV-103, carrying NAV-99).
 *
 * Pure, and separate from `main/screen.ts`, because this is the part that was wrong in the
 * Godot build and the part no display is needed to test. NAV-99's fix was to anchor the crop on
 * where the cursor was *when the user asked* rather than on the fairy's own body; that decision
 * lives in the caller, but the arithmetic that turns a screen point into a rectangle of image
 * pixels lives here, where a test can pin it.
 *
 * Two coordinate spaces meet in this file and confusing them is the whole hazard:
 *
 *   screen points  what Electron's `screen` module deals in. The cursor, display bounds and
 *                  window positions are all in these.
 *   image pixels   what a capture is made of. On a Retina display there are two of them per
 *                  screen point in each axis, so an unscaled crop lands at half the offset,
 *                  which looks like "close, but up and to the left" rather than like a bug.
 */

import type { Bounds, Point } from './geometry.js';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * Side of the cursor-anchored crop, in screen points.
 *
 * The Godot build used 600 image pixels, which meant the crop covered half as much desk on a
 * Retina display as on a plain one — the same number of pixels, a different amount of *screen*.
 * Measuring in points instead makes "what's this near my cursor?" cover the same area whatever
 * it is running on. Big enough to catch a dialog or a paragraph, small enough that a 3B model
 * is not asked to find a needle in a desktop.
 */
export const CROP_POINTS = 400;

/**
 * The rectangle of image pixels to crop, centred on `anchor` and clamped inside the image.
 *
 * Clamped rather than padded: a cursor in the corner of the screen still gets a full-size crop,
 * just one that is not centred on it. An image smaller than the crop is returned whole.
 */
export function cropRect(anchor: Point, display: Bounds, image: Size, cropPoints = CROP_POINTS): Rect {
  // Derived from the image rather than passed in, so a capture that came back at a size nobody
  // predicted — a scaled thumbnail, a display change mid-turn — still crops in the right place.
  const scaleX = display.width > 0 ? image.width / display.width : 1;
  const scaleY = display.height > 0 ? image.height / display.height : 1;

  const width = Math.min(Math.round(cropPoints * scaleX), image.width);
  const height = Math.min(Math.round(cropPoints * scaleY), image.height);

  const cx = (anchor.x - display.x) * scaleX;
  const cy = (anchor.y - display.y) * scaleY;

  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

  return {
    x: clamp(Math.round(cx - width / 2), 0, image.width - width),
    y: clamp(Math.round(cy - height / 2), 0, image.height - height),
    width,
    height,
  };
}

/**
 * Coordinate space the model points in.
 *
 * A model that has just been shown an image has no idea what resolution the display is, and
 * asking it for pixels invites it to invent a plausible-looking pair. A fixed 0-1000 grid over
 * whatever display the capture came from is the convention the Godot build used
 * (`NaviUtils.map_normalized_coordinate_to_screen`) and it is worth keeping: it is the same
 * arithmetic on every machine, and out-of-range values clamp to an edge instead of flying her
 * off the desktop.
 */
export const POINT_GRID = 1000;

export function normalisedToScreen(x: number, y: number, display: Bounds): Point {
  const clamp = (v: number): number => Math.max(0, Math.min(POINT_GRID, v));
  return {
    x: Math.round(display.x + (clamp(x) / POINT_GRID) * display.width),
    y: Math.round(display.y + (clamp(y) / POINT_GRID) * display.height),
  };
}
