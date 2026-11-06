import React, { useState, useEffect } from 'react';
import { Header, ActiveTab } from './components/Header';
import { PipelineVisualizer } from './components/PipelineVisualizer';
import { InteractivePlayground } from './components/InteractivePlayground';
import { AgentLiveSimulator } from './components/AgentLiveSimulator';
import { GeneralizationBenchmarkView } from './components/GeneralizationBenchmarkView';
import { CacheSavingsBenchmarkView } from './components/CacheSavingsBenchmarkView';
import { AuditChainExplorer } from './components/AuditChainExplorer';
import { FormalSpecExplorer } from './components/FormalSpecExplorer';
import { PolicyAlgebraComposer } from './components/PolicyAlgebraComposer';
import { McpGatewayInspector } from './components/McpGatewayInspector';
import { AdversarialHardeningView } from './components/AdversarialHardeningView';
import { ConformanceSuiteView } from './components/ConformanceSuiteView';
import { DownloadZipModal } from './components/DownloadZipModal';
import { GuardRuntimePipeline } from './guardruntime/pipeline';
import { McpSecurityGateway, McpJsonRpcRequest, McpJsonRpcResponse } from './guardruntime/mcp-gateway';
import { runGeneralizationBenchmark, GeneralizationBenchmarkReport } from './guardruntime/eval/generalization';
import { runCacheSavingsBenchmark, CacheBenefitReport } from './guardruntime/eval/cache-savings';
import type { TlcRunResult } from './guardruntime/tlc-runner';
import { ToolAction, DecisionTrace, Principal, AuditBlock } from './guardruntime/types';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('pipeline');
  const [activeTrace, setActiveTrace] = useState<DecisionTrace | null>(null);
  const [runtimeHealth, setRuntimeHealth] = useState<'HEALTHY' | 'DEGRADED' | 'MAINTENANCE'>('HEALTHY');
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);

  // Client-side fallback pipeline for offline / instant responsiveness
  const [clientPipeline] = useState(() => new GuardRuntimePipeline());
  const [clientMcpGateway] = useState(() => new McpSecurityGateway(clientPipeline));

  const [auditBlocks, setAuditBlocks] = useState<AuditBlock[]>(() => clientPipeline.getAuditLedger().getBlocks());
  const [auditVerification, setAuditVerification] = useState(() => clientPipeline.getAuditLedger().verifyIntegrity());

  const [telemetry, setTelemetry] = useState({
    totalRequests: 0,
    allowedCount: 0,
    blockedCount: 0,
    confirmedCount: 0,
    cacheHits: 0,
    invariantEvaluations: 0
  });

  // Initial demo evaluation to populate the visualizer on first load
  useEffect(() => {
    handleEvaluate({
      id: 'init-demo-action',
      toolName: 'infra.getMetrics',
      actionType: 'READ',
      parameters: { service: 'ingress-controller', window: '5m' },
      timestamp: Date.now()
    }, {
      id: 'agent-devops-01',
      name: 'Site Reliability Agent',
      role: 'agent',
      tenantId: 'tenant-acme-prod',
      capabilities: ['infra:read:*', 'infra:deploy:staging']
    });
  }, []);

  const refreshAuditState = () => {
    setAuditBlocks(clientPipeline.getAuditLedger().getBlocks());
    setAuditVerification(clientPipeline.getAuditLedger().verifyIntegrity());
    setTelemetry({ ...clientPipeline.telemetry });
  };

  const handleToggleHealth = async (newHealth: 'HEALTHY' | 'DEGRADED' | 'MAINTENANCE') => {
    setRuntimeHealth(newHealth);
    try {
      await fetch('/api/health/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ health: newHealth })
      });
    } catch {
      // client-side state already updated
    }
  };

  const handleEvaluate = async (
    action: ToolAction,
    principal?: Principal,
    confirmationTokenId?: string
  ): Promise<DecisionTrace> => {
    const targetPrincipal: Principal = principal || {
      id: 'agent-devops-01',
      name: 'DevOps Agent',
      role: 'agent',
      tenantId: 'tenant-acme-prod',
      capabilities: ['infra:read:*', 'infra:deploy:staging']
    };

    try {
      const response = await fetch('/api/pipeline/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          principal: targetPrincipal,
          confirmationTokenId
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.trace) {
          setActiveTrace(data.trace);
          refreshAuditState();
          return data.trace;
        }
      }
    } catch {
      // Fallback to pure client-side deterministic pipeline
    }

    const context = {
      tenantId: targetPrincipal.tenantId,
      principal: targetPrincipal,
      currentBudgetRemaining: 5000,
      hourlyActionCount: 5,
      runtimeHealth,
      activePolicies: [
        {
          id: 'client-default-policy',
          version: '1.0.0',
          name: 'Standard Security Policy',
          tenantId: targetPrincipal.tenantId,
          rules: [
            {
              id: 'r-allow-read',
              name: 'Allow Reads',
              description: 'Permits read-only actions',
              effect: 'ALLOW' as const,
              matchActionTypes: ['READ'],
              priority: 10
            },
            {
              id: 'r-confirm-deploy',
              name: 'Confirm Deployments',
              description: 'Requires confirmation for staging deploy',
              effect: 'CONFIRM' as const,
              matchToolNames: ['infra.deploy'],
              priority: 20
            },
            {
              id: 'r-deny-shell',
              name: 'Deny Shell Execution',
              description: 'Blocks raw shell commands',
              effect: 'DENY' as const,
              matchToolNames: ['system.executeCommand', 'shell.run'],
              priority: 99
            }
          ]
        }
      ],
      capabilityGrants: clientPipeline.getCapabilityEngine().getGrantsForPrincipal(targetPrincipal.id),
      time: Date.now(),
      cacheEnabled: true
    };

    const trace = await clientPipeline.executePipeline(action, context, confirmationTokenId);
    setActiveTrace(trace);
    refreshAuditState();
    return trace;
  };

  const handleIssueConfirmation = async (fingerprint: string): Promise<string> => {
    try {
      const res = await fetch('/api/pipeline/issue-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionFingerprint: fingerprint })
      });
      if (res.ok) {
        const data = await res.json();
        return data.token.id;
      }
    } catch {
      // Fallback
    }

    const token = clientPipeline.issueConfirmation(fingerprint, 'agent-devops-01', 'tenant-acme-prod', 'Human SecOps Lead');
    return token.id;
  };

  const handleRunBenchmark = async (seed: number, countPerSplit: number): Promise<GeneralizationBenchmarkReport> => {
    try {
      const res = await fetch('/api/eval/run-splits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed, countPerSplit })
      });
      if (res.ok) {
        const data = await res.json();
        return data.report;
      }
    } catch {
      // Fallback
    }

    return await runGeneralizationBenchmark(seed, countPerSplit);
  };

  const handleRunCacheBenchmark = async (repetitions: number): Promise<CacheBenefitReport> => {
    try {
      const res = await fetch('/api/eval/cache-benchmark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repetitions })
      });
      if (res.ok) {
        const data = await res.json();
        return data.report;
      }
    } catch {
      // Fallback
    }

    return await runCacheSavingsBenchmark(repetitions);
  };

  // NOTE: there is deliberately no client-side fallback here. Real TLC model
  // checking requires a JVM + tla2tools.jar and cannot run in the browser.
  // If the server call fails, surface the real failure so it isn't mistaken
  // for a verified run.
  const handleRunModelChecker = async (): Promise<TlcRunResult> => {
    const res = await fetch('/api/formal/model-check');
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Model checker request failed (HTTP ${res.status})`);
    }
    return data.result;
  };

  const handleSimulateTamper = async (index: number): Promise<void> => {
    clientPipeline.getAuditLedger().simulateTamperAttack(index);
    refreshAuditState();
  };

  const handleResetLedger = async (): Promise<void> => {
    clientPipeline.getAuditLedger().resetLedger();
    refreshAuditState();
  };

  const handleSendMcpRequest = async (req: McpJsonRpcRequest, token?: string): Promise<McpJsonRpcResponse> => {
    try {
      const res = await fetch(`/api/mcp/gateway?confirmationTokenId=${token || ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.guardTrace) {
          setActiveTrace(data.guardTrace);
          refreshAuditState();
        }
        return data;
      }
    } catch {
      // Fallback
    }

    const context = {
      tenantId: 'tenant-mcp-default',
      principal: {
        id: 'agent-mcp-client',
        name: 'MCP Client Agent',
        role: 'agent' as const,
        tenantId: 'tenant-mcp-default',
        capabilities: ['infra:read:*', 'infra:deploy:staging']
      },
      currentBudgetRemaining: 5000,
      hourlyActionCount: 3,
      runtimeHealth,
      activePolicies: [],
      capabilityGrants: clientPipeline.getCapabilityEngine().getGrantsForPrincipal('agent-devops-01'),
      time: Date.now(),
      cacheEnabled: true
    };

    const res = await clientMcpGateway.handleMcpRequest(req, context, token);
    if (res.guardTrace) {
      setActiveTrace(res.guardTrace);
      refreshAuditState();
    }
    return res;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500/30 selection:text-indigo-200">
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        runtimeHealth={runtimeHealth}
        onToggleHealth={handleToggleHealth}
        telemetry={telemetry}
        onOpenDownloadZip={() => setIsDownloadModalOpen(true)}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'pipeline' && (
          <div className="space-y-6">
            <PipelineVisualizer
              trace={activeTrace}
              onIssueConfirmation={async (fp) => {
                const token = await handleIssueConfirmation(fp);
                if (activeTrace) {
                  await handleEvaluate(activeTrace.action, undefined, token);
                }
              }}
            />
          </div>
        )}

        {activeTab === 'playground' && (
          <InteractivePlayground
            onEvaluate={handleEvaluate}
            activeTrace={activeTrace}
            onIssueConfirmation={handleIssueConfirmation}
          />
        )}

        {activeTab === 'agent-sim' && (
          <AgentLiveSimulator
            onEvaluate={handleEvaluate}
            onIssueConfirmation={handleIssueConfirmation}
          />
        )}

        {activeTab === 'generalization' && (
          <GeneralizationBenchmarkView onRunBenchmark={handleRunBenchmark} />
        )}

        {activeTab === 'cache-bench' && (
          <CacheSavingsBenchmarkView onRunCacheBenchmark={handleRunCacheBenchmark} />
        )}

        {activeTab === 'adversarial' && (
          <AdversarialHardeningView />
        )}

        {activeTab === 'conformance' && (
          <ConformanceSuiteView />
        )}

        {activeTab === 'audit' && (
          <AuditChainExplorer
            blocks={auditBlocks}
            verification={auditVerification}
            onSimulateTamper={handleSimulateTamper}
            onResetLedger={handleResetLedger}
          />
        )}

        {activeTab === 'formal-tla' && (
          <FormalSpecExplorer onRunModelChecker={handleRunModelChecker} />
        )}

        {activeTab === 'policy-algebra' && <PolicyAlgebraComposer />}

        {activeTab === 'mcp-gateway' && (
          <McpGatewayInspector onSendMcpRequest={handleSendMcpRequest} />
        )}
      </main>

      <DownloadZipModal
        isOpen={isDownloadModalOpen}
        onClose={() => setIsDownloadModalOpen(false)}
        auditBlocks={auditBlocks}
        auditVerification={auditVerification}
      />
    </div>
  );
}
