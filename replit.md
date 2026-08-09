# Valo Nigeria v2.5 candidate

Valo is an internal bid-compliance workbench for tender intake, reviewer-confirmed requirements, evidence and defect review, exact-kobo BOQ checks, submission-readiness gates, and signed report/package export. The v2.5 candidate adds organisation tenancy, scoped permissions, PostgreSQL row-level-security (RLS) foundations, role-specific UI surfaces, and commercial feature gates. It remains a pre-production candidate; source presence and a successful Replit preview are not production acceptance.

## Runtime and Replit workflows

- Supported runtime: Node.js 22 through 24 and pnpm 10.34.0. Replit selects Node.js 24 in `.replit`; CI validates Node.js 22.
- Replit's **Project** workflow runs the API on port 5000 and the Vite workbench on port 3000, proxying `/api` to the API.
- API liveness is `GET /api/healthz`. It proves only that the process can answer; it does not prove database, storage, identity-provider, model-provider, RLS, or migration readiness.
- Production publishing runs the `.replit` build command with `PORT=3000 BASE_PATH=/ NODE_ENV=production pnpm run build`, then starts the compiled API with Replit's assigned `PORT`. The checked-in run command pins the current `https://valo-mvp-builder.replit.app` origin and one-hop Replit proxy posture; update the exact allowlist before activating any approved custom domain. In production the API serves `artifacts/valo-workbench/dist/public`, including SPA deep-link fallback; only the nine implemented public paths are indexable and every authentication, workspace, or unknown fallback response carries `X-Robots-Tag: noindex, nofollow`.

Useful local/Replit checks:

```sh
pnpm install --frozen-lockfile
pnpm run lint
pnpm run verify:release-config
pnpm run typecheck
pnpm --filter @workspace/db migration:check
pnpm --filter @workspace/db migration:bridge:legacy:check
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/valo-workbench test
pnpm --filter @workspace/api-server prove:doctrine:offline
pnpm --filter @workspace/api-server prove:injection:offline
pnpm --filter @workspace/api-server eval:harness:offline
pnpm run build
```

Live model/prompt changes also require `pnpm --filter @workspace/api-server prove:ship` in the approved Replit environment. Offline proofs do not replace that gate.

## Required deployment configuration

Keep secrets in Replit Secrets, never in source, command examples, screenshots,
deployment records, or build logs. At minimum, configure and verify:

- `DATABASE_URL` is the migration-owner connection used only by approved DDL
  and migration operations. A production API must instead use a distinct
  `VALO_RUNTIME_DATABASE_URL` that authenticates as the least-privilege
  `valo_app_runtime` login. The two URLs target the same database but must not
  reuse an identity or credential. Remove `DATABASE_URL` from the long-running
  production service after migration wherever Replit permits it.
- `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and build-time `VITE_CLERK_PUBLISHABLE_KEY`. The production frontend always uses the same-origin `/api/__clerk` proxy so its CSP and credential boundary remain fixed. `VITE_CLERK_PROXY_URL` is development-only.
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

Replit invokes `scripts/post-merge.sh` after a Git merge. It performs a frozen
install and validates the migration journal, but deliberately does **not** apply
migrations or run the legacy bridge. The current Replit development database is
a populated, push-managed legacy database with no Drizzle journal; applying the
fresh `0000` baseline or FORCE-RLS `0001` directly would be unsafe. Its only
supported in-place upgrade is the reviewed one-time legacy bridge described
below. Never mark historical migrations as applied without proving that the
live schema and constraints match them.

The current live Replit production database is also a populated copy of this
legacy 19-table lineage; it is not a fresh database. Its upgrade therefore
requires the same bridge under a production change window. Do not run the normal
`0000` migration chain, `migration:apply`, `drizzle-kit push`, or an automatic
publish schema diff against it. Development and production are separate source
instances: capture and approve each instance's own counts, audit export/head,
backup, restore, and rehearsal evidence rather than reusing evidence between
them.

## One-time Replit legacy bridge

`scripts/migrations/replit-legacy-v1-to-v2.5.sql` upgrades only the exact
19-table unjournalled Replit legacy lineage. Use its fail-closed runner; do not
edit tokens manually or paste the SQL into an ordinary application workflow.
The static check is safe and requires no database credentials:

```sh
pnpm --filter @workspace/db migration:bridge:legacy:check
```

During the isolated restore rehearsal, generate the v3 manifest's non-PII
`legacyCatalog` object with
`pnpm --filter @workspace/db migration:bridge:legacy:catalog-evidence`. It
locks the restored 19-table source, emits only its canonical algorithm and
SHA-256, and rolls back.

The mutating runner requires the following values to be injected from Replit
Secrets or another approved ephemeral secret mechanism:

- `DATABASE_URL`: the approved migration-owner connection.
- `VALO_RUNTIME_DATABASE_URL`: a separate URL for `valo_app_runtime`, with a
  random decoded password of at least 32 characters. Build it by replacing only
  owner userinfo so protocol, host, port, database, and every TLS/query option
  remain identical to `DATABASE_URL`.
- `VALO_BRIDGE_APPLICATION_QUIESCED_ACK`: set to the exact reviewed
  acknowledgement only after the application and every writer are stopped.
- `VALO_BRIDGE_PLATFORM_ADMIN_CLERK_USER_ID`: the explicitly approved active
  legacy administrator identity.
- `VALO_BRIDGE_SOURCE_BACKUP_PATH`: a private, runner-readable path to the
  approved source backup.
- `VALO_BRIDGE_SOURCE_AUDIT_EXPORT_PATH`: a private path to the exact ordered
  audit NDJSON export. The runner hashes it and compares its bytes with a fresh
  database-produced export.
- `VALO_BRIDGE_REHEARSAL_MANIFEST_PATH`: a private path to the approved
  authoritative v3 rehearsal manifest. It binds the target, all 19 counts and
  table digests, normalized legacy catalog fingerprint, audit
  classification/head, backup, and export.
- `VALO_BRIDGE_EXPECTED_REHEARSAL_MANIFEST_SHA256`: the independently recorded
  SHA-256 of that exact manifest. The manifest and all referenced evidence stay
  outside the repository. On Linux every evidence path must be a regular file
  with no group/world permissions (for example mode `0600`).

Never put the values or evidence files in `.replit`, source control, a command
line, or this document. A deployment record may contain secret-manager/private
artifact references and runner-produced non-secret evidence hashes, but never
URLs, passwords, raw identity values, production rows, or audit contents.

Before execution, stop the legacy API and every job, workflow, and operator
session that can write to PostgreSQL. Record the quiescence boundary, verify no
remaining writers, take the approved backup and audit export, and prove an
isolated restore. Reconcile that restore to the frozen counts and audit head,
then rehearse the same command there. The bridge's `NOWAIT` table lock is a
final collision detector, not evidence that the application was quiesced.

Only after the restore and rehearsal evidence is approved may an authorised
operator inject the inputs and run, first on the isolated restore and then in
the recorded source-database change window:

```sh
pnpm --filter @workspace/db migration:bridge:legacy
```

The runner locks all 19 tables before any source read, then derives the database
name, counts, audit head, and expected table digests solely from the authoritative
manifest. It checks the exact schema fingerprint, private artifact bytes and
computed hashes, migration artefacts,
administrator identity, and role separation before committing. Any mismatch is
an abort condition; do not alter the expected inputs to make a changed source
pass. After success, retain the backup/restore and reconciliation evidence and
configure both startup URLs as described below.

Replit production startup requires `NODE_ENV=production`, the unavoidable
managed `DATABASE_URL` for target/TLS attestation, and
`VALO_RUNTIME_DATABASE_URL` for the actual pool. After the pool captures the
runtime URL, application code deletes both variables from `process.env` and
attests the authenticated runtime role before any listener or scheduled
mutation starts. The owner credential was still injected into the process
briefly; record that residual Replit limitation, restrict project access, and
rotate it after the operation. Environment erasure is defense-in-depth, not an
RCE/native-process isolation boundary.

That startup proof is pinned to PostgreSQL 16 and runs in a repeatable-read,
read-only transaction. It requires the ambient path to be exactly
`pg_catalog, public`, then uses transaction-local `search_path=pg_catalog` for
deterministic catalog deparsing. It verifies the exact 96-table RLS flag set,
85 FORCE-RLS table identities, 104 policy contracts, 116 security triggers,
nine `valo_security` routine contracts, and every effective runtime
table/column/sequence privilege. It also requires `row_security=on`,
`session_replication_role=origin`, no ownership/schema-creation path, and
EXECUTE only on the two tenant-context helpers. A same-count but semantically
drifted database must not start.

The transaction-local `app.current_organisation_id` GUC is a database boundary,
not authentication. A holder of the raw runtime credential can call its setter,
so keep that URL private and let the API establish Clerk identity, selected
membership, and permission before opening the tenant transaction. RLS and the
tenant graph/control-plane triggers remain defense in depth for application SQL
errors; they do not replace application authorization.

The source audit chain has a recorded known historical discontinuity. The
original rows remain byte-preserved in `legacy_audit_events` with an explicit
`known_discontinuity` assessment; the bridge does not rewrite or claim to repair
that evidence. It starts the hash-version-2 active chain with a boundary event
linked to the archived evidence and its approved hashes. Keep the exact affected
ranges, counts, cause hypotheses, and source evidence in the private rehearsal
manifest and database assessment, not this repository. Do not represent the
legacy range as continuously verified.

After the bridge, record its printed `ACTIVE_V2_HEAD=<seq>:<hash>` outside the
database. The verifier requires that external active anchor plus the private
manifest's legacy `<seq>:<hash>:<prev-hash>` anchor and archive digest via
`AUDIT_EXPECTED_HEAD`, `AUDIT_EXPECTED_LEGACY_HEAD`, and
`AUDIT_EXPECTED_LEGACY_ARCHIVE_SHA256` (scoped by
`AUDIT_ORGANISATION_ID`). Run
`pnpm --filter @workspace/api-server verify:audit`; its active-v2 and preserved
legacy verdicts are intentionally separate.

Bridge failure markers are operationally distinct. A pre-COMMIT failure is
rolled back. `BRIDGE_COMMIT_OUTCOME_UNKNOWN` means the COMMIT response was lost:
keep the app stopped, never retry blindly, and reconnect to classify the target
as exact legacy or fully completed v2.5. `BRIDGE_COMMITTED_POSTCHECK_FAILED`
means the transaction committed but a later runtime proof failed; preserve the
evidence and choose reviewed forward repair versus PITR. Neither marker permits
an assumption of rollback.

## Feature-gated scope

Commercial UI surfaces are build-time gated and default off:

- `VITE_FEATURE_CLIENT_PORTAL`
- `VITE_FEATURE_PARTNER_WORKSPACE`
- `VITE_FEATURE_BILLING_ENTITLEMENTS`
- `VITE_FEATURE_NOTIFICATION_ADAPTERS`

Server-side commercial flags also default off when no tenant/global record exists. Controlled flags include `partner_edition`, `white_label_branding`, `benchmark_reporting`, `licensed_tender_discovery`, and `controlled_bid_drafting`. UI flags only control navigation/exposure; they do not grant server permission or activate a provider. Enable a tenant flag only with its commercial activation reference and accepted evidence. Partner release/co-sign, benchmarks, automatic confirmation, payment charging, WhatsApp intake, and unsupported provider actions remain off or fail closed until their documented gates pass.

## Safe Replit promotion

1. Merge only a reviewed commit with green GitHub CI; record the commit SHA and dependency/SBOM evidence.
2. Sync the exact merged SHA. Confirm `postMerge` completed the frozen install
   and `migration:check`, then run the static legacy-bridge check separately; no
   source-synchronisation step may mutate the existing development database.
3. Preserve the populated legacy development database. If its one-time upgrade
   is authorised, follow the bridge procedure above with application
   quiescence, verified backup and isolated restore, frozen source evidence, and
   an approved rehearsal. Stop on journal, schema, count, audit, ownership, or
   RLS differences.
4. Treat the current production target as the confirmed copied 19-table legacy
   database. Its bridge is mandatory and uses production-specific quiescence,
   backup/restore, inventory, audit export/head, and rehearsal evidence. Do not
   let Replit publish apply a schema diff or the normal `0000` migration chain;
   verify the bridged catalog and runtime role before starting the v2.5
   application.
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
