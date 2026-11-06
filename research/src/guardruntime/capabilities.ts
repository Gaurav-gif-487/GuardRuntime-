/**
 * Capability-Based Permission Model & Attenuation (Gap 2).
 *
 * Replaces security theater (informational `permissionScope` string) with
 * cryptographically signed or structurally checked capability manifests.
 *
 * Implements:
 * 1. CapabilityManifest — explicit authorization for tools, resources, and blast limits
 * 2. Pre-ARC Capability Gate — blocks unauthorized tools before ARC classification
 * 3. Monotonic Capability Attenuation — parent agents can only delegate a strict subset
 */

import type { ToolCall } from "./types";

export interface CapabilityManifest {
  principal: string;
  tenantId: string;
  allowedTools: string[];
  allowedResourceTypes: string[];
  maxPermittedBlastRadius: number;
  maxPermittedSingleMagnitude: number;
  allowSubDelegation: boolean;
  expiresAt?: number | undefined;
}

export interface CapabilityCheckResult {
  authorized: boolean;
  reason?: string;
  violationType?:
    | "tool_not_permitted"
    | "resource_not_permitted"
    | "blast_exceeded"
    | "magnitude_exceeded"
    | "expired";
}

export class CapabilityGate {
  private manifests = new Map<string, CapabilityManifest>();

  constructor(
    manifests: CapabilityManifest[] = [],
    private readonly clock: () => number = () => Date.now(),
  ) {
    for (const m of manifests) {
      this.registerManifest(m);
    }
  }

  private key(tenantId: string, principal: string): string {
    return `${tenantId}:${principal}`;
  }

  registerManifest(manifest: CapabilityManifest): void {
    if (!manifest || !manifest.tenantId || !manifest.principal)
      throw new Error("invalid capability manifest identity");
    if (!Array.isArray(manifest.allowedTools) || !Array.isArray(manifest.allowedResourceTypes))
      throw new Error("invalid capability manifest allowlists");
    if (
      !Number.isFinite(manifest.maxPermittedBlastRadius) ||
      manifest.maxPermittedBlastRadius < 0 ||
      manifest.maxPermittedBlastRadius > 1
    )
      throw new Error("invalid capability blast-radius limit");
    if (
      !Number.isFinite(manifest.maxPermittedSingleMagnitude) ||
      manifest.maxPermittedSingleMagnitude < 0
    )
      throw new Error("invalid capability magnitude limit");
    if (
      manifest.expiresAt !== undefined &&
      (!Number.isFinite(manifest.expiresAt) || manifest.expiresAt <= 0)
    )
      throw new Error("invalid capability expiry");
    this.manifests.set(this.key(manifest.tenantId, manifest.principal), structuredClone(manifest));
  }

  getManifest(tenantId: string, principal: string): CapabilityManifest | undefined {
    return this.manifests.get(this.key(tenantId, principal));
  }

  /**
   * Check if a proposed tool call is authorized by the principal's capability manifest.
   */
  check(call: ToolCall, resourceType: string, estimatedBlastRadius: number): CapabilityCheckResult {
    const manifest = this.getManifest(call.tenantId, call.principal);

    // If no manifest is registered, enforce principle of least agency (deny by default)
    if (!manifest) {
      return {
        authorized: false,
        reason: `Principal "${call.principal}" has no registered capability manifest`,
        violationType: "tool_not_permitted",
      };
    }

    const now = this.clock();
    if (manifest.expiresAt && now > manifest.expiresAt) {
      return {
        authorized: false,
        reason: `Capability manifest for "${call.principal}" expired at ${new Date(manifest.expiresAt).toISOString()}`,
        violationType: "expired",
      };
    }

    // 1. Tool authorization check
    if (!manifest.allowedTools.includes("*") && !manifest.allowedTools.includes(call.tool)) {
      return {
        authorized: false,
        reason: `Principal "${call.principal}" lacks capability to invoke tool "${call.tool}"`,
        violationType: "tool_not_permitted",
      };
    }

    // 2. Resource type authorization check
    if (
      !manifest.allowedResourceTypes.includes("*") &&
      !manifest.allowedResourceTypes.includes(resourceType)
    ) {
      return {
        authorized: false,
        reason: `Principal "${call.principal}" lacks capability on resource type "${resourceType}"`,
        violationType: "resource_not_permitted",
      };
    }

    // 3. Blast radius allowance check
    if (estimatedBlastRadius > manifest.maxPermittedBlastRadius) {
      return {
        authorized: false,
        reason: `Estimated blast radius (${estimatedBlastRadius.toFixed(2)}) exceeds principal's cap (${manifest.maxPermittedBlastRadius.toFixed(2)})`,
        violationType: "blast_exceeded",
      };
    }

    // 4. Magnitude limit check
    const magnitude = Number(call.args["amount_usd"] ?? call.args["magnitude"] ?? 0) || 0;
    if (magnitude > manifest.maxPermittedSingleMagnitude) {
      return {
        authorized: false,
        reason: `Single-call magnitude ($${magnitude}) exceeds principal's allowance ($${manifest.maxPermittedSingleMagnitude})`,
        violationType: "magnitude_exceeded",
      };
    }

    return { authorized: true };
  }

  /**
   * Monotonic Capability Attenuation:
   * Creates an attenuated child manifest that is guaranteed to be a strict subset
   * of the parent manifest (Principle of Attenuation).
   */
  attenuate(
    parentTenantId: string,
    parentPrincipal: string,
    childPrincipal: string,
    requestedSubset: Partial<CapabilityManifest>,
  ): CapabilityManifest {
    const parent = this.getManifest(parentTenantId, parentPrincipal);
    if (!parent) {
      throw new Error(
        `Parent principal "${parentPrincipal}" has no capability manifest to attenuate from`,
      );
    }
    if (!parent.allowSubDelegation) {
      throw new Error(
        `Parent principal "${parentPrincipal}" is not permitted to delegate capabilities`,
      );
    }

    // Intersect allowed tools
    const allowedTools = requestedSubset.allowedTools
      ? requestedSubset.allowedTools.filter(
          (t) => parent.allowedTools.includes("*") || parent.allowedTools.includes(t),
        )
      : parent.allowedTools;

    // Intersect resource types
    const allowedResourceTypes = requestedSubset.allowedResourceTypes
      ? requestedSubset.allowedResourceTypes.filter(
          (r) =>
            parent.allowedResourceTypes.includes("*") || parent.allowedResourceTypes.includes(r),
        )
      : parent.allowedResourceTypes;

    // Strict min for thresholds
    const maxPermittedBlastRadius = Math.min(
      parent.maxPermittedBlastRadius,
      requestedSubset.maxPermittedBlastRadius ?? parent.maxPermittedBlastRadius,
    );

    const maxPermittedSingleMagnitude = Math.min(
      parent.maxPermittedSingleMagnitude,
      requestedSubset.maxPermittedSingleMagnitude ?? parent.maxPermittedSingleMagnitude,
    );

    const expiresAt = Math.min(
      parent.expiresAt ?? Infinity,
      requestedSubset.expiresAt ?? parent.expiresAt ?? Infinity,
    );

    const childManifest: CapabilityManifest = {
      principal: childPrincipal,
      tenantId: parentTenantId,
      allowedTools,
      allowedResourceTypes,
      maxPermittedBlastRadius,
      maxPermittedSingleMagnitude,
      allowSubDelegation: false, // Child cannot sub-delegate by default
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined,
    };

    this.registerManifest(childManifest);
    return childManifest;
  }
}
