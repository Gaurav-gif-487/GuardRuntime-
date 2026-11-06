import { describe, it, expect } from "vitest";
import { checkPolicyConsistency } from "../policy-algebra";
import { DEFAULT_POLICY, Policy } from "../policy";

describe("Static Policy Analysis & Consistency Engine", () => {
  it("identifies clean and consistent policies without false positives", () => {
    const report = checkPolicyConsistency(DEFAULT_POLICY, {
      thresholds: {
        destructive: 0.15,
        recoverable: 0.45,
        reversible: 0.75,
      },
    });

    expect(report.isConsistent).toBe(true);
    expect(report.contradictions.length).toBe(0);
    expect(report.monotonicityViolations.length).toBe(0);
  });

  it("detects threshold ordering contradiction (destructive > recoverable)", () => {
    const invalidOverlay: Partial<Policy> = {
      thresholds: {
        destructive: 0.85, // Higher than recoverable!
        recoverable: 0.4,
        reversible: 0.9,
      },
    };

    const report = checkPolicyConsistency(DEFAULT_POLICY, invalidOverlay);
    expect(report.isConsistent).toBe(false);
    expect(report.contradictions.length).toBeGreaterThan(0);
    expect(report.contradictions[0]?.field).toBe("thresholds");
  });

  it("detects rate-limit monotonicity expansions", () => {
    const relaxingOverlay: Partial<Policy> = {
      rateLimit: {
        max: 500, // 5x expansion
        windowMs: 10000, // shorter window
      },
    };

    const report = checkPolicyConsistency(DEFAULT_POLICY, relaxingOverlay);
    expect(report.isConsistent).toBe(false);
    expect(report.monotonicityViolations.length).toBeGreaterThan(0);
    expect(report.monotonicityViolations[0]).toContain("Rate limit expansion");
  });
});
