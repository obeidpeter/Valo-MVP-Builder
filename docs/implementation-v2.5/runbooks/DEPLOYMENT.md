# Deployment runbook

No production deployment is authorised by this document. Replace bracketed provider commands with approved, non-interactive platform procedures and record outputs in `DEPLOYMENT_RECORD.md`.

## Preconditions

- Named release owner, security/privacy approver, operations owner, target environment/domain and change window.
- Signed immutable artefact, version/commit, SBOM and provenance; repository visibility/branch protections verified.
- CI green: migrations, critical tests/coverage, security/dependency/secret/IaC, AI/injection, render and contract gates.
- Staging E2E, cross-tenant, accessibility, performance/resilience, restore and rollback evidence accepted.
- Provider agreements/regions/secrets/health approved; no development adapter can start.
- Current signed Nigeria rule packs and intended feature/entitlement exposure reviewed.
- Encrypted backup and restore verification within approved RPO; rollback artefact/config available.
- No unresolved P0/P1 or high/critical security finding; incident/on-call contacts active.

## Build once

1. Resolve locked dependencies in trusted CI.
2. Format/lint/typecheck/test/build all packages.
3. Generate/compare OpenAPI clients; validate migrations from supported baseline.
4. Produce signed application/worker/web artefacts, checksums, SBOM and provenance.
5. Scan final artefacts; store in immutable registry. Do not rebuild per environment.

## Stage

1. Confirm separate staging identity, database, storage, keys and providers.
2. Capture pre-deploy versions, configuration digests, flag/rule-pack versions and backup status.
3. Apply backward-compatible expand migrations with the controlled migration identity.
4. Run migration reconciliation and RLS policy inspection using non-owner app role.
5. Deploy API/workers/web with flags off; wait for health then readiness.
6. Run smoke: sign-in/MFA, tenant denial, create engagement, safe test upload/quarantine/job progress, requirement review, evidence/fatal gate, BOQ fixture, package render/sign/export, audit anchor and notification simulator.
7. Run staging E2E/a11y/performance security subset; verify logs contain no content/secrets.
8. Approve promotion using the same artefacts.

## Replit database lineage gate

The existing Replit development database was managed with `drizzle-kit push`
and has no `drizzle.__drizzle_migrations` journal. It is a populated legacy
database, not an empty target. The v2.5 `0000` migration is a full-schema
bootstrap and **must not** be applied to that database: it would attempt to
create the 19 existing tables. Do not use `push --force`; it is permitted to
truncate data when reconciling a required column.

Publishing creates a separate, empty production database. That empty database
may use the checked-in migration chain after CI proves it from scratch. Source
synchronisation must run `migration:check` only; database promotion is a
separate, recorded operation.

Upgrade the populated development database only after all of the following are
available:

1. Create a provider backup and prove an isolated restore. Record the recovery
   point, the 19 legacy table counts, project count, and audit-event count.
2. Fingerprint the restored schema against commit
   `b71adcec4a7060c0ce2192266c81d880c5e56277`. Abort on a missing legacy
   column, an unexpected v2.5 marker table, or an existing unknown migration
   journal; never guess through partial state.
3. Generate and review an explicit **baseline-to-v2.5** SQL migration. The
   generated delta must add `audit_events.organisation_id` as nullable first.
   Adding it as `NOT NULL` directly fails on populated audit history.
4. In the same reviewed data-migration plan, create exactly one deterministic
   legacy Valo organisation (reserved ID
   `56414c4f-0000-5000-8000-000000000025`, slug
   `legacy-valo-workspace`, type `valo`) and assign every legacy tenant row to
   it. Preserve all primary keys, timestamps, object paths, hashes, audit
   sequence values, and user identity rows.
5. Create one active membership for each active legacy user whose role is not
   `none`. Map `admin` to `valo_operations_administrator`, `reviewer` to
   `valo_quality_adviser`, and `analyst` to `valo_analyst`. Abort on any other
   non-empty legacy role; do not silently elevate or discard it.
6. Reconcile parent/child organisation IDs, foreign-key orphans, row counts,
   audit-chain verification, and role-grant counts. Only after reconciliation
   may the migration make `audit_events.organisation_id` non-null and enable
   and force RLS.
7. Seed/adopt the legacy baseline journal entry only after the exact schema
   fingerprint passes. Run the migration against the isolated restore, execute
   cross-tenant negative tests with the non-owner application role, then repeat
   against the source database in an approved change window.

Until this explicit delta has been committed and rehearsed, leave the populated
development database on the legacy application version. A strict/verbose
`drizzle-kit push` session may be used to inspect the proposed reconciliation
only if the operator declines the confirmation prompt; it is not the upgrade
procedure.

## Production promotion

1. Announce window and freeze conflicting changes/jobs as designed; do not interrupt deadline-critical work without owner plan.
2. Verify latest backup, replica/queue health, anchor freshness, provider health and rollback artefacts.
3. Record current deployment/config/schema/flags/rule packs.
4. Apply expand migration; halt on reconciliation/RLS error.
5. Deploy workers/API/web in compatible order; keep new commercial flags off.
6. Observe readiness, error/latency, DB connections/locks, queue depth, provider failures, tenant denials and anchor status.
7. Execute non-destructive production smoke with dedicated test tenant and marked synthetic files.
8. Enable only approved tenant flags gradually; verify server and UI exposure.
9. Complete deployment record, links/hashes, actual times, deviations and approvers.

## Abort/rollback triggers

Cross-tenant exposure, fatal/readiness bypass, data corruption, migration reconciliation failure, secret/content leakage, sustained error/SLO breach, audit anchor failure with sensitive mutations, provider side effects without reconciliation, or inaccessible deadline-critical workflows. Follow `ROLLBACK.md`; start `INCIDENT_RESPONSE.md` for security/data impact.

## Post-deploy observation

Minimum enhanced observation is one complete document-processing/package cycle and the approved time window. Reconcile jobs/webhooks/notifications, check backup/anchor completion, review security/audit denials and close temporary grants. Commercial flags remain off until separate activation approval.
