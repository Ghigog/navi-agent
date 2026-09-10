/**
 * Small text helpers shared by anything that has to reason about words or size.
 *
 * They were in two places before NAV-93 — the tokeniser in `emotion.ts`, the token estimate in
 * `prompt/inspector.ts` — and the memory store needs both. Two copies of a stopword list is how
 * two parts of a system quietly disagree about what a word is.
 */

/**
 * Rough token count.
 *
 * Four characters per token, which is close enough for English prose and is not close for code
 * or for a language that is not English. It is used to *enforce budgets*, where being roughly
 * right and always available beats being exactly right and needing a tokeniser per model — the
 * budgets themselves have slack in them for this reason.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Words too common to mean anything about topical overlap. Short, on purpose: this is a rough
 * measure and a long stopword list would imply a precision it does not have.
 */
export const STOPWORDS = new Set([
  'the', 'and', 'for', 'you', 'your', 'that', 'this', 'with', 'was', 'are', 'have', 'has',
  'can', 'but', 'not', 'what', 'when', 'where', 'why', 'how', 'who', 'from', 'about', 'into',
  'they', 'them', 'there', 'then', 'than', 'get', 'got', 'just', 'like', 'some', 'any', 'all',
  'its', "it's", 'his', 'her', 'him', 'she', 'their', 'our', 'were', 'been', 'being', 'does',
  'did', 'doing', 'would', 'could', 'should', 'will', 'one', 'two', 'now', 'out', 'off',
]);

export const words = (s: string): string[] => s.toLowerCase().match(/[a-z0-9']+/g) ?? [];

/** The words worth matching on: long enough to mean something, and not a stopword. */
export const keywords = (s: string): Set<string> =>
  new Set(words(s).filter((w) => w.length > 2 && !STOPWORDS.has(w)));
