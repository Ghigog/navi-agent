/**
 * The screen tools (NAV-103). Seeing, and pointing at what she saw.
 *
 * This is the product. The owner's description of Navi leads with "what's this near my cursor?",
 * and until these are registered the `ToolRegistry` is empty and the answer is nothing.
 *
 * No Electron import. Capturing pixels and moving a window are both platform work and both
 * arrive as ports, so the decisions — which display, where the crop goes, what she is told when
 * permission is refused — run under test without a display. `main/screen.ts` supplies the real
 * capture; `main/index.ts` supplies the rest.
 *
 * NAV-99 is the reason `freeze()` exists. The crop must be centred on where the cursor was when
 * the user pressed return, not on where it is when the model gets round to asking. Those are
 * different places: she takes a second to think, and in that second the user has moved the mouse
 * to reach for their coffee. Reading the live cursor inside `run()` is the original bug wearing
 * new clothes, so the live cursor is not reachable from in here at all — only the frozen sample.
 */

import { cropRect, normalisedToScreen, POINT_GRID, type Rect, type Size } from '../shared/capture.js';
import type { Bounds, Point } from '../shared/geometry.js';
import type { Tool, ToolResult } from './tools.js';

/** Whether the platform will let us read the screen at all. macOS is the one that says no. */
export type ScreenAccess = 'granted' | 'denied' | 'unknown';

export interface CapturedImage {
  /** JPEG bytes, base64. */
  base64: string;
  width: number;
  height: number;
}

/**
 * Reading pixels, reduced to what the tools need. `main/screen.ts` implements it over
 * `desktopCapturer`; a test implements it in four lines.
 */
export interface ScreenPort {
  access(): ScreenAccess;
  /** The display containing `point`, in screen points. */
  displayAt(point: Point): Bounds;
  /**
   * The size a capture of that display will be, in image pixels, before any downscaling.
   *
   * Separate from `capture` so a crop can be worked out without taking the picture twice: the
   * rectangle is in the coordinates of the full-resolution capture, and this is how those
   * coordinates are known in advance. On a Retina display it is twice the display's size in
   * points, which is the factor NAV-99's crop is wrong by if you forget it.
   */
  pixelSize(display: Bounds): Size;
  /** The whole of that display, as an image. `region` crops it, in image pixels. */
  capture(display: Bounds, region?: Rect): Promise<CapturedImage>;
}

export interface ScreenToolsDeps {
  screen: ScreenPort;
  /** The live cursor. Read only by `freeze()`; see the note at the top of this file. */
  cursor(): Point;
  /**
   * Flies her onto a screen point and points at it (NAV-102's `flyTo`).
   *
   * Awaited, so the model's next iteration happens after she has arrived rather than while she
   * is still crossing the screen — "it's over there" reads oddly when she is still here.
   */
  point(target: Point): Promise<void>;
}

export interface ScreenTools {
  tools: Tool[];
  /**
   * Takes the cursor sample this turn will be anchored on. Call it the instant a message is
   * accepted, before anything async (NAV-99).
   */
  freeze(): void;
}

/**
 * What she says when the OS will not let her look.
 *
 * A real sentence rather than an error code, and it goes back as a tool error so the model has
 * to account for it: the alternative — a blank image, or silence — is what makes a companion
 * describe a screen she never saw. NAV-92's checklist is where the user actually fixes it.
 */
export const NO_SCREEN_ACCESS =
  'Screen capture is blocked: macOS has not granted Navi Screen Recording permission, so there is ' +
  'no image to look at. Tell the user plainly that you cannot see their screen and that they can ' +
  'grant it in System Settings › Privacy & Security › Screen Recording, then restart Navi. Do not ' +
  'guess at what is on screen.';

/** What she says when she was asked to look before she was asked anything at all. */
export const NO_ANCHOR =
  'There is no cursor sample for this turn, so a cursor-anchored crop cannot be taken. Use ' +
  'look_at_screen instead, or ask the user to point at what they mean.';

export function createScreenTools(deps: ScreenToolsDeps): ScreenTools {
  /**
   * The cursor as it was when the user asked. Null before the first message of the session —
   * a tool call cannot arrive before one, but the type says so rather than the comment.
   */
  let anchor: Point | null = null;

  const blocked = (): ToolResult | null =>
    deps.screen.access() === 'denied' ? { content: NO_SCREEN_ACCESS, isError: true } : null;

  const lookAtScreen: Tool = {
    schema: {
      name: 'look_at_screen',
      description:
        "Look at the user's screen as it is right now. Use this for questions about what is on " +
        'screen generally, what application they are in, or what an error says. Prefer ' +
        'look_near_cursor when they say "this", "here", or "near my cursor".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    async run(): Promise<ToolResult> {
      const refusal = blocked();
      if (refusal) return refusal;

      const at = anchor ?? deps.cursor();
      const display = deps.screen.displayAt(at);
      const image = await deps.screen.capture(display);
      return {
        content: `Captured the whole screen (${image.width}×${image.height}). The image follows.`,
        imageBase64: image.base64,
      };
    },
  };

  const lookNearCursor: Tool = {
    schema: {
      name: 'look_near_cursor',
      description:
        'Look closely at the small area of screen around the user\'s cursor, frozen at the moment ' +
        'they sent their message. This is the tool for "what\'s this?", "what does this say?", ' +
        '"what am I looking at?" and anything else where "this" means the thing under their pointer.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    async run(): Promise<ToolResult> {
      const refusal = blocked();
      if (refusal) return refusal;
      if (anchor === null) return { content: NO_ANCHOR, isError: true };

      const display = deps.screen.displayAt(anchor);
      // The rectangle first, the picture second. `desktopCapturer` only offers whole displays,
      // so the crop happens on our side either way — but asking the port how big the capture
      // will be means taking it once rather than twice.
      const region = cropRect(anchor, display, deps.screen.pixelSize(display));
      const image = await deps.screen.capture(display, region);

      return {
        content:
          `Captured a ${region.width}×${region.height} crop centred on the cursor as it was when ` +
          'the user sent their message. The image follows.',
        imageBase64: image.base64,
        cursorAnchored: true,
      };
    },
  };

  const pointTo: Tool = {
    schema: {
      name: 'point_to',
      description:
        'Fly to a place on the screen and point at it, so the user can see which thing you mean. ' +
        'Use it when they ask you to show, point out, find or highlight something, or when you are ' +
        'talking about something you can see in an image you have just been given. Do not use it ' +
        'to reposition yourself for no reason.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: `Horizontal position, 0 (left edge) to ${POINT_GRID} (right edge).` },
          y: { type: 'number', description: `Vertical position, 0 (top edge) to ${POINT_GRID} (bottom edge).` },
        },
        required: ['x', 'y'],
      },
    },
    async run(args): Promise<ToolResult> {
      const x = Number(args['x']);
      const y = Number(args['y']);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { content: `x and y must be numbers between 0 and ${POINT_GRID}.`, isError: true };
      }

      // The display she points on is the one the question was about — the one the cursor was on
      // when they asked. On a two-monitor desk, pointing at "the top left" of the wrong screen
      // is worse than not pointing at all.
      const display = deps.screen.displayAt(anchor ?? deps.cursor());
      const target = normalisedToScreen(x, y, display);
      await deps.point(target);
      return { content: `Pointing at (${target.x}, ${target.y}) on the user's screen.` };
    },
  };

  return {
    tools: [lookAtScreen, lookNearCursor, pointTo],
    freeze() {
      anchor = { ...deps.cursor() };
    },
  };
}
