/**
 * Bounded persistent memory (NAV-93).
 *
 * `mission_statement.md` names Growth as one of Navi's three desires and tells her to ask the
 * user to help her remember. Before this she asked and then forgot.
 *
 * **This is a module about budgets, not about storage.** The daily driver is a 3B local model
 * whose effective context is small and which degrades noticeably as it fills, so "store
 * everything and inject it" would make Navi worse the longer you used her — the exact opposite
 * of the intent. Size control is a functional requirement here. Everything below exists to keep
 * injected memory inside a fixed budget however much has accumulated behind it.
 *
 * Three stores, three lifecycles, kept apart because conflating them is what makes memory blow
 * up:
 *
 *   Relationship  tiny, always injected, structured. What she has learned you like.
 *   Facts         small, always injected, consolidated when full. Durable things about you.
 *   Episodes      many, retrieved, decayed. What happened, with a date on it.
 *
 * Pure and synchronous. `main/memory-store.ts` persists it; nothing here touches a disk, which
 * is what lets a thousand episodes and a retrieval budget be tested in a millisecond.
 */

import { estimateTokens, keywords } from './text.js';

/**
 * Something durable about the user. Written when they say something that will still be true
 * next week, or when they ask her to remember it.
 */
export interface Fact {
  id: string;
  text: string;
  /** When it was written or last reinforced. Consolidation prefers to keep the fresh ones. */
  at: number;
  /** Set when consolidation promoted it out of episodes, so the viewer can say where it came from. */
  derived?: boolean;
}

/** A session, summarised, with enough on it to be found again. */
export interface Episode {
  id: string;
  text: string;
  at: number;
  /** Topic words, for retrieval. Derived on write so retrieval does no work per turn per episode. */
  tags: string[];
  /** When it was last retrieved. Never-retrieved episodes are what decay removes. */
  usedAt?: number;
  /** How often it has been retrieved. A memory that keeps coming up is worth promoting. */
  uses: number;
}

/**
 * What she has learned you like — structured fields, never prose.
 *
 * The cheapest and highest-value memory in the system: it is most of what makes her feel like
 * she knows you, and it costs almost nothing to carry. NAV-101 writes to it.
 */
export interface Relationship {
  /** Things the user has approved of. Kept short; the newest wins. */
  likes: string[];
  /** Things the user has pushed back on. */
  dislikes: string[];
  /** What they call themselves, if they have said. */
  name?: string;
}

export interface Memory {
  relationship: Relationship;
  facts: Fact[];
  episodes: Episode[];
}

export const EMPTY: Memory = { relationship: { likes: [], dislikes: [] }, facts: [], episodes: [] };

/**
 * The budgets, in estimated tokens.
 *
 * These are the numbers the whole module exists to hold. They are small because the model is
 * small: on `llama3.2:3b`, memory competing with the conversation for context is how
 * remembering makes her worse at listening.
 */
export const RELATIONSHIP_BUDGET = 100;
export const FACT_BUDGET = 500;
/** Everything injected, all three stores together. Episodes get whatever the first two leave. */
export const TOTAL_BUDGET = 900;

/** Retrieved per turn, at most. Three is enough to be useful and few enough to stay cheap. */
export const MAX_EPISODES = 3;

/** Kept in the relationship store per list. Beyond this the oldest is forgotten. */
export const MAX_PREFERENCES = 6;

/**
 * How long an episode has to go unread before decay takes it.
 *
 * A memory system that never forgets eventually drowns. Ninety days is long enough that a
 * seasonal thing — a project you pick up each quarter — survives a gap, and short enough that a
 * store still grows slower than it is pruned.
 */
export const DECAY_MS = 90 * 24 * 60 * 60 * 1000;

/** An episode retrieved this many times has earned a place in the fact sheet. */
export const PROMOTE_AFTER = 3;

/** Consolidation runs when there are more episodes than this. */
export const CONSOLIDATE_ABOVE = 200;

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Ids are only ever compared and deleted by, never parsed. Time plus a counter is enough. */
let counter = 0;
export function newId(at = Date.now()): string {
  counter = (counter + 1) % 100000;
  return `${at.toString(36)}-${counter.toString(36)}`;
}

const normalise = (text: string): string => text.trim().replace(/\s+/g, ' ');

/**
 * Adds a fact, or reinforces one already known.
 *
 * Reinforcing rather than duplicating matters more than it looks: a user who mentions their job
 * three times should not spend three times the budget on it, and the repeat is evidence the
 * fact is a live one rather than a reason to store it again.
 */
export function remember(memory: Memory, text: string, at = Date.now()): Memory {
  const clean = normalise(text);
  if (clean === '') return memory;

  const existing = memory.facts.find((f) => f.text.toLowerCase() === clean.toLowerCase());
  if (existing) {
    return { ...memory, facts: memory.facts.map((f) => (f.id === existing.id ? { ...f, at } : f)) };
  }

  const facts = [...memory.facts, { id: newId(at), text: clean, at }];
  return consolidateFacts({ ...memory, facts });
}

export function forget(memory: Memory, id: string): Memory {
  return {
    ...memory,
    facts: memory.facts.filter((f) => f.id !== id),
    episodes: memory.episodes.filter((e) => e.id !== id),
  };
}

/** Records a session summary. Tags are derived once, here, rather than per turn at retrieval. */
export function recordEpisode(memory: Memory, text: string, at = Date.now()): Memory {
  const clean = normalise(text);
  if (clean === '') return memory;

  const episode: Episode = { id: newId(at), text: clean, at, tags: [...keywords(clean)], uses: 0 };
  return { ...memory, episodes: [...memory.episodes, episode] };
}

/**
 * Notes a preference.
 *
 * Newest-first and capped, because this store is always injected and a list that grows is a
 * budget that grows. An entry that appears in the other list moves rather than contradicting
 * itself: a user who liked something and now does not has changed their mind, not acquired two
 * opinions.
 */
export function prefer(memory: Memory, text: string, liked: boolean): Memory {
  const clean = normalise(text);
  if (clean === '') return memory;

  const drop = (list: string[]): string[] => list.filter((v) => v.toLowerCase() !== clean.toLowerCase());
  const likes = drop(memory.relationship.likes);
  const dislikes = drop(memory.relationship.dislikes);

  const target = liked ? likes : dislikes;
  target.unshift(clean);

  return {
    ...memory,
    relationship: { ...memory.relationship, likes: likes.slice(0, MAX_PREFERENCES), dislikes: dislikes.slice(0, MAX_PREFERENCES) },
  };
}

// ---------------------------------------------------------------------------
// Keeping it small
// ---------------------------------------------------------------------------

const factLine = (f: Fact): string => `- ${f.text}`;

export function factTokens(facts: readonly Fact[]): number {
  return estimateTokens(facts.map(factLine).join('\n'));
}

/**
 * Brings the fact sheet back inside its budget by dropping the oldest facts.
 *
 * The ticket asks for consolidation rather than truncation, and this is the honest version of
 * that on a local stack: merging two facts into one needs a model call, which would put a
 * network round trip inside a write. What happens instead is that the *oldest* facts go — a
 * fact reinforced by being mentioned again has its timestamp refreshed and survives — and the
 * episodes they came from remain, so a dropped fact can be recalled rather than being gone.
 *
 * It is never silent. The caller is told what was dropped so the user can be.
 */
export function consolidateFacts(memory: Memory): Memory {
  if (factTokens(memory.facts) <= FACT_BUDGET) return memory;

  // Newest first, keeping as many as fit.
  const ordered = [...memory.facts].sort((a, b) => b.at - a.at);
  const kept: Fact[] = [];
  for (const fact of ordered) {
    if (factTokens([...kept, fact]) > FACT_BUDGET) break;
    kept.push(fact);
  }
  return { ...memory, facts: kept.sort((a, b) => a.at - b.at) };
}

/**
 * Rolls episodes into facts and drops the ones nobody reads.
 *
 * This is the actual answer to unbounded growth, and it runs on a schedule rather than on every
 * write: an episode that keeps being retrieved is promoted to the fact sheet, where it costs a
 * line instead of a paragraph, and an episode nothing has looked at in `DECAY_MS` is dropped.
 * Promotion happens before decay so that a memory earning its place is not thrown away by age.
 */
export function consolidate(memory: Memory, now = Date.now()): { memory: Memory; promoted: number; dropped: number } {
  let next = memory;
  let promoted = 0;

  for (const episode of memory.episodes) {
    if (episode.uses < PROMOTE_AFTER) continue;
    next = remember(next, episode.text, episode.at);
    promoted++;
  }

  const before = next.episodes.length;
  const episodes = next.episodes.filter((e) => {
    if (e.uses >= PROMOTE_AFTER) return false; // now a fact
    const last = e.usedAt ?? e.at;
    return now - last < DECAY_MS;
  });

  return { memory: { ...next, episodes }, promoted, dropped: before - episodes.length };
}

export const needsConsolidation = (memory: Memory): boolean => memory.episodes.length > CONSOLIDATE_ABOVE;

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

/**
 * How well an episode answers this question.
 *
 * Keyword overlap plus recency, and deliberately not embeddings. The ticket is explicit: do not
 * start with embeddings, add them only if keyword retrieval measurably fails, and measure
 * before deciding. A local embedding model is a second model on the latency path of every turn,
 * which is a large cost to pay before anyone has shown the cheap thing is not enough.
 *
 * Recency is a tiebreak rather than a term of its own weight: "what did we decide about the
 * migration" should find the migration episode from March over an unrelated one from Tuesday.
 */
export function score(episode: Episode, query: Set<string>, now: number): number {
  if (query.size === 0) return 0;

  let hits = 0;
  for (const tag of episode.tags) if (query.has(tag)) hits++;
  if (hits === 0) return 0;

  const overlap = hits / query.size;
  // Halves every 30 days. Enough to break ties, not enough to bury a direct match.
  const ageDays = Math.max(0, (now - episode.at) / (24 * 60 * 60 * 1000));
  return overlap * (1 + 0.5 * Math.pow(0.5, ageDays / 30));
}

export interface Recall {
  /** The lines to inject, in prompt order. Already inside the budget. */
  lines: string[];
  /** Ids of the episodes used, so the caller can mark them retrieved. */
  used: string[];
  tokens: number;
}

function relationshipLines(r: Relationship): string[] {
  const lines: string[] = [];
  if (r.name !== undefined && r.name.trim() !== '') lines.push(`They go by ${r.name.trim()}.`);
  if (r.likes.length > 0) lines.push(`They have liked: ${r.likes.join('; ')}.`);
  if (r.dislikes.length > 0) lines.push(`They have pushed back on: ${r.dislikes.join('; ')}.`);
  return lines;
}

/**
 * What to inject for one turn, inside `TOTAL_BUDGET`.
 *
 * The order is the priority order, and the budget is enforced from the bottom up: when it is
 * tight, the lowest-ranked episode goes first and the fact sheet never does. That rule is the
 * ticket's, and it is the right way round — an episode is a nice-to-have and the fact sheet is
 * most of what makes her seem to know you.
 */
export function recall(memory: Memory, query: string, budget = TOTAL_BUDGET, now = Date.now()): Recall {
  const lines: string[] = [];
  let tokens = 0;

  const push = (line: string): boolean => {
    const cost = estimateTokens(line);
    if (tokens + cost > budget) return false;
    lines.push(line);
    tokens += cost;
    return true;
  };

  for (const line of relationshipLines(memory.relationship)) push(line);
  for (const fact of memory.facts) push(factLine(fact));

  const terms = keywords(query);
  const ranked = memory.episodes
    .map((episode) => ({ episode, value: score(episode, terms, now) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_EPISODES);

  const used: string[] = [];
  for (const { episode } of ranked) {
    const line = `- (${new Date(episode.at).toISOString().slice(0, 10)}) ${episode.text}`;
    if (!push(line)) break;
    used.push(episode.id);
  }

  return { lines, used, tokens };
}

/** Marks retrieved episodes, which is what decay and promotion read. */
export function markUsed(memory: Memory, ids: readonly string[], at = Date.now()): Memory {
  if (ids.length === 0) return memory;
  const set = new Set(ids);
  return {
    ...memory,
    episodes: memory.episodes.map((e) => (set.has(e.id) ? { ...e, usedAt: at, uses: e.uses + 1 } : e)),
  };
}

/**
 * Reads a stored file back, dropping anything that no longer looks like memory.
 *
 * Same rule as `coerceState` and `coerce`: a file written by an older build should degrade to
 * something usable rather than propagate a shape the rest of the app will misread.
 */
export function coerceMemory(stored: unknown): Memory {
  if (stored === null || typeof stored !== 'object') return structuredClone(EMPTY);
  const raw = stored as Partial<Record<keyof Memory, unknown>>;

  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

  const rel = (raw.relationship ?? {}) as Partial<Relationship>;
  const name = typeof rel.name === 'string' ? rel.name : undefined;

  return {
    relationship: {
      likes: list(rel.likes).map(str).filter((s) => s !== '').slice(0, MAX_PREFERENCES),
      dislikes: list(rel.dislikes).map(str).filter((s) => s !== '').slice(0, MAX_PREFERENCES),
      ...(name === undefined ? {} : { name }),
    },
    facts: list(raw.facts)
      .map((f) => f as Partial<Fact>)
      .filter((f) => typeof f.text === 'string' && f.text !== '')
      .map((f) => ({ id: str(f.id) || newId(), text: str(f.text), at: num(f.at) })),
    episodes: list(raw.episodes)
      .map((e) => e as Partial<Episode>)
      .filter((e) => typeof e.text === 'string' && e.text !== '')
      .map((e) => ({
        id: str(e.id) || newId(),
        text: str(e.text),
        at: num(e.at),
        tags: list(e.tags).map(str).filter((s) => s !== ''),
        uses: num(e.uses),
        ...(typeof e.usedAt === 'number' ? { usedAt: e.usedAt } : {}),
      })),
  };
}
