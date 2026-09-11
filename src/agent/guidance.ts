/**
 * The `guide_through` tool (NAV-106): step-by-step guidance, acted out rather than described.
 *
 * `main/guidance.ts` is the found ticket's caller — the sequencing controller built on `flyTo`.
 * This is where the sequence a model produces gets validated, bounded, and turned into screen
 * points before it ever reaches that controller.
 *
 * **Do not parse a step out of a reply.** The Godot build read steps out of the token stream as
 * it rendered it, which is exactly the class of thing NAV-84 deleted: two conventions, a partial
 * step reaching the screen before it was recognised, and any model that merely mentioned a step
 * number triggering one. Steps arrive here as one tool call's structured argument or they do not
 * arrive at all.
 */

import { normalisedToScreen, POINT_GRID } from '../shared/capture.js';
import type { Bounds, Point } from '../shared/geometry.js';
import type { Tool, ToolResult } from './tools.js';

/** A model that has decided to produce steps will produce forty; this is where that is capped. */
export const MAX_STEPS = 10;

export interface GuidanceStep {
  text: string;
  point: Point;
}

export interface GuideDeps {
  /** The display the sequence points on — the one the question was about, same rule as `point_to`. */
  displayAt(point: Point): Bounds;
  cursor(): Point;
  /** Runs the sequence. Never rejects: a walk-through that goes wrong costs the walk-through, not the turn. */
  guide(steps: readonly GuidanceStep[]): Promise<{ shown: number }>;
}

interface RawStep {
  text: string;
  x: number;
  y: number;
}

/** Null on anything that is not exactly a JSON array of `{text, x, y}` — no partial credit. */
function parseSteps(raw: unknown): RawStep[] | null {
  if (typeof raw !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const steps: RawStep[] = [];
  for (const item of parsed) {
    if (item === null || typeof item !== 'object') return null;
    const { text, x, y } = item as Record<string, unknown>;
    if (typeof text !== 'string' || text.trim() === '') return null;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    steps.push({ text: text.trim(), x, y });
  }
  return steps;
}

export function createGuidanceTool(deps: GuideDeps): Tool {
  return {
    schema: {
      name: 'guide_through',
      description:
        'Walk the user through a sequence of steps, flying to each one on screen and pointing at ' +
        'it in turn. Use it when they ask you to show them how to do something step by step — ' +
        '"walk me through", "show me how". Not for a single thing to point at; use point_to for ' +
        'that. Send the whole sequence in one call: the user advances each step themselves.',
      parameters: {
        type: 'object',
        properties: {
          steps: {
            type: 'string',
            description:
              'A JSON array of the steps, in order, each as {"text": string, "x": number, "y": number}. ' +
              `x and y are on the same 0-${POINT_GRID} grid point_to uses. Example: ` +
              '[{"text":"Open Settings","x":500,"y":50},{"text":"Click Advanced","x":300,"y":400}]. ' +
              `At most ${MAX_STEPS} steps — a longer sequence is truncated, so keep it to what matters.`,
          },
        },
        required: ['steps'],
      },
    },
    async run(args): Promise<ToolResult> {
      const parsed = parseSteps(args['steps']);
      if (parsed === null || parsed.length === 0) {
        return {
          content: 'No steps to guide through: `steps` must be a JSON array of {text, x, y}, and not empty.',
          isError: true,
        };
      }

      const truncated = parsed.length > MAX_STEPS;
      const bounded = truncated ? parsed.slice(0, MAX_STEPS) : parsed;

      const display = deps.displayAt(deps.cursor());
      const steps: GuidanceStep[] = bounded.map((s) => ({
        text: s.text,
        point: normalisedToScreen(s.x, s.y, display),
      }));

      const result = await deps.guide(steps);
      const notice = truncated
        ? ` The sequence had ${parsed.length} steps; only the first ${MAX_STEPS} were shown. Tell the user it was cut short.`
        : '';
      return { content: `Walked through ${result.shown} step${result.shown === 1 ? '' : 's'}.${notice}` };
    },
  };
}
