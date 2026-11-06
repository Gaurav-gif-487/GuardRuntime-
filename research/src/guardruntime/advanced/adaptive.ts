import type { Reversibility } from "../types";
export type RiskLevel = "low" | "medium" | "high";
export interface ApprovalEvent {
  at: number;
  approved: boolean;
}
export interface UserApprovalHistory {
  events: ApprovalEvent[];
}
export interface AdaptiveThresholdPolicy {
  minimumHistoricalRequests: number;
  minimumApprovalRate: number;
  minimumConfirmationsPerWeek: number;
  weekMs: number;
}
export interface SuppressionDecision {
  suppress: boolean;
  reason: string;
}
export class AdaptiveThresholdManager {
  constructor(
    private readonly policy: AdaptiveThresholdPolicy = {
      minimumHistoricalRequests: 10,
      minimumApprovalRate: 0.95,
      minimumConfirmationsPerWeek: 3,
      weekMs: 7 * 24 * 60 * 60 * 1000,
    },
  ) {}
  decide(
    reversibility: Reversibility,
    riskLevel: RiskLevel,
    history: UserApprovalHistory,
    now: number,
  ): SuppressionDecision {
    if (reversibility === "destructive" || riskLevel === "high")
      return {
        suppress: false,
        reason: "hard safety cap: destructive/high-risk actions always confirm",
      };
    if (history.events.length < this.policy.minimumHistoricalRequests)
      return { suppress: false, reason: "insufficient approval history" };
    const recent = history.events.filter((e) => now - e.at <= this.policy.weekMs);
    if (recent.length < this.policy.minimumConfirmationsPerWeek)
      return { suppress: false, reason: "weekly confirmation floor not met" };
    const rate = history.events.filter((e) => e.approved).length / history.events.length;
    if (rate < this.policy.minimumApprovalRate)
      return {
        suppress: false,
        reason: `approval rate ${rate.toFixed(3)} is below configured minimum`,
      };
    return { suppress: true, reason: "configured evidence bounds satisfied" };
  }
  shouldSuppressConfirmation(
    reversibility: Reversibility,
    riskLevel: RiskLevel,
    history: UserApprovalHistory,
    now = Date.now(),
  ): boolean {
    return this.decide(reversibility, riskLevel, history, now).suppress;
  }
}
