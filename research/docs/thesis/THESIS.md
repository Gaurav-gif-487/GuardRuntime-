# GuardRuntime: Current Engineering Thesis

## Abstract

GuardRuntime is an authorization-and-execution boundary for agent-initiated tool actions. Its central design claim is intentionally narrow: **authorization must be derived from the exact current action and current authorization state, while execution-plan optimization must remain non-authorizing.**

The repository therefore treats plan caching as a secondary optimization. A cached plan may contain preparation metadata and reliability information, but it cannot supply a risk decision or permission to execute. Every request re-runs capability authorization and current risk classification, and a final authorization check is performed immediately before the side effect.

This is an implementation thesis, not a claim of external validation. The repository does not invoke an LLM for risk classification, so it does not measure LLM inference cost. Synthetic benchmark adapters are internal regression tools, not external benchmark results. Internal compliance evidence is not legal certification.

## Falsifiable engineering properties

1. An action cannot execute without current authorization.
2. Changing a meaningful authorization input invalidates the previous action/approval identity.
3. A plan-cache hit cannot change an authorization result.
4. High-impact actions require deliberate policy handling and do not become automatically executable through cache reuse.
5. Authorization failures fail closed.
6. Human approval cannot be replayed for a changed action or changed authorization state.
7. Security-significant decisions are explainable from recorded state and reasons.

## Formal-to-executable invariant mapping

The seven thesis properties and the executable `INV-1`..`INV-7` checks are **not the same numbered list**. The thesis properties describe the authorization architecture; `invariants.ts` contains complementary runtime/audit checks. The mapping is:

| Thesis property                                               | Formal model                                                 | Executable/runtime evidence                                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 1. Exact action cannot execute without current authorization  | `CurrentAuthorizationAtExecution`                            | `runtime.ts` final capability/current-state/risk re-checks                                                                      |
| 2. Meaningful authorization change invalidates prior approval | `MeaningfulChangeInvalidatesApproval`                        | `cm.ts` + `resumeInternal()` fingerprint/epoch-equivalent state revalidation                                                    |
| 3. Cache hit cannot change authorization                      | `CacheHitNeverGrantsAuthorization`                           | `runtime.ts` always re-runs current ARC/capability checks; cache stores execution metadata                                      |
| 4. High-impact actions require deliberate handling            | `HighImpactActionsRequireConfirmation`                       | `runtime.ts`/`arc.ts` destructive and high-risk confirmation gates                                                              |
| 5. Authorization failures fail closed                         | `NoExecutionWhenUnhealthyWithoutConfirmation` (finite model) | `INV-6` + fail-closed branches in `runtime.ts`; the explicit reversible fail-open exception is a documented implementation path |
| 6. Human approval cannot be replayed after material change    | `StaleApprovalCannotReplay`                                  | `cm.ts` action/state fingerprints and `resumeInternal()` revalidation                                                           |
| 7. Security-significant decisions are explainable             | `SecuritySignificantDecisionsExplainable` (finite model)     | `decision-trace.ts`, audit payloads, and `INV-7` independent outcome verification                                               |

The separately numbered executable checks are:

- `INV-1`: confidence monotonicity;
- `INV-2`: destructive actions always require confirmation;
- `INV-3`: tenant isolation;
- `INV-4`: audit hash-chain integrity;
- `INV-5`: idempotency;
- `INV-6`: fail-closed default;
- `INV-7`: independent outcome verification.

They intentionally overlap the thesis where useful, but they are not a second statement of the seven thesis properties. A green `INV-*` report therefore must not be described as having verified all seven thesis properties.

## Architecture

```text
normalize
  -> capability authorization
  -> information-flow gate
  -> execution-plan lookup (optional, non-authorizing)
  -> current risk classification
  -> temporal/drift/budget state
  -> runtime-health gate
  -> confirmation OR final re-check
  -> constrained execution
  -> independent outcome verification
  -> audit/explanation
```

## Cache interpretation

The old thesis treated cache reuse as a way to reduce repeated risk-classification calls. That design was rejected because it allowed cached authorization state to become stale relative to policy, capability and runtime state.

The current design deliberately pays the cost of current authorization and risk evaluation. The cache may reduce plan-preparation work only.

Any future optimization that attempts to cache authorization itself must prove a complete validity key and invalidation protocol for every authorization-relevant input, plus a safe failure mode. It is not part of the current authorization path.

## Evidence boundary

The repository distinguishes:

- **measured evidence** — produced only by commands that actually executed;
- **implementation behavior** — established by code/tests/static inspection;
- **hypotheses** — ideas registered for future experiments;
- **limitations** — facts that prevent stronger conclusions.

The repository distinguishes source-level implementation evidence from executed evidence. Results are only reported when the corresponding command was actually run.
