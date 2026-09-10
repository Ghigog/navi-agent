/**
 * The chat surface.
 *
 * Deliberately thin. It renders what the main process reports and sends what the user types;
 * it holds no conversation state, decides nothing about tools, and never touches the reply
 * text. Streamed deltas are appended exactly as they arrive — NAV-84 is the reason that is
 * worth stating: the Godot build parsed control tags out of the stream it was rendering, so a
 * partial tag reached the screen and any model that merely mentioned one triggered it. Text is
 * only ever text.
 */

import type { ChatEvent } from '../main/conversation.js';
import { createRecorder } from './mic.js';

declare global {
  interface Window {
    naviChat?: {
      ready(): void;
      send(text: string): void;
      cancel(): void;
      hide(): void;
      openSettings(): void;
      onEvent(fn: (event: ChatEvent) => void): void;
      onFocus(fn: () => void): void;
      onListen(fn: (on: boolean) => void): void;
      onTranscript(fn: (text: string) => void): void;
      audio(wav: Uint8Array | null): void;
      voiceError(message: string): void;
    };
  }
}

const transcript = document.getElementById('transcript') as HTMLDivElement;
const empty = document.getElementById('empty') as HTMLDivElement;
const input = document.getElementById('input') as HTMLTextAreaElement;
const status = document.getElementById('status') as HTMLSpanElement;
const mood = document.getElementById('mood') as HTMLDivElement;
const provider = document.getElementById('provider') as HTMLDivElement;
const dot = document.getElementById('dot') as HTMLDivElement;

let busy = false;
/** The bubble currently being streamed into, if any. */
let reply: HTMLDivElement | null = null;

function atBottom(): boolean {
  return transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 40;
}

function bubble(kind: 'user' | 'navi' | 'error' | 'note', text: string): HTMLDivElement {
  empty.remove();
  // Follow the stream only when the user is already at the bottom. Scrolling up to re-read
  // something and being yanked back down by the next token is worse than missing a line.
  const follow = atBottom();
  const el = document.createElement('div');
  el.className = `msg ${kind}`;
  el.textContent = text;
  transcript.append(el);
  if (follow) transcript.scrollTop = transcript.scrollHeight;
  return el;
}

function setBusy(next: boolean): void {
  busy = next;
  input.disabled = next;
  dot.classList.toggle('busy', next);
  if (!next) {
    status.textContent = '';
    input.focus();
  }
}

function send(): void {
  const text = input.value.trim();
  if (text === '' || busy) return;
  input.value = '';
  input.style.height = 'auto';
  bubble('user', text);
  window.naviChat?.send(text);
}

input.addEventListener('input', () => {
  // Grow with the message, up to the max-height the stylesheet sets.
  input.style.height = 'auto';
  input.style.height = `${input.scrollHeight}px`;
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

// Escape stops the turn if one is running, and otherwise closes the window. Two jobs for one
// key because it is the key people press to get out of something, and mid-reply "get out of
// this" means the reply, not the window.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (busy) window.naviChat?.cancel();
  else window.naviChat?.hide();
});

document.getElementById('settings')?.addEventListener('click', () => window.naviChat?.openSettings());

// The conventional shortcut, handled here because a frameless overlay app has no menu bar to
// hang it on.
document.addEventListener('keydown', (e) => {
  if (e.key === ',' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    window.naviChat?.openSettings();
  }
});

window.naviChat?.onFocus(() => input.focus());

window.naviChat?.onEvent((event) => {
  switch (event.type) {
    case 'provider':
      provider.textContent = `${event.remote ? 'cloud' : 'local'} · ${event.model}`;
      provider.classList.toggle('remote', event.remote);
      provider.title = event.remote
        ? 'What you type is sent to a hosted provider.'
        : 'What you type stays on this machine.';
      break;

    case 'emotion':
      mood.textContent = `${event.emotion} · ${event.relationship.replace('_', ' ')}`;
      dot.style.background = `rgb(${event.tint.r}, ${event.tint.g}, ${event.tint.b})`;
      break;

    case 'start':
      setBusy(true);
      status.textContent = 'thinking…';
      reply = null;
      break;

    case 'delta':
      reply ??= bubble('navi', '');
      reply.textContent += event.text;
      if (atBottom()) transcript.scrollTop = transcript.scrollHeight;
      break;

    case 'tool':
      status.textContent =
        event.state === 'start'
          ? `${event.name}…`
          : event.state === 'fail'
            ? `${event.name} failed`
            : `${event.name} done`;
      break;

    case 'done':
      // A turn can finish having said nothing at all — a small model that called a tool and
      // then stopped. Saying so beats an empty pause the user has to interpret.
      if (event.cancelled) bubble('note', 'stopped');
      else if (event.text === '') bubble('note', 'she had nothing to say');
      reply = null;
      setBusy(false);
      break;

    case 'error':
      bubble('error', event.message);
      reply = null;
      setBusy(false);
      break;

    case 'reminder':
      bubble('note', `⏰ ${event.text}`);
      break;

    case 'listening':
      // Shown rather than assumed. A recording nobody can see running is a recording nobody
      // knows how to stop.
      status.textContent = event.on ? 'listening…' : '';
      dot.classList.toggle('listening', event.on);
      break;
  }
});

/**
 * The talk key (NAV-104).
 *
 * The main process decides when to listen — it owns the global shortcut — and this window does
 * the listening, because the microphone is only reachable from a renderer. A failure here shows
 * up in the transcript and stops there: not being able to hear must never cost a turn she could
 * still have had by keyboard.
 */
const recorder = createRecorder((message) => window.naviChat?.voiceError(message));

// A spoken message is the user's message. It appears in the transcript the same way a typed
// one does; the difference is only how it got here.
window.naviChat?.onTranscript((text) => bubble('user', text));

window.naviChat?.onListen((on) => {
  if (on) {
    void recorder.start();
    return;
  }
  void recorder.stop().then((wav) => window.naviChat?.audio(wav));
});

window.naviChat?.ready();
