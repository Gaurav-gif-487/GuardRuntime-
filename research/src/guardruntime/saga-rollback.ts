/**
 * Automated Saga State Snapshot & Reverse Rollback Engine (Pillar 3).
 *
 * Implements distributed transaction coordination for multi-step agent trajectories:
 * 1. Automatic checkpointing of forward actions (T_i) and inverse compensations (C_i)
 * 2. Strict LIFO reverse-order rollback orchestration (C_k → C_{k-1} → ... → C_1)
 * 3. Dynamic temporal validity window verification during compensation execution
 */

import { TemporalReversibilityEngine } from "./temporal-reversibility";
import type { ToolCall } from "./types";

export type CompensatingFunction = (args: Record<string, unknown>) => Promise<boolean> | boolean;

export interface SagaStep {
  stepIndex: number;
  tool: string;
  forwardArgs: Record<string, unknown>;
  compensatingTool: string;
  compensatingArgs: Record<string, unknown>;
  executedAt: number;
  compensated: boolean;
  compensationTtlMs: number;
}

export interface SagaRollbackReport {
  sagaId: string;
  totalSteps: number;
  compensatedSteps: number;
  failedCompensations: number;
  expiredCompensations: number;
  details: Array<{
    stepIndex: number;
    tool: string;
    compensatingTool: string;
    status: "compensated" | "failed" | "expired_window";
    rationale: string;
  }>;
}

export class SagaRollbackCoordinator {
  private sagas = new Map<string, SagaStep[]>();
  private compensationRegistry = new Map<string, CompensatingFunction>();

  constructor(
    private readonly temporalEngine: TemporalReversibilityEngine = new TemporalReversibilityEngine(),
    private readonly clock: () => number = () => Date.now(),
  ) {}

  registerCompensation(toolName: string, fn: CompensatingFunction): void {
    this.compensationRegistry.set(toolName, fn);
  }

  /**
   * Record a forward step in an active multi-turn saga.
   */
  recordStep(
    sagaId: string,
    tool: string,
    forwardArgs: Record<string, unknown>,
    compensatingTool: string,
    compensatingArgs: Record<string, unknown>,
    compensationTtlMs = 30 * 60 * 1000,
  ): void {
    const steps = this.sagas.get(sagaId) ?? [];
    steps.push({
      stepIndex: steps.length + 1,
      tool,
      forwardArgs,
      compensatingTool,
      compensatingArgs,
      executedAt: this.clock(),
      compensated: false,
      compensationTtlMs,
    });
    this.sagas.set(sagaId, steps);
  }

  getSteps(sagaId: string): readonly SagaStep[] {
    return this.sagas.get(sagaId) ?? [];
  }

  /**
   * Orchestrate an automated reverse-order LIFO rollback for a failed or drifted saga.
   */
  async rollbackSaga(sagaId: string): Promise<SagaRollbackReport> {
    const steps = this.sagas.get(sagaId) ?? [];
    const now = this.clock();

    let compensatedCount = 0;
    let failedCount = 0;
    let expiredCount = 0;

    const details: SagaRollbackReport["details"] = [];

    // Execute compensations in strict reverse LIFO order
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i]!;
      if (step.compensated) continue;

      const elapsed = now - step.executedAt;
      if (elapsed > step.compensationTtlMs) {
        expiredCount++;
        details.push({
          stepIndex: step.stepIndex,
          tool: step.tool,
          compensatingTool: step.compensatingTool,
          status: "expired_window",
          rationale: `Compensation window (${step.compensationTtlMs / 1000}s) expired (${(elapsed / 1000).toFixed(0)}s elapsed); automated rollback impossible`,
        });
        continue;
      }

      const compFn = this.compensationRegistry.get(step.compensatingTool);
      if (!compFn) {
        failedCount++;
        details.push({
          stepIndex: step.stepIndex,
          tool: step.tool,
          compensatingTool: step.compensatingTool,
          status: "failed",
          rationale: `No operational compensation handler registered for "${step.compensatingTool}"`,
        });
        continue;
      }

      try {
        const ok = await compFn(step.compensatingArgs);
        if (ok) {
          step.compensated = true;
          compensatedCount++;
          details.push({
            stepIndex: step.stepIndex,
            tool: step.tool,
            compensatingTool: step.compensatingTool,
            status: "compensated",
            rationale: `Successfully executed reverse compensation for step ${step.stepIndex}`,
          });
        } else {
          failedCount++;
          details.push({
            stepIndex: step.stepIndex,
            tool: step.tool,
            compensatingTool: step.compensatingTool,
            status: "failed",
            rationale: `Compensation handler returned false for step ${step.stepIndex}`,
          });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        failedCount++;
        details.push({
          stepIndex: step.stepIndex,
          tool: step.tool,
          compensatingTool: step.compensatingTool,
          status: "failed",
          rationale: `Compensation handler threw error: ${message}`,
        });
      }
    }

    return {
      sagaId,
      totalSteps: steps.length,
      compensatedSteps: compensatedCount,
      failedCompensations: failedCount,
      expiredCompensations: expiredCount,
      details,
    };
  }
}
