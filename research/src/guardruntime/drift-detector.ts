/**
 * Behavioral Drift Detector.
 *
 * Detects when an agent's behavior pattern deviates from its historical norm,
 * a key signal that the agent may be compromised, hallucinating, or drifting
 * from its intended purpose.
 *
 * Unlike content-safety classifiers that examine individual messages, this
 * module analyzes the TRAJECTORY of an agent's actions over time, detecting
 * anomalies that would be invisible to per-call inspection.
 *
 * Capabilities:
 * 1. Sliding Window Analysis — tracks rolling statistics of tool-call patterns
 * 2. Anomaly Scoring — multi-signal drift score combining several indicators
 * 3. Auto-Escalation — when drift score exceeds threshold, force HITL
 * 4. Cooldown Period — after drift detection, ALL actions require confirmation
 */

import type { Metrics } from "./metrics";
import type { Reversibility, ToolCall } from "./types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DriftConfig {
  /** Number of recent calls to consider in the sliding window. */
  windowSize: number;
  /** Drift score threshold to trigger auto-escalation (0–1). */
  escalationThreshold: number;
  /** Duration of cooldown period after drift detection (ms). */
  cooldownMs: number;
  /** Weight for destructive call rate anomaly in the drift score. */
  destructiveRateWeight: number;
  /** Weight for scope escalation anomaly in the drift score. */
  scopeEscalationWeight: number;
  /** Weight for tool diversity anomaly in the drift score. */
  toolDiversityWeight: number;
  /** Weight for call frequency anomaly in the drift score. */
  frequencyWeight: number;
  /** Minimum number of calls before drift detection activates. */
  minHistorySize: number;
}

export const DEFAULT_DRIFT_CONFIG: DriftConfig = {
  windowSize: 50,
  escalationThreshold: 0.65,
  cooldownMs: 5 * 60 * 1000,
  destructiveRateWeight: 0.35,
  scopeEscalationWeight: 0.25,
  toolDiversityWeight: 0.15,
  frequencyWeight: 0.25,
  minHistorySize: 10,
};

export interface CallRecord {
  tool: string;
  reversibility: Reversibility;
  permissionScope: string;
  environment: string;
  blastRadius: number;
  timestamp: number;
}

export interface DriftScore {
  /** Overall drift score ∈ [0,1]. Higher = more anomalous. */
  score: number;
  /** Whether the drift score exceeds the escalation threshold. */
  drifting: boolean;
  /** Whether the agent is currently in a cooldown period. */
  inCooldown: boolean;
  /** Individual signal contributions to the drift score. */
  signals: {
    destructiveRateAnomaly: number;
    scopeEscalationAnomaly: number;
    toolDiversityAnomaly: number;
    frequencyAnomaly: number;
  };
  /** When this agent should exit cooldown (null if not in cooldown). */
  cooldownExpiresAt: number | null;
  /** Explanation for the current drift assessment. */
  rationale: string[];
}

export interface AgentProfile {
  agentId: string;
  tenantId: string;
  /** Full history of calls (bounded by a generous max). */
  history: CallRecord[];
  /** Baseline statistics computed from the agent's "normal" operating period. */
  baseline: {
    destructiveRate: number;
    avgBlastRadius: number;
    scopeSet: Set<string>;
    toolSet: Set<string>;
    avgIntervalMs: number;
  };
  /** Timestamp when cooldown was triggered (null if no active cooldown). */
  cooldownStartedAt: number | null;
  /** Number of times drift was detected for this agent. */
  driftCount: number;
}

// ─── Detector ─────────────────────────────────────────────────────────────────

export class BehavioralDriftDetector {
  private profiles = new Map<string, AgentProfile>();
  private readonly maxHistory = 500;

  constructor(
    private readonly config: DriftConfig = DEFAULT_DRIFT_CONFIG,
    private readonly metrics?: Metrics,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  // ─── Profile Management ─────────────────────────────────────────────

  private profileKey(tenantId: string, agentId: string): string {
    return `${tenantId}:${agentId}`;
  }

  private getOrCreateProfile(tenantId: string, agentId: string): AgentProfile {
    const key = this.profileKey(tenantId, agentId);
    let profile = this.profiles.get(key);
    if (!profile) {
      profile = {
        agentId,
        tenantId,
        history: [],
        baseline: {
          destructiveRate: 0,
          avgBlastRadius: 0,
          scopeSet: new Set(),
          toolSet: new Set(),
          avgIntervalMs: 0,
        },
        cooldownStartedAt: null,
        driftCount: 0,
      };
      this.profiles.set(key, profile);
    }
    return profile;
  }

  // ─── Recording ──────────────────────────────────────────────────────

  /**
   * Record a tool call for an agent. This updates the agent's behavioral
   * profile and recomputes baseline statistics.
   */
  recordCall(
    tenantId: string,
    agentId: string,
    call: ToolCall,
    reversibility: Reversibility,
    blastRadius: number,
  ): void {
    const profile = this.getOrCreateProfile(tenantId, agentId);
    const record: CallRecord = {
      tool: call.tool,
      reversibility,
      permissionScope: call.permissionScope,
      environment: call.environment,
      blastRadius,
      timestamp: this.clock(),
    };

    profile.history.push(record);

    // Bound history size
    if (profile.history.length > this.maxHistory) {
      profile.history = profile.history.slice(-this.maxHistory);
    }

    // Update baseline from the full history (rolling recompute)
    this.recomputeBaseline(profile);
  }

  // ─── Drift Assessment ───────────────────────────────────────────────

  /**
   * Assess the current behavioral drift for an agent. Returns a drift
   * score with signal breakdown and cooldown status.
   */
  assessDrift(tenantId: string, agentId: string): DriftScore {
    const profile = this.getOrCreateProfile(tenantId, agentId);
    const now = this.clock();

    // Check cooldown status
    const inCooldown = this.isInCooldown(profile, now);
    const cooldownExpiresAt = profile.cooldownStartedAt
      ? profile.cooldownStartedAt + this.config.cooldownMs
      : null;

    // Not enough history to assess
    if (profile.history.length < this.config.minHistorySize) {
      return {
        score: 0,
        drifting: false,
        inCooldown,
        signals: {
          destructiveRateAnomaly: 0,
          scopeEscalationAnomaly: 0,
          toolDiversityAnomaly: 0,
          frequencyAnomaly: 0,
        },
        cooldownExpiresAt,
        rationale: ["Insufficient history for drift assessment"],
      };
    }

    // Get the recent window
    const window = profile.history.slice(-this.config.windowSize);
    const rationale: string[] = [];

    // Signal 1: Destructive call rate anomaly
    const recentDestructiveRate =
      window.filter((c) => c.reversibility === "destructive").length / window.length;
    const destructiveRateAnomaly = Math.min(
      1,
      Math.max(0, (recentDestructiveRate - profile.baseline.destructiveRate) * 3),
    );
    if (destructiveRateAnomaly > 0.3) {
      rationale.push(
        `Destructive call rate spiked: ${(recentDestructiveRate * 100).toFixed(1)}% (baseline: ${(profile.baseline.destructiveRate * 100).toFixed(1)}%)`,
      );
    }

    // Signal 2: Scope escalation anomaly
    const recentScopes = new Set(window.map((c) => c.permissionScope));
    const newScopes = [...recentScopes].filter((s) => !profile.baseline.scopeSet.has(s));
    const scopeEscalationAnomaly = Math.min(1, newScopes.length / Math.max(1, recentScopes.size));
    if (newScopes.length > 0) {
      rationale.push(
        `New permission scopes detected: ${newScopes.join(", ")} (not in baseline of ${profile.baseline.scopeSet.size} scopes)`,
      );
    }

    // Signal 3: Tool diversity anomaly (sudden narrowing or broadening)
    const recentTools = new Set(window.map((c) => c.tool));
    const baselineToolCount = profile.baseline.toolSet.size || 1;
    const toolDiversityAnomaly = Math.min(
      1,
      Math.abs(recentTools.size - baselineToolCount) / baselineToolCount,
    );
    if (toolDiversityAnomaly > 0.3) {
      rationale.push(
        `Tool diversity shifted: ${recentTools.size} tools in window vs. baseline ${baselineToolCount}`,
      );
    }

    // Signal 4: Call frequency anomaly (burst detection)
    const intervals: number[] = [];
    for (let i = 1; i < window.length; i++) {
      intervals.push(window[i]!.timestamp - window[i - 1]!.timestamp);
    }
    const avgInterval = intervals.length
      ? intervals.reduce((a, b) => a + b, 0) / intervals.length
      : profile.baseline.avgIntervalMs;
    const baselineInterval = profile.baseline.avgIntervalMs || avgInterval || 1;
    const frequencyAnomaly = Math.min(1, Math.max(0, 1 - avgInterval / baselineInterval));
    if (frequencyAnomaly > 0.3) {
      rationale.push(
        `Call frequency increased: avg ${avgInterval.toFixed(0)}ms interval vs. baseline ${baselineInterval.toFixed(0)}ms`,
      );
    }

    // Weighted drift score
    const score = Math.min(
      1,
      destructiveRateAnomaly * this.config.destructiveRateWeight +
        scopeEscalationAnomaly * this.config.scopeEscalationWeight +
        toolDiversityAnomaly * this.config.toolDiversityWeight +
        frequencyAnomaly * this.config.frequencyWeight,
    );

    const drifting = score >= this.config.escalationThreshold;

    // Trigger cooldown if drift detected and not already in cooldown
    if (drifting && !inCooldown) {
      profile.cooldownStartedAt = now;
      profile.driftCount++;
      this.metrics?.inc("drift_detections_total", { tenant: tenantId, agent: agentId });
      rationale.push(
        `Drift score ${score.toFixed(3)} exceeds threshold ${this.config.escalationThreshold}. Cooldown activated for ${this.config.cooldownMs / 1000}s.`,
      );
    }

    if (rationale.length === 0) {
      rationale.push("Agent behavior within normal parameters");
    }

    return {
      score,
      drifting,
      inCooldown: drifting || inCooldown,
      signals: {
        destructiveRateAnomaly,
        scopeEscalationAnomaly,
        toolDiversityAnomaly,
        frequencyAnomaly,
      },
      cooldownExpiresAt: drifting ? now + this.config.cooldownMs : cooldownExpiresAt,
      rationale,
    };
  }

  /**
   * Whether an agent is currently in cooldown. During cooldown, ALL
   * actions should require human confirmation regardless of ARC classification.
   */
  isAgentInCooldown(tenantId: string, agentId: string): boolean {
    const profile = this.profiles.get(this.profileKey(tenantId, agentId));
    if (!profile) return false;
    return this.isInCooldown(profile, this.clock());
  }

  /**
   * Manually clear an agent's cooldown (e.g., after security review).
   */
  clearCooldown(tenantId: string, agentId: string): void {
    const profile = this.profiles.get(this.profileKey(tenantId, agentId));
    if (profile) profile.cooldownStartedAt = null;
  }

  /**
   * Get the full behavioral profile for an agent.
   */
  getProfile(tenantId: string, agentId: string): AgentProfile | undefined {
    return this.profiles.get(this.profileKey(tenantId, agentId));
  }

  /**
   * Get drift statistics across all monitored agents for a tenant.
   */
  tenantStats(tenantId: string): {
    totalAgents: number;
    driftingAgents: number;
    cooldownAgents: number;
  } {
    const now = this.clock();
    let totalAgents = 0;
    let driftingAgents = 0;
    let cooldownAgents = 0;

    for (const [, profile] of this.profiles) {
      if (profile.tenantId !== tenantId) continue;
      totalAgents++;
      if (this.isInCooldown(profile, now)) cooldownAgents++;
      if (profile.history.length >= this.config.minHistorySize) {
        const drift = this.assessDrift(tenantId, profile.agentId);
        if (drift.drifting) driftingAgents++;
      }
    }

    return { totalAgents, driftingAgents, cooldownAgents };
  }

  // ─── Internals ────────────────────────────────────────────────────────

  private isInCooldown(profile: AgentProfile, now: number): boolean {
    if (!profile.cooldownStartedAt) return false;
    return now - profile.cooldownStartedAt < this.config.cooldownMs;
  }

  private recomputeBaseline(profile: AgentProfile): void {
    const history = profile.history;
    if (history.length < 2) return;

    // Use the older half of history as baseline (the "established" pattern)
    const baselineSlice = history.slice(0, Math.floor(history.length / 2));
    if (baselineSlice.length < 2) return;

    profile.baseline.destructiveRate =
      baselineSlice.filter((c) => c.reversibility === "destructive").length / baselineSlice.length;
    profile.baseline.avgBlastRadius =
      baselineSlice.reduce((s, c) => s + c.blastRadius, 0) / baselineSlice.length;
    profile.baseline.scopeSet = new Set(baselineSlice.map((c) => c.permissionScope));
    profile.baseline.toolSet = new Set(baselineSlice.map((c) => c.tool));

    const intervals: number[] = [];
    for (let i = 1; i < baselineSlice.length; i++) {
      intervals.push(baselineSlice[i]!.timestamp - baselineSlice[i - 1]!.timestamp);
    }
    profile.baseline.avgIntervalMs = intervals.length
      ? intervals.reduce((a, b) => a + b, 0) / intervals.length
      : 0;
  }
}
