import type { Policy } from "./policy";
import { AuditLog } from "./audit";
import { TenantScopedStore } from "./store";

export interface StampedPolicyRecord {
  tenantId: string;
  version: string;
  config: Policy;
  createdAt: number;
  createdBy: string;
}

/** Tenant-scoped, versioned policy registry. The initial policy is persisted as
 * history so audits do not begin with an unexplained missing version. */
export class PolicyService {
  private readonly records = new TenantScopedStore<StampedPolicyRecord>();
  private readonly active = new Map<string, Policy>();

  constructor(
    private readonly auditLog: AuditLog,
    initialPolicy: Policy,
    private readonly clock: () => number = () => Date.now(),
  ) {
    this.active.set("system", initialPolicy);
    this.records.namespace("system").put(initialPolicy.version, {
      tenantId: "system",
      version: initialPolicy.version,
      config: initialPolicy,
      createdAt: this.clock(),
      createdBy: "bootstrap",
    });
  }

  getActivePolicy(tenantId = "system"): Policy {
    const policy = this.active.get(tenantId);
    if (!policy)
      throw new Error(`[PolicyServiceError] No policy registered for tenant '${tenantId}'.`);
    return policy;
  }

  async registerPolicyVersion(
    tenantId: string,
    newConfig: Policy,
    actorId: string,
  ): Promise<StampedPolicyRecord> {
    if (!tenantId || !actorId) throw new Error("tenantId and actorId are required");
    const current = this.getActivePolicy(tenantId);
    const history = this.records.namespace(tenantId);
    if (!newConfig.version || history.get(newConfig.version))
      throw new Error(
        `[PolicyServiceError] Policy version '${newConfig.version}' is already registered.`,
      );
    const now = this.clock();
    const record: StampedPolicyRecord = {
      tenantId,
      version: newConfig.version,
      config: newConfig,
      createdAt: now,
      createdBy: actorId,
    };
    history.put(newConfig.version, record);
    this.active.set(tenantId, newConfig);
    this.auditLog.append({
      tenantId,
      type: "policy_updated",
      principal: actorId,
      policyVersion: newConfig.version,
      ts: now,
      payload: { previousVersion: current.version, newVersion: newConfig.version },
    });
    return record;
  }

  getPolicyByVersion(tenantId: string, version: string): StampedPolicyRecord | null {
    return this.records.namespace(tenantId).get(version) ?? null;
  }
  getPolicyHistory(tenantId: string): StampedPolicyRecord[] {
    return this.records.namespace(tenantId).list();
  }
}
