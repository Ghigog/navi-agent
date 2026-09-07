/**
 * The overlay window.
 *
 * Every option here was verified by the NAV-94 spike on macOS before the port began; see
 * ADR 0001 for the measured results. Change one and you are changing something that was tested,
 * so re-run the spike's checks rather than assuming.
 */

import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';

// The main bundle is emitted as CommonJS, so `__dirname` is the path that survives bundling.
// `import.meta.url` does not: esbuild leaves it undefined in a CJS output and the window then
// loads nothing, silently.
declare const __dirname: string;
const here = __dirname;

export const SIZE = 200;
/** The fairy sits down-right of the cursor, as she did in the Godot build. */
export const FOLLOW_OFFSET = { x: 20, y: 20 };

export function createOverlay(): BrowserWindow {
  const cursor = screen.getCursorScreenPoint();

  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    x: Math.round(cursor.x + FOLLOW_OFFSET.x),
    y: Math.round(cursor.y + FOLLOW_OFFSET.y),
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');

  // macOS native fullscreen still moves the focused app to its own Space and leaves the overlay
  // behind. That is deliberate and wanted: NAV-96 requires ambient presence never to interrupt
  // a full-screen presentation, so the OS enforces a rule the design already had.
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.loadFile(join(here, '../renderer/index.html'));
  return win;
}
