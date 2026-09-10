/**
 * Prompt inspector (NAV-85).
 *
 * Records the exact system prompt of the last request so Settings can display it. The Godot
 * build had no way to see the assembled prompt at all, which is how two contradictory pointing
 * instructions coexisted for months without anyone noticing.
 *
 * Build this before the things that depend on it. Every later prompt change is verifiable by
 * looking at the panel, and unverifiable without it.
 */

import type { PromptSection } from './types.js';

export interface PromptRecord {
  at: number;
  /** The exact string sent as the system prompt. */
  prompt: string;
  /** Per-layer breakdown, so the panel can show which layer contributed what. */
  sections: readonly PromptSection[];
  /** Rough token count. Estimated, and labelled as such in the UI. */
  estimatedTokens: number;
}

/**
 * Deliberately crude: ~4 characters per token, the usual rule of thumb for English.
 *
 * A real tokenizer would be a dependency and a per-model one at that, and the number is here to
 * answer "is the prompt getting out of hand?", which this answers well enough. The UI labels it
 * an estimate. If a token budget is ever enforced against this, replace it first.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

let last: PromptRecord | null = null;

export function record(prompt: string, promptSections: readonly PromptSection[]): PromptRecord {
  last = {
    at: Date.now(),
    prompt,
    sections: promptSections,
    estimatedTokens: estimateTokens(prompt),
  };
  return last;
}

export function lastPrompt(): PromptRecord | null {
  return last;
}

/** Test seam. */
export function reset(): void {
  last = null;
}
