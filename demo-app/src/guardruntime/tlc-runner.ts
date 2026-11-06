// Real TLC Model Checker Runner
//
// This module invokes the ACTUAL TLC model checker (tla2tools.jar) as a
// subprocess and parses its real stdout. There is deliberately NO fallback
// path anywhere in this file that fabricates a plausible-looking result: if
// TLC cannot be found, cannot be spawned, or its output cannot be parsed,
// every function here throws. Callers are responsible for surfacing that
// failure to whoever is consuming it (script exit code, HTTP 500, UI error
// state) rather than substituting synthetic numbers.
//
// NODE-ONLY. This file uses `child_process` and `fs` and must never be
// imported from browser-bundled code (e.g. src/App.tsx, any component under
// src/components/). It is safe to import from scripts/ and from server.ts.

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export const GUARD_RUNTIME_INVARIANTS: Array<{ id: string; tlaName: string; displayName: string }> = [
  { id: 'TYPE', tlaName: 'TypeInvariant', displayName: 'Type Invariant' },
  { id: 'INV-1', tlaName: 'INV1_NoStaleExecution', displayName: 'No Stale Execution' },
  { id: 'INV-2', tlaName: 'INV2_StructuralInvalidationOnChange', displayName: 'Structural Invalidation on Change' },
  { id: 'INV-3', tlaName: 'INV3_CacheIsNonAuthorizing', displayName: 'Cache is Non-Authorizing' },
  { id: 'INV-4', tlaName: 'INV4_HighImpactCannotBeCacheShortcut', displayName: 'High-Impact Cannot Be Cache-Shortcut' },
  { id: 'INV-5', tlaName: 'INV5_FailClosedUnderDegradation', displayName: 'Fail Closed under Degraded Health' },
  { id: 'INV-6', tlaName: 'INV6_NoApprovalReplay', displayName: 'No Approval Replay' },
  { id: 'INV-7', tlaName: 'INV7_ExplainabilityAndAuditability', displayName: 'Complete Auditability & Independent Verification' },
];

export interface TlcInvariantResult {
  id: string;
  tlaName: string;
  displayName: string;
  verified: boolean;
}

export interface TlcRunResult {
  engine: 'TLC Model Checker (tla2tools.jar)';
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

/**
 * Parses REAL TLC stdout text into a structured result. Throws if the text
 * doesn't match TLC's actual output grammar — this function does not accept
 * a "best guess" and does not fill in missing numbers.
 */
export function parseTlcOutput(stdout: string, executionTimeMs = 0): TlcRunResult {
  const statesMatch = stdout.match(/(\d+)\s+states generated,\s+(\d+)\s+distinct states found/);
  const depthMatch = stdout.match(/depth of the complete state graph search is (\d+)/);
  const noError = /Model checking completed\.\s*No error has been found\./.test(stdout);
  const sanyOrRuntimeError = /^Error:/m.test(stdout) && !statesMatch;

  if (sanyOrRuntimeError) {
    throw new Error('TLC reported a parse/runtime error before completing model checking:\n' + stdout.slice(0, 4000));
  }

  if (!statesMatch) {
    throw new Error(
      'Could not find TLC\'s "<N> states generated, <M> distinct states found" line in the output. ' +
      'Either TLC did not finish, or this text is not real TLC output. Refusing to report fabricated ' +
      'numbers.\n\nFirst 2000 chars received:\n' + stdout.slice(0, 2000)
    );
  }

  const violated = new Set<string>();
  const violationRegex = /Invariant\s+([A-Za-z0-9_]+)\s+is violated/g;
  let match: RegExpExecArray | null;
  while ((match = violationRegex.exec(stdout)) !== null) {
    violated.add(match[1]);
  }

  const invariants: TlcInvariantResult[] = GUARD_RUNTIME_INVARIANTS.map(inv => ({
    ...inv,
    verified: noError && !violated.has(inv.tlaName),
  }));

  return {
    engine: 'TLC Model Checker (tla2tools.jar)',
    command: 'java -cp tla2tools.jar tlc2.TLC -config GuardRuntime.cfg GuardRuntime.tla',
    rawLog: stdout,
    statesGenerated: parseInt(statesMatch[1], 10),
    distinctStates: parseInt(statesMatch[2], 10),
    searchDepth: depthMatch ? parseInt(depthMatch[1], 10) : -1,
    errorFound: !noError,
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

/**
 * Actually spawns `java -cp tla2tools.jar tlc2.TLC ...` and parses its real
 * output. Throws (does not fabricate) if the jar, spec, or config are
 * missing, if the process fails to spawn, or if the output can't be parsed.
 */
export function runTlc(options: RunTlcOptions = {}): TlcRunResult {
  const jarPath = options.jarPath
    ?? process.env.TLA_TOOLS_JAR
    ?? path.resolve(process.cwd(), 'tla2tools.jar');
  const specDir = options.specDir ?? path.resolve(process.cwd(), 'specifications');
  const tlaFile = options.tlaFile ?? 'GuardRuntime.tla';
  const cfgFile = options.cfgFile ?? 'GuardRuntime.cfg';

  if (!fs.existsSync(jarPath)) {
    throw new Error(
      `TLA+ tools jar not found at "${jarPath}".\n` +
      `Real TLC model checking requires tla2tools.jar (download from ` +
      `https://github.com/tlaplus/tlaplus/releases). Place it at the repo root or set the ` +
      `TLA_TOOLS_JAR environment variable to its path.\n` +
      `This function does not fall back to a simulated result.`
    );
  }
  const tlaPath = path.join(specDir, tlaFile);
  const cfgPath = path.join(specDir, cfgFile);
  if (!fs.existsSync(tlaPath)) throw new Error(`TLA+ spec not found at "${tlaPath}".`);
  if (!fs.existsSync(cfgPath)) throw new Error(`TLA+ config not found at "${cfgPath}".`);

  const start = performance.now();
  const proc = spawnSync('java', ['-cp', jarPath, 'tlc2.TLC', '-config', cfgFile, tlaFile], {
    cwd: specDir,
    encoding: 'utf-8',
    maxBuffer: 1024 * 1024 * 64,
  });
  const executionTimeMs = +(performance.now() - start).toFixed(3);

  if (proc.error) {
    throw new Error(`Failed to spawn TLC ("java -cp ${jarPath} tlc2.TLC -config ${cfgFile} ${tlaFile}"): ${proc.error.message}`);
  }

  const stdout = (proc.stdout || '') + (proc.stderr ? '\n' + proc.stderr : '');
  return parseTlcOutput(stdout, executionTimeMs);
}

/**
 * Reads and parses the checked-in real TLC log at experiments/tlc-model-checker.log.
 * Used where re-spawning TLC synchronously isn't practical (e.g. a live HTTP
 * request) — but this still parses genuine TLC output produced by an actual
 * run, never a template string. It throws if no such log exists yet.
 */
export function loadCheckedInTlcResult(logPath?: string): TlcRunResult {
  const resolvedPath = logPath ?? path.resolve(process.cwd(), 'experiments', 'tlc-model-checker.log');
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`No checked-in TLC log found at "${resolvedPath}". Run scripts/generate_ground_truth.ts (with a real tla2tools.jar available) first.`);
  }
  const stdout = fs.readFileSync(resolvedPath, 'utf-8');
  return parseTlcOutput(stdout);
}
