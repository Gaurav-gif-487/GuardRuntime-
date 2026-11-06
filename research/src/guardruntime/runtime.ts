import { ActionRiskClassifier } from "./arc";
import { AuditLog } from "./audit";
import { ClarificationManager } from "./cm";
import { Metrics } from "./metrics";
import { PlanCache, type ExecutionPlanCache } from "./pcr";
import { DEFAULT_POLICY, SEED_TOOLS, type Policy, validatePolicy } from "./policy";
import { RateLimiter, TenantScopedStore } from "./store";
import {
  CumulativeBudgetManager,
  type BudgetConfig,
  DEFAULT_BUDGET_CONFIG,
} from "./cumulative-budget";
import { TemporalReversibilityEngine } from "./temporal-reversibility";
import { BehavioralDriftDetector, type DriftConfig, DEFAULT_DRIFT_CONFIG } from "./drift-detector";
import { SchemaValidator } from "./schema-validator";
import { TelemetryTracer } from "./telemetry";
import { TaintTracker, DEFAULT_FLOW_POLICY, type FlowPolicy } from "./taint";
import { CapabilityGate, type CapabilityManifest } from "./capabilities";
import { DecisionTraceEngine, type StructuredExplanation } from "./decision-trace";
import type {
  Outcome,
  ToolCall,
  ToolDescriptor,
  RiskDecision,
  AuthorizationDecision,
} from "./types";
import { canonical, sha256Hex } from "./sha256";

interface IdempotencyRecord {
  tenantId: string;
  key: string;
  outcome: Outcome;
  at: number;
  actionFingerprint: string;
}

export type ToolImpl = (args: Record<string, unknown>) => unknown | Promise<unknown>;
export type OutcomeVerifier = (
  call: ToolCall,
  result: unknown,
) =>
  | { ok: boolean; source: "env_state_check" | "user_feedback" | "verifier_pass" }
  | Promise<{ ok: boolean; source: "env_state_check" | "user_feedback" | "verifier_pass" }>;

export type AuthorizationStateResolver = (call: ToolCall) => unknown | Promise<unknown>;
export type AuthorizationStateCheck = (
  call: ToolCall,
  state: unknown,
) => { allowed: boolean; reason?: string } | Promise<{ allowed: boolean; reason?: string }>;

export interface RuntimeOptions {
  policy?: Policy;
  tools?: ToolDescriptor[];
  now?: () => number;
  compensatingActions?: Record<string, ToolImpl>;
  executeTool?: ToolImpl;
  verifyOutcome?: OutcomeVerifier;
  budgetConfig?: BudgetConfig;
  driftConfig?: DriftConfig;
  flowPolicy?: FlowPolicy;
  capabilityManifests?: CapabilityManifest[];
  /** Optional injected non-authorizing execution-plan cache for experiments/deployment adapters. */
  planCache?: ExecutionPlanCache;
  /** Current resource/dependency state consulted before authorization. */
  resolveAuthorizationState?: AuthorizationStateResolver;
  /** Optional policy/application-specific check over the resolved current state. */
  authorizeCurrentState?: AuthorizationStateCheck;
  /** Development/test escape hatch. Production defaults to deny without a manifest. */
  allowUnmanifestedPrincipals?: boolean;
}

/**
 * GuardRuntime request-control pipeline:
 * Schema Sanitization → Tenant Rate Limit → Idempotency → Plan Cache → Capability Gate →
 * Information Flow Taint Tracking → Dynamic Temporal Decay → Behavioral Drift Check →
 * Cumulative State Slicing Budget → 2-Axis ARC Classifier → Fail-Safe Closed →
 * Durable HITL Pause (OIDC) → Tool Execution & Independent Verification →
 * Merkle Tree Hash-Chain & Causal Attribution DAG & OTel Span.
 */
export class GuardRuntime {
  readonly arc: ActionRiskClassifier;
  readonly cm: ClarificationManager;
  readonly cache: ExecutionPlanCache;
  readonly audit = new AuditLog();
  readonly metrics = new Metrics();
  readonly budgetManager: CumulativeBudgetManager;
  readonly temporalEngine: TemporalReversibilityEngine;
  readonly driftDetector: BehavioralDriftDetector;
  readonly tracer: TelemetryTracer;
  readonly taintTracker: TaintTracker;
  readonly capabilityGate: CapabilityGate;

  private policy: Policy;
  private idempotency = new TenantScopedStore<IdempotencyRecord>();
  private inFlight = new Map<string, { fingerprint: string; promise: Promise<Outcome> }>();
  private resumeInFlight = new Map<string, Promise<Outcome>>();
  private limiter: RateLimiter;
  private impls = new Map<string, ToolImpl>();
  private clock: () => number;
  private readonly executeTool?: ToolImpl | undefined;
  private readonly verifyOutcome?: OutcomeVerifier | undefined;
  private readonly allowUnmanifestedPrincipals: boolean;
  private readonly resolveAuthorizationState?: AuthorizationStateResolver | undefined;
  private readonly authorizeCurrentState?: AuthorizationStateCheck | undefined;
  /** Simulated health of the GuardRuntime service itself. */
  private healthy = true;

  constructor(opts: RuntimeOptions = {}) {
    this.policy = opts.policy ?? DEFAULT_POLICY;
    validatePolicy(this.policy);
    this.clock = opts.now ?? (() => Date.now());
    this.allowUnmanifestedPrincipals = opts.allowUnmanifestedPrincipals ?? false;
    this.resolveAuthorizationState = opts.resolveAuthorizationState;
    this.authorizeCurrentState = opts.authorizeCurrentState;
    this.executeTool = opts.executeTool;
    this.verifyOutcome = opts.verifyOutcome;
    this.tracer = new TelemetryTracer(this.clock);

    const tools = new Map((opts.tools ?? SEED_TOOLS).map((t) => [t.name, t]));
    this.arc = new ActionRiskClassifier(tools, this.policy, {
      hasCompensatingAction: (name) => typeof opts.compensatingActions?.[name] === "function",
    });
    this.cache = opts.planCache ?? new PlanCache(this.policy);
    this.limiter = new RateLimiter(this.policy.rateLimit.windowMs, this.policy.rateLimit.max);

    this.budgetManager = new CumulativeBudgetManager(
      opts.budgetConfig ?? DEFAULT_BUDGET_CONFIG,
      this.metrics,
      this.clock,
    );
    this.temporalEngine = new TemporalReversibilityEngine(undefined, this.clock);
    this.driftDetector = new BehavioralDriftDetector(
      opts.driftConfig ?? DEFAULT_DRIFT_CONFIG,
      this.metrics,
      this.clock,
    );

    this.taintTracker = new TaintTracker(
      opts.flowPolicy ?? DEFAULT_FLOW_POLICY,
      undefined,
      this.clock,
    );
    this.capabilityGate = new CapabilityGate(opts.capabilityManifests ?? [], this.clock);

    this.cm = new ClarificationManager(this.policy, ({ record, from, to }) => {
      this.audit.append({
        tenantId: record.tenantId,
        type: "cm_transition",
        principal: record.approver?.id ?? "system",
        policyVersion: this.policy.version,
        ts: this.clock(),
        payload: { confirmationId: record.id, from, to, tool: record.tool },
      });
      this.metrics.inc("cm_transitions_total", { to, tenant: record.tenantId });
    });
  }

  setPolicy(policy: Policy): void {
    validatePolicy(policy);
    this.policy = policy;
    this.arc.setPolicy(policy);
    this.cm.setPolicy(policy);
    this.cache.setPolicy(policy);
  }

  getPolicy(): Policy {
    return this.policy;
  }

  registerTool(descriptor: ToolDescriptor, impl?: ToolImpl): void {
    this.arc.register(descriptor);
    if (impl) this.impls.set(descriptor.name, impl);
  }

  /** Chaos hook: take GuardRuntime itself down and assert fail-closed. */
  setHealthy(healthy: boolean): void {
    this.healthy = healthy;
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  async call(call: ToolCall): Promise<Outcome> {
    let fingerprint: string;
    try {
      fingerprint = sha256Hex(canonical(call));
    } catch {
      return this.blocked(call, "request could not be deterministically normalized");
    }
    const key = `${call.tenantId}:${call.idempotencyKey}`;
    const existing = this.inFlight.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        return this.blocked(call, "idempotency key is concurrently bound to a different action");
      return existing.promise;
    }
    const promise = this.callInternal(call);
    this.inFlight.set(key, { fingerprint, promise });
    try {
      return await promise;
    } finally {
      const current = this.inFlight.get(key);
      if (current?.promise === promise) this.inFlight.delete(key);
    }
  }

  private async callInternal(call: ToolCall): Promise<Outcome> {
    const started = this.clock();
    const span = this.tracer.startSpan(`guardruntime.call.${call.tool}`, {
      "guardruntime.tool": call.tool,
      "guardruntime.tenant_id": call.tenantId,
      "guardruntime.principal": call.principal,
      "guardruntime.environment": call.environment,
    });

    // Resolve descriptor before boundary validation so tool-specific schemas apply.
    const descriptor = this.arc.descriptor(call.tool);

    // 1. Structural Schema Validation & Prototype Pollution Defense
    const schemaValidation = SchemaValidator.validate(call.args, descriptor?.schema);
    if (!schemaValidation.valid) {
      this.metrics.inc("schema_violations_total", { tenant: call.tenantId, tool: call.tool });
      span.end("ERROR", schemaValidation.errors.join("; "));
      return this.blocked(call, `Schema validation failed: ${schemaValidation.errors.join("; ")}`);
    }
    // From this point onward, only the detached normalized arguments are used.
    call = { ...call, args: schemaValidation.sanitizedArgs };

    // 2. Tenant Rate Limiting
    if (!this.limiter.allow(call.tenantId, started)) {
      this.metrics.inc("rate_limited_total", { tenant: call.tenantId });
      span.end("ERROR", "tenant rate limit exceeded");
      return this.blocked(call, "tenant rate limit exceeded");
    }

    const scope = {
      tool: call.tool,
      resourceType: descriptor?.resourceType ?? "unknown",
      schemaVersion: descriptor?.schemaVersion ?? "0",
    };
    const requestFingerprint = this.requestFingerprint(call, descriptor, scope);

    // 3. Idempotency is bound to the exact normalized request. Reusing a key
    // with changed authorization inputs is a conflict, never a replay.
    const ns = this.idempotency.namespace(call.tenantId);
    const prior = ns.get(call.idempotencyKey);
    if (prior) {
      if (prior.actionFingerprint !== requestFingerprint) {
        span.end("ERROR", "idempotency key reused for a different action");
        return this.blocked(call, "idempotency key is already bound to a different action");
      }
      this.metrics.inc("idempotent_replays_total", { tenant: call.tenantId });
      this.log(call, "idempotent_replay", { idempotencyKey: call.idempotencyKey });
      span.setAttribute("guardruntime.status", prior.outcome.status);
      span.end("OK");
      return prior.outcome;
    }

    // 4. Capability authorization is deny-by-default. There is no implicit
    // capability just because a principal has no registered manifest.
    try {
      const manifest = this.capabilityGate.getManifest(call.tenantId, call.principal);
      if (!manifest && !this.allowUnmanifestedPrincipals) {
        this.metrics.inc("capability_violations_total", {
          tenant: call.tenantId,
          principal: call.principal,
        });
        span.end("ERROR", "No capability manifest");
        return this.blocked(
          call,
          `Principal "${call.principal}" has no registered capability manifest`,
        );
      }
      if (manifest || !this.allowUnmanifestedPrincipals) {
        const capCheck = this.capabilityGate.check(
          call,
          scope.resourceType,
          descriptor?.blastRadiusTier ?? 0.5,
        );
        if (!capCheck.authorized) {
          this.metrics.inc("capability_violations_total", {
            tenant: call.tenantId,
            principal: call.principal,
          });
          span.end("ERROR", capCheck.reason ?? "Capability authorization failed");
          return this.blocked(call, capCheck.reason ?? "Capability authorization failed");
        }
      }
    } catch (error) {
      span.end("ERROR", "capability state resolution failed");
      return this.blocked(
        call,
        `Capability authorization failed closed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // 5. Information Flow Control (IFC) & Taint Policy Gate
    let taintViolations: ReturnType<TaintTracker["checkFlow"]>;
    try {
      taintViolations = this.taintTracker.checkFlow(call.tenantId, call.tool);
      const blockingTaintViolation = taintViolations.find((v) => v.severity === "block");
      if (blockingTaintViolation) {
        this.metrics.inc("taint_violations_total", { tenant: call.tenantId, tool: call.tool });
        span.end("ERROR", `Taint flow violation: ${blockingTaintViolation.rationale}`);
        return this.blocked(
          call,
          `Taint flow violation: Cannot flow ${blockingTaintViolation.taintLabel} data from ${blockingTaintViolation.sourceTool} to ${blockingTaintViolation.sinkTool} (${blockingTaintViolation.rationale})`,
        );
      }
    } catch (error) {
      span.end("ERROR", "taint state resolution failed");
      return this.blocked(
        call,
        `Taint authorization failed closed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let currentAuthorizationState: unknown = null;
    try {
      currentAuthorizationState = this.resolveAuthorizationState
        ? await this.resolveAuthorizationState(call)
        : null;
      if (this.authorizeCurrentState) {
        const stateCheck = await this.authorizeCurrentState(call, currentAuthorizationState);
        if (!stateCheck.allowed)
          return this.blocked(
            call,
            stateCheck.reason ?? "Current resource/dependency state is not authorized",
          );
      }
    } catch (error) {
      span.end("ERROR", "current authorization state resolution failed");
      return this.blocked(
        call,
        `Current authorization state failed closed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // 6. Execution-plan cache. It can save plan preparation only; it is never
    // an authorization source and therefore never replaces current-state ARC.
    const planFingerprint = this.planFingerprint(call, descriptor, scope);
    let cachedPlanId: string | undefined;
    let viaCache = false;
    try {
      const hit = this.cache.lookup(call, scope, started, planFingerprint);
      if (hit.reason === "hit" && hit.plan) {
        cachedPlanId = hit.plan.id;
        viaCache = true;
        this.metrics.inc("cache_hits_total", { tenant: call.tenantId });
        this.log(call, "cache_hit", {
          planId: hit.plan.id,
          similarity: Number(hit.similarity.toFixed(3)),
          reliability: hit.plan.reliability,
        });
      } else {
        this.metrics.inc("cache_misses_total", { reason: hit.reason, tenant: call.tenantId });
        this.log(call, "cache_miss", {
          reason: hit.reason,
          similarity: Number(hit.similarity.toFixed(3)),
        });
      }
    } catch (error) {
      this.metrics.inc("cache_failures_total", { tenant: call.tenantId });
      this.log(call, "cache_miss", {
        reason: "cache_failure",
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // 7. ARC always evaluates the exact current action and authorization context.
    let risk: RiskDecision;
    try {
      risk = this.arc.classify(call);
      this.metrics.inc("risk_decisions_total", {
        reversibility: risk.reversibility,
        tenant: call.tenantId,
      });
    } catch (error) {
      span.end("ERROR", "risk classifier failure");
      return this.blocked(
        call,
        `Risk classification failed closed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // 8. Dynamic Temporal Saga Decay
    const executedAt = Number(call.args["_executedAt"] ?? started);
    let temporalStatus: ReturnType<TemporalReversibilityEngine["evaluateReversibility"]>;
    try {
      temporalStatus = this.temporalEngine.evaluateReversibility(call.tool, executedAt);
    } catch (error) {
      return this.remember(
        call,
        this.blocked(
          call,
          `Temporal state resolution failed closed: ${error instanceof Error ? error.message : String(error)}`,
        ),
        started,
        requestFingerprint,
      );
    }
    if (temporalStatus.isDegraded) {
      risk = {
        ...risk,
        reversibility: "destructive",
        requiresConfirmation: true,
        rationale: [...risk.rationale, temporalStatus.rationale],
      };
    }

    // 9. Behavioral Drift & Quarantine Check
    let inCooldown = false;
    try {
      inCooldown = this.driftDetector.isAgentInCooldown(call.tenantId, call.principal);
    } catch (error) {
      return this.remember(
        call,
        this.blocked(
          call,
          `Drift state resolution failed closed: ${error instanceof Error ? error.message : String(error)}`,
        ),
        started,
        requestFingerprint,
      );
    }
    if (inCooldown) {
      risk = {
        ...risk,
        requiresConfirmation: true,
        ruleId: "drift.agent_quarantine_cooldown",
        rationale: [
          ...risk.rationale,
          "Agent is in behavioral drift cooldown; all actions require confirmation.",
        ],
      };
    }

    // 10. Cumulative State Budgeting (Slicing / Sybil Attack Mitigation)
    let budgetStatus: ReturnType<CumulativeBudgetManager["evaluateBudget"]>;
    try {
      budgetStatus = this.budgetManager.evaluateBudget(call.tenantId, call.principal, call, risk);
    } catch (error) {
      return this.remember(
        call,
        this.blocked(
          call,
          `Budget state resolution failed closed: ${error instanceof Error ? error.message : String(error)}`,
        ),
        started,
        requestFingerprint,
      );
    }
    if (budgetStatus.budgetExceeded) {
      risk = {
        ...risk,
        requiresConfirmation: true,
        ruleId: "budget.cumulative_limit_exceeded",
        rationale: [
          ...risk.rationale,
          budgetStatus.exceededReason ?? "Cumulative budget exceeded.",
        ],
      };
    }

    const stateFingerprint = this.authorizationStateFingerprint(
      call,
      descriptor,
      risk,
      currentAuthorizationState,
    );
    this.log(call, "arc_decision", {
      ...risk,
      tool: call.tool,
      source: "classifier",
      stateFingerprint,
      idempotencyKey: call.idempotencyKey,
    });

    span.setAttribute("guardruntime.reversibility", risk.reversibility);
    span.setAttribute("guardruntime.blast_radius", risk.blastRadius);
    span.setAttribute("guardruntime.severity", risk.severity);
    span.setAttribute("guardruntime.gated", risk.requiresConfirmation);

    // 11. Fail-Safe Closed: Unhealthy runtime blocks non-low-risk actions
    if (!this.healthy) {
      if (
        !descriptor?.failOpen ||
        risk.reversibility !== "reversible" ||
        risk.requiresConfirmation
      ) {
        this.metrics.inc("fail_safe_activations_total", { tenant: call.tenantId });
        this.log(call, "fail_safe_activated", {
          severity: risk.severity,
          tool: call.tool,
          failOpen: false,
        });
        span.end("ERROR", "GuardRuntime unavailable — failed closed");
        return this.remember(
          call,
          this.blocked(call, "GuardRuntime unavailable — failed closed"),
          started,
          requestFingerprint,
        );
      }
      this.log(call, "fail_safe_activated", { failOpen: true, tool: call.tool });
    }

    const authorization = this.authorizationDecision(
      call,
      risk,
      stateFingerprint,
      sha256Hex(`${requestFingerprint}:${started}`).slice(0, 32),
    );
    this.log(call, "authorization_decision", authorization as unknown as Record<string, unknown>);

    // 12. Confirmation required → Durable Asynchronous Pause
    if (risk.requiresConfirmation) {
      const stateFingerprint = this.authorizationStateFingerprint(
        call,
        descriptor,
        risk,
        currentAuthorizationState,
      );
      const record = this.cm.create(call, risk, started, {
        actionFingerprint: requestFingerprint,
        stateFingerprint,
      });
      this.metrics.observeLatency(this.clock() - started);
      span.setAttribute("guardruntime.status", "pending_confirmation");
      span.end("OK");
      return this.remember(
        call,
        { status: "pending_confirmation", confirmationId: record.id },
        started,
        requestFingerprint,
      );
    }

    let finalAuthorizationState: unknown = currentAuthorizationState;
    try {
      finalAuthorizationState = this.resolveAuthorizationState
        ? await this.resolveAuthorizationState(call)
        : null;
      if (this.authorizeCurrentState) {
        const finalStateCheck = await this.authorizeCurrentState(call, finalAuthorizationState);
        if (!finalStateCheck.allowed)
          return this.remember(
            call,
            this.blocked(
              call,
              finalStateCheck.reason ?? "Current resource/dependency state is no longer authorized",
            ),
            started,
            requestFingerprint,
          );
      }
      if (canonical(finalAuthorizationState) !== canonical(currentAuthorizationState)) {
        return this.remember(
          call,
          this.blocked(call, "Current resource/dependency state changed before execution"),
          started,
          requestFingerprint,
        );
      }
    } catch (error) {
      return this.remember(
        call,
        this.blocked(
          call,
          `Current authorization state failed closed before execution: ${error instanceof Error ? error.message : String(error)}`,
        ),
        started,
        requestFingerprint,
      );
    }

    // 13. Final authorization re-check immediately before the side effect. This
    // is intentionally separate from the earlier decision so a future async or
    // distributed state lookup can invalidate the action without trusting stale state.
    const finalManifest = this.capabilityGate.getManifest(call.tenantId, call.principal);
    if (!finalManifest && !this.allowUnmanifestedPrincipals) {
      return this.remember(
        call,
        this.blocked(call, "current capability manifest is unavailable"),
        started,
        requestFingerprint,
      );
    }
    if (finalManifest || !this.allowUnmanifestedPrincipals) {
      const finalCap = this.capabilityGate.check(
        call,
        scope.resourceType,
        descriptor?.blastRadiusTier ?? 0.5,
      );
      if (!finalCap.authorized)
        return this.remember(
          call,
          this.blocked(call, finalCap.reason ?? "current capability authorization failed"),
          started,
          requestFingerprint,
        );
    }
    let finalRisk: RiskDecision;
    try {
      finalRisk = this.arc.classify(call);
      this.metrics.inc("risk_decisions_total", {
        reversibility: finalRisk.reversibility,
        tenant: call.tenantId,
      });
    } catch (error) {
      return this.remember(
        call,
        this.blocked(
          call,
          `Risk classification failed closed: ${error instanceof Error ? error.message : String(error)}`,
        ),
        started,
        requestFingerprint,
      );
    }
    if (
      finalRisk.reversibility !== risk.reversibility ||
      finalRisk.requiresConfirmation !== risk.requiresConfirmation ||
      finalRisk.ruleId !== risk.ruleId
    ) {
      return this.remember(
        call,
        this.blocked(call, "authorization changed before execution; action must be re-evaluated"),
        started,
        requestFingerprint,
      );
    }

    this.driftDetector.recordCall(
      call.tenantId,
      call.principal,
      call,
      finalRisk.reversibility,
      finalRisk.blastRadius,
    );
    this.budgetManager.recordUsage(call.tenantId, call.principal, call, finalRisk, false);
    this.taintTracker.recordExecution(call.tenantId, call.tool);

    let planId = cachedPlanId;
    if (!planId) {
      try {
        const plan = this.cache.record(
          call,
          scope,
          [`${call.tool}(...)`],
          started,
          planFingerprint,
        );
        planId = plan.id;
      } catch (error) {
        // Cache failure must never affect authorization. Execute without plan reuse.
        this.metrics.inc("cache_failures_total", { tenant: call.tenantId });
        this.log(call, "cache_miss", {
          reason: "cache_write_failure",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const outcome = await this.execute(
      call,
      planId ?? `ephemeral_${sha256Hex(requestFingerprint).slice(0, 16)}`,
      viaCache,
      started,
    );
    span.setAttribute("guardruntime.status", outcome.status);
    span.end("OK");
    return this.remember(call, outcome, started, requestFingerprint);
  }

  private requestFingerprint(
    call: ToolCall,
    descriptor: ToolDescriptor | undefined,
    scope: { tool: string; resourceType: string; schemaVersion: string },
  ): string {
    return sha256Hex(
      canonical({
        tenantId: call.tenantId,
        principal: call.principal,
        idempotencyKey: call.idempotencyKey,
        tool: call.tool,
        args: call.args,
        goal: call.goal,
        permissionScope: call.permissionScope,
        environment: call.environment,
        confidence: call.confidence,
        confidenceModelVersion: call.confidenceModelVersion,
        resourceType: scope.resourceType,
        schemaVersion: scope.schemaVersion,
        descriptor: descriptor
          ? {
              reversibility: descriptor.reversibility,
              compensatingAction: descriptor.compensatingAction,
              blastRadiusTier: descriptor.blastRadiusTier,
              magnitudeField: descriptor.magnitudeField,
              affectedCountField: descriptor.affectedCountField,
              failOpen: descriptor.failOpen,
            }
          : null,
      }),
    );
  }

  private planFingerprint(
    call: ToolCall,
    descriptor: ToolDescriptor | undefined,
    scope: { tool: string; resourceType: string; schemaVersion: string },
  ): string {
    return sha256Hex(
      canonical({
        tenantId: call.tenantId,
        principal: call.principal,
        tool: call.tool,
        args: call.args,
        goal: call.goal,
        permissionScope: call.permissionScope,
        environment: call.environment,
        resourceType: scope.resourceType,
        schemaVersion: scope.schemaVersion,
        descriptor: descriptor
          ? {
              magnitudeField: descriptor.magnitudeField,
              affectedCountField: descriptor.affectedCountField,
            }
          : null,
      }),
    );
  }

  private authorizationStateFingerprint(
    call: ToolCall,
    descriptor: ToolDescriptor | undefined,
    risk: RiskDecision,
    resolvedState: unknown = null,
  ): string {
    const scope = {
      tool: call.tool,
      resourceType: descriptor?.resourceType ?? "unknown",
      schemaVersion: descriptor?.schemaVersion ?? "0",
    };
    const manifest = this.capabilityGate.getManifest(call.tenantId, call.principal);
    const budget = this.budgetManager.evaluateBudget(call.tenantId, call.principal, call, risk);
    const temporal = this.temporalEngine.evaluateReversibility(
      call.tool,
      Number(call.args["_executedAt"] ?? this.clock()),
    );
    const taint = this.taintTracker.checkFlow(call.tenantId, call.tool);
    return sha256Hex(
      canonical({
        request: this.requestFingerprint(call, descriptor, scope),
        policy: this.policy,
        runtimeHealthy: this.healthy,
        resourceState: resolvedState,
        manifest,
        budget,
        temporal,
        taint,
        risk,
      }),
    );
  }

  private authorizationDecision(
    call: ToolCall,
    risk: RiskDecision,
    stateFingerprint: string,
    traceId: string,
  ): AuthorizationDecision {
    const outcome = risk.requiresConfirmation ? "require_confirmation" : "allow";
    return {
      outcome,
      reasons: [...risk.rationale],
      policyVersion: risk.policyVersion,
      stateFingerprint,
      issuedAt: this.clock(),
      expiresAt: this.clock() + this.policy.confirmationTimeoutMs,
      traceId,
      safeToExecuteNow: outcome === "allow" && this.healthy,
    };
  }

  /** Returns the exact action fingerprint that an authenticated approval UI must bind. */
  confirmationFingerprint(call: ToolCall, modifiedArgs?: Record<string, unknown>): string {
    const effective = modifiedArgs ? { ...call, args: modifiedArgs } : call;
    const descriptor = this.arc.descriptor(effective.tool);
    const scope = {
      tool: effective.tool,
      resourceType: descriptor?.resourceType ?? "unknown",
      schemaVersion: descriptor?.schemaVersion ?? "0",
    };
    return this.requestFingerprint(effective, descriptor, scope);
  }

  /** Resume only if the exact reviewed action and current authorization context still match. */
  async resume(tenantId: string, confirmationId: string, call: ToolCall): Promise<Outcome> {
    const key = `${tenantId}:${confirmationId}:${call.idempotencyKey}`;
    const existing = this.resumeInFlight.get(key);
    if (existing) return existing;
    const promise = this.resumeInternal(tenantId, confirmationId, call);
    this.resumeInFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      if (this.resumeInFlight.get(key) === promise) this.resumeInFlight.delete(key);
    }
  }

  private async resumeInternal(
    tenantId: string,
    confirmationId: string,
    call: ToolCall,
  ): Promise<Outcome> {
    const now = this.clock();
    const record = this.cm.get(tenantId, confirmationId);
    if (!record) return this.blocked(call, "unknown confirmation");
    if (
      record.tenantId !== call.tenantId ||
      record.principal !== call.principal ||
      record.tool !== call.tool ||
      record.permissionScope !== call.permissionScope ||
      record.environment !== call.environment
    ) {
      return this.blocked(call, "confirmation is bound to a different authorization context");
    }
    if (record.state !== "approved" && record.state !== "modified") {
      if (record.state === "pending" || record.state === "escalated")
        return { status: "pending_confirmation", confirmationId };
      return this.blocked(call, `confirmation ${record.state}`);
    }
    if (now >= record.expiresAt) {
      return this.blocked(call, "confirmation expired");
    }

    const args =
      record.state === "modified"
        ? this.validateArgs(call.tool, record.modifiedArgs ?? {})
        : call.args;
    const effective: ToolCall = { ...call, args };
    const descriptor = this.arc.descriptor(effective.tool);
    const scope = {
      tool: effective.tool,
      resourceType: descriptor?.resourceType ?? "unknown",
      schemaVersion: descriptor?.schemaVersion ?? "0",
    };
    const currentFingerprint = this.requestFingerprint(effective, descriptor, scope);
    if (currentFingerprint !== record.actionFingerprint) {
      return this.blocked(
        call,
        "confirmation is bound to a different action; fresh approval required",
      );
    }

    // Idempotent replay: if this exact (tenant, idempotencyKey) already
    // produced a *terminal* remembered outcome for this exact action (i.e. a
    // prior resume already executed or blocked it), replay it instead of
    // re-deriving current authorization state. Without this, resuming the
    // same confirmation twice (e.g. a duplicate webhook retry, or a client
    // that retries after a slow response) always fails the second time: the
    // first resume's own side effects (drift/budget/taint recording) change
    // the live authorization-state fingerprint that the second resume would
    // otherwise recompute and compare against the approval-time snapshot.
    // The initial call() itself already remembered a "pending_confirmation"
    // placeholder under this same key — that one must NOT be replayed here,
    // or resume() would return "pending_confirmation" forever and never run.
    const priorOutcome = this.idempotency.namespace(tenantId).get(call.idempotencyKey);
    if (
      priorOutcome &&
      priorOutcome.actionFingerprint === currentFingerprint &&
      priorOutcome.outcome.status !== "pending_confirmation"
    ) {
      this.metrics.inc("idempotent_replays_total", { tenant: call.tenantId });
      this.log(call, "idempotent_replay", { idempotencyKey: call.idempotencyKey });
      return priorOutcome.outcome;
    }

    if (record.policyVersion !== this.policy.version) {
      return this.blocked(call, "confirmation was issued under an obsolete policy version");
    }

    // Re-run current-state authorization. Approval is not a bypass.
    const manifest = this.capabilityGate.getManifest(tenantId, call.principal);
    if (!manifest && !this.allowUnmanifestedPrincipals)
      return this.blocked(call, "current capability manifest is unavailable");
    if (manifest || !this.allowUnmanifestedPrincipals) {
      const cap = this.capabilityGate.check(
        effective,
        scope.resourceType,
        descriptor?.blastRadiusTier ?? 0.5,
      );
      if (!cap.authorized)
        return this.blocked(call, cap.reason ?? "current capability authorization failed");
    }
    let risk: RiskDecision;
    try {
      risk = this.arc.classify(effective);
      this.metrics.inc("risk_decisions_total", {
        reversibility: risk.reversibility,
        tenant: call.tenantId,
      });
    } catch (error) {
      return this.blocked(
        call,
        `Risk classification failed closed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    let resumedState: unknown = null;
    try {
      resumedState = this.resolveAuthorizationState
        ? await this.resolveAuthorizationState(effective)
        : null;
      if (this.authorizeCurrentState) {
        const check = await this.authorizeCurrentState(effective, resumedState);
        if (!check.allowed)
          return this.blocked(
            call,
            check.reason ?? "Current resource/dependency state is not authorized",
          );
      }
    } catch (error) {
      return this.blocked(
        call,
        `Current authorization state failed closed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const stateFingerprint = this.authorizationStateFingerprint(
      effective,
      descriptor,
      risk,
      resumedState,
    );
    if (stateFingerprint !== record.stateFingerprint)
      return this.blocked(
        call,
        "authorization state changed since approval; fresh approval required",
      );
    if (risk.requiresConfirmation === false && record.risk.requiresConfirmation) {
      // A previously high-impact approval may not be weakened into a stale grant;
      // current policy/state still has to agree with the reviewed decision.
    }
    if (
      risk.reversibility !== record.risk.reversibility ||
      risk.ruleId !== record.risk.ruleId ||
      risk.requiresConfirmation !== record.risk.requiresConfirmation
    ) {
      return this.blocked(call, "current risk decision differs from the reviewed decision");
    }
    if (
      !this.healthy &&
      (!descriptor?.failOpen || risk.reversibility !== "reversible" || risk.requiresConfirmation)
    )
      return this.blocked(call, "GuardRuntime unavailable — failed closed");

    this.driftDetector.recordCall(
      tenantId,
      call.principal,
      effective,
      risk.reversibility,
      risk.blastRadius,
    );
    this.budgetManager.recordUsage(tenantId, call.principal, effective, risk, true);
    this.taintTracker.recordExecution(tenantId, call.tool);
    let planId: string | undefined;
    try {
      const plan = this.cache.record(
        effective,
        scope,
        [`${effective.tool}(...)`],
        now,
        this.planFingerprint(effective, descriptor, scope),
      );
      planId = plan.id;
    } catch {
      /* authorization does not depend on the plan cache */
    }
    return this.remember(
      call,
      await this.execute(
        effective,
        planId ?? `ephemeral_${currentFingerprint.slice(0, 16)}`,
        false,
        now,
      ),
      now,
      currentFingerprint,
    );
  }

  /** Explain an evaluated tool call using causal attribution DAG and counterfactuals. */
  explainCall(call: ToolCall): StructuredExplanation {
    const risk = this.arc.classify(call);
    const descriptor = this.arc.descriptor(call.tool);
    let budgetStatus: ReturnType<CumulativeBudgetManager["evaluateBudget"]>;
    try {
      budgetStatus = this.budgetManager.evaluateBudget(call.tenantId, call.principal, call, risk);
    } catch (error) {
      throw new Error(
        `Budget state resolution failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const taintViolations = this.taintTracker.checkFlow(call.tenantId, call.tool);
    const manifest = this.capabilityGate.getManifest(call.tenantId, call.principal);
    const capCheck = manifest
      ? this.capabilityGate.check(
          call,
          descriptor?.resourceType ?? "unknown",
          descriptor?.blastRadiusTier ?? 0.5,
        )
      : {
          authorized: this.allowUnmanifestedPrincipals,
          reason: "No registered capability manifest",
        };

    return DecisionTraceEngine.explain(
      call,
      risk,
      this.policy,
      descriptor,
      budgetStatus.budgetExceeded,
      budgetStatus.exceededReason,
      taintViolations.length,
      capCheck.authorized,
      capCheck.reason,
    );
  }

  /** Modified args are re-validated and detached using the same boundary validator. */
  private validateArgs(tool: string, args: Record<string, unknown>): Record<string, unknown> {
    const d = this.arc.descriptor(tool);
    if (!d) throw new Error("cannot validate args for unregistered tool");
    const result = SchemaValidator.validate(args, d.schema);
    if (!result.valid) throw new Error(`schema validation failed: ${result.errors.join("; ")}`);
    return result.sanitizedArgs;
  }

  private async execute(
    call: ToolCall,
    planId: string,
    viaCache: boolean,
    started: number,
  ): Promise<Outcome> {
    const impl = this.impls.get(call.tool) ?? this.executeTool;
    if (!impl) return this.blocked(call, `tool implementation is not registered: ${call.tool}`);
    let result: unknown;
    try {
      result = await impl(call.args);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.log(call, "tool_failed", { tool: call.tool, planId, reason });
      return { status: "failed", reason };
    }
    this.log(call, "tool_executed", { tool: call.tool, viaCache, planId });
    this.metrics.inc("tool_executions_total", {
      via_cache: String(viaCache),
      tenant: call.tenantId,
    });

    // Independent outcome verification (never agent self-report). Verification
    // failure is evidence failure, not authorization success/failure.
    if (this.verifyOutcome) {
      try {
        const verification = await this.verifyOutcome(call, result);
        this.cache.recordOutcome(call.tenantId, planId, verification, this.clock());
        this.log(call, "outcome_verified", { planId, ...verification });
      } catch (error) {
        this.metrics.inc("outcome_verification_failures_total", { tenant: call.tenantId });
        this.log(call, "outcome_verification_failed", {
          planId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      this.metrics.inc("outcome_verification_unavailable", { tenant: call.tenantId });
    }

    this.metrics.observeLatency(this.clock() - started);
    return { status: "executed", result, viaCache };
  }

  private blocked(call: ToolCall, reason: string): Outcome {
    this.log(call, "tool_blocked", { reason, tool: call.tool });
    this.metrics.inc("tool_blocked_total", { tenant: call.tenantId });
    return { status: "blocked", reason };
  }

  private remember(
    call: ToolCall,
    outcome: Outcome,
    at: number,
    actionFingerprint: string,
  ): Outcome {
    this.idempotency.namespace(call.tenantId).put(call.idempotencyKey, {
      key: call.idempotencyKey,
      outcome,
      at,
      tenantId: call.tenantId,
      actionFingerprint,
    });
    return outcome;
  }

  private log(
    call: ToolCall,
    type: Parameters<AuditLog["append"]>[0]["type"],
    payload: Record<string, unknown>,
  ) {
    this.audit.append({
      tenantId: call.tenantId,
      type,
      principal: call.principal,
      policyVersion: this.policy.version,
      ts: this.clock(),
      payload,
    });
  }

  sweepTimeouts(tenantId: string): void {
    this.cm.sweep(tenantId, this.clock());
  }
}
