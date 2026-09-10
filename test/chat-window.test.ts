import { describe, expect, it } from 'vitest';
import { chatBounds, CHAT_GAP, INTERACTIVE_RADIUS } from '../src/shared/geometry.js';

// A 200px fairy window at (500, 300), so her body is centred on (600, 400).
const FAIRY = { x: 500, y: 300, width: 200, height: 200 };
const SIZE = { width: 380, height: 440 };
const SCREEN = { x: 0, y: 0, width: 1440, height: 900 };

describe('chatBounds', () => {
  it('centres the panel on her', () => {
    const bounds = chatBounds(FAIRY, SIZE, SCREEN);
    expect(bounds.x + bounds.width / 2).toBe(600);
  });

  it('measures from her body, not from her window', () => {
    // The window is 200px of mostly transparent aura. Measuring from its edge would leave the
    // panel floating ~75px clear of her with nothing in between.
    expect(chatBounds(FAIRY, SIZE, SCREEN).y).toBe(400 + INTERACTIVE_RADIUS + CHAT_GAP);
  });

  it('goes above her when there is no room below', () => {
    const low = { ...FAIRY, y: 700 };
    const bounds = chatBounds(low, SIZE, SCREEN);
    expect(bounds.y).toBe(800 - INTERACTIVE_RADIUS - CHAT_GAP - SIZE.height);
  });

  it('stays on screen when she is against an edge', () => {
    for (const fairy of [
      { ...FAIRY, x: -80, y: -60 },
      { ...FAIRY, x: 1380, y: 820 },
    ]) {
      const bounds = chatBounds(fairy, SIZE, SCREEN);
      expect(bounds.x).toBeGreaterThanOrEqual(SCREEN.x);
      expect(bounds.y).toBeGreaterThanOrEqual(SCREEN.y);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(SCREEN.x + SCREEN.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(SCREEN.y + SCREEN.height);
    }
  });

  it('respects a work area that does not start at the origin', () => {
    // A second display, or a menu bar and a dock. The panel belongs inside the usable area.
    const workArea = { x: 1440, y: 25, width: 1280, height: 780 };
    const bounds = chatBounds({ ...FAIRY, x: 2600, y: 600 }, SIZE, workArea);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(workArea.x + workArea.width);
    expect(bounds.y).toBeGreaterThanOrEqual(workArea.y);
  });

  it('keeps the top edge visible on a screen too short for it', () => {
    // Losing the bottom of the transcript is survivable. Losing the input box is not.
    const short = { x: 0, y: 0, width: 1440, height: 300 };
    expect(chatBounds(FAIRY, SIZE, short).y).toBe(0);
  });
});
