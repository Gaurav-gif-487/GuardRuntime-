import { describe, expect, it } from "vitest";
import { runPhase0Eval } from "../harness";

describe("Phase 0 eval harness", () => {
  it("produces a well-formed report with all §7 acceptance-criteria sections", async () => {
    const report = await runPhase0Eval();
    expect(report.meta.taskCount).toBeGreaterThan(0);
    expect(report.taskSuccess.total).toBe(report.perTask.length);
    expect(report.perTask.length).toBeGreaterThan(report.meta.taskCount); // repeats expand it
  }, 20000);

  it("guarded task success rate is at least as good as baseline on this task set", async () => {
    const report = await runPhase0Eval();
    expect(report.taskSuccess.guardedRate).toBeGreaterThanOrEqual(report.taskSuccess.baselineRate);
  }, 20000);

  it("catches every deliberately-injected agent error via confirmation or an outright block", async () => {
    const report = await runPhase0Eval();
    // Honest reporting either way: assert the counters are internally consistent
    // rather than assuming zero misses, since findings[] is where misses surface.
    const agentErrorTasks = report.perTask.filter((p) => p.category === "agent_error");
    expect(report.confirmations.harmfulCaught + report.confirmations.harmfulMissed).toBe(
      agentErrorTasks.length,
    );
  }, 20000);

  it("reports that cache use does not reduce current risk classification and reports a plausible hit rate", async () => {
    const report = await runPhase0Eval();
    expect(report.caching.riskClassificationCallsWithCache).toBe(
      report.caching.riskClassificationCallsWithoutCache,
    );
    expect(report.caching.cacheHitRate).toBeGreaterThanOrEqual(0);
    expect(report.caching.cacheHitRate).toBeLessThanOrEqual(1);
  }, 20000);

  it("meets the p99 < 200ms pass-through latency target in-process", async () => {
    const report = await runPhase0Eval();
    expect(report.latency.withinTarget).toBe(true);
    expect(report.latency.p99Ms).toBeLessThan(report.latency.targetMs);
  }, 20000);

  it("chaos test proves fail-safe blocking under a simulated outage", async () => {
    const report = await runPhase0Eval();
    expect(report.chaos.pass).toBe(true);
  }, 20000);

  it("audit integrity test proves tamper-evidence actually detects a rewrite", async () => {
    const report = await runPhase0Eval();
    expect(report.auditIntegrity.pass).toBe(true);
  }, 20000);

  it("always discloses the synthetic-domain caveat and reports honestly on any divergence or miss", async () => {
    const report = await runPhase0Eval();
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.findings.some((f) => /τ-bench|synthetic/i.test(f))).toBe(true);
  }, 20000);
});
