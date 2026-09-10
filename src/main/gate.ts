/**
 * The gate every acting tool passes through (NAV-91).
 *
 * `shared/policy.ts` decides; this remembers. It holds the state a decision needs — what the
 * user has allowed, how many writes this turn has spent, whether the kill switch is down — asks
 * for confirmation when the policy says one is needed, and writes everything to the audit log
 * whichever way it went.
 *
 * **There is nothing to gate yet, and that is the point.** NAV-90's helper does not exist. The
 * ordering is a settled decision: a gate written after the capability is a gate written to let
 * the existing behaviour through. When the write tools arrive, they call `attempt` and do
 * nothing else about safety — no tool decides its own policy.
 *
 * No Electron import. Confirmation arrives as a function, the clock as a function, and the log
 * as a sink, so a runaway loop hitting the rate limit runs in a millisecond under test.
 */

import {
  decide,
  record,
  verdictOf,
  type Action,
  type AuditEntry,
  type Decision,
  type PolicyState,
} from '../shared/policy.js';

export interface GateDeps {
  /** Applications the user has allowed. Read per call, so a settings edit takes effect at once. */
  allowedApps(): readonly string[];
  /**
   * Asks the user. Resolves true for yes and false for anything else, including a window that
   * went away — a confirmation nobody answered is a no.
   */
  confirm(action: Action, decision: Decision): Promise<boolean>;
  /** Told when a write starts and finishes, so the user can see that Navi is acting. */
  onActing?(acting: boolean): void;
  /** Told about every decision, for the panel that shows them. */
  onAudit?(entry: AuditEntry): void;
  now?(): number;
}

export interface Attempt {
  decision: Decision;
  /** True when the caller may now perform the action. Nothing else grants that. */
  proceed: boolean;
}

export interface Gate {
  /**
   * The one entry point. Returns whether the action may be performed, having asked the user if
   * that was needed and logged the outcome either way.
   */
  attempt(action: Action): Promise<Attempt>;
  /** A new turn: the per-turn write budget starts again. */
  beginTurn(): void;
  /** The kill switch. Everything stops, including something already confirmed. */
  halt(): void;
  /** Undoes the kill switch. Deliberately a separate, explicit act. */
  resume(): void;
  halted(): boolean;
  log(): readonly AuditEntry[];
  clearLog(): void;
}

export function createGate(deps: GateDeps): Gate {
  const now = deps.now ?? (() => Date.now());

  let writesThisTurn = 0;
  let halted = false;
  let log: AuditEntry[] = [];

  const state = (): PolicyState => ({ allowedApps: deps.allowedApps(), writesThisTurn, halted });

  const write = (action: Action, decision: Decision): void => {
    const entry: AuditEntry = {
      at: now(),
      action,
      tier: decision.tier,
      verdict: verdictOf(decision),
      reason: decision.reason,
    };
    log = record(log, entry);
    deps.onAudit?.(entry);
  };

  return {
    beginTurn() {
      writesThisTurn = 0;
    },

    halt() {
      halted = true;
      deps.onActing?.(false);
    },

    resume() {
      halted = false;
    },

    halted: () => halted,
    log: () => log,
    clearLog() {
      log = [];
    },

    async attempt(action) {
      const first = decide(action, state());

      // Settled without asking: a read, or a refusal the user cannot overturn.
      if (first.allowed || !first.confirmable) {
        write(action, first);
        return { decision: first, proceed: first.allowed };
      }

      // Logged before the card goes up, so an action the user was asked about appears in the
      // record even if they never answer — "attempted" is a thing the log has to be able to say.
      write(action, first);

      const said = await deps.confirm(action, first);
      if (!said) {
        const refused: Decision = { ...first, allowed: false, reason: 'The user said no.' };
        write(action, refused);
        return { decision: refused, proceed: false };
      }

      // Re-decided rather than trusting the first answer. The kill switch may have gone down
      // while the card was up, and that has to win.
      const second = decide(action, state(), true);
      write(action, second);

      if (!second.allowed) return { decision: second, proceed: false };

      writesThisTurn++;
      deps.onActing?.(true);
      return { decision: second, proceed: true };
    },
  };
}
