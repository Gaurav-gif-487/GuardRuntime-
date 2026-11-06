import { describe, it, expect } from "vitest";
import {
  TransactionalShadowState,
  SpeculativeHypervisor,
  ShadowSandbox,
} from "../speculative-hypervisor";

describe("Isolated Sandboxed Execution & Transactional Shadow State", () => {
  it("executes tentatively in shadow sandbox without mutating committed state before commit", () => {
    const shadowState = new TransactionalShadowState({
      userBalance: 1000,
      systemActive: true,
    });

    const hypervisor = new SpeculativeHypervisor(shadowState);

    const res = hypervisor.speculateAndCommit(
      {
        tenantId: "tenant-test",
        idempotencyKey: "key-1",
        tool: "deduct_balance",
        args: { amount: 200 },
        goal: "deduct balance",
        principal: "agent-ops",
        permissionScope: "finance:deduct",
        environment: "staging",
      },
      (sb: ShadowSandbox, args: Record<string, unknown>) => {
        const bal = (sb.get("userBalance") as number) || 0;
        sb.set("userBalance", bal - ((args["amount"] as number) || 0));
        return { newBalance: bal - 200 };
      },
      (sb: ShadowSandbox) => {
        const bal = (sb.get("userBalance") as number) || 0;
        return { ok: bal >= 0 };
      },
    );

    expect(res.status).toBe("committed");
    expect(res.verified).toBe(true);
    expect(shadowState.get("userBalance")).toBe(800);
  });

  it("rejects execution and rolls back shadow delta when invariant post-check fails", () => {
    const shadowState = new TransactionalShadowState({
      userBalance: 100,
    });

    const hypervisor = new SpeculativeHypervisor(shadowState);

    const res = hypervisor.speculateAndCommit(
      {
        tenantId: "tenant-test",
        idempotencyKey: "key-2",
        tool: "overdraw_balance",
        args: { amount: 500 },
        goal: "overdraw balance",
        principal: "agent-ops",
        permissionScope: "finance:overdraw",
        environment: "staging",
      },
      (sb: ShadowSandbox) => {
        sb.set("userBalance", -400); // illegal negative balance
        return { attempted: -400 };
      },
      (sb: ShadowSandbox) => {
        const bal = (sb.get("userBalance") as number) || 0;
        return { ok: bal >= 0, reason: "Balance cannot be negative" };
      },
    );

    expect(res.status).toBe("escalated");
    expect(res.verified).toBe(false);
    expect(shadowState.get("userBalance")).toBe(100); // Committed state remained untouched
  });

  it("supports isolated sandboxing across multiple concurrent forked branches", () => {
    const shadowState = new TransactionalShadowState({ rootKey: "ORIGINAL" });

    const fork1 = shadowState.fork();
    const fork2 = shadowState.fork();

    fork1.set("rootKey", "FORK_1_MUTATED");
    fork2.set("rootKey", "FORK_2_MUTATED");

    expect(fork1.get("rootKey")).toBe("FORK_1_MUTATED");
    expect(fork2.get("rootKey")).toBe("FORK_2_MUTATED");
    expect(shadowState.get("rootKey")).toBe("ORIGINAL");

    // Commit fork1
    shadowState.commit(fork1);
    expect(shadowState.get("rootKey")).toBe("FORK_1_MUTATED");
  });
});
