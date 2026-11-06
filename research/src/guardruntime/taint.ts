/**
 * Information Flow Control & Taint Tracking (Gap 1).
 *
 * Solves the fundamental blind spot: GuardRuntime classifies risk based on
 * the TOOL, but real exfiltration attacks chain individually-safe tools to
 * move sensitive data through low-risk channels.
 *
 * Implements:
 * 1. TaintLabel taxonomy — PII, FINANCIAL, INTERNAL, CREDENTIALS, PHI, PUBLIC
 * 2. FlowPolicy — declarative rules governing which taint labels may flow
 *    to which tool capability categories
 * 3. TaintTracker — per-session propagation tracker that follows data across
 *    the agent's tool call chain
 *
 * Academic references:
 * - Fides (Microsoft Research, 2025): deterministic IFC with confidentiality/integrity labels
 * - NeuroTaint (2026): semantic-aware taint propagation through LLM reasoning
 * - ThoughtWorks Toxic Flow Analysis: mapping unsafe data paths in agentic workflows
 */

import type { ToolCall, ToolDescriptor } from "./types";

// ─── Taint Label Taxonomy ───────────────────────────────────────────────────

export type TaintLabel =
  | "PII" // Personally identifiable information (names, emails, SSNs, addresses)
  | "FINANCIAL" // Credit cards, bank accounts, transaction data
  | "CREDENTIALS" // API keys, passwords, tokens, secrets
  | "PHI" // Protected health information (HIPAA)
  | "INTERNAL" // Internal business data not meant for external exposure
  | "PUBLIC"; // Publicly available, unrestricted data

/** Sensitivity ordering: higher index = more sensitive. */
const SENSITIVITY_ORDER: Record<TaintLabel, number> = {
  PUBLIC: 0,
  INTERNAL: 1,
  PII: 2,
  FINANCIAL: 3,
  PHI: 4,
  CREDENTIALS: 5,
};

/**
 * Taint Level Hierarchy: A totally ordered classification of information sensitivity.
 * Sensitivity ordering: PUBLIC < INTERNAL < PII < FINANCIAL < PHI < CREDENTIALS
 */
export class TaintLevelHierarchy {
  private static readonly LEVELS: Record<TaintLabel, number> = SENSITIVITY_ORDER;
  private static readonly LABELS: TaintLabel[] = [
    "PUBLIC",
    "INTERNAL",
    "PII",
    "FINANCIAL",
    "PHI",
    "CREDENTIALS",
  ];

  /** Total order comparison: t1 <= t2 */
  public static leq(t1: TaintLabel, t2: TaintLabel): boolean {
    return this.LEVELS[t1] <= this.LEVELS[t2];
  }

  /** Maximum / Join (t1 ∨ t2): Returns maximum sensitivity level */
  public static join(t1: TaintLabel, t2: TaintLabel): TaintLabel {
    const maxVal = Math.max(this.LEVELS[t1], this.LEVELS[t2]);
    return this.LABELS[maxVal]!;
  }

  /** Minimum / Meet (t1 ∧ t2): Returns minimum sensitivity level */
  public static meet(t1: TaintLabel, t2: TaintLabel): TaintLabel {
    const minVal = Math.min(this.LEVELS[t1], this.LEVELS[t2]);
    return this.LABELS[minVal]!;
  }

  /** Compute accumulated level across a set of taint labels (monotonically non-decreasing) */
  public static computeAccumulatedLevel(labels: Iterable<TaintLabel>): TaintLabel {
    let current: TaintLabel = "PUBLIC";
    for (const label of labels) {
      current = this.join(current, label);
    }
    return current;
  }

  /**
   * Non-Interference Check: Asserts that an input flow level does not exceed
   * the maximum allowed ceiling of the sink without an authorized sanitizer.
   */
  public static assertNonInterference(
    flowLevel: TaintLabel,
    sinkCeiling: TaintLabel,
    hasSanitizer: boolean = false,
  ): boolean {
    if (hasSanitizer) return true;
    return this.leq(flowLevel, sinkCeiling);
  }
}

// Backward-compatibility alias
export { TaintLevelHierarchy as SecurityLattice };

// ─── Tool Capability Categories ─────────────────────────────────────────────

export type ToolCapability =
  | "read_internal" // Reads from internal data stores
  | "write_internal" // Writes to internal data stores
  | "external_communication" // Sends data externally (email, webhook, API)
  | "financial_mutation" // Moves money or changes billing
  | "infrastructure" // Modifies infrastructure (databases, services)
  | "logging" // Writes to logs/observability systems
  | "user_facing"; // Displays to end user

// ─── Flow Policy ────────────────────────────────────────────────────────────

export interface FlowRule {
  /** Taint label that is restricted. */
  taintLabel: TaintLabel;
  /** Tool capabilities that this taint label CANNOT flow to. */
  blockedCapabilities: ToolCapability[];
  /** Severity of the violation (used for reporting). */
  severity: "block" | "warn" | "audit";
  /** Human-readable rationale. */
  rationale: string;
}

export interface FlowPolicy {
  version: string;
  rules: FlowRule[];
}

/**
 * Default flow policy encoding standard data protection principles:
 * - PII/PHI/FINANCIAL/CREDENTIALS cannot flow to external channels
 * - CREDENTIALS cannot flow to any writable destination except infrastructure
 */
export const DEFAULT_FLOW_POLICY: FlowPolicy = {
  version: "flow-policy-2026.08.1",
  rules: [
    {
      taintLabel: "PII",
      blockedCapabilities: ["external_communication", "logging"],
      severity: "block",
      rationale: "PII must not be transmitted to external parties or written to unmasked logs",
    },
    {
      taintLabel: "FINANCIAL",
      blockedCapabilities: ["external_communication", "logging"],
      severity: "block",
      rationale: "Financial data must not leave the configured secure perimeter",
    },
    {
      taintLabel: "PHI",
      blockedCapabilities: ["external_communication", "logging", "user_facing"],
      severity: "block",
      rationale:
        "Protected health information must not be disclosed without explicit authorization",
    },
    {
      taintLabel: "CREDENTIALS",
      blockedCapabilities: ["external_communication", "logging", "user_facing", "write_internal"],
      severity: "block",
      rationale: "Credentials and secrets must never be written to non-vault destinations",
    },
    {
      taintLabel: "INTERNAL",
      blockedCapabilities: ["external_communication"],
      severity: "warn",
      rationale: "Internal business data should not flow to external channels without review",
    },
  ],
};

// ─── Taint-Aware Tool Descriptor Extension ──────────────────────────────────

export interface TaintAwareToolDescriptor {
  toolName: string;
  /** What taint labels this tool's OUTPUT produces. */
  outputTaints: TaintLabel[];
  /** What capabilities this tool exercises (used to check inbound taint). */
  capabilities: ToolCapability[];
}

/**
 * Seed taint profiles for the built-in tool set.
 * In production, these would be declared alongside ToolDescriptor registrations.
 */
export const SEED_TAINT_PROFILES: Record<string, TaintAwareToolDescriptor> = {
  search_orders: {
    toolName: "search_orders",
    outputTaints: ["PII", "FINANCIAL"],
    capabilities: ["read_internal"],
  },
  issue_refund: {
    toolName: "issue_refund",
    outputTaints: ["FINANCIAL"],
    capabilities: ["financial_mutation"],
  },
  send_email: {
    toolName: "send_email",
    outputTaints: ["PUBLIC"],
    capabilities: ["external_communication"],
  },
  wire_transfer: {
    toolName: "wire_transfer",
    outputTaints: ["FINANCIAL"],
    capabilities: ["financial_mutation", "external_communication"],
  },
  cancel_subscription: {
    toolName: "cancel_subscription",
    outputTaints: ["INTERNAL"],
    capabilities: ["write_internal"],
  },
  delete_workspace: {
    toolName: "delete_workspace",
    outputTaints: ["INTERNAL"],
    capabilities: ["infrastructure"],
  },
};

// ─── Flow Violation ─────────────────────────────────────────────────────────

export interface FlowViolation {
  /** The taint label that was illegally flowing. */
  taintLabel: TaintLabel;
  /** The tool that produced the tainted data. */
  sourceTool: string;
  /** The tool that would consume the tainted data. */
  sinkTool: string;
  /** The blocked capability that triggered the violation. */
  blockedCapability: ToolCapability;
  /** The severity of the violation. */
  severity: "block" | "warn" | "audit";
  /** Human-readable explanation. */
  rationale: string;
}

// ─── Taint Tracker ──────────────────────────────────────────────────────────

interface TaintedOutput {
  tool: string;
  taints: Set<TaintLabel>;
  timestamp: number;
}

/**
 * Per-session taint propagation tracker.
 *
 * Tracks the taint labels produced by each tool execution and checks whether
 * subsequent tool calls would violate flow policy by consuming tainted data
 * through a restricted capability channel.
 *
 * The tracker is conservative: it assumes that ANY tool output from the session
 * COULD be used as input to the NEXT tool call (since the LLM decides what to
 * pass between tools and we cannot inspect the model's internal reasoning).
 */
export class TaintTracker {
  private sessionTaints = new Map<string, TaintedOutput[]>();
  private profiles = new Map<string, TaintAwareToolDescriptor>();

  constructor(
    private readonly flowPolicy: FlowPolicy = DEFAULT_FLOW_POLICY,
    profiles: Record<string, TaintAwareToolDescriptor> = SEED_TAINT_PROFILES,
    private readonly clock: () => number = () => Date.now(),
    /** When true, a sink is also checked against its own prior taint. */
    private readonly strictSelfTaint = false,
  ) {
    for (const [name, p] of Object.entries(profiles)) {
      this.profiles.set(name, p);
    }
  }

  registerProfile(profile: TaintAwareToolDescriptor): void {
    this.profiles.set(profile.toolName, profile);
  }

  /**
   * Compute the accumulated taint set for a session, from every previously
   * executed tool EXCEPT `excludeSelfTool`.
   *
   * The self-exclusion matters: a tool that both produces a taint label and
   * has a capability blocked by that same label (e.g. wire_transfer produces
   * FINANCIAL taint and legitimately has the external_communication
   * capability to actually send the wire) would otherwise permanently block
   * itself from ever running a second time in the same session — its own
   * first execution poisons all subsequent calls to itself. That's not a
   * real exfiltration risk (the tool moving money is doing its declared
   * job, not leaking data to an unrelated channel); it's a session-blanket
   * check mistaking "this tool ran before" for "tainted data is flowing
   * into a new, different destination." Taint produced by *other* tools
   * still accumulates and is still checked normally.
   */
  getSessionTaints(sessionKey: string, excludeSelfTool?: string): Set<TaintLabel> {
    const outputs = this.sessionTaints.get(sessionKey) ?? [];
    const combined = new Set<TaintLabel>();
    for (const o of outputs) {
      if (excludeSelfTool && o.tool === excludeSelfTool) continue;
      for (const t of o.taints) combined.add(t);
    }
    return combined;
  }

  /**
   * Check whether invoking `toolName` in the current session would violate
   * flow policy, given the accumulated taint from previous tool outputs
   * (excluding taint the same tool produced on an earlier call — see
   * getSessionTaints).
   *
   * Returns an array of violations (empty = no violations).
   */
  checkFlow(sessionKey: string, toolName: string): FlowViolation[] {
    const accumulated = this.getSessionTaints(
      sessionKey,
      this.strictSelfTaint ? undefined : toolName,
    );
    const sinkProfile = this.profiles.get(toolName);
    if (!sinkProfile || accumulated.size === 0) return [];

    const sinkCapabilities = new Set(sinkProfile.capabilities);
    const violations: FlowViolation[] = [];

    for (const rule of this.flowPolicy.rules) {
      if (!accumulated.has(rule.taintLabel)) continue;

      for (const blockedCap of rule.blockedCapabilities) {
        if (!sinkCapabilities.has(blockedCap)) continue;

        // Find which tool produced this taint (excluding the sink tool itself)
        const source = this.findTaintSource(
          sessionKey,
          rule.taintLabel,
          this.strictSelfTaint ? undefined : toolName,
        );

        violations.push({
          taintLabel: rule.taintLabel,
          sourceTool: source ?? "unknown",
          sinkTool: toolName,
          blockedCapability: blockedCap,
          severity: rule.severity,
          rationale: rule.rationale,
        });
      }
    }

    return violations;
  }

  /**
   * Record that a tool was executed, adding its output taints to the session.
   */
  recordExecution(sessionKey: string, toolName: string): void {
    const profile = this.profiles.get(toolName);
    if (!profile) return;

    const outputs = this.sessionTaints.get(sessionKey) ?? [];
    outputs.push({
      tool: toolName,
      taints: new Set(profile.outputTaints),
      timestamp: this.clock(),
    });
    this.sessionTaints.set(sessionKey, outputs);
  }

  /**
   * Get the maximum sensitivity level of all accumulated taints in a session.
   */
  getMaxSensitivity(sessionKey: string): number {
    const taints = this.getSessionTaints(sessionKey);
    let max = 0;
    for (const t of taints) {
      max = Math.max(max, SENSITIVITY_ORDER[t]);
    }
    return max;
  }

  /**
   * Clear a session's taint state (e.g., when the session ends or is reset).
   */
  clearSession(sessionKey: string): void {
    this.sessionTaints.delete(sessionKey);
  }

  private findTaintSource(
    sessionKey: string,
    label: TaintLabel,
    excludeSelfTool?: string,
  ): string | undefined {
    const outputs = this.sessionTaints.get(sessionKey) ?? [];
    // Return the most recent tool (other than excludeSelfTool) that produced this taint
    for (let i = outputs.length - 1; i >= 0; i--) {
      if (excludeSelfTool && outputs[i]!.tool === excludeSelfTool) continue;
      if (outputs[i]!.taints.has(label)) return outputs[i]!.tool;
    }
    return undefined;
  }
}
