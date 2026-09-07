import { describe, expect, it } from 'vitest';
import { isOverFairy } from '../src/shared/geometry.js';

// A 200px window whose top-left is at (500, 300), so its centre is (600, 400).
const BOUNDS = { x: 500, y: 300, width: 200, height: 200 };

describe('isOverFairy', () => {
  it('is true at the centre', () => {
    expect(isOverFairy({ x: 600, y: 400 }, BOUNDS)).toBe(true);
  });

  it('is true just inside the interactive radius', () => {
    expect(isOverFairy({ x: 600 + 45, y: 400 }, BOUNDS)).toBe(true);
  });

  it('is false just outside it', () => {
    expect(isOverFairy({ x: 600 + 47, y: 400 }, BOUNDS)).toBe(false);
  });

  it('is false in the window corners', () => {
    // The window is mostly transparent aura. Taking clicks across all 200px would drag a dead
    // zone around the desktop behind the cursor, which is the failure this guards.
    expect(isOverFairy({ x: 500, y: 300 }, BOUNDS)).toBe(false);
    expect(isOverFairy({ x: 700, y: 500 }, BOUNDS)).toBe(false);
  });

  it('measures radially, not per-axis', () => {
    // (32, 32) from centre is 45.3 away — inside a 46 radius but outside a naive box test.
    expect(isOverFairy({ x: 632, y: 432 }, BOUNDS)).toBe(true);
    // (34, 34) is 48.1 away — outside.
    expect(isOverFairy({ x: 634, y: 434 }, BOUNDS)).toBe(false);
  });
});
