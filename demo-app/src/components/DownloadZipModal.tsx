import React, { useState } from 'react';
import { Download, X, FileArchive, CheckCircle2, ShieldCheck, Database, Code, Terminal, Copy, ExternalLink, AlertCircle, Loader2 } from 'lucide-react';
import { AuditBlock } from '../guardruntime/types';
import { downloadCompleteProjectZip } from '../utils/zipDownloader';

interface DownloadZipModalProps {
  isOpen: boolean;
  onClose: () => void;
  auditBlocks?: AuditBlock[];
  auditVerification?: { isValid: boolean; verifiedBlockCount: number; brokenAtIndex?: number };
}

export const DownloadZipModal: React.FC<DownloadZipModalProps> = ({
  isOpen,
  onClose,
  auditBlocks = [],
  auditVerification
}) => {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'ready' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');

  if (!isOpen) return null;

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const directDownloadUrl = `${currentOrigin}/api/export/zip`;
  const curlCommand = `curl -OJ ${directDownloadUrl}`;

  const handleDirectDownload = async () => {
    setDownloadStatus('downloading');
    setStatusMessage('Preparing and downloading ZIP archive...');
    try {
      await downloadCompleteProjectZip((status, msg) => {
        setDownloadStatus(status);
        if (msg) setStatusMessage(msg);
      });
    } catch (e: any) {
      setDownloadStatus('error');
      setStatusMessage(e.message || 'Download failed');
    }
  };

  const copyToClipboard = (text: string, type: 'url' | 'curl') => {
    navigator.clipboard.writeText(text);
    if (type === 'url') {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2500);
    } else {
      setCopiedCurl(true);
      setTimeout(() => setCopiedCurl(false), 2500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-w-xl w-full p-6 text-slate-100 relative space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-indigo-600/20 border border-indigo-500/40 rounded-xl text-indigo-400">
              <FileArchive className="w-6 h-6 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center space-x-2">
                <span>Download Complete GuardRuntime Archive</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Complete project archive (~300 KB) with React UI, Express server, TLC formal model proofs, and benchmarks
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Primary Download Card */}
        <div className="p-4 bg-slate-950 border border-indigo-500/50 rounded-xl space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <Code className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-bold text-white">Direct ZIP Download</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 font-mono font-bold">~300 KB</span>
              </div>
              <p className="text-xs text-slate-400">
                Contains all project files: full source code, Express backend, 11-stage pipeline, formal TLA+ spec, TLC execution log, and benchmark suites.
              </p>
            </div>

            <button
              onClick={handleDirectDownload}
              disabled={downloadStatus === 'downloading'}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white rounded-lg text-xs font-bold shadow-lg shadow-indigo-600/30 flex items-center justify-center space-x-2 transition cursor-pointer whitespace-nowrap shrink-0"
            >
              {downloadStatus === 'downloading' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Downloading...</span>
                </>
              ) : downloadStatus === 'ready' ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Downloaded!</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Download ZIP Now</span>
                </>
              )}
            </button>
          </div>

          {statusMessage && (
            <div className={`p-2 rounded text-xs flex items-center space-x-2 ${downloadStatus === 'ready' ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-800/60' : downloadStatus === 'error' ? 'bg-rose-950/40 text-rose-300 border border-rose-800/60' : 'bg-indigo-950/40 text-indigo-300 border border-indigo-800/60'}`}>
              {downloadStatus === 'ready' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
              <span>{statusMessage}</span>
            </div>
          )}

          <div className="p-2.5 bg-indigo-950/30 border border-indigo-900/50 rounded-lg text-[11px] text-indigo-300 flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <span>
              <strong>Direct File Download:</strong> Clicking the button triggers an immediate in-memory blob download saving <code className="text-white">guardruntime-complete.zip</code> straight to your Downloads folder.
            </span>
          </div>
        </div>

        {/* Direct URL Box */}
        <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-slate-300 font-medium">Direct Browser Download URL:</span>
            <button
              onClick={() => copyToClipboard(directDownloadUrl, 'url')}
              className="text-indigo-400 hover:text-indigo-300 flex items-center space-x-1 text-xs cursor-pointer"
            >
              {copiedUrl ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedUrl ? 'Copied URL!' : 'Copy URL'}</span>
            </button>
          </div>
          <div className="p-2 bg-slate-900 rounded border border-slate-800 font-mono text-[11px] text-indigo-300 break-all select-all">
            {directDownloadUrl}
          </div>
        </div>

        {/* CLI Command Option */}
        <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono space-y-1.5">
          <div className="flex items-center justify-between text-slate-400">
            <div className="flex items-center space-x-2">
              <Terminal className="w-3.5 h-3.5 text-indigo-400" />
              <span className="font-semibold text-slate-300">Terminal cURL Download:</span>
            </div>
            <button
              onClick={() => copyToClipboard(curlCommand, 'curl')}
              className="text-indigo-400 hover:text-indigo-300 flex items-center space-x-1 text-xs cursor-pointer"
            >
              {copiedCurl ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedCurl ? 'Copied Command!' : 'Copy Command'}</span>
            </button>
          </div>
          <div className="p-2.5 bg-slate-900 rounded border border-slate-800/80 text-indigo-300 flex items-center justify-between select-all">
            <code>{curlCommand}</code>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-slate-800 pt-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};


