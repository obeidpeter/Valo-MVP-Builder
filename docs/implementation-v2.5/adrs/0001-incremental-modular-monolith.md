# ADR-0001: Incremental TypeScript modular monolith

Status: Accepted
Date: 2026-08-08

## Context

The repository already contains a React/Vite workbench, Express API, Drizzle/PostgreSQL schema, OpenAPI-generated clients, deterministic helpers, reports and tests. The master prompt prefers preserving sound components and a modular monolith over premature services.

## Decision

Evolve the existing TypeScript monorepo into explicit domain modules and separate worker processes while retaining one deployable API codebase and one primary PostgreSQL system of record. Keep OpenAPI as the external contract. Workers share domain packages but interact through persistent jobs/outbox, not in-process callbacks.

## Consequences

Faster migration and lower operational burden; transactionally consistent gates remain simple. Module ownership and import rules must be enforced. Independent worker scaling is available. A future service split requires measured contention, isolation/regulatory need or independent ownership and a new ADR.

## Rejected

Wholesale rewrite (loses tested work and raises migration risk); microservices now (distributed failure/transactions without demonstrated need); frontend-only façade (cannot meet server/persistence invariants).
