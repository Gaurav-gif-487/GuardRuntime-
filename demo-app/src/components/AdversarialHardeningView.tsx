import React, { useState } from 'react';
import { ShieldAlert, Play, CheckCircle2, XCircle, AlertTriangle, Terminal, RefreshCw, Cpu, Layers, UserX, GitFork } from 'lucide-react';
import { AdversarialRedTeamHarness, AdversarialReport } from '../guardruntime/adversarial';

export const AdversarialHardeningView: React.FC = () => {
  const [report, setReport] = useState<AdversarialReport | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [selectedAttackId, setSelectedAttackId] = useState<string | null>(null);

  const handleRunAdversarial = async () => {
    setIsRunning(true);
    try {
      const res = await fetch('/api/eval/adversarial', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setReport(data.report);
      } else {
        const fallback = await AdversarialRedTeamHarness.runAllAttacks();
        setReport(fallback);
      }
    } catch {
      const fallback = await AdversarialRedTeamHarness.runAllAttacks();
      setReport(fallback);
    } finally {
      setIsRunning(false);
    }
  };

  const activeAttack = report?.attackResults.find(a => a.attackId === selectedAttackId) || report?.attackResults[0];

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-3 mb-2">
              <div className="p-2 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400">
                <ShieldAlert className="w-6 h-6 text-rose-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">Phase H: Adversarial & Red-Team Hardening</h2>
                <p className="text-sm text-slate-400">
                  Targeted invariant evasion, confused-deputy cache exploits, token replay, multi-agent indirect prompt injections & concurrency races.
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={handleRunAdversarial}
            disabled={isRunning}
            className="flex items-center space-x-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg shadow transition cursor-pointer self-start md:self-auto"
          >
            {isRunning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-white" />}
            <span>{isRunning ? 'Executing Red-Team Attacks...' : 'Run Adversarial Suite'}</span>
          </button>
        </div>

        {report && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-slate-800">
            <div className="p-4 bg-slate-950/60 border border-slate-800/80 rounded-lg">
              <div className="text-xs font-medium text-slate-400">Attacks Attempted</div>
              <div className="text-2xl font-bold text-white mt-1">{report.totalAttacksAttempted}</div>
            </div>
            <div className="p-4 bg-slate-950/60 border border-slate-800/80 rounded-lg">
              <div className="text-xs font-medium text-slate-400">Attacks Thwarted</div>
              <div className="text-2xl font-bold text-emerald-400 mt-1">{report.attacksThwartedCount}</div>
            </div>
            <div className="p-4 bg-slate-950/60 border border-slate-800/80 rounded-lg">
              <div className="text-xs font-medium text-slate-400">Defense Rate</div>
              <div className="text-2xl font-bold text-indigo-400 mt-1">{(report.defenseSuccessRate * 100).toFixed(1)}%</div>
            </div>
            <div className="p-4 bg-slate-950/60 border border-slate-800/80 rounded-lg">
              <div className="text-xs font-medium text-slate-400">Open Vulnerabilities</div>
              <div className="text-2xl font-bold text-emerald-400 mt-1">{report.openFindingsCount}</div>
            </div>
          </div>
        )}
      </div>

      {!report && !isRunning && (
        <div className="text-center py-16 bg-slate-900 border border-slate-800 rounded-xl">
          <ShieldAlert className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-300">No Red-Team Evaluation Active</h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto mt-1 mb-4">
            Click "Run Adversarial Suite" above to launch automated penetration testing and invariant attacks against the deterministic execution boundary.
          </p>
          <button
            onClick={handleRunAdversarial}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-lg transition"
          >
            Launch Red-Team Harness
          </button>
        </div>
      )}

      {report && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Attack Case List */}
          <div className="lg:col-span-1 space-y-3">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider px-1">Red-Team Attack Vectors</h3>
            <div className="space-y-2">
              {report.attackResults.map((atk) => {
                const isSelected = atk.attackId === activeAttack?.attackId;
                return (
                  <button
                    key={atk.attackId}
                    onClick={() => setSelectedAttackId(atk.attackId)}
                    className={`w-full text-left p-3.5 rounded-lg border transition cursor-pointer ${
                      isSelected
                        ? 'bg-slate-800 border-indigo-500 text-white ring-1 ring-indigo-500/40'
                        : 'bg-slate-900/80 border-slate-800 hover:bg-slate-800/60 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800">
                        {atk.attackId}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                        atk.attackThwarted ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-rose-950 text-rose-300 border border-rose-800'
                      }`}>
                        {atk.attackThwarted ? 'THWARTED' : 'EXPLOITED'}
                      </span>
                    </div>
                    <div className="text-sm font-medium mt-2 text-slate-200 line-clamp-1">{atk.attackName}</div>
                    <div className="text-xs text-slate-400 mt-1 font-mono">{atk.targetInvariant}</div>
                  </button>
                );
              })}
            </div>

            {/* Concurrency & Multi-Agent Highlights */}
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3 mt-4">
              <div className="flex items-center space-x-2 text-indigo-400 text-xs font-bold uppercase tracking-wider">
                <GitFork className="w-4 h-4" />
                <span>Multi-Agent Taint (Audit Item 10)</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {report.multiAgentTaintAnalysis.secondOrderTaintResolution}
              </p>
              
              <div className="pt-3 border-t border-slate-800 flex items-center space-x-2 text-indigo-400 text-xs font-bold uppercase tracking-wider">
                <Cpu className="w-4 h-4" />
                <span>Concurrency Double-Spend Test</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {report.concurrencyRaceAnalysis.summary}
              </p>
            </div>
          </div>

          {/* Active Attack Deep Dive */}
          {activeAttack && (
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                  <div>
                    <span className="text-xs font-mono text-indigo-400 uppercase tracking-wider">{activeAttack.category}</span>
                    <h3 className="text-lg font-bold text-white mt-1">{activeAttack.attackName}</h3>
                  </div>
                  <div className="flex items-center space-x-2">
                    {activeAttack.attackThwarted ? (
                      <span className="flex items-center space-x-1.5 px-3 py-1 bg-emerald-950 text-emerald-300 border border-emerald-700 text-xs font-semibold rounded-full">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Defense Succeeded</span>
                      </span>
                    ) : (
                      <span className="flex items-center space-x-1.5 px-3 py-1 bg-rose-950 text-rose-300 border border-rose-700 text-xs font-semibold rounded-full">
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Vulnerability Detected</span>
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-4">
                  <div className="p-3.5 bg-slate-950 rounded-lg border border-slate-800">
                    <div className="text-xs font-semibold text-slate-400 mb-1">Attacker Goal</div>
                    <div className="text-xs text-slate-200 font-mono">{activeAttack.attackerGoal}</div>
                  </div>
                  <div className="p-3.5 bg-slate-950 rounded-lg border border-slate-800">
                    <div className="text-xs font-semibold text-slate-400 mb-1">Target Falsifiable Property</div>
                    <div className="text-xs text-indigo-300 font-mono">{activeAttack.targetInvariant}</div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Attack Description</div>
                  <p className="text-sm text-slate-300 leading-relaxed bg-slate-950/60 p-3 rounded-lg border border-slate-800/60">
                    {activeAttack.description}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 my-4">
                  <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800">
                    <div className="text-xs text-slate-400">Observed Verdict</div>
                    <div className="text-sm font-bold text-rose-400 font-mono mt-0.5">{activeAttack.actualVerdict}</div>
                  </div>
                  <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800">
                    <div className="text-xs text-slate-400">Neutralizing Stage</div>
                    <div className="text-sm font-bold text-emerald-400 font-mono mt-0.5">{activeAttack.blockingStage}</div>
                  </div>
                  <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800">
                    <div className="text-xs text-slate-400">Executed on Real Sink</div>
                    <div className="text-sm font-bold text-emerald-400 font-mono mt-0.5">
                      {activeAttack.executionOutcomeExecuted ? 'YES (Breached)' : 'NO (Protected)'}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Defense Rationale & Invariant Check</div>
                  <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 font-mono text-xs text-slate-300">
                    {activeAttack.defenseExplanation}
                  </div>
                </div>

                {/* Raw Trace JSON */}
                <div className="mt-4 pt-4 border-t border-slate-800">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center space-x-1.5">
                      <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Cryptographic Decision Trace</span>
                    </span>
                    <span className="text-xs font-mono text-slate-500">ID: {activeAttack.rawTrace.decisionId}</span>
                  </div>
                  <pre className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-slate-300 font-mono text-xs overflow-x-auto max-h-48">
                    {JSON.stringify({
                      verdict: activeAttack.rawTrace.verdict,
                      fingerprint: activeAttack.rawTrace.fingerprint,
                      auditHash: activeAttack.rawTrace.auditHash,
                      riskVector: activeAttack.rawTrace.riskVector,
                      invariantsPassed: activeAttack.rawTrace.invariantsPassed,
                      stageSummary: activeAttack.rawTrace.stageResults.map(s => ({ stage: s.stageName, passed: s.passed, durationMs: s.durationMs }))
                    }, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
