// GuardRuntime Type System

export type DecisionVerdict = 'ALLOW' | 'BLOCK' | 'REQUIRE_CONFIRMATION';

export interface Principal {
  id: string;
  name: string;
  role: 'agent' | 'user' | 'admin' | 'auditor' | 'subagent';
  tenantId: string;
  capabilities: string[];
}

export type TaintSource = 'UNTRUSTED_WEB' | 'EXTERNAL_EMAIL' | 'PROMPT_INJECTION' | 'USER_PROMPT' | 'SYSTEM_PROMPT' | 'DATABASE';

export type TaintSink = 'SYSTEM_EXEC' | 'FS_WRITE' | 'NETWORK_EXFIL' | 'API_DISPATCH' | 'PRIVILEGE_ESCALATE';

export interface TaintTag {
  id: string;
  source: TaintSource;
  confidence: number;
  originDetails: string;
  timestamp: number;
}

export interface ToolAction {
  id: string;
  toolName: string;
  actionType: 'READ' | 'WRITE' | 'EXECUTE' | 'NETWORK' | 'FINANCIAL' | 'ADMIN';
  parameters: Record<string, any>;
  taintTags?: TaintTag[];
  timestamp: number;
  nonce?: string;
}

export interface RiskVector {
  reversibility: number; // 0.0 (completely irreversible) to 1.0 (trivial undo)
  blastRadius: number;   // 0.0 (strictly isolated) to 1.0 (infrastructure/critical)
  resourceImpact: number;// 0.0 to 1.0 (cost/compute)
  confidentialityRisk: number; // 0.0 to 1.0
  overallRiskScore: number;    // Computed weighted composite
  isHighImpact: boolean;
  classificationRationale: string[];
}

export interface CapabilityGrant {
  id: string;
  principalId: string;
  namespace: string; // e.g., "cloud:compute:*", "db:customers:read"
  allowedActions: string[];
  parameterConstraints?: Record<string, { regex?: string; allowedValues?: any[]; maxValue?: number }>;
  expiresAt: number;
  leaseToken: string;
}

export interface PolicyRule {
  id: string;
  name: string;
  description: string;
  effect: 'ALLOW' | 'DENY' | 'CONFIRM';
  matchToolNames?: string[];
  matchActionTypes?: string[];
  condition?: (action: ToolAction, principal: Principal, context: ExecutionContext) => boolean;
  conditionExpression?: string;
  priority: number;
}

export interface PolicySet {
  id: string;
  version: string;
  name: string;
  tenantId: string;
  rules: PolicyRule[];
  algebraicOp?: 'CONJUNCTIVE' | 'DISJUNCTIVE' | 'DENY_OVERRIDES' | 'PRIORITY_ORDER';
}

export interface ExecutionContext {
  tenantId: string;
  principal: Principal;
  currentBudgetRemaining: number;
  hourlyActionCount: number;
  runtimeHealth: 'HEALTHY' | 'DEGRADED' | 'MAINTENANCE';
  activePolicies: PolicySet[];
  capabilityGrants: CapabilityGrant[];
  time: number;
  cacheEnabled: boolean;
}

export interface CachedPlan {
  planId: string;
  goalHash: string;
  stepTemplates: Array<{ toolName: string; actionType: string }>;
  suggestedOrdering: string[];
  scopeHints: string[];
  createdAt: number;
  // NOTE (Property 3 & Spec 3.4): A CachedPlan NEVER carries authorization verdicts or risk bypasses!
}

export interface ConfirmationToken {
  id: string;
  actionFingerprint: string;
  principalId: string;
  tenantId: string;
  authorizedBy: string;
  issuedAt: number;
  expiresAt: number;
  consumed: boolean;
}

export interface PipelineStageResult {
  stageNumber: number;
  stageName: string;
  passed: boolean;
  durationMs: number;
  details: Record<string, any>;
  explanation: string;
}

export interface DecisionTrace {
  decisionId: string;
  timestamp: number;
  tenantId: string;
  principalId: string;
  action: ToolAction;
  normalizedAction: ToolAction;
  fingerprint: string;
  verdict: DecisionVerdict;
  reasons: string[];
  riskVector: RiskVector;
  cacheConsulted: boolean;
  cacheHit: boolean;
  stageResults: PipelineStageResult[];
  invokedInvariantsChecked: string[];
  invariantsPassed: boolean;
  auditHash: string;
  executionOutcome?: {
    executed: boolean;
    durationMs: number;
    success: boolean;
    resultSummary: string;
    independentVerificationPassed: boolean;
    verificationDetails: string;
  };
}

export interface AuditBlock {
  index: number;
  timestamp: number;
  decisionId: string;
  tenantId: string;
  principalId: string;
  actionDigest: string;
  verdict: DecisionVerdict;
  riskScore: number;
  previousHash: string;
  merkleRoot: string;
  pcrRegisterHash: string;
  blockHash: string;
}

export interface InvariantEvaluation {
  id: string;
  name: string;
  propertyNumber: number; // 1 to 7 corresponding to THESIS.md
  description: string;
  passed: boolean;
  witnessTrace?: string;
  formalFormula: string;
}
