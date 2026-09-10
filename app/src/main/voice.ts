/**
 * Speaking and listening (NAV-104).
 *
 * The binaries are the ones the Godot build used and `setup_models.sh` still fetches: `piper`
 * for speech, `whisper-cli` for transcription, both run locally. ADR 0001's offline-first rule
 * covers voice too — a companion who needs a cloud account to say hello is not the product.
 *
 * Everything platform-shaped is a `Runner`, so this file has no Electron import and no
 * `child_process` import: a whole spoken reply, including a synthesiser that fails halfway
 * through it, runs under test with no audio hardware anywhere.
 *
 * The rule that shapes the error handling: **audio failures degrade to text**. Piper missing,
 * a voice model not downloaded, no microphone — none of it may cost the user their turn. The
 * same rule sentiment classification follows, for the same reason.
 */

import { createSentenceStream, type SentenceStream } from '../shared/speech.js';

export interface RunResult {
  code: number;
  stderr: string;
  stdout: string;
}

/** Running a program to completion, and being able to stop it. */
export interface Runner {
  run(command: string, args: readonly string[], opts?: { signal?: AbortSignal }): Promise<RunResult>;
}

export interface SpeakerPaths {
  /** The `piper` wrapper in `bin/`. */
  piper: string;
  /** The `.onnx` voice model. */
  voice: string;
  /** Where a synthesised clip is written before it is played. Given a unique name per clip. */
  scratch(name: string): string;
}

export interface SpeakerDeps {
  runner: Runner;
  paths: SpeakerPaths;
  /** Plays a finished wav file. macOS has `afplay`; the seam is here so other platforms fit. */
  play(file: string, opts?: { signal?: AbortSignal }): Promise<void>;
  /** Removes a clip once it has been played. Failure here is not interesting. */
  cleanup?(file: string): Promise<void>;
  /**
   * Told once per failure, with something a person could act on. Wired to the chat window, so a
   * silent Navi says *why* she is silent instead of just being silent.
   */
  onError?(message: string): void;
  /** 1.0 is the voice's own pace. Piper takes the reciprocal, which is easy to get backwards. */
  speed?: number;
}

export interface Speaker {
  /**
   * Feeds streamed reply text in. Complete sentences are queued for speech as they finish; the
   * tail is spoken by `finish()`.
   */
  push(delta: string): void;
  /** End of reply: speaks whatever is left and resolves when the queue has drained. */
  finish(): Promise<void>;
  /** Stops immediately and forgets the queue. A cancelled turn stops her mid-word, as it should. */
  stop(): void;
  speaking(): boolean;
}

/** Anything past this is a model that has run away, and she should not read it aloud for a minute. */
export const MAX_SPOKEN_CHARS = 600;

export function createSpeaker(deps: SpeakerDeps): Speaker {
  const stream: SentenceStream = createSentenceStream();
  const queue: string[] = [];

  let draining: Promise<void> | null = null;
  let controller: AbortController | null = null;
  let clip = 0;
  // One message per reply, not one per sentence: a missing piper binary fails on every sentence
  // and would otherwise fill the chat window with the same line twenty times.
  let reported = false;

  const fail = (message: string): void => {
    if (reported) return;
    reported = true;
    deps.onError?.(message);
  };

  const say = async (text: string): Promise<void> => {
    const signal = controller?.signal;
    const file = deps.paths.scratch(`navi-speech-${Date.now()}-${clip++}.wav`);

    // Piper's length_scale is time per unit of speech, so it is the reciprocal of rate: a speed
    // of 2 is a length scale of 0.5. Getting this backwards produces a Navi who slows down when
    // you ask her to hurry.
    const lengthScale = deps.speed !== undefined && deps.speed > 0 ? 1 / deps.speed : 1;

    const result = await deps.runner.run(
      deps.paths.piper,
      [
        '--model', deps.paths.voice,
        '--output_file', file,
        '--length_scale', String(lengthScale),
        text,
      ],
      signal ? { signal } : {},
    );

    if (signal?.aborted === true) return;

    if (result.code !== 0) {
      fail(
        `Navi could not speak: piper exited ${result.code}. ` +
          (result.stderr.trim() === '' ? 'Check bin/piper and the voice model.' : result.stderr.trim()),
      );
      return;
    }

    await deps.play(file, signal ? { signal } : {});
    await deps.cleanup?.(file).catch(() => {});
  };

  const aborted = (): boolean => controller?.signal.aborted === true;

  const drain = async (): Promise<void> => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (next === undefined) break;
      if (aborted()) break;
      try {
        await say(next);
      } catch (err) {
        // Never rethrown. The turn belongs to the text; speech is an ornament on it.
        if (!aborted()) {
          fail(`Navi could not speak: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    draining = null;
  };

  const enqueue = (sentences: readonly string[]): void => {
    for (const sentence of sentences) {
      if (sentence.length > MAX_SPOKEN_CHARS) {
        queue.push(sentence.slice(0, MAX_SPOKEN_CHARS));
        continue;
      }
      queue.push(sentence);
    }
    if (queue.length > 0 && draining === null) {
      controller ??= new AbortController();
      draining = drain();
    }
  };

  return {
    push(delta) {
      enqueue(stream.push(delta));
    },

    async finish() {
      const tail = stream.flush();
      if (tail !== null) enqueue([tail]);
      await draining;
      reported = false;
    },

    stop() {
      stream.clear();
      queue.length = 0;
      controller?.abort();
      controller = null;
      reported = false;
    },

    speaking: () => draining !== null,
  };
}

// ---------------------------------------------------------------------------
// Listening
// ---------------------------------------------------------------------------

export interface TranscriberDeps {
  runner: Runner;
  /** The `whisper-cli` binary. */
  whisper: string;
  /** The `.bin` GGML model. */
  model: string;
}

/**
 * Whisper's own chatter, which arrives on stdout mixed in with the transcript.
 *
 * `-np` suppresses most of it and does not suppress all of it, so this is the same filter
 * `STTService._clean_whisper_output` applied, carried across rather than rediscovered.
 */
const WHISPER_NOISE = /^(read_audio_data:|system_info:|whisper_|main:|read_wav:|ggml_)/;

/**
 * Bracketed non-speech, which whisper emits for silence and background noise. Left in, it
 * becomes a turn where the user asks Navi about "[BLANK_AUDIO]".
 */
const NON_SPEECH = /[[(](?:blank_audio|silence|music|inaudible|sound|noise)[^\])]*[\])]/gi;

export function cleanTranscript(stdout: string): string {
  return stdout
    .split('\n')
    .filter((line) => !WHISPER_NOISE.test(line.trim()))
    .join(' ')
    .replace(NON_SPEECH, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Transcriber {
  /** The words in a wav file, or empty when there were none. Never throws. */
  transcribe(wav: string, opts?: { signal?: AbortSignal }): Promise<{ text: string; error?: string }>;
}

export function createTranscriber(deps: TranscriberDeps): Transcriber {
  return {
    async transcribe(wav, opts) {
      try {
        const result = await deps.runner.run(
          deps.whisper,
          ['-m', deps.model, '-f', wav, '-np', '-nt'],
          opts?.signal ? { signal: opts.signal } : {},
        );

        if (result.code !== 0) {
          return {
            text: '',
            error:
              `Navi could not hear that: whisper-cli exited ${result.code}. ` +
              (result.stderr.trim() === ''
                ? 'Check bin/whisper-cli and that the model has been downloaded.'
                : result.stderr.trim()),
          };
        }

        return { text: cleanTranscript(result.stdout) };
      } catch (err) {
        return { text: '', error: `Navi could not hear that: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
}
