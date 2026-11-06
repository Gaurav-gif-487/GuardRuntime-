import { ToolAction, Principal, ExecutionContext, PolicyRule, PolicySet, DecisionVerdict } from './types';

export class PolicyEngine {
  /**
   * Evaluates a policy set against an action, principal, and execution context.
   */
  public evaluatePolicySet(
    policySet: PolicySet,
    action: ToolAction,
    principal: Principal,
    context: ExecutionContext
  ): {
    verdict: DecisionVerdict;
    matchedRules: PolicyRule[];
    reasons: string[];
  } {
    const matchedRules: PolicyRule[] = [];
    const reasons: string[] = [];

    // Sort rules by priority (higher priority first)
    const sortedRules = [...policySet.rules].sort((a, b) => b.priority - a.priority);

    for (const rule of sortedRules) {
      let matches = true;

      if (rule.matchToolNames && rule.matchToolNames.length > 0) {
        const matchesName = rule.matchToolNames.includes(action.toolName) ||
          rule.matchToolNames.includes('*') ||
          rule.matchToolNames.some(p => p.endsWith('*') && action.toolName.startsWith(p.slice(0, -1)));
        if (!matchesName) matches = false;
      }

      if (matches && rule.matchActionTypes && rule.matchActionTypes.length > 0) {
        if (!rule.matchActionTypes.includes(action.actionType)) {
          matches = false;
        }
      }

      if (matches && rule.condition) {
        try {
          if (!rule.condition(action, principal, context)) {
            matches = false;
          }
        } catch (e: any) {
          // Fail-closed on condition evaluation failure
          matches = true;
          reasons.push(`Policy rule ${rule.id} condition failed closed due to evaluation error: ${e.message}`);
          return {
            verdict: 'BLOCK',
            matchedRules: [rule],
            reasons
          };
        }
      }

      if (matches) {
        matchedRules.push(rule);
        reasons.push(`Matched rule '${rule.name}' [${rule.effect}]`);

        // If DENY_OVERRIDES or rule is explicit DENY, stop immediately
        if (rule.effect === 'DENY') {
          return {
            verdict: 'BLOCK',
            matchedRules,
            reasons
          };
        }
      }
    }

    if (matchedRules.length === 0) {
      // Default fail-closed unless explicit ALLOW rule
      return {
        verdict: 'BLOCK',
        matchedRules: [],
        reasons: ['No policy rule explicitly permitted this action (Default Fail-Closed)']
      };
    }

    // Check if any matched rule requires confirmation
    const requiresConfirm = matchedRules.some(r => r.effect === 'CONFIRM');
    if (requiresConfirm) {
      return {
        verdict: 'REQUIRE_CONFIRMATION',
        matchedRules,
        reasons
      };
    }

    const hasAllow = matchedRules.some(r => r.effect === 'ALLOW');
    return {
      verdict: hasAllow ? 'ALLOW' : 'BLOCK',
      matchedRules,
      reasons
    };
  }
}
