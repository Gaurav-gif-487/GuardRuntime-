# ADR 0006 — No self-reported or fabricated outcome verification

**Status:** accepted · **Applies to:** PCR / runtime

Production reliability requires an independently supplied outcome verifier. GuardRuntime no longer treats `{ ok: true }` fabricated by the runtime as proof of successful execution. If no verifier is configured, the execution may complete but its result is not counted toward cache reliability. The synthetic evaluation harness supplies an explicitly labelled verifier solely for its controlled test environment.
