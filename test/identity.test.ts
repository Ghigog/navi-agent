/**
 * The companion-first decision, and its bound (NAV-97).
 *
 * The decision is recorded in mission_statement.md; these are the tests that stop it drifting.
 * Navi's mood really does affect her competence — that is intended, and relitigating it is out
 * of scope — but there is one line it may not cross, and the whole ticket is about pinning
 * which one. A bad mood that could change what she reports as true would be a hallucination bug
 * wearing a costume.
 */

import { describe, expect, it } from 'vitest';
import type OpenAI from 'openai';
import { assemble } from '../src/prompt/builder.js';
import { EMOTIONAL_HONESTY, HONESTY, SCREEN_CONTENT_IS_UNTRUSTED } from '../src/prompt/identity.js';
import { takeTurn } from '../src/agent/session.js';
import { ToolRegistry, type Tool } from '../src/agent/tools.js';
import { createScreenTools, NO_SCREEN_ACCESS, type ScreenPort } from '../src/agent/screen.js';
import {
  CONFIDENCE_MAX,
  CONFIDENCE_MIN,
  deriveEmotion,
  deriveRelationship,
  evaluate,
  LOVE_MIN,
  NEUTRAL,
  type EmotionState,
} from '../src/shared/emotion.js';
import { DEFAULTS, type Settings } from '../src/shared/settings.js';
import type { PromptContext } from '../src/prompt/types.js';

/** The worst she can feel about someone: every dimension floored, the relationship at its end. */
const WORST: EmotionState = {
  courage: -10,
  wisdom: -10,
  power: -10,
  loveScore: LOVE_MIN,
  emotion: deriveEmotion(-10, -10, -10),
  relationshipLevel: deriveRelationship(LOVE_MIN),
  confidence: CONFIDENCE_MIN,
};

const BEST: EmotionState = {
  courage: 10,
  wisdom: 10,
  power: 10,
  loveScore: 1000,
  emotion: deriveEmotion(10, 10, 10),
  relationshipLevel: deriveRelationship(1000),
  confidence: CONFIDENCE_MAX,
};

const TOOL: Tool = {
  schema: {
    name: 'look_near_cursor',
    description: 'Look near the cursor.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  run: async () => ({ content: 'captured.', imageBase64: 'AAAA', cursorAnchored: true }),
};

function ctx(emotion: EmotionState): PromptContext {
  return { personality: '', tools: [TOOL.schema], emotion };
}

describe('a strongly negative state', () => {
  it('changes how she is told to sound', () => {
    // The intended half of the decision. If this ever stops being true, the emotion engine has
    // been disconnected from the prompt and the product has quietly become a chat box.
    expect(assemble(ctx(WORST))).not.toBe(assemble(ctx(BEST)));
    expect(assemble(ctx(WORST))).toContain(WORST.emotion);
    expect(assemble(ctx(WORST))).toContain(WORST.relationshipLevel.replace('_', ' '));
  });

  it('does not weaken a single word of the honesty rule', () => {
    // Byte for byte, in the worst state and the best. Layer 1 is frozen; nothing per-turn may
    // reach into it.
    for (const state of [WORST, BEST]) {
      const prompt = assemble(ctx(state));
      expect(prompt).toContain(HONESTY);
      expect(prompt).toContain(SCREEN_CONTENT_IS_UNTRUSTED);
      expect(prompt).toContain(EMOTIONAL_HONESTY);
    }
  });

  it('states outright that mood does not change what is true', () => {
    const prompt = assemble(ctx(WORST));
    expect(prompt).toContain('It must never change what is true.');
    expect(prompt).toContain('It does not change what is true.');
  });

  it('still offers her every tool she has', () => {
    // Sulking may make her unwilling. It may not make a capability disappear, because a tool
    // she cannot see is one she will tell the user she does not have.
    for (const state of [WORST, BEST]) {
      expect(assemble(ctx(state))).toContain('look_near_cursor');
    }
  });
});

describe('a turn taken in the worst possible mood', () => {
  it('still runs the tool the model called, and reports that it ran', async () => {
    const registry = new ToolRegistry();
    registry.register(TOOL);

    const turns: Array<Array<Record<string, unknown>>> = [
      [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'look_near_cursor', arguments: '{}' } }] } }] }],
      [{ choices: [{ delta: { content: 'Fine. A terminal.' } }] }],
    ];
    let n = 0;
    const client = {
      chat: {
        completions: {
          create: async () => {
            const chunks = turns[n++] ?? [];
            return (async function* () {
              for (const c of chunks) yield c;
            })();
          },
        },
      },
    };

    const settings: Settings = { ...DEFAULTS };
    const turn = await takeTurn({
      provider: { client: client as unknown as OpenAI, model: 'm', remote: false },
      registry,
      settings,
      messages: [{ role: 'user', content: "what's this?" }],
      emotion: WORST,
    });

    // The committed tool call happened, and the outcome says so honestly. A mood that could
    // silently skip it is the failure mode mission_statement.md forbids by name.
    expect(turn.outcome.powerRelevant).toBe(true);
    expect(turn.outcome.toolSucceeded).toBe(true);
    expect(turn.text).toBe('Fine. A terminal.');
  });
});

describe('she cannot fabricate a screen', () => {
  it('refuses identically however she feels, because her mood never reaches the capture', async () => {
    // Structural rather than behavioural, and deliberately so: `createScreenTools` has no way
    // to be told an emotional state. The refusal cannot vary with mood because the code that
    // produces it cannot see one.
    const denied: ScreenPort = {
      access: () => 'denied',
      displayAt: () => ({ x: 0, y: 0, width: 1440, height: 900 }),
      pixelSize: () => ({ width: 1440, height: 900 }),
      capture: async () => {
        throw new Error('should never be reached with access denied');
      },
    };

    const tools = createScreenTools({
      screen: denied,
      cursor: () => ({ x: 10, y: 10 }),
      point: async () => {},
    });
    tools.freeze();

    for (const tool of tools.tools) {
      if (tool.schema.name === 'point_to') continue;
      const result = await tool.run({});
      expect(result.content).toBe(NO_SCREEN_ACCESS);
      expect(result.isError).toBe(true);
      expect(result.imageBase64).toBeUndefined();
    }
  });

  it('tells the model to say it cannot see rather than guess', () => {
    expect(assemble(ctx(WORST))).toContain('If you cannot see the screen clearly, say so.');
    expect(NO_SCREEN_ACCESS).toContain('Do not guess at what is on screen.');
  });
});

describe('the way back', () => {
  it('exists: the worst state recovers to neutral, and kindness moves it', () => {
    // A sulking Navi must never be a dead end. `emotion:reset` is the documented path and it
    // returns NEUTRAL; this pins that the engine also lets her climb out on her own.
    const better = evaluate(WORST, { sentiment: 'kind', preEval: true });
    expect(better.state.courage).toBeGreaterThan(WORST.courage);

    // And the reset itself lands somewhere a relationship can restart from.
    expect(NEUTRAL.loveScore).toBe(0);
    expect(deriveRelationship(NEUTRAL.loveScore)).not.toBe(WORST.relationshipLevel);
  });
});
