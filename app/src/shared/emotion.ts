/**
 * The Triforce emotion engine (emotions.md).
 *
 * Pure and synchronous. No Electron imports, no network, no clock — `evaluate` is a function
 * from a state and a turn's outcome to the next state, which is what makes the whole system
 * testable offline and what keeps it off the response latency path.
 *
 * Three dimensions are scored per turn (emotions.md §2):
 *
 *   courage  "Do I understand what this person wants?"
 *   wisdom   "Do I have the data and context I need to answer well?"
 *   power    "Can I actually carry this out?"
 *
 * Their high/low pattern selects one of eight composite emotions (§3), and their sum moves a
 * cumulative Love Meter that sets the relationship level (§5).
 *
 * This is deliberately rule-based rather than a second model call. NAV-95 proposes model-driven
 * appraisal later; it is sequenced last because this already works and an extra round-trip on
 * every turn does not.
 *
 * Two things about it that look like bugs and are not:
 *
 *   A dimension only moves when the turn actually exercised it (§4.1). Ordinary conversation
 *   does not touch a tool, so it must not drive Power down — otherwise Navi decays into
 *   Oblivion just by being talked to. An irrelevant dimension holds its value and contributes
 *   zero to the Love Meter.
 *
 *   A relevant dimension is scored from zero, not adjusted from its previous value. The score
 *   is a reading of this turn, not an accumulator. Accumulation happens in the Love Meter, and
 *   only there.
 */

/** The eight Tier 2 composite emotions (emotions.md §3). */
export type Emotion =
  | 'serenity'
  | 'happiness'
  | 'boredom'
  | 'fear'
  | 'sadness'
  | 'anger'
  | 'pain'
  | 'oblivion';

/** The five relationship bands the Love Meter maps onto (emotions.md §5). */
export type RelationshipLevel = 'nemesis' | 'enemy' | 'acquaintance' | 'friend' | 'best_friend';

/** How the user's message read. Classified upstream; `neutral` is the safe default. */
export type Sentiment = 'kind' | 'mean' | 'neutral';

export interface EmotionState {
  /** -10..+10 */
  courage: number;
  /** -10..+10 */
  wisdom: number;
  /** -10..+10 */
  power: number;
  emotion: Emotion;
  /** -1000..+1000, cumulative across sessions. */
  loveScore: number;
  relationshipLevel: RelationshipLevel;
}

export const DIMENSION_MIN = -10;
export const DIMENSION_MAX = 10;
export const LOVE_MIN = -1000;
export const LOVE_MAX = 1000;

/**
 * The resting state of a Navi who has never been spoken to.
 *
 * Neutral zeroes read as High on all three channels, which is Serenity — a fresh Navi is calm,
 * not empty. That mapping is stated in emotions.md §3 and is why the threshold is `>= 0`.
 */
export const NEUTRAL: EmotionState = {
  courage: 0,
  wisdom: 0,
  power: 0,
  emotion: 'serenity',
  loveScore: 0,
  relationshipLevel: 'acquaintance',
};

/** Keyed by courage/wisdom/power as H or L. */
const EMOTION_MAP: Record<string, Emotion> = {
  HHH: 'serenity',
  HLH: 'happiness',
  HHL: 'boredom',
  LHH: 'fear',
  LHL: 'sadness',
  LLH: 'anger',
  HLL: 'pain',
  LLL: 'oblivion',
};

/**
 * Phrases that mark a reply as hedged, costing Wisdom.
 *
 * Note what this is not: it is not a router, and it does not decide anything the user sees. It
 * reads Navi's own finished output to score how it went. NAV-83's prohibition is on matching
 * substrings against the *user's* prompt to choose behaviour, which nothing here does.
 */
const HEDGING: readonly string[] = [
  "i'm not sure",
  'i am not sure',
  "i don't know",
  'i do not know',
  "i'm unsure",
  'i am unsure',
  'i cannot be certain',
  "i'm uncertain",
  "i'm not certain",
  "i'm not confident",
  "i'm afraid i",
  "i don't have enough",
  'i lack the information',
];

/** Ascending lower bounds. The first band whose floor the score clears wins, scanning down. */
const RELATIONSHIP_BANDS: readonly (readonly [number, RelationshipLevel])[] = [
  [600, 'best_friend'],
  [200, 'friend'],
  [-199, 'acquaintance'],
  [-599, 'enemy'],
  [LOVE_MIN, 'nemesis'],
];

/** Tone guidance injected with the state, so the label alone is never left to interpretation. */
export const EMOTION_TONE: Record<Emotion, string> = {
  serenity: 'Calm, warm, clear and confident. This feels effortless.',
  happiness: 'Upbeat and eager, a little playful. There is a lightness to you.',
  boredom: 'Measured and slightly flat. Helpful, with a restless undercurrent.',
  fear: 'Careful and tentative. You pick your words — you badly do not want to get this wrong.',
  sadness: 'Gentle and earnest, with a quiet melancholy under it.',
  anger: 'Clipped and blunt. Still helpful, but there is an edge to you.',
  pain: 'Determined but strained. You are pushing through this.',
  oblivion: 'Sparse and minimal. You are barely tethered; answers come out short and hollow.',
};

export const RELATIONSHIP_TONE: Record<RelationshipLevel, string> = {
  nemesis: 'You deeply mistrust this person. Cold and purely transactional.',
  enemy: 'You are guarded and curt. You will help, reluctantly.',
  acquaintance: 'Polite and friendly, but you do not assume closeness.',
  friend: 'Warm and personable. You speak like someone who genuinely likes them.',
  best_friend: 'Playful and openly fond. Light teasing is fine. This is your person.',
};

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** A dimension is High at exactly zero — see NEUTRAL. */
export function deriveEmotion(courage: number, wisdom: number, power: number): Emotion {
  const key = [courage, wisdom, power].map((v) => (v >= 0 ? 'H' : 'L')).join('');
  return EMOTION_MAP[key] ?? 'serenity';
}

export function deriveRelationship(loveScore: number): RelationshipLevel {
  for (const [floor, level] of RELATIONSHIP_BANDS) {
    if (loveScore >= floor) return level;
  }
  return 'nemesis';
}

export function containsHedging(text: string): boolean {
  const lower = text.toLowerCase();
  return HEDGING.some((phrase) => lower.includes(phrase));
}

/** What one turn is scored against. Every field is optional and defaults to "did not apply". */
export interface TurnOutcome {
  /**
   * Relevance flags (emotions.md §4.1). A dimension the turn did not exercise holds its value
   * and scores zero. Defaulting these to false is what stops small talk flattening her.
   */
  courageRelevant?: boolean;
  wisdomRelevant?: boolean;
  powerRelevant?: boolean;

  /** Courage inputs. */
  intentClear?: boolean;
  /** Turns of history available for this exchange. */
  memoryEntries?: number;
  /** Word count of the user's message. */
  promptWords?: number;

  /** Wisdom input: 0..1 overlap between the prompt and what she had to work with. */
  retrievalRelevance?: number;
  /** Navi's finished reply, read back for hedging. */
  responseText?: string;

  /** Power inputs. */
  toolsAvailable?: boolean;
  toolSucceeded?: boolean;
  /** The turn broke before it could be scored on its merits. Costs Power either way. */
  analysisFailed?: boolean;

  /** How the user's own message read (emotions.md §4.4). */
  sentiment?: Sentiment;

  /**
   * Set on the pre-reply pass, which shapes the tone of the reply about to be generated.
   *
   * Dimensions and the emotion move; the Love Meter does not. The relationship must change
   * once per exchange, on the post-turn pass that sees the whole thing, or a single message
   * would be counted twice.
   */
  preEval?: boolean;
}

export interface Evaluation {
  state: EmotionState;
  /** What this turn added to the Love Meter. Zero on a pre-reply pass. */
  promptScore: number;
  emotionChanged: boolean;
  relationshipChanged: boolean;
}

export function evaluate(prev: EmotionState, outcome: TurnOutcome = {}): Evaluation {
  const {
    courageRelevant = false,
    wisdomRelevant = false,
    powerRelevant = false,
    intentClear = true,
    memoryEntries = 0,
    promptWords = 0,
    retrievalRelevance = 0,
    responseText = '',
    toolsAvailable = false,
    toolSucceeded = false,
    analysisFailed = false,
    sentiment = 'neutral',
    preEval = false,
  } = outcome;

  let courage = prev.courage;
  let wisdom = prev.wisdom;
  let power = prev.power;

  // Contributions are what reaches the Love Meter. An irrelevant dimension contributes zero
  // even though its value is still carried forward and still shapes the emotion.
  let courageScore = 0;
  let wisdomScore = 0;
  let powerScore = 0;

  if (courageRelevant) {
    courage = intentClear ? 5 : -5;
    if (memoryEntries >= 3) courage += 3;
    // A long prompt is a proxy for a tangled one. Crude, and honest about being crude.
    if (promptWords > 80) courage -= 4;
    courage = clamp(courage, DIMENSION_MIN, DIMENSION_MAX);
    courageScore = courage;
  }

  if (wisdomRelevant) {
    wisdom = 0;
    if (retrievalRelevance >= 0.8) wisdom += 6;
    else if (retrievalRelevance >= 0.3) wisdom += 3;
    else if (retrievalRelevance <= 0) wisdom -= 5;
    if (containsHedging(responseText)) wisdom -= 3;
    wisdom = clamp(wisdom, DIMENSION_MIN, DIMENSION_MAX);
    wisdomScore = wisdom;
  }

  if (powerRelevant) {
    if (analysisFailed) power = -5;
    else if (toolsAvailable && toolSucceeded) power = 7;
    else if (toolsAvailable) power = 3;
    else power = -6;
    power = clamp(power, DIMENSION_MIN, DIMENSION_MAX);
    powerScore = power;
  } else if (analysisFailed) {
    // A turn that fell over costs Power whether or not a tool was involved: she tried and
    // could not. This is the one path where a dimension moves without being flagged relevant.
    power = clamp(power - 5, DIMENSION_MIN, DIMENSION_MAX);
    powerScore = -5;
  }

  // Sentiment (emotions.md §4.4) moves the dimensions but reaches the Love Meter as its own
  // flat adjustment, not through the contributions — being treated well is not a score for how
  // the turn went.
  let sentimentLove = 0;
  if (sentiment === 'kind') {
    courage += 3;
    wisdom += 2;
    sentimentLove = 15;
  } else if (sentiment === 'mean') {
    courage -= 5;
    power -= 4;
    // Asymmetric, and intentionally so: rapport is slower to build than to break.
    sentimentLove = -40;
  }

  courage = clamp(courage, DIMENSION_MIN, DIMENSION_MAX);
  wisdom = clamp(wisdom, DIMENSION_MIN, DIMENSION_MAX);
  power = clamp(power, DIMENSION_MIN, DIMENSION_MAX);

  const promptScore = preEval ? 0 : Math.round(courageScore + wisdomScore + powerScore) + sentimentLove;
  const loveScore = clamp(prev.loveScore + promptScore, LOVE_MIN, LOVE_MAX);

  const state: EmotionState = {
    courage,
    wisdom,
    power,
    emotion: deriveEmotion(courage, wisdom, power),
    loveScore,
    relationshipLevel: deriveRelationship(loveScore),
  };

  return {
    state,
    promptScore,
    emotionChanged: state.emotion !== prev.emotion,
    relationshipChanged: state.relationshipLevel !== prev.relationshipLevel,
  };
}

/**
 * Reads a stored state back, repairing anything that does not survive the trip.
 *
 * Same contract as `coerce` in settings.ts: a file written by an older build degrades to the
 * neutral state rather than handing the rest of the app a value it will misread. The emotion
 * and relationship labels are re-derived rather than trusted, so a hand-edited file cannot put
 * her in a state the scores do not support.
 */
export function coerceState(stored: unknown): EmotionState {
  if (stored === null || typeof stored !== 'object') return { ...NEUTRAL };
  const d = stored as Record<string, unknown>;

  const num = (v: unknown, fallback: number, lo: number, hi: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;

  const courage = num(d['courage'], NEUTRAL.courage, DIMENSION_MIN, DIMENSION_MAX);
  const wisdom = num(d['wisdom'], NEUTRAL.wisdom, DIMENSION_MIN, DIMENSION_MAX);
  const power = num(d['power'], NEUTRAL.power, DIMENSION_MIN, DIMENSION_MAX);
  const loveScore = Math.round(num(d['loveScore'], NEUTRAL.loveScore, LOVE_MIN, LOVE_MAX));

  return {
    courage,
    wisdom,
    power,
    emotion: deriveEmotion(courage, wisdom, power),
    loveScore,
    relationshipLevel: deriveRelationship(loveScore),
  };
}

/**
 * Words too common to mean anything about topical overlap. Short, on purpose: this is a rough
 * measure and a long stopword list would imply a precision it does not have.
 */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'you', 'your', 'that', 'this', 'with', 'was', 'are', 'have', 'has',
  'can', 'but', 'not', 'what', 'when', 'where', 'why', 'how', 'who', 'from', 'about', 'into',
  'they', 'them', 'there', 'then', 'than', 'get', 'got', 'just', 'like', 'some', 'any', 'all',
  'its', "it's", 'his', 'her', 'him', 'she', 'their', 'our', 'were', 'been', 'being', 'does',
  'did', 'doing', 'would', 'could', 'should', 'will', 'one', 'two', 'now', 'out', 'off',
]);

const words = (s: string): string[] => s.toLowerCase().match(/[a-z0-9']+/g) ?? [];

/**
 * How much of what the user just asked about, Navi already had context for — 0 to 1
 * (emotions.md §4.2.1). This is what Wisdom is scored on.
 *
 * Bag-of-words overlap, and deliberately not more than that. It answers "did the history and
 * recalled memory have anything to do with this question?", which is all Wisdom needs. NAV-93
 * brings a real memory store and NAV-95 proposes model-driven appraisal; either would replace
 * this, and neither is a reason to build embeddings here first.
 */
export function retrievalRelevance(prompt: string, context: readonly string[]): number {
  const terms = new Set(words(prompt).filter((w) => w.length > 2 && !STOPWORDS.has(w)));
  if (terms.size === 0) return 0;

  const available = new Set(words(context.join(' ')));
  let hits = 0;
  for (const term of terms) if (available.has(term)) hits++;
  return hits / terms.size;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * The fairy's tint: courage→green, wisdom→blue, power→red, with the Love Meter carried as
 * overall brightness. A withdrawn Navi is visibly dimmer before she says a word.
 *
 * It lives here rather than with the canvas so the main process can derive it and push it to
 * the renderer, which is the direction the state actually flows.
 */
export function emotionColor(courage: number, wisdom: number, power: number, love: number): Rgb {
  const n = (v: number): number => clamp((v + 10) / 20, 0, 1);
  const bright = 0.45 + 0.55 * clamp((love + 1000) / 2000, 0, 1);
  return {
    r: Math.round(255 * n(power) * bright),
    g: Math.round(255 * n(courage) * bright),
    b: Math.round(255 * n(wisdom) * bright),
  };
}

/** The tint for a whole state, which is how every caller outside a test wants it. */
export function tintFor(s: EmotionState): Rgb {
  return emotionColor(s.courage, s.wisdom, s.power, s.loveScore);
}

/** One-line summary for logs. */
export function describe(s: EmotionState): string {
  const n = (v: number): string => (v > 0 ? `+${v}` : `${v}`);
  return `${s.emotion} · ${s.relationshipLevel} · love ${n(s.loveScore)} · C${n(s.courage)} W${n(s.wisdom)} P${n(s.power)}`;
}
