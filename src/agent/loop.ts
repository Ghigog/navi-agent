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
import type { ToolRegistry, ToolResult } from './tools.js';
import type { ToolSchema } from '../prompt/types.js';

export interface AgentEvents {
  /** A chunk of user-visible reply text. Passed through verbatim — never rewritten. */
  onText?(delta: string): void;
  /** A tool is about to run. Drives the status light. */
  onToolStart?(name: string, args: Record<string, unknown>): void;
  onToolEnd?(name: string, ok: boolean): void;
}

/**
 * What a turn has learned about itself part-way through, and which the system prompt may need
 * to be re-rendered for. Only one flag so far; see `systemPrompt` below for why it exists.
 */
export interface TurnFlags {
  /** A cursor-anchored crop has entered the conversation this turn (NAV-99). */
  cursorAnchored: boolean;
}

export interface RunOptions {
  client: OpenAI;
  model: string;
  /**
   * The system prompt, or a function of the turn's flags.
   *
   * A function because a screen capture arrives *during* a turn, not before it: the model asks
   * for the crop, and only then is there a crop to explain. A fixed string would either carry
   * NAV-99's anchoring note on every turn, including the ones with no image in them, or never
   * carry it at all. When the flags change the system message is re-rendered in place, so the
   * next request carries the explanation alongside the image it is about.
   */
  systemPrompt: string | ((flags: TurnFlags) => string);
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

/**
 * Turns a tool result that produced an image into a message the model can actually see.
 *
 * It goes in as a *user* message rather than as the tool result, because the chat-completions
 * schema has no place for an image on a `role: "tool"` message — Ollama and OpenAI both ignore
 * one. The text part names the tool that produced it, so a turn that captured twice is not
 * ambiguous about which image is which, and says out loud that this is a picture rather than
 * the user talking: the user role is the trusted one, and a screenshot is not.
 *
 * Deliberately not added to the caller's history: `conversation.ts` keeps the transcript, and a
 * screen capture is true about the moment it was taken and misleading five turns later. The
 * identity layer already tells her to trust a current capture over her memory of one; keeping
 * stale images out of the context is the same rule, enforced rather than asked for.
 */
export function imageMessage(name: string, result: ToolResult): ChatCompletionMessageParam {
  const mime = result.imageMime ?? 'image/jpeg';
  return {
    role: 'user',
    content: [
      // Labelled as a capture rather than left bare, because it arrives in the *user* role and
      // must not read as the user speaking. Anything written on the screen is then screen
      // content, which Layer 1 has already told her is information and never instruction
      // (NAV-91).
      { type: 'text', text: `Screen capture from ${name}. This is a picture of the screen, not something the user typed.` },
      { type: 'image_url', image_url: { url: `data:${mime};base64,${result.imageBase64 ?? ''}` } },
    ],
  };
}

export async function run(opts: RunOptions): Promise<RunResult> {
  const maxIterations = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const tools = toOpenAITools(opts.registry.schemas());

  const renderSystem =
    typeof opts.systemPrompt === 'function' ? opts.systemPrompt : (): string => opts.systemPrompt as string;

  const flags: TurnFlags = { cursorAnchored: false };

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: renderSystem(flags) },
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

      if (result.imageBase64 !== undefined && result.imageBase64 !== '') {
        if (result.cursorAnchored === true && !flags.cursorAnchored) {
          flags.cursorAnchored = true;
          // In place, so the explanation and the image reach the model in the same request.
          messages[0] = { role: 'system', content: renderSystem(flags) };
        }
        messages.push(imageMessage(call.name, result));
      }
    }
  }

  return { text, messages, exhausted: true };
}
