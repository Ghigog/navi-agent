import { describe, expect, it } from 'vitest';
import type OpenAI from 'openai';
import { createConversation, explain, MAX_HISTORY, type ChatEvent } from '../src/main/conversation.js';
import { ToolRegistry } from '../src/agent/tools.js';
import { DEFAULTS, type Settings } from '../src/shared/settings.js';
import {
  coerceState,
  evaluate,
  NEUTRAL,
  type EmotionState,
  type Sentiment,
  type TurnOutcome,
} from '../src/shared/emotion.js';

/** A streaming client. Each element is one turn's worth of content. */
function fakeProvider(replies: string[] = ['hello'], opts: { fail?: boolean; hang?: boolean } = {}) {
  const bodies: Array<Record<string, unknown>> = [];
  let turn = 0;
  const client = {
    chat: {
      completions: {
        create: async (body: Record<string, unknown>, req?: { signal?: AbortSignal }) => {
          bodies.push(body);
          if (opts.fail) throw new Error('fetch failed');
          const content = replies[turn++] ?? '';
          if (opts.hang) {
            return (async function* () {
              yield { choices: [{ delta: { content } }] };
              await new Promise((_r, reject) => {
                // A real client rejects an already-aborted request rather than waiting for an
                // abort event that has been and gone.
                if (req?.signal?.aborted) reject(new Error('aborted'));
                req?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
              });
            })();
          }
          return (async function* () {
            yield { choices: [{ delta: { content } }] };
          })();
        },
      },
    },
  };
  return { provider: { client: client as unknown as OpenAI, model: 'm', remote: false }, bodies };
}

/** The real engine over an in-memory state, which is all `main/emotion-store.ts` adds to it. */
function fakeStore(initial: EmotionState = { ...NEUTRAL }) {
  let state = initial;
  const scored: TurnOutcome[] = [];
  return {
    scored,
    current: () => state,
    store: {
      load: () => state,
      record: (outcome: TurnOutcome) => {
        scored.push(outcome);
        const result = evaluate(state, outcome);
        state = result.state;
        return result;
      },
    },
  };
}

function setup(
  opts: {
    replies?: string[];
    settings?: Partial<Settings>;
    sentiment?: Sentiment;
    fail?: boolean;
    hang?: boolean;
    state?: EmotionState;
  } = {},
) {
  const { provider, bodies } = fakeProvider(opts.replies ?? ['hello'], {
    ...(opts.fail === undefined ? {} : { fail: opts.fail }),
    ...(opts.hang === undefined ? {} : { hang: opts.hang }),
  });
  const emotion = fakeStore(opts.state ?? { ...NEUTRAL });
  const events: ChatEvent[] = [];
  const settings: Settings = { ...DEFAULTS, ...opts.settings };

  const conversation = createConversation({
    settings: () => settings,
    createProvider: () => provider,
    registry: new ToolRegistry(),
    emotion: emotion.store,
    emit: (e) => events.push(e),
    classify: async () => opts.sentiment ?? 'neutral',
  });

  return { conversation, events, bodies, emotion };
}

const kinds = (events: ChatEvent[]): string[] => events.map((e) => e.type);

describe('createConversation', () => {
  it('sends the message and streams the reply back', async () => {
    const { conversation, events, bodies } = setup({ replies: ['hi there'] });
    await conversation.send('hello');

    const sent = bodies[0]?.['messages'] as Array<{ role: string; content: string }>;
    expect(sent.at(-1)).toEqual({ role: 'user', content: 'hello' });
    expect(events.filter((e) => e.type === 'delta').map((e) => e.text).join('')).toBe('hi there');
    expect(kinds(events)).toContain('done');
  });

  it('keeps the exchange in history for the next turn', async () => {
    const { conversation, bodies } = setup({ replies: ['first', 'second'] });
    await conversation.send('one');
    await conversation.send('two');

    const second = bodies[1]?.['messages'] as Array<{ role: string; content: string }>;
    // system, then the whole exchange so far.
    expect(second.slice(1)).toEqual([
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'first' },
      { role: 'user', content: 'two' },
    ]);
  });

  it('bounds history rather than growing it forever', async () => {
    const { conversation } = setup({ replies: Array.from({ length: 40 }, (_, i) => `r${i}`) });
    for (let i = 0; i < 30; i++) await conversation.send(`m${i}`);

    expect(conversation.history().length).toBeLessThanOrEqual(MAX_HISTORY);
    // A history that opens on a reply is a reply to a message the model cannot see.
    expect(conversation.history()[0]?.role).toBe('user');
  });

  it('ignores an empty message', async () => {
    const { conversation, events } = setup();
    await conversation.send('   ');
    expect(events).toHaveLength(0);
  });

  it('reports a provider failure and does not keep the message', async () => {
    const { conversation, events } = setup({ fail: true });
    await conversation.send('hello');

    expect(kinds(events)).toEqual(['start', 'emotion', 'error']);
    // Keeping it would send it twice on the retry.
    expect(conversation.history()).toHaveLength(0);
  });

  it('keeps what she managed to say when a turn is cancelled', async () => {
    const { conversation, events } = setup({ replies: ['half a th'], hang: true });
    const running = conversation.send('hello');
    await new Promise((r) => setTimeout(r, 10));
    conversation.cancel();
    await running;

    const done = events.find((e) => e.type === 'done');
    expect(done).toMatchObject({ cancelled: true, text: 'half a th' });
    // What is in history is what is on screen.
    expect(conversation.history()).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'half a th' },
    ]);
  });

  it('does not score a cancelled turn', async () => {
    const { conversation, emotion } = setup({ replies: ['x'], hang: true });
    const running = conversation.send('hello');
    await new Promise((r) => setTimeout(r, 10));
    conversation.cancel();
    await running;

    // Only the pre-reply pass ran. An interrupted turn is not a reading of how she did.
    expect(emotion.scored).toHaveLength(1);
    expect(emotion.scored[0]?.preEval).toBe(true);
  });

  it('drops a second message sent while one is in flight', async () => {
    const { conversation } = setup({ replies: ['x'], hang: true });
    const running = conversation.send('first');
    await conversation.send('second');
    conversation.cancel();
    await running;

    expect(conversation.history().map((m) => m.content)).not.toContain('second');
  });

  it('announces the provider and the mood when the window opens', async () => {
    const { conversation, events } = setup({ settings: { provider: 'ollama', ollamaModel: 'llama3.2:3b' } });
    conversation.describeState();

    expect(events[0]).toEqual({ type: 'provider', model: 'llama3.2:3b', remote: false });
    expect(events[1]).toMatchObject({ type: 'emotion', emotion: 'serenity' });
  });

  it('says so when the request leaves the machine', async () => {
    const { conversation, events } = setup({
      settings: { provider: 'openai', openaiApiKey: 'k', openaiModel: 'gpt-4o-mini' },
    });
    conversation.describeState();
    expect(events[0]).toEqual({ type: 'provider', model: 'gpt-4o-mini', remote: true });
  });
});

describe('the two emotion passes (emotions.md §4.4)', () => {
  it('feels the message before answering it, and moves the meter after', async () => {
    const { conversation, emotion, events } = setup({ sentiment: 'kind' });
    await conversation.send('you are wonderful');

    expect(emotion.scored[0]).toMatchObject({ preEval: true, sentiment: 'kind' });
    expect(emotion.scored[1]).toMatchObject({ sentiment: 'kind', sentimentDimensionsApplied: true });
    // The tint reaches the UI before the reply as well as after it.
    const order = kinds(events);
    expect(order.indexOf('emotion')).toBeLessThan(order.indexOf('done'));
  });

  it('generates the reply in the mood the message put her in', async () => {
    const { conversation, bodies } = setup({ sentiment: 'mean' });
    await conversation.send('you are useless');

    // Courage -5 and Power -4 read as Low/High/Low: sadness. If the prompt still said serenity,
    // the pre-reply pass would be shaping the turn after this one instead of this one.
    const system = (bodies[0]?.['messages'] as Array<{ content: string }>)[0]?.content ?? '';
    expect(system).toContain('You are feeling sadness');
  });

  it('counts a kind message once, not once per pass', async () => {
    const { conversation, emotion } = setup({ sentiment: 'kind' });
    await conversation.send('thank you');

    // emotions.md §4.4 states courage +3 and the Love Meter +15 for a kind message, each once.
    expect(emotion.current().courage).toBe(3);
    expect(emotion.current().wisdom).toBe(2);
    expect(emotion.current().loveScore).toBe(15);
  });

  it('counts a mean message once, not once per pass', async () => {
    const { conversation, emotion } = setup({ sentiment: 'mean' });
    await conversation.send('you are useless');

    expect(emotion.current().courage).toBe(-5);
    expect(emotion.current().power).toBe(-4);
    expect(emotion.current().loveScore).toBe(-40);
  });

  it('leaves an ordinary message alone', async () => {
    const { conversation, emotion } = setup({ sentiment: 'neutral' });
    await conversation.send('what time is it');

    // Nothing was exercised: no tool, no history to recall from, a short prompt. She should
    // come out exactly where she went in, rather than decaying for having been spoken to.
    expect(emotion.current()).toEqual(NEUTRAL);
  });

  it('does not decay her over a long ordinary conversation', async () => {
    const { conversation, emotion } = setup({ replies: Array.from({ length: 12 }, () => 'sure') });
    for (let i = 0; i < 12; i++) await conversation.send(`just chatting ${i}`);

    expect(emotion.current().emotion).toBe('serenity');
    expect(emotion.current().loveScore).toBeGreaterThanOrEqual(0);
  });

  it('reloads the state it left behind', async () => {
    const { conversation, emotion } = setup({ sentiment: 'mean' });
    await conversation.send('you are useless');

    // What emotion-store.ts writes and reads back is this state through coerceState.
    expect(coerceState(JSON.parse(JSON.stringify(emotion.current())))).toEqual(emotion.current());
  });
});

describe('explain', () => {
  it('names the thing that is not running on the offline path', () => {
    const settings: Settings = { ...DEFAULTS, ollamaBaseUrl: 'http://localhost:11434' };
    expect(explain(new Error('fetch failed'), settings)).toContain('http://localhost:11434');
  });

  it('passes a real provider message through', () => {
    const settings: Settings = { ...DEFAULTS, provider: 'openai' };
    expect(explain(new Error('401 Incorrect API key'), settings)).toBe('401 Incorrect API key');
  });
});
