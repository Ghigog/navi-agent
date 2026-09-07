/**
 * The agent loop.
 *
 * One loop, written once against the OpenAI-compatible chat endpoint that Ollama already
 * serves, so the local path and any hosted provider run identical code (ADR 0001). Ollama is
 * the daily driver and this must keep working with no cloud account and no network beyond
 * localhost.
 *
 * Two constraints from the ADR are structural here, not stylistic:
 *
 *   NAV-83  Nothing inspects the user's text to decide what to do. The model chooses tools
 *           through native tool calls, or it does not use tools.
 *
 *   NAV-84  There are no in-band control tags. The Godot build parsed `<scratchpad>`,
 *           `[CONTINUE]`, `[PAUSE]` and `[SKILL: point_to: X,Y]` out of the same token stream
 *           it was rendering to the user, which meant a partial tag could be displayed before
 *           it was recognised, and any model that mentioned a tag name in prose triggered it.
 *           Control flow travels as tool calls. Text is only ever text.
 */

import type OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import type { ToolRegistry } from './tools.js';
import type { ToolSchema } from '../prompt/types.js';

export interface AgentEvents {
  /** A chunk of user-visible reply text. Passed through verbatim — never rewritten. */
  onText?(delta: string): void;
  /** A tool is about to run. Drives the status light. */
  onToolStart?(name: string, args: Record<string, unknown>): void;
  onToolEnd?(name: string, ok: boolean): void;
}

export interface RunOptions {
  client: OpenAI;
  model: string;
  systemPrompt: string;
  messages: ChatCompletionMessageParam[];
  registry: ToolRegistry;
  events?: AgentEvents;
  /**
   * Ceiling on tool round-trips in a single turn. A local 3B model that has decided to call a
   * tool will sometimes call it again forever; this bounds that without pretending it is
   * success. Reaching it is reported to the user, not swallowed.
   */
  maxIterations?: number;
  signal?: AbortSignal;
}

export interface RunResult {
  text: string;
  messages: ChatCompletionMessageParam[];
  /** True when the loop stopped because it hit maxIterations rather than because it finished. */
  exhausted: boolean;
}

export const DEFAULT_MAX_ITERATIONS = 6;

export function toOpenAITools(schemas: readonly ToolSchema[]): ChatCompletionTool[] {
  return schemas.map((s) => ({
    type: 'function',
    function: { name: s.name, description: s.description, parameters: s.parameters },
  }));
}

/**
 * Parses a tool call's arguments.
 *
 * Small local models emit malformed JSON often enough that this cannot throw. A parse failure
 * becomes a tool error the model can see and correct, which is the difference between a
 * recoverable turn and a dead one.
 */
export function parseToolArgs(raw: string): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  if (raw.trim() === '') return { ok: true, args: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'arguments must be a JSON object' };
    }
    return { ok: true, args: parsed as Record<string, unknown> };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'invalid JSON' };
  }
}

export async function run(opts: RunOptions): Promise<RunResult> {
  const maxIterations = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const tools = toOpenAITools(opts.registry.schemas());

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: opts.systemPrompt },
    ...opts.messages,
  ];

  let text = '';

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const stream = await opts.client.chat.completions.create(
      {
        model: opts.model,
        messages,
        stream: true,
        ...(tools.length > 0 ? { tools } : {}),
      },
      opts.signal ? { signal: opts.signal } : {},
    );

    let content = '';
    const calls = new Map<number, { id: string; name: string; args: string }>();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        content += delta.content;
        // Straight through to the UI. No tag stripping, no personality rewriting, no
        // buffering to look for control sequences (NAV-84, NAV-86).
        opts.events?.onText?.(delta.content);
      }

      for (const tc of delta.tool_calls ?? []) {
        const existing = calls.get(tc.index) ?? { id: '', name: '', args: '' };
        calls.set(tc.index, {
          id: tc.id ?? existing.id,
          name: tc.function?.name ?? existing.name,
          // Arguments arrive as a stream of JSON fragments and must be concatenated in order.
          args: existing.args + (tc.function?.arguments ?? ''),
        });
      }
    }

    text += content;

    if (calls.size === 0) {
      return { text, messages, exhausted: false };
    }

    const ordered = [...calls.entries()].sort(([a], [b]) => a - b).map(([, v]) => v);

    messages.push({
      role: 'assistant',
      content: content === '' ? null : content,
      tool_calls: ordered.map((c) => ({
        id: c.id,
        type: 'function' as const,
        function: { name: c.name, arguments: c.args },
      })),
    });

    for (const call of ordered) {
      const parsed = parseToolArgs(call.args);
      if (!parsed.ok) {
        opts.events?.onToolEnd?.(call.name, false);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: `Could not read the arguments for "${call.name}": ${parsed.error}. Send them as a JSON object.`,
        });
        continue;
      }

      opts.events?.onToolStart?.(call.name, parsed.args);
      const result = await opts.registry.run(call.name, parsed.args);
      opts.events?.onToolEnd?.(call.name, result.isError !== true);

      messages.push({ role: 'tool', tool_call_id: call.id, content: result.content });
    }
  }

  return { text, messages, exhausted: true };
}
