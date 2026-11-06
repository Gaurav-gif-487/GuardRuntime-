import React, { useState } from 'react';
import { ShieldCheck, Play, CheckCircle2, XCircle, HelpCircle, Download, Terminal, Cpu, AlertTriangle } from 'lucide-react';
import type { TlcRunResult } from '../guardruntime/tlc-runner';
// Vite raw import: this is the SAME file TLC actually runs against
// (specifications/GuardRuntime.tla). There is no separate copy of the spec
// text baked into application code anymore — a prior hardcoded copy had
// silently drifted out of sync with the real spec (it was missing the
// entire Init/Next/Spec transition relation), so the checked-in .tla file
// is now the single source of truth for both TLC and this UI.
import GuardRuntimeTlaSource from '../../specifications/GuardRuntime.tla?raw';

interface FormalSpecExplorerProps {
  onRunModelChecker: () => Promise<TlcRunResult>;
}

const THEOREM_METADATA: Record<string, { num: number; name: string; type: string; formula: string; rationale: string }> = {
  'TYPE': {
    num: 0,
    name: 'Type Invariant',
    type: 'TLC Bounded Model Checking',
    formula: 'pipelineState, lastVerdict, runtimeHealth range over their declared domains',
    rationale: 'Basic well-formedness: every reachable state keeps these fields within their declared value sets.'
  },
  'INV-1': {
    num: 1,
    name: 'No Stale Execution',
    type: 'TLC Bounded Model Checking',
    formula: '(pipelineState = "EXECUTED") => (lastVerdict = "ALLOW")',
    rationale: 'An action cannot execute without current authorization derived freshly from active grants in the current evaluation cycle.'
  },
  'INV-2': {
    num: 2,
    name: 'Structural Invalidation on Change',
    type: 'Bounded TLC + Cryptographic Primitive Assumption',
    formula: '\\A a1, a2 \\in Actions: (a1.id # a2.id) => (a1 # a2)',
    rationale: 'Modifying any tool parameter, principal, or tenant mathematically invalidates identity; full domain collision resistance relies on SHA-256.'
  },
  'INV-3': {
    num: 3,
    name: 'Cache is Non-Authorizing',
    type: 'TLC Bounded Model Checking',
    formula: '\\A plan \\in planCache: ~plan.carriesAuthorizationVerdict /\\ ~plan.bypassesCapabilityCheck',
    rationale: 'Plan-cache hits provide AST structural hints only and never determine authorization or bypass capability/taint gates.'
  },
  'INV-4': {
    num: 4,
    name: 'High-Impact Cannot Be Cache-Shortcut',
    type: 'TLC Bounded Model Checking',
    formula: '(pipelineState = "EXECUTED" /\\ currentAction.isHighImpact) => (\\E tok \\in confirmationPool: tok.actionId = currentAction.id /\\ tok.consumed)',
    rationale: 'High-impact and irreversible operations strictly require single-use human token confirmation and cannot be bypassed via cache.'
  },
  'INV-5': {
    num: 5,
    name: 'Fail Closed under Degraded Health',
    type: 'TLC Bounded Model Checking',
    formula: '(runtimeHealth # "Healthy") => (lastVerdict \\in {"BLOCK", "NONE"})',
    rationale: 'System health degradation or offline status immediately forces all non-trivial tool actions to fail closed to BLOCK.'
  },
  'INV-6': {
    num: 6,
    name: 'No Approval Replay',
    type: 'TLC Bounded Model Checking',
    formula: '\\A tok \\in confirmationPool: (tok.consumed => ~tok.valid)',
    rationale: 'Human confirmation tokens are single-use; consuming a token atomically transitions its validity to false.'
  },
  'INV-7': {
    num: 7,
    name: 'Complete Auditability & Independent Verification',
    type: 'TLC Bounded Model Checking',
    formula: '(pipelineState = "AUDITED") => (Len(auditLog) > 0 => auditLog[Len(auditLog)].validLink)',
    rationale: 'Every decision outcome appends to an immutable SHA-256 Merkle chain verified independently from agent self-reporting. ' +
      'This invariant is checked against a deliberately-broken mutant spec (specifications/mutation-tests/GuardRuntime_INV7_Mutant.tla) ' +
      'to confirm TLC actually catches a violation here, rather than this being unfalsifiable by construction.'
  },
};

export const FormalSpecExplorer: React.FC<FormalSpecExplorerProps> = ({ onRunModelChecker }) => {
  const [modelResult, setModelResult] = useState<TlcRunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'proofs' | 'tla-source' | 'tlc-log'>('proofs');

  const handleDownloadTlaSpec = () => {
    const blob = new Blob([GuardRuntimeTlaSource], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'GuardRuntime.tla';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleRunModelChecker = async () => {
    setIsRunning(true);
    setRunError(null);
    try {
      const res = await onRunModelChecker();
      setModelResult(res);
    } catch (e: any) {
      setRunError(e?.message || 'Model checker run failed.');
      setModelResult(null);
    } finally {
      setIsRunning(false);
    }
  };

  const invariantById = (id: string) => modelResult?.invariants.find(i => i.id === id);

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Phase C — Formal Verification & TLA+ Invariant Model Checker Suite</span>
            </h3>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">
              Mathematically proves the 7 falsifiable theorems across all combinations of Request, Capability, Taint, CacheHit, RiskLevel, Confirmation, and HealthState using official TLC (tla2tools.jar). Requires a server with Java + tla2tools.jar available.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={handleDownloadTlaSpec}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition border border-slate-700 cursor-pointer"
              title="Download raw GuardRuntime.tla specification"
            >
              <Download className="w-3.5 h-3.5 text-indigo-400" />
              <span>Download .tla</span>
            </button>
            <button
              onClick={handleRunModelChecker}
              disabled={isRunning}
              className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-lg shadow-emerald-600/30 flex items-center space-x-2 transition cursor-pointer"
            >
              <Play className="w-4 h-4" />
              <span>{isRunning ? 'Running Real TLC...' : 'Run State Space Model Checker'}</span>
            </button>
          </div>
        </div>

        {/* View Switcher */}
        <div className="flex items-center space-x-2 mt-4 text-xs font-mono">
          <button
            onClick={() => setViewMode('proofs')}
            className={`px-3 py-1.5 rounded-lg border transition cursor-pointer ${
              viewMode === 'proofs' ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-950 text-slate-400 border-slate-800'
            }`}
          >
            Mathematical Invariant Proofs
          </button>
          <button
            onClick={() => setViewMode('tla-source')}
            className={`px-3 py-1.5 rounded-lg border transition cursor-pointer ${
              viewMode === 'tla-source' ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-950 text-slate-400 border-slate-800'
            }`}
          >
            TLA+ Formal Model Source (.tla)
          </button>
          <button
            onClick={() => setViewMode('tlc-log')}
            className={`px-3 py-1.5 rounded-lg border transition cursor-pointer flex items-center space-x-1.5 ${
              viewMode === 'tlc-log' ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-950 text-slate-400 border-slate-800'
            }`}
          >
            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
            <span>TLC Model Checker Log</span>
          </button>
        </div>
      </div>

      {/* Error banner */}
      {runError && (
        <div className="bg-red-950/40 border border-red-700/50 rounded-xl p-4 flex items-start gap-3 text-xs font-mono">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <div className="text-red-300 font-bold mb-1">TLC run failed — no result to show</div>
            <div className="text-red-200/80 whitespace-pre-wrap leading-relaxed">{runError}</div>
          </div>
        </div>
      )}

      {/* Verification Engine Banner — shows real numbers from the last run in
          THIS session, or a neutral "not yet run" state. It never shows
          hardcoded success numbers before a real run has happened. */}
      <div className={`bg-slate-900/90 border rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 text-xs font-mono ${
        modelResult ? (modelResult.errorFound ? 'border-red-500/30' : 'border-emerald-500/30') : 'border-slate-700'
      }`}>
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-lg ${modelResult && !modelResult.errorFound ? 'bg-emerald-950/60 border border-emerald-700/50 text-emerald-400' : 'bg-slate-800 border border-slate-700 text-slate-400'}`}>
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <div className="text-white font-bold flex items-center space-x-2">
              <span>
                {!modelResult && 'No model checker run yet this session'}
                {modelResult && !modelResult.errorFound && 'Real TLC Model Checker Run Verified'}
                {modelResult && modelResult.errorFound && 'TLC Ran — Violation Found'}
              </span>
            </div>
            <div className="text-slate-400 text-[11px] mt-0.5">
              Command: <code className="text-indigo-300">{modelResult?.command ?? 'java -cp tla2tools.jar tlc2.TLC -config GuardRuntime.cfg GuardRuntime.tla'}</code>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-4 text-[11px]">
          <div>
            <span className="text-slate-500">States Generated: </span>
            <span className="text-emerald-400 font-bold">{modelResult ? modelResult.statesGenerated : '—'}</span>
          </div>
          <div>
            <span className="text-slate-500">Distinct States: </span>
            <span className="text-emerald-400 font-bold">{modelResult ? modelResult.distinctStates : '—'}</span>
          </div>
          <div>
            <span className="text-slate-500">Search Depth: </span>
            <span className="text-indigo-400 font-bold">{modelResult ? modelResult.searchDepth : '—'}</span>
          </div>
          <div>
            <span className="text-slate-500">Errors: </span>
            <span className={`font-bold ${modelResult ? (modelResult.errorFound ? 'text-red-400' : 'text-emerald-400') : 'text-slate-500'}`}>
              {modelResult ? (modelResult.errorFound ? 'YES' : '0') : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Model Checker Stats */}
      {modelResult && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs font-mono">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-slate-500 mb-1">STATES GENERATED</div>
            <div className="text-2xl font-bold text-emerald-400">{modelResult.statesGenerated}</div>
            <div className="text-[11px] text-slate-400 mt-1">{modelResult.distinctStates} distinct</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-slate-500 mb-1">SEARCH DEPTH</div>
            <div className="text-2xl font-bold text-indigo-400">{modelResult.searchDepth}</div>
            <div className="text-[11px] text-slate-400 mt-1">levels explored</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-slate-500 mb-1">COUNTEREXAMPLES</div>
            <div className={`text-2xl font-bold ${modelResult.errorFound ? 'text-red-400' : 'text-emerald-400'}`}>
              {modelResult.errorFound ? 'Found' : '0'}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">{modelResult.errorFound ? 'see TLC log tab' : 'all invariants hold'}</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-slate-500 mb-1">EVALUATION TIME</div>
            <div className="text-2xl font-bold text-slate-200">{modelResult.executionTimeMs} ms</div>
            <div className="text-[11px] text-slate-400 mt-1">real subprocess wall time</div>
          </div>
        </div>
      )}

      {/* Content depending on view mode */}
      {viewMode === 'proofs' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">
              The 7 Formal Theorems & Invariants (THEOREMS.md)
            </h4>
            <span className="text-[11px] font-mono text-slate-400">
              {modelResult ? `Evaluated across ${modelResult.distinctStates} distinct TLC reachable states` : 'Run the model checker to see per-invariant results'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {['INV-1', 'INV-2', 'INV-3', 'INV-4', 'INV-5', 'INV-6', 'INV-7'].map((id) => {
              const meta = THEOREM_METADATA[id];
              const result = invariantById(id);
              return (
                <div key={id} className="p-4 bg-slate-950 rounded-xl border border-slate-800 text-xs font-mono space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 bg-indigo-950 text-indigo-300 rounded font-bold border border-indigo-800">
                      {id} — Property {meta.num}
                    </span>
                    {!result && (
                      <span className="flex items-center space-x-1 text-slate-500 font-bold text-[11px]">
                        <HelpCircle className="w-3.5 h-3.5" />
                        <span>NOT YET RUN</span>
                      </span>
                    )}
                    {result && result.verified && (
                      <span className="flex items-center space-x-1 text-emerald-400 font-bold text-[11px]">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>TLC VERIFIED ({modelResult!.distinctStates} states)</span>
                      </span>
                    )}
                    {result && !result.verified && (
                      <span className="flex items-center space-x-1 text-red-400 font-bold text-[11px]">
                        <XCircle className="w-3.5 h-3.5" />
                        <span>VIOLATED</span>
                      </span>
                    )}
                  </div>
                  <div className="font-bold text-slate-100 text-sm">{meta.name}</div>
                  <div className="p-2 bg-slate-900 rounded border border-slate-800 text-amber-300 text-[11px] overflow-x-auto">
                    {meta.formula}
                  </div>
                  <p className="text-slate-400 text-[11px] leading-relaxed">{meta.rationale}</p>
                  <div className="text-[10px] text-slate-500 italic pt-1 border-t border-slate-900">
                    Method: {meta.type}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {viewMode === 'tla-source' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h4 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">
              specifications/GuardRuntime.tla Source Code
            </h4>
            <span className="text-xs font-mono text-emerald-400">Formal TLA+ Specification</span>
          </div>

          <pre className="p-4 bg-slate-950 rounded-lg border border-slate-800 text-slate-300 font-mono text-xs overflow-x-auto leading-relaxed max-h-[500px]">
            {GuardRuntimeTlaSource}
          </pre>
        </div>
      )}

      {viewMode === 'tlc-log' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h4 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">
              Real TLC stdout — {modelResult ? 'this run' : 'not yet run'}
            </h4>
            {modelResult && (
              <span className={`text-xs font-mono ${modelResult.errorFound ? 'text-red-400' : 'text-emerald-400'}`}>
                {modelResult.errorFound ? 'Error found' : 'Pass'}
              </span>
            )}
          </div>

          <pre className="p-4 bg-slate-950 rounded-lg border border-slate-800 text-emerald-300 font-mono text-xs overflow-x-auto leading-relaxed max-h-[500px] whitespace-pre-wrap">
            {modelResult ? modelResult.rawLog : 'Click "Run State Space Model Checker" above to invoke real TLC and see its actual output here.'}
          </pre>
        </div>
      )}
    </div>
  );
};
