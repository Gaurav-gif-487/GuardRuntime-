import { describe, expect, it } from "vitest";
import { GuardRuntime } from "../runtime";
import { DEFAULT_POLICY } from "../policy";
import type { ToolCall } from "../types";

let chaosKey = 0;

const call = (overrides: Partial<ToolCall> = {}): ToolCall => ({
  tenantId: "tenant-alpha",
  idempotencyKey: `chaos-${++chaosKey}`,
  tool: "wire_transfer",
  args: { amount_usd: 5000 },
  goal: "transfer funds",
  principal: "agent",
  permissionScope: "finance:write",
  environment: "prod",
  ...overrides,
});

const testRuntime = (options: ConstructorParameters<typeof GuardRuntime>[0] = {}) =>
  new GuardRuntime({
    allowUnmanifestedPrincipals: true,
    ...options,
    executeTool: options.executeTool ?? ((args) => ({ ok: true, args })),
    compensatingActions: options.compensatingActions ?? {
      issue_refund: () => ({ ok: true, compensation: "reverse_refund" }),
      cancel_subscription: () => ({ ok: true, compensation: "reinstate_subscription" }),
    },
    verifyOutcome:
      options.verifyOutcome ?? (() => ({ ok: true, source: "verifier_pass" as const })),
  });

describe("GuardRuntime chaos / fail-safe integration", () => {
  it("fails closed for medium/high risk actions when the runtime is unavailable", async () => {
    const runtime = testRuntime();
    runtime.setHealthy(false);

    const result = await runtime.call(call());

    expect(result.status).toBe("blocked");
    expect((result as { reason?: string }).reason).toContain("failed closed");
    expect(runtime.metrics.get("fail_safe_activations_total")).toBe(1);
  });

  it("permits low-risk actions while unhealthy, because fail-open is explicit for the low-risk path", async () => {
    // Fail-open must be an explicit per-tool opt-in (never inferred just
    // from reversibility), so this test registers its own tool with
    // failOpen: true rather than relying on search_orders — which, by
    // convention elsewhere in this suite (see the "Fail-safe" describe
    // block in guardruntime.test.ts), is deliberately the *baseline*
    // example of a tool that does NOT opt into fail-open.
    const runtime = testRuntime({
      policy: { ...DEFAULT_POLICY },
    });
    runtime.registerTool({
      name: "read_orders_failopen",
      reversibility: "reversible",
      resourceType: "order",
      schemaVersion: "1.0.0",
      blastRadiusTier: 0.05,
      failOpen: true,
      schema: { type: "object", properties: { query: { type: "string", required: true } } },
    });
    runtime.setHealthy(false);

    const result = await runtime.call(
      call({
        idempotencyKey: "chaos-low-risk",
        tool: "read_orders_failopen",
        goal: "read orders",
        args: { query: "recent orders" },
        permissionScope: "orders:read",
      }),
    );

    expect(result.status).toBe("executed");
  });
});
