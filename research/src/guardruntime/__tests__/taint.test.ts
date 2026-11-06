import { describe, it } from "vitest";
import assert from "node:assert";
import { TaintTracker, DEFAULT_FLOW_POLICY } from "../taint.ts";

describe("Gap 1: Information Flow Control & Taint Tracking", () => {
  it("allows clean single-step operations without taint violations", () => {
    const tracker = new TaintTracker();
    const violations = tracker.checkFlow("session_1", "search_orders");
    assert.strictEqual(violations.length, 0);

    // Record execution produces PII + FINANCIAL
    tracker.recordExecution("session_1", "search_orders");
    const taints = tracker.getSessionTaints("session_1");
    assert.strictEqual(taints.has("PII"), true);
    assert.strictEqual(taints.has("FINANCIAL"), true);
  });

  it("detects cross-tool exfiltration flow (search_orders -> send_email)", () => {
    const tracker = new TaintTracker();
    tracker.recordExecution("session_2", "search_orders");

    // Attempt to invoke send_email (external_communication capability)
    const violations = tracker.checkFlow("session_2", "send_email");
    assert.strictEqual(violations.length > 0, true);

    const piiViolation = violations.find((v) => v.taintLabel === "PII");
    assert.ok(piiViolation);
    assert.strictEqual(piiViolation!.sourceTool, "search_orders");
    assert.strictEqual(piiViolation!.sinkTool, "send_email");
    assert.strictEqual(piiViolation!.blockedCapability, "external_communication");
    assert.strictEqual(piiViolation!.severity, "block");
  });

  it("isolates taints across different sessions", () => {
    const tracker = new TaintTracker();
    tracker.recordExecution("session_a", "search_orders");

    // Session B is clean
    const violationsB = tracker.checkFlow("session_b", "send_email");
    assert.strictEqual(violationsB.length, 0);

    // Session A is tainted
    const violationsA = tracker.checkFlow("session_a", "send_email");
    assert.strictEqual(violationsA.length > 0, true);
  });

  it("calculates max sensitivity correctly", () => {
    const tracker = new TaintTracker();
    assert.strictEqual(tracker.getMaxSensitivity("session_clean"), 0);

    tracker.recordExecution("session_dirty", "search_orders");
    // PII (2), FINANCIAL (3) -> max is 3
    assert.strictEqual(tracker.getMaxSensitivity("session_dirty"), 3);
  });
  it("documents the self-taint boundary: repeated self-calls do not act as a rate limiter", () => {
    const tracker = new TaintTracker(DEFAULT_FLOW_POLICY, {
      selfSink: {
        toolName: "selfSink",
        outputTaints: ["PII"],
        capabilities: ["external_communication"],
      },
    });

    tracker.recordExecution("self", "selfSink");
    const firstRepeat = tracker.checkFlow("self", "selfSink");
    tracker.recordExecution("self", "selfSink");
    const secondRepeat = tracker.checkFlow("self", "selfSink");

    assert.strictEqual(firstRepeat.length, 0);
    assert.strictEqual(secondRepeat.length, 0);
  });

  it("does not let self-exclusion erase taint produced by another tool", () => {
    const tracker = new TaintTracker(DEFAULT_FLOW_POLICY, {
      selfSink: {
        toolName: "selfSink",
        outputTaints: ["PUBLIC"],
        capabilities: ["external_communication"],
      },
      piiSource: {
        toolName: "piiSource",
        outputTaints: ["PII"],
        capabilities: ["read_internal"],
      },
    });

    tracker.recordExecution("mixed", "selfSink");
    tracker.recordExecution("mixed", "piiSource");
    const violations = tracker.checkFlow("mixed", "selfSink");

    assert.ok(violations.some((v) => v.taintLabel === "PII" && v.sourceTool === "piiSource"));
  });
  it("supports strict self-taint mode when a tool must never consume its own sensitive output", () => {
    const tracker = new TaintTracker(
      DEFAULT_FLOW_POLICY,
      {
        selfSink: {
          toolName: "selfSink",
          outputTaints: ["PII"],
          capabilities: ["external_communication"],
        },
      },
      () => 0,
      true,
    );

    tracker.recordExecution("strict", "selfSink");
    const violations = tracker.checkFlow("strict", "selfSink");
    assert.ok(violations.some((v) => v.taintLabel === "PII"));
  });
});
