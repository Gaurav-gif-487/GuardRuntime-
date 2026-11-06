import { useCallback, useMemo, useRef, useState } from "react";
import {
  GuardRuntime,
  DEFAULT_POLICY,
  SEED_TOOLS,
  type ToolCall,
  type Outcome,
  type ConfirmationRecord,
  type CachedPlan,
  type AuditEntry,
} from "../guardruntime";

export const TENANT = "acme-retail";
const PRINCIPAL = "agent:playground";

let keyCounter = 0;
const nextKey = () => `pg_${Date.now().toString(36)}_${++keyCounter}`;

export interface CallLogEntry {
  id: string;
  tool: string;
  goal: string;
  args: Record<string, unknown>;
  permissionScope: string;
  environment: ToolCall["environment"];
  outcome: Outcome;
  at: number;
}

/**
 * Runs a real GuardRuntime instance client-side (pure TS, no server round
 * trip needed) and exposes its state as React-friendly snapshots. This is a
 * local demo instance, not the server-side DashboardApiRouter or a persisted
 * production control plane. GuardRuntime
 * itself is a plain mutable class, so every mutating action bumps `tick` to
 * force a re-read of the getters below.
 */
export function useGuardRuntime() {
  const rt = useRef(new GuardRuntime({ policy: DEFAULT_POLICY })).current;
  const [tick, setTick] = useState(0);
  const [log, setLog] = useState<CallLogEntry[]>([]);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  const submit = useCallback(
    async (input: {
      tool: string;
      args: Record<string, unknown>;
      goal: string;
      permissionScope: string;
      environment: "prod" | "staging" | "dev";
      confidence?: number;
    }) => {
      const call: ToolCall = {
        tenantId: TENANT,
        idempotencyKey: nextKey(),
        tool: input.tool,
        args: input.args,
        goal: input.goal,
        principal: PRINCIPAL,
        permissionScope: input.permissionScope,
        environment: input.environment,
        ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
      };
      const outcome = await rt.call(call);
      setLog((l) => [
        {
          id: call.idempotencyKey,
          tool: call.tool,
          goal: call.goal,
          args: call.args,
          permissionScope: call.permissionScope,
          environment: call.environment,
          outcome,
          at: Date.now(),
        },
        ...l,
      ]);
      bump();
      return outcome;
    },
    [rt, bump],
  );

  const resolveConfirmation = useCallback(
    async (confirmationId: string, decision: "approved" | "denied", approverId: string) => {
      const record = rt.cm.get(TENANT, confirmationId);
      if (!record) return;
      rt.cm.resolve(
        TENANT,
        confirmationId,
        decision,
        { id: approverId || "reviewer@dashboard", method: "oidc" },
        Date.now(),
      );
      const original = log.find((l) => l.id === record.idempotencyKey);
      if (!original) return;
      // Resume the exact original request. Approval is bound to the normalized
      // action fingerprint, so substituting placeholder scope/environment data
      // here would create a dashboard-only authorization mismatch.
      const effective: ToolCall = {
        tenantId: TENANT,
        idempotencyKey: record.idempotencyKey,
        tool: record.tool,
        args: original.args,
        goal: original.goal,
        principal: PRINCIPAL,
        permissionScope: original.permissionScope,
        environment: original.environment,
      };
      const outcome = await rt.resume(TENANT, confirmationId, effective);
      setLog((l) => l.map((e) => (e.id === record.idempotencyKey ? { ...e, outcome } : e)));
      bump();
    },
    [rt, bump, log],
  );

  const toggleHealth = useCallback(() => {
    rt.setHealthy(!rt.isHealthy());
    bump();
  }, [rt, bump]);

  const tamperOneEntry = useCallback(() => {
    const entries = rt.audit.entries(TENANT);
    if (entries.length < 2) return;
    rt.audit.tamper(TENANT, 1, (e) => {
      e.payload = { ...e.payload, reason: "rewritten by simulated compromised credential" };
    });
    bump();
  }, [rt, bump]);

  const sweepTimeouts = useCallback(() => {
    rt.sweepTimeouts(TENANT);
    bump();
  }, [rt, bump]);

  // Snapshots — recomputed whenever `tick` changes.
  const pending: ConfirmationRecord[] = useMemo(() => rt.cm.pending(TENANT), [rt, tick]);
  const allConfirmations: ConfirmationRecord[] = useMemo(() => rt.cm.all(TENANT), [rt, tick]);
  const plans: CachedPlan[] = useMemo(() => rt.cache.plans(TENANT), [rt, tick]);
  const auditEntries: readonly AuditEntry[] = useMemo(() => rt.audit.entries(TENANT), [rt, tick]);
  const auditStatus = useMemo(() => rt.audit.verify(TENANT), [rt, tick]);
  const metricsSnapshot = useMemo(() => rt.metrics.snapshot(), [rt, tick]);
  const isHealthy = useMemo(() => rt.isHealthy(), [rt, tick]);
  const tools = useMemo(() => SEED_TOOLS, []);

  return {
    submit,
    resolveConfirmation,
    toggleHealth,
    tamperOneEntry,
    sweepTimeouts,
    pending,
    allConfirmations,
    plans,
    auditEntries,
    auditStatus,
    metricsSnapshot,
    isHealthy,
    tools,
    log,
    policyVersion: DEFAULT_POLICY.version,
  };
}
