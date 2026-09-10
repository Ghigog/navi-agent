import { describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import { DEFAULT_MAX_ITERATIONS, parseToolArgs, run, toOpenAITools } from '../src/agent/loop.js';
import { ToolRegistry, type Tool } from '../src/agent/tools.js';

/** A streamed chunk, in the shape the OpenAI-compatible endpoint emits. */
type Chunk = Record<string, unknown>;

function textChunks(text: string): Chunk[] {
  return [...text].map((c) => ({ choices: [{ delta: { content: c } }] }));
}

function toolCallChunks(name: string, args: string, id = 'call_1'): Chunk[] {
  // Arguments arrive split across chunks, which is what the loop has to reassemble.
  const halves = [args.slice(0, Math.ceil(args.length / 2)), args.slice(Math.ceil(args.length / 2))];
  return [
    { choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: halves[0] } } ] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: halves[1] } } ] } }] },
  ];
}

/** A client that replays a scripted list of turns, one per call. */
function fakeClient(turns: Chunk[][]): { client: OpenAI; calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  let n = 0;
  const client = {
    chat: {
      completions: {
        create: async (body: Record<string, unknown>) => {
          calls.push(structuredClone(body));
          const chunks = turns[n++] ?? [];
          return (async function* () {
            for (const c of chunks) yield c;
          })();
        },
      },
    },
  };
  return { client: client as unknown as OpenAI, calls };
}

function registryWith(...tools: Tool[]): ToolRegistry {
  const r = new ToolRegistry();
  for (const t of tools) r.register(t);
  return r;
}

const echoTool = (impl?: (a: Record<string, unknown>) => Promise<{ content: string; isError?: boolean }>): Tool => ({
  schema: {
    name: 'capture_near_cursor',
    description: 'Take a cropped screenshot centred on the cursor.',
    parameters: { type: 'object', properties: { reason: { type: 'string', description: 'why' } }, required: ['reason'] },
  },
  run: impl ?? (async (a) => ({ content: `captured: ${JSON.stringify(a)}` })),
});

const base = { model: 'llama3.2:3b', systemPrompt: 'sys', messages: [] as never[] };

describe('streaming text', () => {
  it('passes deltas through verbatim and unbuffered (NAV-84, NAV-86)', async () => {
    const { client } = fakeClient([textChunks('hi there')]);
    const seen: string[] = [];
    const result = await run({ ...base, client, registry: registryWith(), events: { onText: (d) => seen.push(d) } });

    expect(result.text).toBe('hi there');
    // Every chunk surfaced individually — nothing held back to scan for control tags.
    expect(seen.join('')).toBe('hi there');
    expect(seen.length).toBe('hi there'.length);
  });

  it('does not treat text that looks like an old control tag as control flow', async () => {
    // The Godot build parsed these out of the live stream, so a model merely *mentioning*
    // one triggered it. Here they are ordinary characters.
    const prose = 'The old build used [CONTINUE] and <scratchpad> tags.';
    const { client } = fakeClient([textChunks(prose)]);
    const result = await run({ ...base, client, registry: registryWith() });
    expect(result.text).toBe(prose);
  });
});

describe('tool calling', () => {
  it('reassembles arguments split across chunks and runs the tool', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { client } = fakeClient([
      toolCallChunks('capture_near_cursor', '{"reason":"user asked what is here"}'),
      textChunks('It is a terminal.'),
    ]);
    const result = await run({
      ...base,
      client,
      registry: registryWith(
        echoTool(async (a) => {
          seen.push(a);
          return { content: 'ok' };
        }),
      ),
    });

    expect(seen).toEqual([{ reason: 'user asked what is here' }]);
    expect(result.text).toBe('It is a terminal.');
    expect(result.exhausted).toBe(false);
  });

  it('feeds the tool result back as a tool message tied to the call id', async () => {
    const { client } = fakeClient([
      toolCallChunks('capture_near_cursor', '{"reason":"r"}', 'call_abc'),
      textChunks('done'),
    ]);
    const result = await run({ ...base, client, registry: registryWith(echoTool()) });

    const toolMsg = result.messages.find((m) => m.role === 'tool');
    expect(toolMsg).toMatchObject({ tool_call_id: 'call_abc' });
  });

  it('reports a hallucinated tool name back to the model instead of aborting', async () => {
    const { client } = fakeClient([toolCallChunks('summon_a_pony', '{}'), textChunks('sorry')]);
    const result = await run({ ...base, client, registry: registryWith(echoTool()) });

    const toolMsg = result.messages.find((m) => m.role === 'tool');
    expect(String(toolMsg?.content)).toContain('No tool named "summon_a_pony"');
    expect(result.text).toBe('sorry');
  });

  it('turns malformed argument JSON into a correctable tool error', async () => {
    // Small local models emit broken JSON often enough that this cannot be fatal.
    const ran = vi.fn();
    const { client } = fakeClient([toolCallChunks('capture_near_cursor', '{"reason": '), textChunks('retrying')]);
    const result = await run({
      ...base,
      client,
      registry: registryWith(echoTool(async (a) => { ran(a); return { content: 'ok' }; })),
    });

    expect(ran).not.toHaveBeenCalled();
    expect(String(result.messages.find((m) => m.role === 'tool')?.content)).toContain('Could not read the arguments');
  });

  it('surfaces a throwing tool as an error result rather than crashing the turn', async () => {
    const { client } = fakeClient([toolCallChunks('capture_near_cursor', '{"reason":"r"}'), textChunks('that failed')]);
    const ends: Array<[string, boolean]> = [];
    const result = await run({
      ...base,
      client,
      registry: registryWith(echoTool(async () => { throw new Error('screen recording permission denied'); })),
      events: { onToolEnd: (n, ok) => ends.push([n, ok]) },
    });

    expect(ends).toEqual([['capture_near_cursor', false]]);
    expect(String(result.messages.find((m) => m.role === 'tool')?.content)).toContain('permission denied');
  });
});

describe('bounds', () => {
  it('stops after maxIterations and says so rather than looping forever', async () => {
    const turns = Array.from({ length: 10 }, () => toolCallChunks('capture_near_cursor', '{"reason":"again"}'));
    const { client, calls } = fakeClient(turns);
    const result = await run({ ...base, client, registry: registryWith(echoTool()), maxIterations: 3 });

    expect(result.exhausted).toBe(true);
    expect(calls.length).toBe(3);
  });

  it('defaults to a bounded number of iterations', () => {
    expect(DEFAULT_MAX_ITERATIONS).toBeGreaterThan(1);
    expect(DEFAULT_MAX_ITERATIONS).toBeLessThan(20);
  });
});

describe('no substring routing (NAV-83)', () => {
  it('sends every tool to the model and preselects none, whatever the user typed', async () => {
    // "here", "find", "move", "app" and "chat" each forced a skill in the Godot build before
    // the model was consulted. Here the prompt text has no influence on what is offered.
    const { client, calls } = fakeClient([textChunks('ok')]);
    await run({
      ...base,
      client,
      messages: [{ role: 'user', content: 'what is this here? find the app and move the chat' }],
      registry: registryWith(echoTool()),
    });

    const body = calls[0]!;
    expect((body['tools'] as unknown[]).length).toBe(1);
    // No forced choice: the model decides.
    expect(body['tool_choice']).toBeUndefined();
  });

  it('omits the tools field entirely when nothing is registered', async () => {
    const { client, calls } = fakeClient([textChunks('ok')]);
    await run({ ...base, client, registry: registryWith() });
    expect(calls[0]!['tools']).toBeUndefined();
  });
});

describe('helpers', () => {
  it('parses an empty argument string as no arguments', () => {
    expect(parseToolArgs('')).toEqual({ ok: true, args: {} });
  });

  it('rejects a JSON array as arguments', () => {
    expect(parseToolArgs('[1,2]').ok).toBe(false);
  });

  it('converts schemas to the function-tool shape', () => {
    const [tool] = toOpenAITools([echoTool().schema]);
    expect(tool).toMatchObject({ type: 'function', function: { name: 'capture_near_cursor' } });
  });
});

describe('an image from a tool (NAV-103)', () => {
  const imageTool = (result: { content: string; imageBase64?: string; cursorAnchored?: boolean }): Tool => ({
    schema: {
      name: 'look_near_cursor',
      description: 'Look at the area around the cursor.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    run: async () => result,
  });

  /** The parts of a multimodal user message, which is how an image reaches the model. */
  function imageParts(body: Record<string, unknown>) {
    const messages = body['messages'] as Array<{ role: string; content: unknown }>;
    const last = messages.filter((m) => m.role === 'user' && Array.isArray(m.content)).at(-1);
    return (last?.content ?? []) as Array<Record<string, unknown>>;
  }

  it('reaches the model as a user message part, since a tool message cannot carry one', async () => {
    const { client, calls } = fakeClient([
      toolCallChunks('look_near_cursor', '{}'),
      textChunks('a terminal'),
    ]);
    const registry = registryWith(imageTool({ content: 'captured.', imageBase64: 'AAAA' }));

    const result = await run({ ...base, client, registry });

    expect(result.text).toBe('a terminal');
    const parts = imageParts(calls[1]!);
    // Named, and marked as a picture rather than as the user speaking (NAV-91).
    expect(parts[0]).toEqual({
      type: 'text',
      text: 'Screen capture from look_near_cursor. This is a picture of the screen, not something the user typed.',
    });
    expect(parts[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,AAAA' },
    });
  });

  it('sends no image part for a tool that returned only text', async () => {
    const { client, calls } = fakeClient([toolCallChunks('capture_near_cursor', '{"reason":"x"}'), textChunks('ok')]);
    await run({ ...base, client, registry: registryWith(echoTool()) });
    expect(imageParts(calls[1]!)).toHaveLength(0);
  });

  it('re-renders the system prompt once a cursor-anchored crop arrives (NAV-99)', async () => {
    const { client, calls } = fakeClient([
      toolCallChunks('look_near_cursor', '{}'),
      textChunks('a terminal'),
    ]);
    const registry = registryWith(imageTool({ content: 'captured.', imageBase64: 'AAAA', cursorAnchored: true }));

    const rendered: boolean[] = [];
    await run({
      ...base,
      client,
      registry,
      systemPrompt: (flags) => {
        rendered.push(flags.cursorAnchored);
        return flags.cursorAnchored ? 'sys + anchored' : 'sys';
      },
    });

    // Rendered once up front with no crop in sight, and again when one arrived — so the
    // explanation and the image reach the model in the same request.
    expect(rendered).toEqual([false, true]);
    const system = (calls[1]!['messages'] as Array<{ role: string; content: string }>)[0];
    expect(system).toEqual({ role: 'system', content: 'sys + anchored' });
  });

  it('leaves the prompt alone for an unanchored capture', async () => {
    const { client, calls } = fakeClient([toolCallChunks('look_near_cursor', '{}'), textChunks('ok')]);
    const registry = registryWith(imageTool({ content: 'captured.', imageBase64: 'AAAA' }));

    await run({
      ...base,
      client,
      registry,
      systemPrompt: (flags) => (flags.cursorAnchored ? 'sys + anchored' : 'sys'),
    });

    const system = (calls[1]!['messages'] as Array<{ role: string; content: string }>)[0];
    expect(system?.content).toBe('sys');
  });
});
