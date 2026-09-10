/**
 * First run (NAV-92).
 *
 * The ticket's rule is "no silent failure anywhere in this flow", and these are the tests that
 * hold it: every unmet requirement produces a message with a next step in it, and a permission
 * nobody has been asked for is never reported as one they refused.
 */

import { describe, expect, it } from 'vitest';
import {
  blockers,
  PERMISSION_COPY,
  recommendedPath,
  SETTINGS_PANES,
  usable,
  type OnboardingState,
} from '../src/shared/onboarding.js';

const ready: OnboardingState = {
  provider: { provider: 'ollama', hasKey: false, ollamaReachable: true },
  permissions: { accessibility: 'granted', screen: 'granted', microphone: 'granted' },
  wantsVoiceInput: false,
};

const state = (over: Partial<OnboardingState>): OnboardingState => ({ ...ready, ...over });

describe('blockers', () => {
  it('finds nothing wrong with a working setup', () => {
    expect(blockers(ready)).toEqual([]);
    expect(usable(ready)).toBe(true);
  });

  it('says so when there is no provider at all, rather than letting her fail mutely', () => {
    const dead = state({ provider: { provider: 'ollama', hasKey: false, ollamaReachable: false } });
    const [first] = blockers(dead);

    expect(first?.kind).toBe('provider');
    expect(first?.fatal).toBe(true);
    expect(usable(dead)).toBe(false);
    // A next step, not just a diagnosis.
    expect(first?.message).toMatch(/Start it|add an OpenAI key/i);
  });

  it('says so when the cloud path has no key', () => {
    const keyless = state({ provider: { provider: 'openai', hasKey: false, ollamaReachable: false } });
    expect(blockers(keyless)[0]?.message).toMatch(/no OpenAI key/i);
  });

  it('does not mind an unreachable Ollama when the user is on the cloud path', () => {
    const cloud = state({ provider: { provider: 'openai', hasKey: true, ollamaReachable: false } });
    expect(blockers(cloud)).toEqual([]);
  });

  it('treats a denied permission as a lost capability, not a dead app', () => {
    const blind = state({
      permissions: { accessibility: 'granted', screen: 'denied', microphone: 'granted' },
    });
    const [first] = blockers(blind);

    expect(first?.kind).toBe('screen');
    expect(first?.fatal).toBe(false);
    // She is still a companion who can hold a conversation.
    expect(usable(blind)).toBe(true);
    // And the message promises the honest refusal NAV-103 actually implements.
    expect(first?.message).toMatch(/say so rather than guess/i);
  });

  it('never reports a permission nobody has been asked for as refused', () => {
    // macOS says "not determined" until something tries. Telling a user they have denied a
    // permission they were never offered is its own kind of lying.
    const fresh = state({
      permissions: { accessibility: 'unknown', screen: 'unknown', microphone: 'unknown' },
    });
    expect(blockers(fresh)).toEqual([]);
  });

  it('only mentions the microphone to someone who turned the talk key on', () => {
    const denied = { accessibility: 'granted', screen: 'granted', microphone: 'denied' } as const;

    expect(blockers(state({ permissions: denied }))).toEqual([]);
    expect(blockers(state({ permissions: denied, wantsVoiceInput: true }))[0]?.kind).toBe('microphone');
  });

  it('puts what stops her working first', () => {
    const bad = state({
      provider: { provider: 'ollama', hasKey: false, ollamaReachable: false },
      permissions: { accessibility: 'denied', screen: 'denied', microphone: 'denied' },
      wantsVoiceInput: true,
    });
    expect(blockers(bad)[0]?.fatal).toBe(true);
    expect(blockers(bad)).toHaveLength(4);
  });
});

describe('recommendedPath', () => {
  it('leads with local when Ollama is already running', () => {
    expect(recommendedPath({ provider: 'openai', hasKey: true, ollamaReachable: true })).toBe('ollama');
  });

  it('leads with cloud when a key is saved and nothing is running locally', () => {
    expect(recommendedPath({ provider: 'ollama', hasKey: true, ollamaReachable: false })).toBe('openai');
  });

  it('offers both as equals to somebody with neither', () => {
    // The 2026-09-06 decision: both paths are first-class, and neither is the lesser option.
    expect(recommendedPath({ provider: 'ollama', hasKey: false, ollamaReachable: false })).toBe('either');
  });
});

describe('the copy the user reads', () => {
  it('explains each permission by what it lets her do, not by its API name', () => {
    for (const [kind, copy] of Object.entries(PERMISSION_COPY)) {
      expect(copy.why.length).toBeGreaterThan(40);
      expect(copy.why).not.toContain('AXIsProcessTrusted');
      expect(copy.title).not.toBe(kind);
    }
  });

  it('has a System Settings pane for every permission it shows', () => {
    for (const kind of Object.keys(PERMISSION_COPY)) {
      expect(SETTINGS_PANES[kind as keyof typeof SETTINGS_PANES]).toMatch(
        /^x-apple\.systempreferences:com\.apple\.preference\.security\?Privacy_/,
      );
    }
  });
});
