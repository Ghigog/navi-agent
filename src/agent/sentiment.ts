/**
 * Sentiment classification (emotions.md §4.4).
 *
 * A second, cheap, non-streaming model call on the user's message, made during the pre-reply
 * pass so that how they spoke to her shapes the reply they get, not the one after it. Its
 * result is the `sentiment` field the emotion engine has always scored and nothing has ever
 * set.
 *
 * Three properties matter more than accuracy here, because this sits on the latency path of
 * every message and its output only tints a mood:
 *
 *   It never throws. A provider that is down, slow, or returning nonsense yields `neutral`.
 *   A failed mood reading must not cost the user their turn.
 *
 *   It is bounded in time. A local 3B model can stall; `TIMEOUT_MS` caps how long a message
 *   waits before Navi answers it, and expiry is just another route to `neutral`.
 *
 *   It fails towards `neutral`. Of the three labels that is the only one that moves nothing,
 *   so an unparseable answer costs the relationship nothing in either direction.
 *
 * The prompt is in `src/prompt/sentiment.ts` (NAV-85), along with why this is not the router
 * NAV-83 deleted.
 */

import type OpenAI from 'openai';
import { SENTIMENT_INSTRUCTIONS, sentimentPrompt } from '../prompt/sentiment.js';
import type { Sentiment } from '../shared/emotion.js';

/**
 * How long a message may wait on its mood reading before Navi answers it anyway.
 *
 * The whole call is one word out of a small model, so this is generous rather than tight; it
 * exists to bound the worst case, not the normal one. Every message pays it when the provider
 * is unreachable-but-hanging, which is why it is not larger.
 */
export const TIMEOUT_MS = 2500;

/** Enough for one word plus whatever punctuation a small model insists on adding. */
const MAX_TOKENS = 8;

const LABELS: readonly Sentiment[] = ['kind', 'mean', 'neutral'];

/**
 * Reads a label out of the model's reply.
 *
 * Two stages, because "reply with one word" is advice a 3B model takes loosely. An exact match
 * on the stripped reply wins; failing that, a single label mentioned as a whole word wins. Two
 * different labels in one reply is not a reading, it is a model thinking out loud, and that is
 * `neutral` like anything else unrecognised.
 */
export function parseSentiment(raw: string): Sentiment {
  const stripped = raw.toLowerCase().replace(/[^a-z]/g, '');
  for (const label of LABELS) {
    if (stripped === label) return label;
  }

  const mentioned = new Set(
    [...raw.toLowerCase().matchAll(/\b(kind|mean|neutral)\b/g)].map((m) => m[1] as Sentiment),
  );
  const only = [...mentioned];
  return only.length === 1 ? only[0]! : 'neutral';
}

export interface ClassifyOptions {
  client: OpenAI;
  /** Ideally a small fast model. Falls back to the turn's own model when none is configured. */
  model: string;
  message: string;
  timeoutMs?: number;
  /** The turn's own abort signal, so cancelling a message also cancels its mood reading. */
  signal?: AbortSignal;
}

export async function classifySentiment(opts: ClassifyOptions): Promise<Sentiment> {
  if (opts.message.trim() === '') return 'neutral';

  const timer = new AbortController();
  const timeout = setTimeout(() => timer.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  const onOuterAbort = (): void => timer.abort();
  opts.signal?.addEventListener('abort', onOuterAbort, { once: true });

  try {
    const res = await opts.client.chat.completions.create(
      {
        model: opts.model,
        messages: [
          { role: 'system', content: SENTIMENT_INSTRUCTIONS },
          { role: 'user', content: sentimentPrompt(opts.message) },
        ],
        // Not streamed: there is one word to wait for and nothing to show while it arrives.
        stream: false,
        // A classification wants the same answer every time for the same message.
        temperature: 0,
        max_tokens: MAX_TOKENS,
      },
      { signal: timer.signal },
    );

    return parseSentiment(res.choices[0]?.message?.content ?? '');
  } catch {
    // Unreachable, timed out, cancelled, or shaped unlike any completion this understands.
    // All of them mean the same thing here: no reading, so no change.
    return 'neutral';
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', onOuterAbort);
  }
}
