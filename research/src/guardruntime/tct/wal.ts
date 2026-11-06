import { AuditLog } from "../audit";
import type { ToolCall } from "../types";

export type TransactionState = "PREPARED" | "COMMITTED" | "ABORTED";
export interface TransactionRecord {
  transactionId: string;
  tenantId: string;
  agentId: string;
  toolCall: ToolCall;
  state: TransactionState;
  timestamp: number;
}

export class WriteAheadLog {
  constructor(
    private readonly auditLog: AuditLog,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async logPrepare(
    transactionId: string,
    tenantId: string,
    agentId: string,
    toolCall: ToolCall,
  ): Promise<void> {
    this.auditLog.append({
      tenantId,
      type: "tool_blocked",
      principal: agentId,
      policyVersion: "wal",
      ts: this.now(),
      payload: {
        transactionId,
        state: "PREPARED",
        tool: toolCall.tool,
        idempotencyKey: toolCall.idempotencyKey,
        args: toolCall.args,
      },
    });
  }
  async logCommit(transactionId: string, tenantId: string, agentId: string): Promise<void> {
    this.auditLog.append({
      tenantId,
      type: "tool_executed",
      principal: agentId,
      policyVersion: "wal",
      ts: this.now(),
      payload: { transactionId, state: "COMMITTED" },
    });
  }
  async logAbort(
    transactionId: string,
    tenantId: string,
    agentId: string,
    reason: string,
  ): Promise<void> {
    this.auditLog.append({
      tenantId,
      type: "tool_blocked",
      principal: agentId,
      policyVersion: "wal",
      ts: this.now(),
      payload: { transactionId, state: "ABORTED", reason },
    });
  }
}
