import type { Policy } from "./policy";
import { TenantScopedStore } from "./store";
import type { CachedPlan, Environment, ToolCall } from "./types";

export interface EmbeddingProvider {
  embed(text: string): number[];
}

export function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = Number(a[i]);
    const bv = Number(b[i]);
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}

export interface ExecutionPlanCache {
  setPolicy(policy: Policy): void;
  lookup(
    call: ToolCall,
    scope: { resourceType: string; schemaVersion: string; tool?: string },
    now: number,
    planFingerprint?: string,
  ): LookupResult;
  record(
    call: ToolCall,
    scope: { resourceType: string; schemaVersion: string; tool?: string },
    steps: string[],
    now: number,
    planFingerprint: string,
  ): CachedPlan;
  recordOutcome(
    tenantId: string,
    planId: string,
    verification: { source: "env_state_check" | "user_feedback" | "verifier_pass"; ok: boolean },
    now: number,
  ): CachedPlan | undefined;
  evictOnDrift(
    tenantId: string,
    drift: { permissionScope?: string; schemaVersion?: string; environment?: Environment },
  ): number;
  prune(tenantId: string, now: number): number;
  plans(tenantId: string): CachedPlan[];
  tenants(): string[];
}

export interface LookupResult {
  plan?: CachedPlan;
  similarity: number;
  reason:
    | "hit"
    | "no_scoped_candidates"
    | "below_similarity"
    | "cold_start_floor"
    | "reliability_floor"
    | "expired";
}

/**
 * Plan Cache with Reliability metrics.
 *
 * Hard scoping first (tenant / permission scope / resource type / environment /
 * schema version); embedding similarity only ever runs *within* that filtered
 * set. Similarity alone can never authorise reuse across a scoping boundary.
 */
export class PlanCache {
  private store = new TenantScopedStore<CachedPlan>();
  private counter = 0;

  constructor(
    private policy: Policy,
    private readonly embedder?: EmbeddingProvider,
  ) {}

  setPolicy(policy: Policy): void {
    this.policy = policy;
  }

  getPolicy(): Policy {
    return this.policy;
  }

  private scopeKey(p: {
    tool?: string;
    permissionScope: string;
    resourceType: string;
    environment: Environment;
    schemaVersion: string;
  }): string {
    return [p.tool ?? "", p.permissionScope, p.resourceType, p.environment, p.schemaVersion].join(
      "|",
    );
  }

  lookup(
    call: ToolCall,
    scope: { resourceType: string; schemaVersion: string; tool?: string },
    now: number,
    planFingerprint?: string,
  ): LookupResult {
    if (this.policy.cacheEnabled === false) return { similarity: 0, reason: "below_similarity" };
    const key = this.scopeKey({
      tool: call.tool,
      permissionScope: call.permissionScope,
      resourceType: scope.resourceType,
      environment: call.environment,
      schemaVersion: scope.schemaVersion,
    });

    const candidates = this.store
      .namespace(call.tenantId)
      .find(
        (p) =>
          this.scopeKey(p) === key &&
          p.tool === (scope.tool ?? call.tool) &&
          !p.evictedReason &&
          (!planFingerprint || p.planFingerprint === planFingerprint),
      );

    if (!candidates.length) return { similarity: 0, reason: "no_scoped_candidates" };

    let best: CachedPlan | undefined;
    let bestSim = 0;
    if (this.embedder) {
      const q = this.embedder.embed(call.goal);
      for (const c of candidates) {
        const sim = cosine(q, c.embedding);
        if (sim > bestSim) {
          bestSim = sim;
          best = c;
        }
      }
      if (!best || bestSim < this.policy.similarityThreshold)
        return { similarity: bestSim, reason: "below_similarity" };
    } else {
      best = candidates.find((c) => c.goal === call.goal);
      bestSim = best ? 1 : 0;
      if (!best) return { similarity: 0, reason: "below_similarity" };
    }

    if (now - best.lastUsedAt > this.policy.planTtlMs) {
      this.evict(call.tenantId, best.id, "ttl_expired");
      return { similarity: bestSim, reason: "expired" };
    }
    if (best.executions < this.policy.coldStartFloor)
      return { plan: best, similarity: bestSim, reason: "cold_start_floor" };
    if (best.reliability < this.policy.reliabilityFloor) {
      this.evict(call.tenantId, best.id, "reliability_below_floor");
      return { similarity: bestSim, reason: "reliability_floor" };
    }

    return { plan: best, similarity: bestSim, reason: "hit" };
  }

  record(
    call: ToolCall,
    scope: { resourceType: string; schemaVersion: string; tool?: string },
    steps: string[],
    now: number,
    planFingerprint: string,
  ): CachedPlan {
    const existing = this.lookup(call, scope, now, planFingerprint);
    if (existing.plan) return existing.plan;
    const id = `plan_${++this.counter}`;
    return this.store.namespace(call.tenantId).put(id, {
      id,
      tool: call.tool,
      permissionScope: call.permissionScope,
      resourceType: scope.resourceType,
      environment: call.environment,
      schemaVersion: scope.schemaVersion,
      goal: call.goal,
      embedding: this.embedder ? this.embedder.embed(call.goal) : [],
      steps,
      executions: 0,
      verifiedSuccesses: 0,
      consecutiveDegradations: 0,
      reliability: 0,
      lastUsedAt: now,
      executionPlan: {
        id,
        tool: call.tool,
        scopeFingerprint: planFingerprint,
        steps: [...steps],
        createdAt: now,
        expiresAt: now + this.policy.planTtlMs,
      },
      planFingerprint,
    });
  }

  /**
   * Outcome recording uses an INDEPENDENT verification signal, never the
   * agent's own "task succeeded" self-report.
   */
  recordOutcome(
    tenantId: string,
    planId: string,
    verification: { source: "env_state_check" | "user_feedback" | "verifier_pass"; ok: boolean },
    now: number,
  ): CachedPlan | undefined {
    const plan = this.store.namespace(tenantId).get(planId);
    if (!plan) return undefined;
    plan.executions += 1;
    plan.lastUsedAt = now;
    if (verification.ok) {
      plan.verifiedSuccesses += 1;
      plan.consecutiveDegradations = 0;
    } else {
      plan.consecutiveDegradations += 1;
    }
    plan.reliability = plan.verifiedSuccesses / plan.executions;
    if (plan.consecutiveDegradations >= this.policy.maxConsecutiveDegradations)
      this.evict(tenantId, planId, "consecutive_degradations");
    else if (
      plan.reliability < this.policy.reliabilityFloor &&
      plan.executions >= this.policy.coldStartFloor
    )
      this.evict(tenantId, planId, "reliability_below_floor");
    return plan;
  }

  evict(tenantId: string, planId: string, reason: string): void {
    const plan = this.store.namespace(tenantId).get(planId);
    if (plan) plan.evictedReason = reason;
  }

  /** Drift triggers: permission / schema / environment change. */
  evictOnDrift(
    tenantId: string,
    drift: { permissionScope?: string; schemaVersion?: string; environment?: Environment },
  ): number {
    let n = 0;
    for (const p of this.store.namespace(tenantId).list()) {
      if (p.evictedReason) continue;
      if (
        (drift.permissionScope && p.permissionScope !== drift.permissionScope) ||
        (drift.schemaVersion && p.schemaVersion !== drift.schemaVersion) ||
        (drift.environment && p.environment !== drift.environment)
      ) {
        this.evict(tenantId, p.id, "drift");
        n++;
      }
    }
    return n;
  }

  /** Remove a plan permanently from the metadata/vector store. */
  remove(tenantId: string, planId: string, reason = "manual"): void {
    const ns = this.store.namespace(tenantId);
    const plan = ns.get(planId);
    if (plan) {
      plan.evictedReason = reason;
      ns.delete(planId);
    }
  }

  tenants(): string[] {
    return this.store.tenants();
  }

  /** Documented pruning job: removes evicted and long-unused plans. */
  prune(tenantId: string, now: number): number {
    const ns = this.store.namespace(tenantId);
    let n = 0;
    for (const p of ns.list()) {
      if (p.evictedReason || now - p.lastUsedAt > this.policy.planTtlMs) {
        ns.delete(p.id);
        n++;
      }
    }
    return n;
  }

  plans(tenantId: string): CachedPlan[] {
    return this.store.namespace(tenantId).list();
  }
}
