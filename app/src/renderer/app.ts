/**
 * Renderer entry. Draws the fairy, and opens the chat window when she is clicked.
 *
 * The chat surface itself is a separate window (main/chat-window.ts) and not part of this one:
 * the overlay is click-through by default, and a click-through window cannot receive a
 * keystroke, so nothing typed into it would ever arrive.
 */

import { createFairy, emotionColor } from './fairy.js';
import { createLoop } from './loop.js';

declare global {
  interface Window {
    navi?: {
      onClickThrough(fn: (on: boolean) => void): void;
      onSummoned(fn: () => void): void;
      onTint(fn: (c: { r: number; g: number; b: number }) => void): void;
      onBusy(fn: (busy: boolean) => void): void;
      requestChat(): void;
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

// She is working: a pale pulse at her core for as long as the turn runs.
const WORKING_LIGHT = { r: 190, g: 210, b: 255, pulsing: true };

window.navi?.onSummoned(() => loop.markActive());
window.navi?.onTint((c) => {
  fairy.setTint(c);
  loop.markActive();
});
window.navi?.onBusy((busy) => {
  fairy.setStatusLight(busy ? WORKING_LIGHT : null);
  loop.markActive();
});
// A cursor arriving over the fairy is motion worth spending frames on.
window.navi?.onClickThrough((on) => {
  if (!on) loop.markActive();
});

// The main process only lets a click reach this window while the cursor is actually over her
// body, so this cannot fire from a click on the transparent aura around her.
canvas.addEventListener('click', () => {
  window.navi?.requestChat();
  loop.markActive();
});
