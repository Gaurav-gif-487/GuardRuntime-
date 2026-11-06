import type { EvalReport } from "./harness";
export interface EvaluationSummary {
  totalTasks: number;
  baselineSuccessRate: number;
  guardRuntimeSuccessRate: number;
  unnecessaryConfirmationRate: number;
  cacheHitRate: number;
  averageReliabilityScore: number;
  p99InProcessLatencyMs: number;
  failSafeActivations: number;
}
export class EvalReportGenerator {
  static generateReport(report: EvalReport): EvaluationSummary {
    return {
      totalTasks: report.meta.totalInstances,
      baselineSuccessRate: report.taskSuccess.baselineRate,
      guardRuntimeSuccessRate: report.taskSuccess.guardedRate,
      unnecessaryConfirmationRate: report.confirmations.potentiallyUnnecessaryRate,
      cacheHitRate: report.caching.cacheHitRate,
      averageReliabilityScore: report.caching.reliability.mean,
      p99InProcessLatencyMs: report.latency.p99Ms,
      failSafeActivations: report.chaos.failSafeActivations,
    };
  }
}
