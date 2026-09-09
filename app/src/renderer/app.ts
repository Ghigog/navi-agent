/**
 * Renderer entry. Draws the fairy and nothing else for now — the chat surface and settings
 * are still to come.
 */

import { createFairy, emotionColor } from './fairy.js';
import { createLoop } from './loop.js';

declare global {
  interface Window {
    navi?: {
      onClickThrough(fn: (on: boolean) => void): void;
      onSummoned(fn: () => void): void;
      onTint(fn: (c: { r: number; g: number; b: number }) => void): void;
    };
  }
}

const canvas = document.getElementById('fairy') as HTMLCanvasElement;
const fairy = createFairy(canvas, { size: 200 });

// Neutral until the main process sends her real state, which it does as soon as this window
// finishes loading. Drawing nothing until then would show an empty screen on every launch.
fairy.setTint(emotionColor(0, 0, 0, 0));

const loop = createLoop({
  idleFps: 30,
  activeFps: 60,
  render: (t, dt) => fairy.draw(t, dt),
});
loop.start();

window.navi?.onSummoned(() => loop.markActive());
window.navi?.onTint((c) => {
  fairy.setTint(c);
  loop.markActive();
});
// A cursor arriving over the fairy is motion worth spending frames on.
window.navi?.onClickThrough((on) => {
  if (!on) loop.markActive();
});
