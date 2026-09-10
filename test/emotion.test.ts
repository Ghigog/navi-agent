import { describe, expect, it } from 'vitest';
import {
  coerceState,
  containsHedging,
  deriveEmotion,
  deriveRelationship,
  emotionColor,
  evaluate,
  NEUTRAL,
  retrievalRelevance,
  tintFor,
  type EmotionState,
  type TurnOutcome,
} from '../src/shared/emotion.js';

/** A turn that exercised everything, so relevance is not what is under test. */
function fullTurn(over: TurnOutcome = {}): TurnOutcome {
  return {
    courageRelevant: true,
    wisdomRelevant: true,
    powerRelevant: true,
    ...over,
  };
}

describe('composite emotion', () => {
  it('maps every high/low combination to its emotion', () => {
    expect(deriveEmotion(5, 5, 5)).toBe('serenity');
    expect(deriveEmotion(5, -5, 5)).toBe('happiness');
    expect(deriveEmotion(5, 5, -5)).toBe('boredom');
    expect(deriveEmotion(-5, 5, 5)).toBe('fear');
    expect(deriveEmotion(-5, 5, -5)).toBe('sadness');
    expect(deriveEmotion(-5, -5, 5)).toBe('anger');
    expect(deriveEmotion(5, -5, -5)).toBe('pain');
    expect(deriveEmotion(-5, -5, -5)).toBe('oblivion');
  });

  it('reads exactly zero as High, so a fresh Navi is serene rather than oblivious', () => {
    expect(deriveEmotion(0, 0, 0)).toBe('serenity');
    expect(NEUTRAL.emotion).toBe('serenity');
  });
});

describe('relationship bands', () => {
  it('places each score in its band, including at the boundaries', () => {
    expect(deriveRelationship(1000)).toBe('best_friend');
    expect(deriveRelationship(600)).toBe('best_friend');
    expect(deriveRelationship(599)).toBe('friend');
    expect(deriveRelationship(200)).toBe('friend');
    expect(deriveRelationship(199)).toBe('acquaintance');
    expect(deriveRelationship(0)).toBe('acquaintance');
    expect(deriveRelationship(-199)).toBe('acquaintance');
    expect(deriveRelationship(-200)).toBe('enemy');
    expect(deriveRelationship(-599)).toBe('enemy');
    expect(deriveRelationship(-600)).toBe('nemesis');
    expect(deriveRelationship(-1000)).toBe('nemesis');
  });
});

describe('relevance gating', () => {
  // The reason this exists: without it, every ordinary conversational turn scores Power as
  // "no tool available" and she decays into Oblivion just by being talked to.
  it('leaves a dimension untouched when the turn did not exercise it', () => {
    const prev: EmotionState = { ...NEUTRAL, courage: 6, wisdom: 4, power: -3 };
    const { state, promptScore } = evaluate(prev, { toolsAvailable: false });

    expect(state.courage).toBe(6);
    expect(state.wisdom).toBe(4);
    expect(state.power).toBe(-3);
    expect(promptScore).toBe(0);
  });

  it('does not move the Love Meter for an irrelevant dimension', () => {
    const chatty = evaluate({ ...NEUTRAL, loveScore: 300 }, { responseText: 'Hello.' });
    expect(chatty.state.loveScore).toBe(300);
    expect(chatty.state.relationshipLevel).toBe('friend');
  });

  it('scores a relevant dimension from zero rather than accumulating', () => {
    const proud: EmotionState = { ...NEUTRAL, courage: 10 };
    const { state } = evaluate(proud, { courageRelevant: true, intentClear: true });
    // +5 for clear intent, and nothing carried over from the 10.
    expect(state.courage).toBe(5);
  });
});

describe('courage', () => {
  it('rewards a clear intent and punishes an unclear one', () => {
    expect(evaluate(NEUTRAL, { courageRelevant: true, intentClear: true }).state.courage).toBe(5);
    expect(evaluate(NEUTRAL, { courageRelevant: true, intentClear: false }).state.courage).toBe(-5);
  });

  it('adds for history and subtracts for a long, tangled prompt', () => {
    const withHistory = evaluate(NEUTRAL, { courageRelevant: true, memoryEntries: 3 });
    expect(withHistory.state.courage).toBe(8);

    const rambling = evaluate(NEUTRAL, { courageRelevant: true, promptWords: 200 });
    expect(rambling.state.courage).toBe(1);
  });
});

describe('wisdom', () => {
  it('scores on how much of the prompt the available context actually covered', () => {
    const strong = evaluate(NEUTRAL, { wisdomRelevant: true, retrievalRelevance: 0.9 });
    expect(strong.state.wisdom).toBe(6);

    const partial = evaluate(NEUTRAL, { wisdomRelevant: true, retrievalRelevance: 0.5 });
    expect(partial.state.wisdom).toBe(3);

    const nothing = evaluate(NEUTRAL, { wisdomRelevant: true, retrievalRelevance: 0 });
    expect(nothing.state.wisdom).toBe(-5);
  });

  it('penalises a hedged reply', () => {
    const hedged = evaluate(NEUTRAL, {
      wisdomRelevant: true,
      retrievalRelevance: 0.9,
      responseText: "I'm not sure what that window is.",
    });
    expect(hedged.state.wisdom).toBe(3);
  });

  it('detects hedging regardless of case', () => {
    expect(containsHedging("I DON'T KNOW")).toBe(true);
    expect(containsHedging('That is the Finder window.')).toBe(false);
  });
});

describe('power', () => {
  it('scores highest for a tool that ran and succeeded', () => {
    expect(evaluate(NEUTRAL, { powerRelevant: true, toolsAvailable: true, toolSucceeded: true }).state.power).toBe(7);
    expect(evaluate(NEUTRAL, { powerRelevant: true, toolsAvailable: true, toolSucceeded: false }).state.power).toBe(3);
    expect(evaluate(NEUTRAL, { powerRelevant: true, toolsAvailable: false }).state.power).toBe(-6);
  });

  it('costs Power on a failed turn even when no tool was involved', () => {
    // The one path where a dimension moves without its relevance flag: she tried and could not.
    const { state, promptScore } = evaluate(NEUTRAL, { analysisFailed: true });
    expect(state.power).toBe(-5);
    expect(promptScore).toBe(-5);
  });
});

describe('user sentiment', () => {
  it('rewards kindness and punishes hostility, asymmetrically', () => {
    const kind = evaluate(NEUTRAL, { sentiment: 'kind' });
    expect(kind.promptScore).toBe(15);
    expect(kind.state.courage).toBe(3);
    expect(kind.state.wisdom).toBe(2);

    const mean = evaluate(NEUTRAL, { sentiment: 'mean' });
    expect(mean.promptScore).toBe(-40);
    expect(mean.state.courage).toBe(-5);
    expect(mean.state.power).toBe(-4);
    // Courage and Power drop, but Wisdom is untouched: she still knows what she knows.
    expect(mean.state.emotion).toBe('sadness');
  });

  it('leaves everything alone when the message was neutral', () => {
    const { state, promptScore } = evaluate(NEUTRAL, { sentiment: 'neutral' });
    expect(state).toEqual(NEUTRAL);
    expect(promptScore).toBe(0);
  });

  it('cannot be farmed past the ceiling', () => {
    let state: EmotionState = { ...NEUTRAL, loveScore: 995 };
    for (let i = 0; i < 5; i++) state = evaluate(state, { sentiment: 'kind' }).state;
    expect(state.loveScore).toBe(1000);
  });
});

describe('the Love Meter', () => {
  it('sums the relevant contributions plus the sentiment adjustment', () => {
    const { promptScore } = evaluate(
      NEUTRAL,
      fullTurn({
        intentClear: true, // courage +5
        retrievalRelevance: 0.9, // wisdom +6
        toolsAvailable: true,
        toolSucceeded: true, // power +7
        sentiment: 'kind', // +15
      }),
    );
    expect(promptScore).toBe(33);
  });

  it('accumulates across turns and moves the relationship', () => {
    let state = NEUTRAL;
    for (let i = 0; i < 10; i++) {
      state = evaluate(state, fullTurn({ retrievalRelevance: 0.9, toolsAvailable: true, toolSucceeded: true })).state;
    }
    expect(state.loveScore).toBe(180);
    expect(state.relationshipLevel).toBe('acquaintance');

    for (let i = 0; i < 2; i++) {
      state = evaluate(state, fullTurn({ retrievalRelevance: 0.9, toolsAvailable: true, toolSucceeded: true })).state;
    }
    expect(state.loveScore).toBe(216);
    expect(state.relationshipLevel).toBe('friend');
  });

  it('is clamped at both ends', () => {
    let state: EmotionState = { ...NEUTRAL, loveScore: -980 };
    state = evaluate(state, { sentiment: 'mean' }).state;
    expect(state.loveScore).toBe(-1000);
    expect(state.relationshipLevel).toBe('nemesis');
  });

  it('reports what changed', () => {
    const result = evaluate({ ...NEUTRAL, loveScore: 190 }, fullTurn({ intentClear: false, toolsAvailable: false }));
    expect(result.emotionChanged).toBe(true);
    expect(result.relationshipChanged).toBe(false);
  });
});

describe('the pre-reply pass', () => {
  // Sentiment is classified before the reply so it can colour that reply. The Love Meter must
  // not move twice for one message, so the pre-pass shapes the mood and pays nothing.
  it('moves the dimensions but not the relationship', () => {
    const { state, promptScore } = evaluate({ ...NEUTRAL, loveScore: 100 }, { sentiment: 'mean', preEval: true });

    expect(promptScore).toBe(0);
    expect(state.loveScore).toBe(100);
    expect(state.courage).toBe(-5);
    expect(state.emotion).toBe('sadness');
  });
});

describe('persistence', () => {
  it('round-trips a state through JSON', () => {
    const before = evaluate(NEUTRAL, fullTurn({ retrievalRelevance: 0.9, toolsAvailable: true })).state;
    expect(coerceState(JSON.parse(JSON.stringify(before)))).toEqual(before);
  });

  it('falls back to neutral for anything unreadable', () => {
    expect(coerceState(null)).toEqual(NEUTRAL);
    expect(coerceState('serenity')).toEqual(NEUTRAL);
    expect(coerceState({})).toEqual(NEUTRAL);
    expect(coerceState({ courage: 'lots' })).toEqual(NEUTRAL);
  });

  it('re-derives the labels rather than trusting them, so the file cannot be edited into a lie', () => {
    const forged = coerceState({
      courage: -9,
      wisdom: -9,
      power: -9,
      loveScore: -900,
      emotion: 'serenity',
      relationshipLevel: 'best_friend',
    });
    expect(forged.emotion).toBe('oblivion');
    expect(forged.relationshipLevel).toBe('nemesis');
  });

  it('clamps values written out of range', () => {
    const wild = coerceState({ courage: 99, wisdom: -99, power: 0, loveScore: 50_000 });
    expect(wild.courage).toBe(10);
    expect(wild.wisdom).toBe(-10);
    expect(wild.loveScore).toBe(1000);
  });
});

describe('the tint', () => {
  it('maps each dimension to its channel', () => {
    const courageous = emotionColor(10, -10, -10, 0);
    expect(courageous.g).toBeGreaterThan(courageous.r);
    expect(courageous.g).toBeGreaterThan(courageous.b);

    const powerful = emotionColor(-10, -10, 10, 0);
    expect(powerful.r).toBeGreaterThan(powerful.g);

    const wise = emotionColor(-10, 10, -10, 0);
    expect(wise.b).toBeGreaterThan(wise.g);
  });

  it('dims as the relationship sours', () => {
    const loved = tintFor({ ...NEUTRAL, courage: 10, wisdom: 10, power: 10, loveScore: 1000 });
    const loathed = tintFor({ ...NEUTRAL, courage: 10, wisdom: 10, power: 10, loveScore: -1000 });
    expect(loved.g).toBeGreaterThan(loathed.g);
  });

  it('stays inside the byte range at the extremes', () => {
    for (const c of [emotionColor(10, 10, 10, 1000), emotionColor(-10, -10, -10, -1000)]) {
      for (const v of [c.r, c.g, c.b]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe('retrieval relevance', () => {
  it('is 1 when everything asked about is already in context', () => {
    expect(retrievalRelevance('the deploy script', ['We fixed the deploy script yesterday.'])).toBe(1);
  });

  it('is 0 when nothing overlaps', () => {
    expect(retrievalRelevance('what is this window', ['We talked about gardening.'])).toBe(0);
  });

  it('is 0 with no context at all', () => {
    expect(retrievalRelevance('what is this window', [])).toBe(0);
  });

  it('does not count filler words as recall', () => {
    // Otherwise every question scores highly on "the", "what" and "this", and Wisdom stops
    // meaning anything.
    expect(retrievalRelevance('what is the thing that you have', ['The what and the that.'])).toBe(0);
  });

  it('scores partial overlap in between', () => {
    const r = retrievalRelevance('kubernetes cluster billing', ['The kubernetes cluster is fine.']);
    expect(r).toBeCloseTo(2 / 3);
  });
});

describe('sentimentDimensionsApplied', () => {
  it('still moves the Love Meter', () => {
    // The post-turn pass owns the relationship, whichever pass moved the dimensions.
    const kind = evaluate(NEUTRAL, { sentiment: 'kind', sentimentDimensionsApplied: true });
    expect(kind.state.loveScore).toBe(15);
    const mean = evaluate(NEUTRAL, { sentiment: 'mean', sentimentDimensionsApplied: true });
    expect(mean.state.loveScore).toBe(-40);
  });

  it('leaves the dimensions alone', () => {
    const state = evaluate(NEUTRAL, { sentiment: 'mean', sentimentDimensionsApplied: true }).state;
    expect(state.courage).toBe(NEUTRAL.courage);
    expect(state.power).toBe(NEUTRAL.power);
  });

  it('is what stops one message being felt twice', () => {
    // The pre-reply pass applies the nudge; the post-turn pass must not apply it again to a
    // dimension the turn did not exercise and so did not rescore from zero.
    const pre = evaluate(NEUTRAL, { preEval: true, sentiment: 'mean' }).state;
    expect(pre.courage).toBe(-5);

    const post = evaluate(pre, { sentiment: 'mean', sentimentDimensionsApplied: true }).state;
    expect(post.courage).toBe(-5);

    const doubled = evaluate(pre, { sentiment: 'mean' }).state;
    expect(doubled.courage).toBe(-10);
  });
});
