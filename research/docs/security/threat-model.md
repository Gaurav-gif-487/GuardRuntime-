# GuardRuntime Threat Model

## Security objective

Prevent an agent from causing a tool side effect unless the exact requested action is currently authorized, and ensure that a human approval cannot be replayed for a materially different action or authorization context.

## Assets

- Tenant isolation.
- Principal authorization state.
- Current policy and policy version.
- Capability manifests.
- Tool arguments and target resources.
- Pending human approvals.
- Execution side effects.
- Decision/audit traces.
- Idempotency state.
- Execution-plan metadata.

## Adversaries

- An untrusted or compromised agent.
- An agent attempting prompt injection through tool arguments.
- A tenant attempting cross-tenant access.
- A caller replaying or mutating an idempotency key.
- A caller replaying an old human approval.
- An attacker attempting stale-cache reuse after policy/capability/state changes.
- A caller supplying malformed object graphs or prototype-pollution payloads.
- A faulty classifier, policy service, state provider, cache, or tool implementation.
- Concurrent requests racing around approval and execution.

## Primary threats and controls

| Threat                         | Required control                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Unknown tool                   | Fail closed before execution.                                                                                         |
| Missing/unknown capability     | Deny by default.                                                                                                      |
| Invalid/ambiguous policy       | Reject policy; never silently choose an interpretation.                                                               |
| Stale authorization            | Recompute from current state immediately before side effect.                                                          |
| Cache poisoning/staleness      | Cache stores execution metadata only; cache failure is a miss; authorization never comes from cache.                  |
| Idempotency-key substitution   | Bind the key to an exact normalized action fingerprint.                                                               |
| Approval replay                | Bind approval to tenant, principal, action, policy and authorization-state fingerprint; revalidate on resume.         |
| Modified approved arguments    | Require a fingerprint for the modified reviewed action and revalidate it before execution.                            |
| Runtime failure                | Fail closed for high-impact actions; only explicit, narrow reversible-tool fail-open behavior may be used.            |
| Prototype pollution            | Recursive dangerous-key detection plus rejection of unexpected prototypes/circular graphs and detached normalization. |
| Prompt injection               | Human-review rendering treats arguments as untrusted data, never as instructions.                                     |
| Cross-tenant leakage           | Tenant-scoped storage and tenant-bound fingerprints.                                                                  |
| Concurrent duplicate execution | Idempotency state is checked before side effect; storage implementation must be atomic when distributed.              |
| Partial execution              | Tool-specific compensation/rollback must be explicit; no implicit compensation is assumed.                            |

## Residual distributed-systems risk

The current in-memory stores are not sufficient for a multi-process deployment. Atomic idempotency, durable confirmation state and policy/version publication require a transactional shared store if GuardRuntime is deployed across processes or machines. This is an architectural limitation, not evidence of a security guarantee.

## Cryptography decision

No cryptography is required merely to make an in-process authorization decision. Deterministic fingerprints plus server-side current-state revalidation are sufficient while all state and execution remain inside one trusted process.

If a decision or approval crosses an untrusted client/service boundary, the smallest justified addition is an authenticated, expiring, single-use envelope. Even then, a valid signature must never replace current authorization revalidation.
