/**
 * What first run has to establish, and whether it has (NAV-92).
 *
 * Pure, and separate from the window that shows it, because "is Navi actually usable yet?" is a
 * question the whole app asks — the chat window asks it when a turn fails, the settings window
 * asks it to decide what to warn about — and it should have exactly one answer.
 *
 * The rule the whole flow is built on: **no silent failure**. Every unmet requirement has a
 * visible cause and a next step. Navi's first run has to clear three hurdles that all fail
 * quietly by default — no model provider, no Screen Recording, no Accessibility — and a fairy
 * who floats there doing nothing without saying why is the outcome this ticket exists to
 * prevent.
 */

/**
 * A permission, as the checklist sees it.
 *
 * `unknown` is not `denied`. macOS reports "not determined" until something asks, and telling a
 * user they have refused a permission they have never been offered is its own kind of lying.
 */
export type PermissionState = 'granted' | 'denied' | 'unknown' | 'not-required';

export interface Permissions {
  /** Global shortcuts — Navi's own accessibility trust, not `navi-helper`'s. */
  accessibility: PermissionState;
  /** Screen capture. Without it, NAV-103's tools have nothing to look at. */
  screen: PermissionState;
  /** The talk key. Only needed when voice input is on. */
  microphone: PermissionState;
  /**
   * `navi-helper`'s own accessibility trust (NAV-90). A separate executable, so macOS tracks it
   * separately from Navi's own `accessibility` grant above — granting one does not grant the
   * other, and this is genuinely a second row for the user to find in the same System Settings
   * pane, not a duplicate of the first.
   */
  helperAccessibility: PermissionState;
}

export interface ProviderReadiness {
  provider: 'ollama' | 'openai';
  /** A key is saved, for the cloud path. */
  hasKey: boolean;
  /** Something is answering on the Ollama port, for the local path. */
  ollamaReachable: boolean;
}

/**
 * Deep links into System Settings.
 *
 * The pane identifiers are Apple's and are not guessable; they are also not stable forever, so
 * they live in one place rather than being sprinkled through the renderer. A link that opens
 * the wrong pane is better than no link — the user is at least in the right application — but
 * a link that opens nothing is a dead end, which is the failure mode this ticket forbids.
 */
export const SETTINGS_PANES = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  // Same pane as `accessibility` — `navi-helper` gets its own row within it, not a pane of its own.
  helperAccessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
} as const;

export type PermissionKind = keyof typeof SETTINGS_PANES;

/**
 * What each permission is for, in the user's terms rather than the API's.
 *
 * Users are right to hesitate at "allow this app to control your computer". The way to earn it
 * is to say what it actually does, so each of these names a capability the user asked for
 * rather than a category Apple invented.
 */
export const PERMISSION_COPY: Record<PermissionKind, { title: string; why: string }> = {
  screen: {
    title: 'Screen Recording',
    why: 'Lets Navi see what is on your screen when you ask her about it. Without it she will tell you she cannot see, rather than guessing.',
  },
  accessibility: {
    title: 'Accessibility',
    why: 'Lets her summon key work while you are in another app. Without it the key does nothing and never says why.',
  },
  microphone: {
    title: 'Microphone',
    why: 'Lets you talk to her instead of typing. Only needed if you turn the talk key on.',
  },
  helperAccessibility: {
    title: 'Accessibility for navi-helper',
    why: 'Lets her read what is on screen as real buttons and fields, and click or type for you, instead of only describing and pointing.',
  },
};

export interface OnboardingState {
  provider: ProviderReadiness;
  permissions: Permissions;
  /** Whether the user has voice input turned on, which is what makes the mic row matter. */
  wantsVoiceInput: boolean;
}

/** A requirement, with the reason it is not met and what to do about it. */
export interface Blocker {
  kind: 'provider' | PermissionKind;
  /** What Navi cannot do. Written to be shown to the user as-is. */
  message: string;
  /** Whether it stops her working at all, as opposed to costing her one capability. */
  fatal: boolean;
}

/**
 * Everything standing between the user and a working Navi, worst first.
 *
 * A provider is fatal: without one she cannot say a word. The permissions are not — she is a
 * companion who can hold a conversation without being able to see, and refusing to start until
 * every box is ticked would be a worse product than one that says what it is missing.
 */
export function blockers(state: OnboardingState): Blocker[] {
  const out: Blocker[] = [];

  if (state.provider.provider === 'openai' && !state.provider.hasKey) {
    out.push({
      kind: 'provider',
      message: 'Navi has no OpenAI key, so she cannot answer. Add one in Settings, or switch to Ollama to run locally.',
      fatal: true,
    });
  }
  if (state.provider.provider === 'ollama' && !state.provider.ollamaReachable) {
    out.push({
      kind: 'provider',
      message: 'Navi cannot reach Ollama, so she cannot answer. Start it, or add an OpenAI key in Settings.',
      fatal: true,
    });
  }

  if (state.permissions.screen === 'denied') {
    out.push({
      kind: 'screen',
      message: 'Screen Recording is off, so Navi cannot see your screen. She will say so rather than guess.',
      fatal: false,
    });
  }
  if (state.permissions.accessibility === 'denied') {
    out.push({
      kind: 'accessibility',
      message: 'Accessibility is off, so her summon key will not work while another app has focus. Clicking her still opens the chat.',
      fatal: false,
    });
  }
  if (state.wantsVoiceInput && state.permissions.microphone === 'denied') {
    out.push({
      kind: 'microphone',
      message: 'The microphone is off, so the talk key cannot hear you. Typing still works.',
      fatal: false,
    });
  }
  if (state.permissions.helperAccessibility === 'denied') {
    out.push({
      kind: 'helperAccessibility',
      message: 'Accessibility for navi-helper is off, so Navi cannot read or act on other apps yet. She can still see a screenshot and point.',
      fatal: false,
    });
  }

  return out;
}

/** Whether she can hold a conversation at all. Everything else is a capability, not a pulse. */
export function usable(state: OnboardingState): boolean {
  return !blockers(state).some((b) => b.fatal);
}

/**
 * Which path first run should lead with.
 *
 * A reachable Ollama means the destination is already installed, and offering to paste a cloud
 * key in front of someone who has done the hard part would be perverse. With nothing running,
 * both are offered as equals — the 2026-09-06 decision is that neither is the lesser option —
 * and the cloud path is simply the one that takes sixty seconds.
 */
export function recommendedPath(state: ProviderReadiness): 'ollama' | 'openai' | 'either' {
  if (state.ollamaReachable) return 'ollama';
  if (state.hasKey) return 'openai';
  return 'either';
}
