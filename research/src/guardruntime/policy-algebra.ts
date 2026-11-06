/**
 * Policy Algebra & Composition.
 *
 * Enterprise deployments need composable policies: an org-wide policy,
 * overridden by team-specific rules, overridden by tool-specific constraints.
 * Policy algebra for composing runtime safety rules.
 * composition semantics.
 *
 * This module provides:
 * 1. Policy Merge — compose multiple policies with "most restrictive wins"
 * 2. Policy Diff — structured comparison of two policy versions
 * 3. Policy Simulation — "what-if" analysis without execution
 * 4. Temporal Policies — schedule-based activation/deactivation
 */

import { ActionRiskClassifier } from "./arc";
import { DEFAULT_POLICY, type Policy, SEED_TOOLS } from "./policy";
import type { RiskDecision, Reversibility, ToolCall, ToolDescriptor } from "./types";

// ─── Policy Merge ─────────────────────────────────────────────────────────────

export interface MergeOptions {
  /** How to handle conflicts between policies. */
  strategy: "most_restrictive" | "least_restrictive" | "base_wins";
  /** Label for the merged policy version. */
  mergedVersion?: string;
}

/**
 * Merge two policies. The "most restrictive wins" strategy ensures that
 * the merged policy is at least as safe as the stricter of the two inputs.
 *
 * Most restrictive semantics:
 * - Lower thresholds win (easier to trigger confirmation)
 * - Higher lowConfidenceCutoff wins (more sensitive to uncertainty)
 * - Shorter timeouts win (less time before auto-deny)
 * - Higher coldStartFloor wins (more verification needed)
 * - Higher similarityThreshold wins (stricter cache matching)
 * - Higher reliabilityFloor wins (higher bar for cache serving)
 * - Lower rate limits win (more restrictive)
 */
export function mergePolicies(
  base: Policy,
  overlay: Policy,
  options: MergeOptions = { strategy: "most_restrictive" },
): Policy {
  const pick = makePicker(options.strategy);

  const merged: Policy = {
    version: options.mergedVersion ?? `merged(${base.version}+${overlay.version})`,
    thresholds: {
      destructive: pick(base.thresholds.destructive, overlay.thresholds.destructive, "lower"),
      recoverable: pick(base.thresholds.recoverable, overlay.thresholds.recoverable, "lower"),
      reversible: pick(base.thresholds.reversible, overlay.thresholds.reversible, "lower"),
    },
    lowConfidenceCutoff: pick(base.lowConfidenceCutoff, overlay.lowConfidenceCutoff, "higher"),
    confirmationTimeoutMs: pick(base.confirmationTimeoutMs, overlay.confirmationTimeoutMs, "lower"),
    onTimeout: base.onTimeout === "deny" || overlay.onTimeout === "deny" ? "deny" : "escalate",
    escalationApprover: overlay.escalationApprover ?? base.escalationApprover,
    coldStartFloor: pick(base.coldStartFloor, overlay.coldStartFloor, "higher"),
    similarityThreshold: pick(base.similarityThreshold, overlay.similarityThreshold, "higher"),
    cacheEnabled: base.cacheEnabled !== false && overlay.cacheEnabled !== false,
    reliabilityFloor: pick(base.reliabilityFloor, overlay.reliabilityFloor, "higher"),
    planTtlMs: pick(base.planTtlMs, overlay.planTtlMs, "lower"),
    maxConsecutiveDegradations: pick(
      base.maxConsecutiveDegradations,
      overlay.maxConsecutiveDegradations,
      "lower",
    ),
    rateLimit: {
      windowMs: pick(base.rateLimit.windowMs, overlay.rateLimit.windowMs, "lower"),
      max: pick(base.rateLimit.max, overlay.rateLimit.max, "lower"),
    },
  };

  return merged;
}

function makePicker(
  strategy: MergeOptions["strategy"],
): (a: number, b: number, restrictiveDirection: "lower" | "higher") => number {
  return (a, b, dir) => {
    switch (strategy) {
      case "most_restrictive":
        return dir === "lower" ? Math.min(a, b) : Math.max(a, b);
      case "least_restrictive":
        return dir === "lower" ? Math.max(a, b) : Math.min(a, b);
      case "base_wins":
        return a;
    }
  };
}

// ─── Policy Diff ──────────────────────────────────────────────────────────────

export interface PolicyDiffEntry {
  field: string;
  before: unknown;
  after: unknown;
  restrictiveness: "stricter" | "looser" | "unchanged" | "mixed";
}

export interface PolicyDiff {
  from: string;
  to: string;
  changes: PolicyDiffEntry[];
  summary: {
    totalChanges: number;
    stricter: number;
    looser: number;
  };
}

/**
 * Compute a structured diff between two policy versions, annotating
 * each change with whether it makes the system stricter or looser.
 */
export function diffPolicies(before: Policy, after: Policy): PolicyDiff {
  const changes: PolicyDiffEntry[] = [];

  // Thresholds: lower = stricter (easier to trigger confirmation)
  for (const rev of ["destructive", "recoverable", "reversible"] as Reversibility[]) {
    const b = before.thresholds[rev];
    const a = after.thresholds[rev];
    if (b !== a) {
      changes.push({
        field: `thresholds.${rev}`,
        before: b,
        after: a,
        restrictiveness: a < b ? "stricter" : "looser",
      });
    }
  }

  // lowConfidenceCutoff: higher = stricter
  diffNumeric(
    changes,
    "lowConfidenceCutoff",
    before.lowConfidenceCutoff,
    after.lowConfidenceCutoff,
    "higher",
  );
  // confirmationTimeoutMs: lower = stricter
  diffNumeric(
    changes,
    "confirmationTimeoutMs",
    before.confirmationTimeoutMs,
    after.confirmationTimeoutMs,
    "lower",
  );
  // coldStartFloor: higher = stricter
  diffNumeric(changes, "coldStartFloor", before.coldStartFloor, after.coldStartFloor, "higher");
  // similarityThreshold: higher = stricter
  diffNumeric(
    changes,
    "similarityThreshold",
    before.similarityThreshold,
    after.similarityThreshold,
    "higher",
  );
  // reliabilityFloor: higher = stricter
  diffNumeric(
    changes,
    "reliabilityFloor",
    before.reliabilityFloor,
    after.reliabilityFloor,
    "higher",
  );
  // planTtlMs: lower = stricter
  diffNumeric(changes, "planTtlMs", before.planTtlMs, after.planTtlMs, "lower");
  // maxConsecutiveDegradations: lower = stricter
  diffNumeric(
    changes,
    "maxConsecutiveDegradations",
    before.maxConsecutiveDegradations,
    after.maxConsecutiveDegradations,
    "lower",
  );
  // rateLimit.max: lower = stricter
  diffNumeric(changes, "rateLimit.max", before.rateLimit.max, after.rateLimit.max, "lower");

  if (before.onTimeout !== after.onTimeout) {
    changes.push({
      field: "onTimeout",
      before: before.onTimeout,
      after: after.onTimeout,
      restrictiveness: after.onTimeout === "deny" ? "stricter" : "looser",
    });
  }

  if (before.cacheEnabled !== after.cacheEnabled) {
    changes.push({
      field: "cacheEnabled",
      before: before.cacheEnabled,
      after: after.cacheEnabled,
      restrictiveness: after.cacheEnabled === false ? "stricter" : "looser",
    });
  }

  return {
    from: before.version,
    to: after.version,
    changes,
    summary: {
      totalChanges: changes.length,
      stricter: changes.filter((c) => c.restrictiveness === "stricter").length,
      looser: changes.filter((c) => c.restrictiveness === "looser").length,
    },
  };
}

function diffNumeric(
  changes: PolicyDiffEntry[],
  field: string,
  before: number,
  after: number,
  stricterDirection: "lower" | "higher",
): void {
  if (before === after) return;
  const isStricter = stricterDirection === "lower" ? after < before : after > before;
  changes.push({
    field,
    before,
    after,
    restrictiveness: isStricter ? "stricter" : "looser",
  });
}

// ─── Policy Simulation ───────────────────────────────────────────────────────

export interface SimulationResult {
  call: ToolCall;
  currentPolicy: {
    version: string;
    decision: RiskDecision;
  };
  candidatePolicy: {
    version: string;
    decision: RiskDecision;
  };
  behaviorChange: "no_change" | "now_confirms" | "no_longer_confirms" | "severity_changed";
  delta: {
    severityDelta: number;
    blastRadiusDelta: number;
    confirmationChanged: boolean;
  };
}

/**
 * Simulate a set of tool calls against a candidate policy without executing
 * any of them. Shows exactly how each call's risk classification would change.
 */
export function simulatePolicy(
  calls: ToolCall[],
  currentPolicy: Policy,
  candidatePolicy: Policy,
  tools?: ToolDescriptor[],
): SimulationResult[] {
  const toolMap = new Map((tools ?? SEED_TOOLS).map((t) => [t.name, t]));
  const currentArc = new ActionRiskClassifier(new Map(toolMap), currentPolicy);
  const candidateArc = new ActionRiskClassifier(new Map(toolMap), candidatePolicy);

  return calls.map((call) => {
    const currentDecision = currentArc.classify(call);
    const candidateDecision = candidateArc.classify(call);

    let behaviorChange: SimulationResult["behaviorChange"] = "no_change";
    if (currentDecision.requiresConfirmation !== candidateDecision.requiresConfirmation) {
      behaviorChange = candidateDecision.requiresConfirmation
        ? "now_confirms"
        : "no_longer_confirms";
    } else if (Math.abs(currentDecision.severity - candidateDecision.severity) > 0.01) {
      behaviorChange = "severity_changed";
    }

    return {
      call,
      currentPolicy: { version: currentPolicy.version, decision: currentDecision },
      candidatePolicy: { version: candidatePolicy.version, decision: candidateDecision },
      behaviorChange,
      delta: {
        severityDelta: candidateDecision.severity - currentDecision.severity,
        blastRadiusDelta: candidateDecision.blastRadius - currentDecision.blastRadius,
        confirmationChanged:
          currentDecision.requiresConfirmation !== candidateDecision.requiresConfirmation,
      },
    };
  });
}

// ─── Temporal Policies ────────────────────────────────────────────────────────

export interface TemporalRule {
  id: string;
  description: string;
  /** Cron-like schedule (simplified): days of week (0=Sun..6=Sat). */
  activeDays: number[];
  /** Start hour (0–23, UTC). */
  startHour: number;
  /** End hour (0–23, UTC). */
  endHour: number;
  /** Policy overlay applied when this rule is active. */
  policyOverlay: Partial<Policy>;
}

export interface TemporalPolicyEngine {
  rules: TemporalRule[];
}

/**
 * Resolve the effective policy for a given point in time by composing the
 * base policy with all active temporal overlays.
 */
export function resolveTemporalPolicy(
  basePolicy: Policy,
  rules: TemporalRule[],
  now: Date = new Date(),
): { policy: Policy; activeRules: string[] } {
  const dayOfWeek = now.getUTCDay();
  const hour = now.getUTCHours();

  const activeRules: TemporalRule[] = [];
  for (const rule of rules) {
    if (rule.activeDays.includes(dayOfWeek)) {
      if (rule.startHour <= rule.endHour) {
        // Normal range (e.g., 9-17)
        if (hour >= rule.startHour && hour < rule.endHour) {
          activeRules.push(rule);
        }
      } else {
        // Overnight range (e.g., 22-6)
        if (hour >= rule.startHour || hour < rule.endHour) {
          activeRules.push(rule);
        }
      }
    }
  }

  if (activeRules.length === 0) {
    return { policy: basePolicy, activeRules: [] };
  }

  // Compose all active overlays using most-restrictive merge
  let effective = basePolicy;
  for (const rule of activeRules) {
    const overlay: Policy = {
      ...basePolicy,
      ...rule.policyOverlay,
      version: `${basePolicy.version}+temporal(${rule.id})`,
    };
    effective = mergePolicies(effective, overlay);
  }

  return {
    policy: {
      ...effective,
      version: `${basePolicy.version}+temporal[${activeRules.map((r) => r.id).join(",")}]`,
    },
    activeRules: activeRules.map((r) => r.id),
  };
}

// ─── Static Policy Consistency & Monotonicity Analysis ─────────────────────────

export interface PolicyConsistencyReport {
  isConsistent: boolean;
  contradictions: Array<{
    field: string;
    valueA: unknown;
    valueB: unknown;
    reason: string;
  }>;
  monotonicityViolations: string[];
}

// Backward-compatibility alias
export type SmtConsistencyReport = PolicyConsistencyReport;

/**
 * Validates static consistency and monotonicity between two policies or overlays.
 */
export function checkPolicyConsistency(
  base: Policy,
  overlay: Partial<Policy>,
): PolicyConsistencyReport {
  const contradictions: SmtConsistencyReport["contradictions"] = [];
  const monotonicityViolations: string[] = [];

  // Check threshold order consistency (destructive <= recoverable <= reversible)
  const dest = overlay.thresholds?.destructive ?? base.thresholds.destructive;
  const rec = overlay.thresholds?.recoverable ?? base.thresholds.recoverable;
  const rev = overlay.thresholds?.reversible ?? base.thresholds.reversible;

  if (dest > rec || rec > rev) {
    contradictions.push({
      field: "thresholds",
      valueA: { dest, rec, rev },
      valueB: "dest <= rec <= rev invariant",
      reason:
        "Threshold ordering violation: destructive threshold must not exceed recoverable/reversible",
    });
  }

  // Check rate limit monotonicity (overlay cannot expand window without scaling max)
  if (overlay.rateLimit && base.rateLimit) {
    if (
      overlay.rateLimit.max > base.rateLimit.max * 2 &&
      overlay.rateLimit.windowMs < base.rateLimit.windowMs
    ) {
      monotonicityViolations.push(
        `Rate limit expansion: overlay allows ${overlay.rateLimit.max} calls in ${overlay.rateLimit.windowMs}ms vs base ${base.rateLimit.max} calls in ${base.rateLimit.windowMs}ms`,
      );
    }
  }

  return {
    isConsistent: contradictions.length === 0 && monotonicityViolations.length === 0,
    contradictions,
    monotonicityViolations,
  };
}
