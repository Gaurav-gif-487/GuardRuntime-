# GuardRuntime Baseline

## Scope

GuardRuntime is an in-process control boundary for agent-initiated tool actions. The authoritative product question is whether **this exact action, requested now, by this principal and tenant, under the current policy/capability/environment/runtime state, may execute automatically, requires human confirmation, or must be blocked**.

## Repository reality

- Archive revision: Git metadata is not present in the supplied ZIP, so no Git commit can be truthfully recorded.
- Host: Linux x86_64.
- Node available during audit: `v22.16.0`.
- TypeScript available globally: `5.8.3`.
- Lockfile SHA-256: `db5660258c0192b5175b32ba7a01fa7fad0e345ed8ab5fd48fce70fd45224d8a`.
- No `AGENTS.md` files were present in the archive.
- Package manager configuration uses the npm public registry.

## Execution attempts

| Command                         | Result                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `npm ci --ignore-scripts`       | Timed out twice before dependencies became available.                          |
| `npm test -- --run`             | Not executed because Vitest was unavailable without installed dependencies.    |
| `npm run build`                 | Not executed because dependencies were unavailable.                            |
| `npm run lint`                  | Not executed because dependencies were unavailable.                            |
| `tsc --noEmit`                  | Blocked by missing `vite/client` types.                                        |
| Focused core TypeScript compile | Passed after the security refactor using a temporary dependency-free tsconfig. |

No Vitest or benchmark result is claimed from the blocked commands.

## Trust boundaries

1. **Request boundary:** tenant, principal, tool, arguments, goal, permission scope and environment are untrusted input.
2. **Capability boundary:** the capability manifest authorizes which principal may invoke which tools/resources and limits blast/magnitude.
3. **Policy boundary:** the current policy determines risk thresholds and confirmation behavior.
4. **Runtime-state boundary:** health, temporal reversibility, behavioral drift, cumulative budget and information-flow state can change independently of a prior decision.
5. **Current resource/dependency-state boundary:** the application can provide a current state resolver and authorization check; failures fail closed.
6. **Plan-cache boundary:** the cache is an optimization store. It is not an authorization authority.
7. **Confirmation boundary:** a human approval is a durable, tenant-scoped record that must remain bound to the reviewed action and current authorization state.
8. **Execution boundary:** tool implementations are the only side-effecting boundary exposed by GuardRuntime.

## Important baseline flaws found

- The old idempotency path returned a previous outcome before checking whether the same idempotency key was being reused for a materially different action.
- The old runtime allowed an absent capability manifest to behave as if capability enforcement were not configured.
- The old plan cache could store and return a `RiskDecision`, allowing optimization state to become an authorization source.
- Confirmation records did not bind principal, permission scope, environment, action fingerprint and current authorization state strongly enough for safe resume.
- Caller-owned argument objects could reach tool implementations directly.
- Cache/classifier failures were not uniformly treated as explicit fail-closed outcomes.
- There was no mandatory final authorization re-check immediately before a side effect.

## Refactored authoritative flow

```text
request
  -> strict normalization/validation
  -> tenant-scoped idempotency conflict check
  -> current capability authorization
  -> current information-flow checks
  -> optional execution-plan lookup
  -> current risk classification
  -> current temporal/drift/budget state
  -> current runtime-health gate
  -> confirmation OR final authorization re-check
  -> constrained tool execution
  -> independent outcome verification
  -> audit/explanation
```

A plan-cache hit cannot skip current authorization or risk classification.
