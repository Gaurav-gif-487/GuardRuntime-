import { describe, it } from "vitest";
import assert from "node:assert";
import { DecisionTraceEngine } from "../decision-trace.ts";
import { DEFAULT_POLICY } from "../policy.ts";
import type { ToolCall, RiskDecision } from "../types.ts";

describe("Gap 4: Causal Attribution & Decision Explainability", () => {
  it("explains high-magnitude recoverable gating with counterfactual parameter guidance", () => {
    const call: ToolCall = {
      tenantId: "acme-corp",
      idempotencyKey: "trace_1",
      tool: "issue_refund",
      args: { amount_usd: 95000 },
      goal: "refund enterprise customer",
      principal: "agent:support",
      permissionScope: "support:write",
      environment: "prod",
    };

    const risk: RiskDecision = {
      reversibility: "recoverable",
      blastRadius: 0.71,
      severity: 0.5,
      requiresConfirmation: true,
      ruleId: "arc.matrix.recoverable",
      policyVersion: "1.0",
      rationale: ["Blast radius 0.71 vs recoverable threshold 0.35"],
      downgradedForMissingCompensation: false,
    };

    const explanation = DecisionTraceEngine.explain(call, risk, DEFAULT_POLICY, {
      name: "issue_refund",
      reversibility: "recoverable",
      resourceType: "payment",
      schemaVersion: "1.0",
      magnitudeField: "amount_usd",
    });

    assert.strictEqual(explanation.outcome, "pending_confirmation");
    assert.strictEqual(explanation.decisionNodes.length, 4);
    assert.ok(explanation.primaryCause?.includes("ARC risk threshold exceeded"));
    assert.strictEqual(explanation.counterfactuals.length, 1);
    assert.strictEqual(explanation.counterfactuals[0]?.parameter, "amount_usd");
    // Threshold 0.35 -> 10^(7 * 0.35) = 10^2.45 ≈ 281
    assert.ok(
      explanation.counterfactuals[0]?.explanation.includes("allowing autonomous execution"),
    );
  });

  it("explains destructive operations with compensation registration advice", () => {
    const call: ToolCall = {
      tenantId: "acme-corp",
      idempotencyKey: "trace_2",
      tool: "wire_transfer",
      args: { amount_usd: 1000 },
      goal: "wire payment",
      principal: "agent:finance",
      permissionScope: "finance:write",
      environment: "prod",
    };

    const risk: RiskDecision = {
      reversibility: "destructive",
      blastRadius: 0.43,
      severity: 0.65,
      requiresConfirmation: true,
      ruleId: "arc.matrix.destructive",
      policyVersion: "1.0",
      rationale: ["Destructive actions always require confirmation"],
      downgradedForMissingCompensation: false,
    };

    const explanation = DecisionTraceEngine.explain(call, risk, DEFAULT_POLICY);
    const cf = explanation.counterfactuals.find((c) => c.parameter === "tool.reversibility");
    assert.ok(cf);
    assert.ok(cf!.explanation.includes("Invariant 2"));
  });
});
