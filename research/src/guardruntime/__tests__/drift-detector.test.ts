import { describe, expect, it } from "vitest";
import { BehavioralDriftDetector } from "../drift-detector";
import type { ToolCall } from "../types";

const makeCall = (over: Partial<ToolCall> = {}): ToolCall => ({
  tenantId: "acme-tenant",
  idempotencyKey: `drift_${Math.random()}`,
  tool: "search_orders",
  args: { query: "q" },
  goal: "routine search",
  principal: "agent:support",
  permissionScope: "support:read",
  environment: "prod",
  ...over,
});

describe("BehavioralDriftDetector", () => {
  it("initializes without false drift alerts on sparse history", () => {
    const detector = new BehavioralDriftDetector();
    const call = makeCall();
    detector.recordCall("acme-tenant", "agent-1", call, "reversible", 0.05);

    const assessment = detector.assessDrift("acme-tenant", "agent-1");
    expect(assessment.drifting).toBe(false);
    expect(assessment.score).toBe(0);
  });

  it("detects destructive rate spike and triggers cooldown", () => {
    let mockTime = 1_000_000;
    const detector = new BehavioralDriftDetector(
      {
        windowSize: 10,
        escalationThreshold: 0.5,
        cooldownMs: 60_000,
        destructiveRateWeight: 0.6,
        scopeEscalationWeight: 0.2,
        toolDiversityWeight: 0.1,
        frequencyWeight: 0.1,
        minHistorySize: 10,
      },
      undefined,
      () => mockTime,
    );

    // Baseline: 10 reversible safe calls
    for (let i = 0; i < 10; i++) {
      mockTime += 1000;
      detector.recordCall(
        "acme-tenant",
        "agent-1",
        makeCall({ tool: "search_orders" }),
        "reversible",
        0.05,
      );
    }

    // Normal assessment
    const before = detector.assessDrift("acme-tenant", "agent-1");
    expect(before.drifting).toBe(false);

    // Sudden spike: 10 destructive calls
    for (let i = 0; i < 10; i++) {
      mockTime += 1000;
      detector.recordCall(
        "acme-tenant",
        "agent-1",
        makeCall({ tool: "wire_transfer" }),
        "destructive",
        0.9,
      );
    }

    const after = detector.assessDrift("acme-tenant", "agent-1");
    expect(after.drifting).toBe(true);
    expect(after.inCooldown).toBe(true);
    expect(after.signals.destructiveRateAnomaly).toBeGreaterThan(0.5);
    expect(detector.isAgentInCooldown("acme-tenant", "agent-1")).toBe(true);
  });

  it("provides tenant-level aggregated drift statistics", () => {
    const detector = new BehavioralDriftDetector();
    detector.recordCall("acme-tenant", "agent-1", makeCall(), "reversible", 0.1);
    detector.recordCall("acme-tenant", "agent-2", makeCall(), "reversible", 0.1);

    const stats = detector.tenantStats("acme-tenant");
    expect(stats.totalAgents).toBe(2);
    expect(stats.driftingAgents).toBe(0);
  });
});
