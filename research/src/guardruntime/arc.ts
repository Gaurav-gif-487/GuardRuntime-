import type { Policy } from "./policy";
import type { RiskDecision, Reversibility, ToolCall, ToolDescriptor } from "./types";

/**
 * Action Risk Classifier.
 *
 * Risk is a function of two independent axes — reversibility and blast radius —
 * never a flat label. A confidence signal is an optional modifier that can only
 * make confirmation MORE likely, never suppress one.
 */
export interface CompensationRegistry {
  hasCompensatingAction(toolName: string): boolean;
}

export class ActionRiskClassifier {
  constructor(
    private readonly tools: Map<string, ToolDescriptor>,
    private policy: Policy,
    private readonly compensationRegistry?: CompensationRegistry,
  ) {}

  setPolicy(policy: Policy): void {
    this.policy = policy;
  }

  register(tool: ToolDescriptor): void {
    this.tools.set(tool.name, tool);
  }

  descriptor(name: string): ToolDescriptor | undefined {
    return this.tools.get(name);
  }

  classify(call: ToolCall): RiskDecision {
    const rationale: string[] = [];
    const tool = this.tools.get(call.tool);

    // Unknown tool: the safe default is destructive, max blast radius.
    if (!tool) {
      return {
        reversibility: "destructive",
        blastRadius: 1,
        severity: 1,
        requiresConfirmation: true,
        ruleId: "arc.unknown_tool",
        policyVersion: this.policy.version,
        rationale: ["Tool is not registered; classified destructive by default."],
        downgradedForMissingCompensation: false,
      };
    }

    // Compensating-action requirement: `recoverable` needs operational backing.
    let reversibility: Reversibility = tool.reversibility;
    let downgraded = false;
    if (
      reversibility === "recoverable" &&
      !this.compensationRegistry?.hasCompensatingAction(tool.name)
    ) {
      reversibility = "destructive";
      downgraded = true;
      rationale.push(
        `Declared recoverable but no operational compensating action is registered for ${tool.name}; downgraded to destructive.`,
      );
    } else if (reversibility === "recoverable") {
      rationale.push(`Operational compensating action is registered for ${tool.name}.`);
    }

    const blastRadius = this.blastRadius(tool, call, rationale);
    const threshold = this.policy.thresholds[reversibility];
    let requiresConfirmation = reversibility === "destructive" || blastRadius >= threshold;
    let ruleId = `arc.matrix.${reversibility}`;
    rationale.push(
      reversibility === "destructive"
        ? "Destructive actions always require confirmation regardless of blast radius."
        : `Blast radius ${blastRadius.toFixed(2)} vs ${reversibility} threshold ${threshold}.`,
    );

    // Optional confidence modifier — one-directional (safety ratchet).
    let severity = this.severity(reversibility, blastRadius);
    if (typeof call.confidence === "number") {
      if (call.confidence < this.policy.lowConfidenceCutoff) {
        severity = Math.min(1, severity + (this.policy.lowConfidenceCutoff - call.confidence));
        if (!requiresConfirmation && reversibility !== "reversible") {
          requiresConfirmation = true;
          ruleId = "arc.low_confidence_ratchet";
        }
        rationale.push(
          `Agent confidence ${call.confidence.toFixed(2)} below cutoff ${this.policy.lowConfidenceCutoff}; severity raised (never lowered).`,
        );
      } else {
        rationale.push("Confidence signal present but can only escalate; no effect here.");
      }
    }

    return {
      reversibility,
      blastRadius,
      severity,
      requiresConfirmation,
      ruleId,
      policyVersion: this.policy.version,
      confidenceModelVersion: call.confidenceModelVersion,
      rationale,
      downgradedForMissingCompensation: downgraded,
    };
  }

  private blastRadius(tool: ToolDescriptor, call: ToolCall, rationale: string[]): number {
    const signals: number[] = [];

    if (tool.magnitudeField) {
      const raw = Number(call.args[tool.magnitudeField]);
      if (Number.isFinite(raw)) {
        // Log scale: $10 ≈ 0.24, $10k ≈ 0.66, $10M ≈ 1.0
        const scaled = Math.min(1, Math.log10(Math.max(1, raw)) / 7);
        signals.push(scaled);
        rationale.push(`Magnitude ${raw} → blast radius signal ${scaled.toFixed(2)}.`);
      }
    }

    if (tool.affectedCountField) {
      const raw = Number(call.args[tool.affectedCountField]);
      if (Number.isFinite(raw)) {
        const scaled = Math.min(1, Math.log10(Math.max(1, raw)) / 5);
        signals.push(scaled);
        rationale.push(`Affected resources ${raw} → blast radius signal ${scaled.toFixed(2)}.`);
      }
    }

    if (!signals.length) {
      const tier = tool.blastRadiusTier ?? 0.5;
      rationale.push(`No numeric signal extractable; using tool-author tier ${tier}.`);
      signals.push(tier);
    }

    const base = Math.max(...signals);
    return call.environment === "prod" ? base : Math.max(0, base * 0.6);
  }

  private severity(reversibility: Reversibility, blastRadius: number): number {
    const weight = { reversible: 0.25, recoverable: 0.6, destructive: 1 }[reversibility];
    return Math.min(1, weight * (0.4 + 0.6 * blastRadius));
  }
}
