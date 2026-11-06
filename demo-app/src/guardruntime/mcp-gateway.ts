import { GuardRuntimePipeline } from './pipeline';
import { ExecutionContext, ToolAction, DecisionTrace } from './types';

export interface McpJsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: 'tools/call' | 'tools/list' | 'resources/read' | 'prompts/get';
  params?: {
    name?: string;
    arguments?: Record<string, any>;
    uri?: string;
    _meta?: Record<string, any>;
  };
}

export interface McpJsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  guardTrace?: DecisionTrace;
}

export class McpSecurityGateway {
  private pipeline: GuardRuntimePipeline;

  constructor(pipeline: GuardRuntimePipeline) {
    this.pipeline = pipeline;
  }

  /**
   * Intercepts and gates an MCP JSON-RPC Request through GuardRuntime
   */
  public async handleMcpRequest(
    request: McpJsonRpcRequest,
    context: ExecutionContext,
    confirmationTokenId?: string
  ): Promise<McpJsonRpcResponse> {
    if (request.jsonrpc !== '2.0') {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' }
      };
    }

    // Pass-through metadata requests
    if (request.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          tools: [
            { name: 'infra.getMetrics', description: 'Query CPU, RAM, and pod metrics', inputSchema: { type: 'object' } },
            { name: 'infra.deploy', description: 'Deploy service container image', inputSchema: { type: 'object' } },
            { name: 'finance.transferFunds', description: 'Initiate wire transfer', inputSchema: { type: 'object' } },
            { name: 'fs.writeFile', description: 'Write file content to disk', inputSchema: { type: 'object' } },
            { name: 'system.executeCommand', description: 'Execute bash command', inputSchema: { type: 'object' } }
          ]
        }
      };
    }

    if (request.method === 'tools/call') {
      const toolName = request.params?.name || 'unknown';
      const args = request.params?.arguments || {};

      let actionType: ToolAction['actionType'] = 'READ';
      if (toolName.includes('write') || toolName.includes('delete')) actionType = 'WRITE';
      else if (toolName.includes('transfer') || toolName.includes('payout')) actionType = 'FINANCIAL';
      else if (toolName.includes('execute') || toolName.includes('deploy') || toolName.includes('shell')) actionType = 'EXECUTE';

      const action: ToolAction = {
        id: `mcp-${request.id}`,
        toolName,
        actionType,
        parameters: args,
        timestamp: Date.now()
      };

      const trace = await this.pipeline.executePipeline(action, context, confirmationTokenId);

      if (trace.verdict === 'BLOCK') {
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32001,
            message: `GuardRuntime Security Block: ${trace.reasons.join('; ')}`,
            data: { decisionId: trace.decisionId, verdict: trace.verdict, auditHash: trace.auditHash }
          },
          guardTrace: trace
        };
      }

      if (trace.verdict === 'REQUIRE_CONFIRMATION') {
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32002,
            message: `Human Confirmation Required: Action fingerprint ${trace.fingerprint.slice(0, 12)}... requires authorization token.`,
            data: {
              decisionId: trace.decisionId,
              verdict: trace.verdict,
              fingerprint: trace.fingerprint,
              reasons: trace.reasons,
              riskScore: trace.riskVector.overallRiskScore
            }
          },
          guardTrace: trace
        };
      }

      // ALLOW verdict -> Mock/Real execution return
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [
            {
              type: 'text',
              text: `Tool '${toolName}' executed successfully through GuardRuntime sandbox. ${trace.executionOutcome?.resultSummary || ''}`
            }
          ],
          isError: false
        },
        guardTrace: trace
      };
    }

    return {
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32601, message: `Method '${request.method}' not implemented in gateway` }
    };
  }
}
