# Thesis Validation Status

## Current verdict: PARTIALLY VALIDATED — random split only, five of six required splits not yet implemented

The repository no longer treats a plan-cache hit as a risk authorization. The current implementation always evaluates the exact request against current capability and risk state. Therefore the original thesis of reducing repeated **risk-classification** work through a cache is no longer an appropriate product claim.

The defensible optimization question is narrower:

> Can non-authorizing execution-plan metadata be reused for the same applicable plan scope without changing authorization correctness or increasing safety failures?

The registered independent benchmark (`RUN_LONG_EXPERIMENTS=1 npx vitest run src/guardruntime/__tests__/independent-generalization.test.ts`) has now been executed against the **random** split: 60,000 generated cases across 6 seeds, comparing cache-disabled and production-cache arms. Outcome statuses matched on all 60,000 cases, and zero invalid plan reuse was observed. See `experiments/results.json` for the raw numbers.

This is real evidence for the random split specifically, and should not be read as broader than that: `experiments/configs/config.json` declares six required generalization splits (random, template-held-out, policy-held-out, environment-held-out, compositional, temporal), and only the random one has an implementation in `independent-generalization.test.ts` today. The other five are configured but not coded. Until they exist, "generalizes" is not a supportable claim — only "held on the random split we ran."

Separately, the executed run's `cache_hits_total` was 0 by construction (each case uses a unique tenant to keep the decision-equivalence check clean of cross-case taint/budget contamination), so this run says nothing about cache-hit rate or the plan-preparation-work savings from actually reusing a cached plan across repeated goals. That remains a distinct, unmeasured claim.

## What changed from the previous thesis

The former implementation could cache a `RiskDecision`. That made optimization state part of the authorization path. This version removes that authority path.

The current cache contains execution metadata only. Every call performs:

- current capability authorization;
- current risk classification;
- current temporal state evaluation;
- current behavioral-drift evaluation;
- current cumulative-budget evaluation;
- current runtime-health gating;
- final capability/risk re-check immediately before side effect.

## Evidence status

| Claim                                       | Status                                                                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan cache can store execution metadata     | Implemented.                                                                                                                                                  |
| Cache hit can authorize an action           | **False by design.**                                                                                                                                          |
| Cache reduces ARC/risk-classification calls | **Not claimed; current design intentionally does not do this.**                                                                                               |
| Cache reduces plan-preparation work         | Plausible, but not yet independently measured.                                                                                                                |
| LLM inference-cost reduction                | Not measurable; no LLM classifier exists in this implementation.                                                                                              |
| Safety preserved under stale plan reuse     | Protected by design and regression tests; verified on the random split at n=60,000 with zero invalid reuse; the other five required splits remain unexecuted. |
| External benchmark result                   | Not claimed.                                                                                                                                                  |
| Regulatory certification                    | Not claimed.                                                                                                                                                  |

## Reproduction blocker

An earlier revision of this document reported that `npm ci --ignore-scripts` timed out twice and blocked the full test suite, build, lint, and long independent benchmark from running. That blocker is environment-specific and was not reproduced here: `npm install` completed in about 18 seconds, and the full `vitest` suite (26 files, 115 tests, 1 intentionally skipped without `RUN_LONG_EXPERIMENTS=1`) and the long 60,000-case benchmark both ran to completion. If you hit the install timeout again in your own environment, treat it as a local networking/registry issue, not evidence the suite itself is broken — this file previously conflated the two.

A dependency-free focused TypeScript compile of the authoritative runtime/security modules passes, independent of whether the full install succeeds.

The repository must not turn that static result into a claim broader than what was actually run — see the split-coverage caveat above.

## Registered independent benchmark

The existing independent test harness remains useful for regression checking, but its results are not treated as the authorization oracle. A future benchmark should compare no-cache execution-plan preparation with the production plan cache and a simple reference cache, while independently deriving authorization outcomes.

Required metrics:

- authorization correctness;
- oracle disagreement;
- unsafe stale reuse;
- cache hit/miss rate;
- plan-preparation work;
- latency distributions;
- memory behavior;
- complete failure records.

Synthetic workload results must remain labelled synthetic.

## Session note — 2026-08-26

A follow-up session attempted to continue the build-prompt phases (A, B,
C, D, E, F, G) but had no network access in its sandbox — `npm ci` failed
with `403 host_not_allowed`, so no dependency install, and therefore no
`vitest`/`tsc`/`eslint`/`build` run, was possible. This is specific to
that session's environment, not a reproduction of the earlier
"Reproduction blocker" section above, which recorded a _successful_
install in a different environment. Nothing in this file's evidence table
was re-run or changed as a result — the numbers above still reflect the
run described in "Reproduction blocker," not a new one. The only
concrete output from the follow-up session is `SPEC.md` and a draft,
unrun `docs/formal/GuardRuntime.tla` — see `CLAIMS_AUDIT.md`'s matching
session note for exactly what those are and are not.

## Limitations

The current repository uses in-memory stores. Atomic distributed idempotency, durable confirmations, policy publication and cross-process execution coordination are therefore not established.
