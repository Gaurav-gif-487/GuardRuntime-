import { describe, it, expect } from "vitest";
import { AuditLog } from "../audit";

describe("Merkle-PCR Tamper-Evident Audit Chain & Inclusion Proofs", () => {
  it("generates sequential chained entries with verifiable integrity", () => {
    const log = new AuditLog();
    const tenant = "tenant-merkle-test";

    for (let i = 1; i <= 5; i++) {
      log.append({
        tenantId: tenant,
        type: "authorization_decision",
        principal: `agent-${i}`,
        policyVersion: "1.0.0",
        payload: { action: `tool_${i}`, param: i * 10 },
        ts: Date.now() + i * 100,
      });
    }

    const verification = log.verify(tenant);
    expect(verification.ok).toBe(true);
    expect(log.entries(tenant).length).toBe(5);
  });

  it("computes monotonic PCR hash accumulation", () => {
    const log = new AuditLog();
    const tenant = "tenant-pcr-test";

    const pcr1 = log.computePcrDigest(tenant);

    log.append({
      tenantId: tenant,
      type: "tool_executed",
      principal: "agent-1",
      policyVersion: "1.0.0",
      payload: { step: 1 },
      ts: 1000,
    });

    const pcr2 = log.computePcrDigest(tenant);
    expect(pcr2).not.toBe(pcr1);
    expect(pcr2.length).toBe(64); // SHA-256 hex
  });

  it("generates valid cryptographic inclusion anchor", () => {
    const log = new AuditLog();
    const tenant = "tenant-anchor-test";

    for (let i = 0; i < 4; i++) {
      log.append({
        tenantId: tenant,
        type: "authorization_decision",
        principal: `agent-${i}`,
        policyVersion: "1.0.0",
        payload: { idx: i },
        ts: 1000 + i,
      });
    }

    const proof = log.generateInclusionProof(tenant, 2);
    expect(proof).not.toBeNull();
    expect(proof?.seq).toBe(2);
    expect(proof?.chainLength).toBe(4);
    expect(proof?.entryHash).toBe(log.entries(tenant)[2]?.hash);
  });

  it("detects tampering on modified historical audit blocks", () => {
    const log = new AuditLog();
    const tenant = "tenant-tamper-test";

    for (let i = 0; i < 3; i++) {
      log.append({
        tenantId: tenant,
        type: "authorization_decision",
        principal: `agent-${i}`,
        policyVersion: "1.0.0",
        payload: { idx: i },
        ts: 1000 + i,
      });
    }

    // Deliberately tamper with entry 1
    log.tamper(tenant, 1, (e) => {
      (e as { payload: Record<string, unknown> }).payload = { idx: 9999, hacked: true };
    });

    const verification = log.verify(tenant);
    expect(verification.ok).toBe(false);
    expect(verification.brokenAt).toBe(1);
  });
});
