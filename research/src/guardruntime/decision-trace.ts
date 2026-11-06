/**
 * Causal Attribution & Decision Explainability Engine (Gap 4).
 *
 * Implements explicit human-oversight decision tracing:
 * 1. DecisionTrace DAG — records the causal graph of pipeline gates and evaluations
 * 2. Counterfactual Reasoning — computes exact parameter deltas required to change the decision
 * 3. Structured Decision Explanation — machine-auditable and human-readable transparency report
 */

import type { ToolCall, RiskDecision, ToolDescriptor } from "./types";
import type { Policy } from "./policy";

export interface DecisionNode {
  gateId: string;
  gateName: string;
  evaluatedAt: number;
  passed: boolean;
  inputValues: Record<string, unknown>;
  outputValues: Record<string, unknown>;
  rationale: string;
  causedGating: boolean;
}

export interface CounterfactualCondition {
  parameter: string;
  currentValue: unknown;
  requiredValueForAutoApproval: unknown;
  explanation: string;
}

export interface StructuredExplanation {
  callId: string;
  tool: string;
  outcome: "executed" | "pending_confirmation" | "blocked";
  primaryCause?: string | undefined;
  decisionNodes: DecisionNode[];
  counterfactuals: CounterfactualCondition[];
  causalChainSummary: string;
}

export class DecisionTraceEngine {
  /**
   * Builds a structured causal explanation and counterfactual analysis
   * for an evaluated tool call.
   */
  static explain(
    call: ToolCall,
    risk: RiskDecision,
    policy: Policy,
    toolDescriptor?: ToolDescriptor,
    budgetExceeded = false,
    budgetReason?: string,
    taintViolationsCount = 0,
    capabilityAuthorized = true,
    capabilityReason?: string,
  ): StructuredExplanation {
    const nodes: DecisionNode[] = [];
    const counterfactuals: CounterfactualCondition[] = [];
    let primaryCause: string | undefined;

    const now = Date.now();

    // Node 1: Capability Gate
    nodes.push({
      gateId: "gate.capability",
      gateName: "Capability Authorization Gate",
      evaluatedAt: now,
      passed: capabilityAuthorized,
      inputValues: { principal: call.principal, tool: call.tool },
      outputValues: { authorized: capabilityAuthorized },
      rationale: capabilityReason ?? "Principal possesses valid capability manifest for this tool",
      causedGating: !capabilityAuthorized,
    });
    if (!capabilityAuthorized && !primaryCause) primaryCause = "Capability authorization failed";

    // Node 2: Taint Flow Gate
    const taintPassed = taintViolationsCount === 0;
    nodes.push({
      gateId: "gate.taint_flow",
      gateName: "Information Flow Taint Gate",
      evaluatedAt: now,
      passed: taintPassed,
      inputValues: { tool: call.tool },
      outputValues: { violations: taintViolationsCount },
      rationale: taintPassed
        ? "No illegal cross-tool data flow detected"
        : `Detected ${taintViolationsCount} taint policy violations`,
      causedGating: !taintPassed,
    });
    if (!taintPassed && !primaryCause) primaryCause = "Information flow taint policy violation";

    // Node 3: ARC Risk Classifier
    const arcGated = risk.requiresConfirmation;
    nodes.push({
      gateId: "gate.arc_risk",
      gateName: "2-Axis Action Risk Classifier",
      evaluatedAt: now,
      passed: !arcGated,
      inputValues: {
        reversibility: risk.reversibility,
        blastRadius: risk.blastRadius,
        confidence: call.confidence,
      },
      outputValues: {
        severity: risk.severity,
        requiresConfirmation: risk.requiresConfirmation,
      },
      rationale: risk.rationale.join(" "),
      causedGating: arcGated,
    });
    if (arcGated && !primaryCause)
      primaryCause = `ARC risk threshold exceeded (${risk.reversibility} with blast radius ${risk.blastRadius.toFixed(2)})`;

    // Node 4: Cumulative Budget Gate
    nodes.push({
      gateId: "gate.cumulative_budget",
      gateName: "Cumulative State Budget Gate",
      evaluatedAt: now,
      passed: !budgetExceeded,
      inputValues: { tenantId: call.tenantId, principal: call.principal },
      outputValues: { budgetExceeded },
      rationale: budgetExceeded
        ? (budgetReason ?? "Cumulative budget exceeded")
        : "Within rolling window state budget",
      causedGating: budgetExceeded,
    });
    if (budgetExceeded && !primaryCause)
      primaryCause = budgetReason ?? "Cumulative spend budget exceeded";

    // ─── Counterfactual Analysis ─────────────────────────────────────────────
    if (risk.reversibility === "recoverable" && risk.blastRadius >= policy.thresholds.recoverable) {
      const threshold = policy.thresholds.recoverable;
      // Solve: log10(magnitude) / 7 <= threshold  => magnitude <= 10^(7 * threshold)
      const maxMagnitude = Math.floor(Math.pow(10, 7 * threshold));
      const currentMagnitude = Number(
        call.args[toolDescriptor?.magnitudeField ?? "amount_usd"] ?? 0,
      );

      counterfactuals.push({
        parameter: toolDescriptor?.magnitudeField ?? "amount_usd",
        currentValue: currentMagnitude,
        requiredValueForAutoApproval: `<= $${maxMagnitude}`,
        explanation: `If amount were ≤ $${maxMagnitude}, blast radius would be ≤ ${threshold} (the recoverable threshold), allowing autonomous execution.`,
      });
    }

    if (risk.reversibility === "destructive") {
      counterfactuals.push({
        parameter: "tool.reversibility",
        currentValue: "destructive",
        requiredValueForAutoApproval: "recoverable (with compensating transaction)",
        explanation:
          "Destructive operations always require human confirmation under Invariant 2. Registering an operational compensation would permit autonomous execution below blast threshold.",
      });
    }

    if (typeof call.confidence === "number" && call.confidence < policy.lowConfidenceCutoff) {
      counterfactuals.push({
        parameter: "call.confidence",
        currentValue: call.confidence,
        requiredValueForAutoApproval: `>= ${policy.lowConfidenceCutoff}`,
        explanation: `Model confidence was below ${policy.lowConfidenceCutoff}, which activated the one-directional safety ratchet.`,
      });
    }

    // Causal chain summary
    const causalChainSummary = nodes
      .map((n) => `[${n.passed ? "PASS" : "GATE"}] ${n.gateName}: ${n.rationale}`)
      .join("\n");

    const outcome =
      !capabilityAuthorized || !taintPassed
        ? "blocked"
        : risk.requiresConfirmation || budgetExceeded
          ? "pending_confirmation"
          : "executed";

    return {
      callId: call.idempotencyKey,
      tool: call.tool,
      outcome,
      primaryCause,
      decisionNodes: nodes,
      counterfactuals,
      causalChainSummary,
    };
  }
}
