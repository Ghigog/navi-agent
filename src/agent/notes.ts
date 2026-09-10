/**
 * The note and reminder tools (NAV-100).
 *
 * Three tools over one store. The interesting one is `set_reminder`, and what makes it work is
 * that the time is resolved **here**, at write time, rather than stored as words and worked out
 * later. Asking a 3B local model to do date arithmetic against a clock at the moment a reminder
 * is due — with nobody watching — is how a reminder quietly fails. Resolving now means the
 * model's only job is to pass on the words the user said, and a misreading is visible
 * immediately, because Navi says the time back.
 *
 * These are read/write-own-data tools. Writing to her own store is not acting on the user's
 * machine, so they are outside NAV-91's computer-use confirmation flow by design.
 */

import { describeWhen, resolveWhen } from '../shared/when.js';
import type { Note } from '../shared/notes.js';
import type { Tool, ToolResult } from './tools.js';

export interface NoteWriter {
  save(text: string, tags: readonly string[]): Note;
  remind(text: string, due: number): Note;
  search(query: string): Note[];
  upcoming(): Note[];
}

/** A note longer than this is a document. She is not a document store. */
export const MAX_NOTE_CHARS = 1000;

function line(note: Note, now: number): string {
  const when = note.due === undefined ? new Date(note.at).toISOString().slice(0, 10) : describeWhen(note.due, now);
  const kind = note.due === undefined ? '' : note.firedAt === undefined ? 'reminder, ' : 'reminder, done, ';
  return `- (${kind}${when}) ${note.text}`;
}

export function createNoteTools(writer: NoteWriter, now: () => number = Date.now): Tool[] {
  const saveNote: Tool = {
    schema: {
      name: 'save_note',
      description:
        'Write something down for the user to find later. Use it when they say "note that", ' +
        '"write this down", "remember for me" — anything they want kept in their own words ' +
        'rather than something you inferred about them.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The note, in the user\'s own words as far as possible.' },
          tags: { type: 'string', description: 'Optional comma-separated labels to find it by later.' },
        },
        required: ['text'],
      },
    },
    async run(args): Promise<ToolResult> {
      const text = typeof args['text'] === 'string' ? args['text'].trim() : '';
      if (text === '') return { content: 'Nothing to save: `text` was empty.', isError: true };
      if (text.length > MAX_NOTE_CHARS) {
        return { content: `That is too long to save as a note (limit ${MAX_NOTE_CHARS} characters).`, isError: true };
      }

      const tags = typeof args['tags'] === 'string' ? args['tags'].split(',') : [];
      const note = writer.save(text, tags);
      return { content: `Saved: ${note.text}` };
    },
  };

  const setReminder: Tool = {
    schema: {
      name: 'set_reminder',
      description:
        'Remind the user about something at a particular time. Pass on the time exactly as they ' +
        'said it — "in 20 minutes", "tomorrow at 3pm", "friday" — and do not work out a date ' +
        'yourself. If they were vague, this will tell you so, and you should ask them when they ' +
        'actually mean rather than picking a time for them.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'What to remind them about.' },
          when: { type: 'string', description: 'When, in the user\'s own words. Not a date you calculated.' },
        },
        required: ['text', 'when'],
      },
    },
    async run(args): Promise<ToolResult> {
      const text = typeof args['text'] === 'string' ? args['text'].trim() : '';
      const whenText = typeof args['when'] === 'string' ? args['when'].trim() : '';
      if (text === '') return { content: 'Nothing to be reminded of: `text` was empty.', isError: true };

      const resolved = resolveWhen(whenText, now());
      if (!resolved.ok) {
        // A tool error rather than a silent default, so the model has to account for it. It is
        // written as an instruction to ask, because the alternative — picking a plausible time —
        // produces a reminder the user will not find out is wrong until it does not fire.
        return { content: `No reminder set: ${resolved.reason}.`, isError: true };
      }

      writer.remind(text, resolved.at);
      // Said back, always. Resolving at write time is only a safeguard if the user hears the
      // answer while they can still correct it.
      return { content: `Reminder set for ${describeWhen(resolved.at, now())}: ${text}. Tell them the time you have set.` };
    },
  };

  const listNotes: Tool = {
    schema: {
      name: 'list_notes',
      description:
        'Look through the notes and reminders the user has saved. Use it when they ask what they ' +
        'noted, what is coming up, or what they said about something. An empty query lists the ' +
        'most recent.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Words to search for. Leave empty to list the most recent.' },
        },
        required: [],
      },
    },
    async run(args): Promise<ToolResult> {
      const query = typeof args['query'] === 'string' ? args['query'] : '';
      const t = now();
      const found = writer.search(query);
      const ahead = writer.upcoming();

      if (found.length === 0 && ahead.length === 0) {
        return { content: 'They have not saved any notes or reminders yet.' };
      }

      const parts: string[] = [];
      if (found.length > 0) parts.push(['Notes:', ...found.map((n) => line(n, t))].join('\n'));
      if (ahead.length > 0) parts.push(['Coming up:', ...ahead.map((n) => line(n, t))].join('\n'));
      return { content: parts.join('\n\n') };
    },
  };

  return [saveNote, setReminder, listNotes];
}
