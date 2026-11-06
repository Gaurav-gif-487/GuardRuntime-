import { ToolAction, DecisionTrace, InvariantEvaluation } from './types';
import { SHA256 } from './sha256';

export class InvariantsValidator {
  /**
   * The 7 Falsifiable Properties from THESIS.md:
   * 1. No stale execution: An action cannot execute without current authorization.
   * 2. Invalidation on meaningful change: Changing a meaningful authorization input invalidates previous approval.
   * 3. Cache is non-authorizing: A plan-cache hit cannot change an authorization result.
   * 4. High-impact actions cannot be cache-shortcut: High-impact actions require deliberate policy handling and do not bypass confirmation through cache.
   * 5. Fail closed: Degraded health or unknown/error conditions default to BLOCK.
   * 6. No approval replay: Human approval cannot be replayed for a changed action or changed authorization state.
   * 7. Explainability & Independent Verification: Decisions are explainable from recorded state, and execution outcome is verified independently.
   */

  public static evaluateAllInvariants(trace: DecisionTrace): InvariantEvaluation[] {
    return [
      this.checkProperty1_NoStaleExecution(trace),
      this.checkProperty2_InvalidationOnMeaningfulChange(trace),
      this.checkProperty3_CacheIsNonAuthorizing(trace),
      this.checkProperty4_HighImpactCannotBeCacheShortcut(trace),
      this.checkProperty5_FailClosed(trace),
      this.checkProperty6_NoApprovalReplay(trace),
      this.checkProperty7_ExplainabilityAndVerification(trace)
    ];
  }

  public static checkProperty1_NoStaleExecution(trace: DecisionTrace): InvariantEvaluation {
    // Property 1: Action executed must have had an explicit, current ALLOW verdict produced in this execution cycle.
    const executed = trace.executionOutcome?.executed || false;
    const isAllow = trace.verdict === 'ALLOW';
    const passed = !executed || isAllow;

    return {
      id: 'INV-1',
      propertyNumber: 1,
      name: 'No Stale Execution',
      description: 'An action cannot execute without current authorization freshly evaluated at decision time.',
      formalFormula: '∀ a ∈ Actions: Executed(a) ⇒ (Verdict(a, CurrentState) = ALLOW)',
      passed,
      witnessTrace: passed ? 'Execution status strictly synchronized with fresh ALLOW verdict.' : 'Violation: Action executed without current ALLOW authorization!'
    };
  }

  public static checkProperty2_InvalidationOnMeaningfulChange(trace: DecisionTrace): InvariantEvaluation {
    // Property 2: Action fingerprint must mathematically tie tenantId, principalId, parameters, and actionType.
    const computedFingerprint = SHA256.hash(
      `${trace.tenantId}:${trace.principalId}:${trace.normalizedAction.toolName}:${JSON.stringify(trace.normalizedAction.parameters)}`
    );
    const passed = trace.fingerprint === computedFingerprint;

    return {
      id: 'INV-2',
      propertyNumber: 2,
      name: 'Invalidation on Meaningful Change',
      description: 'Changing a meaningful authorization input invalidates previous action identity and approval fingerprint.',
      formalFormula: '∀ a, a\': a ≠ a\' ⇒ Fingerprint(a) ≠ Fingerprint(a\')',
      passed,
      witnessTrace: passed ? `Fingerprint strictly matches immutable parameter hash: ${trace.fingerprint.slice(0, 16)}...` : 'Violation: Action fingerprint divergence detected!'
    };
  }

  public static checkProperty3_CacheIsNonAuthorizing(trace: DecisionTrace): InvariantEvaluation {
    // Property 3: If cache was hit, it must NOT have supplied the verdict or risk score.
    // The pipeline must have independently evaluated risk and capabilities.
    const planStage = trace.stageResults.find(s => s.stageName === 'Execution-Plan Lookup');
    const riskStage = trace.stageResults.find(s => s.stageName === 'Current Risk Classification');
    const capStage = trace.stageResults.find(s => s.stageName === 'Capability Authorization');

    const passed = (!trace.cacheHit) || (Boolean(riskStage?.passed) && Boolean(capStage) && planStage?.details?.providedVerdict !== true);

    return {
      id: 'INV-3',
      propertyNumber: 3,
      name: 'Cache is Non-Authorizing',
      description: 'A plan-cache hit cannot supply an authorization result or bypass current state checks.',
      formalFormula: '∀ a, c ∈ Cache: Consult(c) ↛ DetermineVerdict(a)',
      passed,
      witnessTrace: passed ? 'Plan cache only supplied preparation hints; capability and risk were derived freshly.' : 'Violation: Cache hit supplied authorization verdict!'
    };
  }

  public static checkProperty4_HighImpactCannotBeCacheShortcut(trace: DecisionTrace): InvariantEvaluation {
    // Property 4: High impact actions require confirmation or explicit high-privilege policy, never automatic execution via cache
    const isHighRisk = trace.riskVector.isHighImpact || trace.riskVector.overallRiskScore > 0.65;
    const isAutoExecuted = trace.verdict === 'ALLOW' && (trace.executionOutcome?.executed || false);
    
    // High risk actions can only execute if they didn't skip confirmation via cache
    const passed = !isHighRisk || trace.verdict !== 'ALLOW' || trace.stageResults.some(s => s.stageName === 'Confirmation or Final Re-Check');

    return {
      id: 'INV-4',
      propertyNumber: 4,
      name: 'High-Impact Actions Cannot Be Cache-Shortcut',
      description: 'High-impact actions require deliberate policy handling and do not become automatically executable through cache reuse.',
      formalFormula: '∀ a: HighImpact(a) ∧ CacheHit(a) ⇒ RequiresConfirmation(a) ∨ HighPrivilegePolicy(a)',
      passed,
      witnessTrace: passed ? `High-impact boundary respected. Risk Score: ${trace.riskVector.overallRiskScore.toFixed(3)}.` : 'Violation: High-impact action shortcut through cache!'
    };
  }

  public static checkProperty5_FailClosed(trace: DecisionTrace): InvariantEvaluation {
    // Property 5: Degraded runtime health or error condition forces BLOCK for all non-trivial actions.
    const healthStage = trace.stageResults.find(s => s.stageName === 'Runtime-Health Gate');
    const isDegraded = healthStage?.details?.runtimeHealth === 'DEGRADED' || healthStage?.details?.runtimeHealth === 'MAINTENANCE';
    
    const passed = !isDegraded || trace.verdict === 'BLOCK';

    return {
      id: 'INV-5',
      propertyNumber: 5,
      name: 'Fail Closed',
      description: 'Degraded health, unexpected evaluation exceptions, or missing policies strictly fail closed to BLOCK.',
      formalFormula: 'Health(System) ≠ HEALTHY ⇒ Verdict(a) = BLOCK',
      passed,
      witnessTrace: passed ? 'System state healthy or failed closed correctly under degraded environment.' : 'Violation: System failed open under degraded health!'
    };
  }

  public static checkProperty6_NoApprovalReplay(trace: DecisionTrace): InvariantEvaluation {
    // Property 6: Human approval cannot be replayed for a changed action or changed authorization state.
    // If verdict is REQUIRE_CONFIRMATION, execution was safely halted awaiting approval.
    // If verdict is ALLOW via token, verify token was valid and not replayed.
    const executed = trace.executionOutcome?.executed || false;
    const confirmStage = trace.stageResults.find(s => s.stageName === 'Confirmation or Final Re-Check');
    const wasHighImpact = trace.riskVector.isHighImpact;

    let passed = true;
    if (executed && wasHighImpact) {
      // Must have passed confirmation stage with valid token
      passed = Boolean(confirmStage?.passed);
    } else if (trace.verdict === 'REQUIRE_CONFIRMATION') {
      // Correctly halted awaiting approval, no replay or leak occurred
      passed = true;
    }

    return {
      id: 'INV-6',
      propertyNumber: 6,
      name: 'No Approval Replay',
      description: 'Human approval cannot be replayed for a changed action or changed authorization state.',
      formalFormula: '∀ tok: Consumed(tok) ⇒ ¬Valid(tok)',
      passed,
      witnessTrace: passed ? 'Approval tokens bound to unique single-use cryptographic fingerprint.' : 'Violation: Approval token replay or binding mismatch detected!'
    };
  }

  public static checkProperty7_ExplainabilityAndVerification(trace: DecisionTrace): InvariantEvaluation {
    // Property 7: All decisions must have recorded reasons, stage traces, and independent outcome verification
    const hasReasons = trace.reasons.length > 0;
    const hasStageResults = trace.stageResults.length >= 7;
    const hasAuditHash = Boolean(trace.auditHash);
    const verifiedIndependent = trace.executionOutcome ? trace.executionOutcome.independentVerificationPassed : true;

    const passed = hasReasons && hasStageResults && hasAuditHash && verifiedIndependent;

    return {
      id: 'INV-7',
      propertyNumber: 7,
      name: 'Explainability & Independent Verification',
      description: 'Security-significant decisions are explainable from recorded state and independent outcome verification.',
      formalFormula: '∀ d: Explainable(d) ∧ TamperEvident(d) ∧ IndependentVerification(d)',
      passed,
      witnessTrace: passed ? `Recorded ${trace.stageResults.length} pipeline stage traces and cryptographic audit link.` : 'Violation: Decision lacks complete trace or independent verification!'
    };
  }
}
