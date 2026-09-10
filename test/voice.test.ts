/**
 * Speaking and listening (NAV-104).
 *
 * The acceptance criterion these are built around: an audio failure degrades to text rather
 * than killing the turn. A Navi who cannot speak should be a quiet Navi, never a broken one.
 */

import { describe, expect, it } from 'vitest';
import {
  cleanTranscript,
  createSpeaker,
  createTranscriber,
  MAX_SPOKEN_CHARS,
  type RunResult,
  type Runner,
} from '../src/main/voice.js';

function fakeRunner(result: Partial<RunResult> | ((args: readonly string[]) => Partial<RunResult>) = {}) {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push({ command, args });
      const out = typeof result === 'function' ? result(args) : result;
      return { code: 0, stdout: '', stderr: '', ...out };
    },
  };
  return { runner, calls };
}

function speakerWith(runner: Runner, over: { speed?: number; playFails?: boolean } = {}) {
  const played: string[] = [];
  const removed: string[] = [];
  const errors: string[] = [];

  const speaker = createSpeaker({
    runner,
    paths: { piper: '/bin/piper', voice: '/voices/amy.onnx', scratch: (name) => `/tmp/${name}` },
    play: async (file) => {
      if (over.playFails === true) throw new Error('no audio device');
      played.push(file);
    },
    cleanup: async (file) => {
      removed.push(file);
    },
    onError: (m) => errors.push(m),
    ...(over.speed === undefined ? {} : { speed: over.speed }),
  });

  return { speaker, played, removed, errors };
}

/** Reads back the text argument piper was given: the last one, after all the flags. */
const spokenText = (calls: Array<{ args: readonly string[] }>): string[] =>
  calls.map((c) => c.args[c.args.length - 1] ?? '');

describe('speaking', () => {
  it('starts on the first finished sentence rather than waiting for the reply', async () => {
    const { runner, calls } = fakeRunner();
    const { speaker, played } = speakerWith(runner);

    speaker.push('That is a terminal. ');
    // Give the queue a turn of the event loop, as a real stream would.
    await new Promise((r) => setTimeout(r, 0));
    expect(spokenText(calls)).toEqual(['That is a terminal.']);

    speaker.push('It says permission denied.');
    await speaker.finish();

    expect(spokenText(calls)).toEqual(['That is a terminal.', 'It says permission denied.']);
    expect(played).toHaveLength(2);
  });

  it('plays clips in the order they were written', async () => {
    const { runner } = fakeRunner();
    const { speaker, played } = speakerWith(runner);

    speaker.push('One. Two. Three.');
    await speaker.finish();
    expect(played).toHaveLength(3);
    expect(new Set(played).size).toBe(3);
  });

  it('cleans up each clip once it has been played', async () => {
    const { runner } = fakeRunner();
    const { speaker, played, removed } = speakerWith(runner);
    speaker.push('Hello there. ');
    await speaker.finish();
    expect(removed).toEqual(played);
  });

  it('passes speed to piper as its reciprocal, which is what length_scale means', async () => {
    const { runner, calls } = fakeRunner();
    const { speaker } = speakerWith(runner, { speed: 2 });
    speaker.push('Quick. ');
    await speaker.finish();

    const args = calls[0]!.args;
    expect(args[args.indexOf('--length_scale') + 1]).toBe('0.5');
  });

  it('degrades to text when piper is not there', async () => {
    const { runner } = fakeRunner({ code: 127, stderr: 'piper: command not found' });
    const { speaker, played, errors } = speakerWith(runner);

    speaker.push('Anything at all. ');
    await speaker.finish();

    expect(played).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('piper: command not found');
  });

  it('degrades to text when there is nothing to play the audio on', async () => {
    const { runner } = fakeRunner();
    const { speaker, errors } = speakerWith(runner, { playFails: true });

    speaker.push('Anything at all. ');
    await expect(speaker.finish()).resolves.toBeUndefined();
    expect(errors[0]).toContain('no audio device');
  });

  it('says why it is silent once per reply, not once per sentence', async () => {
    const { runner } = fakeRunner({ code: 127, stderr: 'nope' });
    const { speaker, errors } = speakerWith(runner);

    speaker.push('One. Two. Three. Four. ');
    await speaker.finish();
    expect(errors).toHaveLength(1);
  });

  it('stops mid-reply when the turn is cancelled', async () => {
    const { runner, calls } = fakeRunner();
    const { speaker } = speakerWith(runner);

    speaker.push('One. Two. Three. Four. Five. ');
    speaker.stop();
    await speaker.finish();

    // Whatever was already in flight finishes; nothing after it is spoken.
    expect(calls.length).toBeLessThan(5);
  });

  it('truncates a sentence a runaway model produced rather than reading it for a minute', async () => {
    const { runner, calls } = fakeRunner();
    const { speaker } = speakerWith(runner);

    speaker.push(`${'la '.repeat(400)}. `);
    await speaker.finish();
    expect(spokenText(calls)[0]!.length).toBe(MAX_SPOKEN_CHARS);
  });
});

describe('listening', () => {
  it('calls whisper with the model and the recording', async () => {
    const { runner, calls } = fakeRunner({ stdout: ' what is this thing\n' });
    const transcriber = createTranscriber({ runner, whisper: '/bin/whisper-cli', model: '/m.bin' });

    const result = await transcriber.transcribe('/tmp/take.wav');

    expect(result.text).toBe('what is this thing');
    expect(calls[0]!.args).toEqual(['-m', '/m.bin', '-f', '/tmp/take.wav', '-np', '-nt']);
  });

  it('reports a missing binary instead of throwing into the turn', async () => {
    const { runner } = fakeRunner({ code: 127, stderr: 'not found' });
    const transcriber = createTranscriber({ runner, whisper: '/bin/whisper-cli', model: '/m.bin' });

    const result = await transcriber.transcribe('/tmp/take.wav');
    expect(result.text).toBe('');
    expect(result.error).toContain('not found');
  });

  it('survives the runner itself blowing up', async () => {
    const runner: Runner = {
      run: async () => {
        throw new Error('spawn EACCES');
      },
    };
    const transcriber = createTranscriber({ runner, whisper: '/bin/whisper-cli', model: '/m.bin' });

    const result = await transcriber.transcribe('/tmp/take.wav');
    expect(result.text).toBe('');
    expect(result.error).toContain('spawn EACCES');
  });
});

describe('cleanTranscript', () => {
  it('drops whisper\'s own logging', () => {
    const raw = ['whisper_init_from_file: loading model', 'system_info: n_threads = 4', ' hello there'].join('\n');
    expect(cleanTranscript(raw)).toBe('hello there');
  });

  it('drops the markers whisper uses for things that were not speech', () => {
    expect(cleanTranscript('[BLANK_AUDIO]')).toBe('');
    expect(cleanTranscript('hello (inaudible) there')).toBe('hello there');
  });

  it('joins a transcript that came back across several lines', () => {
    expect(cleanTranscript(' what is\n this near\n my cursor')).toBe('what is this near my cursor');
  });
});
