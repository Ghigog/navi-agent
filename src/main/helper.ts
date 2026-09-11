/**
 * Talking to `navi-helper` (NAV-90).
 *
 * The helper is spawned as a direct child process and speaks newline-delimited JSON over its own
 * stdin/stdout — no socket, so there is nothing for a stray local process to connect to and
 * nothing to authenticate. Requests are correlated to responses by `id`; `call()` is the only
 * thing in this file that knows that.
 *
 * Binary resolution mirrors `exec.ts`'s `binDir()` exactly, because it is the same problem: the
 * binary lives in the repository's own `bin/` when running from source, and beside the app under
 * `resources/bin/` once packaged.
 *
 * A crashed or missing helper fails every in-flight and future call rather than leaving a caller
 * hanging — `main/index.ts` surfaces that through the same `chat:event` error channel every other
 * missing-permission or missing-binary problem already uses.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { UiPort } from '../agent/ui.js';
import { binDir } from './exec.js';
import { encodeRequest, HelperOpError, parseResponseLine, type AppInfo, type UiNode, type UiRole } from '../shared/ui-protocol.js';

export function helperBinaryPath(): string {
  return join(binDir(), 'navi-helper');
}

export interface HelperHandle {
  port: UiPort;
  /** Whether the helper itself is accessibility-trusted — not the same grant as the Electron app's own. */
  status(): Promise<{ trusted: boolean }>;
  stop(): void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(err: Error): void;
}

export function startHelper(): HelperHandle {
  const bin = helperBinaryPath();

  let child: ChildProcessWithoutNullStreams | null = null;
  let buffer = '';
  let nextId = 1;
  let lastFailure = `navi-helper has not started yet.`;
  const pending = new Map<number, Pending>();

  const failAll = (err: Error): void => {
    for (const [, p] of pending) p.reject(err);
    pending.clear();
  };

  const handleLine = (line: string): void => {
    const response = parseResponseLine(line);
    // A line that does not parse, or carries an id nobody is waiting on, is silently dropped —
    // there is nothing to correlate it to. `main.swift` never writes anything but response lines
    // to stdout, so this path is reached only by a bug, not by ordinary operation.
    if (response === null) return;
    const waiting = pending.get(response.id);
    if (!waiting) return;
    pending.delete(response.id);
    if (response.ok) waiting.resolve(response.result);
    else waiting.reject(new HelperOpError(response.error ?? 'navi-helper reported an error.', response.code ?? 'unknown'));
  };

  const spawnChild = (): void => {
    if (!existsSync(bin)) {
      lastFailure = `navi-helper is not built. Expected a binary at ${bin}.`;
      return;
    }
    const proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    child = proc;
    buffer = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let newlineAt = buffer.indexOf('\n');
      while (newlineAt !== -1) {
        handleLine(buffer.slice(0, newlineAt));
        buffer = buffer.slice(newlineAt + 1);
        newlineAt = buffer.indexOf('\n');
      }
    });
    proc.stderr.on('data', (chunk: Buffer) => console.error('navi-helper:', chunk.toString('utf8').trim()));

    proc.on('error', (err) => {
      lastFailure = `navi-helper failed to start: ${err.message}`;
      child = null;
      failAll(new Error(lastFailure));
    });
    proc.on('exit', (code) => {
      lastFailure = `navi-helper exited (code ${code ?? 'unknown'}).`;
      child = null;
      failAll(new Error(lastFailure));
    });
  };

  const call = (op: string, params?: Record<string, unknown>): Promise<unknown> => {
    if (!child) return Promise.reject(new HelperOpError(lastFailure, 'not_running'));
    const id = nextId++;
    const current = child;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      current.stdin.write(encodeRequest({ id, op, params: params ?? null }) + '\n');
    });
  };

  spawnChild();

  const port: UiPort = {
    async focusedWindow(maxDepth) {
      const result = (await call('dump_tree', { windowId: null, maxDepth })) as { root: UiNode };
      return result.root;
    },
    async describeElement(handle) {
      return (await call('describe_element', { handle })) as {
        app: AppInfo | null;
        secure: boolean;
        role: UiRole;
        title: string | null;
        enabled: boolean;
      };
    },
    async focusedElementSecure() {
      return (await call('focused_element_secure')) as { secure: boolean; app: AppInfo | null };
    },
    async clickElement(handle) {
      await call('click_element', { handle });
    },
    async setValue(handle, text) {
      await call('set_value', { handle, text });
    },
    async focusWindow(handle) {
      await call('focus_window', { id: handle });
    },
    async clickPoint(x, y) {
      await call('click_point', { x, y });
    },
    async typeText(text) {
      await call('type_text', { text });
    },
    async key(combo) {
      await call('key', { combo });
    },
    async scroll(dx, dy) {
      await call('scroll', { dx, dy });
    },
    async appAtPoint(x, y) {
      const result = (await call('app_at_point', { x, y })) as { app: AppInfo | null };
      return result.app;
    },
    async frontmostApp() {
      const result = (await call('frontmost_app')) as { app: AppInfo | null };
      return result.app;
    },
  };

  return {
    port,
    async status() {
      return (await call('status')) as { trusted: boolean };
    },
    stop() {
      child?.kill();
      child = null;
    },
  };
}
