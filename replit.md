# Valo Nigeria v2.5 candidate

Valo is an internal bid-compliance workbench for tender intake, reviewer-confirmed requirements, evidence and defect review, exact-kobo BOQ checks, submission-readiness gates, and signed report/package export. The v2.5 candidate adds organisation tenancy, scoped permissions, PostgreSQL row-level-security (RLS) foundations, role-specific UI surfaces, and commercial feature gates. It remains a pre-production candidate; source presence and a successful Replit preview are not production acceptance.

## Runtime and Replit workflows

- Supported runtime: Node.js 22 through 24 and pnpm 10.34.0. Replit selects Node.js 24 in `.replit`; CI validates Node.js 22.
- Replit's **Project** workflow runs the API on port 5000 and the Vite workbench on port 3000, proxying `/api` to the API.
- API liveness is `GET /api/healthz`. It proves only that the process can answer; it does not prove database, storage, identity-provider, model-provider, RLS, or migration readiness.
- Production builds are `pnpm --filter @workspace/api-server build` and `PORT=3000 BASE_PATH=/ pnpm --filter @workspace/valo-workbench build`. Start the compiled API with `PORT=<assigned-port> NODE_ENV=production pnpm --filter @workspace/api-server start`; serve `artifacts/valo-workbench/dist/public` as the web artefact.

Useful local/Replit checks:

```sh
pnpm install --frozen-lockfile
pnpm run lint
pnpm run verify:release-config
pnpm run typecheck
pnpm --filter @workspace/db migration:check
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/valo-workbench test
pnpm --filter @workspace/api-server prove:doctrine:offline
pnpm --filter @workspace/api-server prove:injection:offline
pnpm --filter @workspace/api-server eval:harness:offline
pnpm run build
```

Live model/prompt changes also require `pnpm --filter @workspace/api-server prove:ship` in the approved Replit environment. Offline proofs do not replace that gate.

## Required deployment configuration

Keep secrets in Replit Secrets, never in source or build logs. At minimum, configure and verify:

- `DATABASE_URL` for PostgreSQL.
- `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and build-time `VITE_CLERK_PUBLISHABLE_KEY` (plus `VITE_CLERK_PROXY_URL` when the deployment uses the Clerk proxy URL explicitly).
- `CORS_ALLOWED_ORIGINS` as an exact comma-separated allowlist of deployed web origins; `*` is deliberately rejected. Set `TRUST_PROXY=1` only behind Replit's trusted proxy.
- `AI_INTEGRATIONS_OPENAI_API_KEY` and `AI_INTEGRATIONS_OPENAI_BASE_URL` where the model adapter is used. `OPENAI_ADAPTER_PRODUCTION_APPROVED=true` is an explicit approval attestation, not a substitute for provider-health and live proof evidence.
- Replit Object Storage configuration, including `PRIVATE_OBJECT_DIR` and any intentional `PUBLIC_OBJECT_SEARCH_PATHS`. Tender and bid content belongs in private tenant-prefixed paths.
- `VALO_BOOTSTRAP_CLERK_USER_IDS` and/or `VALO_BOOTSTRAP_EMAILS` only for explicitly approved initial restricted administrators. Empty values grant no elevated access; remove bootstrap entries after controlled provisioning.

`VALO_MAX_UPLOAD_BYTES`, log/rate-limit settings, and feature variables must be reviewed for the target environment. Do not paste secret values into deployment records.

## Tenancy and migration contract

- Protected domain requests require an authenticated local user and one explicit organisation context. Clients send `X-Valo-Organisation-Id` when more than one active organisation is available.
- Direct membership, approved partner relationships, and separately approved break-glass sessions resolve to a bounded permission set. There is no platform-role tenant bypass.
- Tenant data access runs inside one database transaction. The application sets `app.current_organisation_id` transaction-locally, and `lib/db/migrations/0001_tenant_rls.sql` enables and forces RLS on tenant-resource tables.
- The application database role must not be a PostgreSQL superuser or have `BYPASSRLS`. Use an approved migration identity for DDL and a least-privilege runtime identity for the application.
- The RLS migration is fail-closed and can make unassigned legacy rows invisible. Reconcile and authoritatively backfill legacy organisation ownership before applying it. Never invent tenant ownership.

Replit invokes `scripts/post-merge.sh` after a Git merge. It performs a frozen install and validates the migration journal, but deliberately does **not** apply migrations. The current Replit development database is a populated, push-managed legacy database with no Drizzle journal; applying the fresh `0000` baseline or FORCE-RLS `0001` directly would be unsafe. Preserve it, take a verified backup, inventory and map legacy tenant ownership, and implement/rehearse an explicit legacy bridge before any schema mutation. Never mark historical migrations as applied without proving that the live schema and constraints match them.

## Feature-gated scope

Commercial UI surfaces are build-time gated and default off:

- `VITE_FEATURE_CLIENT_PORTAL`
- `VITE_FEATURE_PARTNER_WORKSPACE`
- `VITE_FEATURE_BILLING_ENTITLEMENTS`
- `VITE_FEATURE_NOTIFICATION_ADAPTERS`

Server-side commercial flags also default off when no tenant/global record exists. Controlled flags include `partner_edition`, `white_label_branding`, `benchmark_reporting`, `licensed_tender_discovery`, and `controlled_bid_drafting`. UI flags only control navigation/exposure; they do not grant server permission or activate a provider. Enable a tenant flag only with its commercial activation reference and accepted evidence. Partner release/co-sign, benchmarks, automatic confirmation, payment charging, WhatsApp intake, and unsupported provider actions remain off or fail closed until their documented gates pass.

## Safe Replit promotion

1. Merge only a reviewed commit with green GitHub CI; record the commit SHA and dependency/SBOM evidence.
2. Sync the exact merged SHA. Confirm `postMerge` completed the frozen install and `migration:check`; it must not mutate the existing development database.
3. Preserve the populated legacy development database. Before any future bridge, capture its schema and row inventory, create and verify a backup, authoritatively reconcile every tenant-owned row, and rehearse the bridge on a restore. Stop on journal, ownership, or RLS differences.
4. Replit publish provisions a separate fresh production database and applies its schema diff. Confirm the target is fresh and separate before approval; do not point publish at the legacy development database. Record the resulting schema and verify it against the source migrations rather than assuming platform success proves equivalence.
5. Run the checks above in Replit, plus live PostgreSQL isolation tests using a non-owner runtime role. Prove same-tenant success and cross-tenant denial for database and storage paths.
6. Build and preview both artefacts. Verify sign-in, organisation selection, denied cross-tenant access, feature-off states, one synthetic intake/review/readiness/export journey, `/api/healthz`, logs, and rollback access.
7. Publish only after the target URL, exact CORS origin, Clerk configuration, private storage paths, runtime identity, backups, flags, and required provider approvals are recorded. Keep new commercial flags off during initial promotion.
8. After publish, repeat non-destructive smoke tests against the published URL and observe errors, latency, database connections/locks, tenant denials, provider failures, and backup status. Record the result in `docs/implementation-v2.5/DEPLOYMENT_RECORD.md`.

Abort or roll back on cross-tenant exposure, data loss/corruption, migration reconciliation failure, release-gate bypass, secret/content leakage, sustained health degradation, or loss of a deadline-critical workflow. Follow the deployment, rollback, restore, and incident runbooks under `docs/implementation-v2.5/runbooks/`.

## Known release blockers

This candidate is not production-accepted. In particular, live FORCE-RLS/migration rehearsal and full cross-tenant E2E evidence are pending; authoritative malware/MIME/archive inspection and quarantine are not wired into intake; production provider readiness is not enforced at startup; durable provider reconciliation and an external immutable audit anchor are incomplete; and accepted backup/restore, rollback, accessibility, load, security, and deployed-smoke evidence is absent. See `docs/implementation-v2.5/ACCEPTANCE_REPORT.md` for the source/evidence boundary.

## Architecture map

- `lib/db/src/schema/index.ts` — schema source; `lib/db/migrations/` — source-controlled migrations.
- `lib/api-spec/openapi.yaml` — API contract; codegen writes the React client and Zod packages.
- `artifacts/api-server/src/routes/` — API routers; tenancy and security boundaries live under `src/middlewares/`.
- `artifacts/api-server/src/lib/` — deterministic controls, audit/provenance, feature/provider policies, document/report assembly, and proof harnesses.
- `artifacts/valo-workbench/` — React workbench and role/feature-aware surfaces.
- `config/rules/nigeria/` — versioned Nigeria rule-pack registration; legal approval and signed activation are still required.
- `.agents/memory/` — non-obvious doctrine and build decisions; read before changing risk, sign-off, audit, intake, BOQ, tenancy, or model behavior.

The governing product, architecture, security, test, operations, release, and acceptance documents are indexed in `docs/implementation-v2.5/README.md`.
