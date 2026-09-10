/**
 * Session summaries (NAV-93).
 *
 * The property that matters: it fails towards remembering nothing. An episode that could not be
 * produced is strictly better than an episode containing a model's apology, because everything
 * downstream treats an episode as something the user actually said.
 */

import { describe, expect, it } from 'vitest';
import type OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { MIN_MESSAGES, parseSummary, summariseSession, transcriptOf } from '../src/agent/summary.js';
import { SUMMARY_WINDOW } from '../src/prompt/memory.js';

function fakeClient(reply: string | (() => never)) {
  const bodies: Array<Record<string, unknown>> = [];
  const client = {
    chat: {
      completions: {
        create: async (body: Record<string, unknown>) => {
          bodies.push(body);
          if (typeof reply === 'function') reply();
          return { choices: [{ message: { role: 'assistant', content: reply } }] };
        },
      },
    },
  };
  return { client: client as unknown as OpenAI, bodies };
}

const exchange = (n: number): ChatCompletionMessageParam[] =>
  Array.from({ length: n }, (_, i) =>
    i % 2 === 0
      ? ({ role: 'user', content: `question ${i}` } as const)
      : ({ role: 'assistant', content: `answer ${i}` } as const),
  );

describe('transcriptOf', () => {
  it('labels who said what', () => {
    expect(transcriptOf(exchange(2))).toEqual(['User: question 0', 'Navi: answer 1']);
  });

  it('keeps the tail, because a long session drifts', () => {
    const lines = transcriptOf(exchange(40));
    expect(lines).toHaveLength(SUMMARY_WINDOW);
    expect(lines.at(-1)).toBe('Navi: answer 39');
  });

  it('drops a screen capture rather than describing having seen one', () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'user', content: [{ type: 'text', text: 'what is this' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }] },
      { role: 'assistant', content: 'A terminal.' },
    ];
    expect(transcriptOf(messages)).toEqual(['User: what is this', 'Navi: A terminal.']);
  });

  it('skips system and tool messages', () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: 'you are navi' },
      { role: 'tool', tool_call_id: 'c1', content: 'captured.' },
      { role: 'user', content: 'hello' },
    ];
    expect(transcriptOf(messages)).toEqual(['User: hello']);
  });
});

describe('parseSummary', () => {
  it('takes a summary as written', () => {
    expect(parseSummary('They planned the database migration and chose merge commits.')).toBe(
      'They planned the database migration and chose merge commits.',
    );
  });

  it('strips the preamble a small model adds despite being told not to', () => {
    expect(parseSummary('Summary: They planned the migration in detail.')).toBe(
      'They planned the migration in detail.',
    );
    expect(parseSummary('"They planned the migration in detail."')).toBe(
      'They planned the migration in detail.',
    );
  });

  it('remembers nothing when the model says there was nothing', () => {
    expect(parseSummary('NOTHING')).toBe('');
    expect(parseSummary('  nothing  ')).toBe('');
  });

  it('remembers nothing rather than storing a fragment', () => {
    expect(parseSummary('')).toBe('');
    expect(parseSummary('ok')).toBe('');
  });
});

describe('summariseSession', () => {
  it('summarises a real session', async () => {
    const { client, bodies } = fakeClient('They planned the database migration.');
    const text = await summariseSession({ client, model: 'm', messages: exchange(6) });

    expect(text).toBe('They planned the database migration.');
    // Not streamed: nobody is waiting for it, and there is nothing to show while it arrives.
    expect(bodies[0]?.['stream']).toBe(false);
  });

  it('does not call the model for a session too short to have been about anything', async () => {
    const { client, bodies } = fakeClient('should not happen');
    const text = await summariseSession({ client, model: 'm', messages: exchange(MIN_MESSAGES - 1) });

    expect(text).toBe('');
    expect(bodies).toHaveLength(0);
  });

  it('remembers nothing when the provider is unreachable, and does not throw', async () => {
    const { client } = fakeClient(() => {
      throw new Error('fetch failed');
    });
    await expect(summariseSession({ client, model: 'm', messages: exchange(6) })).resolves.toBe('');
  });

  it('gives up rather than holding a quit open forever', async () => {
    const client = {
      chat: { completions: { create: () => new Promise(() => {}) } },
    } as unknown as OpenAI;

    const start = Date.now();
    const text = await summariseSession({ client, model: 'm', messages: exchange(6), timeoutMs: 30 });
    expect(text).toBe('');
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
