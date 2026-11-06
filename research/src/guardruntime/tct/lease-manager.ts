import { TenantScopedStore } from "../store";

export interface Lease {
  leaseId: string;
  resourceId: string;
  tenantId: string;
  holderAgentId: string;
  acquiredAt: number;
  expiresAt: number;
}

export class LeaseManager {
  private readonly leases = new TenantScopedStore<Lease>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  async acquireLease(
    tenantId: string,
    resourceId: string,
    agentId: string,
    ttlMs = 30_000,
  ): Promise<Lease | null> {
    if (ttlMs <= 0) throw new Error("lease ttl must be positive");
    const ns = this.leases.namespace(tenantId);
    const existing = ns.get(resourceId);
    const now = this.now();
    if (existing && existing.expiresAt > now) {
      if (existing.holderAgentId !== agentId) return null;
      const refreshed = { ...existing, expiresAt: now + ttlMs };
      ns.put(resourceId, refreshed);
      return refreshed;
    }
    const lease: Lease = {
      leaseId: crypto.randomUUID(),
      resourceId,
      tenantId,
      holderAgentId: agentId,
      acquiredAt: now,
      expiresAt: now + ttlMs,
    };
    ns.put(resourceId, lease);
    return lease;
  }

  async releaseLease(tenantId: string, leaseId: string, agentId: string): Promise<boolean> {
    const ns = this.leases.namespace(tenantId);
    for (const candidate of ns.list()) {
      if (candidate.leaseId === leaseId) {
        if (candidate.holderAgentId !== agentId)
          throw new Error(`[LeaseError] Agent '${agentId}' cannot release this lease.`);
        ns.delete(candidate.resourceId);
        return true;
      }
    }
    return false;
  }
}
