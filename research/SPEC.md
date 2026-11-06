# The GuardRuntime Authorization Protocol — Spec v0.1

**Status: first draft, unadopted.** This document is extracted from a single
TypeScript implementation (this repository). No other codebase implements it
yet, and no external party has adopted, reviewed, or endorsed it. Nothing
below should be read as "used by X" or "industry standard" — it is a
proposal for what a _different_ codebase would need to do to make the same
falsifiable claims this repository makes.

This spec was written by static reading of the implementation and its
existing docs (`THESIS.md`, `ARCHITECTURE.md`). It has not itself been re-implemented against or tested in a second
system. Treat every requirement below as **implementation behavior /
design intent**, not as measured or formally verified, unless a specific
section says otherwise.

---

## 1. Scope

This spec defines what it means for a system to be a "GuardRuntime-class"
authorization-and-execution boundary for agent-initiated tool actions. It
covers:

- the authoritative decision pipeline a conforming implementation must have,
- the seven falsifiable properties such an implementation must satisfy,
- what is a spec-level requirement vs. an implementation choice specific to
  this repository's TypeScript version.

It does not cover UI, transport protocol, storage engine choice, or
language/runtime — those are implementation choices.

## 2. Core question

A conforming implementation answers exactly one question per incoming tool
call, using only current state:

> Given this exact action, requested now, by this principal, in this
> tenant, under the current policy, capability set, environment and runtime
> state, should it execute automatically, wait for human confirmation, or be
> blocked?

The word "current" is load-bearing. A conforming implementation is
forbidden from answering this question using a cached or stale
authorization result — see Property 3 below.

## 3. Required pipeline shape

A conforming implementation MUST have a decision path that includes, in
this order, the following stages. Stage _names_ are not required to match;
stage _presence and ordering_ is.

1. **Normalize** — untrusted input is validated and converted into a
   canonical internal representation before any authorization decision
   touches it.
2. **Capability authorization** — the principal's current capability grant
   is checked against the normalized action. This must be re-derived from
   current capability state, not read from a cache.
3. **Information-flow gate** (if the implementation tracks data
   provenance/taint) — checked before any cached artifact is consulted.
4. **Execution-plan lookup** — OPTIONAL. If present, this stage may only
   supply preparation metadata (e.g. a previously computed plan shape,
   step ordering, scope hints). It MUST NOT supply or influence the
   authorization result itself. This is the spec's central non-negotiable
   boundary; see Property 3.
5. **Current risk classification** — a fresh classification of the
   action's risk (e.g. reversibility, blast radius) computed from the
   current action and current inputs, never taken from a cache or from the
   plan lookup in step 4.
6. **Temporal/drift/budget state** — any time-, rate-, or budget-based
   checks are evaluated against current state at decision time.
7. **Runtime-health gate** — if the implementation's own health/liveness
   state is degraded, the default resolution for anything above a
   spec-defined "trivially reversible" threshold is block, not execute
   (Property 5).
8. **Confirmation OR final re-check** — either a human confirmation is
   required and obtained, bound to the exact action and authorization-state
   fingerprint at request time (Property 6), or, for a previously-approved
   resumed action, a final re-check re-validates that fingerprint against
   current state before execution.
9. **Constrained execution** — the tool call executes only after every
   preceding gate has passed for the _current_ state.
10. **Independent outcome verification** — the result is checked by a
    source independent of the acting agent (Property 7's related
    requirement — see note in Section 4).
11. **Audit / explanation** — the decision, its inputs, and its reasoning
    are recorded in an append-only, security-significant log.

## 4. The seven falsifiable properties

These are reproduced verbatim from `docs/thesis/THESIS.md` in this
repository. A conforming implementation must satisfy all seven. Each is
stated here as a spec-level requirement; how a given codebase satisfies it
is an implementation choice.

1. **No stale execution.** An action cannot execute without current
   authorization.
2. **Invalidation on meaningful change.** Changing a meaningful
   authorization input invalidates the previous action/approval identity.
3. **Cache is non-authorizing.** A plan-cache hit cannot change an
   authorization result.
4. **High-impact actions cannot be cache-shortcut.** High-impact actions
   require deliberate policy handling and do not become automatically
   executable through cache reuse.
5. **Fail closed.** Authorization failures fail closed.
6. **No approval replay.** Human approval cannot be replayed for a changed
   action or changed authorization state.
7. **Explainability.** Security-significant decisions are explainable from
   recorded state and reasons.

### Note on independent verification

The pipeline stage in Section 3.10 (independent outcome verification) is
related to, but distinct from, Property 7. Property 7 is about explaining
_decisions_; independent verification is about not trusting the _acting
agent's own self-report_ of task success. This repository's
`invariants.ts` treats independent verification as an eighth executable
check (`INV-7`) alongside a differently-numbered set of seven runtime
invariants (`INV-1`..`INV-7`) that do not map one-to-one onto the seven
THESIS.md properties above. A future revision of this spec should either
reconcile these two "seven property" lists or explicitly document why they
differ — that reconciliation has not been done as part of this draft.

## 5. Spec-level requirement vs. implementation detail

| Requirement                                                                                                                   | Spec-level, or implementation detail?                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization must be derived from current, not cached, state                                                                 | **Spec-level.** Any conforming system must satisfy this.                                                                                                                                                                                    |
| The plan cache may only carry preparation metadata, never a risk/authorization verdict                                        | **Spec-level.**                                                                                                                                                                                                                             |
| Confirmations are bound to a fingerprint of (tenant, principal, exact normalized action, policy version, authorization-state) | **Spec-level requirement on binding semantics.** The specific hash/fingerprint algorithm is an implementation detail.                                                                                                                       |
| Fail-closed default under degraded runtime health                                                                             | **Spec-level**, with the exact health-check mechanism left to the implementation.                                                                                                                                                           |
| In-memory store for state (capabilities, confirmations, audit, cache)                                                         | **Implementation detail**, specific to this repository's reference implementation. A conforming system could use a distributed/durable store instead, provided it still satisfies atomicity requirements implied by Properties 1, 3, and 6. |
| Hand-rolled SHA-256 for audit hash-chaining                                                                                   | **Implementation detail.** Any collision-resistant hash chain satisfies the spec-level append-only/tamper-evidence requirement.                                                                                                             |
| TypeScript, Vitest, the specific module names (`runtime.ts`, `arc.ts`, etc.)                                                  | **Implementation detail**, specific to this repository.                                                                                                                                                                                     |
| LTL/TLA+ formalization of the seven properties                                                                                | **Not required by this spec.** It is one way (used in this repository, see `docs/formal/`) to gain confidence in properties 1–7, not a spec requirement itself.                                                                             |

## 6. Explicit non-claims of this spec

- This spec does not claim to be adopted by any project other than this
  repository's own reference implementation.
- This spec does not claim external review, standardization-body status,
  or community consensus. It is a first draft.
- This spec does not claim that satisfying it produces any particular
  latency, throughput, or LLM-inference-cost outcome. Those are
  implementation- and workload-dependent and out of scope.
- This spec does not claim legal or regulatory compliance for any
  jurisdiction.

## 7. Open questions for a v0.2

- Reconciling the `THESIS.md` seven properties with `invariants.ts`'s
  `INV-1`..`INV-7` naming (Section 4 note above).
- Whether Property 4 ("high-impact actions... require deliberate policy
  handling") needs a more precise, testable definition of "high-impact"
  that a second implementation could check against, versus this
  repository's specific reversibility/blast-radius thresholds.
- Whether a distributed conforming implementation needs additional
  spec-level requirements beyond what a single-process implementation
  needs (e.g. cross-node confirmation-fingerprint consistency), since this
  repository's own docs (`SECURITY.md`) flag in-memory storage as a
  single-process limitation, not something this spec currently addresses.
