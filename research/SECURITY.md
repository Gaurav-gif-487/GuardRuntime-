# Security

## Security posture

GuardRuntime follows a deny-by-default authorization model for agent tool actions.

The runtime treats:

- capability state as authorization;
- policy and runtime state as current decision inputs;
- confirmations as bound, expiring approvals;
- plan caches as non-authorizing optimization state.

## Important limitation

The supplied implementation uses in-memory stores. It is therefore suitable for a single trusted process or as a reference implementation, not as proof of safe distributed deployment. A distributed deployment needs atomic shared persistence for idempotency, confirmations, policy publication and execution coordination.

## Reporting

Do not interpret repository tests, self-assessment reports, synthetic evaluations, or documentation as legal certification, external security certification, or measured LLM cost reduction.

Security-sensitive changes should include a regression test and a clear explanation of the affected authorization state.
