/**
 * Cumulative Blast Radius & State Budget Window.
 *
 * Mitigates the "Slicing / Sybil Attack" where an adversarial or runaway
 * agent breaks a high-consequence action ($100k wire transfer) into thousands
 * of low-consequence actions ($100 each) to slip under per-call ARC thresholds.
 *
 * Implements:
 * 1. Sliding-Window Cumulative Budget Tracker (Monetary, Resource Count, & Blast Radius Integral)
 * 2. Automatic Threshold Escalation when cumulative usage exceeds window limits
 * 3. Per-tenant and per-agent budget allocation
 */

import type { Metrics } from "./metrics";
import type { RiskDecision, ToolCall } from "./types";

export interface BudgetConfig {
  /** Rolling window duration in milliseconds (default: 1 hour). */
  windowMs: number;
  /** Maximum cumulative monetary spend allowed in window before forced confirmation. */
  maxCumulativeMagnitude: number;
  /** Maximum cumulative affected items allowed in window. */
  maxCumulativeAffectedCount: number;
  /** Maximum cumulative integrated blast radius allowed in window (0–1 scale accumulated). */
  maxCumulativeBlastRadius: number;
}

export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  windowMs: 60 * 60 * 1000, // 1 hour
  maxCumulativeMagnitude: 5000, // $5,000 max unconfirmed per hour
  maxCumulativeAffectedCount: 500, // 500 users/resources per hour
  maxCumulativeBlastRadius: 1.5, // Total cumulative blast integral
};

export interface BudgetUsageRecord {
  timestamp: number;
  magnitude: number;
  affectedCount: number;
  blastRadius: number;
  tool: string;
  confirmedByHuman: boolean;
}

export interface BudgetStatus {
  tenantId: string;
  agentId: string;
  windowMs: number;
  currentUsage: {
    cumulativeMagnitude: number;
    cumulativeAffectedCount: number;
    cumulativeBlastRadius: number;
  };
  limits: BudgetConfig;
  budgetExceeded: boolean;
  exceededReason?: string | undefined;
}

export class CumulativeBudgetManager {
  private history = new Map<string, BudgetUsageRecord[]>();

  constructor(
    private readonly config: BudgetConfig = DEFAULT_BUDGET_CONFIG,
    private readonly metrics?: Metrics,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  private key(tenantId: string, agentId: string): string {
    return `${tenantId}:${agentId}`;
  }

  /**
   * Evaluates whether a proposed tool call and its risk decision exceeds
   * the agent's rolling cumulative budget.
   */
  evaluateBudget(
    tenantId: string,
    agentId: string,
    call: ToolCall,
    risk: RiskDecision,
  ): BudgetStatus {
    const now = this.clock();
    const records = this.getCleanRecords(tenantId, agentId, now);

    let cumulativeMagnitude = 0;
    let cumulativeAffectedCount = 0;
    let cumulativeBlastRadius = 0;

    for (const r of records) {
      if (!r.confirmedByHuman) {
        cumulativeMagnitude += r.magnitude;
        cumulativeAffectedCount += r.affectedCount;
        cumulativeBlastRadius += r.blastRadius;
      }
    }

    const proposedMagnitude = Number(call.args["amount_usd"] ?? call.args["magnitude"] ?? 0) || 0;
    const proposedAffected =
      Number(call.args["recipients"] ?? call.args["member_count"] ?? call.args["count"] ?? 0) || 0;
    const proposedBlast = risk.blastRadius;

    const projectedMagnitude = cumulativeMagnitude + proposedMagnitude;
    const projectedAffected = cumulativeAffectedCount + proposedAffected;
    const projectedBlast = cumulativeBlastRadius + proposedBlast;

    let budgetExceeded = false;
    let exceededReason: string | undefined;

    if (projectedMagnitude > this.config.maxCumulativeMagnitude) {
      budgetExceeded = true;
      exceededReason = `Cumulative monetary spend ($${projectedMagnitude.toFixed(2)}) exceeds hourly budget ($${this.config.maxCumulativeMagnitude})`;
    } else if (projectedAffected > this.config.maxCumulativeAffectedCount) {
      budgetExceeded = true;
      exceededReason = `Cumulative affected count (${projectedAffected}) exceeds hourly limit (${this.config.maxCumulativeAffectedCount})`;
    } else if (projectedBlast > this.config.maxCumulativeBlastRadius) {
      budgetExceeded = true;
      exceededReason = `Cumulative blast radius integral (${projectedBlast.toFixed(2)}) exceeds maximum (${this.config.maxCumulativeBlastRadius})`;
    }

    if (budgetExceeded) {
      this.metrics?.inc("cumulative_budget_exceeded_total", { tenant: tenantId, agent: agentId });
    }

    return {
      tenantId,
      agentId,
      windowMs: this.config.windowMs,
      currentUsage: {
        cumulativeMagnitude: projectedMagnitude,
        cumulativeAffectedCount: projectedAffected,
        cumulativeBlastRadius: projectedBlast,
      },
      limits: this.config,
      budgetExceeded,
      exceededReason,
    };
  }

  /**
   * Record a completed or approved tool call into the sliding window.
   */
  recordUsage(
    tenantId: string,
    agentId: string,
    call: ToolCall,
    risk: RiskDecision,
    confirmedByHuman: boolean,
  ): void {
    const now = this.clock();
    const records = this.getCleanRecords(tenantId, agentId, now);

    const magnitude = Number(call.args["amount_usd"] ?? call.args["magnitude"] ?? 0) || 0;
    const affectedCount =
      Number(call.args["recipients"] ?? call.args["member_count"] ?? call.args["count"] ?? 0) || 0;

    records.push({
      timestamp: now,
      magnitude,
      affectedCount,
      blastRadius: risk.blastRadius,
      tool: call.tool,
      confirmedByHuman,
    });

    this.history.set(this.key(tenantId, agentId), records);
  }

  private getCleanRecords(tenantId: string, agentId: string, now: number): BudgetUsageRecord[] {
    const k = this.key(tenantId, agentId);
    const existing = this.history.get(k) ?? [];
    const cutoff = now - this.config.windowMs;
    const active = existing.filter((r) => r.timestamp >= cutoff);
    this.history.set(k, active);
    return active;
  }
}
