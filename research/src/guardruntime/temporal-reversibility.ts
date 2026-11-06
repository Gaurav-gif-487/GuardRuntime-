/**
 * Time-Decaying & Ephemeral Reversibility Engine.
 *
 * Solves the Distributed Systems Saga Problem: In real-world enterprise
 * architectures (Stripe, Twilio, AWS, SAP), reversibility is NOT a static
 * eternal constant—it degrades with time or contains irrevocable side-effects.
 *
 * Implements:
 * 1. Time-Decaying Reversibility Window: Actions are recoverable only within a strict TTL
 * 2. Partial Reversibility & Ephemeral Side-Effect Tracking
 * 3. Dynamic Reversibility Downgrades based on elapsed execution duration
 */

import type { Reversibility } from "./types";

export interface ReversibilityProfile {
  toolName: string;
  baseReversibility: Reversibility;
  /** Maximum duration in ms during which the compensating transaction is valid. */
  compensationValidityWindowMs: number;
  /** Description of irrevocable side-effects that cannot be undone even with compensation. */
  uncompensatedSideEffects?: string[];
  /** Grace period for settlement. After this, action becomes irreversible. */
  settlementThresholdMs?: number;
}

export const SEED_TEMPORAL_PROFILES: Record<string, ReversibilityProfile> = {
  issue_refund: {
    toolName: "issue_refund",
    baseReversibility: "recoverable",
    compensationValidityWindowMs: 30 * 60 * 1000, // 30 minutes to void
    settlementThresholdMs: 24 * 60 * 60 * 1000, // 24 hours to batch settlement
    uncompensatedSideEffects: ["Bank notification SMS sent to customer"],
  },
  cancel_subscription: {
    toolName: "cancel_subscription",
    baseReversibility: "recoverable",
    compensationValidityWindowMs: 7 * 24 * 60 * 60 * 1000, // 7 days grace period
    settlementThresholdMs: 30 * 24 * 60 * 60 * 1000,
  },
  send_email: {
    toolName: "send_email",
    baseReversibility: "destructive",
    compensationValidityWindowMs: 0, // Immediately irreversible
    uncompensatedSideEffects: ["Email delivered to external inbox"],
  },
  delete_workspace: {
    toolName: "delete_workspace",
    baseReversibility: "recoverable",
    compensationValidityWindowMs: 24 * 60 * 60 * 1000, // 24-hour soft delete / recycle bin
    uncompensatedSideEffects: ["Active WebSocket sessions disconnected"],
  },
};

export class TemporalReversibilityEngine {
  private profiles = new Map<string, ReversibilityProfile>();

  constructor(
    profiles: Record<string, ReversibilityProfile> = SEED_TEMPORAL_PROFILES,
    private readonly clock: () => number = () => Date.now(),
  ) {
    for (const [name, p] of Object.entries(profiles)) {
      this.profiles.set(name, p);
    }
  }

  registerProfile(profile: ReversibilityProfile): void {
    this.profiles.set(profile.toolName, profile);
  }

  /**
   * Evaluate the effective dynamic reversibility of a tool given its original
   * execution timestamp.
   */
  evaluateReversibility(
    toolName: string,
    executedAt: number,
  ): {
    reversibility: Reversibility;
    isDegraded: boolean;
    remainingValidityMs: number;
    sideEffects: string[];
    rationale: string;
  } {
    const now = this.clock();
    const profile = this.profiles.get(toolName);

    if (!profile) {
      return {
        reversibility: "destructive",
        isDegraded: false,
        remainingValidityMs: 0,
        sideEffects: ["Unregistered temporal profile; assumed fully destructive"],
        rationale: "No temporal profile registered; default to destructive",
      };
    }

    if (profile.baseReversibility === "reversible") {
      return {
        reversibility: "reversible",
        isDegraded: false,
        remainingValidityMs: Infinity,
        sideEffects: [],
        rationale: "Reversible read operation remains eternally reversible",
      };
    }

    if (profile.baseReversibility === "destructive") {
      return {
        reversibility: "destructive",
        isDegraded: false,
        remainingValidityMs: 0,
        sideEffects: profile.uncompensatedSideEffects ?? [],
        rationale: "Destructive operation is immediately irrevocable",
      };
    }

    // For recoverable operations, check compensation window
    const elapsed = now - executedAt;
    const remaining = Math.max(0, profile.compensationValidityWindowMs - elapsed);

    if (remaining <= 0) {
      return {
        reversibility: "destructive",
        isDegraded: true,
        remainingValidityMs: 0,
        sideEffects: [
          ...(profile.uncompensatedSideEffects ?? []),
          `Compensation window of ${profile.compensationValidityWindowMs / 1000}s has expired (${(elapsed / 1000).toFixed(0)}s elapsed)`,
        ],
        rationale: `Compensation window expired; downgraded from recoverable to destructive`,
      };
    }

    return {
      reversibility: "recoverable",
      isDegraded: false,
      remainingValidityMs: remaining,
      sideEffects: profile.uncompensatedSideEffects ?? [],
      rationale: `Compensation window active (${(remaining / 1000).toFixed(0)}s remaining)`,
    };
  }
}
