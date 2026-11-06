import { describe, expect, it } from "vitest";
import { MultiAgentCoordinator } from "../multi-agent";
import { ActionRiskClassifier } from "../arc";
import { DEFAULT_POLICY, SEED_TOOLS } from "../policy";
import { AuditLog } from "../audit";
import { Metrics } from "../metrics";
import type { ToolCall } from "../types";

const arc = new ActionRiskClassifier(new Map(SEED_TOOLS.map((t) => [t.name, t])), DEFAULT_POLICY);

const makeCall = (tool: string, args: Record<string, unknown> = {}): ToolCall => ({
  tenantId: "acme-corp",
  idempotencyKey: `call_${Math.random()}`,
  tool,
  args,
  goal: `multi-agent test for ${tool}`,
  principal: "agent:tester",
  permissionScope: "admin:write",
  environment: "prod",
});

describe("MultiAgentCoordinator", () => {
  it("registers and unregisters agents cleanly", () => {
    const coordinator = new MultiAgentCoordinator();
    coordinator.registerAgent({
      agentId: "agent-1",
      tenantId: "acme-corp",
      permissionScopes: ["support:read", "support:write"],
      maxConcurrent: 5,
      registeredAt: Date.now(),
    });

    expect(coordinator.getAgent("agent-1")).toBeDefined();
    expect(coordinator.getAgent("agent-1")?.maxConcurrent).toBe(5);

    coordinator.unregisterAgent("agent-1");
    expect(coordinator.getAgent("agent-1")).toBeUndefined();
  });

  it("detects conflicting concurrent claims and resolves via priority", () => {
    const coordinator = new MultiAgentCoordinator();
    const audit = new AuditLog();
    const metrics = new Metrics();
    const coord = new MultiAgentCoordinator(undefined, audit, metrics);

    const call1 = makeCall("issue_refund", { amount_usd: 50 });
    const risk1 = arc.classify(call1);

    const call2 = makeCall("wire_transfer", { amount_usd: 100_000 });
    const risk2 = arc.classify(call2);

    // Agent 1 claims resource
    const res1 = coord.claimResource("agent-1", "acme-corp", "payment", "pay_999", call1, risk1);
    expect("claim" in res1).toBe(true);

    // Agent 2 attempts to claim same resource -> conflict
    const res2 = coord.claimResource("agent-2", "acme-corp", "payment", "pay_999", call2, risk2);
    expect("conflict" in res2).toBe(true);

    if ("conflict" in res2) {
      expect(res2.conflict.resource.id).toBe("pay_999");
      expect(res2.conflict.claimants.length).toBe(2);
      expect(res2.conflict.resolution.type).toBe("priority_yield");
    }

    expect(coord.getConflicts().length).toBe(1);
  });

  it("calculates cascading blast radius amplification", () => {
    const coordinator = new MultiAgentCoordinator();
    const sourceCall = makeCall("delete_workspace", { member_count: 10 });
    const sourceRisk = arc.classify(sourceCall);

    const targetCall = makeCall("issue_refund", { amount_usd: 500 });
    const targetRisk = arc.classify(targetCall);

    const cascade = coordinator.calculateCascadingBlastRadius(
      "agent-infra",
      "delete_workspace",
      sourceRisk,
      "agent-billing",
      targetRisk,
    );

    expect(cascade).not.toBeNull();
    expect(cascade?.adjustedBlastRadius).toBeGreaterThan(targetRisk.blastRadius);
    expect(coordinator.getCascadeEffects().length).toBe(1);
  });

  it("issues correlated rollbacks across multiple agents", () => {
    const coordinator = new MultiAgentCoordinator();
    const corrId = coordinator.generateCorrelationId();

    const call = makeCall("search_orders");
    const risk = arc.classify(call);

    const res = coordinator.claimResource("agent-1", "acme-corp", "order", "ord_1", call, risk);
    if ("claim" in res) {
      res.claim.correlationId = corrId;
    }

    const signal = coordinator.issueRollback(
      corrId,
      "agent-orchestrator",
      "Workflow stage 2 failed validation",
    );
    expect(signal.correlationId).toBe(corrId);
    expect(signal.reason).toContain("Workflow stage 2 failed");
    expect(coordinator.getRollbacks().length).toBe(1);
  });
});
