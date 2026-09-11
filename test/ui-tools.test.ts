/**
 * The UI tools (NAV-90).
 *
 * The test that matters most is not "does act_on_ui call the right port method" — it is "does it
 * ever reach a mutating port method without the gate's say-so, and is what it tells the gate
 * actually true". `shared/policy.ts`'s `Action.app`/`secureField` have been waiting since NAV-91
 * for an honest source; these tests are what make that honest rather than assumed.
 */

import { describe, expect, it, vi } from 'vitest';
import { createUiTools, type UiGate, type UiPort } from '../src/agent/ui.js';
import { createGate } from '../src/main/gate.js';
import { HelperOpError, type AppInfo, type UiNode } from '../src/shared/ui-protocol.js';

const BUTTON = 'button' as const;
const SECURE_FIELD = 'secureField' as const;

const APP: AppInfo = { bundleId: 'com.example.app', name: 'Example' };

const TREE: UiNode = {
  handle: 'el_1',
  role: 'window',
  title: 'Example Window',
  value: null,
  frame: { x: 0, y: 0, width: 800, height: 600 },
  enabled: true,
  focused: true,
  secure: false,
  children: [],
};

function fakePort(overrides: Partial<UiPort> = {}): UiPort {
  return {
    focusedWindow: vi.fn(async () => TREE),
    describeElement: vi.fn(async () => ({ app: APP, secure: false, role: BUTTON, title: 'Save', enabled: true })),
    focusedElementSecure: vi.fn(async () => ({ secure: false, app: APP })),
    clickElement: vi.fn(async () => undefined),
    setValue: vi.fn(async () => undefined),
    focusWindow: vi.fn(async () => undefined),
    clickPoint: vi.fn(async () => undefined),
    typeText: vi.fn(async () => undefined),
    key: vi.fn(async () => undefined),
    scroll: vi.fn(async () => undefined),
    appAtPoint: vi.fn(async () => APP),
    frontmostApp: vi.fn(async () => APP),
    ...overrides,
  };
}

/** Always says yes and always allows the one app under test — for tests about *what* the gate is asked, not whether it says yes. */
function permissiveGate(): { gate: UiGate; attempts: unknown[] } {
  const attempts: unknown[] = [];
  const gate: UiGate = {
    async attempt(action) {
      attempts.push(action);
      return { proceed: true, decision: { reason: 'ok' } };
    },
  };
  return { gate, attempts };
}

function refusingGate(reason: string): UiGate {
  return { async attempt() { return { proceed: false, decision: { reason } }; } };
}

/** The real gate and policy (NAV-91) — used where the point is "is this actually forbidden", not just "what was it asked". */
function realGate(allowedApp: string) {
  return createGate({
    allowedApps: () => [allowedApp],
    confirm: async () => true,
    now: () => 0,
  });
}

function byName(tools: ReturnType<typeof createUiTools>, name: string) {
  const tool = tools.find((t) => t.schema.name === name);
  if (!tool) throw new Error(`no tool named ${name}`);
  return tool;
}

describe('observe_ui', () => {
  it('returns the focused window tree as JSON', async () => {
    const port = fakePort();
    const { gate } = permissiveGate();
    const tools = createUiTools({ port, gate });

    const result = await byName(tools, 'observe_ui').run({});
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('"handle":"el_1"');
    expect(port.focusedWindow).toHaveBeenCalledOnce();
  });

  it('never calls the gate — reads are unconditional, same as look_at_screen', async () => {
    const port = fakePort();
    const { gate, attempts } = permissiveGate();
    const tools = createUiTools({ port, gate });

    await byName(tools, 'observe_ui').run({});
    expect(attempts).toEqual([]);
  });

  it('reports a gone focused window as a friendly refusal, not a thrown error', async () => {
    const port = fakePort({ focusedWindow: vi.fn(async () => { throw new HelperOpError('gone', 'window_gone'); }) });
    const { gate } = permissiveGate();
    const tools = createUiTools({ port, gate });

    const result = await byName(tools, 'observe_ui').run({});
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/did not work|no longer/i);
  });
});

describe('act_on_ui — sources the gate input from the port, never the caller', () => {
  it('click by handle: builds the Action from describeElement, not from tool args', async () => {
    const port = fakePort();
    const { gate, attempts } = permissiveGate();
    const tools = createUiTools({ port, gate });

    await byName(tools, 'act_on_ui').run({ op: 'click', handle: 'el_9', app: 'com.attacker.evil', secureField: false });

    expect(port.describeElement).toHaveBeenCalledWith('el_9');
    expect(attempts).toEqual([{ name: 'click_element', app: APP.bundleId, secureField: false }]);
    expect(port.clickElement).toHaveBeenCalledWith('el_9');
  });

  it('click by point: sources app from appAtPoint, not a handle lookup', async () => {
    const port = fakePort();
    const { gate, attempts } = permissiveGate();
    const tools = createUiTools({ port, gate });

    await byName(tools, 'act_on_ui').run({ op: 'click', x: 10, y: 20 });

    expect(port.appAtPoint).toHaveBeenCalledWith(10, 20);
    expect(port.describeElement).not.toHaveBeenCalled();
    expect(attempts).toEqual([{ name: 'click_element', app: APP.bundleId, secureField: false }]);
    expect(port.clickPoint).toHaveBeenCalledWith(10, 20);
  });

  it('type with no handle: sources app/secure from focusedElementSecure, not from args', async () => {
    const port = fakePort();
    const { gate, attempts } = permissiveGate();
    const tools = createUiTools({ port, gate });

    await byName(tools, 'act_on_ui').run({ op: 'type', text: 'hello' });

    expect(port.focusedElementSecure).toHaveBeenCalledOnce();
    expect(port.describeElement).not.toHaveBeenCalled();
    expect(attempts).toEqual([{ name: 'type_text', app: APP.bundleId, secureField: false }]);
    expect(port.typeText).toHaveBeenCalledWith('hello');
  });

  it('scroll: sources app from frontmostApp', async () => {
    const port = fakePort();
    const { gate, attempts } = permissiveGate();
    const tools = createUiTools({ port, gate });

    await byName(tools, 'act_on_ui').run({ op: 'scroll', dx: 0, dy: 100 });

    expect(port.frontmostApp).toHaveBeenCalledOnce();
    expect(attempts).toEqual([{ name: 'scroll', app: APP.bundleId, secureField: false }]);
    expect(port.scroll).toHaveBeenCalledWith(0, 100);
  });

  it('never reaches a mutating port method when the gate refuses', async () => {
    const port = fakePort();
    const gate = refusingGate('Navi has not been allowed to act in Example yet.');
    const tools = createUiTools({ port, gate });

    const result = await byName(tools, 'act_on_ui').run({ op: 'click', handle: 'el_9' });

    expect(result.isError).toBe(true);
    expect(result.content).toBe('Navi has not been allowed to act in Example yet.');
    expect(port.clickElement).not.toHaveBeenCalled();
  });

  it('validates required arguments before ever touching the port or the gate', async () => {
    const port = fakePort();
    const { gate, attempts } = permissiveGate();
    const tools = createUiTools({ port, gate });

    const result = await byName(tools, 'act_on_ui').run({ op: 'type' }); // no "text"

    expect(result.isError).toBe(true);
    expect(attempts).toEqual([]);
    expect(port.typeText).not.toHaveBeenCalled();
  });
});

describe('act_on_ui — the secure-field gate is real, via the actual policy (NAV-91)', () => {
  it('refuses to type into a secure element addressed by handle', async () => {
    const port = fakePort({
      describeElement: vi.fn(async () => ({ app: APP, secure: true, role: SECURE_FIELD, title: null, enabled: true })),
    });
    const gate = realGate(APP.bundleId);
    const tools = createUiTools({ port, gate });

    const result = await byName(tools, 'act_on_ui').run({ op: 'type', handle: 'pw_field', text: 'hunter2' });

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/password field/i);
    expect(port.setValue).not.toHaveBeenCalled();
  });

  it('refuses to type into whatever is focused when it is secure, even with no handle at all', async () => {
    // This is the case the ticket's own acceptance criterion is actually about: the coordinate
    // fallback has no element handle, so the only honest check is "what does the OS say has
    // keyboard focus right now" — see focusedElementSecure's doc comment in agent/ui.ts.
    const port = fakePort({ focusedElementSecure: vi.fn(async () => ({ secure: true, app: APP })) });
    const gate = realGate(APP.bundleId);
    const tools = createUiTools({ port, gate });

    const result = await byName(tools, 'act_on_ui').run({ op: 'type', text: 'hunter2' });

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/password field/i);
    expect(port.typeText).not.toHaveBeenCalled();
  });

  it('still allows an ordinary, non-secure field in an allowed app', async () => {
    const port = fakePort();
    const gate = realGate(APP.bundleId);
    const tools = createUiTools({ port, gate });

    const result = await byName(tools, 'act_on_ui').run({ op: 'type', handle: 'name_field', text: 'hello' });

    expect(result.isError).toBeUndefined();
    expect(port.setValue).toHaveBeenCalledWith('name_field', 'hello');
  });

  it('refuses any write in an app the user has not allowed, regardless of secure field', async () => {
    const port = fakePort();
    const gate = realGate('com.other.app'); // Example's bundle id is not on the allowed list.
    const tools = createUiTools({ port, gate });

    const result = await byName(tools, 'act_on_ui').run({ op: 'click', handle: 'el_9' });

    expect(result.isError).toBe(true);
    expect(port.clickElement).not.toHaveBeenCalled();
  });
});
