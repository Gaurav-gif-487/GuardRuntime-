import { describe, it } from "vitest";
import assert from "node:assert";
import { SagaRollbackCoordinator } from "../saga-rollback.ts";

describe("Pillar 3: Automated Saga State Snapshot & Rollback Engine", () => {
  it("orchestrates strict reverse LIFO compensations across multi-step sagas", async () => {
    const executedRollbacks: string[] = [];
    const coordinator = new SagaRollbackCoordinator();

    coordinator.registerCompensation("void_payment", (args) => {
      executedRollbacks.push(`void_payment:${args["payment_id"]}`);
      return true;
    });

    coordinator.registerCompensation("revert_inventory", (args) => {
      executedRollbacks.push(`revert_inventory:${args["item_id"]}`);
      return true;
    });

    coordinator.registerCompensation("cancel_shipment", (args) => {
      executedRollbacks.push(`cancel_shipment:${args["tracking_id"]}`);
      return true;
    });

    // Step 1: Charge customer
    coordinator.recordStep("saga_1", "charge_payment", { amount: 100 }, "void_payment", {
      payment_id: "pay_99",
    });
    // Step 2: Reserve inventory
    coordinator.recordStep("saga_1", "reserve_inventory", { sku: "SKU_1" }, "revert_inventory", {
      item_id: "SKU_1",
    });
    // Step 3: Dispatch shipment
    coordinator.recordStep("saga_1", "dispatch_shipment", { carrier: "UPS" }, "cancel_shipment", {
      tracking_id: "TRK_88",
    });

    // Multi-step failure occurs at Step 4 -> Trigger automated Saga Rollback
    const report = await coordinator.rollbackSaga("saga_1");

    assert.strictEqual(report.totalSteps, 3);
    assert.strictEqual(report.compensatedSteps, 3);
    assert.strictEqual(report.failedCompensations, 0);

    // Verify strict reverse LIFO execution order: Step 3 -> Step 2 -> Step 1
    assert.deepStrictEqual(executedRollbacks, [
      "cancel_shipment:TRK_88",
      "revert_inventory:SKU_1",
      "void_payment:pay_99",
    ]);
  });

  it("handles expired compensation TTL windows gracefully during rollback", async () => {
    let mockTime = 1000000;
    const coordinator = new SagaRollbackCoordinator(undefined, () => mockTime);

    coordinator.registerCompensation("void_payment", () => true);

    // Record step with 10-minute TTL (600,000 ms)
    coordinator.recordStep(
      "saga_2",
      "charge_payment",
      { amount: 50 },
      "void_payment",
      { payment_id: "pay_10" },
      600000,
    );

    // Fast forward 45 minutes (2,700,000 ms)
    mockTime += 2700000;

    const report = await coordinator.rollbackSaga("saga_2");
    assert.strictEqual(report.expiredCompensations, 1);
    assert.strictEqual(report.compensatedSteps, 0);
    assert.ok(report.details[0]?.rationale.includes("expired"));
  });
});
