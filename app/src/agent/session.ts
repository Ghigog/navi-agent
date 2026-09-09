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

/** The text of the user's own last message, for the parts of scoring that read the prompt. */
function lastUserText(messages: readonly ChatCompletionMessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    // A multimodal turn: the screen capture is not text and does not count towards word count.
    return m.content
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join(' ');
  }
  return '';
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

  const prompt = lastUserText(opts.messages);
  const promptWords = prompt.trim() === '' ? 0 : prompt.trim().split(/\s+/).length;
  const history = opts.messages
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
