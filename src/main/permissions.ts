/**
 * What the OS will and will not let Navi do, and where to send the user to change it (NAV-92).
 *
 * The three permissions fail differently and have to be probed independently: Screen Recording
 * and the microphone have a media-access API, Accessibility has its own call, and none of them
 * can be requested from code in a way that actually grants anything. Every one of them fails
 * *silently* by default, which is the whole reason this file and the checklist exist.
 */

import { shell, systemPreferences } from 'electron';
import type { PermissionKind, Permissions, PermissionState } from '../shared/onboarding.js';
import { SETTINGS_PANES } from '../shared/onboarding.js';

/** Only macOS gates any of this. Elsewhere there is nothing to grant and nothing to nag about. */
const GATED = process.platform === 'darwin';

function mediaAccess(kind: 'screen' | 'microphone'): PermissionState {
  if (!GATED) return 'not-required';
  const status = systemPreferences.getMediaAccessStatus(kind);
  if (status === 'granted') return 'granted';
  if (status === 'denied' || status === 'restricted') return 'denied';
  return 'unknown';
}

/**
 * Accessibility, without nagging.
 *
 * `isTrustedAccessibilityClient(true)` raises the system dialog, and this is called on a poll —
 * passing true would put a dialog on screen every second. The prompt belongs on the checklist
 * row's button, where the user asked for it.
 */
export function accessibilityStatus(): PermissionState {
  if (!GATED) return 'not-required';
  return systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied';
}

export function permissions(): Permissions {
  return {
    accessibility: accessibilityStatus(),
    screen: mediaAccess('screen'),
    microphone: mediaAccess('microphone'),
  };
}

/**
 * Asks, where asking is possible.
 *
 * The microphone has a real request API. Screen Recording does not — the first capture attempt
 * raises the prompt, and NAV-103's tools deliberately try rather than refuse for exactly this
 * reason. Accessibility has a prompt that only opens the pane. So: request what can be
 * requested, and open System Settings for the rest, which is a next step either way.
 */
export async function request(kind: PermissionKind): Promise<PermissionState> {
  if (!GATED) return 'not-required';

  if (kind === 'microphone') {
    const granted = await systemPreferences.askForMediaAccess('microphone');
    return granted ? 'granted' : 'denied';
  }

  if (kind === 'accessibility') {
    // The one call that legitimately shows the dialog: the user has just clicked the row.
    systemPreferences.isTrustedAccessibilityClient(true);
    return accessibilityStatus();
  }

  openPane(kind);
  return mediaAccess('screen');
}

/** Opens the pane a permission is granted in. There is no API to grant these from code. */
export function openPane(kind: PermissionKind): void {
  void shell.openExternal(SETTINGS_PANES[kind]);
}

/**
 * Is Ollama there?
 *
 * A HEAD would be tidier and Ollama's root does answer one, but a GET of `/api/tags` also tells
 * us the server is a real Ollama rather than something else on the port, which is the question
 * actually being asked. Short timeout: this runs on a poll behind a checklist, and a hung
 * request must not make the row appear stuck.
 */
export async function ollamaReachable(baseUrl: string, timeoutMs = 1500): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/tags`, {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** The models a reachable Ollama actually has. An empty list is a different problem from a dead port. */
export async function ollamaModels(baseUrl: string, timeoutMs = 1500): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/tags`, { signal: controller.signal });
    if (!response.ok) return [];
    const body = (await response.json()) as { models?: Array<{ name?: unknown }> };
    return (body.models ?? [])
      .map((m) => (typeof m.name === 'string' ? m.name : ''))
      .filter((name) => name !== '');
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
