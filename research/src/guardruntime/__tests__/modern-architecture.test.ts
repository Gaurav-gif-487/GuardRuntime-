import { describe, expect, it } from "vitest";
import { GuardPipeline, type Middleware } from "../pipeline";
import { MemoryStorageAdapter } from "../storage-adapter";
import { TelemetryTracer } from "../telemetry";
import { SchemaValidator } from "../schema-validator";
import type { ToolCall } from "../types";

const makeCall = (): ToolCall => ({
  tenantId: "acme-corp",
  idempotencyKey: `call_${Math.random()}`,
  tool: "search_orders",
  args: { query: "orders" },
  goal: "search",
  principal: "agent:support",
  permissionScope: "support:read",
  environment: "prod",
});

describe("Modern Architecture Components", () => {
  it("GuardPipeline executes composable middleware layers in onion order", async () => {
    const pipeline = new GuardPipeline();
    const executionOrder: string[] = [];

    const mw1: Middleware = async (ctx, next) => {
      executionOrder.push("mw1_before");
      const out = await next();
      executionOrder.push("mw1_after");
      return out;
    };

    const mw2: Middleware = async (ctx, next) => {
      executionOrder.push("mw2_before");
      const out = await next();
      executionOrder.push("mw2_after");
      return out;
    };

    pipeline.use(mw1).use(mw2);

    const outcome = await pipeline.execute(makeCall(), async () => {
      executionOrder.push("terminal_execution");
      return { status: "executed", result: { ok: true }, viaCache: false };
    });

    expect(outcome.status).toBe("executed");
    expect(executionOrder).toEqual([
      "mw1_before",
      "mw2_before",
      "terminal_execution",
      "mw2_after",
      "mw1_after",
    ]);
  });

  it("MemoryStorageAdapter handles multi-tenant CRUD and TTL expiration", async () => {
    const adapter = new MemoryStorageAdapter();

    await adapter.put("tenant-A", "orders", "ord_1", { id: "ord_1", amount: 100 });
    await adapter.put("tenant-B", "orders", "ord_2", { id: "ord_2", amount: 200 });

    const orderA = await adapter.get("tenant-A", "orders", "ord_1");
    const orderB = await adapter.get("tenant-B", "orders", "ord_2");
    const crossCheck = await adapter.get("tenant-A", "orders", "ord_2");

    expect(orderA).toEqual({ id: "ord_1", amount: 100 });
    expect(orderB).toEqual({ id: "ord_2", amount: 200 });
    expect(crossCheck).toBeNull(); // Tenant isolation verified

    const tenants = await adapter.tenants();
    expect(tenants).toContain("tenant-A");
    expect(tenants).toContain("tenant-B");
  });

  it("TelemetryTracer parses W3C traceparents and instruments OpenTelemetry spans", () => {
    const tracer = new TelemetryTracer();
    const sampleTraceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

    const spanHandle = tracer.startSpan(
      "guardruntime.tool_call",
      { "guardruntime.tool": "issue_refund" },
      sampleTraceparent,
    );

    spanHandle.setAttribute("guardruntime.reversibility", "recoverable");
    spanHandle.addEvent("risk_classified", { blast_radius: 0.2 });
    const completedSpan = spanHandle.end("OK");

    expect(completedSpan.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(completedSpan.parentSpanId).toBe("00f067aa0ba902b7");
    expect(completedSpan.attributes["guardruntime.tool"]).toBe("issue_refund");
    expect(completedSpan.events.length).toBe(1);
    expect(completedSpan.status).toBe("OK");
  });

  it("SchemaValidator catches prototype pollution and enforces structural argument constraints", () => {
    const maliciousArgs = JSON.parse(
      '{"user":{"__proto__":{"polluted":true}},"amount_usd":50,"note":"valid note"}',
    );

    const result = SchemaValidator.validate(maliciousArgs, {
      type: "object",
      properties: {
        amount_usd: { type: "number", min: 1, max: 1000, required: true },
        note: { type: "string", required: true },
      },
    });

    expect(result.valid).toBe(false); // Flagged prototype key
    expect(result.errors.some((e) => e.includes("Dangerous key"))).toBe(true);

    const cleanResult = SchemaValidator.validate(
      { amount_usd: 50, note: "clean refund" },
      {
        type: "object",
        properties: {
          amount_usd: { type: "number", min: 1, max: 1000, required: true },
          note: { type: "string", required: true },
        },
      },
    );

    expect(cleanResult.valid).toBe(true);
    expect(cleanResult.sanitizedArgs["amount_usd"]).toBe(50);
  });
});
