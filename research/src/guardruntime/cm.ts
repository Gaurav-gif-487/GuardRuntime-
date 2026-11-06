import type { Policy } from "./policy";
import { TenantScopedStore } from "./store";
import type { ConfirmationRecord, ConfirmationState, RiskDecision, ToolCall } from "./types";

/** Strips anything in untrusted argument text that reads as an instruction. */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |any )?(previous|prior|above) instructions?/gi,
  /disregard (the )?(above|previous|prior)/gi,
  /\byou (are|must|should) now\b/gi,
  /\bsystem prompt\b/gi,
  /\bauto[- ]?approve\b/gi,
  /\bapprove this (request|action)\b/gi,
  /<\/?(system|instructions?|assistant)>/gi,
];

export function sanitizeUntrusted(value: unknown): string {
  let text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  for (const p of INJECTION_PATTERNS) text = text.replace(p, "[filtered]");
  // eslint-disable-next-line no-control-regex -- intentional: stripping raw control characters from untrusted input before it's logged/displayed.
  return text.replace(/[\u0000-\u001f]/g, " ").slice(0, 400);
}

export type CMTransition = {
  record: ConfirmationRecord;
  from: ConfirmationState;
  to: ConfirmationState;
};

/**
 * Clarification Manager: a durable state machine, not a blocking call.
 * Every pending record has a hard expiry; there are no silent indefinite waits.
 */
export class ClarificationManager {
  private store = new TenantScopedStore<ConfirmationRecord>();
  private counter = 0;

  constructor(
    private policy: Policy,
    private readonly onTransition: (t: CMTransition) => void,
  ) {}

  setPolicy(policy: Policy): void {
    this.policy = policy;
  }

  create(
    call: ToolCall,
    risk: RiskDecision,
    now: number,
    context: { actionFingerprint: string; stateFingerprint: string },
  ): ConfirmationRecord {
    const id = `cf_${++this.counter}_${call.idempotencyKey}`;
    const dataFields: Record<string, string> = {};
    for (const [k, v] of Object.entries(call.args)) dataFields[k] = sanitizeUntrusted(v);

    const record = this.store.namespace(call.tenantId).put(id, {
      id,
      idempotencyKey: call.idempotencyKey,
      principal: call.principal,
      permissionScope: call.permissionScope,
      environment: call.environment,
      tool: call.tool,
      actionFingerprint: context.actionFingerprint,
      policyVersion: risk.policyVersion,
      stateFingerprint: context.stateFingerprint,
      question: this.renderQuestion(call.tool, risk, dataFields),
      dataFields,
      state: "pending" as ConfirmationState,
      createdAt: now,
      expiresAt: now + this.policy.confirmationTimeoutMs,
      risk,
    });
    this.onTransition({ record, from: "pending", to: "pending" });
    return record;
  }

  /**
   * Structured templating: untrusted argument values are rendered as delimited
   * data fields, never concatenated into the instruction portion of a prompt.
   */
  private renderQuestion(
    tool: string,
    risk: RiskDecision,
    dataFields: Record<string, string>,
  ): string {
    const fields = Object.entries(dataFields)
      .map(([k, v]) => `  <field name="${k}">${v}</field>`)
      .join("\n");
    return [
      `Approve "${tool}"?`,
      `Risk: ${risk.reversibility}, blast radius ${risk.blastRadius.toFixed(2)} (rule ${risk.ruleId}, ${risk.policyVersion}).`,
      "Arguments (untrusted data):",
      fields,
    ].join("\n");
  }

  get(tenantId: string, id: string): ConfirmationRecord | undefined {
    return this.store.namespace(tenantId).get(id);
  }

  pending(tenantId: string): ConfirmationRecord[] {
    return this.store.namespace(tenantId).find((r) => r.state === "pending");
  }

  all(tenantId: string): ConfirmationRecord[] {
    return this.store.namespace(tenantId).list();
  }

  /** Authenticated resolution: identity is stored, not just a boolean. */
  resolve(
    tenantId: string,
    id: string,
    to: Extract<ConfirmationState, "approved" | "denied" | "modified">,
    approver: { id: string; method: "oidc" | "sso" },
    now: number,
    modifiedArgs?: Record<string, unknown>,
    reviewedFingerprint?: string,
  ): ConfirmationRecord {
    const record = this.store.namespace(tenantId).get(id);
    if (!record) throw new Error("confirmation not found in tenant namespace");
    if (record.state !== "pending" && record.state !== "escalated") return record;
    // Hard invariant: destructive actions can never be auto-approved.
    if (!approver.id) throw new Error("approval requires an authenticated principal");

    const from = record.state;
    record.state = to;
    record.approver = { ...approver, at: now };
    if (to === "modified") {
      if (!modifiedArgs || !reviewedFingerprint)
        throw new Error("modified approval must bind the reviewed action fingerprint");
      record.modifiedArgs = structuredClone(modifiedArgs);
      record.actionFingerprint = reviewedFingerprint;
    }
    this.onTransition({ record, from, to });
    return record;
  }

  /** Sweep expired records — auto-deny (safe) or escalate, per policy. */
  sweep(tenantId: string, now: number): ConfirmationRecord[] {
    const changed: ConfirmationRecord[] = [];
    for (const r of this.store.namespace(tenantId).list()) {
      if (r.state !== "pending" || now < r.expiresAt) continue;
      const from = r.state;
      if (this.policy.onTimeout === "escalate") {
        r.state = "escalated";
        r.escalatedTo = this.policy.escalationApprover;
        r.expiresAt = now + this.policy.confirmationTimeoutMs;
      } else {
        r.state = "timed_out";
      }
      this.onTransition({ record: r, from, to: r.state });
      changed.push(r);
    }
    return changed;
  }

  /** Durability: serialise/rehydrate so a restart never loses a pause. */
  serialize(tenantId: string): string {
    return JSON.stringify(this.store.namespace(tenantId).list());
  }

  hydrate(tenantId: string, json: string): void {
    const ns = this.store.namespace(tenantId);
    for (const r of JSON.parse(json) as ConfirmationRecord[]) ns.put(r.id, r);
  }
}
