# ADR 0007 — Tool execution must be supplied by the integrator

**Status:** accepted · **Applies to:** runtime

GuardRuntime is middleware, not a tool implementation registry. It must not fabricate successful tool results when a tool implementation is absent. A production runtime therefore requires either a registered per-tool implementation or a supplied executor callback; otherwise the call is blocked with an explicit implementation-missing reason. The evaluation harness supplies a synthetic executor and labels it as such.
