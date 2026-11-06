# GuardRuntime Architecture

GuardRuntime is a small authorization-and-execution boundary for agent tool calls.

## Authoritative path

`request -> normalize -> capability -> policy/risk -> current state -> confirmation or final recheck -> execute -> verify -> explain`

The path is intentionally explicit. The plan cache is off to the side and may only supply execution metadata.

## Modules

- `runtime.ts` — authoritative control boundary.
- `arc.ts` — deterministic risk classification.
- `capabilities.ts` — principal capability authorization.
- `cm.ts` — durable confirmation state machine.
- `schema-validator.ts` — untrusted input normalization/validation.
- `pcr.ts` — non-authorizing execution-plan cache.
- `decision-trace.ts` — post-hoc explanation.
- `audit.ts` — append-only evidence trail.
- `store.ts` — tenant-partitioned in-memory state for the current single-process implementation.

Other modules are optional integrations or experimental evaluators. They are not alternative authorization authorities.

## Design rule

If a reviewer cannot determine from `runtime.ts` where execution becomes authorized, the architecture has failed review.
