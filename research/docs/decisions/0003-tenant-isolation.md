# ADR 0003 — Tenant isolation is structural, not a query filter

**Status:** accepted · **Applies to:** storage layer (§4)

## Decision

All tenant-scoped state (plan cache, confirmations, idempotency records, audit
chain) lives behind `TenantScopedStore`. Callers obtain a `TenantNamespace` and
can only read or write inside it. There is no API that accepts a tenant id as
an optional filter, so "forgetting the WHERE clause" is not expressible.

The audit log keeps a separate hash chain per tenant, which also means one
tenant's tamper check cannot be affected by another's writes.

## Rationale

Isolation enforced by convention fails on the first developer who writes a new
query. Making the unscoped query unrepresentable in the type system moves the
failure from runtime data leak to compile error.

## Consequences

Cross-tenant analytics must be built by explicitly iterating tenants — this is
intentional friction. Backing this with real Postgres means one schema (or RLS
policy) per tenant behind the same namespace API.
