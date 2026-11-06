/**
 * Executable Safety Invariant Checks for GuardRuntime.
 *
 * These 7 invariants define the provable safety properties that make
 * These checks cover selected runtime properties and do not establish superiority over other systems.
 * construction (enforced by the type system and runtime logic) and can
 * be independently verified at any point.
 *
 * This module provides both:
 * 1. Runtime assertion functions for continuous monitoring
 * 2. A comprehensive `verifyAllInvariants()` for audit/eval use
 */

import type { GuardRuntime } from "./runtime";
import type { Policy } from "./policy";
import type { RiskDecision, ToolCall, AuditEntry } from "./types";

// ─── Invariant Result Types ───────────────────────────────────────────────────

export interface InvariantViolation {
  invariant: string;
  description: string;
  evidence: Record<string, unknown>;
  severity: "critical" | "warning";
}

export interface InvariantCheckResult {
  id: string;
  name: string;
  passed: boolean;
  violations: InvariantViolation[];
}

export interface InvariantReport {
  timestamp: number;
  allPassed: boolean;
  results: InvariantCheckResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    criticalViolations: number;
  };
}

// ─── Invariant 1: Confidence Monotonicity ─────────────────────────────────────
/**
 * **Property under test**: A confidence signal can only increase the severity of a risk
 * decision. It can NEVER suppress a confirmation that the primary axes
 * (reversibility × blast radius) already require.
 *
 * Formally: ∀ call ∈ ToolCall, ∀ c1,c2 ∈ [0,1]:
 *   requiresConfirmation(call, c1=undefined) = true
 *   ⟹ requiresConfirmation(call, c2) = true, ∀ c2
 *
 * This property is critical because most agent confidence signals are
 * uncalibrated. Making the modifier one-directional means a badly calibrated
 * source degrades UX (more confirmations) rather than safety.
 */
export function checkConfidenceMonotonicity(
  classify: (call: ToolCall) => RiskDecision,
  testCalls: ToolCall[],
): InvariantCheckResult {
  const violations: InvariantViolation[] = [];

  for (const call of testCalls) {
    // Classify without confidence
    const { confidence: _dropped, ...baseCallFields } = call;
    const baseCall: ToolCall = { ...baseCallFields } as ToolCall;
    delete (baseCall as unknown as Record<string, unknown>)["confidence"];
    const baseDecision = classify(baseCall);

    if (baseDecision.requiresConfirmation) {
      // If base requires confirmation, ALL confidence values must also require it
      for (const conf of [0.0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.0]) {
        const withConf: ToolCall = { ...call, confidence: conf };
        const confDecision = classify(withConf);
        if (!confDecision.requiresConfirmation) {
          violations.push({
            invariant: "INV-1",
            description: `Confidence ${conf} suppressed a confirmation for tool "${call.tool}" that was required without confidence`,
            evidence: {
              tool: call.tool,
              confidence: conf,
              baseRequiresConfirmation: true,
              confRequiresConfirmation: false,
              baseReversibility: baseDecision.reversibility,
              confReversibility: confDecision.reversibility,
            },
            severity: "critical",
          });
        }
      }

      // Additionally, severity must never decrease with lower confidence
      for (const conf of [0.1, 0.3, 0.5]) {
        const withConf: ToolCall = { ...call, confidence: conf };
        const confDecision = classify(withConf);
        if (confDecision.severity < baseDecision.severity) {
          violations.push({
            invariant: "INV-1",
            description: `Confidence ${conf} lowered severity from ${baseDecision.severity.toFixed(3)} to ${confDecision.severity.toFixed(3)} for "${call.tool}"`,
            evidence: {
              tool: call.tool,
              confidence: conf,
              baseSeverity: baseDecision.severity,
              confSeverity: confDecision.severity,
            },
            severity: "critical",
          });
        }
      }
    }
  }

  return {
    id: "INV-1",
    name: "Confidence Monotonicity (Safety Ratchet)",
    passed: violations.length === 0,
    violations,
  };
}

// ─── Invariant 2: Destructive Always Confirms ────────────────────────────────
/**
 * **Property under test**: Any tool classified as destructive (reversibility = "destructive")
 * ALWAYS requires human confirmation, regardless of blast radius, environment,
 * confidence, or any other signal.
 *
 * Formally: ∀ call ∈ ToolCall:
 *   reversibility(call) = "destructive" ⟹ requiresConfirmation(call) = true
 *
 * This is intended as a non-bypassable safety property; the executable check
 * exercises representative calls and policy settings. The threshold for destructive is 0, meaning even a
 * blast radius of 0 still requires confirmation.
 */
export function checkDestructiveAlwaysConfirms(
  classify: (call: ToolCall) => RiskDecision,
  testCalls: ToolCall[],
): InvariantCheckResult {
  const violations: InvariantViolation[] = [];

  for (const call of testCalls) {
    const decision = classify(call);
    if (decision.reversibility === "destructive" && !decision.requiresConfirmation) {
      violations.push({
        invariant: "INV-2",
        description: `Destructive tool "${call.tool}" did not require confirmation`,
        evidence: {
          tool: call.tool,
          reversibility: decision.reversibility,
          blastRadius: decision.blastRadius,
          severity: decision.severity,
          ruleId: decision.ruleId,
        },
        severity: "critical",
      });
    }
  }

  return {
    id: "INV-2",
    name: "Destructive Actions Always Require Confirmation",
    passed: violations.length === 0,
    violations,
  };
}

// ─── Invariant 3: Tenant Isolation ────────────────────────────────────────────
/**
 * **Property under test**: No operation on tenant A's data can read, write, or influence
 * tenant B's data. Isolation is structural (enforced by the type system),
 * not a query filter.
 *
 * Formally: ∀ op ∈ Operation, ∀ tA,tB ∈ TenantId, tA ≠ tB:
 *   namespace(tA).op() ∩ namespace(tB).data = ∅
 */
export function checkTenantIsolation(rt: GuardRuntime, tenantIds: string[]): InvariantCheckResult {
  const violations: InvariantViolation[] = [];

  for (let i = 0; i < tenantIds.length; i++) {
    for (let j = i + 1; j < tenantIds.length; j++) {
      const tA = tenantIds[i]!;
      const tB = tenantIds[j]!;

      // Verify audit chains are independent
      const auditA = rt.audit.entries(tA);
      const auditB = rt.audit.entries(tB);

      for (const entry of auditA) {
        if (entry.tenantId !== tA) {
          violations.push({
            invariant: "INV-3",
            description: `Audit entry in tenant "${tA}" chain has tenantId "${entry.tenantId}"`,
            evidence: { expectedTenant: tA, actualTenant: entry.tenantId, seq: entry.seq },
            severity: "critical",
          });
        }
      }

      for (const entry of auditB) {
        if (entry.tenantId !== tB) {
          violations.push({
            invariant: "INV-3",
            description: `Audit entry in tenant "${tB}" chain has tenantId "${entry.tenantId}"`,
            evidence: { expectedTenant: tB, actualTenant: entry.tenantId, seq: entry.seq },
            severity: "critical",
          });
        }
      }

      // Verify plan caches are isolated
      const plansA = rt.cache.plans(tA);
      const plansB = rt.cache.plans(tB);

      for (const plan of plansA) {
        if (plan.tenantId !== tA) {
          violations.push({
            invariant: "INV-3",
            description: `Plan in tenant "${tA}" namespace belongs to "${plan.tenantId}"`,
            evidence: { expectedTenant: tA, planId: plan.id, actualTenant: plan.tenantId },
            severity: "critical",
          });
        }
      }

      for (const plan of plansB) {
        if (plan.tenantId !== tB) {
          violations.push({
            invariant: "INV-3",
            description: `Plan in tenant "${tB}" namespace belongs to "${plan.tenantId}"`,
            evidence: { expectedTenant: tB, planId: plan.id, actualTenant: plan.tenantId },
            severity: "critical",
          });
        }
      }
    }
  }

  return {
    id: "INV-3",
    name: "Structural Tenant Isolation",
    passed: violations.length === 0,
    violations,
  };
}

// ─── Invariant 4: Hash-Chain Integrity ────────────────────────────────────────
/**
 * **Property under test**: The audit log forms a hash chain where each entry commits to
 * the hash of its predecessor. Rewriting any entry requires recomputing
 * every subsequent hash, which verify() detects.
 *
 * Formally: ∀ i > 0: entry[i].prevHash = hash(entry[i-1])
 *           ∧ entry[0].prevHash = GENESIS
 */
export function checkHashChainIntegrity(
  rt: GuardRuntime,
  tenantIds: string[],
): InvariantCheckResult {
  const violations: InvariantViolation[] = [];

  for (const tenantId of tenantIds) {
    const result = rt.audit.verify(tenantId);
    if (!result.ok) {
      violations.push({
        invariant: "INV-4",
        description: `Audit hash chain broken for tenant "${tenantId}" at sequence ${result.brokenAt}`,
        evidence: { tenantId, brokenAt: result.brokenAt },
        severity: "critical",
      });
    }
  }

  return {
    id: "INV-4",
    name: "Hash-Chain Audit Integrity",
    passed: violations.length === 0,
    violations,
  };
}

// ─── Invariant 5: Idempotency ─────────────────────────────────────────────────
/**
 * **Property under test**: A tool call with the same idempotency key, within the same
 * tenant, NEVER re-executes. The original outcome is replayed.
 *
 * Formally: ∀ k ∈ IdempotencyKey, ∀ t ∈ TenantId:
 *   call(t, k) → outcome₁
 *   call(t, k) → outcome₁ (replayed, not re-executed)
 *
 * This is verified by checking that tool_executed events are never
 * duplicated for the same idempotency key.
 */
export function checkIdempotency(rt: GuardRuntime, tenantId: string): InvariantCheckResult {
  const violations: InvariantViolation[] = [];
  const entries = rt.audit.entries(tenantId);
  const executedKeys = new Map<string, number>();

  for (const entry of entries) {
    if (entry.type === "tool_executed") {
      const key = (entry.payload as { idempotencyKey?: string }).idempotencyKey;
      if (key) {
        const count = (executedKeys.get(key) ?? 0) + 1;
        executedKeys.set(key, count);
        if (count > 1) {
          violations.push({
            invariant: "INV-5",
            description: `Idempotency key "${key}" was executed ${count} times`,
            evidence: { idempotencyKey: key, executionCount: count, seq: entry.seq },
            severity: "critical",
          });
        }
      }
    }
  }

  return {
    id: "INV-5",
    name: "Idempotent Execution Property",
    passed: violations.length === 0,
    violations,
  };
}

// ─── Invariant 6: Fail-Closed Default ─────────────────────────────────────────
/**
 * **Property under test**: When GuardRuntime is unhealthy, all actions above genuinely
 * reversible/low-risk are blocked UNLESS the tool has an explicit, logged
 * fail-open opt-in. The default is always fail-closed.
 *
 * Formally: ∀ call ∈ ToolCall:
 *   ¬healthy ∧ ¬(reversible ∧ ¬requiresConfirmation) ∧ ¬failOpen(tool)
 *   ⟹ outcome = blocked
 */
export function checkFailClosedDefault(rt: GuardRuntime, tenantId: string): InvariantCheckResult {
  const violations: InvariantViolation[] = [];

  if (!rt.isHealthy()) {
    const entries = rt.audit.entries(tenantId);
    // When unhealthy, check that fail_safe_activated events exist for non-low-risk actions
    const failSafeEvents = entries.filter((e) => e.type === "fail_safe_activated");
    const executedDuringUnhealthy = entries.filter(
      (e) => e.type === "tool_executed" && !(e.payload as { failOpen?: boolean }).failOpen,
    );

    // This is a structural check — we verify the pattern exists
    if (failSafeEvents.length === 0 && executedDuringUnhealthy.length > 0) {
      violations.push({
        invariant: "INV-6",
        description: "Tools executed during unhealthy state without fail-safe activation logging",
        evidence: {
          healthy: false,
          failSafeEvents: failSafeEvents.length,
          executionsWithoutFailOpen: executedDuringUnhealthy.length,
        },
        severity: "warning",
      });
    }
  }

  return {
    id: "INV-6",
    name: "Fail-Closed Default (Never Silent Fail-Open)",
    passed: violations.length === 0,
    violations,
  };
}

// ─── Invariant 7: Independent Verification ────────────────────────────────────
/**
 * **Property under test**: Outcome verification signals MUST come from an independent
 * source (environment state check, user feedback, or verifier pass). An
 * agent's own "task succeeded" self-report is NEVER accepted as verification.
 *
 * Formally: ∀ verification ∈ OutcomeVerification:
 *   verification.source ∈ {"env_state_check", "user_feedback", "verifier_pass"}
 *   ∧ verification.source ∉ {"agent_self_report"}
 */
export function checkIndependentVerification(
  rt: GuardRuntime,
  tenantId: string,
): InvariantCheckResult {
  const violations: InvariantViolation[] = [];
  const entries = rt.audit.entries(tenantId);

  const verificationEvents = entries.filter((e) => e.type === "outcome_verified");

  for (const event of verificationEvents) {
    const source = (event.payload as { source?: string }).source;
    const validSources = ["env_state_check", "user_feedback", "verifier_pass"];

    if (!source || !validSources.includes(source)) {
      violations.push({
        invariant: "INV-7",
        description: `Outcome verification used invalid source: "${source}"`,
        evidence: { seq: event.seq, source, validSources },
        severity: "critical",
      });
    }
  }

  return {
    id: "INV-7",
    name: "Independent Outcome Verification (Never Agent Self-Report)",
    passed: violations.length === 0,
    violations,
  };
}

// ─── Comprehensive Verification ───────────────────────────────────────────────

export interface VerifyAllOptions {
  rt: GuardRuntime;
  tenantIds: string[];
  testCalls?: ToolCall[];
}

/**
 * Run all 7 executable safety-property checks and produce a structured report.
 *
 * This is the primary entry point for audit, eval, and continuous
 * monitoring use cases.
 */
export function verifyAllInvariants(opts: VerifyAllOptions): InvariantReport {
  const { rt, tenantIds, testCalls = [] } = opts;
  const classify = (call: ToolCall) => rt.arc.classify(call);

  const defaultCalls: ToolCall[] =
    testCalls.length > 0
      ? testCalls
      : [
          {
            tenantId: tenantIds[0] ?? "acme-corp",
            idempotencyKey: "inv_def_1",
            tool: "wire_transfer",
            args: { amount_usd: 100 },
            goal: "transfer",
            principal: "agent:test",
            permissionScope: "all",
            environment: "prod" as const,
          },
          {
            tenantId: tenantIds[0] ?? "acme-corp",
            idempotencyKey: "inv_def_2",
            tool: "search_orders",
            args: { query: "orders" },
            goal: "search",
            principal: "agent:test",
            permissionScope: "all",
            environment: "prod" as const,
          },
          {
            tenantId: tenantIds[0] ?? "acme-corp",
            idempotencyKey: "inv_def_3",
            tool: "delete_workspace",
            args: { member_count: 10 },
            goal: "clean workspace",
            principal: "agent:test",
            permissionScope: "all",
            environment: "prod" as const,
          },
        ];

  const results: InvariantCheckResult[] = [
    checkConfidenceMonotonicity(classify, defaultCalls),
    checkDestructiveAlwaysConfirms(classify, defaultCalls),
    checkTenantIsolation(rt, tenantIds),
    checkHashChainIntegrity(rt, tenantIds),
    ...tenantIds.map((tid) => checkIdempotency(rt, tid)),
    checkFailClosedDefault(rt, tenantIds[0] ?? "default"),
    ...tenantIds.map((tid) => checkIndependentVerification(rt, tid)),
  ];

  // Deduplicate by id (idempotency + verification may produce multiple per tenant)
  const deduped = new Map<string, InvariantCheckResult>();
  for (const r of results) {
    const existing = deduped.get(r.id);
    if (existing) {
      existing.violations.push(...r.violations);
      existing.passed = existing.passed && r.passed;
    } else {
      deduped.set(r.id, { ...r });
    }
  }

  const finalResults = [...deduped.values()];
  const criticalViolations = finalResults.reduce(
    (sum, r) => sum + r.violations.filter((v) => v.severity === "critical").length,
    0,
  );

  return {
    timestamp: Date.now(),
    allPassed: finalResults.every((r) => r.passed),
    results: finalResults,
    summary: {
      total: finalResults.length,
      passed: finalResults.filter((r) => r.passed).length,
      failed: finalResults.filter((r) => !r.passed).length,
      criticalViolations,
    },
  };
}
