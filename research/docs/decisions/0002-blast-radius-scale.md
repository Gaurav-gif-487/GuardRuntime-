# ADR 0002 — Blast radius is a log-scaled continuous signal

**Status:** accepted · **Applies to:** ARC (§2.1)

## Decision

`blast_radius ∈ [0,1]` is derived, in priority order, from:

1. a monetary magnitude field on the call (`log10(amount)/7`, so $10 ≈ 0.14,
   $10k ≈ 0.57, $10M ≈ 1.0),
2. a count of affected resources/users (`log10(count)/5`),
3. the tool author's static tier when no numeric signal is extractable.

When several signals exist, the maximum wins. Non-production environments are
scaled to 60% of the production value.

## Rationale

Consequence magnitude is perceived logarithmically, and a linear scale would
force every threshold to be retuned per tool. Taking the maximum across signals
keeps the classifier conservative when signals disagree.

## Consequences

Thresholds in policy config are comparable across tools. Tools with no
extractable signal fall back to author judgement, which is why an unregistered
tool is classified `destructive` with blast radius 1.
