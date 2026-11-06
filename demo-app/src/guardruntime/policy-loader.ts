import { DeclarativePolicyDocument, DeclarativePolicyRule, DeclarativeRuleCondition } from './policy-schema';
import { PolicySet, PolicyRule, ToolAction, ExecutionContext, Principal, DecisionVerdict } from './types';

export class DeclarativePolicyLoader {
  /**
   * Translates a declarative JSON policy document into a GuardRuntime PolicySet
   */
  public static loadFromDeclarative(doc: DeclarativePolicyDocument): PolicySet {
    const rules: PolicyRule[] = doc.rules.map(r => this.transformRule(r));

    return {
      id: doc.id,
      version: doc.version,
      name: doc.name,
      tenantId: doc.tenantId,
      rules
    };
  }

  private static transformRule(declRule: DeclarativePolicyRule): PolicyRule {
    let conditionFunc: ((action: ToolAction, principal: Principal, context: ExecutionContext) => boolean) | undefined;

    if (declRule.conditions && declRule.conditions.length > 0) {
      conditionFunc = (action: ToolAction, principal: Principal, context: ExecutionContext) => {
        const results = declRule.conditions!.map(cond => this.evaluateCondition(cond, action, principal, context));
        if (declRule.conditionLogic === 'OR') {
          return results.some(r => r === true);
        }
        return results.every(r => r === true);
      };
    }

    return {
      id: declRule.id,
      name: declRule.name,
      description: declRule.description,
      effect: declRule.effect,
      matchToolNames: declRule.matchToolNames,
      matchActionTypes: declRule.matchActionTypes,
      condition: conditionFunc,
      priority: declRule.priority
    };
  }

  private static evaluateCondition(
    cond: DeclarativeRuleCondition,
    action: ToolAction,
    principal: Principal,
    context: ExecutionContext
  ): boolean {
    const actualValue = this.resolveField(cond.field, { action, principal, context, parameters: action.parameters });

    switch (cond.operator) {
      case 'EQUALS':
        return actualValue === cond.value;
      case 'NOT_EQUALS':
        return actualValue !== cond.value;
      case 'CONTAINS':
        return typeof actualValue === 'string' ? actualValue.includes(cond.value) : false;
      case 'NOT_CONTAINS':
        return typeof actualValue === 'string' ? !actualValue.includes(cond.value) : true;
      case 'GREATER_THAN':
        return typeof actualValue === 'number' && actualValue > cond.value;
      case 'LESS_THAN':
        return typeof actualValue === 'number' && actualValue < cond.value;
      case 'IN':
        return Array.isArray(cond.value) && cond.value.includes(actualValue);
      case 'NOT_IN':
        return Array.isArray(cond.value) && !cond.value.includes(actualValue);
      default:
        return false;
    }
  }

  private static resolveField(path: string, obj: any): any {
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      // Also look directly in parameters if path starts with parameters or params
      if (part === 'parameters' && current.action?.parameters) {
        current = current.action.parameters;
      } else if (current[part] !== undefined) {
        current = current[part];
      } else if (current.parameters && current.parameters[part] !== undefined) {
        current = current.parameters[part];
      } else {
        return undefined;
      }
    }
    return current;
  }
}
