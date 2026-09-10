/**
 * Sentence streaming for speech (NAV-104).
 *
 * The bar these are written against: she should start speaking about when a person reading the
 * same text aloud would, and should not pronounce punctuation the model wrote for a screen.
 */

import { describe, expect, it } from 'vitest';
import { createSentenceStream, speakable } from '../src/shared/speech.js';

/** Feeds text through in one-character deltas, which is how it actually arrives. */
function stream(text: string): { spoken: string[]; tail: string | null } {
  const s = createSentenceStream();
  const spoken: string[] = [];
  for (const c of text) spoken.push(...s.push(c));
  return { spoken, tail: s.flush() };
}

describe('createSentenceStream', () => {
  it('releases a sentence as soon as it is finished, not when the reply is', () => {
    const s = createSentenceStream();
    expect(s.push('That is a ')).toEqual([]);
    expect(s.push('terminal. ')).toEqual(['That is a terminal.']);
    // The last one waits for `flush`: until the stream ends, a full stop at the end of the
    // buffer might be the middle of "3.5".
    expect(s.push('It says permission denied.')).toEqual([]);
    expect(s.flush()).toBe('It says permission denied.');
  });

  it('splits on every kind of ending, including a bare newline', () => {
    const { spoken, tail } = stream('Yes! Really?\nProbably…');
    expect(spoken).toEqual(['Yes!', 'Really?']);
    expect(tail).toBe('Probably…');
  });

  it('does not stop at a decimal point or an abbreviation', () => {
    expect(stream('It is 3.5 GB.').tail).toBe('It is 3.5 GB.');
    expect(stream('Ask Dr. Kim about it.').tail).toBe('Ask Dr. Kim about it.');
    expect(stream('Use a flag, e.g. --force, next time.').tail).toBe(
      'Use a flag, e.g. --force, next time.',
    );
  });

  it('keeps a closing quote with the sentence it closes', () => {
    const { spoken, tail } = stream('She said "no." Then she left.');
    expect(spoken).toEqual(['She said "no."']);
    expect(tail).toBe('Then she left.');
  });

  it('gives up the tail when the reply ends without punctuation', () => {
    const { spoken, tail } = stream('One sentence. and then a trailing thought');
    expect(spoken).toEqual(['One sentence.']);
    expect(tail).toBe('and then a trailing thought');
  });

  it('has nothing to flush when the reply ended on a spoken sentence and a space', () => {
    expect(stream('All done. ').tail).toBeNull();
  });

  it('drops what was buffered when a turn is cancelled', () => {
    const s = createSentenceStream();
    s.push('half a thought');
    s.clear();
    expect(s.flush()).toBeNull();
  });
});

describe('speakable', () => {
  it('unwraps emphasis rather than reading it out', () => {
    expect(speakable('That is **really** not `great`.')).toBe('That is really not great.');
  });

  it('drops a code block entirely', () => {
    expect(speakable('Try this:\n```\nrm -rf /\n```\nThat will do it.')).toBe(
      'Try this:\nThat will do it.',
    );
  });

  it('reads a link by its text', () => {
    expect(speakable('See [the docs](https://example.com/x?y=1).')).toBe('See the docs.');
  });

  it('strips list markers and headings', () => {
    expect(speakable('## Findings\n- one\n- two')).toBe('Findings\none\ntwo');
  });

  it('is empty for text that was nothing but markup', () => {
    expect(speakable('```\ncode\n```')).toBe('');
  });
});
