/**
 * Tenant-partitioned storage layer.
 *
 * Isolation is structural: callers never write a tenant filter by hand. They
 * obtain a `TenantNamespace` and can only ever see rows inside it, so a query
 * that "forgets the WHERE tenant_id" clause is not expressible.
 */
export class TenantScopedStore<T extends { tenantId: string }> {
  private partitions = new Map<string, Map<string, T>>();

  namespace(tenantId: string): TenantNamespace<T> {
    let part = this.partitions.get(tenantId);
    if (!part) {
      part = new Map();
      this.partitions.set(tenantId, part);
    }
    return new TenantNamespace(tenantId, part);
  }

  tenants(): string[] {
    return [...this.partitions.keys()];
  }
}

export class TenantNamespace<T extends { tenantId: string }> {
  constructor(
    readonly tenantId: string,
    private readonly rows: Map<string, T>,
  ) {}

  put(key: string, value: Omit<T, "tenantId"> & { tenantId?: string }): T {
    const row = { ...value, tenantId: this.tenantId } as T;
    this.rows.set(key, row);
    return row;
  }

  get(key: string): T | undefined {
    return this.rows.get(key);
  }

  delete(key: string): void {
    this.rows.delete(key);
  }

  list(): T[] {
    return [...this.rows.values()];
  }

  find(predicate: (row: T) => boolean): T[] {
    return this.list().filter(predicate);
  }
}

/** Per-tenant token bucket so one tenant cannot degrade another's posture. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly windowMs: number,
    private readonly max: number,
  ) {}

  allow(tenantId: string, now: number): boolean {
    const list = (this.hits.get(tenantId) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.max) {
      this.hits.set(tenantId, list);
      return false;
    }
    list.push(now);
    this.hits.set(tenantId, list);
    return true;
  }
}
