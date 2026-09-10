/**
 * The session-summary prompt (NAV-93).
 *
 * Prompt text lives in `src/prompt` and nowhere else (NAV-85), including the text of the small
 * side-calls. This one runs when a conversation ends, so its cost is paid once per session
 * rather than once per turn — which is what makes it affordable to ask a local 3B model for
 * something as open-ended as a summary.
 *
 * Written to be dull. A summary that reads as a story is a summary that has invented the parts
 * that were not there, and this text goes on to become something Navi believes about the user.
 */

export const SUMMARY_SYSTEM = `You are summarising a conversation so it can be remembered later.

Write one or two plain sentences describing what was actually discussed and anything that was
decided. Use the past tense. Name the specific things — files, projects, tools, people — because
those are what make it findable later.

Do not invent anything that is not in the transcript. Do not add feelings, praise, or a closing
remark. If nothing of substance was discussed, reply with exactly: NOTHING

Reply with the summary only. No preamble, no quotes, no labels.`;

/** How much of the exchange the summariser is shown. The tail is the part worth remembering. */
export const SUMMARY_WINDOW = 12;

export function summaryUser(transcript: readonly string[]): string {
  return `Transcript:\n\n${transcript.join('\n')}`;
}

/** The sentinel the prompt asks for when there was nothing worth keeping. */
export const NOTHING = 'NOTHING';
