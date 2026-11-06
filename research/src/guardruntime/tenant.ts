import { TenantScopedStore, type TenantNamespace } from "./store";

export interface TenantContext {
  tenantId: string;
  environment: "prod" | "staging" | "dev";
  permissionScopes: string[];
}

/** Provides structural access to a tenant namespace. The caller never receives
 * an unscoped store, so cross-tenant reads are not expressible through this API. */
export class TenantIsolationGuard {
  constructor(private readonly store: TenantScopedStore<{ tenantId: string }>) {}

  assertContextAccess(context: TenantContext, targetTenantId: string): void {
    if (!context.tenantId || context.tenantId !== targetTenantId) {
      throw new Error(
        `[TenantIsolationError] tenant '${context.tenantId}' cannot access '${targetTenantId}'`,
      );
    }
  }

  namespace<T extends { tenantId: string }>(context: TenantContext): TenantNamespace<T> {
    if (!context.tenantId) throw new Error("tenantId is required");
    return this.store.namespace(context.tenantId) as TenantNamespace<T>;
  }

  buildScopedQueryKey(context: TenantContext, key: string): string {
    this.assertContextAccess(context, context.tenantId);
    return `${context.tenantId}:${context.environment}:${key}`;
  }
}
