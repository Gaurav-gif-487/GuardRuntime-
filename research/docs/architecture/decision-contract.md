# GuardRuntime Decision Contract

## Authoritative question

> Given this exact action, requested now, by this principal, in this tenant, under this policy, with this capability set, in this environment, and with this runtime/resource state: may the action execute automatically, must it wait for human confirmation, or must it be blocked?

## Decision inputs

| Field                             | Classification                 | Why it matters                                                             |
| --------------------------------- | ------------------------------ | -------------------------------------------------------------------------- |
| tenant                            | authorization-relevant         | Security boundary and state namespace.                                     |
| principal                         | authorization-relevant         | Identifies the actor.                                                      |
| tool                              | authorization-relevant         | Determines capability and risk semantics.                                  |
| normalized arguments              | authorization-relevant         | Determines exact target and blast/magnitude.                               |
| target/resource                   | authorization-relevant         | Determines capability/resource scope.                                      |
| permission scope                  | authorization-relevant         | Current authorization boundary.                                            |
| policy version/content            | authorization-relevant         | Determines decision rules.                                                 |
| capability manifest               | authorization-relevant         | Determines whether invocation is permitted.                                |
| environment                       | authorization-relevant         | Risk and state context.                                                    |
| runtime health                    | authorization-relevant         | Determines fail-safe behavior.                                             |
| temporal state                    | authorization-relevant         | Can change reversibility.                                                  |
| drift state                       | authorization-relevant         | Can impose confirmation/quarantine.                                        |
| cumulative budget/history         | authorization-relevant         | Can impose confirmation/deny.                                              |
| current resource/dependency state | authorization-relevant         | Application-supplied current state; resolution/check failure fails closed. |
| taint/flow state                  | authorization-relevant         | Can block unsafe data flows.                                               |
| confidence                        | authorization-relevant         | May only increase gating.                                                  |
| idempotency key                   | execution/idempotency-relevant | Prevents duplicate side effects; never grants authority.                   |
| audit trace ID                    | audit-only                     | Explains a decision after the fact.                                        |
| UI presentation metadata          | irrelevant metadata            | Must never affect authorization.                                           |

## Core types

### `NormalizedRequest`

A detached, validated representation of the incoming request. Caller-owned objects are never passed directly to a tool.

### `AuthorizationDecision`

Contains `allow`, `require_confirmation`, or `block`, reasons, policy version, state fingerprint, issuance/expiry timestamps, trace ID, and whether it is safe to execute immediately.

### `ExecutionPlan`

Contains tool-specific preparation metadata only. It contains no authority to execute.

### `ConfirmationRequest`

Binds tenant, principal, normalized action fingerprint, policy version, authorization-state fingerprint, expiration and authenticated approver identity. Modified arguments require a new reviewed fingerprint.

### `ExecutionOutcome`

Records whether the side effect executed, was blocked, failed, or is waiting for confirmation. Outcome verification is separate from authorization.

### `DecisionTrace`

Explains the current decision, including the rules and state that caused it.

## Cache contract

A plan-cache hit means only:

> "Previously prepared execution metadata appears applicable to this exact plan scope."

It does **not** mean:

> "The action is authorized."

Every call still performs current authorization and risk evaluation.

## Fail-closed contract

The following must not produce an authorization success:

- malformed input;
- unknown tool;
- absent/unknown capability;
- invalid or ambiguous policy;
- classifier failure;
- capability/state resolution failure;
- cache corruption/failure;
- unhealthy runtime for high-impact actions;
- stale or mismatched confirmation;
- changed authorization state.
