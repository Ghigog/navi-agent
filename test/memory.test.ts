/**
 * Bounded persistent memory (NAV-93).
 *
 * The ticket's real test is the second describe block: with a thousand episodes stored, what
 * gets injected has to stay the same size as with none. A memory system that grows the prompt
 * makes a 3B model worse the longer you use it, which is the opposite of remembering.
 */

import { describe, expect, it } from 'vitest';
import {
  CONSOLIDATE_ABOVE,
  DECAY_MS,
  EMPTY,
  FACT_BUDGET,
  MAX_EPISODES,
  MAX_PREFERENCES,
  PROMOTE_AFTER,
  TOTAL_BUDGET,
  coerceMemory,
  consolidate,
  factTokens,
  forget,
  markUsed,
  needsConsolidation,
  prefer,
  recall,
  recordEpisode,
  remember,
  type Memory,
} from '../src/shared/memory.js';
import { estimateTokens } from '../src/shared/text.js';
import { createMemoryTools, MAX_FACT_CHARS } from '../src/agent/recall.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 10);

const fresh = (): Memory => structuredClone(EMPTY);

describe('facts', () => {
  it('remembers something durable and recalls it later', () => {
    const memory = remember(fresh(), 'They work on a Godot game called Navi.');
    expect(recall(memory, 'what am I working on').lines.join('\n')).toContain('Navi');
  });

  it('reinforces a repeated fact rather than storing it twice', () => {
    let memory = remember(fresh(), 'They use Neovim.', NOW);
    memory = remember(memory, 'they use neovim.', NOW + DAY);

    expect(memory.facts).toHaveLength(1);
    // The repeat is evidence the fact is live, so it survives consolidation longer.
    expect(memory.facts[0]?.at).toBe(NOW + DAY);
  });

  it('drops a fact the user deleted from everything afterwards', () => {
    let memory = remember(fresh(), 'They hate mornings.');
    const id = memory.facts[0]!.id;
    memory = forget(memory, id);

    expect(memory.facts).toHaveLength(0);
    expect(recall(memory, 'mornings').lines.join('\n')).not.toContain('mornings');
  });

  it('stays inside the fact budget by dropping the oldest, never the newest', () => {
    let memory = fresh();
    for (let i = 0; i < 400; i++) {
      memory = remember(memory, `Fact number ${i} about something they care about.`, NOW + i * DAY);
    }

    expect(factTokens(memory.facts)).toBeLessThanOrEqual(FACT_BUDGET);
    const texts = memory.facts.map((f) => f.text).join(' ');
    expect(texts).toContain('Fact number 399');
    expect(texts).not.toContain('Fact number 0 ');
  });
});

describe('the budget, with a thousand episodes', () => {
  /** A store the size the ticket names, on a range of dates and topics. */
  function loaded(): Memory {
    let memory = fresh();
    for (let i = 0; i < 20; i++) memory = remember(memory, `Durable fact ${i} about their work.`, NOW - i * DAY);
    for (let i = 0; i < 1000; i++) {
      memory = recordEpisode(memory, `Session ${i}: we talked about migration deploys and the terminal.`, NOW - i * DAY);
    }
    return memory;
  }

  it('injects the same amount whether the store is empty or full', () => {
    const empty = recall(fresh(), 'what did we decide about the migration', TOTAL_BUDGET, NOW);
    const full = recall(loaded(), 'what did we decide about the migration', TOTAL_BUDGET, NOW);

    expect(empty.tokens).toBeLessThanOrEqual(TOTAL_BUDGET);
    expect(full.tokens).toBeLessThanOrEqual(TOTAL_BUDGET);
  });

  it('never retrieves more than a handful of episodes however many match', () => {
    const full = recall(loaded(), 'migration deploys terminal', TOTAL_BUDGET, NOW);
    expect(full.used.length).toBeLessThanOrEqual(MAX_EPISODES);
  });

  it('drops the lowest-ranked episode when the budget is tight, never the fact sheet', () => {
    const memory = loaded();
    // A budget big enough for the facts and almost nothing else.
    const tight = factTokens(memory.facts) + 20;
    const result = recall(memory, 'migration deploys terminal', tight, NOW);

    expect(result.tokens).toBeLessThanOrEqual(tight);
    expect(result.lines.join('\n')).toContain('Durable fact 0');
    expect(result.used.length).toBeLessThan(MAX_EPISODES);
  });

  it('costs the same to retrieve from a full store as from a small one', () => {
    // Not a latency assertion — a shape one. Retrieval is a scan and a sort of the tags derived
    // at write time, so nothing here does per-episode work that grows with episode *size*.
    const memory = loaded();
    const runs = 20;
    const start = performance.now();
    for (let i = 0; i < runs; i++) recall(memory, 'migration deploys terminal', TOTAL_BUDGET, NOW);
    const perCall = (performance.now() - start) / runs;

    // Generous by two orders of magnitude: this fails on an accidental O(n²), not on a slow box.
    expect(perCall).toBeLessThan(50);
  });
});

describe('retrieval', () => {
  it('finds the episode that is about the question, not the most recent one', () => {
    let memory = fresh();
    memory = recordEpisode(memory, 'We planned the database migration in detail.', NOW - 180 * DAY);
    memory = recordEpisode(memory, 'We talked about lunch.', NOW - DAY);

    const result = recall(memory, 'what did we decide about the migration', TOTAL_BUDGET, NOW);
    expect(result.lines.join('\n')).toContain('database migration');
    expect(result.lines.join('\n')).not.toContain('lunch');
  });

  it('prefers the more recent of two equally relevant episodes', () => {
    let memory = fresh();
    memory = recordEpisode(memory, 'Migration notes, the old ones.', NOW - 300 * DAY);
    memory = recordEpisode(memory, 'Migration notes, the new ones.', NOW - DAY);

    const [first] = recall(memory, 'migration notes', TOTAL_BUDGET, NOW).lines.filter((l) => l.includes('Migration'));
    expect(first).toContain('the new ones');
  });

  it('retrieves nothing for a question nothing is about', () => {
    const memory = recordEpisode(fresh(), 'We planned the database migration.', NOW);
    expect(recall(memory, 'what is the weather', TOTAL_BUDGET, NOW).used).toEqual([]);
  });

  it('dates what it recalls, so she can say when rather than implying now', () => {
    const memory = recordEpisode(fresh(), 'We planned the migration.', Date.UTC(2026, 2, 14));
    const line = recall(memory, 'migration', TOTAL_BUDGET, NOW).lines.find((l) => l.includes('migration'));
    expect(line).toContain('2026-03-14');
  });
});

describe('consolidation and decay', () => {
  it('promotes an episode that keeps coming up into the fact sheet', () => {
    let memory = recordEpisode(fresh(), 'They always deploy on Fridays.', NOW);
    const id = memory.episodes[0]!.id;
    for (let i = 0; i < PROMOTE_AFTER; i++) memory = markUsed(memory, [id], NOW);

    const result = consolidate(memory, NOW);
    expect(result.promoted).toBe(1);
    expect(result.memory.facts.map((f) => f.text)).toContain('They always deploy on Fridays.');
    // And it stops costing a paragraph.
    expect(result.memory.episodes).toHaveLength(0);
  });

  it('drops what nobody has read in a long time and keeps what they have', () => {
    let memory = fresh();
    memory = recordEpisode(memory, 'Something nobody ever asked about again.', NOW - DECAY_MS - DAY);
    memory = recordEpisode(memory, 'Something they keep coming back to.', NOW - DECAY_MS - DAY);
    memory = markUsed(memory, [memory.episodes[1]!.id], NOW - DAY);

    const result = consolidate(memory, NOW);
    expect(result.dropped).toBe(1);
    expect(result.memory.episodes.map((e) => e.text)).toEqual(['Something they keep coming back to.']);
  });

  it('does not lose a promoted fact when it drops the episode it came from', () => {
    let memory = recordEpisode(fresh(), 'They prefer merge commits.', NOW - DECAY_MS - DAY);
    const id = memory.episodes[0]!.id;
    // Read often, but not lately — the case where promotion and decay disagree.
    for (let i = 0; i < PROMOTE_AFTER; i++) memory = markUsed(memory, [id], NOW - DECAY_MS - DAY);

    const result = consolidate(memory, NOW);
    expect(result.memory.episodes).toHaveLength(0);
    expect(result.memory.facts.map((f) => f.text)).toContain('They prefer merge commits.');
  });

  it('knows when it is worth running', () => {
    let memory = fresh();
    expect(needsConsolidation(memory)).toBe(false);
    for (let i = 0; i <= CONSOLIDATE_ABOVE; i++) memory = recordEpisode(memory, `Session ${i}.`, NOW - i * DAY);
    expect(needsConsolidation(memory)).toBe(true);
  });
});

describe('the relationship store', () => {
  it('is tiny, and always injected', () => {
    let memory = fresh();
    memory = prefer(memory, 'being asked before she looks at the screen', true);
    memory = prefer(memory, 'long preambles', false);

    const result = recall(memory, 'anything at all', TOTAL_BUDGET, NOW);
    expect(result.lines.join('\n')).toContain('being asked before she looks');
    expect(result.lines.join('\n')).toContain('long preambles');
    expect(estimateTokens(result.lines.join('\n'))).toBeLessThan(TOTAL_BUDGET);
  });

  it('moves an opinion rather than holding two', () => {
    let memory = prefer(fresh(), 'dark mode', true);
    memory = prefer(memory, 'dark mode', false);

    expect(memory.relationship.likes).toEqual([]);
    expect(memory.relationship.dislikes).toEqual(['dark mode']);
  });

  it('forgets the oldest preference rather than growing', () => {
    let memory = fresh();
    for (let i = 0; i < MAX_PREFERENCES + 4; i++) memory = prefer(memory, `preference ${i}`, true);

    expect(memory.relationship.likes).toHaveLength(MAX_PREFERENCES);
    expect(memory.relationship.likes[0]).toBe(`preference ${MAX_PREFERENCES + 3}`);
  });
});

describe('reading a stored file', () => {
  it('degrades junk to an empty memory rather than propagating it', () => {
    expect(coerceMemory(null)).toEqual(EMPTY);
    expect(coerceMemory('nonsense')).toEqual(EMPTY);
    expect(coerceMemory({ facts: 'not a list' })).toEqual(EMPTY);
  });

  it('keeps what is still recognisable and drops what is not', () => {
    const stored = {
      relationship: { likes: ['tea', 42], dislikes: [], name: 'Dylan' },
      facts: [{ id: 'a', text: 'They drink tea.', at: NOW }, { id: 'b', at: NOW }],
      episodes: [{ id: 'c', text: 'We talked.', at: NOW, tags: ['talked'], uses: 2 }],
    };
    const memory = coerceMemory(stored);

    expect(memory.relationship.likes).toEqual(['tea']);
    expect(memory.relationship.name).toBe('Dylan');
    expect(memory.facts).toHaveLength(1);
    expect(memory.episodes[0]?.uses).toBe(2);
  });

  it('survives a round trip through JSON', () => {
    let memory = remember(fresh(), 'They work on Navi.', NOW);
    memory = recordEpisode(memory, 'We shipped the port.', NOW);
    memory = prefer(memory, 'short answers', true);

    expect(coerceMemory(JSON.parse(JSON.stringify(memory)))).toEqual(memory);
  });
});

describe('the memory tools (NAV-93)', () => {
  it('writes a fact she was asked to remember', async () => {
    let stored = '';
    const [remember] = createMemoryTools({
      remember: (text) => {
        stored = text;
        return text;
      },
      prefer: () => {},
    });

    const result = await remember!.run({ fact: 'They work on a desktop app called Navi.' });
    expect(stored).toBe('They work on a desktop app called Navi.');
    expect(result.isError).toBeUndefined();
  });

  it('refuses a paragraph, because the fact sheet is a budget', async () => {
    let stored = '';
    const [remember] = createMemoryTools({
      remember: (text) => {
        stored = text;
        return text;
      },
      prefer: () => {},
    });

    const result = await remember!.run({ fact: 'x'.repeat(MAX_FACT_CHARS + 1) });
    expect(result.isError).toBe(true);
    expect(stored).toBe('');
  });

  it('notes a preference, taking a string "false" as false', async () => {
    const noted: Array<[string, boolean]> = [];
    const [, note] = createMemoryTools({ remember: (t) => t, prefer: (t, liked) => noted.push([t, liked]) });

    await note!.run({ about: 'long preambles', liked: 'false' });
    await note!.run({ about: 'short answers', liked: true });
    expect(noted).toEqual([['long preambles', false], ['short answers', true]]);
  });

  it('does not offer a retrieval tool', () => {
    // Retrieval happens before the turn, not as a tool call: a model that had to decide to look
    // something up would have to already know it was there.
    const names = createMemoryTools({ remember: (t) => t, prefer: () => {} }).map((t) => t.schema.name);
    expect(names).toEqual(['remember', 'note_preference']);
  });
});
