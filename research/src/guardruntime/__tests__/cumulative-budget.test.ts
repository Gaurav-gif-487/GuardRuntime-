import { describe, expect, it } from "vitest";
import { CumulativeBudgetManager } from "../cumulative-budget";
import type { RiskDecision, ToolCall } from "../types";

const makeCall = (amount: number): ToolCall => ({
  tenantId: "acme-corp",
  idempotencyKey: `call_${Math.random()}`,
  tool: "issue_refund",
  args: { amount_usd: amount },
  goal: `refund ${amount}`,
  principal: "agent:support",
  permissionScope: "support:write",
  environment: "prod",
});

const makeRisk = (blast: number): RiskDecision => ({
  reversibility: "recoverable",
  blastRadius: blast,
  severity: blast * 0.6,
  requiresConfirmation: false,
  ruleId: "arc.matrix.recoverable",
  policyVersion: "v3",
  rationale: ["test"],
  downgradedForMissingCompensation: false,
});

describe("CumulativeBudgetManager", () => {
  it("allows micro-transactions within hourly budget limits", () => {
    const manager = new CumulativeBudgetManager({
      windowMs: 3600000,
      maxCumulativeMagnitude: 1000,
      maxCumulativeAffectedCount: 100,
      maxCumulativeBlastRadius: 1.0,
    });

    const call = makeCall(100);
    const risk = makeRisk(0.1);

    const status = manager.evaluateBudget("acme-corp", "agent-1", call, risk);
    expect(status.budgetExceeded).toBe(false);
  });

  it("detects and blocks slicing/sybil attacks exceeding cumulative budget", () => {
    let mockTime = 1000;
    const manager = new CumulativeBudgetManager(
      {
        windowMs: 3600000,
        maxCumulativeMagnitude: 500, // $500 max unconfirmed spend
        maxCumulativeAffectedCount: 50,
        maxCumulativeBlastRadius: 0.8,
      },
      undefined,
      () => mockTime,
    );

    // Simulate 5 consecutive $100 transactions
    for (let i = 0; i < 5; i++) {
      mockTime += 1000;
      const call = makeCall(100);
      const risk = makeRisk(0.1);
      manager.recordUsage("acme-corp", "agent-1", call, risk, false);
    }

    // 6th transaction ($100) attempts to cross the $500 limit ($600 total)
    const call6 = makeCall(100);
    const risk6 = makeRisk(0.1);
    const status6 = manager.evaluateBudget("acme-corp", "agent-1", call6, risk6);

    expect(status6.budgetExceeded).toBe(true);
    expect(status6.exceededReason).toContain("Cumulative monetary spend");
  });
});
