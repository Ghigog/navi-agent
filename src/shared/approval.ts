/**
 * What was approved, not just that approval happened (NAV-101).
 *
 * The ticket is specific about this and it is the part that makes the loop teach her anything.
 * "The user liked that" is a number going up. "The user liked being answered directly, without
 * a screen capture" is something she can do again. The first is a pet stat; the second is a
 * preference, and preferences are what `memory.ts`'s relationship store exists to hold.
 *
 * The description has to be *short*, because the relationship store is always injected and has
 * the tightest budget in the system. One clause, no punctuation to speak of, and no quotation
 * of the user's own words — those are the note store's job (NAV-100), not this one's.
 */

/** What a turn looked like, reduced to the parts worth learning from. */
export interface TurnShape {
  /** Tools that ran, in order. Empty for a turn she answered from what she knew. */
  tools: readonly string[];
  /** Whether the user asked her to look, as opposed to her deciding to. */
  askedToLook?: boolean;
  /** Whether the reply hedged. `containsHedging` is what sets it. */
  hedged: boolean;
  /** Length of her reply, in words. Long and short are both things a person has opinions about. */
  words: number;
}

/**
 * Hard cap on one description, in characters.
 *
 * The relationship store is always injected, holds six of these per list, and has the tightest
 * budget in the system. Six unbounded clauses would be a budget that grows with how many tools
 * she happens to have, which is exactly the growth `memory.ts` exists to prevent.
 */
export const MAX_DESCRIPTION_CHARS = 80;

/** Above this, a reply reads as long to somebody who did not ask for an essay. */
export const LONG_REPLY_WORDS = 120;
/** Below this, it reads as terse. */
export const SHORT_REPLY_WORDS = 25;

/**
 * One clause describing how she answered, in terms she could act on next time.
 *
 * Written in the second person because it lands in a prompt that addresses her, alongside
 * "They have liked:" — so it reads as a list of things she does that this person likes.
 */
export function describeTurn(shape: TurnShape): string {
  const parts: string[] = [];

  if (shape.tools.length === 0) {
    parts.push('answering from what you already knew');
  } else {
    const unique = [...new Set(shape.tools)];
    const named = unique.slice(0, 2).join(' and ');
    parts.push(shape.askedToLook === false ? `reaching for ${named} without being asked` : `using ${named}`);
  }

  if (shape.hedged) parts.push('saying plainly that you were unsure');
  else if (shape.words <= SHORT_REPLY_WORDS) parts.push('answering briefly');
  else if (shape.words >= LONG_REPLY_WORDS) parts.push('going into detail');

  const joined = parts.join(', ');
  // Trimmed at a word boundary rather than mid-word: this is read by a model and by the user in
  // the memory viewer, and "using look_near_curs" is worse than saying less.
  if (joined.length <= MAX_DESCRIPTION_CHARS) return joined;
  return joined.slice(0, joined.lastIndexOf(' ', MAX_DESCRIPTION_CHARS));
}

/**
 * Words in a reply. Its own function because "long" and "short" are the whole of what this
 * module knows about length, and the two thresholds above should be measured the same way.
 */
export function wordsIn(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}
