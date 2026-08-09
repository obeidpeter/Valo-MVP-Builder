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

## Replit database lineage and legacy bridge gate

The existing Replit development database was managed with `drizzle-kit push`
and has no `drizzle.__drizzle_migrations` journal. It is a populated 19-table
legacy database, not an empty target. Do not apply the v2.5 `0000` bootstrap or
use `push --force` against it. Its only supported in-place upgrade is the
reviewed, fail-closed bridge in
`scripts/migrations/replit-legacy-v1-to-v2.5.sql`, invoked through the database
package runner.

The current live Replit production database is confirmed to be a populated copy
of the same 19-table legacy lineage, not a fresh or separate database. The
legacy bridge is mandatory for that production target. Do not run `0000`,
`migration:apply`, `drizzle-kit push`, or a Replit publish schema diff against
it. A future independently provisioned target may use the normal checked-in
migration chain only after evidence proves it empty and separate; that exception
does not apply to the current production database. Source synchronisation and
`postMerge` never authorise or run database promotion.

### Required evidence and quiescence

1. Fix the exact source commit and recovery point. Create a provider backup,
   produce a byte-preserving ordered export of `audit_events`, and capture row
   counts for exactly the 19 legacy tables plus the final audit sequence/hash.
   Store the backup, audit export, and approved rehearsal evidence manifest as
   private artifacts; the runner computes their hashes rather than trusting
   caller-supplied digest values.
2. Restore the backup into a new isolated database. Verify its checksum/custody,
   schema fingerprint, all frozen counts, audit head, foreign-key/orphan state,
   and application-level smoke. A provider's "backup complete" response without
   a successful restore is not evidence.
3. Before either rehearsal or source execution, stop the legacy API and every
   scheduler, workflow, job, operator session, and integration that can write
   PostgreSQL. Record who established the write freeze, when it began, and how
   the absence of writers was verified. If any source write occurs after the
   inventory or export, abort and regenerate the evidence.
4. Keep the verified backup and restore available through the change window.
   Record the restore reference and evidence hashes in `DEPLOYMENT_RECORD.md`;
   never record a connection string, password, secret value, or raw secret
   payload.

### Static check and runner inputs

Run the credential-free artifact check at the exact release SHA:

```sh
pnpm --filter @workspace/db migration:bridge:legacy:check
```

This check proves that the bridge contains the expected embedded migration
shape and audit boundary controls. It does not connect to PostgreSQL and is not
a data dry run. The isolated restore rehearsal is the required operational dry
run.

On that quiescent isolated legacy restore, compute the non-PII catalog member
for the authoritative manifest with
`pnpm --filter @workspace/db migration:bridge:legacy:catalog-evidence`. The
command locks the 19 restored tables, prints only the canonical algorithm and
SHA-256, and rolls back. Store that object as `legacyCatalog` in the v3
manifest; never substitute a digest computed from a different database state.

Inject these runner inputs from Replit Secrets or another approved ephemeral
secret mechanism; refer to secret-manager entries rather than copying values
into commands, source, tickets, screenshots, or logs:

- `DATABASE_URL`: the migration-owner connection used for the one-time DDL.
- `VALO_RUNTIME_DATABASE_URL`: a different credential for the fixed
  `valo_app_runtime` login, with a random password of at least 32 characters,
  made by replacing only the owner URL userinfo. Protocol, host, port, database,
  and all TLS/query options must remain identical.
- `VALO_BRIDGE_APPLICATION_QUIESCED_ACK`: the exact reviewed acknowledgement,
  injected only after every application/job/operator writer is stopped.
- `VALO_BRIDGE_PLATFORM_ADMIN_CLERK_USER_ID`: the approved active legacy
  administrator identity.
- `VALO_BRIDGE_SOURCE_BACKUP_PATH`: a private, runner-readable path to the
  approved source backup.
- `VALO_BRIDGE_SOURCE_AUDIT_EXPORT_PATH`: a private path to the exact ordered
  audit NDJSON export. The runner hashes it and compares its bytes with the
  export regenerated from the connected source.
- `VALO_BRIDGE_REHEARSAL_MANIFEST_PATH`: a private path to the approved
  authoritative v3 rehearsal manifest binding target, backup/export, all 19
  counts and deterministic table digests, the normalized legacy catalog
  fingerprint, and audit evidence.
- `VALO_BRIDGE_EXPECTED_REHEARSAL_MANIFEST_SHA256`: the independently recorded
  SHA-256 of that manifest. Neither it nor any production evidence belongs in
  the repository. On Linux, all three evidence paths must be regular `0600`
  files (no group/world permission bits).

Replit production startup must set `NODE_ENV=production` and receives both the
managed `DATABASE_URL` (target/TLS attestation only) and
`VALO_RUNTIME_DATABASE_URL` (the actual pool). Startup fails closed unless the
latter authenticates as the constrained login with the expected audit/RLS
privileges. Immediately after Pool construction, code deletes both variables
from `process.env`; scheduled mutators run the same attestation before work.
The owner URL was nevertheless exposed briefly to the process. Record that
residual platform limitation, restrict access, and rotate after the operation;
environment erasure does not make an RCE/native-process boundary.

### Rehearse and execute

1. On the isolated restore, inject environment-scoped inputs and run the exact
   mutating command:

   ```sh
   pnpm --filter @workspace/db migration:bridge:legacy
   ```

2. Preserve the sanitized runner result and independently reconcile source and
   archive counts, primary keys, tenant assignments, role grants, audit
   boundary, migration journal, 85 forced-RLS tables, 104 policies, and runtime
   role negative tests. Run same-tenant success and cross-tenant denial tests
   through `VALO_RUNTIME_DATABASE_URL`.
3. Obtain explicit approval of the authoritative restore manifest and its
   independently recorded hash. In the source change window, stop all writers,
   then inject the quiescence acknowledgement and run the same command once.
   The runner holds all 19 `NOWAIT` table locks before reading and recomputing
   the manifest-bound counts/digests/audit evidence in one transaction; a
   lock failure or any preflight/reconciliation mismatch is an abort, never a
   reason to weaken an input or retry over a changing source.
   A pre-commit error rolls the transaction back. If the runner emits
   `BRIDGE_COMMITTED_POSTCHECK_FAILED`, the database has committed but runtime
   validation failed: keep the app stopped, preserve all evidence, and make a
   reviewed forward-repair versus PITR decision. Never assume rollback or
   blindly rerun.
4. After commit, start v2.5 with both attestation inputs and
   `NODE_ENV=production`; verify the constrained pool, immediate environment
   erasure, catalog, tenant isolation, audit, and synthetic smoke checks. Retain
   the backup until the observation window and rollback decision are closed.

The successful runner prints `ACTIVE_V2_HEAD=<seq>:<hash>`. Record that
non-secret anchor outside PostgreSQL in the approved deployment evidence. Run
the independent verifier with private values injected at runtime:

- `AUDIT_ORGANISATION_ID`: the tenant being verified.
- `AUDIT_EXPECTED_HEAD`: the recorded active v2 `<seq>:<hash>` anchor.
- `AUDIT_EXPECTED_LEGACY_HEAD`: the manifest-bound legacy
  `<seq>:<hash>:<prev-hash>` anchor.
- `AUDIT_EXPECTED_LEGACY_ARCHIVE_SHA256`: the external digest of the exact
  archived source export.

Then run `pnpm --filter @workspace/api-server verify:audit`. For multiple
tenants, use the corresponding plural JSON-map variables
`AUDIT_EXPECTED_HEADS`, `AUDIT_EXPECTED_LEGACY_HEADS`, and
`AUDIT_EXPECTED_LEGACY_ARCHIVE_SHA256S`. A matching acknowledged legacy
discontinuity exits successfully but is always reported separately as
`KNOWN DISCONTINUITY (preserved)`; it is never labelled intact.

The legacy audit evidence has a recorded known historical discontinuity. The
bridge preserves the original bytes in immutable `legacy_audit_events`, records
an explicit `known_discontinuity` assessment, and begins the active
hash-version-2 chain with a boundary event linked to the archived evidence and
approved hashes. Exact affected ranges, counts, cause hypotheses, and source
evidence remain in the private rehearsal manifest and database assessment; do
not copy them into the repository or deployment log. Do not rewrite those rows
or describe the legacy range as repaired or continuously verified, and retain
the source backup and audit export as private evidence.

## Production promotion

1. Announce window and freeze conflicting changes/jobs as designed; do not interrupt deadline-critical work without owner plan.
2. Verify latest backup, replica/queue health, anchor freshness, provider health and rollback artefacts.
3. Record current deployment/config/schema/flags/rule packs.
4. For the current Replit production database, execute only the approved legacy
   bridge procedure above; do not substitute the normal migration chain or a
   publish schema diff. A future already-v2 target may use its reviewed expand
   migration. Halt on any bridge, reconciliation, or RLS error.
5. Deploy workers/API/web in compatible order; keep new commercial flags off.
6. Observe readiness, error/latency, DB connections/locks, queue depth, provider failures, tenant denials and anchor status.
7. Execute non-destructive production smoke with dedicated test tenant and marked synthetic files.
8. Enable only approved tenant flags gradually; verify server and UI exposure.
9. Complete deployment record, links/hashes, actual times, deviations and approvers.

## Abort/rollback triggers

Cross-tenant exposure, fatal/readiness bypass, data corruption, migration reconciliation failure, secret/content leakage, sustained error/SLO breach, audit anchor failure with sensitive mutations, provider side effects without reconciliation, or inaccessible deadline-critical workflows. Follow `ROLLBACK.md`; start `INCIDENT_RESPONSE.md` for security/data impact.

## Post-deploy observation

Minimum enhanced observation is one complete document-processing/package cycle and the approved time window. Reconcile jobs/webhooks/notifications, check backup/anchor completion, review security/audit denials and close temporary grants. Commercial flags remain off until separate activation approval.
