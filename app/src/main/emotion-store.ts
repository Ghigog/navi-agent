/**
 * Emotion state persistence.
 *
 * Separate from settings.json on purpose. Settings are the user's; this is Navi's, and a user
 * who resets their preferences should not thereby wipe the relationship. It is also the only
 * file in the app whose contents the user is not meant to hand-edit — `coerceState` re-derives
 * the emotion and relationship from the scores, so editing it in to say `best_friend` does
 * nothing.
 */

import { app } from 'electron';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  coerceState,
  describe,
  evaluate,
  NEUTRAL,
  type EmotionState,
  type Evaluation,
  type TurnOutcome,
} from '../shared/emotion.js';

let cached: EmotionState | null = null;

function file(): string {
  return join(app.getPath('userData'), 'emotion.json');
}

export function load(): EmotionState {
  if (cached) return cached;
  try {
    cached = coerceState(JSON.parse(readFileSync(file(), 'utf8')));
    console.log('emotion restored:', describe(cached));
  } catch {
    // Missing or unreadable is the normal first-run case. She starts serene.
    cached = { ...NEUTRAL };
    console.log('emotion starting fresh:', describe(cached));
  }
  return cached;
}

function persist(state: EmotionState): void {
  cached = state;
  try {
    mkdirSync(dirname(file()), { recursive: true });
    writeFileSync(file(), JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    // A relationship that fails to save is worth a line in the log and nothing more. It must
    // never take down a turn that otherwise worked.
    console.warn('could not save emotion state:', err instanceof Error ? err.message : err);
  }
}

/** Scores a turn against the stored state, persists the result, and returns it. */
export function record(outcome: TurnOutcome): Evaluation {
  const result = evaluate(load(), outcome);
  persist(result.state);
  console.log(`emotion: ${describe(result.state)}  (${result.promptScore >= 0 ? '+' : ''}${result.promptScore})`);
  return result;
}

/** Test seam, and the hook for a "start over" action in settings. */
export function reset(): EmotionState {
  persist({ ...NEUTRAL });
  return { ...NEUTRAL };
}
