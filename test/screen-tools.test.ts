/**
 * The screen tools (NAV-103).
 *
 * The test that matters most is "crops around the cursor as it was when they asked". That is
 * NAV-99, and it is the difference between a companion who answers about the thing you were
 * looking at and one who answers about wherever your hand happened to leave the mouse.
 */

import { describe, expect, it } from 'vitest';
import {
  createScreenTools,
  NO_ANCHOR,
  NO_SCREEN_ACCESS,
  type CapturedImage,
  type ScreenAccess,
  type ScreenPort,
} from '../src/agent/screen.js';
import type { Rect } from '../src/shared/capture.js';
import type { Bounds, Point } from '../src/shared/geometry.js';

const DISPLAY: Bounds = { x: 0, y: 0, width: 1440, height: 900 };

function fakeScreen(access: ScreenAccess = 'granted', display: Bounds = DISPLAY) {
  const captures: Array<Rect | undefined> = [];
  const port: ScreenPort = {
    access: () => access,
    displayAt: () => display,
    pixelSize: () => ({ width: display.width * 2, height: display.height * 2 }),
    capture: async (_d, region): Promise<CapturedImage> => {
      captures.push(region);
      return { base64: 'AAAA', width: region?.width ?? display.width, height: region?.height ?? display.height };
    },
  };
  return { port, captures };
}

function stand(access: ScreenAccess = 'granted', display: Bounds = DISPLAY) {
  const screen = fakeScreen(access, display);
  const flights: Point[] = [];
  let cursor: Point = { x: 0, y: 0 };

  const marked: Point[] = [];
  const tools = createScreenTools({
    screen: screen.port,
    cursor: () => cursor,
    point: async (target) => {
      flights.push(target);
    },
    markAnchor: (point) => marked.push(point),
  });

  const byName = (name: string) => {
    const tool = tools.tools.find((t) => t.schema.name === name);
    if (!tool) throw new Error(`no tool named ${name}`);
    return tool;
  };

  return {
    tools,
    flights,
    marked,
    captures: screen.captures,
    moveCursorTo: (p: Point) => {
      cursor = p;
    },
    run: (name: string, args: Record<string, unknown> = {}) => byName(name).run(args),
    schema: (name: string) => byName(name).schema,
  };
}

describe('the registered tools', () => {
  it('offers looking, looking closely, and pointing', () => {
    const s = stand();
    expect(s.tools.tools.map((t) => t.schema.name)).toEqual([
      'look_at_screen',
      'look_near_cursor',
      'point_to',
    ]);
  });
});

describe('look_near_cursor', () => {
  it('crops around the cursor as it was when the user asked, not where it is now', () => {
    // This is NAV-99. The user asks about something at (300, 200), then reaches for their
    // coffee while Navi thinks; the crop must still be about the thing they asked about.
    const s = stand();
    s.moveCursorTo({ x: 300, y: 200 });
    s.tools.freeze();
    s.moveCursorTo({ x: 1400, y: 880 });

    return s.run('look_near_cursor').then((result) => {
      const region = s.captures[0];
      expect(region).toBeDefined();
      // In image pixels, so the anchor doubles: the fake display is 2x.
      expect(region!.x + region!.width / 2).toBe(600);
      expect(region!.y + region!.height / 2).toBe(400);
      expect(result.cursorAnchored).toBe(true);
      expect(result.imageBase64).toBe('AAAA');
    });
  });

  it('takes the picture once', async () => {
    const s = stand();
    s.tools.freeze();
    await s.run('look_near_cursor');
    expect(s.captures).toHaveLength(1);
  });

  it('shows the user where it looked, so a wrong answer can be caught (NAV-99)', async () => {
    // The failure NAV-99 exists to fix survived because a user could not tell where she had
    // looked: a confident answer about the wrong window reads exactly like a confident answer
    // about the right one. The ring is how a person catches it.
    const s = stand();
    s.moveCursorTo({ x: 300, y: 200 });
    s.tools.freeze();
    await s.run('look_near_cursor');

    expect(s.marked).toEqual([{ x: 300, y: 200 }]);
  });

  it('marks the frozen point, not where the cursor has since gone', async () => {
    const s = stand();
    s.moveCursorTo({ x: 300, y: 200 });
    s.tools.freeze();
    s.moveCursorTo({ x: 1400, y: 880 });
    await s.run('look_near_cursor');

    expect(s.marked).toEqual([{ x: 300, y: 200 }]);
  });

  it('says so rather than capturing when the cursor was never sampled', async () => {
    const s = stand();
    const result = await s.run('look_near_cursor');
    expect(result.isError).toBe(true);
    expect(result.content).toBe(NO_ANCHOR);
    expect(s.captures).toHaveLength(0);
  });
});

describe('look_at_screen', () => {
  it('captures the whole display, uncropped and unanchored', async () => {
    const s = stand();
    s.tools.freeze();
    const result = await s.run('look_at_screen');
    expect(s.captures[0]).toBeUndefined();
    expect(result.cursorAnchored).toBeUndefined();
    expect(result.imageBase64).toBe('AAAA');
  });

  it('marks nothing, because it did not look anywhere in particular', async () => {
    const s = stand();
    s.tools.freeze();
    await s.run('look_at_screen');
    expect(s.marked).toEqual([]);
  });
});

describe('a denied Screen Recording permission', () => {
  it('produces a refusal with a next step, not a blank image', async () => {
    const s = stand('denied');
    s.tools.freeze();

    for (const name of ['look_at_screen', 'look_near_cursor']) {
      const result = await s.run(name);
      expect(result.isError).toBe(true);
      expect(result.content).toBe(NO_SCREEN_ACCESS);
      expect(result.imageBase64).toBeUndefined();
    }
    expect(s.captures).toHaveLength(0);
    // And no ring: pointing at a place she could not see would be a lie told in amber.
    expect(s.marked).toEqual([]);
  });

  it('still lets her point, which needs no permission at all', async () => {
    const s = stand('denied');
    const result = await s.run('point_to', { x: 500, y: 500 });
    expect(result.isError).toBeUndefined();
    expect(s.flights).toEqual([{ x: 720, y: 450 }]);
  });

  it('tries anyway when macOS has not been asked yet, so the OS gets to ask', async () => {
    const s = stand('unknown');
    s.tools.freeze();
    const result = await s.run('look_at_screen');
    expect(result.isError).toBeUndefined();
    expect(s.captures).toHaveLength(1);
  });
});

describe('point_to', () => {
  it('maps the 0-1000 grid onto the display she was asked about', async () => {
    const second: Bounds = { x: 1440, y: 0, width: 1920, height: 1080 };
    const s = stand('granted', second);
    await s.run('point_to', { x: 250, y: 500 });
    expect(s.flights).toEqual([{ x: 1920, y: 540 }]);
  });

  it('refuses a coordinate it cannot read rather than flying somewhere arbitrary', async () => {
    const s = stand();
    const result = await s.run('point_to', { x: 'over there', y: 4 });
    expect(result.isError).toBe(true);
    expect(s.flights).toHaveLength(0);
  });

  it('accepts the numbers a model sends as strings', async () => {
    const s = stand();
    await s.run('point_to', { x: '500', y: '500' });
    expect(s.flights).toEqual([{ x: 720, y: 450 }]);
  });
});
