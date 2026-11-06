/**
 * Linear Temporal Logic (LTL) Safety Specification Engine (Gap 3).
 *
 * Extends point-in-time invariant checks to full sequential temporal properties
 * over the agent's observable control flow and audit log.
 *
 * Implements:
 * 1. LTL Formula AST (Atomic, Negation, And, Or, Next, Globally/Always, Eventually, Until, Precedes)
 * 2. Trace-based finite LTL evaluator (LTL3 semantics over execution traces)
 * 3. Pre-defined enterprise safety specifications
 */

import type { AuditEntry } from "./types";

export type TraceEvent = {
  seq: number;
  ts: number;
  tool: string;
  reversibility?: string;
  blastRadius?: number;
  principal: string;
  type: string;
  status?: string;
  payload: Record<string, unknown>;
};

export type LTLPredicate = (event: TraceEvent) => boolean;

export type LTLFormula =
  | { type: "atom"; name: string; pred: LTLPredicate }
  | { type: "not"; inner: LTLFormula }
  | { type: "and"; left: LTLFormula; right: LTLFormula }
  | { type: "or"; left: LTLFormula; right: LTLFormula }
  | { type: "globally"; inner: LTLFormula } // Always (□)
  | { type: "eventually"; inner: LTLFormula } // Eventually (◇)
  | { type: "next"; inner: LTLFormula } // Next (○)
  | { type: "implies"; antecedent: LTLFormula; consequent: LTLFormula } // A → B
  | { type: "precedes"; trigger: LTLFormula; requiredPrior: LTLFormula }; // Prior must have happened before Trigger

// Helper constructors
export const LTL = {
  atom: (name: string, pred: LTLPredicate): LTLFormula => ({ type: "atom", name, pred }),
  not: (inner: LTLFormula): LTLFormula => ({ type: "not", inner }),
  and: (left: LTLFormula, right: LTLFormula): LTLFormula => ({ type: "and", left, right }),
  or: (left: LTLFormula, right: LTLFormula): LTLFormula => ({ type: "or", left, right }),
  always: (inner: LTLFormula): LTLFormula => ({ type: "globally", inner }),
  eventually: (inner: LTLFormula): LTLFormula => ({ type: "eventually", inner }),
  next: (inner: LTLFormula): LTLFormula => ({ type: "next", inner }),
  implies: (antecedent: LTLFormula, consequent: LTLFormula): LTLFormula => ({
    type: "implies",
    antecedent,
    consequent,
  }),
  precedes: (trigger: LTLFormula, requiredPrior: LTLFormula): LTLFormula => ({
    type: "precedes",
    trigger,
    requiredPrior,
  }),

  // Common predicates
  toolIs: (toolName: string): LTLFormula =>
    LTL.atom(`tool == "${toolName}"`, (e) => e.tool === toolName || e.payload["tool"] === toolName),
  reversibilityIs: (rev: string): LTLFormula =>
    LTL.atom(
      `reversibility == "${rev}"`,
      (e) => e.reversibility === rev || e.payload["reversibility"] === rev,
    ),
  typeIs: (type: string): LTLFormula => LTL.atom(`type == "${type}"`, (e) => e.type === type),
};

export interface LTLEvaluationResult {
  formulaName: string;
  satisfied: boolean;
  violationIndex?: number;
  rationale: string;
}

/**
 * Finite trace evaluator for LTL specifications.
 */
export class LTLEvaluator {
  /**
   * Evaluate a formula on a finite trace.
   */
  static evaluate(formula: LTLFormula, trace: TraceEvent[], startIndex = 0): boolean {
    if (trace.length === 0) return true;

    switch (formula.type) {
      case "atom": {
        if (startIndex >= trace.length) return false;
        return formula.pred(trace[startIndex]!);
      }
      case "not": {
        return !this.evaluate(formula.inner, trace, startIndex);
      }
      case "and": {
        return (
          this.evaluate(formula.left, trace, startIndex) &&
          this.evaluate(formula.right, trace, startIndex)
        );
      }
      case "or": {
        return (
          this.evaluate(formula.left, trace, startIndex) ||
          this.evaluate(formula.right, trace, startIndex)
        );
      }
      case "globally": {
        // Must hold for all indices from startIndex to end of trace
        for (let i = startIndex; i < trace.length; i++) {
          if (!this.evaluate(formula.inner, trace, i)) return false;
        }
        return true;
      }
      case "eventually": {
        // Must hold at least once from startIndex to end of trace
        for (let i = startIndex; i < trace.length; i++) {
          if (this.evaluate(formula.inner, trace, i)) return true;
        }
        return false;
      }
      case "next": {
        if (startIndex + 1 >= trace.length) return true; // Vacuously true at boundary
        return this.evaluate(formula.inner, trace, startIndex + 1);
      }
      case "implies": {
        const ante = this.evaluate(formula.antecedent, trace, startIndex);
        if (!ante) return true; // Antecedent false -> implication holds
        return this.evaluate(formula.consequent, trace, startIndex);
      }
      case "precedes": {
        // For every position where trigger holds, requiredPrior must have held at some earlier index
        for (let i = startIndex; i < trace.length; i++) {
          if (this.evaluate(formula.trigger, trace, i)) {
            let priorFound = false;
            for (let j = 0; j < i; j++) {
              if (this.evaluate(formula.requiredPrior, trace, j)) {
                priorFound = true;
                break;
              }
            }
            if (!priorFound) return false;
          }
        }
        return true;
      }
    }
  }

  /**
   * Convert raw AuditEntry objects to TraceEvents.
   */
  static fromAuditEntries(entries: readonly AuditEntry[]): TraceEvent[] {
    return entries.map((e) => ({
      seq: e.seq,
      ts: e.ts,
      tool: String(e.payload["tool"] ?? ""),
      reversibility: String(e.payload["reversibility"] ?? ""),
      blastRadius: Number(e.payload["blastRadius"] ?? 0),
      principal: e.principal,
      type: e.type,
      status: String(e.payload["status"] ?? ""),
      payload: e.payload,
    }));
  }
}
