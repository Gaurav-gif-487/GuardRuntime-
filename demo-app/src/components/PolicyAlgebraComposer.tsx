import React, { useState } from 'react';
import { Lock, Play, CheckCircle2, AlertOctagon, HelpCircle, Layers } from 'lucide-react';
import { PolicySet, ToolAction, Principal, ExecutionContext } from '../guardruntime/types';
import { PolicyAlgebra } from '../guardruntime/policy-algebra';
import { PolicyEngine } from '../guardruntime/policy';

export const PolicyAlgebraComposer: React.FC = () => {
  const [operator, setOperator] = useState<'UNION' | 'INTERSECT' | 'DENY_OVERRIDES'>('DENY_OVERRIDES');
  const [testToolName, setTestToolName] = useState<string>('infra.deploy');
  const [testEnvironment, setTestEnvironment] = useState<string>('staging');
  const [evaluationResult, setEvaluationResult] = useState<{
    verdict: string;
    reasons: string[];
  } | null>(null);

  // Policy 1: Security SecOps Policy
  const policySecOps: PolicySet = {
    id: 'pol-secops',
    version: '1.0.0',
    name: 'SecOps Baseline Policy',
    tenantId: 'tenant-demo',
    rules: [
      {
        id: 'r-sec-1',
        name: 'Deny Direct Production Mutations',
        description: 'Blocks production deploy without change window',
        effect: 'DENY',
        matchToolNames: ['infra.deploy'],
        condition: (action) => action.parameters.environment === 'production',
        priority: 50
      },
      {
        id: 'r-sec-2',
        name: 'Confirm Staging Deployments',
        description: 'Requires confirmation for staging rollouts',
        effect: 'CONFIRM',
        matchToolNames: ['infra.deploy'],
        condition: (action) => action.parameters.environment === 'staging',
        priority: 20
      }
    ]
  };

  // Policy 2: Compliance Finance & Operations Policy
  const policyCompliance: PolicySet = {
    id: 'pol-compliance',
    version: '1.0.0',
    name: 'Compliance & Audit Policy',
    tenantId: 'tenant-demo',
    rules: [
      {
        id: 'r-comp-1',
        name: 'Permit Staging and Dev Deployments',
        description: 'Permits non-production deploy testing',
        effect: 'ALLOW',
        matchToolNames: ['infra.deploy'],
        condition: (action) => action.parameters.environment === 'staging' || action.parameters.environment === 'development',
        priority: 10
      },
      {
        id: 'r-comp-2',
        name: 'Deny High Replicas',
        description: 'Blocks excessive replica count',
        effect: 'DENY',
        matchToolNames: ['infra.deploy'],
        condition: (action) => action.parameters.replicaCount > 20,
        priority: 40
      }
    ]
  };

  const handleEvaluateAlgebra = () => {
    const action: ToolAction = {
      id: 'act-algebra-test',
      toolName: testToolName,
      actionType: 'WRITE',
      parameters: { environment: testEnvironment, replicaCount: 5 },
      timestamp: Date.now()
    };

    const principal: Principal = {
      id: 'agent-devops-01',
      name: 'DevOps Agent',
      role: 'agent',
      tenantId: 'tenant-demo',
      capabilities: ['infra:deploy:staging']
    };

    const context: ExecutionContext = {
      tenantId: 'tenant-demo',
      principal,
      currentBudgetRemaining: 5000,
      hourlyActionCount: 4,
      runtimeHealth: 'HEALTHY',
      activePolicies: [policySecOps, policyCompliance],
      capabilityGrants: [],
      time: Date.now(),
      cacheEnabled: true
    };

    const engine = new PolicyEngine();

    if (operator === 'DENY_OVERRIDES') {
      const evaluator = PolicyAlgebra.denyOverrides([policySecOps, policyCompliance]);
      const res = evaluator(action, principal, context);
      setEvaluationResult(res);
    } else if (operator === 'UNION') {
      const combined = PolicyAlgebra.union(policySecOps, policyCompliance);
      const res = engine.evaluatePolicySet(combined, action, principal, context);
      setEvaluationResult(res);
    } else if (operator === 'INTERSECT') {
      const combined = PolicyAlgebra.intersect(policySecOps, policyCompliance);
      const res = engine.evaluatePolicySet(combined, action, principal, context);
      setEvaluationResult(res);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <h3 className="text-sm font-bold text-white flex items-center space-x-2">
          <Lock className="w-4 h-4 text-indigo-400" />
          <span>Composable Policy Algebra Engine</span>
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          Compose independent policy sets using algebraic combinators: <span className="text-indigo-300 font-mono">Union (∨)</span>, <span className="text-indigo-300 font-mono">Intersection (∧)</span>, and <span className="text-indigo-300 font-mono">Deny-Overrides (⊘)</span>.
        </p>
      </div>

      {/* Operator & Input Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: Composed Policies */}
        <div className="space-y-4">
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono">
            <span className="font-bold text-indigo-300 block mb-2">POLICY 1: SecOps Baseline Policy</span>
            <ul className="list-disc list-inside text-slate-300 space-y-1">
              <li><span className="text-rose-400 font-bold">DENY</span>: env === 'production' (Priority 50)</li>
              <li><span className="text-amber-400 font-bold">CONFIRM</span>: env === 'staging' (Priority 20)</li>
            </ul>
          </div>

          <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono">
            <span className="font-bold text-indigo-300 block mb-2">POLICY 2: Compliance & Audit Policy</span>
            <ul className="list-disc list-inside text-slate-300 space-y-1">
              <li><span className="text-emerald-400 font-bold">ALLOW</span>: env === 'staging' || 'development' (Priority 10)</li>
              <li><span className="text-rose-400 font-bold">DENY</span>: replicaCount &gt; 20 (Priority 40)</li>
            </ul>
          </div>

          <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono">
            <label className="font-bold text-slate-300 block mb-2">ALGEBRAIC COMBINATOR OPERATOR:</label>
            <div className="grid grid-cols-3 gap-2">
              {(['DENY_OVERRIDES', 'INTERSECT', 'UNION'] as const).map((op) => (
                <button
                  key={op}
                  onClick={() => setOperator(op)}
                  className={`p-2 rounded-lg border text-center font-bold text-[11px] transition ${
                    operator === op ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-850'
                  }`}
                >
                  {op}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Interactive Evaluation Test */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4 text-xs font-mono">
          <h4 className="font-bold text-white uppercase tracking-wider text-xs">Test Evaluation Payload</h4>

          <div>
            <label className="text-slate-400 block mb-1">TARGET TOOL:</label>
            <input
              type="text"
              value={testToolName}
              onChange={(e) => setTestToolName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200"
            />
          </div>

          <div>
            <label className="text-slate-400 block mb-1">ENVIRONMENT PARAMETER:</label>
            <select
              value={testEnvironment}
              onChange={(e) => setTestEnvironment(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200"
            >
              <option value="staging">staging (Triggers Confirm in SecOps, Allow in Compliance)</option>
              <option value="production">production (Triggers Deny in SecOps)</option>
              <option value="development">development (Triggers Allow in Compliance)</option>
            </select>
          </div>

          <button
            onClick={handleEvaluateAlgebra}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold shadow transition flex items-center justify-center space-x-2"
          >
            <Play className="w-4 h-4" />
            <span>Evaluate Algebra Composition ({operator})</span>
          </button>

          {evaluationResult && (
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">COMPOSITE OUTCOME:</span>
                <span className={`px-2.5 py-0.5 rounded-full font-bold text-xs ${
                  evaluationResult.verdict === 'ALLOW' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50' :
                  evaluationResult.verdict === 'REQUIRE_CONFIRMATION' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50' :
                  'bg-rose-500/20 text-rose-300 border border-rose-500/50'
                }`}>
                  {evaluationResult.verdict}
                </span>
              </div>

              <div className="text-[11px] text-slate-300 space-y-1">
                <span className="text-slate-500 font-semibold block">MATCHED REASONS:</span>
                <ul className="list-disc list-inside space-y-0.5">
                  {evaluationResult.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
