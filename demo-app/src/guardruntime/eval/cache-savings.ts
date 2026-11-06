import { GuardRuntimePipeline } from '../pipeline';
import { ExecutionContext, ToolAction, Principal, PolicySet } from '../types';

export interface CacheBenefitReport {
  timestamp: string;
  totalRepetitions: number;
  tenantId: string;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;
  cachedPipelineAvgLatencyMs: number;
  uncachedPipelineAvgLatencyMs: number;
  latencyReductionPercent: number;
  unauthorizedCacheBypasses: number;
  falsifiableProperty3Respected: boolean; // Cache is non-authorizing
  falsifiableProperty4Respected: boolean; // High impact cannot be cache-shortcut
  iterationsData: Array<{
    iteration: number;
    actionName: string;
    cachedLatencyMs: number;
    uncachedLatencyMs: number;
    cachedVerdict: string;
    uncachedVerdict: string;
    cacheHit: boolean;
  }>;
}

export async function runCacheSavingsBenchmark(
  repetitions: number = 50,
  onProgress?: (current: number, total: number) => void
): Promise<CacheBenefitReport> {
  const tenantId = 'tenant-enterprise-savings-bench';
  const principal: Principal = {
    id: 'agent-ops-benchmark',
    name: 'Benchmark Agent',
    role: 'agent',
    tenantId,
    capabilities: ['infra:read:*', 'infra:deploy:staging']
  };

  const samplePolicy: PolicySet = {
    id: 'pol-savings-bench',
    version: '1.0.0',
    name: 'Benchmark Policy',
    tenantId,
    rules: [
      {
        id: 'r1',
        name: 'Allow Metrics Read',
        description: 'Allow standard metrics query',
        effect: 'ALLOW',
        matchToolNames: ['infra.getMetrics'],
        priority: 10
      },
      {
        id: 'r2',
        name: 'Confirm Deploy',
        description: 'Confirm high impact deploy',
        effect: 'CONFIRM',
        matchToolNames: ['infra.deploy'],
        priority: 20
      }
    ]
  };

  const pipelineCached = new GuardRuntimePipeline();
  const pipelineUncached = new GuardRuntimePipeline();

  // Pre-seed capability grant
  pipelineCached.getCapabilityEngine().addGrant({
    id: 'grant-bench-01',
    principalId: principal.id,
    namespace: 'infra:read:*',
    allowedActions: ['infra.getMetrics', 'infra.deploy'],
    expiresAt: Date.now() + 86400000,
    leaseToken: 'LEASE_TOKEN_BENCH'
  });

  pipelineUncached.getCapabilityEngine().addGrant({
    id: 'grant-bench-01',
    principalId: principal.id,
    namespace: 'infra:read:*',
    allowedActions: ['infra.getMetrics', 'infra.deploy'],
    expiresAt: Date.now() + 86400000,
    leaseToken: 'LEASE_TOKEN_BENCH'
  });

  const iterationsData: CacheBenefitReport['iterationsData'] = [];
  let totalCachedTime = 0;
  let totalUncachedTime = 0;
  let unauthorizedBypasses = 0;
  let prop4Violations = 0;

  // Repetitive action workload to measure true structural plan lookup acceleration
  const workloadActions: ToolAction[] = [
    { id: 'a1', toolName: 'infra.getMetrics', actionType: 'READ', parameters: { service: 'auth-service' }, timestamp: Date.now() },
    { id: 'a2', toolName: 'infra.getMetrics', actionType: 'READ', parameters: { service: 'payment-api' }, timestamp: Date.now() },
    { id: 'a3', toolName: 'infra.deploy', actionType: 'WRITE', parameters: { service: 'user-service', environment: 'staging' }, timestamp: Date.now() }
  ];

  for (let i = 0; i < repetitions; i++) {
    if (onProgress) onProgress(i + 1, repetitions);

    const action = workloadActions[i % workloadActions.length];

    const ctxCached: ExecutionContext = {
      tenantId,
      principal,
      currentBudgetRemaining: 10000,
      hourlyActionCount: 5,
      runtimeHealth: 'HEALTHY',
      activePolicies: [samplePolicy],
      capabilityGrants: pipelineCached.getCapabilityEngine().getGrantsForPrincipal(principal.id),
      time: Date.now(),
      cacheEnabled: true
    };

    const ctxUncached: ExecutionContext = {
      ...ctxCached,
      capabilityGrants: pipelineUncached.getCapabilityEngine().getGrantsForPrincipal(principal.id),
      cacheEnabled: false
    };

    const t1 = performance.now();
    const traceCached = await pipelineCached.executePipeline(action, ctxCached);
    const cachedLatency = +(performance.now() - t1).toFixed(3);

    const t2 = performance.now();
    const traceUncached = await pipelineUncached.executePipeline(action, ctxUncached);
    const uncachedLatency = +(performance.now() - t2).toFixed(3);

    totalCachedTime += cachedLatency;
    totalUncachedTime += uncachedLatency;

    // Check invariants
    if (traceCached.cacheHit && traceCached.verdict === 'ALLOW' && traceUncached.verdict !== 'ALLOW') {
      unauthorizedBypasses++;
    }

    if (traceCached.riskVector.isHighImpact && traceCached.cacheHit && traceCached.verdict === 'ALLOW') {
      prop4Violations++;
    }

    iterationsData.push({
      iteration: i + 1,
      actionName: action.toolName,
      cachedLatencyMs: cachedLatency,
      uncachedLatencyMs: uncachedLatency,
      cachedVerdict: traceCached.verdict,
      uncachedVerdict: traceUncached.verdict,
      cacheHit: traceCached.cacheHit
    });
  }

  const avgCached = +(totalCachedTime / repetitions).toFixed(3);
  const avgUncached = +(totalUncachedTime / repetitions).toFixed(3);
  const deltaPercent = avgUncached > 0 ? +(((avgUncached - avgCached) / avgUncached) * 100).toFixed(2) : 0;
  const hits = pipelineCached.telemetry.cacheHits;
  const misses = pipelineCached.telemetry.cacheMisses;
  const hitRate = +(hits / (hits + misses || 1)).toFixed(3);

  return {
    timestamp: new Date().toISOString(),
    totalRepetitions: repetitions,
    tenantId,
    cacheHits: hits,
    cacheMisses: misses,
    cacheHitRate: hitRate,
    cachedPipelineAvgLatencyMs: avgCached,
    uncachedPipelineAvgLatencyMs: avgUncached,
    latencyReductionPercent: deltaPercent,
    unauthorizedCacheBypasses: unauthorizedBypasses,
    falsifiableProperty3Respected: unauthorizedBypasses === 0,
    falsifiableProperty4Respected: prop4Violations === 0,
    iterationsData
  };
}
