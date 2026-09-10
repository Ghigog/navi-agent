/**
 * Running the voice binaries, and finding them (NAV-104).
 *
 * The only file that spawns a process. `main/voice.ts` decides *what* to run and what to do
 * when it fails; this decides how a process is run on this machine and where the binaries live,
 * which is the part that changes when the app is packaged.
 */

import { app } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Runner, RunResult, SpeakerPaths } from './voice.js';

/**
 * Where `bin/` is.
 *
 * Two answers, because they are genuinely different places. Running from source, the binaries
 * are the repository's own `bin/`, a level above `app/`. Packaged, they are unpacked beside the
 * app under `resources/`. Checked rather than assumed, so a missing one produces piper's own
 * "command not found" — a message with a next step in it — instead of a path that silently
 * points nowhere.
 */
export function binDir(): string {
  const candidates = [
    join(process.resourcesPath ?? '', 'bin'),
    resolve(app.getAppPath(), '..', 'bin'),
    resolve(app.getAppPath(), 'bin'),
  ];
  return candidates.find((dir) => dir !== 'bin' && existsSync(dir)) ?? candidates[1]!;
}

export function speakerPaths(voiceName: string): SpeakerPaths {
  const dir = binDir();
  return {
    piper: join(dir, 'piper'),
    voice: join(dir, 'voices', `${voiceName}.onnx`),
    scratch: (name) => join(tmpdir(), name),
  };
}

export function whisperPaths(modelFile: string): { whisper: string; model: string } {
  const dir = binDir();
  return { whisper: join(dir, 'whisper-cli'), model: join(dir, modelFile) };
}

/**
 * A process, run to completion.
 *
 * Non-zero exit codes come back as a result rather than as a rejection, because for these two
 * binaries a non-zero exit *is* the answer: piper exits 127 when the Python module is missing,
 * and that is a sentence to show the user, not an exception to unwind a turn with.
 *
 * The output cap is not tidiness. `whisper-cli` with `-np` still writes progress lines, and a
 * long recording produces a lot of them; an unbounded buffer is a way for a recording to become
 * a memory problem.
 */
const MAX_OUTPUT = 1 << 20;

export function createRunner(): Runner {
  return {
    run(command, args, opts) {
      return new Promise<RunResult>((resolvePromise) => {
        const child = execFile(
          command,
          [...args],
          { maxBuffer: MAX_OUTPUT, ...(opts?.signal ? { signal: opts.signal } : {}) },
          (err, stdout, stderr) => {
            if (err && typeof (err as { code?: unknown }).code === 'number') {
              resolvePromise({ code: (err as unknown as { code: number }).code, stdout, stderr });
              return;
            }
            if (err) {
              // ENOENT, EACCES, or an abort. `message` carries the path, which is the useful part.
              resolvePromise({ code: -1, stdout, stderr: stderr === '' ? err.message : stderr });
              return;
            }
            resolvePromise({ code: 0, stdout, stderr });
          },
        );
        child.on('error', () => {
          // Handled by the callback above; this stops an unhandled 'error' event killing the
          // process when the binary does not exist.
        });
      });
    },
  };
}

/**
 * Plays a finished clip.
 *
 * `afplay` ships with macOS, so there is nothing to install and nothing to bundle. Windows and
 * Linux are wanted eventually (HANDOFF decision 5) and this is the one line that will need
 * them; the seam is `SpeakerDeps.play`, so nothing above here changes when they arrive.
 */
export function createPlayer(runner: Runner): (file: string, opts?: { signal?: AbortSignal }) => Promise<void> {
  const [command, prefix] =
    process.platform === 'darwin'
      ? ['afplay', [] as string[]]
      : process.platform === 'win32'
        ? ['powershell', ['-NoProfile', '-Command']]
        : ['aplay', ['-q']];

  return async (file, opts) => {
    const args =
      process.platform === 'win32'
        ? [...prefix, `(New-Object Media.SoundPlayer '${file}').PlaySync()`]
        : [...prefix, file];

    const result = await runner.run(command, args, opts ?? {});
    if (result.code !== 0 && result.code !== -1) {
      throw new Error(`${command} exited ${result.code}`);
    }
    if (result.code === -1 && result.stderr !== '') throw new Error(result.stderr);
  };
}
