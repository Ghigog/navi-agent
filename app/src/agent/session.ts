/**
 * A conversation turn: assemble the prompt, record it for the inspector, run the loop.
 *
 * This is the only place prompt assembly and the agent loop meet. Prompt text does not appear
 * here — it lives in src/prompt (NAV-85). If you need Navi to be told something new, add it to
 * a layer there, not to this file.
 */

import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { assemble, sections } from '../prompt/builder.js';
import { record } from '../prompt/inspector.js';
import type { EmotionSnapshot } from '../prompt/types.js';
import { retrievalRelevance, type TurnOutcome } from '../shared/emotion.js';
import { run, type AgentEvents, type RunResult } from './loop.js';
import type { Provider } from './client.js';
import type { ToolRegistry } from './tools.js';
import type { Settings } from '../shared/settings.js';

export interface TurnOptions {
  provider: Provider;
  registry: ToolRegistry;
  settings: Settings;
  messages: ChatCompletionMessageParam[];
  emotion?: EmotionSnapshot;
  /** Set when this turn carries a cursor-anchored crop (NAV-99). */
  cursorAnchored?: boolean;
  memory?: readonly string[];
  events?: AgentEvents;
  signal?: AbortSignal;
}

export interface TurnResult extends RunResult {
  /**
   * What the emotion engine should score this turn on. Produced here because this is the only
   * place that sees both what was asked and what happened; consumed by the main process, which
   * owns the persisted state.
   */
  outcome: TurnOutcome;
}

/** Position of the user's own last message: the one this turn is answering. */
function lastUserIndex(messages: readonly ChatCompletionMessageParam[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return i;
  }
  return -1;
}

/** Its text, for the parts of scoring that read the prompt. */
function userText(message: ChatCompletionMessageParam | undefined): string {
  if (message === undefined || message.role !== 'user') return '';
  if (typeof message.content === 'string') return message.content;
  // A multimodal turn: the screen capture is not text and does not count towards word count.
  return message.content.map((part) => (part.type === 'text' ? part.text : '')).join(' ');
}

export async function takeTurn(opts: TurnOptions): Promise<TurnResult> {
  const ctx = {
    personality: opts.settings.personality,
    tools: opts.registry.schemas(),
    ...(opts.emotion ? { emotion: opts.emotion } : {}),
    ...(opts.cursorAnchored ? { cursorAnchored: true } : {}),
    ...(opts.memory ? { memory: opts.memory } : {}),
    ...(opts.settings.systemPrompt ? { userInstructions: opts.settings.systemPrompt } : {}),
  };

  const systemPrompt = assemble(ctx);
  // Recorded before the request, so a request that fails or hangs still leaves an inspectable
  // prompt behind. A prompt you can only see on success is no use when debugging a failure.
  record(systemPrompt, sections(ctx));

  let toolsRan = 0;
  let toolsFailed = 0;
  const events: AgentEvents = {
    ...opts.events,
    onToolEnd(name, ok) {
      toolsRan++;
      if (!ok) toolsFailed++;
      opts.events?.onToolEnd?.(name, ok);
    },
  };

  const result = await run({
    client: opts.provider.client,
    model: opts.provider.model,
    systemPrompt,
    messages: opts.messages,
    registry: opts.registry,
    events,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });

  const asked = lastUserIndex(opts.messages);
  const prompt = userText(opts.messages[asked]);
  const promptWords = prompt.trim() === '' ? 0 : prompt.trim().split(/\s+/).length;
  // What she had to work with *before* this message. The message is excluded from its own
  // context on purpose: leave it in and every prompt overlaps its context perfectly, which
  // scores full Wisdom on every turn including the first, when she in fact knew nothing.
  const history = opts.messages
    .filter((_, i) => i !== asked)
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .filter((c) => c !== '');
  const recalled = [...history, ...(opts.memory ?? [])];

  const outcome: TurnOutcome = {
    // Relevance gating, emotions.md §4.1: a dimension the turn did not exercise must not move.
    // Courage is only in play when the intent was genuinely work to read; Wisdom only when
    // there was something to recall from; Power only when a tool actually ran.
    courageRelevant: promptWords > 80,
    wisdomRelevant: recalled.length > 0,
    powerRelevant: toolsRan > 0,

    // No intent analyser exists on this stack yet, so a turn that completed is treated as
    // understood. NAV-95's model-driven appraisal is the seam that fills this in.
    intentClear: true,
    memoryEntries: recalled.length,
    promptWords,
    retrievalRelevance: retrievalRelevance(prompt, recalled),
    responseText: result.text,
    toolsAvailable: opts.registry.schemas().length > 0,
    toolSucceeded: toolsRan > 0 && toolsFailed === 0,
    // Hitting the iteration ceiling is a turn that did not finish, not a turn that went well.
    analysisFailed: result.exhausted,
  };

  return { ...result, outcome };
}
