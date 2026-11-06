import { CapabilityGrant, ToolAction, Principal } from './types';
import { SHA256 } from './sha256';

export class CapabilityEngine {
  private grants: Map<string, CapabilityGrant[]> = new Map();

  constructor() {
    this.initDefaultGrants();
  }

  private initDefaultGrants() {
    // Seed standard agent grants
    this.addGrant({
      id: 'grant-standard-read',
      principalId: 'agent-devops-01',
      namespace: 'infra:read:*',
      allowedActions: ['infra.getMetrics', 'infra.listPods', 'logs.query', 'db.readOnlyQuery'],
      expiresAt: Date.now() + 86400000,
      leaseToken: SHA256.hash('LEASE_DEVOPS_READ_TOKEN_01')
    });

    this.addGrant({
      id: 'grant-standard-write',
      principalId: 'agent-devops-01',
      namespace: 'infra:deploy:staging',
      allowedActions: ['infra.deploy', 'infra.restartService', 'config.update'],
      parameterConstraints: {
        environment: { allowedValues: ['staging', 'development'] },
        replicaCount: { maxValue: 10 }
      },
      expiresAt: Date.now() + 86400000,
      leaseToken: SHA256.hash('LEASE_DEVOPS_WRITE_STAGING_01')
    });

    this.addGrant({
      id: 'grant-financial-read',
      principalId: 'agent-finance-01',
      namespace: 'finance:ledger:read',
      allowedActions: ['ledger.queryBalance', 'invoice.fetch', 'tax.estimate'],
      expiresAt: Date.now() + 86400000,
      leaseToken: SHA256.hash('LEASE_FINANCE_READ_TOKEN_01')
    });

    this.addGrant({
      id: 'grant-financial-transfer-capped',
      principalId: 'agent-finance-01',
      namespace: 'finance:wire:transfer',
      allowedActions: ['finance.transferFunds', 'payout.execute'],
      parameterConstraints: {
        amount: { maxValue: 5000 },
        currency: { allowedValues: ['USD', 'EUR', 'GBP'] }
      },
      expiresAt: Date.now() + 86400000,
      leaseToken: SHA256.hash('LEASE_FINANCE_TRANSFER_CAPPED_01')
    });
  }

  public addGrant(grant: CapabilityGrant) {
    const principalGrants = this.grants.get(grant.principalId) || [];
    principalGrants.push(grant);
    this.grants.set(grant.principalId, principalGrants);
  }

  public getGrantsForPrincipal(principalId: string): CapabilityGrant[] {
    return this.grants.get(principalId) || [];
  }

  /**
   * Evaluates if the current action is authorized by the principal's ACTIVE, UNEXPIRED capabilities.
   * Derives authorization from current state (Property 1 & 2).
   */
  public evaluateCapability(
    action: ToolAction,
    principal: Principal,
    currentTime: number = Date.now()
  ): {
    isAuthorized: boolean;
    matchingGrant?: CapabilityGrant;
    reasons: string[];
    violationDetails?: string;
  } {
    const principalGrants = this.grants.get(principal.id) || [];
    const reasons: string[] = [];

    if (principalGrants.length === 0) {
      return {
        isAuthorized: false,
        reasons: [`No capability grants found for principal ${principal.id}`],
        violationDetails: 'Principal lacks capability envelope'
      };
    }

    for (const grant of principalGrants) {
      // 1. Check expiration
      if (grant.expiresAt <= currentTime) {
        reasons.push(`Grant ${grant.id} expired at ${new Date(grant.expiresAt).toISOString()}`);
        continue;
      }

      // 2. Check action matching
      const matchesAction = grant.allowedActions.includes(action.toolName) ||
        grant.allowedActions.includes('*') ||
        grant.allowedActions.some(pattern => pattern.endsWith('*') && action.toolName.startsWith(pattern.slice(0, -1)));

      if (!matchesAction) {
        continue;
      }

      // 3. Check parameter constraints
      if (grant.parameterConstraints && action.parameters) {
        let constraintViolated = false;

        for (const [paramKey, constraint] of Object.entries(grant.parameterConstraints)) {
          const paramValue = action.parameters[paramKey];

          if (paramValue !== undefined) {
            if (constraint.allowedValues && !constraint.allowedValues.includes(paramValue)) {
              reasons.push(`Parameter '${paramKey}' value '${paramValue}' not in allowed set [${constraint.allowedValues.join(', ')}] for grant ${grant.id}`);
              constraintViolated = true;
              break;
            }

            if (constraint.maxValue !== undefined && typeof paramValue === 'number' && paramValue > constraint.maxValue) {
              reasons.push(`Parameter '${paramKey}' value ${paramValue} exceeds maxValue ${constraint.maxValue} for grant ${grant.id}`);
              constraintViolated = true;
              break;
            }

            if (constraint.regex && typeof paramValue === 'string') {
              const regex = new RegExp(constraint.regex);
              if (!regex.test(paramValue)) {
                reasons.push(`Parameter '${paramKey}' does not match required regex pattern for grant ${grant.id}`);
                constraintViolated = true;
                break;
              }
            }
          }
        }

        if (constraintViolated) {
          continue;
        }
      }

      // Found matching valid grant
      return {
        isAuthorized: true,
        matchingGrant: grant,
        reasons: [`Authorized via capability grant ${grant.id} (${grant.namespace})`]
      };
    }

    return {
      isAuthorized: false,
      reasons: reasons.length > 0 ? reasons : [`Tool action '${action.toolName}' is not covered by any active capability grant for ${principal.id}`],
      violationDetails: `Missing capability grant for ${action.toolName}`
    };
  }

  public revokeGrant(grantId: string): boolean {
    let found = false;
    for (const [principalId, grants] of this.grants.entries()) {
      const filtered = grants.filter(g => g.id !== grantId);
      if (filtered.length !== grants.length) {
        this.grants.set(principalId, filtered);
        found = true;
      }
    }
    return found;
  }
}
