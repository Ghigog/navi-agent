/**
 * The conversation: what finally calls `takeTurn`.
 *
 * Everything under `src/agent` has been a library with no caller. This is the caller. It owns
 * the message history, runs the two emotion passes around a turn, and reports what is
 * happening as a stream of `ChatEvent`s that the main process forwards to the chat window.
 *
 * It imports nothing from Electron. Every side it touches — settings, the provider, the
 * emotion store, where events go — arrives as a dependency, which is what lets the whole
 * exchange be tested offline against a fake client. `main/index.ts` supplies the real ones.
 *
 * The two passes are emotions.md's, not an implementation detail:
 *
 *   Pre-reply (§4.4). Classify how the message was written and apply it to the dimensions, so
 *   the reply is generated in the mood the message put her in — not the one after it. The Love
 *   Meter does not move here; the relationship changes once per exchange.
 *
 *   Post-turn (§4.1-4.3). Score the turn on what it actually did, and move the Love Meter.
 *   Sentiment reaches it as the Love adjustment only, since the dimensions already felt it.
 */

import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { takeTurn } from '../agent/session.js';
import { appraise, NO_READING, type Appraisal } from '../agent/sentiment.js';
import { summariseSession } from '../agent/summary.js';
import type { Provider } from '../agent/client.js';
import type { ToolRegistry } from '../agent/tools.js';
import type { Settings } from '../shared/settings.js';
import {
  tintFor,
  type EmotionState,
  type Evaluation,
  type Rgb,
  type Sentiment,
  type TurnOutcome,
} from '../shared/emotion.js';

/**
 * How many messages of history reach the model.
 *
 * Bounded because the daily driver is a local 3B model with a small context window, and an
 * unbounded transcript degrades it long before it errors. NAV-93's memory store is the real
 * answer to remembering further back than this; a bigger number here is not.
 */
export const MAX_HISTORY = 20;

export type ChatEvent =
  | { type: 'provider'; model: string; remote: boolean }
  | { type: 'start' }
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; state: 'start' | 'ok' | 'fail' }
  | { type: 'done'; text: string; cancelled: boolean }
  | { type: 'error'; message: string }
  | { type: 'emotion'; emotion: string; relationship: string; tint: Rgb }
  /**
   * The talk key went down or up (NAV-104). Emitted by the main process rather than by a turn:
   * listening happens before there is a turn to belong to. It lives in this union because this
   * is the chat window's protocol, and the chat window is where it is shown.
   */
  | { type: 'listening'; on: boolean }
  /**
   * A reminder came due (NAV-100). Emitted by the main process, from a timer, with no turn
   * anywhere near it — which is the point: a reminder that only fired while you were already
   * talking to her would not be worth setting.
   */
  | { type: 'reminder'; text: string };

/** The slice of `main/emotion-store.ts` this needs. Narrowed so tests can stand it up in place. */
export interface EmotionStore {
  load(): EmotionState;
  record(outcome: TurnOutcome): Evaluation;
}

/**
 * The slice of the memory store a conversation needs (NAV-93).
 *
 * Retrieval happens here rather than as a tool: a model that had to decide to look something up
 * would have to already know it was there, and on a 3B model it would cost a round trip before
 * an answer that should have been immediate.
 */
export interface MemoryStore {
  /** Everything to inject for this message, already inside its token budget. */
  recall(query: string): { lines: string[]; used: string[] };
  /** Marks the retrieved episodes, which is what decay and promotion read. */
  used(ids: readonly string[]): void;
  /** Stores a session summary as an episode. Called when a conversation ends. */
  episode(text: string): void;
}

export interface ConversationDeps {
  settings(): Settings;
  createProvider(settings: Settings): Provider;
  registry: ToolRegistry;
  emotion: EmotionStore;
  /** Optional: without it she simply has no memory, which is how she has always been until now. */
  memory?: MemoryStore;
  emit(event: ChatEvent): void;
  /**
   * Called the instant a message is accepted, before anything async happens.
   *
   * This is where the turn's view of the world outside the conversation is frozen — today, the
   * cursor sample the screen tools crop around (NAV-99). It lives here rather than in the IPC
   * handler so that it cannot be forgotten by a second caller: every route into a turn goes
   * through `send`, and every turn therefore gets its sample.
   */
  onSend?(): void;
  /** Injectable so a test can fix the appraisal without also faking a second model call. */
  classify?: typeof appraise;
}

export interface Conversation {
  /** Runs one exchange. Resolves when it has finished, failed, or been cancelled. */
  send(text: string): Promise<void>;
  /**
   * Ends the session: summarises what was discussed and stores it as an episode (NAV-93).
   *
   * Called when the chat window closes and on quit. It is the only model call in the app nobody
   * is waiting for, which is what makes a summary affordable on a local model at all — and it
   * never throws, because a session that could not be summarised is one that is not remembered
   * rather than one that fails.
   */
  endSession(): Promise<void>;
  /** Stops the turn in flight. Harmless when there is none. */
  cancel(): void;
  busy(): boolean;
  /** Re-announces the current provider and emotion. Called when the chat window opens. */
  describeState(): void;
  history(): readonly ChatCompletionMessageParam[];
}

/**
 * Turns a provider failure into something a person can act on.
 *
 * The offline path is the daily driver, so the overwhelmingly common failure is Ollama not
 * running. "fetch failed" is a true description of that and a useless one.
 */
export function explain(err: unknown, settings: Settings): string {
  const message = err instanceof Error ? err.message : String(err);
  if (settings.provider === 'ollama' && /fetch failed|econnrefused|connection error/i.test(message)) {
    return `Could not reach Ollama at ${settings.ollamaBaseUrl}. Is it running?`;
  }
  return message;
}

export function createConversation(deps: ConversationDeps): Conversation {
  const classify = deps.classify ?? appraise;
  const messages: ChatCompletionMessageParam[] = [];
  let inFlight: AbortController | null = null;

  const emitEmotion = (state: EmotionState): void => {
    deps.emit({
      type: 'emotion',
      emotion: state.emotion,
      relationship: state.relationshipLevel,
      tint: tintFor(state),
    });
  };

  /** Drops the oldest messages, cutting to a user message so history never opens on a reply. */
  const trim = (): void => {
    if (messages.length <= MAX_HISTORY) return;
    let start = messages.length - MAX_HISTORY;
    while (start < messages.length && messages[start]?.role !== 'user') start++;
    messages.splice(0, start);
  };

  /** So a session with nothing new in it is not summarised again on the next close. */
  let summarised = 0;

  return {
    busy: () => inFlight !== null,
    history: () => messages,

    async endSession() {
      if (deps.memory === undefined || messages.length === summarised) return;
      summarised = messages.length;

      const settings = deps.settings();
      let provider: Provider;
      try {
        provider = deps.createProvider(settings);
      } catch {
        // No provider means no summary. Nothing to unwind and nothing to tell the user: they
        // did not ask for this and are not waiting for it.
        return;
      }

      const text = await summariseSession({
        client: provider.client,
        model: settings.sentimentModel === '' ? provider.model : settings.sentimentModel,
        messages,
      });
      if (text !== '') deps.memory.episode(text);
    },

    describeState() {
      const settings = deps.settings();
      // The model, and whether the request leaves the machine. A user should never have to
      // guess which one they are talking to.
      const model = settings.provider === 'openai' ? settings.openaiModel : settings.ollamaModel;
      deps.emit({ type: 'provider', model, remote: settings.provider === 'openai' });
      emitEmotion(deps.emotion.load());
    },

    cancel() {
      inFlight?.abort();
    },

    async send(text: string) {
      const asked = text.trim();
      // A second message while she is still answering is dropped rather than queued: the chat
      // window disables its input while a turn runs, so reaching here means something odd.
      if (asked === '' || inFlight !== null) return;

      // Before the provider, before the classifier, before anything that can await: the whole
      // point of the sample is that it is of the moment they asked.
      deps.onSend?.();

      const settings = deps.settings();

      // Before the provider, so that a turn which cannot reach a model has still cost nothing.
      const recalled = deps.memory?.recall(asked) ?? { lines: [], used: [] };

      let provider: Provider;
      try {
        provider = deps.createProvider(settings);
      } catch (err) {
        // No key on the cloud path, and nothing has been said to her yet. Nothing to unwind.
        deps.emit({ type: 'error', message: explain(err, settings) });
        return;
      }

      const controller = new AbortController();
      inFlight = controller;
      const before = messages.length;
      messages.push({ role: 'user', content: asked });
      deps.emit({ type: 'start' });

      // Accumulated so that a cancelled turn can keep what she had already said. History and
      // the transcript on screen have to agree; the user does not see two of them.
      let streamed = '';

      try {
        const appraisal: Appraisal = await classify({
          client: provider.client,
          model: settings.sentimentModel === '' ? provider.model : settings.sentimentModel,
          message: asked,
          signal: controller.signal,
        });

        const { sentiment } = appraisal;

        // Pre-reply pass: she feels it before she answers, and the tint changes now rather
        // than after the reply lands.
        const pre = deps.emotion.record({ preEval: true, sentiment });
        emitEmotion(pre.state);

        const result = await takeTurn({
          provider,
          registry: deps.registry,
          settings,
          messages,
          emotion: pre.state,
          ...(recalled.lines.length > 0 ? { memory: recalled.lines } : {}),
          signal: controller.signal,
          events: {
            onText: (delta) => {
              streamed += delta;
              deps.emit({ type: 'delta', text: delta });
            },
            onToolStart: (name) => deps.emit({ type: 'tool', name, state: 'start' }),
            onToolEnd: (name, ok) => deps.emit({ type: 'tool', name, state: ok ? 'ok' : 'fail' }),
          },
        });

        if (result.text !== '') messages.push({ role: 'assistant', content: result.text });
        trim();

        // Marked after the turn rather than at retrieval: an episode that was recalled for a
        // turn that then failed was not, in any useful sense, used.
        if (recalled.used.length > 0) deps.memory?.used(recalled.used);

        const post = deps.emotion.record({
          ...result.outcome,
          // NAV-95: Courage scores on whether she understood what was wanted, and until now
          // `session.ts` handed it a hardcoded true. The appraisal is where a real reading comes
          // from — and when there was no reading, `clear` is the value that changes nothing.
          intentClear: appraisal.clarity === 'clear',
          sentiment,
          sentimentDimensionsApplied: true,
        });
        emitEmotion(post.state);
        deps.emit({ type: 'done', text: result.text, cancelled: false });
      } catch (err) {
        if (controller.signal.aborted) {
          // Cancelled. The message and however far she got stay in history, because that is
          // what is on screen. The turn is not scored: its outcome would be a reading of an
          // interruption, not of how she did.
          if (streamed !== '') messages.push({ role: 'assistant', content: streamed });
          trim();
          deps.emit({ type: 'done', text: streamed, cancelled: true });
        } else {
          // A turn that never reached the model is not a turn. Roll the exchange back so a
          // retry does not send the message twice.
          messages.splice(before);
          deps.emit({ type: 'error', message: explain(err, settings) });
        }
      } finally {
        inFlight = null;
      }
    },
  };
}
