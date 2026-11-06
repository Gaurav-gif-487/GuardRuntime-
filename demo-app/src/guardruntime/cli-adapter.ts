import { GuardRuntimePipeline } from './pipeline';
import { ToolAction, Principal, ExecutionContext, DecisionTrace } from './types';
import { DeclarativePolicyLoader } from './policy-loader';
import { SAMPLE_DECLARATIVE_POLICY_JSON } from './policy-schema';

export interface CliAgentToolInvocation {
  command: string;
  args: Record<string, any>;
  sessionUser: string;
  tenantId: string;
}

export interface CliIntegrationResult {
  invocationId: string;
  command: string;
  verdict: string;
  allowedToExecute: boolean;
  totalLatencyUs: number;
  stageLatencyBreakdownUs: Record<string, number>;
  confirmationWaitTimeMs: number;
  budgetRemainingUsd: number;
  auditBlockHash: string;
  trace: DecisionTrace;
}

export class CliAgentSecurityAdapter {
  private pipeline: GuardRuntimePipeline;

  constructor(pipeline?: GuardRuntimePipeline) {
    this.pipeline = pipeline || new GuardRuntimePipeline();
  }

  public async invokeAgentCliTool(invocation: CliAgentToolInvocation, confirmationTokenId?: string): Promise<CliIntegrationResult> {
    const principal: Principal = {
      id: `cli-agent-${invocation.sessionUser}`,
      name: `CLI Agent (${invocation.sessionUser})`,
      role: 'agent',
      tenantId: invocation.tenantId,
      capabilities: ['infra:read:*', 'infra:deploy:*']
    };

    // Pre-seed capability grant if needed
    this.pipeline.getCapabilityEngine().addGrant({
      id: `grant-cli-${principal.id}`,
      principalId: principal.id,
      namespace: 'infra:read:*',
      allowedActions: ['infra.getMetrics', 'infra.listPods', 'infra.deploy'],
      expiresAt: Date.now() + 3600000,
      leaseToken: 'LEASE_CLI_AGENT'
    });

    const action: ToolAction = {
      id: `cli-act-${Date.now()}`,
      toolName: invocation.command,
      actionType: invocation.command.includes('deploy') ? 'WRITE' : 'READ',
      parameters: invocation.args,
      timestamp: Date.now()
    };

    const declarativePolicy = DeclarativePolicyLoader.loadFromDeclarative(SAMPLE_DECLARATIVE_POLICY_JSON);

    const ctx: ExecutionContext = {
      tenantId: invocation.tenantId,
      principal,
      currentBudgetRemaining: 4850,
      hourlyActionCount: 15,
      runtimeHealth: 'HEALTHY',
      activePolicies: [declarativePolicy],
      capabilityGrants: this.pipeline.getCapabilityEngine().getGrantsForPrincipal(principal.id),
      time: Date.now(),
      cacheEnabled: true
    };

    const startTime = performance.now();
    const trace = await this.pipeline.executePipeline(action, ctx, confirmationTokenId);
    const totalLatencyMs = performance.now() - startTime;
    const totalLatencyUs = Math.round(totalLatencyMs * 1000);

    const stageBreakdownUs: Record<string, number> = {};
    for (const stage of trace.stageResults) {
      stageBreakdownUs[stage.stageName] = Math.round(stage.durationMs * 1000);
    }

    const confirmWait = trace.verdict === 'REQUIRE_CONFIRMATION' ? 2450 : 0; // Simulated user approval wait

    return {
      invocationId: trace.decisionId,
      command: invocation.command,
      verdict: trace.verdict,
      allowedToExecute: trace.verdict === 'ALLOW',
      totalLatencyUs,
      stageLatencyBreakdownUs: stageBreakdownUs,
      confirmationWaitTimeMs: confirmWait,
      budgetRemainingUsd: 4850 - (trace.executionOutcome?.executed ? 10 : 0),
      auditBlockHash: trace.auditHash || '',
      trace
    };
  }
}
