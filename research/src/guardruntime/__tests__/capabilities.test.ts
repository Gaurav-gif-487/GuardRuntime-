import { describe, it } from "vitest";
import assert from "node:assert";
import { CapabilityGate, type CapabilityManifest } from "../capabilities.ts";
import type { ToolCall } from "../types.ts";

describe("Gap 2: Capability-Based Permission Model & Attenuation", () => {
  const supportManifest: CapabilityManifest = {
    principal: "agent:support-bot",
    tenantId: "acme-corp",
    allowedTools: ["search_orders", "issue_refund"],
    allowedResourceTypes: ["order", "payment"],
    maxPermittedBlastRadius: 0.4,
    maxPermittedSingleMagnitude: 500,
    allowSubDelegation: true,
  };

  it("authorizes tool calls within manifest allowances", () => {
    const gate = new CapabilityGate([supportManifest]);
    const call: ToolCall = {
      tenantId: "acme-corp",
      idempotencyKey: "cap_1",
      tool: "search_orders",
      args: { query: "orders" },
      goal: "find order",
      principal: "agent:support-bot",
      permissionScope: "support:read",
      environment: "prod",
    };

    const res = gate.check(call, "order", 0.05);
    assert.strictEqual(res.authorized, true);
  });

  it("blocks tools not present in manifest (wire_transfer)", () => {
    const gate = new CapabilityGate([supportManifest]);
    const call: ToolCall = {
      tenantId: "acme-corp",
      idempotencyKey: "cap_2",
      tool: "wire_transfer",
      args: { amount_usd: 100 },
      goal: "send wire",
      principal: "agent:support-bot",
      permissionScope: "support:read",
      environment: "prod",
    };

    const res = gate.check(call, "payment", 0.5);
    assert.strictEqual(res.authorized, false);
    assert.strictEqual(res.violationType, "tool_not_permitted");
  });

  it("blocks calls exceeding magnitude allowances ($5,000 > $500)", () => {
    const gate = new CapabilityGate([supportManifest]);
    const call: ToolCall = {
      tenantId: "acme-corp",
      idempotencyKey: "cap_3",
      tool: "issue_refund",
      args: { amount_usd: 5000 },
      goal: "large refund",
      principal: "agent:support-bot",
      permissionScope: "support:write",
      environment: "prod",
    };

    const res = gate.check(call, "payment", 0.3);
    assert.strictEqual(res.authorized, false);
    assert.strictEqual(res.violationType, "magnitude_exceeded");
  });

  it("enforces monotonic capability attenuation for delegated child agents", () => {
    const gate = new CapabilityGate([supportManifest]);

    // Parent creates child with read-only attenuation
    const child = gate.attenuate("acme-corp", "agent:support-bot", "agent:child-reader", {
      allowedTools: ["search_orders"],
      maxPermittedBlastRadius: 0.1,
    });

    assert.deepStrictEqual(child.allowedTools, ["search_orders"]);
    assert.strictEqual(child.maxPermittedBlastRadius, 0.1);
    assert.strictEqual(child.allowSubDelegation, false);

    // Child cannot call refund even though parent could
    const call: ToolCall = {
      tenantId: "acme-corp",
      idempotencyKey: "cap_4",
      tool: "issue_refund",
      args: { amount_usd: 10 },
      goal: "refund",
      principal: "agent:child-reader",
      permissionScope: "support:read",
      environment: "prod",
    };

    const res = gate.check(call, "payment", 0.1);
    assert.strictEqual(res.authorized, false);
    assert.strictEqual(res.violationType, "tool_not_permitted");
  });
});
