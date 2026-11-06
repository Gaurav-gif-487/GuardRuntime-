import type { ToolSchemaDefinition } from "./schema-validator";
/** Core GuardRuntime types (v2 architecture). */

export type Reversibility = "reversible" | "recoverable" | "destructive";
export type Environment = "prod" | "staging" | "dev";

export interface ToolDescriptor {
  name: string;
  /** Declared reversibility by the tool author. Downgraded when unbacked. */
  reversibility: Reversibility;
  /** Required for `recoverable`; without it the tool is treated as destructive. */
  compensatingAction?: string;
  /** Static fallback blast radius tier when no numeric signal is extractable. */
  blastRadiusTier?: number;
  /** Field on the args holding a monetary/− magnitude signal. */
  magnitudeField?: string;
  /** Field holding a count of affected resources/users. */
  affectedCountField?: string;
  resourceType: string;
  schemaVersion: string;
  /** Optional strict boundary schema for tool arguments. */
  schema?: ToolSchemaDefinition;
  /** Explicit, logged, per-tool opt-in. Never a default. */
  failOpen?: boolean;
}

export interface ToolCall {
  tenantId: string;
  idempotencyKey: string;
  tool: string;
  args: Record<string, unknown>;
  goal: string;
  principal: string;
  permissionScope: string;
  environment: Environment;
  /** Optional agent uncertainty. Can only increase gating, never suppress it. */
  confidence?: number | undefined;
  confidenceModelVersion?: string | undefined;
}

export interface RiskDecision {
  reversibility: Reversibility;
  /** Continuous severity in [0,1]. */
  blastRadius: number;
  severity: number;
  requiresConfirmation: boolean;
  ruleId: string;
  policyVersion: string;
  confidenceModelVersion?: string | undefined;
  rationale: string[];
  downgradedForMissingCompensation: boolean;
}

export type ConfirmationState =
  "pending" | "approved" | "denied" | "modified" | "timed_out" | "escalated";

export interface AuthenticatedApprover {
  id: string;
  email?: string;
  roles: string[];
  authenticatedAt: number;
}

export interface ConfirmationRecord {
  id: string;
  tenantId: string;
  idempotencyKey: string;
  principal: string;
  permissionScope: string;
  environment: Environment;
  tool: string;
  /** Exact normalized action/context fingerprint reviewed by the approver. */
  actionFingerprint: string;
  /** Current policy version and state fingerprint observed at approval creation. */
  policyVersion: string;
  stateFingerprint: string;
  /** Sanitised, injection-filtered question shown to the approver. */
  question: string;
  /** Raw args are kept as data fields only — never inlined into prompts. */
  dataFields: Record<string, string>;
  state: ConfirmationState;
  createdAt: number;
  expiresAt: number;
  approver?: { id: string; method: "oidc" | "sso"; at: number };
  modifiedArgs?: Record<string, unknown>;
  escalatedTo?: string | undefined;
  risk: RiskDecision;
}

export interface AuthorizationContext {
  tenantId: string;
  principal: string;
  normalizedRequestFingerprint: string;
  policyFingerprint: string;
  capabilityFingerprint: string;
  environmentFingerprint: string;
  runtimeStateFingerprint: string;
}

export interface AuthorizationDecision {
  outcome: "allow" | "block" | "require_confirmation";
  reasons: string[];
  policyVersion: string;
  stateFingerprint: string;
  issuedAt: number;
  expiresAt: number;
  traceId: string;
  safeToExecuteNow: boolean;
}

export interface ExecutionPlan {
  id: string;
  tool: string;
  scopeFingerprint: string;
  steps: string[];
  createdAt: number;
  expiresAt: number;
}

export interface CachedPlan {
  id: string;
  tenantId: string;
  tool: string;
  permissionScope: string;
  resourceType: string;
  environment: Environment;
  schemaVersion: string;
  goal: string;
  embedding: number[];
  steps: string[];
  executions: number;
  verifiedSuccesses: number;
  consecutiveDegradations: number;
  reliability: number;
  lastUsedAt: number;
  evictedReason?: string;
  /** Execution metadata only. A cached plan is never an authorization grant. */
  executionPlan: ExecutionPlan;
  /** Exact normalized request scope used to ensure the plan remains applicable. */
  planFingerprint: string;
}

export type AuditEventType =
  | "authorization_decision"
  | "arc_decision"
  | "cm_transition"
  | "cache_hit"
  | "cache_miss"
  | "cache_evicted"
  | "tool_executed"
  | "tool_blocked"
  | "tool_failed"
  | "outcome_verification_failed"
  | "fail_safe_activated"
  | "idempotent_replay"
  | "outcome_verified"
  | "policy_updated";

export interface AuditEntry {
  seq: number;
  ts: number;
  tenantId: string;
  type: AuditEventType;
  principal: string;
  policyVersion: string;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export type Outcome =
  | { status: "executed"; result: unknown; viaCache: boolean }
  | { status: "blocked"; reason: string }
  | { status: "failed"; reason: string }
  | { status: "pending_confirmation"; confirmationId: string }
  | { status: "replayed"; result: unknown };
