import { describe, it } from "vitest";
import assert from "node:assert";
import { LTLEvaluator, LTL, type TraceEvent } from "../ltl.ts";
import { TemporalSafetyMonitor, ENTERPRISE_TEMPORAL_RULES } from "../temporal-monitor.ts";

describe("Gap 3: Linear Temporal Logic (LTL) Safety Specifications", () => {
  it("evaluates ALWAYS (□) correctly", () => {
    const trace: TraceEvent[] = [
      {
        seq: 0,
        ts: 100,
        tool: "search_orders",
        principal: "agent:1",
        type: "tool_executed",
        payload: {},
      },
      {
        seq: 1,
        ts: 200,
        tool: "search_orders",
        principal: "agent:1",
        type: "tool_executed",
        payload: {},
      },
    ];

    const formula = LTL.always(LTL.toolIs("search_orders"));
    assert.strictEqual(LTLEvaluator.evaluate(formula, trace), true);

    const failFormula = LTL.always(LTL.toolIs("issue_refund"));
    assert.strictEqual(LTLEvaluator.evaluate(failFormula, trace), false);
  });

  it("evaluates EVENTUALLY (◇) correctly", () => {
    const trace: TraceEvent[] = [
      {
        seq: 0,
        ts: 100,
        tool: "search_orders",
        principal: "agent:1",
        type: "tool_executed",
        payload: {},
      },
      {
        seq: 1,
        ts: 200,
        tool: "issue_refund",
        principal: "agent:1",
        type: "tool_executed",
        payload: {},
      },
    ];

    const formula = LTL.eventually(LTL.toolIs("issue_refund"));
    assert.strictEqual(LTLEvaluator.evaluate(formula, trace), true);
  });

  it("evaluates PRECEDES correctly", () => {
    // Trace 1: Confirmation properly precedes execution
    const validTrace: TraceEvent[] = [
      {
        seq: 0,
        ts: 100,
        tool: "wire_transfer",
        principal: "system",
        type: "cm_transition",
        payload: { to: "approved" },
      },
      {
        seq: 1,
        ts: 200,
        tool: "wire_transfer",
        principal: "agent:1",
        type: "tool_executed",
        payload: { tool: "wire_transfer", reversibility: "destructive" },
      },
    ];

    const precedesFormula = LTL.precedes(
      LTL.and(LTL.typeIs("tool_executed"), LTL.toolIs("wire_transfer")),
      LTL.typeIs("cm_transition"),
    );

    assert.strictEqual(LTLEvaluator.evaluate(precedesFormula, validTrace), true);

    // Trace 2: Execution without prior confirmation -> violation
    const invalidTrace: TraceEvent[] = [
      {
        seq: 0,
        ts: 100,
        tool: "wire_transfer",
        principal: "agent:1",
        type: "tool_executed",
        payload: { tool: "wire_transfer", reversibility: "destructive" },
      },
    ];

    assert.strictEqual(LTLEvaluator.evaluate(precedesFormula, invalidTrace), false);
  });

  it("runs TemporalSafetyMonitor across audit entries", () => {
    const monitor = new TemporalSafetyMonitor();
    const cleanEntries = [
      {
        seq: 0,
        ts: 100,
        tenantId: "acme",
        type: "cm_transition" as const,
        principal: "user:approver",
        policyVersion: "1.0",
        payload: { tool: "wire_transfer", to: "approved" },
        prevHash: "0".repeat(64),
        hash: "a".repeat(64),
      },
      {
        seq: 1,
        ts: 200,
        tenantId: "acme",
        type: "tool_executed" as const,
        principal: "agent:1",
        policyVersion: "1.0",
        payload: { tool: "wire_transfer", reversibility: "destructive" },
        prevHash: "a".repeat(64),
        hash: "b".repeat(64),
      },
      {
        seq: 2,
        ts: 250,
        tenantId: "acme",
        type: "outcome_verified" as const,
        principal: "agent:1",
        policyVersion: "1.0",
        payload: { ok: true },
        prevHash: "b".repeat(64),
        hash: "c".repeat(64),
      },
    ];

    const report = monitor.verifyTrace(cleanEntries);
    assert.strictEqual(report.passed, true);
  });
});
