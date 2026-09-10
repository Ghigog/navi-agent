/**
 * The tool registry.
 *
 * Tools are declared once, here, and reach the model as native tool-call schemas. Nothing
 * decides which tool to use by matching substrings against the user's prompt.
 *
 * NAV-83 is why that sentence is emphatic. The Godot build had ~150 hardcoded trigger
 * substrings in `PROMPT_SKILL_RULES` that picked a skill *before the model was consulted*.
 * Native tool calling was added later and the two routers competed, with the substring one
 * always winning: "here" forced a screenshot, and so did "find", "move", "chat" and "app".
 * Do not reintroduce it in any form, including as a "fast path" or a "hint".
 */

import type { ToolSchema } from '../prompt/types.js';

export interface ToolResult {
  /** Text handed back to the model as the tool result. */
  content: string;
  /** Present when the tool produced an image, e.g. a screen capture. */
  imageBase64?: string;
  /** MIME type of `imageBase64`. Defaults to image/jpeg, which is what the captures are. */
  imageMime?: string;
  /**
   * True when the image is the cursor-anchored crop (NAV-99).
   *
   * It reaches the prompt rather than staying here: the agent loop turns it into the
   * `cursorAnchored` flag, and Layer 3 then explains to the model what the crop is centred on.
   * Without that the model reads "this" as "near the fairy", which is the bug NAV-99 exists to
   * have fixed.
   */
  cursorAnchored?: boolean;
  isError?: boolean;
}

export interface Tool {
  schema: ToolSchema;
  run(args: Record<string, unknown>): Promise<ToolResult>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.schema.name, tool);
  }

  schemas(): ToolSchema[] {
    return [...this.tools.values()].map((t) => t.schema);
  }

  /**
   * Runs a tool the model asked for. An unknown name is reported back to the model as a tool
   * error rather than thrown: models do occasionally hallucinate a tool name, and the useful
   * response is to tell it so and let it correct itself, not to abort the turn.
   */
  async run(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { content: `No tool named "${name}" exists. Available: ${[...this.tools.keys()].join(', ')}`, isError: true };
    }
    try {
      return await tool.run(args);
    } catch (err) {
      return { content: `Tool "${name}" failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  }
}
