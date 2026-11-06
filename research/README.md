# GuardRuntime

GuardRuntime is an authorization-and-execution boundary for agent-initiated tool actions.

Its core question is deliberately narrow:

> Given this exact action, requested now, by this principal, in this tenant, under the current policy, capability set, environment and runtime state, should it execute automatically, wait for human confirmation, or be blocked?

## Security model

The authoritative flow is:

```text
request
  -> strict normalization
  -> tenant/idempotency checks
  -> capability authorization
  -> information-flow checks
  -> optional execution-plan lookup
  -> current risk classification
  -> temporal/drift/budget state
  -> runtime health gate
  -> confirmation OR final authorization re-check
  -> tool execution
  -> independent outcome verification
  -> audit/explanation
```

### Important invariant

**A cached plan is never an authorization grant.**

The plan cache can reuse execution metadata, but every request still performs current capability authorization and risk classification. A cache hit therefore cannot make an otherwise unauthorized action executable.

## Fail-closed behavior

The runtime denies or blocks when it cannot safely establish authorization, including:

- unknown tools;
- absent or expired capabilities;
- malformed/ambiguous policies;
- invalid input;
- classifier failures;
- capability/state resolution failures;
- stale or mismatched human approvals;
- corrupted cache entries;
- unhealthy runtime state for high-impact actions.

Only explicitly configured reversible-tool fail-open behavior is permitted, and it does not bypass capability or policy checks.

## Human confirmation

Confirmation records are bound to the tenant, principal, exact normalized action, policy version and authorization-state fingerprint. On resume the runtime revalidates the current authorization state. Changing a meaningful field, policy, capability or state invalidates the approval.

## Input handling

Tool arguments are recursively checked for dangerous keys, circular structures and unexpected prototypes. Valid arguments are detached into a normalized copy before they reach a tool implementation.

## Plan cache

The cache stores execution-plan metadata such as preparation steps, scope and reliability information. It does **not** authorize execution and does not replace risk classification.

This means the defensible optimization claim is limited to measured reductions in repeated **plan-preparation work**. The repository contains no LLM invocation or LLM token-cost measurement, so it makes no LLM inference-cost claim.

## Evidence and benchmarks

The repository contains unit/property tests and an independent benchmark harness. Synthetic evaluations are labelled as synthetic. They are not external benchmark results.

```bash
npm ci
npm test          # vitest run
npm run lint
npm run build
```

Current status: 30 test files, 134 tests passing (2 long-running tests are skipped by default; set `RUN_LONG_EXPERIMENTS=1` to run the 60,000-case independent generalization benchmark, whose results are in `experiments/results.json`). `npm run lint` reports warnings only, and `npm run build` succeeds.

## Scope limitation

The current storage implementation is in-memory and tenant-partitioned. It is not a distributed transaction system. A production multi-process deployment requires atomic shared persistence for idempotency, confirmation state, policy publication and execution coordination.

## Compliance

`compliance-evidence.ts` produces internal implementation evidence mappings only. It is not legal advice, accreditation, certification, or proof of compliance with any regulatory framework.
