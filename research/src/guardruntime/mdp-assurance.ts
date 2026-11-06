/**
 * Dynamic Probabilistic Assurance (DPA) via Online MDP Learning (Gap 6).
 *
 * Implements the AgentGuard (ASE 2025) paradigm:
 * Replaces static heuristic anomaly thresholds with an online learned
 * Markov Decision Process that calculates the live probability of entering
 * an unsafe/destructive state within the next k steps.
 */

import type { Reversibility } from "./types";

export type MDPState = "READ_SAFE" | "RECOVERABLE_LOW" | "RECOVERABLE_HIGH" | "DESTRUCTIVE_GATED";

export const MDP_STATES: MDPState[] = [
  "READ_SAFE",
  "RECOVERABLE_LOW",
  "RECOVERABLE_HIGH",
  "DESTRUCTIVE_GATED",
];

export interface MDPTransitionMatrix {
  counts: Record<MDPState, Record<MDPState, number>>;
  probabilities: Record<MDPState, Record<MDPState, number>>;
}

export interface DynamicAssuranceReport {
  agentId: string;
  currentState: MDPState;
  kStepFailureProbability: number;
  entropy: number;
  assuranceThreshold: number;
  anomalyDetected: boolean;
  rationale: string;
}

export class ProbabilisticMDPAssurance {
  private transitionCounts = new Map<string, Record<MDPState, Record<MDPState, number>>>();
  private agentCurrentState = new Map<string, MDPState>();

  constructor(
    private readonly kStepsHorizon: number = 3,
    private readonly failureProbabilityThreshold: number = 0.65,
  ) {}

  private initMatrix(): Record<MDPState, Record<MDPState, number>> {
    const matrix: Record<string, Record<string, number>> = {};
    for (const from of MDP_STATES) {
      matrix[from] = {};
      for (const to of MDP_STATES) {
        // Laplace smoothing (prior count 1)
        matrix[from][to] = 1;
      }
    }
    return matrix as Record<MDPState, Record<MDPState, number>>;
  }

  /**
   * Maps a tool call risk tuple to an MDP state abstraction.
   */
  abstractState(reversibility: Reversibility, blastRadius: number): MDPState {
    if (reversibility === "reversible") return "READ_SAFE";
    if (reversibility === "recoverable") {
      return blastRadius < 0.35 ? "RECOVERABLE_LOW" : "RECOVERABLE_HIGH";
    }
    return "DESTRUCTIVE_GATED";
  }

  /**
   * Observe a state transition and update the agent's online MDP model.
   */
  observeTransition(agentId: string, newState: MDPState): DynamicAssuranceReport {
    let counts = this.transitionCounts.get(agentId);
    if (!counts) {
      counts = this.initMatrix();
      this.transitionCounts.set(agentId, counts);
    }

    const prevState = this.agentCurrentState.get(agentId) ?? "READ_SAFE";
    counts[prevState][newState]++;
    this.agentCurrentState.set(agentId, newState);

    const probs = this.computeProbabilities(counts);
    const failureProb = this.computeKStepFailureProbability(newState, probs, this.kStepsHorizon);
    const entropy = this.computeStateEntropy(newState, probs);

    const anomalyDetected = failureProb > this.failureProbabilityThreshold;
    const rationale = anomalyDetected
      ? `Model-estimated reach probability P(reach(DESTRUCTIVE) ≤ ${this.kStepsHorizon}) = ${(failureProb * 100).toFixed(1)}% exceeds threshold ${(this.failureProbabilityThreshold * 100).toFixed(1)}%`
      : `Agent operating within nominal probabilistic safety envelope (P(failure) = ${(failureProb * 100).toFixed(1)}%)`;

    return {
      agentId,
      currentState: newState,
      kStepFailureProbability: failureProb,
      entropy,
      assuranceThreshold: this.failureProbabilityThreshold,
      anomalyDetected,
      rationale,
    };
  }

  private computeProbabilities(
    counts: Record<MDPState, Record<MDPState, number>>,
  ): Record<MDPState, Record<MDPState, number>> {
    const probs: Record<string, Record<string, number>> = {};
    for (const from of MDP_STATES) {
      probs[from] = {};
      let total = 0;
      for (const to of MDP_STATES) total += counts[from][to];
      for (const to of MDP_STATES)
        probs[from][to] = total > 0 ? counts[from][to] / total : 1 / MDP_STATES.length;
    }
    return probs as Record<MDPState, Record<MDPState, number>>;
  }

  /**
   * Multi-step forward reachability probability using Chapman-Kolmogorov dynamic programming.
   */
  private computeKStepFailureProbability(
    startState: MDPState,
    probs: Record<MDPState, Record<MDPState, number>>,
    horizon: number,
  ): number {
    let stateProbs: Record<MDPState, number> = {
      READ_SAFE: 0,
      RECOVERABLE_LOW: 0,
      RECOVERABLE_HIGH: 0,
      DESTRUCTIVE_GATED: 0,
    };
    stateProbs[startState] = 1.0;

    let cumulativeFailureProb = startState === "DESTRUCTIVE_GATED" ? 1.0 : 0.0;

    for (let step = 0; step < horizon; step++) {
      const nextProbs: Record<MDPState, number> = {
        READ_SAFE: 0,
        RECOVERABLE_LOW: 0,
        RECOVERABLE_HIGH: 0,
        DESTRUCTIVE_GATED: 0,
      };

      for (const from of MDP_STATES) {
        if (from === "DESTRUCTIVE_GATED") continue; // Absorbing failure state
        for (const to of MDP_STATES) {
          nextProbs[to] += stateProbs[from] * probs[from][to];
        }
      }

      cumulativeFailureProb += nextProbs["DESTRUCTIVE_GATED"];
      stateProbs = nextProbs;
    }

    return Math.min(1.0, cumulativeFailureProb);
  }

  private computeStateEntropy(
    state: MDPState,
    probs: Record<MDPState, Record<MDPState, number>>,
  ): number {
    let entropy = 0;
    for (const to of MDP_STATES) {
      const p = probs[state][to];
      if (p > 0) entropy -= p * Math.log2(p);
    }
    return entropy;
  }
}
