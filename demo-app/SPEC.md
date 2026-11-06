# GuardRuntime Protocol Specification (v0.1)

## 1. Scope & Architecture
GuardRuntime sits between an agentic reasoning loop (LLM, planner) and tool execution sinks (operating system, cloud APIs, databases).

```
[Agent Reasoning Loop] 
         │ (MCP / JSON-RPC Tool Call)
         ▼
[GuardRuntime 11-Stage Authoritative Boundary]
   1. Normalization & Fingerprinting
   2. Capability Authorization
   3. Information-Flow / Taint Gate
   4. Execution-Plan Lookup (Non-Authorizing Cache)
   5. Current Risk Classification & Policy Evaluation
   6. Temporal / Drift / Budget Gate
   7. Runtime-Health Gate (Fail-Closed)
   8. Confirmation or Final Re-Check
   9. Constrained Execution (Sandboxed Dry-Run / Container)
  10. Independent Outcome Verification
  11. Audit / Cryptographic Hash-Chain
         │
         ▼
[Tool Execution Sink / Real Infrastructure]
```

## 2. Invariant Reconciliation
The 7 invariants (`INV-1` through `INV-7`) defined in `invariants.ts` and `tla-spec.ts` map 1-to-1 to the 7 falsifiable properties in `THESIS.md`:
- `INV-1`: No Stale Execution $\leftrightarrow$ Property 1
- `INV-2`: Invalidation on Meaningful Change $\leftrightarrow$ Property 2
- `INV-3`: Cache is Non-Authorizing $\leftrightarrow$ Property 3
- `INV-4`: High-Impact Actions Cannot Be Cache-Shortcut $\leftrightarrow$ Property 4
- `INV-5`: Fail Closed under Degraded Health $\leftrightarrow$ Property 5
- `INV-6`: No Approval Replay $\leftrightarrow$ Property 6
- `INV-7`: Explainability & Independent Verification $\leftrightarrow$ Property 7

## 3. Data Formats
- `ToolAction`: `{ id, toolName, actionType, parameters, taintTags, timestamp, nonce }`
- `DecisionTrace`: Complete execution trace containing all 11 stage results, computed risk vector, cryptographic fingerprint, audit block hash, and invariant checks.
- `AuditBlock`: Append-only Merkle-linked block with SHA-256 parent hash and PCR register state.
