/**
 * Renderer entry. Draws the fairy, and opens the chat window when she is clicked.
 *
 * The chat surface itself is a separate window (main/chat-window.ts) and not part of this one:
 * the overlay is click-through by default, and a click-through window cannot receive a
 * keystroke, so nothing typed into it would ever arrive.
 */

import { createFairy, emotionColor } from './fairy.js';
import { createLoop } from './loop.js';
import { DEFAULTS } from '../shared/settings.js';

declare global {
  interface Window {
    navi?: {
      onClickThrough(fn: (on: boolean) => void): void;
      onSummoned(fn: () => void): void;
      onTint(fn: (c: { r: number; g: number; b: number }) => void): void;
      onBusy(fn: (busy: boolean) => void): void;
      onRates(fn: (r: { idle: number; active: number }) => void): void;
      onPoint(fn: (relative: { x: number; y: number } | null) => void): void;
      onActing(fn: (acting: boolean) => void): void;
      requestChat(): void;
    };
  }
}

const canvas = document.getElementById('fairy') as HTMLCanvasElement;
const fairy = createFairy(canvas, { size: 200 });

// Neutral until the main process sends her real state, which it does as soon as this window
// finishes loading. Drawing nothing until then would show an empty screen on every launch.
fairy.setTint(emotionColor(0, 0, 0, 0));

// The defaults, until the main process sends what is actually configured — which it does as
// soon as this window finishes loading, alongside her restored state.
const loop = createLoop({
  idleFps: DEFAULTS.idleFps,
  activeFps: DEFAULTS.activeFps,
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
window.navi?.onRates((r) => loop.setRates(r.idle, r.active));
// A flight is the most motion she ever makes, and the arrow has to keep up with it.
window.navi?.onPoint((relative) => {
  fairy.setPointer(relative);
  loop.markActive();
});
// She is acting on the machine: an amber light, distinct from the pale one that means thinking.
// NAV-91 requires this to be visible whenever a write is in flight — the user must always know.
const ACTING_LIGHT = { r: 255, g: 191, b: 0, pulsing: true };
window.navi?.onActing((acting) => {
  fairy.setStatusLight(acting ? ACTING_LIGHT : null);
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
