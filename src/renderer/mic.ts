/**
 * The microphone (NAV-104).
 *
 * It lives in a renderer because `getUserMedia` does, and in the *chat* renderer specifically
 * because the overlay is click-through and the settings window is not always open. The window
 * need not be visible: a hidden `BrowserWindow` still runs its scripts, so the talk key works
 * with the chat panel closed.
 *
 * Raw samples rather than `MediaRecorder`, which would give WebM/Opus and leave a decode
 * problem on the far side. `whisper-cli` reads 16 kHz mono WAV, `shared/wav.ts` writes exactly
 * that, and nothing in between needs a codec.
 */

import { downsample, encodeWav, WHISPER_RATE } from '../shared/wav.js';

/** Shorter than this and it is a mis-press, not a sentence. Transcribing it wastes a second. */
export const MIN_TAKE_SECONDS = 0.35;

/** A runaway recording — the key pressed once and forgotten — is stopped rather than kept. */
export const MAX_TAKE_SECONDS = 60;

export interface Recorder {
  start(): Promise<void>;
  /** Returns the take as WAV bytes, or null when there was not enough of one. */
  stop(): Promise<Uint8Array | null>;
  recording(): boolean;
}

export function createRecorder(onError?: (message: string) => void): Recorder {
  let context: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let chunks: Float32Array[] = [];
  let active = false;

  const teardown = (): void => {
    for (const track of stream?.getTracks() ?? []) track.stop();
    void context?.close().catch(() => {});
    context = null;
    stream = null;
    active = false;
  };

  return {
    recording: () => active,

    async start() {
      if (active) return;
      chunks = [];
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        context = new AudioContext();
        const source = context.createMediaStreamSource(stream);
        // Deprecated, and the replacement (AudioWorklet) needs a separate module file loaded
        // over a URL, which a file:// renderer cannot do without more machinery than this
        // deserves. Revisit when it actually stops working.
        const processor = context.createScriptProcessor(4096, 1, 1);

        processor.onaudioprocess = (event) => {
          if (!active) return;
          chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
          if (chunks.length * 4096 > (context?.sampleRate ?? WHISPER_RATE) * MAX_TAKE_SECONDS) {
            active = false;
          }
        };

        source.connect(processor);
        // Through a silent gain node rather than straight to the speakers: a ScriptProcessor
        // does not run unless it is connected to the destination, and connecting it directly
        // would play the microphone back at the user.
        const mute = context.createGain();
        mute.gain.value = 0;
        processor.connect(mute);
        mute.connect(context.destination);

        active = true;
      } catch (err) {
        teardown();
        onError?.(
          err instanceof Error && err.name === 'NotAllowedError'
            ? 'Navi cannot hear you: microphone access was refused. Grant it in System Settings › Privacy & Security › Microphone.'
            : `Navi cannot hear you: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    async stop() {
      if (context === null) return null;
      const rate = context.sampleRate;
      active = false;

      const total = chunks.reduce((n, c) => n + c.length, 0);
      const joined = new Float32Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.length;
      }
      chunks = [];
      teardown();

      if (total / rate < MIN_TAKE_SECONDS) return null;
      return encodeWav(downsample(joined, rate, WHISPER_RATE), WHISPER_RATE);
    },
  };
}
