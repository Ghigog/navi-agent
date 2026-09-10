/**
 * Session summaries (NAV-93).
 *
 * The call that turns a conversation into an episode she can find again. Built like
 * `sentiment.ts` and for the same reasons — cheap model, bounded in time, never throws — with
 * one difference that changes everything about its cost: it runs when a conversation *ends*,
 * not before every message. That is what makes it affordable to ask a local model for something
 * as open-ended as prose.
 *
 * It fails towards remembering nothing. A summary that could not be produced is an episode that
 * does not exist, which is strictly better than an episode containing a model's apology.
 */

import type OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { NOTHING, SUMMARY_SYSTEM, SUMMARY_WINDOW, summaryUser } from '../prompt/memory.js';

/** Longer than the sentiment budget: this is prose, and nobody is waiting for it. */
export const TIMEOUT_MS = 15000;

/** A session shorter than this had nothing in it worth a model call. */
export const MIN_MESSAGES = 4;

const MAX_TOKENS = 120;

/**
 * Flattens the tail of a conversation into lines a summariser can read.
 *
 * The tail rather than the head: a long session drifts, and what it ended up being about is
 * more useful to remember than what it opened with. Non-text parts are dropped — a screen
 * capture is not something to remember having seen.
 */
export function transcriptOf(messages: readonly ChatCompletionMessageParam[]): string[] {
  return messages
    .slice(-SUMMARY_WINDOW)
    .map((m) => {
      const who = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Navi' : null;
      if (who === null) return '';
      const text =
        typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content)
            ? m.content.map((p) => (p.type === 'text' ? p.text : '')).join(' ')
            : '';
      return text.trim() === '' ? '' : `${who}: ${text.trim()}`;
    })
    .filter((line) => line !== '');
}

/**
 * Strips what a small model adds despite being asked not to.
 *
 * Returns the empty string for the sentinel, for a refusal, and for anything that came back so
 * short it cannot be a summary — all of which mean the same thing: nothing to remember.
 */
export function parseSummary(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^(summary|here is the summary|sure)[:,]?\s*/i, '')
    .replace(/^["'`]|["'`]$/g, '')
    .trim();

  if (cleaned === '' || cleaned.toUpperCase().startsWith(NOTHING)) return '';
  return cleaned.length < 12 ? '' : cleaned;
}

export interface SummariseOptions {
  client: OpenAI;
  model: string;
  messages: readonly ChatCompletionMessageParam[];
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function summariseSession(opts: SummariseOptions): Promise<string> {
  const transcript = transcriptOf(opts.messages);
  if (transcript.length < MIN_MESSAGES) return '';

  const timer = new AbortController();
  const timeout = setTimeout(() => timer.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  const onOuterAbort = (): void => timer.abort();
  opts.signal?.addEventListener('abort', onOuterAbort, { once: true });

  try {
    const request = opts.client.chat.completions.create(
      {
        model: opts.model,
        messages: [
          { role: 'system', content: SUMMARY_SYSTEM },
          { role: 'user', content: summaryUser(transcript) },
        ],
        stream: false,
        // Low rather than zero: a summary is prose, and a deterministic one of the same session
        // twice is not a property anything here needs.
        temperature: 0.2,
        max_tokens: MAX_TOKENS,
      },
      { signal: timer.signal },
    );

    // Raced rather than only signalled. This runs on the way out — the chat window closing, the
    // app quitting — so the bound has to hold whether or not the transport honours an abort. A
    // client that ignores the signal would otherwise leave a promise nobody ever settles sitting
    // in the middle of a shutdown.
    const res = await Promise.race([
      request,
      new Promise<null>((resolve) => timer.signal.addEventListener('abort', () => resolve(null), { once: true })),
    ]);
    if (res === null) return '';

    return parseSummary(res.choices[0]?.message?.content ?? '');
  } catch {
    // Unreachable, timed out, cancelled, or shaped unlike a completion. Remember nothing.
    return '';
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', onOuterAbort);
  }
}
