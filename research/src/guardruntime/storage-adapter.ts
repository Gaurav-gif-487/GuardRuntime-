/**
 * Pluggable Storage Adapter Architecture.
 *
 * Decouples GuardRuntime from in-memory storage, allowing seamless swapping
 * between MemoryStorageAdapter (for local testing / single-node) and
 * persistent adapters (Postgres, Redis, DynamoDB) without changing any business logic.
 */

export interface StorageAdapter {
  get<T>(tenantId: string, collection: string, key: string): Promise<T | null>;
  put<T>(
    tenantId: string,
    collection: string,
    key: string,
    value: T,
    ttlMs?: number,
  ): Promise<void>;
  delete(tenantId: string, collection: string, key: string): Promise<boolean>;
  list<T>(tenantId: string, collection: string): Promise<T[]>;
  find<T>(tenantId: string, collection: string, predicate: (item: T) => boolean): Promise<T[]>;
  tenants(): Promise<string[]>;
}

export class MemoryStorageAdapter implements StorageAdapter {
  private data = new Map<string, Map<string, { value: unknown; expiresAt?: number | undefined }>>();

  private getCollection(tenantId: string, collection: string) {
    const rootKey = `${tenantId}:${collection}`;
    let col = this.data.get(rootKey);
    if (!col) {
      col = new Map();
      this.data.set(rootKey, col);
    }
    return col;
  }

  async get<T>(tenantId: string, collection: string, key: string): Promise<T | null> {
    const col = this.getCollection(tenantId, collection);
    const entry = col.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      col.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async put<T>(
    tenantId: string,
    collection: string,
    key: string,
    value: T,
    ttlMs?: number,
  ): Promise<void> {
    const col = this.getCollection(tenantId, collection);
    const expiresAt = ttlMs ? Date.now() + ttlMs : undefined;
    col.set(key, { value, expiresAt });
  }

  async delete(tenantId: string, collection: string, key: string): Promise<boolean> {
    const col = this.getCollection(tenantId, collection);
    return col.delete(key);
  }

  async list<T>(tenantId: string, collection: string): Promise<T[]> {
    const col = this.getCollection(tenantId, collection);
    const now = Date.now();
    const result: T[] = [];
    for (const [k, entry] of col.entries()) {
      if (entry.expiresAt && now > entry.expiresAt) {
        col.delete(k);
      } else {
        result.push(entry.value as T);
      }
    }
    return result;
  }

  async find<T>(
    tenantId: string,
    collection: string,
    predicate: (item: T) => boolean,
  ): Promise<T[]> {
    const all = await this.list<T>(tenantId, collection);
    return all.filter(predicate);
  }

  async tenants(): Promise<string[]> {
    const tenantSet = new Set<string>();
    for (const rootKey of this.data.keys()) {
      const [t] = rootKey.split(":");
      if (t) tenantSet.add(t);
    }
    return [...tenantSet];
  }
}
