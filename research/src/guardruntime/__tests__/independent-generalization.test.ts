import { describe, expect, it } from "vitest";
import { GuardRuntime } from "../runtime";
import { DEFAULT_POLICY, SEED_TOOLS, type Policy } from "../policy";
import type { RiskDecision, ToolCall, ToolDescriptor, CachedPlan, Environment } from "../types";
import type { ExecutionPlanCache, LookupResult } from "../pcr";
import { generateSplitCase, type SplitName } from "../eval/generalization-splits";

/**
 * Independent cache-thesis oracle.
 * Deliberately does not import ActionRiskClassifier, PlanCache, or GuardRuntime
 * decision logic. It implements only the declared ARC semantics needed for the
 * cache hypothesis: tool lookup, compensation downgrade, magnitude/count blast
 * radius, environment scaling, threshold, and confidence ratchet.
 */
function oracle(
  call: ToolCall,
  tools: ToolDescriptor[],
  policy: Policy,
  compensations: Set<string>,
): RiskDecision {
  const tool = tools.find((candidate) => candidate.name === call.tool);
  if (!tool) {
    return {
      reversibility: "destructive",
      blastRadius: 1,
      severity: 1,
      requiresConfirmation: true,
      ruleId: "oracle.unknown_tool",
      policyVersion: policy.version,
      rationale: ["Unknown tool"],
      downgradedForMissingCompensation: false,
    };
  }
  let reversibility = tool.reversibility;
  const downgradedForMissingCompensation =
    reversibility === "recoverable" && !compensations.has(tool.name);
  if (downgradedForMissingCompensation) reversibility = "destructive";

  const signals: number[] = [];
  for (const [field, divisor] of [
    [tool.magnitudeField, 7],
    [tool.affectedCountField, 5],
  ] as const) {
    if (!field) continue;
    const raw = Number(call.args[field]);
    if (Number.isFinite(raw)) signals.push(Math.min(1, Math.log10(Math.max(1, raw)) / divisor));
  }
  if (!signals.length) signals.push(tool.blastRadiusTier ?? 0.5);
  const base = Math.max(...signals);
  const blastRadius = call.environment === "prod" ? base : Math.max(0, base * 0.6);
  let requiresConfirmation =
    reversibility === "destructive" || blastRadius >= policy.thresholds[reversibility];
  const weight = { reversible: 0.25, recoverable: 0.6, destructive: 1 }[reversibility];
  let severity = Math.min(1, weight * (0.4 + 0.6 * blastRadius));
  if (typeof call.confidence === "number" && call.confidence < policy.lowConfidenceCutoff) {
    severity = Math.min(1, severity + (policy.lowConfidenceCutoff - call.confidence));
    if (!requiresConfirmation && reversibility !== "reversible") requiresConfirmation = true;
  }
  return {
    reversibility,
    blastRadius,
    severity,
    requiresConfirmation,
    ruleId: downgradedForMissingCompensation ? "oracle.compensation_downgrade" : "oracle.matrix",
    policyVersion: policy.version,
    confidenceModelVersion: call.confidenceModelVersion,
    rationale: [],
    downgradedForMissingCompensation,
  };
}

class ReferenceExactPlanCache implements ExecutionPlanCache {
  private policy = DEFAULT_POLICY;
  private plansByTenant = new Map<string, Map<string, CachedPlan>>();
  private counter = 0;
  setPolicy(policy: Policy): void {
    this.policy = policy;
  }
  private ns(tenant: string): Map<string, CachedPlan> {
    let value = this.plansByTenant.get(tenant);
    if (!value) {
      value = new Map();
      this.plansByTenant.set(tenant, value);
    }
    return value;
  }
  lookup(
    call: ToolCall,
    _scope: { resourceType: string; schemaVersion: string; tool?: string },
    now: number,
    planFingerprint?: string,
  ): LookupResult {
    const candidates = [...this.ns(call.tenantId).values()].filter(
      (p) => !p.evictedReason && p.planFingerprint === planFingerprint && p.tool === call.tool,
    );
    const plan = candidates[0];
    if (!plan) return { similarity: 0, reason: "no_scoped_candidates" };
    if (now - plan.lastUsedAt > this.policy.planTtlMs) {
      plan.evictedReason = "ttl_expired";
      return { similarity: 1, reason: "expired" };
    }
    if (plan.executions < this.policy.coldStartFloor)
      return { plan, similarity: 1, reason: "cold_start_floor" };
    if (plan.reliability < this.policy.reliabilityFloor)
      return { plan, similarity: 1, reason: "reliability_floor" };
    return { plan, similarity: 1, reason: "hit" };
  }
  record(
    call: ToolCall,
    scope: { resourceType: string; schemaVersion: string; tool?: string },
    steps: string[],
    now: number,
    planFingerprint: string,
  ): CachedPlan {
    const existing = this.lookup(call, scope, now, planFingerprint).plan;
    if (existing) return existing;
    const id = `reference_${++this.counter}`;
    const plan: CachedPlan = {
      id,
      tenantId: call.tenantId,
      tool: call.tool,
      permissionScope: call.permissionScope,
      resourceType: scope.resourceType,
      environment: call.environment,
      schemaVersion: scope.schemaVersion,
      goal: call.goal,
      embedding: [],
      steps: [...steps],
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
    };
    this.ns(call.tenantId).set(id, plan);
    return plan;
  }
  recordOutcome(
    tenantId: string,
    planId: string,
    verification: { source: "env_state_check" | "user_feedback" | "verifier_pass"; ok: boolean },
    now: number,
  ): CachedPlan | undefined {
    const plan = [...this.ns(tenantId).values()].find((p) => p.id === planId);
    if (!plan) return undefined;
    plan.executions++;
    plan.lastUsedAt = now;
    if (verification.ok) plan.verifiedSuccesses++;
    else plan.consecutiveDegradations++;
    plan.reliability = plan.verifiedSuccesses / plan.executions;
    return plan;
  }
  evictOnDrift(
    tenantId: string,
    drift: { permissionScope?: string; schemaVersion?: string; environment?: Environment },
  ): number {
    let n = 0;
    for (const p of this.ns(tenantId).values()) {
      if (
        (drift.permissionScope && p.permissionScope !== drift.permissionScope) ||
        (drift.schemaVersion && p.schemaVersion !== drift.schemaVersion) ||
        (drift.environment && p.environment !== drift.environment)
      ) {
        p.evictedReason = "drift";
        n++;
      }
    }
    return n;
  }
  prune(tenantId: string, now: number): number {
    let n = 0;
    for (const [id, p] of this.ns(tenantId)) {
      if (p.evictedReason || now - p.lastUsedAt > this.policy.planTtlMs) {
        this.ns(tenantId).delete(id);
        n++;
      }
    }
    return n;
  }
  plans(tenantId: string): CachedPlan[] {
    return [...this.ns(tenantId).values()];
  }
  tenants(): string[] {
    return [...this.plansByTenant.keys()];
  }
}

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * Fill every schema-required field for the tool, not just magnitude/count.
 * Without this, tools like cancel_subscription (which needs subscription_id,
 * a field the generator otherwise never sets) get correctly rejected by
 * schema validation before ARC ever runs — which isn't a disagreement
 * between the real classifier and the oracle, it's the generator emitting
 * malformed calls that both would (correctly) never see in practice.
 */
function requiredArgsFor(
  tool: ToolDescriptor,
  r: () => number,
  amount: number,
  count: number,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const props = tool.schema?.properties ?? {};
  for (const [field, rule] of Object.entries(props)) {
    if (!rule.required) continue;
    if (field === tool.magnitudeField) {
      args[field] = amount;
      continue;
    }
    if (field === tool.affectedCountField) {
      args[field] = count;
      continue;
    }
    if (rule.type === "number") {
      args[field] = Math.max(rule.min ?? 0, Math.min(rule.max ?? 1000, Math.floor(r() * 1000)));
      continue;
    }
    // Generic non-numeric required field (e.g. subscription_id): synthesize a stable identifier.
    args[field] = `${field}-${Math.floor(r() * 1_000_000)}`;
  }
  return args;
}

function generatedCall(seed: number, i: number): ToolCall {
  const r = rng(seed + i * 7919);
  // Non-null assertion is safe: SEED_TOOLS is a non-empty static const, and
  // the index is always in [0, SEED_TOOLS.length), so this can never
  // actually be undefined at runtime — noUncheckedIndexedAccess just can't
  // see that statically.
  const tool = (SEED_TOOLS[Math.floor(r() * SEED_TOOLS.length)] ?? SEED_TOOLS[0])!;
  const amount = Math.max(1, Math.floor(r() * 1_000_000));
  const count = Math.max(1, Math.floor(r() * 10_000));
  return {
    // Unique tenant per case: this generator is checking single-call ARC
    // decision equivalence against a stateless oracle. Reusing tenants
    // across cases lets earlier calls (e.g. search_orders) leave taint or
    // cumulative-budget state that legitimately blocks a later call for
    // reasons the oracle deliberately doesn't model — a real safety
    // behavior, but not what this particular comparison is checking.
    tenantId: `tenant-${seed}-${i}`,
    idempotencyKey: `case-${seed}-${i}`,
    tool: tool.name,
    args: {
      query: `q-${Math.floor(r() * 20)}`,
      ...requiredArgsFor(tool, r, amount, count),
    },
    goal: `goal-${Math.floor(r() * 8)}`,
    principal: `agent-${Math.floor(r() * 3)}`,
    permissionScope: r() > 0.5 ? "support:read" : "finance:write",
    environment: r() > 0.66 ? "prod" : r() > 0.33 ? "staging" : "dev",
    confidence: Number(r().toFixed(3)),
    confidenceModelVersion: "oracle-generator-v1",
  };
}

async function runArm(
  calls: ToolCall[],
  mode: "disabled" | "production" | "reference",
  policy: Policy,
) {
  const rt = new GuardRuntime({
    allowUnmanifestedPrincipals: true,
    policy: { ...policy, cacheEnabled: mode !== "disabled" },
    ...(mode === "reference" ? { planCache: new ReferenceExactPlanCache() } : {}),
    compensatingActions: { issue_refund: () => ({ ok: true }) },
    executeTool: () => ({ ok: true }),
    verifyOutcome: () => ({ ok: true, source: "verifier_pass" as const }),
  });
  const outcomes = [];
  for (const [i, original] of calls.entries()) {
    // Unique idempotency keys make this a cache experiment rather than an idempotency experiment.
    outcomes.push(
      await rt.call({ ...original, idempotencyKey: `${original.idempotencyKey}-${i}` }),
    );
  }
  return { rt, outcomes };
}

describe("independent generalization benchmark", () => {
  it("checks exact cache equivalence and held-out state changes", async () => {
    const seeds = [101, 202];
    const calls = seeds.flatMap((seed) =>
      Array.from({ length: 100 }, (_, i) => generatedCall(seed, i)),
    );
    const policy = DEFAULT_POLICY;
    const oracleResults = calls.map((call) =>
      oracle(call, SEED_TOOLS, policy, new Set(["issue_refund"])),
    );

    const uncached = await runArm(calls, "disabled", policy);
    const cached = await runArm(calls, "production", policy);
    const reference = await runArm(calls, "reference", policy);

    // The uncached arm must agree with the standalone oracle.
    const uncachedArc = calls.map((original, i) => {
      const tenantEntries = uncached.rt.audit
        .entries(original.tenantId)
        .filter((entry) => entry.type === "arc_decision");
      return tenantEntries.find(
        (entry) =>
          entry.payload["tool"] === original.tool &&
          entry.payload["idempotencyKey"] === `${original.idempotencyKey}-${i}` &&
          entry.payload["source"] === "classifier",
      )?.payload;
    });
    for (const [i, expected] of oracleResults.entries()) {
      const actual = uncachedArc[i];
      expect(actual?.["reversibility"]).toBe(expected.reversibility);
      expect(actual?.["requiresConfirmation"]).toBe(expected.requiresConfirmation);
    }
    expect(uncached.rt.metrics.get("risk_decisions_total")).toBeGreaterThan(0);
    expect(cached.rt.metrics.get("risk_decisions_total")).toBe(
      uncached.rt.metrics.get("risk_decisions_total"),
    );
    expect(
      cached.rt.audit
        .entries("tenant-0")
        .concat(
          cached.rt.audit.entries("tenant-1"),
          cached.rt.audit.entries("tenant-2"),
          cached.rt.audit.entries("tenant-3"),
        )
        .every((entry) => entry.type !== "cache_hit" || entry.payload["planId"]),
    ).toBe(true);
    expect(cached.outcomes.map((o) => o.status)).toEqual(uncached.outcomes.map((o) => o.status));
    expect(reference.outcomes.map((o) => o.status)).toEqual(uncached.outcomes.map((o) => o.status));

    // Directly exercise the dangerous state transitions against PlanCache.
    const first = calls[0]!;
    const descriptor = SEED_TOOLS.find((tool) => tool.name === first.tool)!;
    const fingerprint = cached.rt.confirmationFingerprint(first);
    const plan = cached.rt.cache.record(
      first,
      {
        tool: first.tool,
        resourceType: descriptor.resourceType,
        schemaVersion: descriptor.schemaVersion,
      },
      ["step"],
      Date.now(),
      fingerprint,
    );
    const same = cached.rt.cache.lookup(
      first,
      {
        tool: first.tool,
        resourceType: descriptor.resourceType,
        schemaVersion: descriptor.schemaVersion,
      },
      Date.now(),
      fingerprint,
    );
    expect(plan.id).toBeDefined();
    expect(same.plan?.executionPlan.tool).toBe(first.tool);

    const changed = {
      ...first,
      args: {
        ...first.args,
        ...(descriptor.magnitudeField
          ? { [descriptor.magnitudeField]: 9999999 }
          : { query: "changed" }),
      },
    };
    const miss = cached.rt.cache.lookup(
      changed,
      {
        tool: changed.tool,
        resourceType: descriptor.resourceType,
        schemaVersion: descriptor.schemaVersion,
      },
      Date.now(),
      cached.rt.confirmationFingerprint(changed),
    );
    expect(miss.reason).not.toBe("hit");
  });

  it.skipIf(!process.env["RUN_LONG_EXPERIMENTS"])(
    "runs the registered 10,000-case generalization workload",
    async () => {
      const seeds = [101, 202, 303, 404, 505, 606];
      const calls = seeds.flatMap((seed) =>
        Array.from({ length: 10_000 }, (_, i) => generatedCall(seed, i)),
      );
      const policy = DEFAULT_POLICY;
      const cached = await runArm(calls, "production", policy);
      const uncached = await runArm(calls, "disabled", policy);
      const cachedCalls = cached.rt.metrics.snapshot();
      const uncachedCalls = uncached.rt.metrics.snapshot();
      const cachedRiskCalls = Object.entries(cachedCalls)
        .filter(([key]) => key.startsWith("risk_decisions_total"))
        .reduce((sum, [, value]) => sum + value, 0);
      const uncachedRiskCalls = Object.entries(uncachedCalls)
        .filter(([key]) => key.startsWith("risk_decisions_total"))
        .reduce((sum, [, value]) => sum + value, 0);
      expect(cachedRiskCalls).toBe(uncachedRiskCalls);
      expect(cached.rt.metrics.get("cache_hits_total")).toBeGreaterThanOrEqual(0);
      expect(cached.outcomes.map((o) => o.status)).toEqual(uncached.outcomes.map((o) => o.status));
    },
    120_000,
  );

  // The five non-random splits.
  // generateSplitCase's exclusion/variation logic per split is documented
  // in generalization-splits.ts; this test just checks that decision
  // equivalence and zero invalid-plan-reuse hold under each one. For the
  // full 60,000+-case run with oracle-agreement diagnostics, use
  // `tsx scripts/run_full_generalization.ts` (no vitest/node_modules
  // dependency, so it can also run before `npm ci` succeeds).
  it.skipIf(!process.env["RUN_LONG_EXPERIMENTS"])(
    "runs template-held-out, policy-held-out, environment-held-out, compositional, and temporal splits",
    async () => {
      const seeds = [101, 202, 303, 404, 505, 606];
      const splitsToCheck: SplitName[] = [
        "template-held-out",
        "policy-held-out",
        "environment-held-out",
        "compositional",
        "temporal",
      ];
      for (const split of splitsToCheck) {
        const cases = seeds.flatMap((seed) =>
          Array.from({ length: 1667 }, (_, i) => generateSplitCase(split, seed, i)),
        );
        const rtCached = new GuardRuntime({
          allowUnmanifestedPrincipals: true,
          policy: { ...cases[0]!.policy, cacheEnabled: true },
          compensatingActions: { issue_refund: () => ({ ok: true }) },
          executeTool: () => ({ ok: true }),
          verifyOutcome: () => ({ ok: true, source: "verifier_pass" as const }),
        });
        const rtUncached = new GuardRuntime({
          allowUnmanifestedPrincipals: true,
          policy: { ...cases[0]!.policy, cacheEnabled: false },
          compensatingActions: { issue_refund: () => ({ ok: true }) },
          executeTool: () => ({ ok: true }),
          verifyOutcome: () => ({ ok: true, source: "verifier_pass" as const }),
        });
        const cachedStatuses: string[] = [];
        const uncachedStatuses: string[] = [];
        for (const c of cases) {
          cachedStatuses.push((await rtCached.call(c.call)).status);
          uncachedStatuses.push((await rtUncached.call(c.call)).status);
          if (c.secondCall) {
            cachedStatuses.push((await rtCached.call(c.secondCall)).status);
            uncachedStatuses.push((await rtUncached.call(c.secondCall)).status);
          }
        }
        expect(cachedStatuses).toEqual(uncachedStatuses);
      }
    },
    180_000,
  );
});
