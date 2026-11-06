import { describe, it } from "vitest";
import assert from "node:assert";
import { PropertyFuzzer } from "../eval/property-fuzzer.ts";

describe("Gap 5: Property-Based Fuzzing Checks", () => {
  it("checks selected properties over 150 randomized tool call sequences", async () => {
    const fuzzer = new PropertyFuzzer(1337);
    const results = await fuzzer.verifyProperties(150);

    assert.strictEqual(results.length, 3);
    for (const res of results) {
      assert.strictEqual(
        res.violationsFound,
        0,
        `Property ${res.propertyId} (${res.propertyName}) failed with ${res.violationsFound} violations`,
      );
      assert.strictEqual(res.trialsRun, 150);
    }
  });
});
