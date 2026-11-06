export interface TraceStep {
  agentId: string;
  toolName: string;
  timestamp: number;
  args: Record<string, unknown>;
}
export interface TraceRule {
  id: string;
  description: string;
  validate: (trace: TraceStep[]) => { valid: boolean; violationReason?: string };
}

export class TraceVerifier {
  private readonly rules: TraceRule[] = [];
  constructor() {
    this.registerDefaultRules();
  }
  registerRule(rule: TraceRule): void {
    this.rules.push(rule);
  }
  verifyTrace(trace: TraceStep[]) {
    const violations: string[] = [];
    for (const rule of this.rules) {
      const result = rule.validate(trace);
      if (!result.valid)
        violations.push(`[${rule.id}] ${result.violationReason ?? "rule violation"}`);
    }
    return { passed: violations.length === 0, violations };
  }
  private registerDefaultRules(): void {
    this.rules.push({
      id: "SNAPSHOT_BEFORE_DELETE",
      description: "Requires a snapshot before destructive database deletion",
      validate: (trace) => {
        const i = trace.findIndex((s) => s.toolName.includes("delete_database"));
        if (i < 0) return { valid: true };
        const snapshot = trace
          .slice(0, i)
          .some((s) => s.toolName.includes("create_snapshot") || s.toolName.includes("backup"));
        return snapshot
          ? { valid: true }
          : {
              valid: false,
              violationReason: "Destructive deletion proposed without a preceding backup/snapshot.",
            };
      },
    });
  }
}
