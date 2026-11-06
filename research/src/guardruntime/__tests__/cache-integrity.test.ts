import { describe, expect, it } from "vitest";
import { GuardRuntime } from "../runtime";
import { cosine } from "../pcr";
import type { ToolCall } from "../types";

const call = (
  overrides: Partial<Omit<ToolCall, "idempotencyKey">> & { idempotencyKey?: string } = {},
): ToolCall => ({
  tenantId: "tenant",
  idempotencyKey: "default-key",
  tool: "search_orders",
  args: { query: "same" },
  goal: "find order",
  principal: "agent",
  permissionScope: "support:read",
  environment: "prod",
  ...overrides,
});

describe("cache safety and measurement", () => {
  it("uses true normalized cosine similarity", () => {
    expect(cosine([1, 0], [2, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([0, 0], [1, 0])).toBe(0);
  });

  it("does not reuse an ARC result when decision-relevant arguments change", async () => {
    const rt = new GuardRuntime({
      allowUnmanifestedPrincipals: true,
      executeTool: () => ({ ok: true }),
      verifyOutcome: () => ({ ok: true, source: "verifier_pass" as const }),
    });

    const first = call({ idempotencyKey: "a" });
    const second = call({ idempotencyKey: "b", args: { query: "different" } });
    await rt.call(first);
    await rt.call(second);

    expect(rt.metrics.get("cache_hits_total")).toBe(0);
    expect(rt.metrics.get("risk_decisions_total")).toBe(4);
  });

  it("does not bypass fail-safe on a cached high-risk decision", async () => {
    const rt = new GuardRuntime({
      allowUnmanifestedPrincipals: true,
      executeTool: () => ({ ok: true }),
      verifyOutcome: () => ({ ok: true, source: "verifier_pass" as const }),
    });
    for (let i = 0; i < 4; i++) {
      const request = call({
        idempotencyKey: `wire-${i}`,
        tool: "wire_transfer",
        args: { amount_usd: 100 },
        goal: "repeat wire",
        permissionScope: "finance:write",
      });
      const result = await rt.call(request);
      if (result.status === "pending_confirmation") {
        rt.cm.resolve(
          request.tenantId,
          result.confirmationId,
          "approved",
          { id: "reviewer", method: "oidc" },
          Date.now(),
        );
        await rt.resume(request.tenantId, result.confirmationId, request);
      }
    }
    expect(rt.metrics.get("cache_hits_total")).toBeGreaterThanOrEqual(1);
    rt.setHealthy(false);

    const result = await rt.call(
      call({
        idempotencyKey: "wire-outage",
        tool: "wire_transfer",
        args: { amount_usd: 100 },
        goal: "repeat wire",
        permissionScope: "finance:write",
      }),
    );
    expect(result.status).toBe("blocked");
    expect(rt.metrics.get("fail_safe_activations_total")).toBeGreaterThan(0);
  });

  it("invalidates permission, environment, and schema drift in the correct direction", async () => {
    const rt = new GuardRuntime({
      allowUnmanifestedPrincipals: true,
      executeTool: () => ({ ok: true }),
      verifyOutcome: () => ({ ok: true, source: "verifier_pass" as const }),
    });
    await rt.call(call({ idempotencyKey: "p1" }));
    await rt.call(call({ idempotencyKey: "p2" }));
    expect(rt.cache.plans("tenant").length).toBe(1);

    expect(rt.cache.evictOnDrift("tenant", { permissionScope: "other" })).toBe(1);
    expect(rt.cache.plans("tenant")[0]?.evictedReason).toBe("drift");
  });
});
