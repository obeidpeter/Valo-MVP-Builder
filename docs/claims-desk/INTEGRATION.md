# Post-award Commercial & Claims Desk integration contract

Status: integration complete. API, direct-membership Workbench access, exact released-ledger exceptions, governed retention, OpenAPI, and generated clients are mounted or published.

## Runtime exports

- API route factory: `createClaimsDeskRouter` and default `claimsDeskRouter` from `artifacts/api-server/src/routes/claimsDesk.ts`.
- Production repository: `PostgresClaimsDeskRepository` and `postgresClaimsDeskRepository` from `artifacts/api-server/src/lib/claimsDesk/repository.ts`.
- Shared backend barrel: `artifacts/api-server/src/lib/claimsDesk/index.ts`.
- Workbench page default export: `artifacts/valo-workbench/src/pages/claims-desk.tsx`.
- Workbench component barrel: `artifacts/valo-workbench/src/components/claims-desk/index.ts`.

The API factory defaults to the real tenant-RLS Postgres repository. Repository injection exists only for deterministic route tests; production has no memory fallback.

## Completed shared integration

1. `artifacts/api-server/src/routes/index.ts` mounts `createClaimsDeskRouter()` after tenant context, tenant database, and resource-boundary guards.
2. `artifacts/valo-workbench/src/protected-routes.tsx` lazy-loads `/claims-desk` behind the dedicated `claims_desk` platform area.
3. Navigation and route access require direct membership plus `project:read`; the page requires `project:update` before rendering mutation controls and provides tenant-keyed project selection.
4. The consolidated OpenAPI publishes the Claims Desk operations and generated React/Zod clients. The page still validates runtime payloads before rendering them.

## Released-project immutability exception

The repository is event-sourced and performs only `INSERT` into the `[CLAIMS-DESK:*]` namespace. To keep it usable after sign-off/export, the shared immutable-project guard must add exactly the two exported exceptions from `CLAIMS_DESK_RELEASED_LEDGER_ROUTE_EXCEPTIONS`:

```text
POST ^/projects/[^/]+/claims-desk/records$
POST ^/projects/[^/]+/claims-desk/records/[^/]+/transitions$
```

No PATCH, PUT, DELETE, document, notice-dispatch, invoice or payment route is eligible. The exception is valid only for `signed_off` and `exported`; `archived` must remain terminal. The repository independently re-reads project status and rejects archived projects for reads and writes.

## Namespace and retention contract

- Durable rows use title prefix `[CLAIMS-DESK:` and a `valo.claims-desk-ledger/v1` JSON envelope.
- Project retention includes `like(workTasks.title, "[CLAIMS-DESK:%")` in the same `work_tasks` deletion transaction that purges `[OPS:*]`, client-action, retainer and consortium rows.
- The deletion certificate reports `claims_desk_events=<count>` separately while preserving the aggregate operations count.
- Claims Desk rows must not be independently deleted. Legal-hold/retention eligibility remains governed by the existing project retention transaction and immutable audit chain.
- The retention integration fixture proves `[CLAIMS-DESK:*]` rows remain when completion is blocked and are removed and counted when eligible project archival completes.

The exact exported selector is `CLAIMS_DESK_RETENTION_WORK_TASK_LIKE === "[CLAIMS-DESK:%"`.

## Security and authority boundary

- Read: direct active tenant membership and exact `project:read`.
- Manage: direct active tenant membership and exact `project:update`.
- The repository revalidates membership activity, tenant/project scope, canonical current document SHA-256, malware-clean and quarantine-cleared posture inside the write transaction.
- Creation and every transition are idempotent; transitions are CAS guarded by `If-Match`.
- Assessment and closure approvals enforce different maker/checker user IDs.
- Audit receipts contain IDs, versions, event kind, timestamp and digest only; references and raw document content are omitted.
- Amounts are non-negative safe integers in minor units paired with an active ISO 4217 code. They do not certify valuation or pricing.
- The feature cannot reach legal conclusions, certify entitlement/valuation, price work, dispatch notices, mutate invoices/payments, call providers, or act autonomously.

## Activation evidence required

- API and Workbench source/test typechecks green.
- Focused service, reducer, route, UI and static-security tests green.
- Shared tenancy tests cover both released exceptions plus archived/non-matching denial.
- Project retention integration test covers the namespace and certificate count.
- Browser test proves direct-membership read/manage gates, CAS conflict recovery, maker-checker denial, tenant switch isolation, canonical evidence rejection, signed-off/exported append and archived denial.
