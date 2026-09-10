/**
 * PCM to WAV (NAV-104). whisper-cli reads one format, and this is where it is produced.
 */

import { describe, expect, it } from 'vitest';
import { downsample, durationOf, encodeWav, WAV_HEADER_BYTES, WHISPER_RATE } from '../src/shared/wav.js';

const ascii = (bytes: Uint8Array, at: number, length: number): string =>
  String.fromCharCode(...bytes.slice(at, at + length));

const view = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

describe('encodeWav', () => {
  it('writes a header whisper will accept: 16-bit mono at 16 kHz', () => {
    const wav = encodeWav(new Float32Array(8));
    const v = view(wav);

    expect(ascii(wav, 0, 4)).toBe('RIFF');
    expect(ascii(wav, 8, 4)).toBe('WAVE');
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(WHISPER_RATE);
    expect(v.getUint16(34, true)).toBe(16); // bits
    expect(ascii(wav, 36, 4)).toBe('data');
  });

  it('declares the sizes it actually wrote', () => {
    const wav = encodeWav(new Float32Array(100));
    const v = view(wav);
    expect(wav.length).toBe(WAV_HEADER_BYTES + 200);
    expect(v.getUint32(4, true)).toBe(36 + 200);
    expect(v.getUint32(40, true)).toBe(200);
  });

  it('scales floats into the 16-bit range', () => {
    const wav = encodeWav(Float32Array.from([0, 1, -1, 0.5]));
    const v = view(wav);
    expect(v.getInt16(WAV_HEADER_BYTES, true)).toBe(0);
    expect(v.getInt16(WAV_HEADER_BYTES + 2, true)).toBe(32767);
    expect(v.getInt16(WAV_HEADER_BYTES + 4, true)).toBe(-32767);
    expect(v.getInt16(WAV_HEADER_BYTES + 6, true)).toBe(16384);
  });

  it('clamps a loud sample rather than wrapping it to the opposite extreme', () => {
    // Unclamped, +1.4 wraps to a large negative number: a click on every plosive, which is the
    // part of the word a recogniser most needs.
    const wav = encodeWav(Float32Array.from([1.4, -1.4]));
    const v = view(wav);
    expect(v.getInt16(WAV_HEADER_BYTES, true)).toBe(32767);
    expect(v.getInt16(WAV_HEADER_BYTES + 2, true)).toBe(-32767);
  });
});

describe('downsample', () => {
  it('produces the right number of samples for the rate change', () => {
    const source = new Float32Array(48000);
    expect(downsample(source, 48000, 16000).length).toBe(16000);
  });

  it('averages rather than dropping samples', () => {
    // Picking every third sample of this would give 0 throughout; averaging keeps the level.
    const source = Float32Array.from([0, 0.5, 1, 0, 0.5, 1]);
    const out = downsample(source, 48000, 16000);
    expect(out.length).toBe(2);
    expect(out[0]).toBeCloseTo(0.5, 5);
    expect(out[1]).toBeCloseTo(0.5, 5);
  });

  it('leaves a stream that is already at or below the target alone', () => {
    const source = Float32Array.from([0.1, 0.2]);
    expect(downsample(source, 16000, 16000)).toBe(source);
    expect(downsample(source, 8000, 16000)).toBe(source);
  });
});

describe('durationOf', () => {
  it('measures a recording in seconds', () => {
    expect(durationOf(new Float32Array(WHISPER_RATE * 2))).toBe(2);
  });
});
