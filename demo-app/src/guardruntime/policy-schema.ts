export interface DeclarativeRuleCondition {
  field: string;
  operator: 'EQUALS' | 'NOT_EQUALS' | 'CONTAINS' | 'NOT_CONTAINS' | 'GREATER_THAN' | 'LESS_THAN' | 'IN' | 'NOT_IN';
  value: any;
}

export interface DeclarativePolicyRule {
  id: string;
  name: string;
  description: string;
  effect: 'ALLOW' | 'DENY' | 'CONFIRM';
  matchToolNames?: string[];
  matchActionTypes?: Array<'READ' | 'WRITE' | 'EXECUTE' | 'FINANCIAL' | 'NETWORK' | 'SYSTEM'>;
  conditions?: DeclarativeRuleCondition[];
  conditionLogic?: 'AND' | 'OR';
  priority: number;
}

export interface DeclarativePolicyDocument {
  version: 'guardruntime.policy.v1';
  id: string;
  name: string;
  tenantId: string;
  description?: string;
  budgetLimits?: {
    maxHourlyActions: number;
    maxHourlySpendUsd: number;
  };
  rules: DeclarativePolicyRule[];
}

export const SAMPLE_DECLARATIVE_POLICY_JSON: DeclarativePolicyDocument = {
  version: 'guardruntime.policy.v1',
  id: 'enterprise-secops-policy-v1',
  name: 'Enterprise SecOps Declarative Policy',
  tenantId: 'tenant-enterprise-prod',
  description: 'Production declarative policy loaded independently without custom TypeScript compilation',
  budgetLimits: {
    maxHourlyActions: 100,
    maxHourlySpendUsd: 5000
  },
  rules: [
    {
      id: 'd-rule-allow-metrics',
      name: 'Allow Metrics Query',
      description: 'Allow standard read-only telemetry querying',
      effect: 'ALLOW',
      matchToolNames: ['infra.getMetrics', 'infra.listPods', 'logs.query'],
      priority: 10
    },
    {
      id: 'd-rule-confirm-staging-deploy',
      name: 'Confirm Staging Deploy',
      description: 'Require human confirmation for staging deployment',
      effect: 'CONFIRM',
      matchToolNames: ['infra.deploy'],
      conditions: [
        { field: 'parameters.environment', operator: 'EQUALS', value: 'staging' }
      ],
      priority: 20
    },
    {
      id: 'd-rule-deny-airgapped-prod',
      name: 'Deny Airgapped Prod Direct Deploy',
      description: 'Deny direct mutations to airgapped cluster or large replica counts',
      effect: 'DENY',
      matchToolNames: ['infra.deploy'],
      conditions: [
        { field: 'parameters.environment', operator: 'EQUALS', value: 'airgapped-prod-eu' },
        { field: 'parameters.replicaCount', operator: 'GREATER_THAN', value: 50 }
      ],
      conditionLogic: 'OR',
      priority: 50
    },
    {
      id: 'd-rule-deny-shell',
      name: 'Strict Deny Shell Execution',
      description: 'Block all raw OS command execution and deletion',
      effect: 'DENY',
      matchToolNames: ['system.executeCommand', 'shell.exec', 'fs.deleteFile'],
      priority: 99
    }
  ]
};
