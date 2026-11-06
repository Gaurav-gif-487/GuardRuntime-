import { describe, expect, it } from "vitest";
import { GuardRuntime } from "../runtime";
import {
  checkConfidenceMonotonicity,
  checkDestructiveAlwaysConfirms,
  checkTenantIsolation,
  checkHashChainIntegrity,
  checkIdempotency,
  checkFailClosedDefault,
  checkIndependentVerification,
  verifyAllInvariants,
} from "../invariants";
import type { ToolCall } from "../types";

let testKey = 0;
const baseCall = (over: Partial<ToolCall> = {}): ToolCall => ({
  tenantId: "acme-corp",
  idempotencyKey: `inv_${++testKey}`,
  tool: "search_orders",
  args: { query: "test" },
  goal: "test invariant execution",
  principal: "agent:inv-tester",
  permissionScope: "support:read",
  environment: "prod",
  ...over,
});

const testRuntime = (options: ConstructorParameters<typeof GuardRuntime>[0] = {}) =>
  new GuardRuntime({
    allowUnmanifestedPrincipals: true,
    ...options,
    executeTool: options.executeTool ?? ((args) => ({ ok: true, args })),
    compensatingActions: options.compensatingActions ?? {
      issue_refund: () => ({ ok: true }),
      cancel_subscription: () => ({ ok: true }),
    },
    verifyOutcome:
      options.verifyOutcome ?? (() => ({ ok: true, source: "verifier_pass" as const })),
  });

describe("Executable Safety Properties", () => {
  it("INV-1: Confidence Monotonicity — confidence signal can only escalate, never suppress", () => {
    const rt = testRuntime();
    const testCalls: ToolCall[] = [
      baseCall({ tool: "wire_transfer", args: { amount_usd: 100 } }),
      baseCall({ tool: "delete_workspace", args: { member_count: 50 } }),
      baseCall({ tool: "send_email", args: { recipients: 500 } }),
    ];

    const result = checkConfidenceMonotonicity((c) => rt.arc.classify(c), testCalls);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("INV-2: Destructive Always Confirms — destructive operations always require confirmation", () => {
    const rt = testRuntime();
    const testCalls: ToolCall[] = [
      baseCall({ tool: "wire_transfer", args: { amount_usd: 1 } }),
      baseCall({ tool: "send_email", args: { recipients: 1 } }),
      baseCall({ tool: "delete_workspace", args: { member_count: 1 } }),
      baseCall({ tool: "unknown_arbitrary_tool", args: {} }),
    ];

    const result = checkDestructiveAlwaysConfirms((c) => rt.arc.classify(c), testCalls);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("INV-3: Structural Tenant Isolation — cross-tenant leakage is impossible", async () => {
    const rt = testRuntime();
    await rt.call(baseCall({ tenantId: "tenant-A", goal: "order search for A" }));
    await rt.call(baseCall({ tenantId: "tenant-B", goal: "order search for B" }));

    const result = checkTenantIsolation(rt, ["tenant-A", "tenant-B"]);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("INV-4: Hash-Chain Integrity — tamper evidence verifies untampered log and catches tampering", async () => {
    const rt = testRuntime();
    await rt.call(baseCall({ tenantId: "tenant-audit", tool: "search_orders" }));
    await rt.call(baseCall({ tenantId: "tenant-audit", tool: "search_orders" }));

    const cleanResult = checkHashChainIntegrity(rt, ["tenant-audit"]);
    expect(cleanResult.passed).toBe(true);

    // Tamper with sequence 1 and check that checkHashChainIntegrity detects it
    rt.audit.tamper("tenant-audit", 1, (e) => {
      e.payload = { corrupted: true };
    });

    const tamperedResult = checkHashChainIntegrity(rt, ["tenant-audit"]);
    expect(tamperedResult.passed).toBe(false);
    expect(tamperedResult.violations.length).toBeGreaterThan(0);
  });

  it("INV-5: Idempotent Execution — retried key never re-executes", async () => {
    const rt = testRuntime();
    const call = baseCall({ tenantId: "tenant-idemp", idempotencyKey: "fixed_key_1" });

    const out1 = await rt.call(call);
    const out2 = await rt.call(call);

    expect(out1.status).toBe("executed");
    expect(out2.status).toBe("executed");

    const result = checkIdempotency(rt, "tenant-idemp");
    expect(result.passed).toBe(true);
  });

  it("INV-6: Fail-Closed Default — unhealthy runtime fails closed on non-low-risk tools", async () => {
    const rt = testRuntime();
    const tenantId = "tenant-failclosed";
    rt.setHealthy(false);

    const highRiskCall = baseCall({
      tenantId,
      tool: "wire_transfer",
      args: { amount_usd: 500 },
    });
    const outcome = await rt.call(highRiskCall);
    expect(outcome.status).toBe("blocked");

    const result = checkFailClosedDefault(rt, tenantId);
    expect(result.passed).toBe(true);
  });

  it("INV-7: Independent Verification — verifier pass only accepted from valid sources", async () => {
    const rt = testRuntime({
      verifyOutcome: () => ({ ok: true, source: "env_state_check" }),
    });
    const tenantId = "tenant-verify";
    await rt.call(baseCall({ tenantId, tool: "search_orders" }));

    const result = checkIndependentVerification(rt, tenantId);
    expect(result.passed).toBe(true);
  });

  it("verifyAllInvariants comprehensive runner evaluates all properties across tenants", async () => {
    const rt = testRuntime();
    await rt.call(baseCall({ tenantId: "t1", tool: "search_orders" }));
    await rt.call(baseCall({ tenantId: "t2", tool: "search_orders" }));

    const report = verifyAllInvariants({
      rt,
      tenantIds: ["t1", "t2"],
      testCalls: [baseCall({ tool: "wire_transfer", args: { amount_usd: 100 } })],
    });

    expect(report.allPassed).toBe(true);
    expect(report.summary.criticalViolations).toBe(0);
    expect(report.results.length).toBeGreaterThanOrEqual(6);
  });
});
