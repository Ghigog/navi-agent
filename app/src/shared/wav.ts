/**
 * PCM to WAV (NAV-104).
 *
 * `whisper-cli` reads 16 kHz mono 16-bit WAV and nothing else. The browser's `MediaRecorder`
 * produces WebM/Opus, which would need a decoder on the far side, so the microphone path takes
 * raw samples out of a `ScriptProcessor` and encodes them here instead — no codec, no ffmpeg,
 * and it runs the same in the renderer that captures and in a test that has no audio at all.
 */

/** What whisper wants. Not a preference — it resamples anything else badly or not at all. */
export const WHISPER_RATE = 16000;

/**
 * Averages a float stream down to `to` Hz.
 *
 * Averaging rather than picking every Nth sample: dropping samples aliases, which on speech
 * sounds like a metallic edge and costs transcription accuracy. This is a box filter, which is
 * crude, but the source is a microphone at 44.1 or 48 kHz and the target is speech recognition.
 */
export function downsample(samples: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return samples;

  const ratio = from / to;
  const out = new Float32Array(Math.floor(samples.length / ratio));

  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j] ?? 0;
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

/** Header length in bytes. RIFF, fmt and data chunk headers; the samples follow. */
export const WAV_HEADER_BYTES = 44;

/**
 * Wraps float samples in a canonical 16-bit mono WAV.
 *
 * Clamped before scaling, because a float stream from a microphone does go outside ±1 on a loud
 * consonant, and an unclamped conversion wraps that to the opposite extreme — a click on every
 * plosive, which is exactly the part of the word a recogniser needs.
 */
export function encodeWav(samples: Float32Array, sampleRate = WHISPER_RATE): Uint8Array {
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + samples.length * 2);
  const view = new DataView(buffer);

  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM header length
  view.setUint16(20, 1, true); // PCM, uncompressed
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(WAV_HEADER_BYTES + i * 2, Math.round(clamped * 32767), true);
  }

  return new Uint8Array(buffer);
}

/** Seconds of audio in a float stream. Used to throw away a recording that is only a keypress. */
export function durationOf(samples: Float32Array, sampleRate = WHISPER_RATE): number {
  return sampleRate > 0 ? samples.length / sampleRate : 0;
}
