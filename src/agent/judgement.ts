/**
 * The judgement turn (NAV-111).
 *
 * One turn, taken on Navi's own initiative: given the facts NAV-110's gate supplies, a few
 * memory lines, and a description of what is on screen, decide whether there is anything worth
 * saying and, if so, say it briefly, in her own voice. Same shape as `agent/sentiment.ts` — cheap,
 * non-streaming, tightly bounded in time, parsed defensively — with one property this one adds:
 * the failure direction is silence rather than a neutral label, because "a remark that arrives
 * ninety seconds late is worse than none" (backlog.md).
 *
 * **Cloud only, per this section's decision (backlog.md, section 5).** This never falls back to
 * whatever local model the main chat is using: a companion who is wrong out loud is worse than
 * one who is not there, and NAV-107's spike only measured the local path well enough to trust —
 * the cloud number the decision actually rests on is still open. `judgementProvider` returns
 * `null` whenever no OpenAI key is configured, whatever the chat provider is, and `judge` turns
 * that into `{ available: false }` without attempting a call.
 *
 * Ported from `spike/nav-107/judge.mjs`'s shape, not its code — that file says explicitly it is
 * throwaway and that a real implementation re-derives the shape under real tests. What survives
 * is the SILENT/SPEAK: reply form and the failure-towards-silence rule.
 *
 * **What this module does not do.** It is not wired into `main/index.ts`: there is no settings
 * flag yet to gate it on (NAV-113), and nothing yet calls NAV-110's `mayInterrupt` and hands its
 * result here. That wiring, and the empirical false-positive number NAV-107 was supposed to
 * produce before this got built, are both still open — see backlog.md's NAV-111 entry.
 */

import OpenAI from 'openai';
import { emotionBody } from '../prompt/builder.js';
import { JUDGEMENT_INSTRUCTIONS, judgementPrompt, type JudgementSituation } from '../prompt/judgement.js';
import type { EmotionState } from '../shared/emotion.js';
import type { Facts } from '../shared/interruption.js';
import type { Settings } from '../shared/settings.js';

/**
 * Generous, the way sentiment's is: this bounds the worst case — a provider that is up but
 * slow — not the normal one. A judgement that expires is silence, not a delayed interruption.
 */
export const TIMEOUT_MS = 8000;

/** One or two sentences plus the SPEAK: prefix. */
const MAX_TOKENS = 160;

export interface JudgementInput extends JudgementSituation {
  emotion: EmotionState;
}

export type Judgement =
  /** No cloud provider configured. Says so, once — the caller decides the cadence (NAV-113). */
  | { available: false }
  | { available: true; speaks: false }
  | { available: true; speaks: true; remark: string };

/**
 * An OpenAI client for the judgement call, or null when none is configured.
 *
 * Deliberately independent of `settings.provider`: Ollama being the daily driver for chat does
 * not make it the daily driver here (backlog.md's decision), so this reads `openaiApiKey`
 * directly rather than going through `agent/client.ts`'s `createProvider`, which would hand back
 * an Ollama client whenever the user's chat provider is local.
 */
export function judgementProvider(settings: Settings): OpenAI | null {
  if (settings.openaiApiKey === '') return null;
  return new OpenAI({ apiKey: settings.openaiApiKey });
}

/**
 * Reads a verdict out of the model's reply. Anything that is not unambiguously SILENT or a
 * well-formed SPEAK: line is silence — the "unparseable means the answer that changes nothing"
 * rule `parseAppraisal` already uses, applied to a verdict where the safe direction is not
 * speaking rather than a neutral label.
 */
export function parseVerdict(raw: string): { speaks: boolean; remark: string | null } {
  const text = raw.trim();
  if (/^silent\b/i.test(text)) return { speaks: false, remark: null };

  const match = text.match(/^speak:\s*(.+)$/is);
  if (match && match[1]!.trim() !== '') return { speaks: true, remark: match[1]!.trim() };

  return { speaks: false, remark: null };
}

/**
 * The numbers a remark is allowed to contain: the leave-by minutes (rounded, floor and ceil, to
 * tolerate "about"), the commitment's clock time in both 24- and 12-hour form, and the current
 * clock time the same way. Nothing else reaches the prompt as a number, so nothing else may
 * legitimately appear in what she says.
 */
function allowedNumbers(facts: Facts): Set<number> {
  const out = new Set<number>();
  const add = (n: number): void => {
    if (Number.isFinite(n)) out.add(Math.round(n));
  };

  if (facts.minutesUntilLeaveBy !== null) {
    add(facts.minutesUntilLeaveBy);
    add(Math.floor(facts.minutesUntilLeaveBy));
    add(Math.ceil(facts.minutesUntilLeaveBy));
  }

  const clockNumbers = (at: number): void => {
    const d = new Date(at);
    const h24 = d.getHours();
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    add(h24);
    add(h12);
    add(d.getMinutes());
  };
  clockNumbers(facts.now);
  if (facts.commitment !== null) clockNumbers(facts.commitment.start);

  return out;
}

/**
 * Every number in a remark must have come from the facts it was handed. A model given a true
 * calendar fact will sometimes still misstate it — round differently, transpose digits, invent
 * "in 5 minutes" when the fact says 15 — and, more to the point, a model that read something
 * fabricated off the screen and repeated it verbatim will misstate it in exactly this way too.
 * This is the one thing standing between either of those and the user hearing it as true.
 */
export function validateRemark(remark: string, facts: Facts): boolean {
  const numbers = [...remark.matchAll(/\d+/g)].map((m) => Number(m[0]));
  if (numbers.length === 0) return true;
  const allowed = allowedNumbers(facts);
  return numbers.every((n) => allowed.has(n));
}

/**
 * What she says when the model wanted to speak but the words cannot be trusted — a template, not
 * silence, because the gate and the model both judged this worth raising and losing the remark
 * entirely would throw that verdict away for nothing. Built only from facts this module itself
 * computed, never from anything the model said.
 */
function templatedFallback(facts: Facts): string {
  if (facts.commitment === null) return 'Something about what you are doing caught my eye.';
  return `Worth a glance: "${facts.commitment.title}" is coming up.`;
}

export interface JudgeOptions {
  client: OpenAI | null;
  model: string;
  input: JudgementInput;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Never throws. Silence is always a safe return; nothing here should ever cost the caller a crash. */
export async function judge(opts: JudgeOptions): Promise<Judgement> {
  if (opts.client === null) return { available: false };

  const timer = new AbortController();
  const timeout = setTimeout(() => timer.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  const onOuterAbort = (): void => timer.abort();
  opts.signal?.addEventListener('abort', onOuterAbort, { once: true });

  try {
    const res = await opts.client.chat.completions.create(
      {
        model: opts.model,
        messages: [
          { role: 'system', content: `${JUDGEMENT_INSTRUCTIONS}\n\n${emotionBody(opts.input.emotion)}` },
          { role: 'user', content: judgementPrompt(opts.input) },
        ],
        // Not streamed: there is one short verdict to wait for, not text to show as it arrives.
        stream: false,
        temperature: 0,
        max_tokens: MAX_TOKENS,
      },
      { signal: timer.signal },
    );

    const { speaks, remark } = parseVerdict(res.choices[0]?.message?.content ?? '');
    if (!speaks || remark === null) return { available: true, speaks: false };

    return {
      available: true,
      speaks: true,
      remark: validateRemark(remark, opts.input.facts) ? remark : templatedFallback(opts.input.facts),
    };
  } catch {
    // Down, slow, cancelled, or shaped unlike any completion this understands — all the same
    // thing here: no reading, so silence.
    return { available: true, speaks: false };
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', onOuterAbort);
  }
}
