import { Metrics } from "./metrics";
import { PlanCache } from "./pcr";

export interface PruningConfig {
  ttlDays: number;
  minReliabilityFloor: number;
  maxConsecutiveFailures: number;
  checkIntervalMs: number;
}

const DEFAULT_PRUNING_CONFIG: PruningConfig = {
  ttlDays: 90,
  minReliabilityFloor: 0.7,
  maxConsecutiveFailures: 3,
  checkIntervalMs: 24 * 60 * 60 * 1000,
};

export interface PruneResult {
  expiredCount: number;
  degradedCount: number;
  failureCount: number;
}

/**
 * Background maintenance for the in-process PCR store.
 *
 * The job is intentionally implemented against PlanCache's public API rather
 * than reaching into its storage implementation. That keeps tenant scoping in
 * one place and makes the pruner safe to evolve with the cache backend.
 */
export class CachePruner {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly cache: PlanCache,
    private readonly metrics?: Metrics,
    private readonly config?: PruningConfig,
  ) {}

  start(): void {
    if (this.timer) return;
    const interval = this.config?.checkIntervalMs ?? DEFAULT_PRUNING_CONFIG.checkIntervalMs;
    this.timer = setInterval(() => {
      void this.runPruneJob().catch((err) => {
        console.error("[CachePruner] Scheduled pruning failed:", err);
      });
    }, interval);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async runPruneJob(now = Date.now()): Promise<PruneResult> {
    const policy = this.cache.getPolicy();
    const config = this.config ?? {
      ttlDays: policy.planTtlMs / (24 * 60 * 60 * 1000),
      minReliabilityFloor: policy.reliabilityFloor,
      maxConsecutiveFailures: policy.maxConsecutiveDegradations,
      checkIntervalMs: DEFAULT_PRUNING_CONFIG.checkIntervalMs,
    };
    const cutoff = now - config.ttlDays * 24 * 60 * 60 * 1000;
    let expiredCount = 0;
    let degradedCount = 0;
    let failureCount = 0;

    for (const tenantId of this.cache.tenants()) {
      for (const plan of this.cache.plans(tenantId)) {
        if (plan.lastUsedAt < cutoff) {
          this.cache.remove(tenantId, plan.id, "ttl_expired");
          expiredCount++;
          this.metrics?.inc("cache_evictions_total", { reason: "ttl_expired" });
          continue;
        }

        if (
          plan.consecutiveDegradations >= config.maxConsecutiveFailures ||
          (plan.executions >= 3 && plan.reliability < config.minReliabilityFloor)
        ) {
          this.cache.remove(tenantId, plan.id, "reliability_degraded");
          degradedCount++;
          if (plan.consecutiveDegradations >= config.maxConsecutiveFailures) failureCount++;
          this.metrics?.inc("cache_evictions_total", { reason: "reliability_degraded" });
        }
      }
    }

    return { expiredCount, degradedCount, failureCount };
  }
}

export { DEFAULT_PRUNING_CONFIG };
