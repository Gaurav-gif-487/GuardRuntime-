import { ToolAction, Principal } from './types';

export interface BudgetConfig {
  maxHourlyActions: number;
  maxHourlyFinancialSpend: number;
  maxConsecutiveFailures: number;
  velocityWindowMs: number;
}

export class DriftAndBudgetDetector {
  private actionTimestamps: Map<string, number[]> = new Map();
  private cumulativeSpend: Map<string, number> = new Map();
  private failureCounts: Map<string, number> = new Map();
  private config: BudgetConfig;

  constructor(config?: Partial<BudgetConfig>) {
    this.config = {
      maxHourlyActions: 100,
      maxHourlyFinancialSpend: 10000, // in USD
      maxConsecutiveFailures: 5,
      velocityWindowMs: 3600000, // 1 hour
      ...config
    };
  }

  public checkBudgetAndDrift(
    action: ToolAction,
    principal: Principal,
    currentTime: number = Date.now()
  ): {
    passed: boolean;
    hourlyActionCount: number;
    hourlySpendRemaining: number;
    driftReasons: string[];
  } {
    const key = `${principal.tenantId}:${principal.id}`;
    const timestamps = this.actionTimestamps.get(key) || [];
    const driftReasons: string[] = [];

    // Filter out timestamps outside window
    const validTimestamps = timestamps.filter(t => currentTime - t < this.config.velocityWindowMs);
    this.actionTimestamps.set(key, validTimestamps);

    const currentHourlyCount = validTimestamps.length;
    if (currentHourlyCount >= this.config.maxHourlyActions) {
      driftReasons.push(`Velocity limit exceeded: ${currentHourlyCount} actions in past hour (limit: ${this.config.maxHourlyActions})`);
    }

    // Check financial spend if applicable
    const currentSpend = this.cumulativeSpend.get(key) || 0;
    let actionCost = 0;
    if (action.actionType === 'FINANCIAL' && action.parameters && typeof action.parameters.amount === 'number') {
      actionCost = action.parameters.amount;
    }

    if (currentSpend + actionCost > this.config.maxHourlyFinancialSpend) {
      driftReasons.push(`Cumulative hourly budget exceeded: $${currentSpend + actionCost} > $${this.config.maxHourlyFinancialSpend}`);
    }

    // Consecutive failures
    const failures = this.failureCounts.get(key) || 0;
    if (failures >= this.config.maxConsecutiveFailures) {
      driftReasons.push(`Circuit breaker tripped: ${failures} consecutive execution failures`);
    }

    return {
      passed: driftReasons.length === 0,
      hourlyActionCount: currentHourlyCount,
      hourlySpendRemaining: Math.max(0, this.config.maxHourlyFinancialSpend - currentSpend),
      driftReasons
    };
  }

  public recordExecution(action: ToolAction, principal: Principal, success: boolean) {
    const key = `${principal.tenantId}:${principal.id}`;
    const timestamps = this.actionTimestamps.get(key) || [];
    timestamps.push(Date.now());
    this.actionTimestamps.set(key, timestamps);

    if (action.actionType === 'FINANCIAL' && action.parameters && typeof action.parameters.amount === 'number') {
      const currentSpend = this.cumulativeSpend.get(key) || 0;
      this.cumulativeSpend.set(key, currentSpend + action.parameters.amount);
    }

    if (!success) {
      const failures = this.failureCounts.get(key) || 0;
      this.failureCounts.set(key, failures + 1);
    } else {
      this.failureCounts.set(key, 0); // reset on success
    }
  }

  public resetPrincipalBudget(principalId: string, tenantId: string) {
    const key = `${tenantId}:${principalId}`;
    this.actionTimestamps.delete(key);
    this.cumulativeSpend.delete(key);
    this.failureCounts.delete(key);
  }
}
