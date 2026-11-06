type Account = { balance: number; active?: boolean };

import { describe, it } from "vitest";
import assert from "node:assert";
import { TransactionalShadowState, SpeculativeHypervisor } from "../speculative-hypervisor.ts";
import type { ToolCall } from "../types.ts";

describe("Pillar 2: Speculative Execution Hypervisor & CoW Sandbox", () => {
  it("executes valid state mutation speculatively and commits atomically to production", () => {
    const state = new TransactionalShadowState({
      "account:101": { balance: 1000, active: true },
      "account:102": { balance: 500, active: true },
    });

    const hypervisor = new SpeculativeHypervisor(state);

    const call: ToolCall = {
      tenantId: "bank-1",
      idempotencyKey: "spec_1",
      tool: "transfer_balance",
      args: { from: "account:101", to: "account:102", amount: 200 },
      goal: "transfer money",
      principal: "agent:teller",
      permissionScope: "finance",
      environment: "prod",
    };

    const res = hypervisor.speculateAndCommit(
      call,
      (sandbox, args) => {
        const fromAcc = sandbox.get(String(args["from"])) as Account;
        const toAcc = sandbox.get(String(args["to"])) as Account;
        sandbox.set(String(args["from"]), {
          ...fromAcc,
          balance: fromAcc.balance - Number(args["amount"]),
        });
        sandbox.set(String(args["to"]), {
          ...toAcc,
          balance: toAcc.balance + Number(args["amount"]),
        });
        return { success: true };
      },
      (sandbox, args) => {
        // Invariant: Balance must never be negative
        const fromAcc = sandbox.get(String(args["from"])) as Account;
        return { ok: fromAcc.balance >= 0, reason: "Negative balance prohibited" };
      },
    );

    assert.strictEqual(res.status, "committed");
    assert.strictEqual(res.verified, true);

    // Verify production state was atomically updated
    const committedFrom = state.get("account:101") as Account;
    const committedTo = state.get("account:102") as Account;
    assert.strictEqual(committedFrom.balance, 800);
    assert.strictEqual(committedTo.balance, 700);
  });

  it("discards shadow state without mutating production when the supplied invariant check fails", () => {
    const state = new TransactionalShadowState({
      "account:201": { balance: 100, active: true },
    });

    const hypervisor = new SpeculativeHypervisor(state);

    const call: ToolCall = {
      tenantId: "bank-1",
      idempotencyKey: "spec_2",
      tool: "transfer_balance",
      args: { from: "account:201", amount: 500 }, // Overdraft $400!
      goal: "overdraft transfer",
      principal: "agent:rogue",
      permissionScope: "finance",
      environment: "prod",
    };

    const res = hypervisor.speculateAndCommit(
      call,
      (sandbox, args) => {
        const acc = sandbox.get(String(args["from"])) as Account;
        sandbox.set(String(args["from"]), {
          ...acc,
          balance: acc.balance - Number(args["amount"]),
        });
        return { success: true };
      },
      (sandbox, args) => {
        const acc = sandbox.get(String(args["from"])) as Account;
        return { ok: acc.balance >= 0, reason: "Account balance cannot drop below zero" };
      },
    );

    assert.strictEqual(res.status, "escalated");
    assert.strictEqual(res.verified, false);
    assert.ok(res.rationale.includes("Account balance cannot drop below zero"));

    // Verify production state remained untouched
    const committed = state.get("account:201") as Account;
    assert.strictEqual(committed.balance, 100);
  });
});
