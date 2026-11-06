/**
 * GuardRuntime executable verification suite
 *
 * Runs all 19 verification layers:
 * - Layer 1-2: safety invariant checks (INV-1 to INV-7)
 * - Layer 8: adversarial scenarios
 * - Layer 9: Information Flow Control & Taint Tracking (Gap 1)
 * - Layer 10: Capability-Based Permission Model (Gap 2)
 * - Layer 11: Linear Temporal Logic (LTL) Specifications (Gap 3)
 * - Layer 12: Causal Attribution & Counterfactual Explainability (Gap 4)
 * - Layer 13: property-based fuzzing checks (Gap 5)
 * - Layer 14: Dynamic Probabilistic Assurance (MDP) (Gap 6)
 * - Layer 15: τ-bench-style Adapter & pass^k Metrics (Gap 7)
 * - Layer 16: MCP JSON-RPC gateway (Pillar 1)
 * - Layer 17: Speculative Execution Hypervisor & CoW Sandbox (Pillar 2)
 * - Layer 18: Automated Saga Reverse Rollback Engine (Pillar 3)
 * - Layer 19: Internal compliance evidence report (Pillar 4)
 */

import { verifyAllInvariants } from "./src/guardruntime/invariants";
import { runAdversarialEval, ADVERSARIAL_TASKS } from "./src/guardruntime/eval/harness";
import { TaintTracker } from "./src/guardruntime/taint";
import { CapabilityGate, type CapabilityManifest } from "./src/guardruntime/capabilities";
import { LTLEvaluator, LTL, type TraceEvent } from "./src/guardruntime/ltl";
import { TemporalSafetyMonitor } from "./src/guardruntime/temporal-monitor";
import { DecisionTraceEngine } from "./src/guardruntime/decision-trace";
import { PropertyFuzzer } from "./src/guardruntime/eval/property-fuzzer";
import { ProbabilisticMDPAssurance } from "./src/guardruntime/mdp-assurance";
import { TauBenchAdapter, type TauBenchTask } from "./src/guardruntime/eval/tau-bench-adapter";
import { MCPGatewayProxy } from "./src/guardruntime/mcp-gateway";
import {
  TransactionalShadowState,
  SpeculativeHypervisor,
} from "./src/guardruntime/speculative-hypervisor";
import { SagaRollbackCoordinator } from "./src/guardruntime/saga-rollback";
import { ComplianceEvidenceReporter } from "./src/guardruntime/compliance-evidence";
import { GuardRuntime } from "./src/guardruntime/runtime";
import { DEFAULT_POLICY } from "./src/guardruntime/policy";
import type { ToolCall, RiskDecision } from "./src/guardruntime/types";

async function main() {
  console.log("================================================================================");
  console.log("    GUARDRUNTIME EXECUTABLE VERIFICATION SUITE");
  console.log("================================================================================\n");

  let totalPassed = 0;
  let totalTests = 0;

  // ─── Layer 1 & 2: Safety Invariant Checks ───────────────────────────────────
  console.log("▶ [LAYER 1-2] Verifying safety invariants (INV-1 to INV-7)...");
  const baseRt = new GuardRuntime({
    allowUnmanifestedPrincipals: true,
    executeTool: (args) => ({ ok: true, args }),
    compensatingActions: {
      issue_refund: () => ({ ok: true }),
      cancel_subscription: () => ({ ok: true }),
    },
    verifyOutcome: () => ({ ok: true, source: "env_state_check" }),
  });
  const invariantReport = verifyAllInvariants({
    rt: baseRt,
    tenantIds: ["acme-corp", "globex-corp"],
  });
  totalTests += invariantReport.results.length;
  totalPassed += invariantReport.results.filter((r) => r.passed).length;
  for (const r of invariantReport.results) {
    console.log(`  ${r.passed ? "✓" : "✗"} ${r.id}: ${r.name}`);
  }

  // ─── Layer 8: adversarial scenarios ────────────────────────────────
  console.log(
    `\n▶ [LAYER 8] Running ${ADVERSARIAL_TASKS.length} adversarial scenarios (OWASP ASI01-ASI04)...`,
  );
  const advReport = await runAdversarialEval();
  const passedScenarios = advReport.passedScenarios;
  totalTests += advReport.totalScenarios;
  totalPassed += passedScenarios;
  console.log(
    `  ${passedScenarios === advReport.totalScenarios ? "✓" : "✗"} ${passedScenarios}/${advReport.totalScenarios} scenarios passed ` +
      `(${advReport.caughtAttackScenarios}/${advReport.attackScenarios} attack scenarios caught; ` +
      `${(advReport.detectionRate * 100).toFixed(1)}% attack-catch rate)`,
  );

  // ─── Layer 9: Information Flow Control & Taint Tracking (Gap 1) ─────────────
  console.log("\n▶ [LAYER 9] Testing Information Flow Control (IFC) & Taint Tracking...");
  const tracker = new TaintTracker();
  tracker.recordExecution("sess_audit", "search_orders");
  const taintVio = tracker.checkFlow("sess_audit", "send_email");
  const taintOk = taintVio.length > 0 && taintVio[0]!.taintLabel === "PII";
  totalTests += 1;
  if (taintOk) totalPassed++;
  console.log(
    `  ${taintOk ? "✓" : "✗"} Taint Exfiltration Detection (search_orders → send_email blocked)`,
  );

  // ─── Layer 10: Capability-Based Permission Model (Gap 2) ───────────────────
  console.log("\n▶ [LAYER 10] Testing Capability-Based Permissions & Attenuation...");
  const capManifest: CapabilityManifest = {
    principal: "agent:support",
    tenantId: "acme",
    allowedTools: ["search_orders"],
    allowedResourceTypes: ["order"],
    maxPermittedBlastRadius: 0.1,
    maxPermittedSingleMagnitude: 50,
    allowSubDelegation: true,
  };
  const capGate = new CapabilityGate([capManifest]);
  const capDenied = capGate.check(
    {
      tenantId: "acme",
      idempotencyKey: "k",
      tool: "wire_transfer",
      args: { amount_usd: 100 },
      goal: "",
      principal: "agent:support",
      permissionScope: "",
      environment: "prod",
    },
    "payment",
    0.5,
  );
  const capOk = !capDenied.authorized && capDenied.violationType === "tool_not_permitted";
  totalTests += 1;
  if (capOk) totalPassed++;
  console.log(
    `  ${capOk ? "✓" : "✗"} Pre-ARC Capability Gating (Unauthorized wire_transfer blocked)`,
  );

  // ─── Layer 11: LTL Temporal Safety Specifications (Gap 3) ───────────────────
  console.log("\n▶ [LAYER 11] Testing Linear Temporal Logic (LTL) Trace Verification...");
  const validTrace: TraceEvent[] = [
    {
      seq: 0,
      ts: 100,
      tool: "wire_transfer",
      principal: "admin",
      type: "cm_transition",
      payload: { to: "approved" },
    },
    {
      seq: 1,
      ts: 200,
      tool: "wire_transfer",
      principal: "agent:1",
      type: "tool_executed",
      payload: { tool: "wire_transfer", reversibility: "destructive" },
    },
  ];
  const ltlFormula = LTL.precedes(
    LTL.and(LTL.typeIs("tool_executed"), LTL.toolIs("wire_transfer")),
    LTL.typeIs("cm_transition"),
  );
  const ltlOk = LTLEvaluator.evaluate(ltlFormula, validTrace);
  totalTests += 1;
  if (ltlOk) totalPassed++;
  console.log(
    `  ${ltlOk ? "✓" : "✗"} LTL Specification Evaluator (Confirmation Precedes Destructive Execution)`,
  );

  // ─── Layer 12: Causal Attribution & Counterfactuals (Gap 4) ─────────────────
  console.log("\n▶ [LAYER 12] Testing Causal Attribution & Decision Explainability DAG...");
  const dummyCall: ToolCall = {
    tenantId: "acme",
    idempotencyKey: "exp_1",
    tool: "issue_refund",
    args: { amount_usd: 95000 },
    goal: "large refund",
    principal: "agent:fin",
    permissionScope: "all",
    environment: "prod",
  };
  const dummyRisk: RiskDecision = {
    reversibility: "recoverable",
    blastRadius: 0.71,
    severity: 0.5,
    requiresConfirmation: true,
    ruleId: "arc.matrix.recoverable",
    policyVersion: "1.0",
    rationale: ["Blast radius 0.71 vs threshold 0.35"],
    downgradedForMissingCompensation: false,
  };
  const explanation = DecisionTraceEngine.explain(dummyCall, dummyRisk, DEFAULT_POLICY);
  const explainOk =
    explanation.counterfactuals.length > 0 && explanation.decisionNodes.length === 4;
  totalTests += 1;
  if (explainOk) totalPassed++;
  console.log(`  ${explainOk ? "✓" : "✗"} Decision Attribution & Counterfactual Generation`);

  // ─── Layer 13: Property-Based Fuzzing Verification (Gap 5) ──────────────────
  const FUZZ_TRIALS_PER_PROPERTY = 1000;
  console.log(
    `\n▶ [LAYER 13] Running property-based randomized fuzz testing (${FUZZ_TRIALS_PER_PROPERTY} trials/property)...`,
  );
  const fuzzer = new PropertyFuzzer(42);
  const fuzzResults = await fuzzer.verifyProperties(FUZZ_TRIALS_PER_PROPERTY);
  const fuzzOk = fuzzResults.every((r) => r.violationsFound === 0);
  totalTests += fuzzResults.length;
  if (fuzzOk) totalPassed += fuzzResults.length;
  for (const r of fuzzResults) {
    console.log(
      `  ${r.violationsFound === 0 ? "✓" : "✗"} ${r.propertyId}: ${r.propertyName} (${r.trialsRun} trials)`,
    );
  }

  // ─── Layer 14: Dynamic Probabilistic Assurance (MDP) (Gap 6) ────────────────
  console.log("\n▶ [LAYER 14] Testing Dynamic Probabilistic Assurance (Online MDP)...");
  const dpa = new ProbabilisticMDPAssurance(3, 0.5);
  for (let i = 0; i < 5; i++) {
    dpa.observeTransition("agent:test", "RECOVERABLE_HIGH");
    dpa.observeTransition("agent:test", "DESTRUCTIVE_GATED");
  }
  const dpaRep = dpa.observeTransition("agent:test", "RECOVERABLE_HIGH");
  const dpaOk = dpaRep.anomalyDetected && dpaRep.kStepFailureProbability > 0.5;
  totalTests += 1;
  if (dpaOk) totalPassed++;
  console.log(
    `  ${dpaOk ? "✓" : "✗"} Dynamic Probabilistic Assurance (model-estimated P(reach destructive) = ${(dpaRep.kStepFailureProbability * 100).toFixed(1)}%)`,
  );

  // ─── Layer 15: τ-bench-style Adapter & pass^k Metrics (Gap 7) ────────────
  console.log("\n▶ [LAYER 15] Running τ-bench Multi-Turn Evaluation with pass^k Consistency...");
  const tauTasks: TauBenchTask[] = [
    {
      id: "retail_01",
      domain: "retail",
      userGoal: "Order lookup and small refund",
      policyConstraints: [],
      steps: [
        {
          turn: 1,
          proposedCall: {
            tenantId: "acme",
            idempotencyKey: "t1",
            tool: "search_orders",
            args: { query: "orders" },
            goal: "search",
            principal: "agent:support",
            permissionScope: "support",
            environment: "prod",
          },
          isPolicyCompliant: true,
          isSafe: true,
        },
      ],
    },
  ];
  const tauReport = await TauBenchAdapter.evaluateTasks(tauTasks, 3);
  const tauOk = tauReport.safetyViolationInterceptionRate === 1.0 && tauReport.passKRate === 1.0;
  totalTests += 1;
  if (tauOk) totalPassed++;
  console.log(
    `  ${tauOk ? "✓" : "✗"} τ-bench-style adapter check (pass^1 = ${tauReport.pass1Rate}, pass^3 = ${tauReport.passKRate}, interception = ${(tauReport.safetyViolationInterceptionRate * 100).toFixed(1)}%)`,
  );

  // ─── Layer 16: MCP Gateway Proxy (Pillar 1) ─────────────────────────────────
  console.log("\n▶ [LAYER 16] Testing MCP JSON-RPC Security Gateway (Pillar 1)...");
  const mcpGateway = new MCPGatewayProxy(baseRt);
  const mcpRes = await mcpGateway.handleMessage(
    {
      jsonrpc: "2.0",
      id: "mcp_test",
      method: "tools/call",
      params: { name: "wire_transfer", arguments: { amount_usd: 10000 } },
    },
    async () => ({ jsonrpc: "2.0", id: "mcp_test", result: { ok: true } }),
  );
  const mcpOk = mcpRes.error?.code === -32001; // HITL confirmation required
  totalTests += 1;
  if (mcpOk) totalPassed++;
  console.log(
    `  ${mcpOk ? "✓" : "✗"} MCP JSON-RPC Proxy Gating (Intercepted wire_transfer over JSON-RPC)`,
  );

  // ─── Layer 17: Speculative Execution Hypervisor (Pillar 2) ──────────────────
  console.log(
    "\n▶ [LAYER 17] Testing Speculative Execution Hypervisor & CoW Sandboxing (Pillar 2)...",
  );
  const shadowState = new TransactionalShadowState({ "wallet:1": { balance: 500 } });
  const hypervisor = new SpeculativeHypervisor(shadowState);
  const specRes = hypervisor.speculateAndCommit(
    {
      tenantId: "acme",
      idempotencyKey: "spec_test",
      tool: "debit",
      args: { amount: 100 },
      goal: "debit",
      principal: "agent:hyper",
      permissionScope: "finance",
      environment: "prod",
    },
    (sandbox, args) => {
      const w = sandbox.get("wallet:1") as { balance: number };
      sandbox.set("wallet:1", { balance: w.balance - Number(args["amount"]) });
      return { debited: true };
    },
    (sandbox) => {
      const w = sandbox.get("wallet:1") as { balance: number };
      return { ok: w.balance >= 0 };
    },
  );
  const specOk = specRes.status === "committed" && specRes.verified;
  totalTests += 1;
  if (specOk) totalPassed++;
  console.log(
    `  ${specOk ? "✓" : "✗"} Speculative CoW Hypervisor (Atomic commit of verified shadow state)`,
  );

  // ─── Layer 18: Automated Saga Reverse LIFO Rollback (Pillar 3) ──────────────
  console.log("\n▶ [LAYER 18] Testing Automated Saga Reverse LIFO Rollback Engine (Pillar 3)...");
  const sagaCoordinator = new SagaRollbackCoordinator();
  const sagaRollbackSequence: string[] = [];
  sagaCoordinator.registerCompensation("void_auth", () => {
    sagaRollbackSequence.push("void_auth");
    return true;
  });
  sagaCoordinator.registerCompensation("void_charge", () => {
    sagaRollbackSequence.push("void_charge");
    return true;
  });
  sagaCoordinator.recordStep("saga_v6", "auth", {}, "void_auth", {});
  sagaCoordinator.recordStep("saga_v6", "charge", {}, "void_charge", {});
  const sagaReport = await sagaCoordinator.rollbackSaga("saga_v6");
  const sagaOk =
    sagaReport.compensatedSteps === 2 &&
    sagaRollbackSequence[0] === "void_charge" &&
    sagaRollbackSequence[1] === "void_auth";
  totalTests += 1;
  if (sagaOk) totalPassed++;
  console.log(
    `  ${sagaOk ? "✓" : "✗"} Automated Saga Rollback (Strict LIFO reverse execution: void_charge → void_auth)`,
  );

  // ─── Layer 19: EU AI Act Implementation Evidence (Pillar 4) ────────────────
  console.log("\n▶ [LAYER 19] Testing internal compliance evidence reporter (Pillar 4)...");
  const certifier = new ComplianceEvidenceReporter(baseRt);
  const cert = certifier.generateReport("acme-corp");
  const certOk = cert.overallStatus === "EVIDENCE_COMPLETE" && cert.tamperEvidenceVerified;
  totalTests += 1;
  if (certOk) totalPassed++;
  console.log(`  ${certOk ? "✓" : "✗"} EU AI Act implementation evidence report (internal checks)`);

  console.log("\n================================================================================");
  const passRate = totalTests > 0 ? (totalPassed / totalTests) * 100 : 0;
  console.log(
    `                       TOTAL PASSED: ${totalPassed} / ${totalTests} (${passRate.toFixed(1)}%)`,
  );
  if (totalPassed !== totalTests)
    (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
  console.log("================================================================================\n");
}

main().catch(console.error);
