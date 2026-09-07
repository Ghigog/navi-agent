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

export async function takeTurn(opts: TurnOptions): Promise<RunResult> {
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

  return run({
    client: opts.provider.client,
    model: opts.provider.model,
    systemPrompt,
    messages: opts.messages,
    registry: opts.registry,
    ...(opts.events ? { events: opts.events } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
}
