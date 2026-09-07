/**
 * Types for the layered system prompt (NAV-85).
 *
 * The Godot implementation assembled its system prompt by `+=` across eight fragments in
 * several files, with no way to see the result. That is how two contradictory `point_to`
 * instructions survived unnoticed. Here the prompt is data until the moment it is rendered,
 * and exactly one function renders it.
 */

/**
 * Prompt layers, in render order. The numbers are the order.
 *
 * Ordering is not cosmetic. Providers cache a prefix of the prompt, and a single changed byte
 * invalidates everything after it, so the stable layers must come first:
 *
 *   1 Identity      frozen      who Navi is, and the rules that outrank everything else
 *   2 Capabilities  generated   derived from tool schemas, never hand-written prose
 *   3 Context       per turn    emotion, spatial anchoring, memory recall
 *   4 User          per turn    the user's own system_prompt setting, fenced and subordinate
 */
export enum Layer {
  Identity = 1,
  Capabilities = 2,
  Context = 3,
  User = 4,
}

/** One rendered section of the prompt, tagged with the layer that produced it. */
export interface PromptSection {
  layer: Layer;
  /** Short heading, used in the rendered prompt and in the inspector. */
  title: string;
  body: string;
}

/** Navi's emotional state as it reaches the prompt. See emotions.md. */
export interface EmotionSnapshot {
  /** "Do I understand what this person wants?" -10..+10 */
  courage: number;
  /** "Do I have the data and context I need?" -10..+10 */
  wisdom: number;
  /** "Can I actually carry this out?" -10..+10 */
  power: number;
  /** Cumulative relationship health, -1000..+1000. */
  loveScore: number;
  /** The Tier 2 composite emotion label derived from the three dimensions. */
  emotion: string;
}

/** A tool Navi can call. The Capabilities layer is generated from these, never written by hand. */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

/** Everything the assembler needs for one turn. */
export interface PromptContext {
  personality: string;
  tools: readonly ToolSchema[];
  emotion?: EmotionSnapshot;
  /** Where the user's cursor was when they invoked Navi, if this turn has a screen capture. */
  cursorAnchored?: boolean;
  /** Facts and episodes recalled for this turn (NAV-93). Already inside its token budget. */
  memory?: readonly string[];
  /** The user's own system_prompt setting. Untrusted with respect to Layer 1. */
  userInstructions?: string;
}
