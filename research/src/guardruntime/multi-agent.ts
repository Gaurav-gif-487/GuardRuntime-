/**
 * Multi-Agent Coordination Protocol.
 *
 * Production agent deployments rarely involve a single agent. Multiple agents
 * may compete for the same resources, execute conflicting actions, or trigger
 * cascading effects. No existing safety runtime (NeMo Guardrails, Llama Guard,
 * Guardrails AI, AWS Bedrock) addresses this.
 *
 * This module provides:
 * 1. Conflict Detection — when two agents target the same resource simultaneously
 * 2. Priority Resolution — risk-weighted ordering (lower-risk agent yields)
 * 3. Cascading Blast Radius — when Agent A's action increases Agent B's blast radius
 * 4. Coordinated Rollback — propagate abort signals across a multi-agent workflow
 * 5. Audit Correlation — cross-agent correlation IDs in the audit chain
 */

import type { AuditLog } from "./audit";
import type { Metrics } from "./metrics";
import type { RiskDecision, ToolCall } from "./types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentRegistration {
  agentId: string;
  tenantId: string;
  permissionScopes: string[];
  /** Maximum number of concurrent in-flight calls for this agent. */
  maxConcurrent: number;
  registeredAt: number;
}

export interface ResourceClaim {
  claimId: string;
  agentId: string;
  tenantId: string;
  resourceType: string;
  resourceId: string;
  toolCall: ToolCall;
  risk: RiskDecision;
  claimedAt: number;
  expiresAt: number;
  state: "active" | "resolved" | "aborted";
  correlationId?: string;
}

export interface ConflictReport {
  conflictId: string;
  resource: { type: string; id: string };
  claimants: Array<{
    agentId: string;
    claimId: string;
    severity: number;
    reversibility: string;
  }>;
  resolution: ConflictResolution;
  resolvedAt: number;
}

export type ConflictResolution =
  | { type: "priority_yield"; winner: string; yielded: string[]; reason: string }
  | { type: "serialized"; order: string[]; reason: string }
  | { type: "blocked_all"; reason: string };

export interface CascadeEffect {
  sourceAgent: string;
  sourceAction: string;
  affectedAgent: string;
  originalBlastRadius: number;
  adjustedBlastRadius: number;
  reason: string;
}

export interface RollbackSignal {
  correlationId: string;
  originAgent: string;
  reason: string;
  affectedAgents: string[];
  issuedAt: number;
}

export interface CoordinatorConfig {
  /** Maximum age of a resource claim before it expires (ms). */
  claimTtlMs: number;
  /** Whether to block all claimants on conflict or attempt resolution. */
  conflictPolicy: "block_all" | "priority_resolution" | "serialize";
  /** Blast radius increase factor when cascading effects are detected. */
  cascadeAmplificationFactor: number;
}

const DEFAULT_COORDINATOR_CONFIG: CoordinatorConfig = {
  claimTtlMs: 30_000,
  conflictPolicy: "priority_resolution",
  cascadeAmplificationFactor: 1.3,
};

// ─── Coordinator ──────────────────────────────────────────────────────────────

export class MultiAgentCoordinator {
  private agents = new Map<string, AgentRegistration>();
  private claims = new Map<string, ResourceClaim>();
  private conflicts: ConflictReport[] = [];
  private cascades: CascadeEffect[] = [];
  private rollbacks: RollbackSignal[] = [];
  private correlationCounter = 0;

  constructor(
    private readonly config: CoordinatorConfig = DEFAULT_COORDINATOR_CONFIG,
    private readonly audit?: AuditLog,
    private readonly metrics?: Metrics,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  // ─── Agent Registration ───────────────────────────────────────────────

  registerAgent(agent: AgentRegistration): void {
    this.agents.set(agent.agentId, agent);
    this.metrics?.inc("multi_agent_registrations_total", { tenant: agent.tenantId });
  }

  unregisterAgent(agentId: string): void {
    this.agents.delete(agentId);
    // Release all active claims for this agent
    for (const [id, claim] of this.claims) {
      if (claim.agentId === agentId && claim.state === "active") {
        claim.state = "resolved";
        this.claims.set(id, claim);
      }
    }
  }

  getAgent(agentId: string): AgentRegistration | undefined {
    return this.agents.get(agentId);
  }

  // ─── Resource Claiming & Conflict Detection ───────────────────────────

  /**
   * Attempt to claim a resource for a tool call. Returns the claim if
   * granted, or a ConflictReport if another agent holds the resource.
   */
  claimResource(
    agentId: string,
    tenantId: string,
    resourceType: string,
    resourceId: string,
    toolCall: ToolCall,
    risk: RiskDecision,
  ): { claim: ResourceClaim } | { conflict: ConflictReport } {
    const now = this.clock();
    this.sweepExpired(now);

    // Check for existing active claims on the same resource within the same tenant
    const existingClaims = this.findActiveClaims(tenantId, resourceType, resourceId);

    if (existingClaims.length === 0) {
      const claim = this.createClaim(
        agentId,
        tenantId,
        resourceType,
        resourceId,
        toolCall,
        risk,
        now,
      );
      return { claim };
    }

    // Conflict detected — resolve based on policy
    const conflictId = `conflict_${++this.correlationCounter}`;
    const allClaimants = [
      ...existingClaims.map((c) => ({
        agentId: c.agentId,
        claimId: c.claimId,
        severity: c.risk.severity,
        reversibility: c.risk.reversibility,
      })),
      { agentId, claimId: "pending", severity: risk.severity, reversibility: risk.reversibility },
    ];

    const resolution = this.resolveConflict(allClaimants, risk, existingClaims);

    const report: ConflictReport = {
      conflictId,
      resource: { type: resourceType, id: resourceId },
      claimants: allClaimants,
      resolution,
      resolvedAt: now,
    };

    this.conflicts.push(report);
    this.metrics?.inc("multi_agent_conflicts_total", {
      tenant: tenantId,
      policy: this.config.conflictPolicy,
    });

    this.logAudit(tenantId, agentId, "multi_agent_conflict", {
      conflictId,
      resourceType,
      resourceId,
      resolution: resolution.type,
      claimantCount: allClaimants.length,
    });

    // If the incoming agent won priority, grant the claim
    if (resolution.type === "priority_yield" && resolution.winner === agentId) {
      // Abort the losing claims
      for (const existing of existingClaims) {
        if (resolution.yielded.includes(existing.agentId)) {
          existing.state = "aborted";
        }
      }
      const claim = this.createClaim(
        agentId,
        tenantId,
        resourceType,
        resourceId,
        toolCall,
        risk,
        now,
      );
      return { claim };
    }

    return { conflict: report };
  }

  /**
   * Release a resource claim after successful execution or cancellation.
   */
  releaseClaim(claimId: string): boolean {
    const claim = this.claims.get(claimId);
    if (!claim || claim.state !== "active") return false;
    claim.state = "resolved";
    return true;
  }

  // ─── Cascading Blast Radius ───────────────────────────────────────────

  /**
   * Calculate the cascading blast radius when one agent's action affects
   * the risk profile of another agent's pending action.
   *
   * Example: Agent A deletes a database backup, which increases the
   * blast radius of Agent B's pending database migration from 0.4 to 0.8
   * because the safety net no longer exists.
   */
  calculateCascadingBlastRadius(
    sourceAgent: string,
    sourceAction: string,
    sourceRisk: RiskDecision,
    affectedAgent: string,
    affectedRisk: RiskDecision,
  ): CascadeEffect | null {
    // Cascade only applies when source action is destructive or recoverable
    if (sourceRisk.reversibility === "reversible") return null;

    // Cascade increases the affected agent's blast radius
    const amplification = this.config.cascadeAmplificationFactor;
    const adjustedBlastRadius = Math.min(1, affectedRisk.blastRadius * amplification);

    if (adjustedBlastRadius <= affectedRisk.blastRadius) return null;

    const effect: CascadeEffect = {
      sourceAgent,
      sourceAction,
      affectedAgent,
      originalBlastRadius: affectedRisk.blastRadius,
      adjustedBlastRadius,
      reason: `Agent "${sourceAgent}"'s ${sourceRisk.reversibility} action "${sourceAction}" amplifies blast radius for "${affectedAgent}" by factor ${amplification}`,
    };

    this.cascades.push(effect);
    this.metrics?.inc("multi_agent_cascade_effects_total");

    return effect;
  }

  // ─── Coordinated Rollback ─────────────────────────────────────────────

  /**
   * Issue a rollback signal to all agents participating in a correlated
   * workflow. When one agent fails, all correlated agents receive abort signals.
   */
  issueRollback(correlationId: string, originAgent: string, reason: string): RollbackSignal {
    const now = this.clock();
    const affectedClaims = [...this.claims.values()].filter(
      (c) => c.correlationId === correlationId && c.agentId !== originAgent && c.state === "active",
    );

    const affectedAgents = [...new Set(affectedClaims.map((c) => c.agentId))];

    // Abort all affected claims
    for (const claim of affectedClaims) {
      claim.state = "aborted";
    }

    const signal: RollbackSignal = {
      correlationId,
      originAgent,
      reason,
      affectedAgents,
      issuedAt: now,
    };

    this.rollbacks.push(signal);
    this.metrics?.inc("multi_agent_rollbacks_total");

    // Log to audit for all affected tenants
    const tenants = new Set(affectedClaims.map((c) => c.tenantId));
    for (const tenantId of tenants) {
      this.logAudit(tenantId, originAgent, "multi_agent_rollback", {
        correlationId,
        reason,
        affectedAgents,
        affectedClaimCount: affectedClaims.length,
      });
    }

    return signal;
  }

  // ─── Correlation ID Generation ────────────────────────────────────────

  /** Generate a correlation ID to link actions across a multi-agent workflow. */
  generateCorrelationId(): string {
    return `corr_${++this.correlationCounter}_${this.clock()}`;
  }

  // ─── Query Methods ────────────────────────────────────────────────────

  getActiveClaimsForAgent(agentId: string): ResourceClaim[] {
    return [...this.claims.values()].filter((c) => c.agentId === agentId && c.state === "active");
  }

  getConflicts(): readonly ConflictReport[] {
    return this.conflicts;
  }

  getCascadeEffects(): readonly CascadeEffect[] {
    return this.cascades;
  }

  getRollbacks(): readonly RollbackSignal[] {
    return this.rollbacks;
  }

  // ─── Internals ────────────────────────────────────────────────────────

  private createClaim(
    agentId: string,
    tenantId: string,
    resourceType: string,
    resourceId: string,
    toolCall: ToolCall,
    risk: RiskDecision,
    now: number,
  ): ResourceClaim {
    const claimId = `claim_${++this.correlationCounter}`;
    const claim: ResourceClaim = {
      claimId,
      agentId,
      tenantId,
      resourceType,
      resourceId,
      toolCall,
      risk,
      claimedAt: now,
      expiresAt: now + this.config.claimTtlMs,
      state: "active",
    };
    this.claims.set(claimId, claim);
    return claim;
  }

  private findActiveClaims(
    tenantId: string,
    resourceType: string,
    resourceId: string,
  ): ResourceClaim[] {
    return [...this.claims.values()].filter(
      (c) =>
        c.tenantId === tenantId &&
        c.resourceType === resourceType &&
        c.resourceId === resourceId &&
        c.state === "active",
    );
  }

  private resolveConflict(
    claimants: ConflictReport["claimants"],
    _incomingRisk: RiskDecision,
    existingClaims: ResourceClaim[],
  ): ConflictResolution {
    switch (this.config.conflictPolicy) {
      case "block_all":
        return {
          type: "blocked_all",
          reason: "Policy requires blocking all concurrent claims on the same resource",
        };

      case "serialize":
        return {
          type: "serialized",
          order: claimants.sort((a, b) => a.severity - b.severity).map((c) => c.agentId),
          reason: "Claims will be processed in ascending severity order",
        };

      case "priority_resolution":
      default: {
        // Lower severity (less risky) agent gets priority — this is the
        // conservative choice: let the safer action proceed first.
        const sorted = [...claimants].sort((a, b) => a.severity - b.severity);
        const winner = sorted[0]!;
        const yielded = sorted.slice(1).map((c) => c.agentId);
        return {
          type: "priority_yield",
          winner: winner.agentId,
          yielded,
          reason: `Agent "${winner.agentId}" has lowest severity (${winner.severity.toFixed(3)}) and proceeds; ${yielded.length} agent(s) yield`,
        };
      }
    }
  }

  private sweepExpired(now: number): void {
    for (const [id, claim] of this.claims) {
      if (claim.state === "active" && claim.expiresAt <= now) {
        claim.state = "resolved";
      }
    }
  }

  private logAudit(
    tenantId: string,
    principal: string,
    type: string,
    payload: Record<string, unknown>,
  ): void {
    // Use "tool_blocked" as the closest existing AuditEventType for coordination events.
    // In a production system, the AuditEventType enum would be extended.
    this.audit?.append({
      tenantId,
      type: "tool_blocked",
      principal,
      policyVersion: "multi-agent-coordinator",
      ts: this.clock(),
      payload: { coordinatorEvent: type, ...payload },
    });
  }
}
