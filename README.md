# GuardRuntime

An authorization-and-execution boundary for agent-initiated tool actions: given a specific action, principal, tenant and policy, decide whether it runs automatically, waits for human confirmation, or is blocked.

This repository has two npm workspaces:

| Directory | What it is |
|---|---|
| [`research/`](research) | The core library (TypeScript), tests, benchmark scripts, specs, ADRs and the TLA+ model. See its [README](research/README.md). |
| [`demo-app/`](demo-app) | A React + Express app that exercises the runtime: pipeline visualizer, MCP gateway simulation, generalization and cache benchmarks, conformance suite. |

## Quick start

```bash
npm install
npm test                           # research test suite (vitest)
npm run lint                       # research lint
npm run build                      # research build
npm run dev --workspace demo-app   # demo app on http://localhost:3000
```

Requires Node.js 20 or newer.

## Formal model

`research/docs/formal/GuardRuntime.tla` models the core invariants. The full model has a very large state space and has not been run to completion; do not cite it as formally verified. `research/scripts/run-formal-verification.sh` runs TLC (Java required) and is available as a manually triggered workflow.

## Status

Research prototype. Storage is in-memory, and the benchmarks run on synthetic tasks. Nothing here is certified or audited for production use.
