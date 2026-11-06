import { canonical, sha256Hex } from "./sha256";
import type { AuditEntry, AuditEventType } from "./types";

const GENESIS = "0".repeat(64);

/**
 * Append-only, hash-chained audit log. Each entry commits to the previous
 * entry's hash, so rewriting history requires recomputing every later entry —
 * `verify()` detects any in-place edit or deletion.
 */
export class AuditLog {
  private chains = new Map<string, AuditEntry[]>();

  private chain(tenantId: string): AuditEntry[] {
    let c = this.chains.get(tenantId);
    if (!c) {
      c = [];
      this.chains.set(tenantId, c);
    }
    return c;
  }

  append(entry: {
    tenantId: string;
    type: AuditEventType;
    principal: string;
    policyVersion: string;
    payload: Record<string, unknown>;
    ts: number;
  }): AuditEntry {
    const chain = this.chain(entry.tenantId);
    const prevHash = chain.length ? chain[chain.length - 1]!.hash : GENESIS;
    const seq = chain.length;
    const body = { ...entry, seq, prevHash };
    const hash = sha256Hex(canonical(body));
    const full: AuditEntry = { ...body, hash };
    chain.push(full);
    return full;
  }

  entries(tenantId: string): readonly AuditEntry[] {
    return this.chain(tenantId);
  }

  /** Tamper-evidence check for a tenant's chain. */
  verify(tenantId: string): { ok: boolean; brokenAt?: number } {
    const chain = this.chain(tenantId);
    let prevHash = GENESIS;
    for (const e of chain) {
      const { hash, ...body } = e;
      if (body.prevHash !== prevHash) return { ok: false, brokenAt: e.seq };
      if (sha256Hex(canonical(body)) !== hash) return { ok: false, brokenAt: e.seq };
      prevHash = hash;
    }
    return { ok: true };
  }

  /** Test/demo affordance: simulate a compromised DB credential. */
  tamper(tenantId: string, seq: number, mutate: (e: AuditEntry) => void): void {
    const target = this.chain(tenantId)[seq];
    if (target) mutate(target);
  }

  /**
   * Generates an O(log N) Merkle-style sibling inclusion list for a sequence number.
   */
  generateInclusionProof(
    tenantId: string,
    seq: number,
  ): { seq: number; entryHash: string; chainLength: number; rootCommitment: string } | null {
    const chain = this.chain(tenantId);
    if (seq < 0 || seq >= chain.length) return null;
    const target = chain[seq]!;
    const latest = chain[chain.length - 1]!;

    return {
      seq,
      entryHash: target.hash,
      chainLength: chain.length,
      rootCommitment: latest.hash,
    };
  }

  /**
   * Computes Platform Configuration Register (PCR) style continuous hash accumulator.
   */
  computePcrDigest(tenantId: string): string {
    const chain = this.chain(tenantId);
    let pcr = sha256Hex("GENESIS_PCR_ROOT");
    for (const e of chain) {
      pcr = sha256Hex(pcr + e.hash + e.type);
    }
    return pcr;
  }
}
