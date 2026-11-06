# GuardRuntime — Integrator's Guide & Deployment Manual

> **Pilot Status**: *Pilot-ready; no external pilot conducted yet.*
> **Specification Version**: v0.1
> **Target Runtime**: Node.js 18+ / TypeScript / Containerized Microservices

---

## 1. Quick Integration Overview
GuardRuntime is an authoritative 11-stage authorization and execution boundary for autonomous AI agents. It intercepts tool calls (via MCP JSON-RPC 2.0 or direct HTTP/SDK calls) and enforces 7 mathematical invariants before actions hit real infrastructure.

```
Agent Planner (LLM) ──[MCP Tool Call]──> GuardRuntime Boundary ──[Authorized Execution]──> Infrastructure
```

---

## 2. Minimal API Surface

### A. MCP (Model Context Protocol) JSON-RPC 2.0 Endpoint
- **URL**: `POST /api/mcp/gateway`
- **Headers**: `Content-Type: application/json`
- **Request Body**: Standard JSON-RPC 2.0 tool invocation:
```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "method": "tools/call",
  "params": {
    "name": "infra.getMetrics",
    "arguments": { "cluster": "prod-us-east" }
  }
}
```
- **Response**:
```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "result": {
    "content": [{ "type": "text", "text": "{\"status\":\"success\",\"metrics\":{...}}" }],
    "isError": false,
    "guardRuntime": {
      "verdict": "ALLOW",
      "decisionId": "dec-1740590000000-abcd",
      "auditHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    }
  }
}
```

### B. Direct Pipeline HTTP Evaluation
- **URL**: `POST /api/pipeline/evaluate`
- **Payload**:
```json
{
  "action": {
    "id": "act-101",
    "toolName": "infra.deploy",
    "actionType": "WRITE",
    "parameters": { "environment": "staging", "service": "auth-api" },
    "timestamp": 1740590000000
  },
  "principal": {
    "id": "agent-devops-01",
    "tenantId": "tenant-acme-prod",
    "capabilities": ["infra:deploy:*"]
  },
  "confirmationTokenId": "tok-approved-uuid-or-null"
}
```

---

## 3. Declarative Policy Configuration
Policies can be loaded as JSON documents without recompiling TypeScript code:

```json
{
  "version": "guardruntime.policy.v1",
  "id": "prod-secops-policy",
  "name": "Production SecOps Policy",
  "tenantId": "tenant-acme-prod",
  "budgetLimits": {
    "maxHourlyActions": 100,
    "maxHourlySpendUsd": 5000
  },
  "rules": [
    {
      "id": "rule-allow-metrics",
      "name": "Allow Read Metrics",
      "effect": "ALLOW",
      "matchToolNames": ["infra.getMetrics", "infra.listPods"],
      "priority": 10
    },
    {
      "id": "rule-confirm-deploy",
      "name": "Require Confirmation for Staging Deploy",
      "effect": "CONFIRM",
      "matchToolNames": ["infra.deploy"],
      "conditions": [
        { "field": "parameters.environment", "operator": "EQUALS", "value": "staging" }
      ],
      "priority": 20
    },
    {
      "id": "rule-deny-shell",
      "name": "Strictly Deny Shell and Deletions",
      "effect": "DENY",
      "matchToolNames": ["system.executeCommand", "fs.deleteFile"],
      "priority": 99
    }
  ]
}
```

---

## 4. Operational Invariants & Behavior Guide

| Invariant | System Behavior | Integrator Guidance |
|---|---|---|
| **Fail-Closed (INV-5)** | When system health is degraded, all non-trivial actions return `BLOCK`. | Monitor `/api/health`. Ensure health checks keep nodes in `HEALTHY` state. |
| **Non-Authorizing Cache (INV-3)** | Cache hits accelerate preparation templates only; policies are always re-evaluated fresh. | You can safely enable plan caching without risk of stale privilege escalation. |
| **Single-Use Approvals (INV-6)** | Human approval tokens expire immediately upon consumption and cannot be transferred across mutated action parameters. | Always generate a fresh approval token per action fingerprint. |
| **Tamper-Evident Ledger (INV-7)** | Every decision produces a SHA-256 Merkle-linked block. | Periodically audit chain integrity via `GET /api/audit/chain`. |

---

## 5. Known Limitations & Runtime Constraints
1. **Single-Node In-Memory State**: The default implementation uses an in-memory budget and audit ledger. For distributed deployments across multiple nodes, configure an external Redis or PostgreSQL persistence provider.
2. **Bounded Model Check Scope**: Formal properties are verified across a 64-state discrete state-space bound ($704$ transitions). Continuous parameter space induction is not formally proven.
3. **Execution Sink Sandboxing**: The default dry-run engine validates schema and simulates execution. Integrators must provide containerized (gVisor/Firecracker) or locked-down RPC sinks for live execution.
