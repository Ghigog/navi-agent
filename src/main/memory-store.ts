/**
 * Memory persistence (NAV-93).
 *
 * Its own file, for the same reason `emotion.json` is: settings are the user's, and this is the
 * relationship. Resetting preferences should not wipe what she knows about you.
 *
 * **Not SQLite, and the ticket asked for SQLite.** The reason is worth stating rather than
 * hiding: the usable options are native modules that must be rebuilt against Electron's ABI on
 * every version bump, on every platform we eventually ship to. What that would buy is indexed
 * query over a store that `shared/memory.ts` *bounds by design* — consolidation promotes and
 * decay prunes, so the episode count does not grow without limit, and the retrieval test holds
 * a thousand of them well inside its budget. If that stops being true, this file is the only
 * one that changes: everything above it takes a `Memory` value and gives one back.
 */

import { app } from 'electron';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  coerceMemory,
  consolidate,
  EMPTY,
  needsConsolidation,
  type Memory,
} from '../shared/memory.js';

let cached: Memory | null = null;

function file(): string {
  return join(app.getPath('userData'), 'memory.json');
}

export function load(): Memory {
  if (cached) return cached;
  try {
    cached = coerceMemory(JSON.parse(readFileSync(file(), 'utf8')));
  } catch {
    // Missing or unreadable is the normal first-run case. She starts knowing nothing.
    cached = structuredClone(EMPTY);
  }
  console.log(`memory loaded: ${cached.facts.length} facts, ${cached.episodes.length} episodes`);
  return cached;
}

/**
 * Writes, consolidating first when the store has grown past the point where it is worth doing.
 *
 * Consolidation runs here rather than on a timer because this is the only place that knows the
 * store changed, and a timer that fires while nothing is happening is exactly the kind of idle
 * work ADR 0001's CPU bar exists to keep out.
 */
export function save(next: Memory): Memory {
  let memory = next;
  if (needsConsolidation(memory)) {
    const result = consolidate(memory);
    memory = result.memory;
    if (result.promoted > 0 || result.dropped > 0) {
      console.log(`memory consolidated: ${result.promoted} promoted, ${result.dropped} forgotten`);
    }
  }

  cached = memory;
  mkdirSync(dirname(file()), { recursive: true });
  // Memory is the user's own words about their own life. It never leaves the machine except as
  // prompt context to the provider they configured (NAV-93), and it is written nowhere else.
  writeFileSync(file(), JSON.stringify(memory, null, 2), 'utf8');
  return memory;
}

/** Empties it. The user's escape hatch, alongside the emotional reset. */
export function reset(): Memory {
  return save(structuredClone(EMPTY));
}
