import type { Reversibility, ToolDescriptor } from "./types";

/**
 * Policy config. Every ARC decision is stamped with `version` so a stored
 * decision stays reproducible: which policy, which rule, which model.
 */
export interface Policy {
  version: string;
  /** Confirmation matrix over reversibility x blast radius. */
  thresholds: Record<Reversibility, number>;
  /** Confidence below this raises severity — it can never lower it. */
  lowConfidenceCutoff: number;
  confirmationTimeoutMs: number;
  /** On timeout: auto-deny (safe) or escalate to a secondary approver. */
  onTimeout: "deny" | "escalate";
  escalationApprover?: string | undefined;
  /** Minimum verified executions before a cached plan may be served. */
  coldStartFloor: number;
  similarityThreshold: number;
  cacheEnabled?: boolean;
  reliabilityFloor: number;
  planTtlMs: number;
  maxConsecutiveDegradations: number;
  /** Per-tenant request quota per window on GuardRuntime's own API. */
  rateLimit: { windowMs: number; max: number };
}

export function validatePolicy(policy: Policy): void {
  if (!policy || typeof policy !== "object")
    throw new Error("invalid policy: policy object is required");
  if (!policy.version || typeof policy.version !== "string")
    throw new Error("invalid policy: version is required");
  for (const [name, value] of Object.entries(policy.thresholds ?? {})) {
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new Error(`invalid policy: threshold ${name} must be within [0,1]`);
  }
  for (const name of ["destructive", "recoverable", "reversible"] as const) {
    if (!(name in policy.thresholds)) throw new Error(`invalid policy: missing threshold ${name}`);
  }
  if (
    policy.thresholds.destructive !== 0 ||
    policy.thresholds.recoverable > policy.thresholds.reversible
  ) {
    throw new Error("invalid policy: confirmation thresholds are ambiguous");
  }
  if (
    !Number.isFinite(policy.lowConfidenceCutoff) ||
    policy.lowConfidenceCutoff < 0 ||
    policy.lowConfidenceCutoff > 1
  )
    throw new Error("invalid policy: lowConfidenceCutoff must be within [0,1]");
  if (!Number.isFinite(policy.confirmationTimeoutMs) || policy.confirmationTimeoutMs <= 0)
    throw new Error("invalid policy: confirmationTimeoutMs must be positive");
  if (!Number.isInteger(policy.coldStartFloor) || policy.coldStartFloor < 1)
    throw new Error("invalid policy: coldStartFloor must be >= 1");
  if (
    !Number.isFinite(policy.similarityThreshold) ||
    policy.similarityThreshold < 0 ||
    policy.similarityThreshold > 1
  )
    throw new Error("invalid policy: similarityThreshold must be within [0,1]");
  if (
    !Number.isFinite(policy.reliabilityFloor) ||
    policy.reliabilityFloor < 0 ||
    policy.reliabilityFloor > 1
  )
    throw new Error("invalid policy: reliabilityFloor must be within [0,1]");
  if (!Number.isFinite(policy.planTtlMs) || policy.planTtlMs <= 0)
    throw new Error("invalid policy: planTtlMs must be positive");
  if (!Number.isInteger(policy.maxConsecutiveDegradations) || policy.maxConsecutiveDegradations < 1)
    throw new Error("invalid policy: maxConsecutiveDegradations must be >= 1");
  if (
    !Number.isFinite(policy.rateLimit.windowMs) ||
    policy.rateLimit.windowMs <= 0 ||
    !Number.isInteger(policy.rateLimit.max) ||
    policy.rateLimit.max <= 0
  )
    throw new Error("invalid policy: rateLimit must be positive");
  if (policy.onTimeout === "escalate" && !policy.escalationApprover)
    throw new Error("invalid policy: escalationApprover required when timeout escalates");
}

export const DEFAULT_POLICY: Policy = {
  version: "policy-2026.08.1",
  thresholds: {
    // Destructive always confirms, regardless of blast radius.
    destructive: 0,
    // Recoverable confirms only above a blast-radius threshold.
    recoverable: 0.35,
    reversible: 0.85,
  },
  lowConfidenceCutoff: 0.6,
  confirmationTimeoutMs: 60 * 60 * 1000,
  onTimeout: "deny",
  escalationApprover: "security-oncall",
  coldStartFloor: 3,
  similarityThreshold: 0.86,
  cacheEnabled: true,
  reliabilityFloor: 0.7,
  planTtlMs: 90 * 24 * 60 * 60 * 1000,
  maxConsecutiveDegradations: 2,
  rateLimit: { windowMs: 60_000, max: 240 },
};

/** Curated seed ruleset — extensible via config, not a hardcoded final list. */
export const SEED_TOOLS: ToolDescriptor[] = [
  {
    name: "search_orders",
    reversibility: "reversible",
    resourceType: "order",
    schemaVersion: "1.0.0",
    blastRadiusTier: 0.05,
    schema: { type: "object", properties: { query: { type: "string", required: true } } },
  },
  {
    name: "send_email",
    reversibility: "destructive",
    resourceType: "message",
    schemaVersion: "1.2.0",
    affectedCountField: "recipients",
    blastRadiusTier: 0.4,
    schema: {
      type: "object",
      properties: {
        recipients: { type: "number", min: 1, max: 10000, required: true },
        subject: { type: "string" },
        body: { type: "string" },
      },
    },
  },
  {
    name: "issue_refund",
    reversibility: "recoverable",
    resourceType: "payment",
    schemaVersion: "2.1.0",
    magnitudeField: "amount_usd",
    schema: {
      type: "object",
      properties: { amount_usd: { type: "number", min: 0, max: 1_000_000_000, required: true } },
    },
  },
  {
    name: "cancel_subscription",
    reversibility: "recoverable",
    resourceType: "subscription",
    schemaVersion: "1.4.0",
    blastRadiusTier: 0.45,
    schema: { type: "object", properties: { subscription_id: { type: "string", required: true } } },
  },
  {
    name: "wire_transfer",
    reversibility: "destructive",
    resourceType: "payment",
    schemaVersion: "3.0.0",
    magnitudeField: "amount_usd",
    schema: {
      type: "object",
      properties: {
        amount_usd: { type: "number", min: 0, max: 1_000_000_000, required: true },
        memo: { type: "string" },
      },
    },
  },
  {
    name: "delete_workspace",
    reversibility: "recoverable",
    // No compensating action registered on purpose: ARC downgrades it.
    resourceType: "workspace",
    schemaVersion: "1.0.0",
    affectedCountField: "member_count",
    schema: {
      type: "object",
      properties: { member_count: { type: "number", min: 0, max: 1_000_000, required: true } },
    },
  },
];
