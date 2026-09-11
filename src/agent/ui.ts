/**
 * The UI tools (NAV-90). Seeing the accessibility tree, and acting on it.
 *
 * No Electron import, no `AXUIElement`, no native call of any kind — same shape as
 * `agent/screen.ts` and for the same reason: the decisions here (which op a request maps to,
 * what `Action` the gate is asked about, what the model is told when it is refused) run under
 * test without a helper process or a Mac. `main/helper.ts` supplies the real `UiPort`, spawning
 * and talking to the native helper; a test supplies one in a few lines.
 *
 * **The gate gets its inputs from the port, never from the model's arguments.** `act_on_ui`
 * resolves `app` and `secureField` itself — via `describeElement` for a handle-addressed action,
 * via `focusedElementSecure` for a coordinate/global one — before it ever builds an `Action` or
 * calls `gate.attempt`. That is the whole point of this ticket: `shared/policy.ts`'s gate has
 * been waiting since NAV-91 for an honest source of those two fields, and a tool that let the
 * model simply state them would not be one.
 */

import type { Action } from '../shared/policy.js';
import type { AppInfo, UiNode, UiRole } from '../shared/ui-protocol.js';
import type { Tool, ToolResult } from './tools.js';

/**
 * Reading and acting, reduced to what the tools need. `main/helper.ts` implements it over the
 * native helper's stdio protocol; a test implements it in a few lines, the same way
 * `agent/screen.ts`'s `ScreenPort` is tested.
 */
export interface UiPort {
  /** The focused window's pruned accessibility tree. What `observe_ui` returns. */
  focusedWindow(maxDepth: number): Promise<UiNode>;
  /**
   * Fresh, live attributes for a handle from an earlier `focusedWindow()` call — never cached,
   * because the gate's decision has to be about what the element *is now*, not what it was when
   * it was last observed.
   */
  describeElement(
    handle: string,
  ): Promise<{ app: AppInfo | null; secure: boolean; role: UiRole; title: string | null; enabled: boolean }>;
  /**
   * Whatever currently has keyboard focus, system-wide — regardless of whether focus landed there
   * via a handle-addressed click or a raw coordinate one. The only honest way to gate `type_text`
   * and `key`, which have no handle of their own to ask.
   */
  focusedElementSecure(): Promise<{ secure: boolean; app: AppInfo | null }>;
  clickElement(handle: string): Promise<void>;
  setValue(handle: string, text: string): Promise<void>;
  focusWindow(handle: string): Promise<void>;
  clickPoint(x: number, y: number): Promise<void>;
  typeText(text: string): Promise<void>;
  key(combo: string): Promise<void>;
  scroll(dx: number, dy: number): Promise<void>;
  appAtPoint(x: number, y: number): Promise<AppInfo | null>;
  frontmostApp(): Promise<AppInfo | null>;
}

/** The part of `main/gate.ts`'s `Gate` that `act_on_ui` needs — duck-typed so this file does not import `main/gate.js`. */
export interface UiGate {
  attempt(action: Action): Promise<{ proceed: boolean; decision: { reason: string } }>;
}

export interface UiToolsDeps {
  port: UiPort;
  gate: UiGate;
}

/** A pruned tree for a typical window; the ticket's own bar. Not exposed as a model parameter — `observe_ui` takes none, same shape as `look_at_screen`. */
const DEFAULT_TREE_DEPTH = 12;

const ELEMENT_GONE =
  'That element is no longer there — its window or application likely closed or changed. Use ' +
  'observe_ui again to see the screen as it is now, rather than reusing a handle from before.';

function describeUiError(err: unknown): ToolResult {
  if (err instanceof Error && 'code' in err && (err as { code: unknown }).code === 'element_gone') {
    return { content: ELEMENT_GONE, isError: true };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { content: `That did not work: ${message}`, isError: true };
}

export function createUiTools(deps: UiToolsDeps): Tool[] {
  const observeUi: Tool = {
    schema: {
      name: 'observe_ui',
      description:
        "Read the accessibility tree of the user's focused window: every button, link, text " +
        'field and label, with a stable handle for each. Try this before take_screenshot for ' +
        'most questions about what is on screen or what to click — it is faster, cheaper, and ' +
        'precise where screen coordinates are not. Use act_on_ui with a handle from here to click ' +
        'or type.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    async run(): Promise<ToolResult> {
      try {
        const root = await deps.port.focusedWindow(DEFAULT_TREE_DEPTH);
        return { content: `The focused window's accessibility tree, as JSON: ${JSON.stringify(root)}` };
      } catch (err) {
        return describeUiError(err);
      }
    },
  };

  const actOnUi: Tool = {
    schema: {
      name: 'act_on_ui',
      description:
        'Click, type, focus or scroll, addressed by an element handle from observe_ui where ' +
        'possible. Every action needs the user to say yes first, except reading — this always ' +
        'asks. "op" is one of click, type, focus, key, scroll. click/focus take "handle", or ' +
        '"x"/"y" for click when there is no handle. type takes "handle" and "text", or just ' +
        '"text" to type into whatever already has focus. key takes "combo" (e.g. "cmd+a", ' +
        '"return"). scroll takes "dx"/"dy".',
      parameters: {
        type: 'object',
        properties: {
          op: { type: 'string', description: 'One of: click, type, focus, key, scroll.' },
          handle: { type: 'string', description: 'An element handle from observe_ui.' },
          text: { type: 'string', description: 'For "type": the text to type.' },
          x: { type: 'number', description: 'For "click" with no handle: the screen x coordinate.' },
          y: { type: 'number', description: 'For "click" with no handle: the screen y coordinate.' },
          combo: { type: 'string', description: 'For "key": e.g. "cmd+a", "return", "escape".' },
          dx: { type: 'number', description: 'For "scroll": horizontal amount.' },
          dy: { type: 'number', description: 'For "scroll": vertical amount.' },
        },
        required: ['op'],
      },
    },
    async run(args): Promise<ToolResult> {
      const op = args['op'];
      if (typeof op !== 'string') return { content: '"op" must be one of click, type, focus, key, scroll.', isError: true };

      const handle = typeof args['handle'] === 'string' ? args['handle'] : undefined;
      const text = typeof args['text'] === 'string' ? args['text'] : undefined;
      const x = typeof args['x'] === 'number' ? args['x'] : undefined;
      const y = typeof args['y'] === 'number' ? args['y'] : undefined;
      const combo = typeof args['combo'] === 'string' ? args['combo'] : undefined;
      const dx = typeof args['dx'] === 'number' ? args['dx'] : undefined;
      const dy = typeof args['dy'] === 'number' ? args['dy'] : undefined;

      try {
        switch (op) {
          case 'click': {
            if (handle !== undefined) return runGated('click_element', deps, () => deps.port.describeElement(handle), () => deps.port.clickElement(handle), `Clicked ${handle}.`);
            if (x === undefined || y === undefined) return { content: 'click needs either "handle" or "x" and "y".', isError: true };
            return runGated(
              'click_element',
              deps,
              async () => ({ app: await deps.port.appAtPoint(x, y), secure: false }),
              () => deps.port.clickPoint(x, y),
              `Clicked (${x}, ${y}).`,
            );
          }
          case 'type': {
            if (text === undefined) return { content: 'type needs "text".', isError: true };
            if (handle !== undefined) {
              return runGated('type_text', deps, () => deps.port.describeElement(handle), () => deps.port.setValue(handle, text), `Typed into ${handle}.`);
            }
            return runGated('type_text', deps, () => deps.port.focusedElementSecure(), () => deps.port.typeText(text), 'Typed the text.');
          }
          case 'focus': {
            if (handle === undefined) return { content: 'focus needs "handle".', isError: true };
            return runGated('focus_window', deps, () => deps.port.describeElement(handle), () => deps.port.focusWindow(handle), `Focused ${handle}.`);
          }
          case 'key': {
            if (combo === undefined) return { content: 'key needs "combo".', isError: true };
            return runGated('press_key', deps, () => deps.port.focusedElementSecure(), () => deps.port.key(combo), `Pressed ${combo}.`);
          }
          case 'scroll': {
            if (dx === undefined || dy === undefined) return { content: 'scroll needs "dx" and "dy".', isError: true };
            return runGated(
              'scroll',
              deps,
              async () => ({ app: await deps.port.frontmostApp(), secure: false }),
              () => deps.port.scroll(dx, dy),
              'Scrolled.',
            );
          }
          default:
            return { content: `Unknown op "${op}". Use click, type, focus, key or scroll.`, isError: true };
        }
      } catch (err) {
        return describeUiError(err);
      }
    },
  };

  return [observeUi, actOnUi];
}

/**
 * The one path every write in this file goes through: describe the real target, build an honest
 * `Action` from what the port actually said, ask the gate, and only then — if `proceed` is
 * true — perform it. No branch of `act_on_ui` reaches a port's mutating method any other way.
 */
async function runGated(
  actionName: string,
  deps: UiToolsDeps,
  describe: () => Promise<{ app: AppInfo | null; secure: boolean }>,
  perform: () => Promise<void>,
  successMessage: string,
): Promise<ToolResult> {
  const described = await describe();
  const action: Action = {
    name: actionName,
    ...(described.app ? { app: described.app.bundleId } : {}),
    secureField: described.secure,
  };

  const { proceed, decision } = await deps.gate.attempt(action);
  if (!proceed) return { content: decision.reason, isError: true };

  await perform();
  return { content: successMessage };
}
