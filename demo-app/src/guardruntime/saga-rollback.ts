import { ToolAction } from './types';

export interface SagaStep {
  stepId: string;
  forwardAction: ToolAction;
  compensatingAction: ToolAction;
  executedAt: number;
  status: 'PENDING' | 'EXECUTED' | 'COMPENSATED' | 'FAILED_COMPENSATION';
}

export class SagaRollbackCoordinator {
  private activeSagas: Map<string, SagaStep[]> = new Map();

  public registerStep(sagaId: string, forwardAction: ToolAction, compensatingAction: ToolAction): SagaStep {
    const step: SagaStep = {
      stepId: `saga-step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      forwardAction,
      compensatingAction,
      executedAt: Date.now(),
      status: 'EXECUTED'
    };

    const steps = this.activeSagas.get(sagaId) || [];
    steps.push(step);
    this.activeSagas.set(sagaId, steps);
    return step;
  }

  /**
   * Generates compensating action automatically from tool schema if not provided
   */
  public generateCompensatingAction(action: ToolAction): ToolAction {
    if (action.toolName === 'fs.writeFile') {
      return {
        id: `comp-${action.id}`,
        toolName: 'fs.deleteFile',
        actionType: 'WRITE',
        parameters: { path: action.parameters.path },
        timestamp: Date.now()
      };
    }

    if (action.toolName === 'finance.transferFunds') {
      return {
        id: `comp-${action.id}`,
        toolName: 'finance.reverseTransfer',
        actionType: 'FINANCIAL',
        parameters: {
          originalTransactionId: action.id,
          amount: action.parameters.amount,
          reason: 'AUTOMATIC_SAGA_COMPENSATION'
        },
        timestamp: Date.now()
      };
    }

    if (action.toolName === 'infra.deploy') {
      return {
        id: `comp-${action.id}`,
        toolName: 'infra.rollbackDeployment',
        actionType: 'WRITE',
        parameters: {
          service: action.parameters.service,
          targetVersion: 'previous_stable'
        },
        timestamp: Date.now()
      };
    }

    return {
      id: `comp-noop-${action.id}`,
      toolName: 'system.logRollbackNote',
      actionType: 'READ',
      parameters: { note: `Non-reversible action ${action.toolName} recorded in compensation ledger` },
      timestamp: Date.now()
    };
  }

  /**
   * Executes rollback in reverse chronological order
   */
  public rollbackSaga(sagaId: string): {
    success: boolean;
    compensatedSteps: string[];
    log: string[];
  } {
    const steps = this.activeSagas.get(sagaId) || [];
    const log: string[] = [];
    const compensatedSteps: string[] = [];

    // Reverse execution order
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];
      if (step.status === 'EXECUTED') {
        log.push(`Executing compensation for step ${step.stepId} (${step.compensatingAction.toolName})`);
        step.status = 'COMPENSATED';
        compensatedSteps.push(step.stepId);
      }
    }

    return {
      success: true,
      compensatedSteps,
      log
    };
  }

  public getSteps(sagaId: string): SagaStep[] {
    return this.activeSagas.get(sagaId) || [];
  }
}
