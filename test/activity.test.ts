/**
 * The activity signal's debounce (NAV-109). The property that matters: alt-tabbing between two
 * windows produces one event, not a burst, and the very first sample never counts as a change.
 */

import { describe, expect, it } from 'vitest';
import { INITIAL_ACTIVITY_STATE, sample, type ActivityDebounceState } from '../src/shared/activity.js';
import type { AppInfo } from '../src/shared/ui-protocol.js';

const DEBOUNCE_MS = 3_000;

const CODE: AppInfo = { bundleId: 'com.microsoft.VSCode', name: 'Code' };
const SLACK: AppInfo = { bundleId: 'com.tinyspeck.slack', name: 'Slack' };
const LEAGUE: AppInfo = { bundleId: 'com.riotgames.LeagueofLegends', name: 'League of Legends' };

/** Baseline established at t=0, confirmed on CODE with no pending candidate. */
function baseline(): ActivityDebounceState {
  return sample(INITIAL_ACTIVITY_STATE, CODE, 0, DEBOUNCE_MS).state;
}

describe('sample', () => {
  it('the first sample establishes a baseline and emits nothing', () => {
    const result = sample(INITIAL_ACTIVITY_STATE, CODE, 0, DEBOUNCE_MS);
    expect(result.event).toBeNull();
    expect(result.state).toEqual({ confirmed: CODE.bundleId, pending: null });
  });

  it('a null sample is undetermined, not a change — state is untouched', () => {
    const state: ActivityDebounceState = { confirmed: CODE.bundleId, pending: { app: SLACK, since: 1000 } };
    const result = sample(state, null, 2000, DEBOUNCE_MS);
    expect(result).toEqual({ state, event: null });
  });

  it('repeating the confirmed app emits nothing and clears any stale candidate', () => {
    const state: ActivityDebounceState = { confirmed: CODE.bundleId, pending: { app: SLACK, since: 1000 } };
    const result = sample(state, CODE, 1500, DEBOUNCE_MS);
    expect(result.event).toBeNull();
    expect(result.state).toEqual({ confirmed: CODE.bundleId, pending: null });
  });

  it('a genuine switch emits exactly one event once it has held for the debounce window', () => {
    let state = baseline();

    // Slack first appears at t=1000. Just short of the window: nothing yet.
    let r = sample(state, SLACK, 1000, DEBOUNCE_MS);
    expect(r.event).toBeNull();
    state = r.state;

    r = sample(state, SLACK, 1000 + DEBOUNCE_MS - 1, DEBOUNCE_MS);
    expect(r.event).toBeNull();
    state = r.state;

    // Held for the full window: settles, and only now.
    r = sample(state, SLACK, 1000 + DEBOUNCE_MS, DEBOUNCE_MS);
    expect(r.event).toEqual({ app: SLACK, at: 1000 + DEBOUNCE_MS });
    expect(r.state).toEqual({ confirmed: SLACK.bundleId, pending: null });
  });

  it('rapid alt-tabbing between two apps produces no event, only a moved candidate window', () => {
    let state = baseline();
    let event = null;

    // Five flips, each well inside the debounce window, none ever held long enough to settle.
    const samples: Array<[AppInfo, number]> = [
      [SLACK, 500],
      [CODE, 1000],
      [SLACK, 1500],
      [CODE, 2000],
      [SLACK, 2500],
    ];
    for (const [app, t] of samples) {
      const r = sample(state, app, t, DEBOUNCE_MS);
      state = r.state;
      event = r.event;
    }

    expect(event).toBeNull();
    // The last flip (to Slack, at t=2500) is a fresh candidate — not yet a change, but not
    // forgotten either: the next real sample measures from here.
    expect(state).toEqual({ confirmed: CODE.bundleId, pending: { app: SLACK, since: 2500 } });
  });

  it('switching straight to a third app restarts the window rather than carrying the first candidate\'s clock', () => {
    let state = baseline();
    state = sample(state, SLACK, 1000, DEBOUNCE_MS).state;
    // League arrives before Slack ever settled — the window restarts on League from here.
    const r = sample(state, LEAGUE, 1000 + DEBOUNCE_MS - 1, DEBOUNCE_MS);
    expect(r.event).toBeNull();
    expect(r.state.pending).toEqual({ app: LEAGUE, since: 1000 + DEBOUNCE_MS - 1 });
  });

  it('nothing beyond app identity and timestamp appears on the event', () => {
    let state = baseline();
    state = sample(state, SLACK, 1000, DEBOUNCE_MS).state;
    const result = sample(state, SLACK, 1000 + DEBOUNCE_MS, DEBOUNCE_MS);
    expect(Object.keys(result.event!)).toEqual(['app', 'at']);
    expect(Object.keys(result.event!.app)).toEqual(['bundleId', 'name']);
  });
});
