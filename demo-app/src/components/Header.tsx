import React, { useState } from 'react';
import { Shield, Activity, Lock, Cpu, Server, CheckCircle2, AlertTriangle, AlertOctagon, Download, ShieldAlert, Award, RefreshCw, FileArchive } from 'lucide-react';
import { downloadCompleteProjectZip } from '../utils/zipDownloader';

export type ActiveTab = 'playground' | 'pipeline' | 'agent-sim' | 'generalization' | 'cache-bench' | 'adversarial' | 'conformance' | 'audit' | 'formal-tla' | 'policy-algebra' | 'mcp-gateway';

interface HeaderProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  runtimeHealth: 'HEALTHY' | 'DEGRADED' | 'MAINTENANCE';
  onToggleHealth: (health: 'HEALTHY' | 'DEGRADED' | 'MAINTENANCE') => void;
  telemetry: {
    totalRequests: number;
    allowedCount: number;
    blockedCount: number;
    confirmedCount: number;
    cacheHits: number;
    invariantEvaluations: number;
  };
  onOpenDownloadZip?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  runtimeHealth,
  onToggleHealth,
  telemetry,
  onOpenDownloadZip
}) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);

  const handleDirectZipDownload = async () => {
    setIsDownloading(true);
    setDownloadNotice('Fetching ~300 KB package...');
    await downloadCompleteProjectZip((status, msg) => {
      if (status === 'downloading') {
        setDownloadNotice(msg || 'Packaging...');
      } else if (status === 'ready') {
        setDownloadNotice('Downloaded!');
        setTimeout(() => setDownloadNotice(null), 3500);
      } else {
        setDownloadNotice('Failed, opening modal...');
        if (onOpenDownloadZip) onOpenDownloadZip();
        setTimeout(() => setDownloadNotice(null), 3000);
      }
    });
    setIsDownloading(false);
  };
  const tabs: Array<{ id: ActiveTab; label: string; icon: any }> = [
    { id: 'pipeline', label: '11-Stage Pipeline', icon: Shield },
    { id: 'adversarial', label: 'Red-Team Adversarial', icon: ShieldAlert },
    { id: 'conformance', label: 'Protocol Conformance', icon: Award },
    { id: 'playground', label: 'Interactive Sandbox', icon: Cpu },
    { id: 'agent-sim', label: 'Agent Simulation Lab', icon: Activity },
    { id: 'generalization', label: '6-Split Benchmark', icon: Server },
    { id: 'cache-bench', label: 'Plan Cache & Savings', icon: Lock },
    { id: 'audit', label: 'Cryptographic Audit', icon: CheckCircle2 },
    { id: 'formal-tla', label: 'TLA+ Invariants', icon: Shield },
    { id: 'policy-algebra', label: 'Policy Algebra', icon: Lock },
    { id: 'mcp-gateway', label: 'MCP Gateway', icon: Server }
  ];

  return (
    <header className="bg-slate-900 border-b border-slate-800 text-slate-100 sticky top-0 z-40">
      {/* Top Banner */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-indigo-600/20 border border-indigo-500/40 rounded-lg text-indigo-400 flex items-center justify-center">
            <Shield className="w-6 h-6 text-indigo-400" />
          </div>
          <div>
            <div className="flex items-center space-x-2 flex-wrap gap-y-1">
              <h1 className="text-lg font-bold tracking-tight text-white">GuardRuntime</h1>
              <span className="text-xs px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-700 font-mono font-medium">
                Protocol Spec v0.1
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 font-mono">
                100% Deterministic Engine
              </span>
              {/* Direct Download ZIP button right next to 100% Deterministic Engine */}
              <a
                id="btn-download-zip-inline"
                href="/api/export/zip"
                target="_blank"
                rel="noopener noreferrer"
                download="guardruntime-complete.zip"
                className="flex items-center space-x-1.5 px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition border border-indigo-400/60 cursor-pointer ml-1 no-underline"
                title="Direct Download: guardruntime-complete.zip (300 KB)"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Full ZIP (~300 KB)</span>
              </a>
            </div>
            <p className="text-xs text-slate-400">Autonomous Agent Authorization & Execution Boundary Research Engine</p>
          </div>
        </div>

        {/* Health State Controls, Telemetry & Download ZIP */}
        <div className="flex items-center space-x-3 flex-wrap gap-y-2">
          {/* Download ZIP Button (Opens Modal with links & curl) */}
          {onOpenDownloadZip && (
            <button
              onClick={onOpenDownloadZip}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition cursor-pointer"
              title="View all download options, curl command, and direct links"
            >
              <FileArchive className="w-3.5 h-3.5 text-indigo-400" />
              <span>Export Options</span>
            </button>
          )}

          <div className="flex items-center space-x-2 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 text-xs font-mono">
            <span className="text-slate-400">Health Gate:</span>
            <button
              onClick={() => onToggleHealth(runtimeHealth === 'HEALTHY' ? 'DEGRADED' : 'HEALTHY')}
              className={`flex items-center space-x-1.5 px-2 py-0.5 rounded font-semibold transition-all ${
                runtimeHealth === 'HEALTHY'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 animate-pulse'
              }`}
              title="Toggle to test Fail-Closed Property (INV-5)"
            >
              {runtimeHealth === 'HEALTHY' ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>HEALTHY</span>
                </>
              ) : (
                <>
                  <AlertOctagon className="w-3.5 h-3.5" />
                  <span>DEGRADED (Fail-Closed)</span>
                </>
              )}
            </button>
          </div>

          <div className="hidden md:flex items-center space-x-3 text-xs font-mono bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 text-slate-300">
            <div>
              <span className="text-slate-500">Evaluations:</span> <span className="text-white font-bold">{telemetry.totalRequests}</span>
            </div>
            <div className="h-3 w-px bg-slate-800" />
            <div>
              <span className="text-emerald-400">ALLOW:</span> {telemetry.allowedCount}
            </div>
            <div className="h-3 w-px bg-slate-800" />
            <div>
              <span className="text-amber-400">CONFIRM:</span> {telemetry.confirmedCount}
            </div>
            <div className="h-3 w-px bg-slate-800" />
            <div>
              <span className="text-rose-400">BLOCK:</span> {telemetry.blockedCount}
            </div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 border-t border-slate-800/80">
        <nav className="flex space-x-1 overflow-x-auto py-2 scrollbar-none" aria-label="Tabs">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
