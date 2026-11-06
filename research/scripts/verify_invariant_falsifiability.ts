// Proves that StaleApprovalCannotReplay is a real, falsifiable invariant —
// following the exact technique used in demo-app/scripts/verify_invariant_falsifiability.ts
// for that repo's INV-7. Same rationale: an invariant TLC can never violate
// under any modeled transition is exactly as uninformative as the deleted
// TypeScript "auditBlockValid = (verdict !== 'ALLOW' || canExecute)"
// tautology — reporting "0 counterexamples" would tell us nothing.
//
// This runs TLC against docs/formal/mutation-tests/GuardRuntime_StaleApproval_Mutant.tla,
// a one-line-diff copy of docs/formal/GuardRuntime.tla whose
// ExecuteWithConfirmation drops the ConfirmationIsCurrent(rec) freshness
// check. TLC MUST report a StaleApprovalCannotReplay violation here, or
// this invariant is vacuous in the unmodified spec too.

import path from "path";
import { runTlc } from "../src/guardruntime/formal/tlc-runner";

function main() {
  const specDir = path.join(process.cwd(), "docs", "formal", "mutation-tests");
  console.log("Running TLC against the deliberately-broken StaleApprovalCannotReplay mutant...");
  console.log(`  spec: ${path.join(specDir, "GuardRuntime_StaleApproval_Mutant.tla")}`);

  const result = runTlc({
    specDir,
    tlaFile: "GuardRuntime_StaleApproval_Mutant.tla",
    cfgFile: "GuardRuntime_StaleApproval_Mutant.cfg",
  });

  if (!result.errorFound) {
    throw new Error(
      'FALSIFIABILITY CHECK FAILED: TLC reported "No error has been found" against a spec whose ' +
        "ExecuteWithConfirmation accepts stale confirmations. That means StaleApprovalCannotReplay " +
        "cannot ever be violated in this model — it is a tautology. Do not treat it as verified " +
        "until this is fixed.",
    );
  }

  const inv = result.invariants.find((i) => i.tlaName === "StaleApprovalCannotReplay");
  if (!inv || inv.verified) {
    throw new Error(
      "FALSIFIABILITY CHECK FAILED: TLC found a violation, but not one attributed to " +
        "StaleApprovalCannotReplay. Raw TLC output:\n" +
        result.rawLog,
    );
  }

  console.log(
    "OK: TLC correctly reported a counterexample for StaleApprovalCannotReplay against the mutant.",
  );
  console.log(
    "This confirms the invariant is genuine and falsifiable — not vacuous — when checked",
  );
  console.log("by real TLC against the unmodified spec at docs/formal/GuardRuntime.tla.");
}

main();
