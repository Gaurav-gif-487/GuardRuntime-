import { describe, it, expect } from "vitest";
import { SecurityLattice, TaintTracker, DEFAULT_FLOW_POLICY } from "../taint";

describe("Taint Level Hierarchy & Sink Ceiling Enforcement", () => {
  it("strictly respects the total order leq", () => {
    expect(SecurityLattice.leq("PUBLIC", "PUBLIC")).toBe(true);
    expect(SecurityLattice.leq("PUBLIC", "INTERNAL")).toBe(true);
    expect(SecurityLattice.leq("INTERNAL", "PII")).toBe(true);
    expect(SecurityLattice.leq("PII", "FINANCIAL")).toBe(true);
    expect(SecurityLattice.leq("FINANCIAL", "PHI")).toBe(true);
    expect(SecurityLattice.leq("PHI", "CREDENTIALS")).toBe(true);

    // Negative cases
    expect(SecurityLattice.leq("CREDENTIALS", "PUBLIC")).toBe(false);
    expect(SecurityLattice.leq("FINANCIAL", "INTERNAL")).toBe(false);
  });

  it("correctly computes least upper bound (join)", () => {
    expect(SecurityLattice.join("PUBLIC", "INTERNAL")).toBe("INTERNAL");
    expect(SecurityLattice.join("INTERNAL", "PII")).toBe("PII");
    expect(SecurityLattice.join("PII", "CREDENTIALS")).toBe("CREDENTIALS");
    expect(SecurityLattice.join("FINANCIAL", "INTERNAL")).toBe("FINANCIAL");
  });

  it("correctly computes greatest lower bound (meet)", () => {
    expect(SecurityLattice.meet("PUBLIC", "CREDENTIALS")).toBe("PUBLIC");
    expect(SecurityLattice.meet("FINANCIAL", "PII")).toBe("PII");
    expect(SecurityLattice.meet("PHI", "CREDENTIALS")).toBe("PHI");
  });

  it("accumulates taint level monotonically over multiple inputs", () => {
    const level = SecurityLattice.computeAccumulatedLevel(["PUBLIC", "INTERNAL", "PII"]);
    expect(level).toBe("PII");

    const highLevel = SecurityLattice.computeAccumulatedLevel([
      "PUBLIC",
      "CREDENTIALS",
      "INTERNAL",
    ]);
    expect(highLevel).toBe("CREDENTIALS");
  });

  it("enforces non-interference against restricted sink ceilings", () => {
    // Flow without sanitizer
    expect(SecurityLattice.assertNonInterference("PUBLIC", "PUBLIC")).toBe(true);
    expect(SecurityLattice.assertNonInterference("PII", "PUBLIC")).toBe(false);
    expect(SecurityLattice.assertNonInterference("CREDENTIALS", "INTERNAL")).toBe(false);

    // Flow with sanitizer
    expect(SecurityLattice.assertNonInterference("PII", "PUBLIC", true)).toBe(true);
    expect(SecurityLattice.assertNonInterference("CREDENTIALS", "INTERNAL", true)).toBe(true);
  });

  it("tracks multi-turn flow violation in TaintTracker", () => {
    const tracker = new TaintTracker(DEFAULT_FLOW_POLICY);
    const session = "session-lattice-test";

    // Agent executes tool that outputs PII
    tracker.recordExecution(session, "search_orders");

    // Check flow to external communication sink
    const violations = tracker.checkFlow(session, "send_email");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.taintLabel).toBe("PII");
    expect(violations[0]?.blockedCapability).toBe("external_communication");
  });
});
