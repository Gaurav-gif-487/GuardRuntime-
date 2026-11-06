import { describe, expect, it } from "vitest";
import { TemporalReversibilityEngine } from "../temporal-reversibility";

describe("TemporalReversibilityEngine", () => {
  it("maintains recoverable status within the valid compensation window", () => {
    const mockTime = 1000000;
    const engine = new TemporalReversibilityEngine(undefined, () => mockTime);

    // Call executed 10 minutes ago (well within the 30-min refund void window)
    const executedAt = mockTime - 10 * 60 * 1000;
    const evaluation = engine.evaluateReversibility("issue_refund", executedAt);

    expect(evaluation.reversibility).toBe("recoverable");
    expect(evaluation.isDegraded).toBe(false);
    expect(evaluation.remainingValidityMs).toBe(20 * 60 * 1000);
  });

  it("dynamically downgrades recoverable action to destructive after window expires", () => {
    const mockTime = 1000000;
    const engine = new TemporalReversibilityEngine(undefined, () => mockTime);

    // Call executed 45 minutes ago (exceeding 30-min window)
    const executedAt = mockTime - 45 * 60 * 1000;
    const evaluation = engine.evaluateReversibility("issue_refund", executedAt);

    expect(evaluation.reversibility).toBe("destructive");
    expect(evaluation.isDegraded).toBe(true);
    expect(evaluation.remainingValidityMs).toBe(0);
    expect(evaluation.rationale).toContain("downgraded from recoverable to destructive");
  });
});
