/**
 * The leave-by reminder (NAV-114): the thin slice of "unprompted presence" that needs no
 * judgement at all. Time to leave is `start - buffer - lead` — arithmetic, not an opinion — so
 * there is no model call anywhere in this path and nothing here can get the time wrong.
 *
 * Pure, like `calendar.ts` and `notes.ts`. `main/index.ts` is what keeps a leave-by note armed
 * for every commitment in the cache and reuses `main/reminders.ts` to fire it, rather than
 * building a second timer for what is, underneath, just another due time.
 */

import type { Emotion } from './emotion.js';
import { DEFAULT_BUFFER_MINUTES, leaveByTime, type CommitmentCache } from './calendar.js';
import type { Note, Notes } from './notes.js';

/** How long before the leave-by moment she actually says something. */
export const LEAD_MINUTES = 10;

/** Marks a note as this feature's, so `reconcileLeaveByNotes` never touches a user-written one. */
const PREFIX = 'lb-';

function leaveByNoteId(eventId: string): string {
  return `${PREFIX}${eventId}`;
}

/**
 * One line per emotion (`EMOTION_TONE`'s shape, not `EMOJI_POOLS`'s pool) — a leave-by moment is
 * rare enough per commitment that variety does not matter, and a single line keeps this
 * deterministic and easy to pin in a test.
 *
 * NAV-97's bound applies here too: mood may choose the words, never the time. `{title}` is the
 * only thing substituted in, straight from the calendar event, so nothing here can invent a fact.
 */
export const LEAVE_BY_TEMPLATES: Record<Emotion, string> = {
  serenity: "Time to head out for {title}.",
  happiness: "Ooh — almost time for {title}! Better get moving.",
  boredom: "Time to leave for {title}, if you're still going.",
  fear: "You should leave now for {title} — you don't want to be late.",
  sadness: "It's about time to go for {title}.",
  anger: 'Go. {title}. Now.',
  pain: 'Time to leave for {title}, whenever you can.',
  oblivion: 'Leave. {title}.',
};

/** The templated line for one commitment, in whatever mood she is in when she says it. */
export function leaveByMessage(emotion: Emotion, title: string): string {
  return LEAVE_BY_TEMPLATES[emotion].replace('{title}', title);
}

/**
 * Keeps the leave-by note store in step with the commitment cache.
 *
 * One armed note per commitment, added once and never again — "once per commitment, ever" is
 * the id itself being deterministic, so a resync that sees the same event twice is a no-op here.
 * A commitment that disappears before its note has fired (cancelled, declined after the fact,
 * aged out of the cache) has its note dropped too, so a cancelled meeting never gets a reminder.
 * A note that has already fired is left alone either way — it is the record that she said it.
 *
 * `text` holds the event's title, not the rendered line: the wording is chosen from the current
 * emotion when she actually says it (`leaveByMessage`), not frozen at the moment it was armed,
 * which could be hours or days earlier.
 */
export function reconcileLeaveByNotes(
  cache: CommitmentCache,
  store: Notes,
  now: number,
  defaultBufferMinutes: number = DEFAULT_BUFFER_MINUTES,
): Notes {
  const liveIds = new Set(cache.events.map((e) => e.id));
  const existingIds = new Set(store.notes.map((n) => n.id));

  const kept = store.notes.filter((n) => {
    if (!n.id.startsWith(PREFIX)) return true;
    if (n.firedAt !== undefined) return true;
    return liveIds.has(n.id.slice(PREFIX.length));
  });

  const additions: Note[] = [];
  for (const event of cache.events) {
    const id = leaveByNoteId(event.id);
    if (existingIds.has(id)) continue;
    additions.push({
      id,
      text: event.title,
      tags: ['leave-by'],
      at: now,
      due: leaveByTime(event, defaultBufferMinutes) - LEAD_MINUTES * 60_000,
    });
  }

  if (additions.length === 0 && kept.length === store.notes.length) return store;
  return { notes: [...kept, ...additions] };
}
