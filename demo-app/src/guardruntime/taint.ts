import { ToolAction, TaintTag, TaintSink } from './types';

/**
 * Taint Level Hierarchy: A totally ordered classification of information sensitivity.
 * 
 * Hierarchy elements strictly ordered by confidentiality/integrity sensitivity:
 * CLEAN < LOW_CONFIDENCE < HIGH_PII < UNTRUSTED_INJECTION < SYSTEM_CRITICAL
 */
export type SecurityLevel = 'CLEAN' | 'LOW_CONFIDENCE' | 'HIGH_PII' | 'UNTRUSTED_INJECTION' | 'SYSTEM_CRITICAL';

export class TaintLevelHierarchy {
  private static readonly LEVELS: Record<SecurityLevel, number> = {
    CLEAN: 0,
    LOW_CONFIDENCE: 1,
    HIGH_PII: 2,
    UNTRUSTED_INJECTION: 3,
    SYSTEM_CRITICAL: 4
  };

  private static readonly LEVEL_NAMES: SecurityLevel[] = [
    'CLEAN',
    'LOW_CONFIDENCE',
    'HIGH_PII',
    'UNTRUSTED_INJECTION',
    'SYSTEM_CRITICAL'
  ];

  /**
   * Total order comparison relation (t1 <= t2)
   */
  public static leq(t1: SecurityLevel, t2: SecurityLevel): boolean {
    return this.LEVELS[t1] <= this.LEVELS[t2];
  }

  /**
   * Maximum / Join (t1 ∨ t2)
   * In a total order, the join is simply the maximum sensitivity level.
   */
  public static join(t1: SecurityLevel, t2: SecurityLevel): SecurityLevel {
    const maxVal = Math.max(this.LEVELS[t1], this.LEVELS[t2]);
    return this.LEVEL_NAMES[maxVal];
  }

  /**
   * Minimum / Meet (t1 ∧ t2)
   * In a total order, the meet is simply the minimum sensitivity level.
   */
  public static meet(t1: SecurityLevel, t2: SecurityLevel): SecurityLevel {
    const minVal = Math.min(this.LEVELS[t1], this.LEVELS[t2]);
    return this.LEVEL_NAMES[minVal];
  }

  /**
   * Compute the accumulated taint level across a set of tags (monotonically non-decreasing)
   */
  public static computeAccumulatedLevel(tags: TaintTag[]): SecurityLevel {
    let current: SecurityLevel = 'CLEAN';
    for (const tag of tags) {
      const lvl = this.tagToSecurityLevel(tag);
      current = this.join(current, lvl);
    }
    return current;
  }

  public static tagToSecurityLevel(tag: TaintTag): SecurityLevel {
    if (tag.source === 'PROMPT_INJECTION') return 'UNTRUSTED_INJECTION';
    if (tag.source === 'UNTRUSTED_WEB' || tag.source === 'EXTERNAL_EMAIL') return 'LOW_CONFIDENCE';
    return 'CLEAN';
  }
}

// Backward-compatibility alias
export { TaintLevelHierarchy as SecurityLattice };

export class DynamicTaintEngine {
  // Mapping of sensitive sinks to the maximum taint ceiling permitted without sanitization
  private sinkCeilings: Record<string, { sink: TaintSink; maxAllowedLevel: SecurityLevel }> = {
    'system.executeCommand': { sink: 'SYSTEM_EXEC', maxAllowedLevel: 'CLEAN' },
    'fs.writeFile': { sink: 'FS_WRITE', maxAllowedLevel: 'CLEAN' },
    'fs.deleteFile': { sink: 'FS_WRITE', maxAllowedLevel: 'CLEAN' },
    'network.sendPayload': { sink: 'NETWORK_EXFIL', maxAllowedLevel: 'LOW_CONFIDENCE' },
    'sql.rawExecute': { sink: 'API_DISPATCH', maxAllowedLevel: 'CLEAN' },
    'auth.grantAdmin': { sink: 'PRIVILEGE_ESCALATE', maxAllowedLevel: 'CLEAN' }
  };

  /**
   * Scans parameters and detects embedded prompt injections, exfiltration payloads,
   * or untrusted sources via both structural pattern analysis and lattice flow computation.
   */
  public analyzeTaint(action: ToolAction): {
    hasTaint: boolean;
    accumulatedSecurityLevel: SecurityLevel;
    taintTags: TaintTag[];
    sinkViolation?: { sink: TaintSink; reason: string; flowLevel: SecurityLevel; ceiling: SecurityLevel };
  } {
    const identifiedTags: TaintTag[] = [...(action.taintTags || [])];
    const paramString = JSON.stringify(action.parameters || {});

    // Deterministic heuristics for untrusted injection vectors
    const injectionPatterns = [
      { pattern: /ignore\s+previous\s+instructions/i, details: 'Prompt injection instruction override detected' },
      { pattern: /system\s+prompt\s+override/i, details: 'System prompt override attack pattern' },
      { pattern: /sudo\s+rm\s+-rf/i, details: 'Dangerous command execution pattern' },
      { pattern: /https?:\/\/(?:webhook\.site|attacker|evil\.com|requestbin)/i, details: 'Potential data exfiltration endpoint' },
      { pattern: /curl\s+-X\s+POST.*-d\s*@/i, details: 'Exfiltration command pattern' },
      { pattern: /UNION\s+SELECT.*FROM/i, details: 'SQL injection attack pattern' },
      { pattern: /base64\s+-d.*\|\s*sh/i, details: 'Obfuscated shell payload pattern' }
    ];

    for (const item of injectionPatterns) {
      if (item.pattern.test(paramString)) {
        identifiedTags.push({
          id: `taint-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          source: 'PROMPT_INJECTION',
          confidence: 0.98,
          originDetails: item.details,
          timestamp: Date.now()
        });
      }
    }

    const currentLevel = TaintLevelHierarchy.computeAccumulatedLevel(identifiedTags);
    const sinkConfig = this.sinkCeilings[action.toolName];
    let sinkViolation: { sink: TaintSink; reason: string; flowLevel: SecurityLevel; ceiling: SecurityLevel } | undefined;

    if (sinkConfig) {
      // Non-Interference Check: Current Taint Level <= Sink Ceiling
      if (!TaintLevelHierarchy.leq(currentLevel, sinkConfig.maxAllowedLevel)) {
        sinkViolation = {
          sink: sinkConfig.sink,
          flowLevel: currentLevel,
          ceiling: sinkConfig.maxAllowedLevel,
          reason: `Information-Flow Violation: Action '${action.toolName}' hits sink '${sinkConfig.sink}' with taint level ${currentLevel}, exceeding allowed ceiling ${sinkConfig.maxAllowedLevel}`
        };
      }
    }

    return {
      hasTaint: identifiedTags.length > 0,
      accumulatedSecurityLevel: currentLevel,
      taintTags: identifiedTags,
      sinkViolation
    };
  }

  /**
   * Simulates multi-hop cross-agent taint propagation
   */
  public propagateTaintAcrossAgents(
    sourceTaint: TaintTag[],
    intermediateTransform: (input: string) => string,
    payloadText: string
  ): { propagatedTags: TaintTag[]; outputSecurityLevel: SecurityLevel } {
    const transformed = intermediateTransform(payloadText);
    const propagated: TaintTag[] = sourceTaint.map(t => ({
      ...t,
      id: `prop-${t.id}`,
      originDetails: `Propagated via agent delegation: ${t.originDetails} -> Output [${transformed.slice(0, 30)}...]`
    }));

    // If transformation contains newly introduced injection vectors, join with UNTRUSTED_INJECTION
    if (/curl.*@|ignore\s+previous/i.test(transformed)) {
      propagated.push({
        id: `inj-${Date.now()}`,
        source: 'PROMPT_INJECTION',
        confidence: 0.99,
        originDetails: 'Secondary synthesis injected adversarial payload',
        timestamp: Date.now()
      });
    }

    return {
      propagatedTags: propagated,
      outputSecurityLevel: TaintLevelHierarchy.computeAccumulatedLevel(propagated)
    };
  }

  public tagUntrustedInput(content: string, source: 'UNTRUSTED_WEB' | 'EXTERNAL_EMAIL' | 'PROMPT_INJECTION'): TaintTag {
    return {
      id: `taint-tag-${Date.now()}`,
      source,
      confidence: 0.95,
      originDetails: `External content ingestion (${content.slice(0, 40)}...)`,
      timestamp: Date.now()
    };
  }
}
