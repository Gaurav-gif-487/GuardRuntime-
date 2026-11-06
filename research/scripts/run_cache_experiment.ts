import { performance } from "node:perf_hooks";
import { GuardRuntime } from "../src/guardruntime/runtime";
import { PlanCache } from "../src/guardruntime/pcr";
import { DEFAULT_POLICY } from "../src/guardruntime/policy";

interface RunResult {
  cacheEnabled: boolean;
  tenants: number;
  repeatsPerTenant: number;
  totalCalls: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  plansStoredPerTenant: number;
  recordCalls: number;
  p50Ms: number;
  p95Ms: number;
  meanMs: number;
}

async function run(cacheEnabled: boolean, tenants = 4, repeats = 25): Promise<RunResult> {
  const policy = {
    ...DEFAULT_POLICY,
    cacheEnabled,
    rateLimit: { ...DEFAULT_POLICY.rateLimit, max: 10_000 },
  };
  const baseCache = new PlanCache(policy);
  let recordCalls = 0;
  const cache = {
    lookup: (...args: Parameters<PlanCache["lookup"]>) => baseCache.lookup(...args),
    record: (...args: Parameters<PlanCache["record"]>) => {
      recordCalls += 1;
      return baseCache.record(...args);
    },
    recordOutcome: (...args: Parameters<PlanCache["recordOutcome"]>) =>
      baseCache.recordOutcome(...args),
    evictOnDrift: (...args: Parameters<PlanCache["evictOnDrift"]>) =>
      baseCache.evictOnDrift(...args),
    prune: (...args: Parameters<PlanCache["prune"]>) => baseCache.prune(...args),
    plans: (...args: Parameters<PlanCache["plans"]>) => baseCache.plans(...args),
    tenants: (...args: Parameters<PlanCache["tenants"]>) => baseCache.tenants(...args),
    setPolicy: (nextPolicy: typeof policy) => baseCache.setPolicy(nextPolicy),
  };

  const rt = new GuardRuntime({
    policy,
    planCache: cache,
    allowUnmanifestedPrincipals: true,
    executeTool: () => ({ ok: true }),
    verifyOutcome: () => ({ ok: true, source: "verifier_pass" as const }),
  });

  const latencies: number[] = [];
  let executed = 0;
  for (let tenantIndex = 0; tenantIndex < tenants; tenantIndex += 1) {
    for (let i = 0; i < repeats; i += 1) {
      const call = {
        tenantId: `cache-exp-tenant-${tenantIndex}`,
        idempotencyKey: `cache-exp-${cacheEnabled}-${tenantIndex}-${i}`,
        tool: "search_orders",
        args: { query: "same-goal" },
        goal: "same repeated goal",
        principal: "agent:cache-exp",
        permissionScope: "support:read",
        environment: "dev" as const,
      };
      const start = performance.now();
      const outcome = await rt.call(call);
      latencies.push(performance.now() - start);
      if (outcome.status !== "executed") throw new Error(`Unexpected outcome: ${outcome.status}`);
      executed += 1;
    }
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const percentile = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))]!;
  const cacheHits = rt.metrics.get("cache_hits_total");
  const cacheMisses = rt.metrics.get("cache_misses_total");

  return {
    cacheEnabled,
    tenants,
    repeatsPerTenant: repeats,
    totalCalls: executed,
    cacheHits,
    cacheMisses,
    hitRate: cacheHits / executed,
    plansStoredPerTenant: rt.cache.plans("cache-exp-tenant-0").length,
    recordCalls,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    meanMs: latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
  };
}

async function main() {
  const uncached = await run(false);
  const cached = await run(true);
  const result = {
    status: "executed",
    generatedAt: new Date().toISOString(),
    method:
      "Actual GuardRuntime with repeated identical goals across bounded tenants; unique idempotency keys; cache-enabled and cache-disabled arms. Record-call count is a proxy for plan-record/preparation-path work, not a monetary cost measurement.",
    uncached,
    cached,
    observed: {
      cacheHitRatePercent: cached.hitRate * 100,
      recordCallsAvoided: uncached.recordCalls - cached.recordCalls,
      recordCallReductionPercent: (1 - cached.recordCalls / uncached.recordCalls) * 100,
      medianLatencyDeltaPercent: (cached.p50Ms / uncached.p50Ms - 1) * 100,
      p95LatencyDeltaPercent: (cached.p95Ms / uncached.p95Ms - 1) * 100,
    },
    limitation:
      "This is an in-process micro-experiment, not a production cost benchmark. GuardRuntime's current plan preparation is deliberately tiny (one metadata step), so the measured latency difference must not be presented as a general cost-saving percentage.",
  };
  const output = new URL("../experiments/cache-experiment-results.json", import.meta.url);
  const fs = await import("node:fs/promises");
  await fs.writeFile(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
