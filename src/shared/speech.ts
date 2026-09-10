/**
 * Turning a stream of tokens into things worth saying out loud (NAV-104).
 *
 * Pure, because the hard part is not spawning a synthesiser — it is deciding *when* there is
 * enough text to start. Waiting for the finished reply undoes the point of streaming it: she
 * would think for four seconds, then start speaking four seconds of audio. Sentence at a time
 * means she starts talking about as soon as a person would.
 *
 * The other half of the job is knowing what not to read. A model writes for a screen — asterisks,
 * backticks, bullet markers — and a synthesiser will happily pronounce all of it.
 */

/**
 * Ends a sentence, unless it is one of the abbreviations below.
 *
 * Whitespace is required *after* the punctuation, and that is load-bearing rather than tidy.
 * Text arrives a token at a time, so the end of the buffer is not the end of anything: treat it
 * as one and "It is 3." gets spoken the instant the model has written the 3 of 3.5. The last
 * sentence of a reply therefore leaves through `flush`, which is the only place that knows
 * there is no more coming.
 *
 * A newline is an ending in its own right: models write lists, and a bullet that never gets a
 * full stop would otherwise sit in the buffer until the next one arrived.
 *
 * The closing quotes and brackets are consumed rather than looked at, so `She said "no."` keeps
 * its quote instead of handing it to the next sentence.
 */
const TERMINATORS = /[.!?…]["')\]]*(?=\s)|\n/g;

/**
 * Full stops that do not end a sentence. Short, and deliberately so: every entry is a guess
 * about English, and the cost of being wrong is a half-sentence spoken early, which is a much
 * smaller problem than a paragraph never spoken at all.
 */
const ABBREVIATIONS = ['mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'e.g', 'i.e', 'vs', 'etc', 'fig', 'no'];

/** Shorter than this and it is very likely a decimal point or an initial, not a sentence. */
const MIN_SENTENCE = 4;

/**
 * Strips what a synthesiser should not pronounce.
 *
 * Code fences go entirely: a shell command read aloud is noise, and she will have shown it on
 * screen anyway. Everything else is unwrapped rather than removed — the words inside emphasis
 * are still words.
 */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/(\*\*|__|\*|_)/g, '')
    .replace(/[ \t]+/g, ' ')
    // Whatever the strips left behind — a blank line where a code block was, the space before
    // a newline — collapses to a single break rather than becoming a pause she reads out.
    .replace(/ ?\n\s*/g, '\n')
    .trim();
}

function endsInAbbreviation(text: string): boolean {
  const word = text.trimEnd().replace(/[."')\]]+$/, '').split(/[\s(]/).pop() ?? '';
  return ABBREVIATIONS.includes(word.toLowerCase());
}

export interface SentenceStream {
  /** Feeds a delta in, and returns whatever complete sentences that delta finished. */
  push(delta: string): string[];
  /** The tail, at the end of a reply. Returns null when there is nothing left worth saying. */
  flush(): string | null;
  /** Drops everything buffered. For a cancelled turn: she stops mid-thought, as a person would. */
  clear(): void;
}

export function createSentenceStream(): SentenceStream {
  let buffer = '';

  const take = (): string[] => {
    const out: string[] = [];
    // Where the sentence being built starts, and where to look for its ending. They differ
    // whenever a terminator turned out not to be one: the search moves on, the sentence does
    // not, so "e.g. --force" carries on accumulating instead of being split at the abbreviation.
    let start = 0;
    let from = 0;

    for (;;) {
      TERMINATORS.lastIndex = from;
      const match = TERMINATORS.exec(buffer);
      if (!match) break;

      const end = match.index + match[0].length;
      from = end;

      const candidate = buffer.slice(start, end);
      if (candidate.trim().length < MIN_SENTENCE || endsInAbbreviation(candidate)) continue;

      const spoken = speakable(candidate);
      if (spoken !== '') out.push(spoken);
      start = end;
    }

    buffer = buffer.slice(start);
    return out;
  };

  return {
    push(delta) {
      buffer += delta;
      return take();
    },
    flush() {
      const spoken = speakable(buffer);
      buffer = '';
      return spoken === '' ? null : spoken;
    },
    clear() {
      buffer = '';
    },
  };
}
