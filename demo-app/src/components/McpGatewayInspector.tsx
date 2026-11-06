import React, { useState } from 'react';
import { Server, Play, CheckCircle2, AlertOctagon, HelpCircle, Terminal, ArrowRight } from 'lucide-react';
import { McpJsonRpcRequest, McpJsonRpcResponse } from '../guardruntime/mcp-gateway';

interface McpGatewayInspectorProps {
  onSendMcpRequest: (req: McpJsonRpcRequest, confirmationTokenId?: string) => Promise<McpJsonRpcResponse>;
}

export const McpGatewayInspector: React.FC<McpGatewayInspectorProps> = ({ onSendMcpRequest }) => {
  const [requestJson, setRequestJson] = useState<string>(
    JSON.stringify(
      {
        jsonrpc: '2.0',
        id: 'req-mcp-101',
        method: 'tools/call',
        params: {
          name: 'infra.deploy',
          arguments: {
            service: 'payment-gateway',
            environment: 'staging',
            replicaCount: 3
          }
        }
      },
      null,
      2
    )
  );

  const [responseJson, setResponseJson] = useState<string | null>(null);
  const [confirmationTokenInput, setConfirmationTokenInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSendRequest = async () => {
    try {
      setErrorMsg(null);
      const parsed = JSON.parse(requestJson);
      setIsLoading(true);
      const res = await onSendMcpRequest(parsed, confirmationTokenInput || undefined);
      setResponseJson(JSON.stringify(res, null, 2));
    } catch (e: any) {
      setErrorMsg(`Request parse error: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetPreset = (type: 'tools_list' | 'deploy_staging' | 'unauthorized_exec') => {
    if (type === 'tools_list') {
      setRequestJson(JSON.stringify({ jsonrpc: '2.0', id: 'req-list-01', method: 'tools/list' }, null, 2));
    } else if (type === 'deploy_staging') {
      setRequestJson(
        JSON.stringify(
          {
            jsonrpc: '2.0',
            id: 'req-deploy-02',
            method: 'tools/call',
            params: { name: 'infra.deploy', arguments: { service: 'checkout-api', environment: 'staging', replicaCount: 2 } }
          },
          null,
          2
        )
      );
    } else if (type === 'unauthorized_exec') {
      setRequestJson(
        JSON.stringify(
          {
            jsonrpc: '2.0',
            id: 'req-exec-03',
            method: 'tools/call',
            params: { name: 'system.executeCommand', arguments: { command: 'cat /etc/passwd' } }
          },
          null,
          2
        )
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <Server className="w-4 h-4 text-indigo-400" />
              <span>Phase D — Model Context Protocol (MCP) Live JSON-RPC 2.0 Gateway</span>
            </h3>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">
              Interposes GuardRuntime as a deterministic security proxy in front of MCP-speaking agents (e.g. Claude Code, Cursor, LLM tool dispatchers) gating every JSON-RPC tool call with cryptographic auditing.
            </p>
          </div>

          <div className="flex items-center space-x-2 text-xs font-mono">
            <button
              onClick={() => handleSetPreset('tools_list')}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700"
            >
              tools/list
            </button>
            <button
              onClick={() => handleSetPreset('deploy_staging')}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700"
            >
              tools/call (deploy)
            </button>
            <button
              onClick={() => handleSetPreset('unauthorized_exec')}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700"
            >
              tools/call (unauthorized)
            </button>
          </div>
        </div>
      </div>

      {/* JSON-RPC Request & Response Split Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Request Editor */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-3 font-mono text-xs">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-bold text-indigo-300">MCP CLIENT JSON-RPC 2.0 REQUEST:</span>
            <span className="text-slate-500">HTTP POST /api/mcp/gateway</span>
          </div>

          <textarea
            rows={12}
            value={requestJson}
            onChange={(e) => setRequestJson(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-200 text-xs focus:outline-none focus:border-indigo-500 leading-relaxed font-mono"
          />

          <div>
            <label className="text-slate-400 block mb-1">CONFIRMATION TOKEN (OPTIONAL):</label>
            <input
              type="text"
              value={confirmationTokenInput}
              onChange={(e) => setConfirmationTokenInput(e.target.value)}
              placeholder="Paste token to authorize high-impact calls..."
              className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200"
            />
          </div>

          {errorMsg && <p className="text-rose-400 text-xs">{errorMsg}</p>}

          <button
            onClick={handleSendRequest}
            disabled={isLoading}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg font-bold shadow-lg shadow-indigo-600/30 flex items-center justify-center space-x-2 transition cursor-pointer"
          >
            <Play className="w-4 h-4" />
            <span>{isLoading ? 'Routing through Gateway...' : 'Send MCP JSON-RPC Request'}</span>
          </button>
        </div>

        {/* Response Viewer */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-3 font-mono text-xs">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-bold text-emerald-400">GUARDRUNTIME GATEWAY RESPONSE:</span>
            <span className="text-slate-500">RFC Compliant Outcome</span>
          </div>

          {responseJson ? (
            <pre className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-slate-200 overflow-x-auto text-[11px] leading-relaxed h-[360px]">
              {responseJson}
            </pre>
          ) : (
            <div className="p-8 text-center text-slate-500 bg-slate-950 border border-slate-800 rounded-lg h-[360px] flex items-center justify-center">
              Send an MCP JSON-RPC request to inspect the security gateway response and trace.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
