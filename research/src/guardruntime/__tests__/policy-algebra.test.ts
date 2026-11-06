import { describe, expect, it } from "vitest";
import {
  mergePolicies,
  diffPolicies,
  simulatePolicy,
  resolveTemporalPolicy,
  type TemporalRule,
} from "../policy-algebra";
import { DEFAULT_POLICY, type Policy } from "../policy";
import type { ToolCall } from "../types";

const makeCall = (over: Partial<ToolCall> = {}): ToolCall => ({
  tenantId: "acme-tenant",
  idempotencyKey: `pol_${Math.random()}`,
  tool: "issue_refund",
  args: { amount_usd: 500 },
  goal: "refund high amount",
  principal: "agent:support",
  permissionScope: "support:write",
  environment: "prod",
  ...over,
});

describe("Policy Algebra", () => {
  it("merges policies with 'most_restrictive' strategy correctly", () => {
    const base: Policy = {
      ...DEFAULT_POLICY,
      version: "base-v1",
      thresholds: { destructive: 0, recoverable: 0.5, reversible: 0.9 },
      lowConfidenceCutoff: 0.5,
    };

    const teamOverlay: Policy = {
      ...DEFAULT_POLICY,
      version: "team-strict",
      thresholds: { destructive: 0, recoverable: 0.2, reversible: 0.7 },
      lowConfidenceCutoff: 0.8,
    };

    const merged = mergePolicies(base, teamOverlay, { strategy: "most_restrictive" });
    // Lower threshold wins
    expect(merged.thresholds.recoverable).toBe(0.2);
    expect(merged.thresholds.reversible).toBe(0.7);
    // Higher confidence cutoff wins
    expect(merged.lowConfidenceCutoff).toBe(0.8);
  });

  it("computes structured diffs between policy versions", () => {
    const oldPolicy = DEFAULT_POLICY;
    const newPolicy: Policy = {
      ...DEFAULT_POLICY,
      version: "v2-hardened",
      thresholds: {
        ...DEFAULT_POLICY.thresholds,
        recoverable: 0.2, // Stricter
      },
      lowConfidenceCutoff: 0.8, // Stricter
    };

    const diff = diffPolicies(oldPolicy, newPolicy);
    expect(diff.changes.length).toBeGreaterThan(0);
    expect(diff.summary.stricter).toBeGreaterThanOrEqual(2);
  });

  it("simulates policy impact on tool calls without executing", () => {
    const basePolicy = DEFAULT_POLICY;
    const strictPolicy: Policy = {
      ...DEFAULT_POLICY,
      version: "strict",
      thresholds: { destructive: 0, recoverable: 0.05, reversible: 0.5 },
    };

    const call = makeCall({ tool: "issue_refund", args: { amount_usd: 50 } });
    const simResults = simulatePolicy([call], basePolicy, strictPolicy);

    expect(simResults).toHaveLength(1);
    expect(simResults[0]?.currentPolicy.version).toBe(basePolicy.version);
    expect(simResults[0]?.candidatePolicy.version).toBe(strictPolicy.version);
  });

  it("resolves temporal policy overlays based on schedule", () => {
    const basePolicy = DEFAULT_POLICY;
    const offHoursRule: TemporalRule = {
      id: "off-hours-strict",
      description: "Strict thresholds during weekend / off-hours",
      activeDays: [0, 6], // Sunday, Saturday
      startHour: 0,
      endHour: 24,
      policyOverlay: {
        thresholds: { destructive: 0, recoverable: 0.1, reversible: 0.3 },
      },
    };

    // Sunday 10:00 UTC
    const sundayDate = new Date(Date.UTC(2026, 7, 16, 10, 0, 0));
    const result = resolveTemporalPolicy(basePolicy, [offHoursRule], sundayDate);

    expect(result.activeRules).toContain("off-hours-strict");
    expect(result.policy.thresholds.recoverable).toBe(0.1);
  });
});
