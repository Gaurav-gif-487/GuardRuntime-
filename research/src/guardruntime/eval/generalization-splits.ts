import { DEFAULT_POLICY, SEED_TOOLS, type Policy } from "../policy";
import type { RiskDecision, ToolCall, ToolDescriptor } from "../types";

/**
 * Independent cache-thesis oracle (copied intentionally, not imported, from
 * independent-generalization.test.ts's own oracle — kept in sync by hand so
 * this module has no dependency on the test file, and vice versa). It
 * deliberately does not import ActionRiskClassifier, PlanCache, or
 * GuardRuntime decision logic.
 */
export function oracle(
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

export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

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
    args[field] = `${field}-${Math.floor(r() * 1_000_000)}`;
  }
  return args;
}

export const SPLIT_NAMES = [
  "random",
  "template-held-out",
  "policy-held-out",
  "environment-held-out",
  "compositional",
  "temporal",
] as const;
export type SplitName = (typeof SPLIT_NAMES)[number];

// Literal exclusion, not a cosmetic label: these two tool templates never
// appear in the `random` split's generation at all, and every other split
// (`policy-held-out`, `environment-held-out`, `compositional`, `temporal`)
// draws only from the SEEN set too. Only `template-held-out` ever
// constructs a call against them. If `random` ever accidentally drew from
// this set, template-held-out would no longer be "held out" from anything —
// that's the property this split exists to test, so keep these disjoint.
const HELD_OUT_TOOL_NAMES = new Set(["wire_transfer", "delete_workspace"]);
const SEEN_TOOLS = SEED_TOOLS.filter((t) => !HELD_OUT_TOOL_NAMES.has(t.name));
const HELD_OUT_TOOLS = SEED_TOOLS.filter((t) => HELD_OUT_TOOL_NAMES.has(t.name));

if (HELD_OUT_TOOLS.length === 0) {
  throw new Error(
    "generalization-splits: HELD_OUT_TOOL_NAMES matched nothing in SEED_TOOLS — " +
      "the template-held-out split would silently degrade to sampling SEEN_TOOLS. " +
      "SEED_TOOLS names must have changed; update HELD_OUT_TOOL_NAMES to match.",
  );
}

// `random` and most other splits only ever generate dev/staging. `prod` is
// reserved so `environment-held-out` is a literal unseen value, not a label.
const SEEN_ENVIRONMENTS = ["dev", "staging"] as const;

// A policy version genuinely never used by any other split — different
// version string AND different thresholds, so `policy-held-out` is testing
// decision-equivalence under policy content this run has not evaluated
// before, not just a renamed copy of DEFAULT_POLICY.
export const HELD_OUT_POLICY: Policy = {
  ...DEFAULT_POLICY,
  version: "eval-policy-heldout-v1",
  thresholds: {
    ...DEFAULT_POLICY.thresholds,
    recoverable: Math.max(0, DEFAULT_POLICY.thresholds.recoverable - 0.15),
    reversible: Math.min(1, DEFAULT_POLICY.thresholds.reversible + 0.1),
  },
  lowConfidenceCutoff: Math.min(1, DEFAULT_POLICY.lowConfidenceCutoff + 0.1),
};

function pick<T>(arr: readonly T[], r: () => number): T {
  const item = arr[Math.floor(r() * arr.length)] ?? arr[0];
  return item as T;
}

export interface SplitCase {
  split: SplitName;
  call: ToolCall;
  policy: Policy;
  /** For temporal cases: the second, later timestamp to replay the same call at. */
  replayAtMs?: number;
  /** For compositional cases: a second call sharing this case's tenant. */
  secondCall?: ToolCall;
}

function baseCall(
  seed: number,
  i: number,
  split: SplitName,
  tools: readonly ToolDescriptor[],
  environments: readonly ("dev" | "staging" | "prod")[],
): { call: ToolCall; tool: ToolDescriptor; r: () => number } {
  const r = rng(seed + i * 7919);
  const tool = pick(tools, r);
  const amount = Math.max(1, Math.floor(r() * 1_000_000));
  const count = Math.max(1, Math.floor(r() * 10_000));
  const call: ToolCall = {
    tenantId: `tenant-${split}-${seed}-${i}`,
    idempotencyKey: `case-${split}-${seed}-${i}`,
    tool: tool.name,
    args: {
      query: `q-${Math.floor(r() * 20)}`,
      ...requiredArgsFor(tool, r, amount, count),
    },
    goal: `goal-${Math.floor(r() * 8)}`,
    principal: `agent-${Math.floor(r() * 3)}`,
    permissionScope: r() > 0.5 ? "support:read" : "finance:write",
    environment: pick(environments, r),
    confidence: Number(r().toFixed(3)),
    confidenceModelVersion: "oracle-generator-v1",
  };
  return { call, tool, r };
}

/**
 * Generates one case for the given split. Each split constrains the
 * generation distribution in a way that's actually distinct from `random`,
 * not just a relabeling of the same distribution:
 *
 * - random: SEEN_TOOLS x {dev, staging}, DEFAULT_POLICY.
 * - template-held-out: HELD_OUT_TOOLS only — tools `random` never draws.
 * - policy-held-out: SEEN_TOOLS x {dev, staging}, but under HELD_OUT_POLICY
 *   (different version + thresholds than every other split uses).
 * - environment-held-out: SEEN_TOOLS, but environment forced to "prod" —
 *   a value `random` never draws.
 * - compositional: two calls sharing one tenant (search_orders, then a
 *   mutating call informed by it) — testing decision-equivalence across a
 *   causal chain, not an isolated single call.
 * - temporal: one call recorded at t0, replayed at t0 + policy.planTtlMs +
 *   1ms (past cache TTL expiry) — testing that an expired plan is not
 *   served as a hit, not just adding a timestamp field for show.
 */
export function generateSplitCase(split: SplitName, seed: number, i: number): SplitCase {
  switch (split) {
    case "random": {
      const { call } = baseCall(seed, i, split, SEEN_TOOLS, SEEN_ENVIRONMENTS);
      return { split, call, policy: DEFAULT_POLICY };
    }
    case "template-held-out": {
      const { call } = baseCall(seed, i, split, HELD_OUT_TOOLS, SEEN_ENVIRONMENTS);
      return { split, call, policy: DEFAULT_POLICY };
    }
    case "policy-held-out": {
      const { call } = baseCall(seed, i, split, SEEN_TOOLS, SEEN_ENVIRONMENTS);
      return { split, call, policy: HELD_OUT_POLICY };
    }
    case "environment-held-out": {
      const { call } = baseCall(seed, i, split, SEEN_TOOLS, ["prod"]);
      return { split, call, policy: DEFAULT_POLICY };
    }
    case "compositional": {
      const { call, r } = baseCall(seed, i, split, SEEN_TOOLS, SEEN_ENVIRONMENTS);
      const secondTool = pick(
        SEEN_TOOLS.filter((t) => t.name !== call.tool),
        r,
      );
      const amount2 = Math.max(1, Math.floor(r() * 1_000_000));
      const count2 = Math.max(1, Math.floor(r() * 10_000));
      const secondCall: ToolCall = {
        ...call,
        idempotencyKey: `${call.idempotencyKey}-step2`,
        tool: secondTool.name,
        args: {
          query: `q-followup-${Math.floor(r() * 20)}`,
          ...requiredArgsFor(secondTool, r, amount2, count2),
        },
      };
      return { split, call, policy: DEFAULT_POLICY, secondCall };
    }
    case "temporal": {
      const { call } = baseCall(seed, i, split, SEEN_TOOLS, SEEN_ENVIRONMENTS);
      return { split, call, policy: DEFAULT_POLICY, replayAtMs: DEFAULT_POLICY.planTtlMs + 1 };
    }
  }
}

export { SEEN_TOOLS, HELD_OUT_TOOLS, SEEN_ENVIRONMENTS };
