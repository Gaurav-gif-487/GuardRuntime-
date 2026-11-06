import { describe, it } from "vitest";
import assert from "node:assert";
import { ProbabilisticMDPAssurance } from "../mdp-assurance.ts";

describe("Gap 6: Dynamic Probabilistic Assurance (DPA) via Online MDP", () => {
  it("maintains low failure probability during routine safe read operations", () => {
    const dpa = new ProbabilisticMDPAssurance(3, 0.65);

    // Feed 10 safe read transitions
    for (let i = 0; i < 10; i++) {
      const rep = dpa.observeTransition("agent:reader", "READ_SAFE");
      assert.strictEqual(rep.anomalyDetected, false);
      assert.ok(rep.kStepFailureProbability < 0.65);
    }
  });

  it("dynamically increases failure probability when escalating toward destructive states", () => {
    const dpa = new ProbabilisticMDPAssurance(3, 0.5);

    // Agent transitions repeatedly from High Recoverable into Destructive
    for (let i = 0; i < 5; i++) {
      dpa.observeTransition("agent:risky", "RECOVERABLE_HIGH");
      dpa.observeTransition("agent:risky", "DESTRUCTIVE_GATED");
    }

    // Next time it enters RECOVERABLE_HIGH, failure prob within 3 steps is high
    const report = dpa.observeTransition("agent:risky", "RECOVERABLE_HIGH");
    assert.strictEqual(report.anomalyDetected, true);
    assert.ok(report.kStepFailureProbability > 0.5);
  });
});
