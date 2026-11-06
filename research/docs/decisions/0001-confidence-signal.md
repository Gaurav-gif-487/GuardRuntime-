# ADR 0001 — Confidence signal is an optional safety ratchet

**Status:** accepted · **Applies to:** ARC (§2.1)

## Decision

ARC produces a complete, correct decision from `reversibility × blast_radius`
alone. When an agent confidence signal is supplied it may only _raise_ severity
and _add_ confirmations. It can never suppress a confirmation that the two
primary axes already require.

## Rationale

Most wrapped agents expose either no log-probs or uncalibrated ones. A signal
that can suppress confirmations converts an unvalidated model artefact into a
safety control. Making the modifier one-directional means a badly calibrated
confidence source degrades UX (more confirmations) rather than safety.

## Consequences

- `confidence_model_version` is stamped on every decision that used the signal,
  so a later audit can isolate decisions made under a specific model.
- Before confidence is allowed to _reduce_ friction in any future version, it
  must be empirically validated against an eval set and that validation logged.
