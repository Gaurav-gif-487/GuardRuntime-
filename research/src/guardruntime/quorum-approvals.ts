/**
 * Cognitive Fatigue Mitigation & Multi-Party Quorum Approvals.
 *
 * Solves the Human Rubber-Stamping Problem: When human reviewers are bombarded
 * with repetitive approval modals, rejection rates drop to 0% (approval fatigue).
 *
 * Implements:
 * 1. M-of-N Multi-Party Quorum for high-severity state mutations (e.g., dual-custody)
 * 2. Synthetic Honeypot Challenge Injection to test approver vigilance
 * 3. Human Approval Velocity Monitoring & Fatigue Warning System
 */

import type { AuthenticatedApprover, ConfirmationRecord, RiskDecision } from "./types";

export interface QuorumPolicy {
  /** Minimum number of independent authenticated approvers required. */
  requiredApprovers: number;
  /** Severity threshold above which M-of-N quorum is mandatory (e.g., severity >= 0.85). */
  quorumSeverityThreshold: number;
  /** Whether honeypot challenges are enabled for vigilance testing. */
  honeypotsEnabled: boolean;
  /** Probability of injecting a synthetic honeypot (0.0–1.0, default 0.05). */
  honeypotProbability: number;
  /** Maximum approvals per user per hour before fatigue warning triggers. */
  maxApprovalsPerHour: number;
}

export const DEFAULT_QUORUM_POLICY: QuorumPolicy = {
  requiredApprovers: 2, // Dual-control for ultra-high risk
  quorumSeverityThreshold: 0.85,
  honeypotsEnabled: true,
  honeypotProbability: 0.05,
  maxApprovalsPerHour: 20,
};

export interface QuorumState {
  confirmationId: string;
  requiredApprovers: number;
  approvals: AuthenticatedApprover[];
  rejections: AuthenticatedApprover[];
  isQuorumMet: boolean;
  status: "pending_quorum" | "approved" | "rejected";
}

export interface HoneypotChallenge {
  challengeId: string;
  confirmationId: string;
  expectedDecision: "denied";
  honeypotReason: string;
  createdAt: number;
}

export class QuorumApprovalManager {
  private quorums = new Map<string, QuorumState>();
  private userApprovalTimestamps = new Map<string, number[]>();
  private activeHoneypots = new Map<string, HoneypotChallenge>();

  constructor(
    private readonly policy: QuorumPolicy = DEFAULT_QUORUM_POLICY,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /**
   * Determine whether a risk decision mandates multi-party quorum.
   */
  requiresQuorum(risk: RiskDecision): boolean {
    return (
      risk.severity >= this.policy.quorumSeverityThreshold || risk.reversibility === "destructive"
    );
  }

  /**
   * Initialize a quorum tracking record for a confirmation.
   */
  initQuorum(confirmationId: string, risk: RiskDecision): QuorumState {
    const required = this.requiresQuorum(risk) ? this.policy.requiredApprovers : 1;
    const state: QuorumState = {
      confirmationId,
      requiredApprovers: required,
      approvals: [],
      rejections: [],
      isQuorumMet: false,
      status: "pending_quorum",
    };
    this.quorums.set(confirmationId, state);
    return state;
  }

  /**
   * Record a vote from an authenticated approver. Prevents duplicate votes from the same user.
   */
  recordVote(
    confirmationId: string,
    approver: AuthenticatedApprover,
    decision: "approved" | "denied",
  ): QuorumState {
    let state = this.quorums.get(confirmationId);
    if (!state) {
      state = {
        confirmationId,
        requiredApprovers: 1,
        approvals: [],
        rejections: [],
        isQuorumMet: false,
        status: "pending_quorum",
      };
      this.quorums.set(confirmationId, state);
    }

    // Check honeypot challenge
    const honeypot = this.activeHoneypots.get(confirmationId);
    if (honeypot && decision === "approved") {
      // Approver failed the vigilance honeypot!
      throw new Error(
        `[VigilanceFailure] Approver ${approver.id} auto-approved a synthetic honeypot challenge. Reviewer flagged for safety review.`,
      );
    }

    // Record user activity for fatigue tracking
    this.recordUserActivity(approver.id);

    // Ensure approver hasn't already voted
    const alreadyVoted =
      state.approvals.some((a) => a.id === approver.id) ||
      state.rejections.some((a) => a.id === approver.id);
    if (alreadyVoted) {
      throw new Error(
        `Approver ${approver.id} has already voted on confirmation ${confirmationId}`,
      );
    }

    if (decision === "approved") {
      state.approvals.push(approver);
      if (state.approvals.length >= state.requiredApprovers) {
        state.isQuorumMet = true;
        state.status = "approved";
      }
    } else {
      state.rejections.push(approver);
      state.status = "rejected";
    }

    return state;
  }

  /**
   * Generate a synthetic honeypot challenge to audit reviewer vigilance.
   */
  generateHoneypot(confirmationId: string): HoneypotChallenge | null {
    if (!this.policy.honeypotsEnabled) return null;
    const challenge: HoneypotChallenge = {
      challengeId: `honeypot_${Math.random().toString(36).substring(2, 9)}`,
      confirmationId,
      expectedDecision: "denied",
      honeypotReason:
        "Synthetic test challenge: Prompt contains conflicting payload requesting immediate cancellation",
      createdAt: this.clock(),
    };
    this.activeHoneypots.set(confirmationId, challenge);
    return challenge;
  }

  /**
   * Assess approver fatigue based on hourly velocity.
   */
  assessApproverFatigue(approverId: string): { isFatigued: boolean; approvalsInLastHour: number } {
    const now = this.clock();
    const timestamps = (this.userApprovalTimestamps.get(approverId) ?? []).filter(
      (t) => now - t <= 60 * 60 * 1000,
    );
    this.userApprovalTimestamps.set(approverId, timestamps);

    return {
      isFatigued: timestamps.length >= this.policy.maxApprovalsPerHour,
      approvalsInLastHour: timestamps.length,
    };
  }

  private recordUserActivity(userId: string): void {
    const now = this.clock();
    const existing = this.userApprovalTimestamps.get(userId) ?? [];
    existing.push(now);
    this.userApprovalTimestamps.set(userId, existing);
  }
}
