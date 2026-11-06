// Proves that INV7_ExplainabilityAndAuditability is a real, falsifiable
// invariant rather than a tautology.
//
// Background: the previous TypeScript "model checker" simulation contained
// `auditBlockValid = (verdict !== 'ALLOW' || canExecute)`, which could never
// evaluate false given how `canExecute` was already constrained earlier in
// the same function. That whole simulation has been deleted (see
// src/guardruntime/tlc-runner.ts) in favor of invoking real TLC. But
// deleting the simulation only removes one instance of the problem — it
// doesn't by itself prove that the REAL TLA+ invariant is meaningful. An
// invariant that no reachable transition can ever violate is exactly as
// uninformative as a tautological boolean expression: TLC reporting
// "0 counterexamples" would tell us nothing.
//
// This script runs TLC against `specifications/mutation-tests/GuardRuntime_INV7_Mutant.tla`,
// a copy of the real spec with exactly one line changed: the Audit action
// hardcodes `validLink |-> FALSE` instead of `TRUE` (see that file's diff
// against specifications/GuardRuntime.tla — it's a one-line change). If
// INV-7 is a real check, TLC MUST report a violation here. If it doesn't,
// INV-7 is vacuous and this script fails loudly rather than staying silent.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runTlc } from '../src/guardruntime/tlc-runner';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function main() {
  const specDir = path.resolve(__dirname, '..', 'specifications', 'mutation-tests');

  console.log('Running TLC against the deliberately-broken INV-7 mutant spec...');
  console.log(`  spec: ${path.join(specDir, 'GuardRuntime_INV7_Mutant.tla')}`);

  const result = runTlc({
    specDir,
    tlaFile: 'GuardRuntime_INV7_Mutant.tla',
    cfgFile: 'GuardRuntime_INV7_Mutant.cfg',
  });

  if (!result.errorFound) {
    throw new Error(
      'FALSIFIABILITY CHECK FAILED: TLC reported "No error has been found" against a spec whose ' +
      'Audit action hardcodes validLink |-> FALSE. That means INV7_ExplainabilityAndAuditability ' +
      'cannot ever be violated in this model, i.e. it is a tautology — the exact class of bug this ' +
      'script exists to catch. Do not treat INV-7 as verified until this is fixed.'
    );
  }

  const inv7 = result.invariants.find(i => i.id === 'INV-7');
  if (!inv7 || inv7.verified) {
    throw new Error(
      'FALSIFIABILITY CHECK FAILED: TLC found a violation, but not one attributed to INV-7 ' +
      '(INV7_ExplainabilityAndAuditability). Raw TLC output:\n' + result.rawLog
    );
  }

  console.log('OK: TLC correctly reported a counterexample for INV-7 against the mutant spec.');
  console.log('This confirms INV-7 is a genuine, falsifiable invariant — not a tautology — when');
  console.log('checked by the real TLC engine against the unmodified spec at specifications/GuardRuntime.tla.');
}

main();
