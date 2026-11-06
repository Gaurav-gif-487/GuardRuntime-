/**
 * Property-Based Fuzzing Engine (Gap 5).
 *
 * Generates deterministic pseudo-random tool calls and checks selected runtime
 * invariants over the generated sample. This is test coverage, not a proof over the
 * entire input space.
 */

import { GuardRuntime } from "../runtime";
import { SEED_TOOLS } from "../policy";
import type { ToolCall } from "../types";

export interface PropertyCheckResult {
  propertyId: string;
  propertyName: string;
  trialsRun: number;
  violationsFound: number;
  counterexample?:
    | {
        seed: number;
        call: ToolCall;
        rationale: string;
      }
    | undefined;
}

export class PropertyFuzzer {
  private toolNames = SEED_TOOLS.map((t) => t.name);

  constructor(private readonly seed: number = 42) {}

  private pseudoRandom(i: number): number {
    const x = Math.sin(this.seed + i) * 10000;
    return x - Math.floor(x);
  }

  /**
   * Generates N randomized tool calls across the entire valid input space.
   */
  generateRandomCalls(count: number): ToolCall[] {
    const calls: ToolCall[] = [];
    const tenants = ["tenant-alpha", "tenant-beta", "tenant-gamma"];

    for (let i = 0; i < count; i++) {
      const toolIdx = Math.floor(this.pseudoRandom(i * 4) * this.toolNames.length);
      const tool = this.toolNames[toolIdx]!;
      const tenantIdx = Math.floor(this.pseudoRandom(i * 4 + 1) * tenants.length);

      // Random magnitude spanning $0 to $1,000,000 on log distribution
      const magnitude = Math.round(Math.pow(10, this.pseudoRandom(i * 4 + 2) * 6));
      const recipients = Math.round(Math.pow(10, this.pseudoRandom(i * 4 + 3) * 4));
      const confidence = Number(this.pseudoRandom(i * 4 + 4).toFixed(2));

      calls.push({
        tenantId: tenants[tenantIdx]!,
        idempotencyKey: `fuzz_${this.seed}_${i}`,
        tool,
        args: {
          amount_usd: magnitude,
          recipients,
          query: `fuzz search ${i}`,
        },
        goal: `automated fuzz test step ${i}`,
        principal: `agent:fuzzer-${tenantIdx}`,
        permissionScope: "all",
        environment: "prod",
        confidence,
      });
    }

    return calls;
  }

  /**
   * Run full property-based verification over N trials.
   */
  async verifyProperties(trials = 1000): Promise<PropertyCheckResult[]> {
    const rt = new GuardRuntime({
      allowUnmanifestedPrincipals: true,
      executeTool: (args) => ({ ok: true, executedWith: args }),
      compensatingActions: {
        issue_refund: () => ({ ok: true }),
        cancel_subscription: () => ({ ok: true }),
      },
      verifyOutcome: () => ({ ok: true, source: "env_state_check" }),
    });

    const calls = this.generateRandomCalls(trials);

    let destructiveUnconfirmed = 0;
    let confidenceRatchetViolations = 0;
    let budgetOverruns = 0;

    let destructiveCounterexample: PropertyCheckResult["counterexample"];
    let budgetCounterexample: PropertyCheckResult["counterexample"];

    let rollingSpend = 0;

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i]!;
      const descriptor = rt.arc.descriptor(call.tool);
      const outcome = await rt.call(call);

      // Property 1: Destructive actions NEVER execute autonomously
      if (descriptor?.reversibility === "destructive" && outcome.status === "executed") {
        destructiveUnconfirmed++;
        destructiveCounterexample = {
          seed: this.seed,
          call,
          rationale: "Destructive tool executed without human confirmation",
        };
      }

      // Property 2: Confidence Ratchet Invariant (INV-1: Confidence can only raise severity, never lower it)
      const baseCallWithoutConfidence = { ...call, confidence: undefined };
      const baseRisk = rt.arc.classify(baseCallWithoutConfidence);
      const riskWithConfidence = rt.arc.classify(call);
      if (riskWithConfidence.severity < baseRisk.severity) {
        confidenceRatchetViolations++;
      }

      // Property 3: unconfirmed execution must not cross the default cumulative
      // monetary budget. The fuzzer does not approve confirmations, so an executed
      // call after the threshold is a concrete counterexample.
      //
      // Only count magnitude for tools that actually declare a magnitudeField —
      // mirroring how ActionRiskClassifier/CumulativeBudgetManager derive spend
      // (arc.ts reads call.args[tool.magnitudeField] only when declared). Every
      // generated call carries an `amount_usd` field regardless of tool, so
      // summing it unconditionally (e.g. for a read-only search_orders call)
      // is spend the runtime never considered and produces false violations.
      if (outcome.status === "executed" && descriptor?.magnitudeField) {
        const mag = Number(call.args[descriptor.magnitudeField] ?? 0);
        rollingSpend += mag;
        if (rollingSpend > 5000) {
          budgetOverruns++;
          budgetCounterexample = {
            seed: this.seed,
            call,
            rationale: `Unconfirmed executed spend crossed the default $5,000 rolling budget (${rollingSpend}).`,
          };
        }
      }
    }

    return [
      {
        propertyId: "PROP-01",
        propertyName: "Destructive Inviolability (INV-2 Completeness)",
        trialsRun: trials,
        violationsFound: destructiveUnconfirmed,
        counterexample: destructiveCounterexample,
      },
      {
        propertyId: "PROP-02",
        propertyName: "Confidence Monotonic Safety Ratchet (INV-1 Completeness)",
        trialsRun: trials,
        violationsFound: confidenceRatchetViolations,
      },
      {
        propertyId: "PROP-03",
        propertyName: "Unconfirmed Cumulative Spend Budget",
        trialsRun: trials,
        violationsFound: budgetOverruns,
        counterexample: budgetCounterexample,
      },
    ];
  }
}
