# ADR-0006: Server-enforced feature flags for commercial activation

Status: Accepted
Date: 2026-08-08

## Context

Engineering may complete v1.5-v2.5 capabilities before commercial/legal/operational gates. UI-only or environment-only toggles are insufficient for per-tenant controlled activation.

## Decision

Use versioned server flags evaluated by environment, release, tenant, role and capability. Sensitive flags default off and require owner/expiry/reason. Flag decisions are audited and included in command/job authorisation. Client code may use evaluated flags for presentation but is never authoritative. A flag cannot bypass permissions, entitlement, privacy, evidence, conflict or readiness.

## Consequences

Every flagged path needs on/off tests and stale-cache-safe evaluation. Emergency disable is rapid and audited. Flag debt is reviewed each release; permanent policy becomes entitlement/config or code and the flag is retired.

## Rejected

Frontend toggles; code comments/manual instructions; flags that alter historical rule results or weaken invariants.
