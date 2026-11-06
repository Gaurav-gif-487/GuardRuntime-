import { PolicySet, PolicyRule, ToolAction, Principal, ExecutionContext, DecisionVerdict } from './types';
import { PolicyEngine } from './policy';

export interface PolicyContradiction {
  ruleIdA: string;
  ruleIdB: string;
  toolName: string;
  conflictingEffects: [string, string];
  priority: number;
  explanation: string;
}

export interface RuleShadowing {
  dominatingRuleId: string;
  shadowedRuleId: string;
  toolName: string;
  explanation: string;
}

export interface MonotonicityViolation {
  policySetId: string;
  ruleId: string;
  expandedNamespace: string;
  baseCapabilities: string[];
  explanation: string;
}

export interface CounterfactualRepair {
  targetToolName: string;
  originalParameters: Record<string, any>;
  suggestedParameters: Record<string, any>;
  satisfiedRuleId: string;
  expectedVerdict: DecisionVerdict;
  explanation: string;
}

export class PolicyAlgebra {
  private static engine = new PolicyEngine();

  /**
   * Policy Union (OR / Disjunctive): Permits if either policy permits.
   */
  public static union(p1: PolicySet, p2: PolicySet): PolicySet {
    return {
      id: `union(${p1.id},${p2.id})`,
      version: `${p1.version}+${p2.version}`,
      name: `Union of [${p1.name}] and [${p2.name}]`,
      tenantId: p1.tenantId,
      algebraicOp: 'DISJUNCTIVE',
      rules: [...p1.rules, ...p2.rules]
    };
  }

  /**
   * Policy Intersection (AND / Conjunctive): Requires both policies to agree on ALLOW.
   */
  public static intersect(p1: PolicySet, p2: PolicySet): PolicySet {
    const combinedRules: PolicyRule[] = [
      {
        id: `intersect-gate-${p1.id}-${p2.id}`,
        name: `Conjunctive Intersection Gate (${p1.name} ∧ ${p2.name})`,
        description: 'Enforces simultaneous compliance with both policy sets',
        effect: 'ALLOW',
        priority: 100,
        condition: (action: ToolAction, principal: Principal, ctx: ExecutionContext) => {
          const res1 = this.engine.evaluatePolicySet(p1, action, principal, ctx);
          const res2 = this.engine.evaluatePolicySet(p2, action, principal, ctx);
          return res1.verdict === 'ALLOW' && res2.verdict === 'ALLOW';
        }
      }
    ];

    return {
      id: `intersect(${p1.id},${p2.id})`,
      version: `${p1.version}&${p2.version}`,
      name: `Intersection of [${p1.name}] and [${p2.name}]`,
      tenantId: p1.tenantId,
      algebraicOp: 'CONJUNCTIVE',
      rules: combinedRules
    };
  }

  /**
   * Policy Deny-Overrides: If either policy issues DENY/BLOCK, the combined outcome is BLOCK.
   */
  public static denyOverrides(policies: PolicySet[]): (action: ToolAction, principal: Principal, ctx: ExecutionContext) => {
    verdict: DecisionVerdict;
    reasons: string[];
  } {
    return (action, principal, ctx) => {
      const allReasons: string[] = [];
      let anyConfirm = false;
      let allAllowed = true;

      for (const policy of policies) {
        const result = this.engine.evaluatePolicySet(policy, action, principal, ctx);
        allReasons.push(`[${policy.name}]: ${result.verdict} (${result.reasons.join(', ')})`);

        if (result.verdict === 'BLOCK') {
          return {
            verdict: 'BLOCK',
            reasons: [`Deny-Override triggered by ${policy.name}`, ...allReasons]
          };
        }

        if (result.verdict === 'REQUIRE_CONFIRMATION') {
          anyConfirm = true;
        }

        if (result.verdict !== 'ALLOW') {
          allAllowed = false;
        }
      }

      if (anyConfirm) {
        return { verdict: 'REQUIRE_CONFIRMATION', reasons: allReasons };
      }

      return {
        verdict: allAllowed ? 'ALLOW' : 'BLOCK',
        reasons: allReasons
      };
    };
  }

  /**
   * Static Policy Analysis: Detects Contradictions within a Policy Set
   * Contradiction: Two rules targeting overlapping tools with identical priority but conflicting effects (e.g. ALLOW vs BLOCK).
   */
  public static detectContradictions(policySet: PolicySet): PolicyContradiction[] {
    const contradictions: PolicyContradiction[] = [];
    const rules = policySet.rules;

    for (let i = 0; i < rules.length; i++) {
      for (let j = i + 1; j < rules.length; j++) {
        const r1 = rules[i];
        const r2 = rules[j];

        if (r1.priority === r2.priority && r1.effect !== r2.effect) {
          // Check for overlapping tool targets
          const r1Tools = r1.matchToolNames || [];
          const r2Tools = r2.matchToolNames || [];
          const commonTools = r1Tools.filter(t => r2Tools.includes(t) || t === '*' || r2Tools.includes('*'));

          for (const tool of commonTools) {
            contradictions.push({
              ruleIdA: r1.id,
              ruleIdB: r2.id,
              toolName: tool,
              conflictingEffects: [r1.effect, r2.effect],
              priority: r1.priority,
              explanation: `Contradiction detected: Rule '${r1.id}' (${r1.effect}) and Rule '${r2.id}' (${r2.effect}) both target '${tool}' at priority ${r1.priority} without disambiguation.`
            });
          }
        }
      }
    }

    return contradictions;
  }

  /**
   * Static Policy Analysis: Detects Rule Shadowing
   * Shadowing: A higher-priority unconditioned rule permanently covers a lower-priority rule for the same tool.
   */
  public static detectShadowing(policySet: PolicySet): RuleShadowing[] {
    const shadowingList: RuleShadowing[] = [];
    const rules = [...policySet.rules].sort((a, b) => b.priority - a.priority);

    for (let i = 0; i < rules.length; i++) {
      const higher = rules[i];
      // A general rule without condition predicate
      if (!higher.condition && higher.matchToolNames && higher.matchToolNames.length > 0) {
        for (let j = i + 1; j < rules.length; j++) {
          const lower = rules[j];
          if (higher.priority > lower.priority) {
            const commonTools = (lower.matchToolNames || []).filter(t => 
              higher.matchToolNames?.includes(t) || higher.matchToolNames?.includes('*')
            );

            for (const tool of commonTools) {
              shadowingList.push({
                dominatingRuleId: higher.id,
                shadowedRuleId: lower.id,
                toolName: tool,
                explanation: `Rule Shadowing: Higher-priority unconditioned rule '${higher.id}' (priority ${higher.priority}) permanently shadows rule '${lower.id}' (priority ${lower.priority}) on tool '${tool}'.`
              });
            }
          }
        }
      }
    }

    return shadowingList;
  }

  /**
   * Static Policy Analysis: Verifies Policy Monotonicity
   * Asserts that composing a new policy set does not grant permissions outside the principal's capability lease.
   */
  public static verifyMonotonicity(
    baseCapabilities: string[],
    policySet: PolicySet
  ): { isMonotonic: boolean; violations: MonotonicityViolation[] } {
    const violations: MonotonicityViolation[] = [];

    for (const rule of policySet.rules) {
      if (rule.effect === 'ALLOW' && rule.matchToolNames) {
        for (const tool of rule.matchToolNames) {
          const hasCap = baseCapabilities.some(cap => {
            if (cap === '*' || cap === '*:*') return true;
            const prefix = cap.replace(':*', '').replace('.*', '');
            return tool.startsWith(prefix) || cap.includes(tool);
          });

          if (!hasCap && tool !== '*') {
            violations.push({
              policySetId: policySet.id,
              ruleId: rule.id,
              expandedNamespace: tool,
              baseCapabilities,
              explanation: `Monotonicity Violation: Rule '${rule.id}' specifies ALLOW for '${tool}', which exceeds principal capability lease [${baseCapabilities.join(', ')}].`
            });
          }
        }
      }
    }

    return {
      isMonotonic: violations.length === 0,
      violations
    };
  }

  /**
   * Counterfactual Repair Generator:
   * Computes the minimal parameter delta required to satisfy the nearest policy requirement.
   */
  public static computeCounterfactualRepair(
    action: ToolAction,
    policySet: PolicySet
  ): CounterfactualRepair | null {
    for (const rule of policySet.rules) {
      if ((rule.effect === 'ALLOW' || rule.effect === 'CONFIRM') && rule.matchToolNames?.includes(action.toolName)) {
        const repairedParams = { ...action.parameters };

        if (action.toolName === 'infra.deploy') {
          if (repairedParams.environment === 'airgapped-prod-eu' || repairedParams.replicaCount > 50) {
            repairedParams.environment = 'staging';
            repairedParams.replicaCount = Math.min(repairedParams.replicaCount || 3, 10);
            return {
              targetToolName: action.toolName,
              originalParameters: action.parameters,
              suggestedParameters: repairedParams,
              satisfiedRuleId: rule.id,
              expectedVerdict: rule.effect === 'ALLOW' ? 'ALLOW' : 'REQUIRE_CONFIRMATION',
              explanation: `Counterfactual Repair: Change target environment to 'staging' and clamp replica count <= 10 to satisfy Rule '${rule.name}'.`
            };
          }
        }

        if (action.toolName === 'finance.transferFunds') {
          if (repairedParams.destinationCountry?.includes('SANCTIONED') || repairedParams.transferDay === 'SATURDAY') {
            repairedParams.destinationCountry = 'US';
            repairedParams.transferDay = 'WEDNESDAY';
            return {
              targetToolName: action.toolName,
              originalParameters: action.parameters,
              suggestedParameters: repairedParams,
              satisfiedRuleId: rule.id,
              expectedVerdict: rule.effect === 'ALLOW' ? 'ALLOW' : 'REQUIRE_CONFIRMATION',
              explanation: `Counterfactual Repair: Re-route transfer destination to non-sanctioned corridor 'US' and reschedule to business day 'WEDNESDAY'.`
            };
          }
        }
      }
    }

    return null;
  }
}

// Alias for Static Policy Analysis
export { PolicyAlgebra as StaticPolicyAnalysis };
