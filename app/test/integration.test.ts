/**
 * One exchange, end to end, over real HTTP.
 *
 * Everything else stubs the client, which means the OpenAI SDK, the SSE framing and the
 * classifier's round trip are never actually exercised — and those are exactly where a port
 * that typechecks still fails to work. This stands up an OpenAI-compatible server on
 * localhost, points the real `createProvider` at it, and runs a turn through it.
 *
 * It stays offline: the server is this process, on an ephemeral port.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createConversation, type ChatEvent } from '../src/main/conversation.js';
import { createProvider } from '../src/agent/client.js';
import { ToolRegistry } from '../src/agent/tools.js';
import { DEFAULTS, type Settings } from '../src/shared/settings.js';
import { evaluate, NEUTRAL, type EmotionState, type TurnOutcome } from '../src/shared/emotion.js';

interface Request {
  model: string;
  stream: boolean;
  messages: Array<{ role: string; content: string }>;
}

const requests: Request[] = [];
let server: Server;
let baseUrl = '';

/** The reply the streaming endpoint gives, as the deltas a model would actually send. */
const DELTAS = ['She', ' is', ' outside.'];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const parsed = JSON.parse(body) as Request;
      requests.push(parsed);

      if (parsed.stream !== true) {
        // The classification call. One word, no streaming.
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: 'kind' } }] }));
        return;
      }

      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const content of DELTAS) {
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('one exchange over HTTP', () => {
  it('classifies, prompts, streams the reply, and moves the relationship', async () => {
    const settings: Settings = { ...DEFAULTS, ollamaBaseUrl: baseUrl, ollamaModel: 'llama3.2:3b' };
    let state: EmotionState = { ...NEUTRAL };
    const events: ChatEvent[] = [];

    const conversation = createConversation({
      settings: () => settings,
      createProvider,
      registry: new ToolRegistry(),
      emotion: {
        load: () => state,
        record: (outcome: TurnOutcome) => {
          const result = evaluate(state, outcome);
          state = result.state;
          return result;
        },
      },
      emit: (event) => events.push(event),
    });

    await conversation.send('thank you, that helped a lot');

    // Two calls: the mood reading, then the turn itself.
    expect(requests).toHaveLength(2);
    expect(requests[0]?.stream).toBe(false);
    expect(requests[0]?.messages[0]?.content).toContain('You are a text classifier');
    expect(requests[1]?.stream).toBe(true);
    expect(requests[1]?.messages[0]?.content).toContain('You are Navi');

    // The reply reached the UI in pieces, in order, unmodified.
    expect(events.filter((e) => e.type === 'delta').map((e) => e.text)).toEqual(DELTAS);
    expect(events.at(-1)).toEqual({ type: 'done', text: 'She is outside.', cancelled: false });

    // And being thanked landed: +15, once.
    expect(state.loveScore).toBe(15);
    expect(conversation.history()).toEqual([
      { role: 'user', content: 'thank you, that helped a lot' },
      { role: 'assistant', content: 'She is outside.' },
    ]);
  });
});
