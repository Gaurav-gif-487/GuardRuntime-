import { describe, expect, it } from "vitest";
import { MerkleAnchorManager } from "../merkle-anchor";
import type { AuditEntry } from "../types";

const makeEntries = (count: number): AuditEntry[] => {
  const entries: AuditEntry[] = [];
  let prevHash = "0".repeat(64);
  for (let i = 0; i < count; i++) {
    const hash = `hash_${i}_${"f".repeat(50)}`;
    entries.push({
      seq: i,
      ts: 1000 + i,
      tenantId: "acme-corp",
      type: "tool_executed",
      principal: "agent:tester",
      policyVersion: "v3",
      payload: { step: i },
      prevHash,
      hash,
    });
    prevHash = hash;
  }
  return entries;
};

describe("MerkleAnchorManager", () => {
  it("builds consistent Merkle trees and calculates deterministic roots", () => {
    const manager = new MerkleAnchorManager();
    const entries = makeEntries(8);

    const tree1 = manager.buildTree(entries);
    const tree2 = manager.buildTree(entries);

    expect(tree1.root).toHaveLength(64);
    expect(tree1.root).toBe(tree2.root);
  });

  it("generates and verifies O(log N) Merkle Inclusion Proofs", () => {
    const manager = new MerkleAnchorManager();
    const entries = makeEntries(16);

    for (const targetIndex of [0, 5, 15]) {
      const proof = manager.generateProof(entries, targetIndex);
      const isValid = MerkleAnchorManager.verifyProof(proof);

      expect(isValid).toBe(true);
      expect(proof.leafIndex).toBe(targetIndex);
      expect(proof.auditPath.length).toBeLessThanOrEqual(5); // log2(16) = 4
    }
  });

  it("anchors periodic checkpoints with witness signatures", () => {
    const manager = new MerkleAnchorManager();
    const entries = makeEntries(10);

    const checkpoint = manager.anchorTenantLog("acme-corp", entries);
    expect(checkpoint.entryCount).toBe(10);
    expect(checkpoint.merkleRoot).toHaveLength(64);
    expect(checkpoint.witnessSignature).toBeDefined();

    const history = manager.getCheckpoints("acme-corp");
    expect(history.length).toBe(1);
  });
});
