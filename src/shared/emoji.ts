/**
 * Floating emoji notifications (emotions.md §9.2, originally NAV-64).
 *
 * Navi has no face. Her emotional state reaches the user through her body's colour and through
 * these, and the colour alone is a slow signal — a shift from serenity to boredom is a few
 * degrees of hue that nobody notices while reading. The emoji is the moment she visibly *feels*
 * something, which is most of what makes the emotion engine legible rather than internal.
 *
 * Spawned only when the Tier 2 emotion has **changed** from the previous turn. An emoji on every
 * turn is wallpaper; one on a change is a reaction.
 *
 * Pure, so the pools can be checked against the specification and the change rule tested without
 * a canvas.
 */

import type { Emotion } from './emotion.js';

/** Straight from emotions.md §9.2. If these drift from that table, the table is right. */
export const EMOJI_POOLS: Record<Emotion, readonly string[]> = {
  serenity: ['😌', '✨', '💫', '🌟'],
  happiness: ['😊', '🌟', '💛', '🎉'],
  boredom: ['😑', '💤', '🌀', '😶'],
  fear: ['😨', '😰', '🫨', '💙'],
  sadness: ['😢', '💙', '🌧️', '😔'],
  anger: ['😠', '🔥', '⚡', '😤'],
  pain: ['😣', '💔', '😖', '🫤'],
  oblivion: ['😶‍🌫️', '🕳️', '⬛', '😑'],
};

/** Grow, hold, shrink. The hold is emotions.md's one second; the rest is what reads as a pop. */
export const EMOJI_GROW_MS = 220;
export const EMOJI_HOLD_MS = 1000;
export const EMOJI_SHRINK_MS = 320;
export const EMOJI_TOTAL_MS = EMOJI_GROW_MS + EMOJI_HOLD_MS + EMOJI_SHRINK_MS;

/** How far above her body it floats, in CSS pixels. */
export const EMOJI_RISE = 40;

/**
 * The emoji to show for a transition, or null when there is nothing to show.
 *
 * `previous` is null on the very first reading of a session. That deliberately *does* spawn one:
 * she has just woken up and felt something, and the user watching her load should see it.
 */
export function emojiFor(
  previous: Emotion | null,
  next: Emotion,
  random: () => number = Math.random,
): string | null {
  if (previous === next) return null;
  const pool = EMOJI_POOLS[next];
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] ?? null;
}
