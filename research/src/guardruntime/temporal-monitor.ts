/**
 * Runtime Temporal Safety Monitor (Gap 3).
 *
 * Continuously evaluates temporal rules against the audit log stream.
 */

import { LTLEvaluator, LTL, type LTLFormula, type TraceEvent } from "./ltl";
import type { AuditEntry } from "./types";

export interface TemporalSafetyRule {
  id: string;
  name: string;
  formula: LTLFormula;
  severity: "critical" | "warning";
  description: string;
}

export const ENTERPRISE_TEMPORAL_RULES: TemporalSafetyRule[] = [
  {
    id: "TEMP-01",
    name: "Confirmation Precedes Destructive Execution",
    formula: LTL.precedes(
      LTL.and(LTL.typeIs("tool_executed"), LTL.reversibilityIs("destructive")),
      LTL.typeIs("cm_transition"),
    ),
    severity: "critical",
    description:
      "Every destructive tool execution must be preceded by a human confirmation transition",
  },
  {
    id: "TEMP-02",
    name: "Outcome Verification Follows Execution",
    formula: LTL.always(
      LTL.implies(LTL.typeIs("tool_executed"), LTL.next(LTL.typeIs("outcome_verified"))),
    ),
    severity: "warning",
    description:
      "Tool execution should immediately be followed by independent outcome verification",
  },
];

export interface MonitorVerificationReport {
  passed: boolean;
  totalRules: number;
  passedRules: number;
  violations: Array<{
    ruleId: string;
    ruleName: string;
    severity: "critical" | "warning";
    description: string;
  }>;
}

export class TemporalSafetyMonitor {
  private rules: TemporalSafetyRule[];

  constructor(rules: TemporalSafetyRule[] = ENTERPRISE_TEMPORAL_RULES) {
    this.rules = rules;
  }

  addRule(rule: TemporalSafetyRule): void {
    this.rules.push(rule);
  }

  verifyTrace(entries: readonly AuditEntry[]): MonitorVerificationReport {
    const trace = LTLEvaluator.fromAuditEntries(entries);
    const violations: MonitorVerificationReport["violations"] = [];

    for (const rule of this.rules) {
      const satisfied = LTLEvaluator.evaluate(rule.formula, trace);
      if (!satisfied) {
        violations.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          description: rule.description,
        });
      }
    }

    return {
      passed: violations.length === 0,
      totalRules: this.rules.length,
      passedRules: this.rules.length - violations.length,
      violations,
    };
  }
}
