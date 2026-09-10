/**
 * Floating emoji notifications (emotions.md §9.2).
 *
 * Navi has no face. Her state reaches the user through her colour and through these, and colour
 * alone is a few degrees of hue nobody notices while reading — so this is most of what makes
 * the emotion engine legible rather than internal.
 */

import { describe, expect, it } from 'vitest';
import { EMOJI_HOLD_MS, EMOJI_POOLS, EMOJI_TOTAL_MS, emojiFor } from '../src/shared/emoji.js';
import { deriveEmotion } from '../src/shared/emotion.js';

describe('the pools', () => {
  it('carries one for every emotion the engine can derive', () => {
    // Derived rather than listed, so an emotion added to the engine fails here rather than
    // silently having no emoji.
    for (const c of [-10, 10]) {
      for (const w of [-10, 10]) {
        for (const p of [-10, 10]) {
          const emotion = deriveEmotion(c, w, p);
          expect(EMOJI_POOLS[emotion], emotion).toBeDefined();
          expect(EMOJI_POOLS[emotion].length, emotion).toBeGreaterThan(0);
        }
      }
    }
  });

  it('matches the table in emotions.md §9.2', () => {
    expect(EMOJI_POOLS.serenity).toEqual(['😌', '✨', '💫', '🌟']);
    expect(EMOJI_POOLS.anger).toEqual(['😠', '🔥', '⚡', '😤']);
    expect(EMOJI_POOLS.oblivion).toEqual(['😶‍🌫️', '🕳️', '⬛', '😑']);
  });

  it('holds for the second the spec asks for', () => {
    expect(EMOJI_HOLD_MS).toBe(1000);
    expect(EMOJI_TOTAL_MS).toBeGreaterThan(EMOJI_HOLD_MS);
  });
});

describe('emojiFor', () => {
  it('shows nothing when the emotion has not changed', () => {
    // An emoji on every turn is wallpaper; one on a change is a reaction.
    expect(emojiFor('serenity', 'serenity')).toBeNull();
  });

  it('shows one from the new emotion’s pool on a change', () => {
    const char = emojiFor('serenity', 'anger', () => 0);
    expect(char).toBe(EMOJI_POOLS.anger[0]);
  });

  it('picks across the whole pool', () => {
    const picks = new Set([0, 0.3, 0.6, 0.99].map((r) => emojiFor('serenity', 'sadness', () => r)));
    expect(picks.size).toBe(EMOJI_POOLS.sadness.length);
  });

  it('never runs off the end of a pool on a random of exactly 1', () => {
    expect(emojiFor('serenity', 'pain', () => 1)).toBe(EMOJI_POOLS.pain.at(-1));
  });

  it('shows one on the first reading of a session', () => {
    // She has just woken up and felt something. A user watching her load should see it.
    expect(emojiFor(null, 'boredom')).not.toBeNull();
  });
});
