/**
 * Confidence and the approval loop (NAV-101).
 *
 * The described mechanic is a pet loop: tell her she did well, she gets surer of herself and
 * learns what you wanted. Before this the loop had no input at all — the user could be nice to
 * her, and could not tell her she was right.
 *
 * The test that matters most is the last block. Confidence may change how she carries herself
 * and may not change what she reports as true, because a confident Navi who is wrong is worse
 * than a hesitant one: the hedging was the only warning the user had (NAV-97).
 */

import { describe, expect, it } from 'vitest';
import {
  APPROVAL_STEP,
  CONFIDENCE_MAX,
  CONFIDENCE_MIN,
  CONFIDENCE_TONE,
  deriveConfidence,
  evaluate,
  NEUTRAL,
  type EmotionState,
} from '../src/shared/emotion.js';
import {
  describeTurn,
  LONG_REPLY_WORDS,
  MAX_DESCRIPTION_CHARS,
  SHORT_REPLY_WORDS,
  wordsIn,
} from '../src/shared/approval.js';
import { assemble } from '../src/prompt/builder.js';
import { HONESTY } from '../src/prompt/identity.js';
import { EMPTY, prefer, recall, TOTAL_BUDGET, type Memory } from '../src/shared/memory.js';

const at = (confidence: number): EmotionState => ({ ...NEUTRAL, confidence });

describe('confidence as a stat', () => {
  it('starts at nothing and is bounded in both directions', () => {
    expect(NEUTRAL.confidence).toBe(0);

    let state = at(0);
    for (let i = 0; i < 100; i++) state = evaluate(state, { approved: true }).state;
    expect(state.confidence).toBe(CONFIDENCE_MAX);

    for (let i = 0; i < 200; i++) state = evaluate(state, { approved: false }).state;
    expect(state.confidence).toBe(CONFIDENCE_MIN);
  });

  it('rises when the user says she did well', () => {
    const after = evaluate(at(0), { approved: true }).state;
    expect(after.confidence).toBe(APPROVAL_STEP);
  });

  it('counts being told for far more than guessing it went fine', () => {
    // Otherwise the approval loop is decorative: the whole ticket is that explicit beats
    // inferred.
    const told = evaluate(at(0), { approved: true }).state.confidence;
    const guessed = evaluate(at(0), { toolSucceeded: true, powerRelevant: true, toolsAvailable: true }).state.confidence;
    expect(told).toBeGreaterThan(guessed * 5);
  });

  it('does not confuse being liked with being right', () => {
    // Being pleasant and saying the answer was correct are different things. A companion that
    // conflated them would learn that politeness means she got it right.
    const kind = evaluate(at(0), { sentiment: 'kind' }).state;
    expect(kind.confidence).toBe(0);
  });

  it('loses its nerve slowly, over several bad turns rather than one', () => {
    let state = at(20);
    const after = evaluate(state, { analysisFailed: true }).state;
    expect(after.confidence).toBeGreaterThan(0);

    for (let i = 0; i < 20; i++) state = evaluate(state, { analysisFailed: true }).state;
    expect(state.confidence).toBeLessThan(0);
  });

  it('does not move on the pre-reply pass, which is about the message and not the answer', () => {
    expect(evaluate(at(10), { preEval: true, sentiment: 'mean' }).state.confidence).toBe(10);
  });

  it('reads out as a band, not a number', () => {
    expect(deriveConfidence(CONFIDENCE_MIN)).toBe('unsure');
    expect(deriveConfidence(0)).toBe('steady');
    expect(deriveConfidence(CONFIDENCE_MAX)).toBe('assured');
  });

  it('survives a round trip through the store', () => {
    const state = evaluate(at(0), { approved: true }).state;
    expect(JSON.parse(JSON.stringify(state)).confidence).toBe(APPROVAL_STEP);
  });
});

describe('what was approved, not just that it was', () => {
  it('describes a turn she answered from what she knew', () => {
    expect(describeTurn({ tools: [], hedged: false, words: 40 })).toBe('answering from what you already knew');
  });

  it('names the tools she used', () => {
    expect(describeTurn({ tools: ['look_near_cursor'], hedged: false, words: 40 })).toContain('look_near_cursor');
  });

  it('notices when looking was her idea', () => {
    // "Used the screen tool unprompted and was right" is the ticket's own example of the kind of
    // thing worth learning.
    const shape = { tools: ['look_at_screen'], askedToLook: false, hedged: false, words: 40 };
    expect(describeTurn(shape)).toContain('without being asked');
  });

  it('notices length and hedging, which people have opinions about', () => {
    expect(describeTurn({ tools: [], hedged: false, words: SHORT_REPLY_WORDS })).toContain('briefly');
    expect(describeTurn({ tools: [], hedged: false, words: LONG_REPLY_WORDS })).toContain('into detail');
    expect(describeTurn({ tools: [], hedged: true, words: 40 })).toContain('unsure');
  });

  it('stays short enough to live in the relationship budget', () => {
    const worst = describeTurn({
      tools: ['look_near_cursor', 'point_to', 'remember'],
      askedToLook: false,
      hedged: true,
      words: 500,
    });
    expect(worst.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS);
    // And it is not cut mid-word.
    expect(worst.endsWith(' ')).toBe(false);
  });

  it('counts words the way the thresholds do', () => {
    expect(wordsIn('  one   two three ')).toBe(3);
    expect(wordsIn('   ')).toBe(0);
  });
});

describe('accumulated approvals reach the prompt', () => {
  it('changes what she is told this person likes', () => {
    let memory: Memory = structuredClone(EMPTY);
    memory = prefer(memory, describeTurn({ tools: [], hedged: false, words: 20 }), true);

    const lines = recall(memory, 'anything').lines.join('\n');
    expect(lines).toContain('answering from what you already knew');
    expect(lines).toContain('briefly');
  });

  it('stays inside the relationship budget as approvals accumulate', () => {
    // The store is capped and newest-wins, so a hundred approvals cost the same as six.
    let memory: Memory = structuredClone(EMPTY);
    for (let i = 0; i < 100; i++) {
      memory = prefer(memory, describeTurn({ tools: [`tool_${i}`], hedged: false, words: 40 }), i % 2 === 0);
    }

    const result = recall(memory, 'anything');
    expect(result.tokens).toBeLessThanOrEqual(TOTAL_BUDGET);
    // And the most recent opinion is the one she carries.
    expect(result.lines.join('\n')).toContain('tool_99');
  });
});

describe('confidence changes how she speaks, and not what is true', () => {
  const ctx = (confidence: number) => ({ personality: '', tools: [], emotion: at(confidence) });

  it('produces different guidance at each band', () => {
    const unsure = assemble(ctx(CONFIDENCE_MIN));
    const assured = assemble(ctx(CONFIDENCE_MAX));

    expect(unsure).toContain(CONFIDENCE_TONE.unsure);
    expect(assured).toContain(CONFIDENCE_TONE.assured);
    expect(unsure).not.toBe(assured);
  });

  it('tells an unsure Navi to hedge more and an assured one to hedge less', () => {
    expect(CONFIDENCE_TONE.unsure).toMatch(/say when you are guessing/i);
    expect(CONFIDENCE_TONE.assured).toMatch(/do not pad with disclaimers/i);
  });

  it('does not let confidence license fabrication, at any level', () => {
    // NAV-97's bound, at the one place confidence could plausibly erode it. Each band says so in
    // its own words, and the honesty rule is present unchanged either way.
    for (const level of [CONFIDENCE_MIN, 0, CONFIDENCE_MAX]) {
      expect(assemble(ctx(level))).toContain(HONESTY);
    }

    expect(CONFIDENCE_TONE.assured).toMatch(/not licence to answer what you cannot answer/i);
    expect(CONFIDENCE_TONE.assured).toMatch(/I don't know/i);
    // And the other way: being unsure is not a reason to say something she does not believe.
    expect(CONFIDENCE_TONE.unsure).toMatch(/never a reason to say something you do not believe/i);
  });

  it('is not one of the three dimensions, and does not change her colour', () => {
    // emotions.md maps exactly three dimensions onto eight composite emotions and onto her
    // tint. A fourth would change both, which is why this one sits beside them.
    const low = evaluate(at(CONFIDENCE_MIN), {}).state;
    const high = evaluate(at(CONFIDENCE_MAX), {}).state;
    expect(low.emotion).toBe(high.emotion);
  });
});
