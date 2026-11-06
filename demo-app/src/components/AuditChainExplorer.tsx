import React, { useState } from 'react';
import { Database, ShieldCheck, AlertOctagon, RotateCcw, Flame, CheckCircle2, Lock, ArrowRight, Download } from 'lucide-react';
import { AuditBlock } from '../guardruntime/types';

interface AuditChainExplorerProps {
  blocks: AuditBlock[];
  verification: {
    isValid: boolean;
    brokenAtIndex?: number;
    errorReason?: string;
    verifiedBlockCount: number;
  };
  onSimulateTamper: (index: number) => Promise<void>;
  onResetLedger: () => Promise<void>;
}

export const AuditChainExplorer: React.FC<AuditChainExplorerProps> = ({
  blocks,
  verification,
  onSimulateTamper,
  onResetLedger
}) => {
  const [tamperIndexInput, setTamperIndexInput] = useState<number>(blocks.length > 1 ? 1 : 0);
  const [selectedBlock, setSelectedBlock] = useState<AuditBlock | null>(blocks[blocks.length - 1] || null);

  const handleExportLedger = () => {
    const exportData = {
      exportedAt: new Date().toISOString(),
      blockCount: blocks.length,
      verification,
      chain: blocks
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `guardruntime-audit-ledger-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Top Status Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <Database className="w-4 h-4 text-indigo-400" />
              <span>Append-Only Tamper-Evident Cryptographic Audit Ledger (INV-7)</span>
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Every authorization decision is cryptographically anchored using SHA-256 block hash chaining, Merkle tree trees, and Platform Configuration Register (PCR) hash extension.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={handleExportLedger}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition cursor-pointer"
              title="Download full JSON audit ledger with SHA-256 Merkle proofs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Ledger (.json)</span>
            </button>
            <button
              onClick={() => onResetLedger()}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Ledger</span>
            </button>
          </div>
        </div>

        {/* Verification Status Banner */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <span className="text-xs font-mono text-slate-400 font-semibold">LEDGER INTEGRITY VERIFICATION:</span>
            {verification.isValid ? (
              <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/50">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>CRYPTOGRAPHICALLY VALID ({verification.verifiedBlockCount} Blocks Verified)</span>
              </span>
            ) : (
              <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/50 animate-pulse">
                <AlertOctagon className="w-3.5 h-3.5" />
                <span>TAMPER DETECTED at Block #{verification.brokenAtIndex}! ({verification.errorReason})</span>
              </span>
            )}
          </div>

          {/* Tamper Attack Test Trigger */}
          <div className="flex items-center space-x-2 text-xs font-mono bg-slate-950 p-1.5 rounded-lg border border-slate-800">
            <span className="text-slate-400 pl-1.5">Tamper Target Block:</span>
            <input
              type="number"
              min={0}
              max={blocks.length - 1}
              value={tamperIndexInput}
              onChange={(e) => setTamperIndexInput(parseInt(e.target.value) || 0)}
              className="w-14 bg-slate-900 border border-slate-700 rounded p-1 text-center text-white focus:outline-none"
            />
            <button
              onClick={() => onSimulateTamper(tamperIndexInput)}
              className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded font-semibold flex items-center space-x-1 transition"
            >
              <Flame className="w-3 h-3" />
              <span>Simulate Tamper Attack</span>
            </button>
          </div>
        </div>
      </div>

      {/* Block Chain Grid */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
        <h4 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">
          Chain Blocks ({blocks.length} Recorded Decisions)
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {blocks.map((block) => {
            const isSelected = selectedBlock?.index === block.index;
            const isTampered = !verification.isValid && verification.brokenAtIndex === block.index;

            return (
              <button
                key={block.index}
                onClick={() => setSelectedBlock(block)}
                className={`p-3.5 rounded-xl border text-left transition-all text-xs font-mono ${
                  isTampered
                    ? 'bg-rose-950/70 border-rose-600 ring-2 ring-rose-500 animate-pulse'
                    : isSelected
                    ? 'bg-indigo-950/80 border-indigo-500 ring-2 ring-indigo-500/20'
                    : 'bg-slate-950/70 border-slate-800 hover:bg-slate-850'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-white">BLOCK #{block.index}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    block.verdict === 'ALLOW' ? 'bg-emerald-950 text-emerald-300' :
                    block.verdict === 'REQUIRE_CONFIRMATION' ? 'bg-amber-950 text-amber-300' : 'bg-rose-950 text-rose-300'
                  }`}>
                    {block.verdict}
                  </span>
                </div>

                <div className="text-slate-400 text-[11px] space-y-1">
                  <div>
                    <span className="text-slate-500">Decision ID:</span> {block.decisionId.slice(0, 16)}...
                  </div>
                  <div>
                    <span className="text-slate-500">Block Hash:</span>{' '}
                    <span className="text-indigo-300 break-all">{block.blockHash.slice(0, 16)}...</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Merkle Root:</span>{' '}
                    <span className="text-emerald-400 break-all">{block.merkleRoot.slice(0, 16)}...</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Selected Block Detailed Inspector */}
        {selectedBlock && (
          <div className="mt-4 p-4 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="font-bold text-indigo-300">BLOCK #{selectedBlock.index} CRYPTOGRAPHIC DETAILS</span>
              <span className="text-slate-400">{new Date(selectedBlock.timestamp).toISOString()}</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div>
                  <span className="text-slate-500 block">CURRENT BLOCK HASH:</span>
                  <span className="text-indigo-300 break-all">{selectedBlock.blockHash}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">PREVIOUS BLOCK HASH (CHAIN LINK):</span>
                  <span className="text-slate-400 break-all">{selectedBlock.previousHash}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">ACTION DIGEST (SHA-256):</span>
                  <span className="text-slate-300 break-all">{selectedBlock.actionDigest}</span>
                </div>
              </div>

              <div className="space-y-2">
                <div>
                  <span className="text-slate-500 block">MERKLE ROOT ACCUMULATOR:</span>
                  <span className="text-emerald-400 break-all">{selectedBlock.merkleRoot}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">PCR REGISTER EXTENSION:</span>
                  <span className="text-amber-300 break-all">{selectedBlock.pcrRegisterHash}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">TENANT & PRINCIPAL:</span>
                  <span className="text-slate-300">{selectedBlock.tenantId} / {selectedBlock.principalId}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
