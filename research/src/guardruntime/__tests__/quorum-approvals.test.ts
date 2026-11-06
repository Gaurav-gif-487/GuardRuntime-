import { describe, expect, it } from "vitest";
import { QuorumApprovalManager } from "../quorum-approvals";
import type { AuthenticatedApprover, RiskDecision } from "../types";

const approverA: AuthenticatedApprover = {
  id: "approver-1@corp.com",
  roles: ["security-admin"],
  authenticatedAt: Date.now(),
};

const approverB: AuthenticatedApprover = {
  id: "approver-2@corp.com",
  roles: ["finance-lead"],
  authenticatedAt: Date.now(),
};

const highRisk: RiskDecision = {
  reversibility: "destructive",
  blastRadius: 0.9,
  severity: 0.95,
  requiresConfirmation: true,
  ruleId: "arc.matrix.destructive",
  policyVersion: "v3",
  rationale: ["wire transfer high amount"],
  downgradedForMissingCompensation: false,
};

describe("QuorumApprovalManager", () => {
  it("enforces multi-party quorum (2 independent approvers) for high-severity actions", () => {
    const manager = new QuorumApprovalManager({
      requiredApprovers: 2,
      quorumSeverityThreshold: 0.85,
      honeypotsEnabled: false,
      honeypotProbability: 0,
      maxApprovalsPerHour: 20,
    });

    const quorum = manager.initQuorum("conf_100", highRisk);
    expect(quorum.requiredApprovers).toBe(2);
    expect(quorum.isQuorumMet).toBe(false);

    // Vote 1
    const state1 = manager.recordVote("conf_100", approverA, "approved");
    expect(state1.isQuorumMet).toBe(false);
    expect(state1.approvals.length).toBe(1);

    // Vote 2
    const state2 = manager.recordVote("conf_100", approverB, "approved");
    expect(state2.isQuorumMet).toBe(true);
    expect(state2.status).toBe("approved");
  });

  it("prevents double-voting from the same approver", () => {
    const manager = new QuorumApprovalManager();
    manager.initQuorum("conf_101", highRisk);
    manager.recordVote("conf_101", approverA, "approved");

    expect(() => {
      manager.recordVote("conf_101", approverA, "approved");
    }).toThrow("has already voted");
  });

  it("triggers vigilance failure when an approver rubber-stamps a synthetic honeypot", () => {
    const manager = new QuorumApprovalManager({
      requiredApprovers: 1,
      quorumSeverityThreshold: 0.5,
      honeypotsEnabled: true,
      honeypotProbability: 1.0,
      maxApprovalsPerHour: 20,
    });

    manager.generateHoneypot("conf_honeypot_1");

    expect(() => {
      manager.recordVote("conf_honeypot_1", approverA, "approved");
    }).toThrow("[VigilanceFailure]");
  });
});
