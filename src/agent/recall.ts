/**
 * The memory tools (NAV-93).
 *
 * `mission_statement.md` tells Navi to ask the user to help her remember what matters. These
 * are what makes that request mean something: when they answer, she can write it down.
 *
 * Writing only. Retrieval is not a tool — it happens before the turn, in `conversation.ts`, and
 * reaches the model through prompt Layer 3. A model that had to *decide* to look something up
 * would have to already know it was there, which is the wrong way round, and on a 3B model it
 * would be one more round trip before an answer that should have been immediate.
 */

import type { Tool, ToolResult } from './tools.js';

export interface MemoryWriter {
  /** Stores a durable fact. Returns what it stored, after normalising. */
  remember(text: string): string;
  /** Notes something the user liked or pushed back on. */
  prefer(text: string, liked: boolean): void;
}

/** A fact longer than this is a paragraph, and the fact sheet is a budget (NAV-93). */
export const MAX_FACT_CHARS = 200;

export function createMemoryTools(writer: MemoryWriter): Tool[] {
  const remember: Tool = {
    schema: {
      name: 'remember',
      description:
        'Write something down about the user so you still know it next time. Use it when they ' +
        'tell you to remember something, and when they say something durable about themselves — ' +
        'what they work on, what they use, who they work with, how they like things done. Do not ' +
        'use it for what is happening right now, or for anything they have not actually said.',
      parameters: {
        type: 'object',
        properties: {
          fact: {
            type: 'string',
            description:
              'One short sentence, in the third person, e.g. "They work on a desktop app called ' +
              'Navi." Specific enough to be useful a month from now.',
          },
        },
        required: ['fact'],
      },
    },
    async run(args): Promise<ToolResult> {
      const fact = typeof args['fact'] === 'string' ? args['fact'].trim() : '';
      if (fact === '') return { content: 'Nothing to remember: `fact` was empty.', isError: true };
      if (fact.length > MAX_FACT_CHARS) {
        return {
          content: `That is too long to keep (${fact.length} characters, limit ${MAX_FACT_CHARS}). Write one short sentence.`,
          isError: true,
        };
      }

      const stored = writer.remember(fact);
      return { content: `Remembered: ${stored}` };
    },
  };

  const notePreference: Tool = {
    schema: {
      name: 'note_preference',
      description:
        'Note that the user liked or disliked how you did something. Use it when they tell you ' +
        'plainly — "that was perfect", "stop doing that" — not when you are guessing from tone.',
      parameters: {
        type: 'object',
        properties: {
          about: {
            type: 'string',
            description: 'What it was about, in a few words, e.g. "short answers with no preamble".',
          },
          liked: { type: 'boolean', description: 'True if they liked it, false if they did not.' },
        },
        required: ['about', 'liked'],
      },
    },
    async run(args): Promise<ToolResult> {
      const about = typeof args['about'] === 'string' ? args['about'].trim() : '';
      if (about === '') return { content: 'Nothing to note: `about` was empty.', isError: true };

      // A model that sends "false" as a string is a model, not a bug worth failing a turn over.
      const liked = args['liked'] === true || args['liked'] === 'true';
      writer.prefer(about, liked);
      return { content: `Noted that they ${liked ? 'liked' : 'did not like'}: ${about}` };
    },
  };

  return [remember, notePreference];
}
