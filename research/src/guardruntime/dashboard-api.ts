import { AuditLog } from "./audit";
import { Metrics } from "./metrics";
import { PolicyService } from "./policy-service";

export interface QueryAuditLogsRequest {
  tenantId: string;
  limit?: number;
  offset?: number;
}

export class DashboardApiRouter {
  constructor(
    private readonly metrics: Metrics,
    private readonly auditLog: AuditLog,
    private readonly policyService: PolicyService,
  ) {}

  handlePrometheusMetrics(): string {
    return this.metrics.export();
  }

  handleGetTelemetry(tenantId: string) {
    return {
      tenantId,
      timestamp: Date.now(),
      activePolicyVersion: this.policyService.getActivePolicy(tenantId).version,
      metrics: this.metrics.snapshot({ tenant: tenantId }),
    };
  }

  handleGetAuditLogs(query: QueryAuditLogsRequest) {
    const limit = Math.max(0, Math.min(query.limit ?? 50, 500));
    const offset = Math.max(0, query.offset ?? 0);
    const all = this.auditLog.entries(query.tenantId);
    const logs = all.slice(offset, offset + limit);
    return {
      tenantId: query.tenantId,
      integrityVerified: this.auditLog.verify(query.tenantId).ok,
      count: logs.length,
      offset,
      logs,
    };
  }

  handleGetPolicies(tenantId = "system") {
    const active = this.policyService.getActivePolicy(tenantId);
    return {
      tenantId,
      activeVersion: active.version,
      activeConfig: active,
      history: this.policyService.getPolicyHistory(tenantId),
    };
  }
}
