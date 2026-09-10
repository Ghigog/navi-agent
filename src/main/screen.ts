/**
 * Reading the screen, on Electron (NAV-103).
 *
 * Everything platform-shaped about seeing lives here and nothing else does: which display a
 * point is on, how to get its pixels, how to encode them, and how macOS says no. The decisions
 * that use any of it are in `agent/screen.ts`, behind the `ScreenPort` this file implements.
 *
 * No native helper is involved. `desktopCapturer` reads pixels perfectly well; NAV-90's helper
 * is for the accessibility tree and for synthesising input, neither of which this needs.
 */

import { desktopCapturer, screen, systemPreferences, shell } from 'electron';
import type { CapturedImage, ScreenAccess, ScreenPort } from '../agent/screen.js';
import type { Rect, Size } from '../shared/capture.js';
import type { Bounds, Point } from '../shared/geometry.js';

/**
 * Longest side a capture is resized to before it reaches the model, in pixels.
 *
 * A 5K display is ~15 megapixels and several megabytes of JPEG, and no local 3B vision model
 * reads any of that; it costs latency and context and buys nothing. The crop keeps more detail
 * per unit of screen precisely because it covers less screen — which is the argument for
 * `look_near_cursor` over `look_at_screen` in the first place.
 */
export const FULL_MAX_EDGE = 1280;
export const CROP_MAX_EDGE = 768;

/** JPEG rather than PNG: a photograph of a desktop, not a diagram, and a third of the bytes. */
const JPEG_QUALITY = 80;

/**
 * macOS Screen Recording, as a yes or a no.
 *
 * `not-determined` is reported as `unknown` rather than `denied` on purpose: the first capture
 * attempt is what raises the system prompt, so a Navi that refused to try would never get
 * asked for. Let her try, and let the OS ask. Every other platform has no such gate and reports
 * `granted`.
 */
export function screenAccess(): ScreenAccess {
  if (process.platform !== 'darwin') return 'granted';
  const status = systemPreferences.getMediaAccessStatus('screen');
  if (status === 'granted') return 'granted';
  if (status === 'denied' || status === 'restricted') return 'denied';
  return 'unknown';
}

/** Opens the pane the user has to visit. There is no API to request this permission. */
export function openScreenRecordingSettings(): void {
  void shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  );
}

function fit(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function createScreenPort(): ScreenPort {
  return {
    access: screenAccess,

    displayAt(point: Point): Bounds {
      return screen.getDisplayNearestPoint(point).bounds;
    },

    pixelSize(display: Bounds): Size {
      const { scaleFactor } = screen.getDisplayNearestPoint({ x: display.x, y: display.y });
      return {
        width: Math.round(display.width * scaleFactor),
        height: Math.round(display.height * scaleFactor),
      };
    },

    async capture(display: Bounds, region?: Rect): Promise<CapturedImage> {
      const match = screen.getDisplayNearestPoint({ x: display.x, y: display.y });
      // Asked for at the display's real pixel size. Anything smaller here is detail that cannot
      // be recovered by the crop later, and the crop is the one that needs it.
      const thumbnailSize = {
        width: Math.round(display.width * match.scaleFactor),
        height: Math.round(display.height * match.scaleFactor),
      };

      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
      const source =
        sources.find((s) => s.display_id === String(match.id)) ?? sources[0];
      if (!source || source.thumbnail.isEmpty()) {
        // Reached when the OS returns an empty picture rather than an error, which is what a
        // just-revoked permission looks like. Saying so is the difference between a refusal and
        // a hallucination.
        throw new Error(
          'The screen capture came back empty. This usually means macOS Screen Recording ' +
            'permission is missing or was revoked while Navi was running.',
        );
      }

      let image = source.thumbnail;
      if (region) image = image.crop(region);

      const { width, height } = image.getSize();
      const target = fit(width, height, region ? CROP_MAX_EDGE : FULL_MAX_EDGE);
      if (target.width !== width || target.height !== height) {
        image = image.resize({ ...target, quality: 'good' });
      }

      const size = image.getSize();
      return {
        base64: image.toJPEG(JPEG_QUALITY).toString('base64'),
        width: size.width,
        height: size.height,
      };
    },
  };
}
