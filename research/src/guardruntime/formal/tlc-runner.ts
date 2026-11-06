// Real TLC Model Checker Runner — ported from demo-app/src/guardruntime/tlc-runner.ts,
// adapted to this repo's spec location (docs/formal/) and all seven modeled
// thesis-property invariants listed below.
//
// Like its demo-app counterpart, this module invokes the ACTUAL TLC model
// checker (tla2tools.jar) as a subprocess and parses its real stdout. There
// is deliberately NO fallback path anywhere in this file that fabricates a
// plausible-looking result: if TLC cannot be found, cannot be spawned, or
// its output cannot be parsed, every function here throws.
//
// NODE-ONLY. Uses `child_process` and `fs` — do not import from
// browser-bundled UI code.

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

export const GUARD_RUNTIME_TLA_INVARIANTS: Array<{ tlaName: string; property: string }> = [
  {
    tlaName: "CacheHitNeverGrantsAuthorization",
    property: "Property 3 — cache is non-authorizing",
  },
  {
    tlaName: "MeaningfulChangeInvalidatesApproval",
    property: "Property 2 — meaningful changes invalidate approval",
  },
  { tlaName: "StaleApprovalCannotReplay", property: "Property 6 — no approval replay" },
  {
    tlaName: "CurrentAuthorizationAtExecution",
    property: "Property 1 — current authorization at execution",
  },
  {
    tlaName: "HighImpactActionsRequireConfirmation",
    property: "Property 4 — high-impact actions require confirmation",
  },
  { tlaName: "NoExecutionWhenUnhealthyWithoutConfirmation", property: "Property 5 — fail closed" },
  {
    tlaName: "SecuritySignificantDecisionsExplainable",
    property: "Property 7 — explainable security decisions",
  },
];

export interface TlcInvariantResult {
  tlaName: string;
  property: string;
  verified: boolean;
}

export interface TlcRunResult {
  engine: "TLC Model Checker (tla2tools.jar)";
  command: string;
  rawLog: string;
  statesGenerated: number;
  distinctStates: number;
  searchDepth: number;
  errorFound: boolean;
  invariants: TlcInvariantResult[];
  executionTimeMs: number;
  generatedAt: string;
}

export function parseTlcOutput(stdout: string, executionTimeMs = 0): TlcRunResult {
  const statesMatch = stdout.match(/(\d+)\s+states generated,\s+(\d+)\s+distinct states found/);
  const depthMatch = stdout.match(/depth of the complete state graph search is (\d+)/);
  const noError = /Model checking completed\.\s*No error has been found\./.test(stdout);
  const violationRegex = /Invariant\s+([A-Za-z0-9_]+)\s+is violated/g;
  const violated = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = violationRegex.exec(stdout)) !== null) {
    if (match[1]) violated.add(match[1]);
  }

  // TLC also prints state-count lines for many fatal initialization/runtime
  // errors. Those numbers are not a completed model check. Only accept an
  // error run when TLC explicitly names an invariant violation.
  const hasTlcError = /^Error:/m.test(stdout);
  if (!noError && violated.size === 0) {
    throw new Error(
      hasTlcError
        ? "TLC reported a parse/runtime error rather than an invariant counterexample; refusing to classify the crash as falsifiability evidence.\\n" +
            stdout.slice(0, 4000)
        : "TLC did not report either successful completion or an invariant counterexample; refusing to report a fabricated result.\n" +
            stdout.slice(0, 2000),
    );
  }
  if (!statesMatch || !statesMatch[1] || !statesMatch[2]) {
    throw new Error(
      "Could not find TLC's state-count line. Refusing to report fabricated state counts.\n" +
        stdout.slice(0, 2000),
    );
  }

  const invariants: TlcInvariantResult[] = GUARD_RUNTIME_TLA_INVARIANTS.map((inv) => ({
    ...inv,
    verified: noError && !violated.has(inv.tlaName),
  }));

  return {
    engine: "TLC Model Checker (tla2tools.jar)",
    command: "java -cp tla2tools.jar tlc2.TLC -config GuardRuntime.cfg GuardRuntime.tla",
    rawLog: stdout,
    statesGenerated: parseInt(statesMatch[1], 10),
    distinctStates: parseInt(statesMatch[2], 10),
    searchDepth: depthMatch && depthMatch[1] ? parseInt(depthMatch[1], 10) : -1,
    errorFound: violated.size > 0,
    invariants,
    executionTimeMs,
    generatedAt: new Date().toISOString(),
  };
}

export interface RunTlcOptions {
  jarPath?: string;
  specDir?: string;
  tlaFile?: string;
  cfgFile?: string;
}

export function runTlc(options: RunTlcOptions = {}): TlcRunResult {
  const jarPath =
    options.jarPath ?? process.env["TLA_TOOLS_JAR"] ?? path.resolve(process.cwd(), "tla2tools.jar");
  const specDir = options.specDir ?? path.resolve(process.cwd(), "docs", "formal");
  const tlaFile = options.tlaFile ?? "GuardRuntime.tla";
  const cfgFile = options.cfgFile ?? "GuardRuntime.cfg";

  if (!fs.existsSync(jarPath)) {
    throw new Error(
      `TLA+ tools jar not found at "${jarPath}".\n` +
        "Real TLC model checking requires tla2tools.jar (download from " +
        "https://github.com/tlaplus/tlaplus/releases). Place it at the repo root or set " +
        "TLA_TOOLS_JAR to its path.\nThis function does not fall back to a simulated result.",
    );
  }
  const tlaPath = path.join(specDir, tlaFile);
  const cfgPath = path.join(specDir, cfgFile);
  if (!fs.existsSync(tlaPath)) throw new Error(`TLA+ spec not found at "${tlaPath}".`);
  if (!fs.existsSync(cfgPath)) throw new Error(`TLA+ config not found at "${cfgPath}".`);

  const start = performance.now();
  const proc = spawnSync("java", ["-cp", jarPath, "tlc2.TLC", "-config", cfgFile, tlaFile], {
    cwd: specDir,
    encoding: "utf-8",
    maxBuffer: 1024 * 1024 * 64,
  });
  const executionTimeMs = +(performance.now() - start).toFixed(3);

  if (proc.error) {
    throw new Error(
      `Failed to spawn TLC ("java -cp ${jarPath} tlc2.TLC -config ${cfgFile} ${tlaFile}"): ${proc.error.message}`,
    );
  }

  const stdout = (proc.stdout || "") + (proc.stderr ? "\n" + proc.stderr : "");
  return parseTlcOutput(stdout, executionTimeMs);
}
