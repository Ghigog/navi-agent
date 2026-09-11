/**
 * The wire protocol NAV-90's native helper speaks (`helper/Sources/NaviHelperCore/Protocol.swift`
 * is the Swift side of this same file — keep the two in sync by hand; there is no shared schema
 * generator, and this project is small enough that one is not worth the indirection yet).
 *
 * Newline-delimited JSON over the helper's own stdin/stdout. No socket, so there is nothing for a
 * stray local process to connect to and nothing to authenticate — see `main/helper.ts`.
 *
 * `UiRole` is a closed, platform-neutral set the helper maps `AXUIElement` roles into. Nothing on
 * this side, or the Swift side, ever sees a raw `AXRole` string — Windows (UI Automation) and
 * Linux (AT-SPI) are wanted eventually (HANDOFF decision 5), and this is the seam that has to
 * still make sense when they arrive.
 */

export type UiRole =
  | 'button'
  | 'link'
  | 'checkbox'
  | 'radio'
  | 'menu'
  | 'menuItem'
  | 'tab'
  | 'text'
  | 'textField'
  | 'secureField'
  | 'image'
  | 'list'
  | 'row'
  | 'group'
  | 'window'
  | 'scrollArea'
  | 'slider'
  | 'other';

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AppInfo {
  /** OS-reported, always. `main/helper.ts`'s `UiPort` never accepts this as an input — only ever returns it. */
  bundleId: string;
  name: string;
}

export interface WindowInfo {
  /** An opaque handle, from the same registry as `UiNode.handle` — see the note there. */
  id: string;
  app: AppInfo;
  title: string;
  frame: Frame;
  focused: boolean;
}

export interface UiNode {
  /** Opaque, and bounded rather than permanent — see `ElementRegistry` on the Swift side. */
  handle: string;
  role: UiRole;
  title?: string | null;
  value?: string | null;
  frame: Frame;
  enabled: boolean;
  focused: boolean;
  /** True when the accessibility API reports this as `AXSecureTextField`. */
  secure: boolean;
  children: UiNode[];
}

export interface HelperRequest {
  id: number;
  op: string;
  params?: Record<string, unknown> | null;
}

export interface HelperResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string | null;
  code?: string | null;
}

/**
 * Thrown by every `UiPort` method on a helper-reported failure. `code` is what call sites branch
 * on — `"element_gone"` in particular, which is how `agent/ui.ts` tells the model to look at the
 * screen again rather than retrying a handle from a window that already closed.
 */
export class HelperOpError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'HelperOpError';
  }
}

export function encodeRequest(req: HelperRequest): string {
  return JSON.stringify(req);
}

/** Never throws: a line that fails to parse is reported to the caller as `null`, not an exception. */
export function parseResponseLine(line: string): HelperResponse | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj['id'] !== 'number' || typeof obj['ok'] !== 'boolean') return null;
    return obj as unknown as HelperResponse;
  } catch {
    return null;
  }
}
