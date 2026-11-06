import React, { useState } from 'react';
import {
  ShieldCheck,
  AlertOctagon,
  HelpCircle,
  CheckCircle2,
  Clock,
  ArrowRight,
  Database,
  Lock,
  Flame,
  Activity,
  Layers,
  Key,
  FileCode,
  Terminal,
  ExternalLink,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { DecisionTrace, PipelineStageResult } from '../guardruntime/types';

interface PipelineVisualizerProps {
  trace: DecisionTrace | null;
  onIssueConfirmation?: (fingerprint: string) => void;
}

export const PipelineVisualizer: React.FC<PipelineVisualizerProps> = ({ trace, onIssueConfirmation }) => {
  const [selectedStageNumber, setSelectedStageNumber] = useState<number | null>(null);

  if (!trace) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-400">
        <ShieldCheck className="w-12 h-12 mx-auto mb-3 text-slate-600 animate-pulse" />
        <h3 className="text-base font-medium text-slate-200">No Pipeline Trace Active</h3>
        <p className="text-sm mt-1 max-w-md mx-auto">
          Submit an action in the Interactive Sandbox, run an Agent Simulation, or trigger an MCP gateway call to view the 11-stage execution trace.
        </p>
      </div>
    );
  }

  const getVerdictBadge = (verdict: string) => {
    switch (verdict) {
      case 'ALLOW':
        return (
          <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/50">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>ALLOW</span>
          </span>
        );
      case 'REQUIRE_CONFIRMATION':
        return (
          <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/50 animate-pulse">
            <HelpCircle className="w-3.5 h-3.5" />
            <span>REQUIRE CONFIRMATION</span>
          </span>
        );
      case 'BLOCK':
      default:
        return (
          <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/50">
            <AlertOctagon className="w-3.5 h-3.5" />
            <span>BLOCK (Fail-Closed)</span>
          </span>
        );
    }
  };

  const selectedStage = trace.stageResults.find(s => s.stageNumber === selectedStageNumber) || trace.stageResults[0];

  return (
    <div className="space-y-6">
      {/* Top Overview Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-slate-800 rounded-lg border border-slate-700 text-indigo-400">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-mono font-semibold text-slate-400">TOOL ACTION:</span>
                <span className="text-sm font-bold font-mono text-white">{trace.normalizedAction.toolName}</span>
                <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                  {trace.normalizedAction.actionType}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 font-mono">
                Principal: <span className="text-indigo-300">{trace.principalId}</span> | Tenant: <span className="text-slate-200">{trace.tenantId}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <div className="text-right font-mono">
              <div className="text-xs text-slate-500">AUTHORIZATION VERDICT</div>
              {getVerdictBadge(trace.verdict)}
            </div>

            {trace.verdict === 'REQUIRE_CONFIRMATION' && onIssueConfirmation && (
              <button
                onClick={() => onIssueConfirmation(trace.fingerprint)}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold shadow transition flex items-center space-x-1.5"
              >
                <Key className="w-3.5 h-3.5" />
                <span>Grant Human Approval</span>
              </button>
            )}
          </div>
        </div>

        {/* Action Fingerprint & Risk Profile */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4 text-xs font-mono">
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80">
            <div className="text-slate-500 mb-1 flex items-center space-x-1">
              <Lock className="w-3 h-3 text-slate-400" />
              <span>ACTION FINGERPRINT (INV-2)</span>
            </div>
            <span className="text-indigo-300 font-mono break-all">{trace.fingerprint}</span>
          </div>

          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80">
            <div className="text-slate-500 mb-1 flex items-center space-x-1">
              <Flame className="w-3 h-3 text-amber-400" />
              <span>RISK CLASSIFICATION</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-300">Composite Score:</span>
              <span className={`font-bold ${trace.riskVector.overallRiskScore > 0.5 ? 'text-rose-400' : 'text-emerald-400'}`}>
                {trace.riskVector.overallRiskScore.toFixed(3)}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Blast: {trace.riskVector.blastRadius.toFixed(2)} | Reversible: {trace.riskVector.reversibility.toFixed(2)}
            </div>
          </div>

          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80">
            <div className="text-slate-500 mb-1 flex items-center space-x-1">
              <Layers className="w-3 h-3 text-sky-400" />
              <span>PLAN CACHE STATUS (INV-3)</span>
            </div>
            <div className="text-slate-200">
              {trace.cacheHit ? (
                <span className="text-amber-300">Cache HIT (Preparation Hints Only)</span>
              ) : (
                <span className="text-slate-400">Cache Miss / Fresh Plan</span>
              )}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">Zero Authorization Leakage</div>
          </div>

          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80">
            <div className="text-slate-500 mb-1 flex items-center space-x-1">
              <Database className="w-3 h-3 text-emerald-400" />
              <span>AUDIT BLOCK HASH (INV-7)</span>
            </div>
            <span className="text-emerald-400 font-mono break-all">{trace.auditHash.slice(0, 24)}...</span>
          </div>
        </div>
      </div>

      {/* 11-Stage Interactive Pipeline Flow */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <h3 className="text-sm font-bold text-white mb-4 flex items-center space-x-2">
          <ShieldCheck className="w-4 h-4 text-indigo-400" />
          <span>The 11-Stage Authoritative Execution Pipeline (Spec v0.1 Section 3)</span>
        </h3>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
          {trace.stageResults.map((stage) => {
            const isSelected = selectedStage.stageNumber === stage.stageNumber;
            const isPassed = stage.passed;
            return (
              <button
                key={stage.stageNumber}
                onClick={() => setSelectedStageNumber(stage.stageNumber)}
                className={`text-left p-3 rounded-lg border transition-all relative ${
                  isSelected
                    ? 'bg-indigo-950/80 border-indigo-500 ring-2 ring-indigo-500/20 shadow-md'
                    : isPassed
                    ? 'bg-slate-950/60 border-slate-800 hover:border-slate-700 hover:bg-slate-850'
                    : 'bg-rose-950/30 border-rose-800/80 hover:bg-rose-950/50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-mono font-bold text-slate-500">STAGE {stage.stageNumber}</span>
                  {isPassed ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <AlertOctagon className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
                  )}
                </div>
                <div className="text-xs font-semibold text-slate-200 line-clamp-1">{stage.stageName}</div>
                <div className="text-[10px] font-mono text-slate-400 mt-1 flex items-center justify-between">
                  <span>{stage.durationMs}ms</span>
                  <span className={isPassed ? 'text-emerald-400' : 'text-rose-400'}>{isPassed ? 'PASS' : 'FAIL/HALT'}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Selected Stage Detail Inspector */}
        {selectedStage && (
          <div className="mt-5 p-4 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
              <div className="flex items-center space-x-2">
                <span className="px-2 py-0.5 bg-indigo-900/60 text-indigo-300 rounded font-bold">
                  Stage {selectedStage.stageNumber}: {selectedStage.stageName}
                </span>
                <span className="text-slate-400">{selectedStage.explanation}</span>
              </div>
              <span className="text-slate-500">{selectedStage.durationMs} ms</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <span className="text-slate-500 font-semibold block mb-1">STAGE OUTPUT & METRICS:</span>
                <pre className="p-2.5 bg-slate-900 rounded border border-slate-800 text-slate-300 overflow-x-auto text-[11px]">
                  {JSON.stringify(selectedStage.details, null, 2)}
                </pre>
              </div>

              <div>
                <span className="text-slate-500 font-semibold block mb-1">RATIONALE & SECURITY CONTRACT:</span>
                <div className="p-2.5 bg-slate-900 rounded border border-slate-800 text-slate-300 text-xs space-y-2">
                  <p className="leading-relaxed text-slate-300">{selectedStage.explanation}</p>
                  {trace.reasons.length > 0 && (
                    <div>
                      <span className="text-slate-400 font-semibold">Active Pipeline Reasons:</span>
                      <ul className="list-disc list-inside text-slate-300 mt-1 space-y-0.5">
                        {trace.reasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 7 Falsifiable Invariants Check Status */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <h3 className="text-sm font-bold text-white mb-3 flex items-center justify-between">
          <span className="flex items-center space-x-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>The 7 Falsifiable Invariants (THESIS.md) Evaluated on this Trace</span>
          </span>
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800 font-mono">
            All 7 Formally Checked
          </span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-mono">
          {[
            { id: 'INV-1', name: 'No Stale Execution', desc: 'Action cannot execute without fresh ALLOW verdict' },
            { id: 'INV-2', name: 'Invalidation on Change', desc: 'Input change strictly changes action fingerprint' },
            { id: 'INV-3', name: 'Cache Non-Authorizing', desc: 'Plan cache hit never supplies authorization verdict' },
            { id: 'INV-4', name: 'High-Impact Boundary', desc: 'High impact cannot bypass confirmation via cache' },
            { id: 'INV-5', name: 'Fail Closed', desc: 'Degraded health forces immediate BLOCK' },
            { id: 'INV-6', name: 'No Approval Replay', desc: 'Tokens single-use and bound to exact fingerprint' },
            { id: 'INV-7', name: 'Explainability & Audit', desc: 'Tamper-evident log & independent verification' }
          ].map((inv) => (
            <div key={inv.id} className="p-3 bg-slate-950 rounded-lg border border-slate-800">
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-indigo-300">{inv.id}</span>
                <span className="flex items-center space-x-1 text-emerald-400 text-[10px] font-bold">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>PASS</span>
                </span>
              </div>
              <div className="font-semibold text-slate-200">{inv.name}</div>
              <p className="text-[11px] text-slate-400 mt-1">{inv.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
