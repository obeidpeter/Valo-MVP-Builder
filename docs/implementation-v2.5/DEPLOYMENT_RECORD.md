# Deployment record

## Current status

| Field                    | Value                                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Deployment state         | **Not deployed by this implementation dossier**                                                                                        |
| Authorised target        | Not supplied/confirmed                                                                                                                 |
| Production domain        | Not supplied/confirmed                                                                                                                 |
| Infrastructure budget    | Not supplied/confirmed                                                                                                                 |
| Release artefact/version | Pending                                                                                                                                |
| Database migration       | Not performed/recorded                                                                                                                 |
| Staging URL              | None recorded                                                                                                                          |
| Production URL           | None recorded                                                                                                                          |
| Post-deploy smoke        | Not run                                                                                                                                |
| Rollback exercise        | Not run                                                                                                                                |
| Blocker                  | Deployment requires authorised environment, credentials/secrets mechanism, provider/region/budget decisions and accepted release gates |

The repository contains Replit-oriented configuration, but that does not establish authorisation, environment security, domain, production version or successful deployment. Candidate and verification tooling is documented in `RELEASE_PROVENANCE.md`; generated evidence remains external to the repository.

## Evidence required for a future deployment

| Evidence          | Expected record                                                   | Status                                                |
| ----------------- | ----------------------------------------------------------------- | ----------------------------------------------------- |
| Source/repository | Commit/tag, private visibility/permissions, branch protection     | Tooling present; live evidence pending                |
| Artefacts         | Immutable API/worker/web hashes, signature, SBOM/provenance       | Candidate workflow present; accepted artefact pending |
| CI                | Run URL/ID for required gates, no skipped critical tests          | Pending                                               |
| Migration         | Version, backup ID, dry run/reconciliation, approvers             | Pending                                               |
| Configuration     | Redacted digest, environment, flags, rule packs, adapters/regions | Pending                                               |
| Security/privacy  | Scans, RLS negative, DPIA/DPA/transfer/subprocessor approvals     | Pending                                               |
| Staging           | URL/version, E2E/a11y/load/restore/rollback evidence              | Pending                                               |
| Production        | URL/version/time/change ticket/approvers                          | Verification workflow present; live record pending    |
| Smoke             | Synthetic tenant journey and invariant checks                     | Pending                                               |
| Observation       | SLO/queues/providers/anchors/backups and incident state           | Pending                                               |

## Future deployment entry template

```text
Change/release ID:
Candidate workflow/artifact ID and manifest SHA-256:
Commit/tag, release SHA-256, SBOM and artefact digests:
Environment, region and URLs:
Immutable provider deployment ID:
Provider source snapshot/build evidence and any live artifact digest:
Runtime identity evidence (environment-declared; never imply live byte verification):
Started/completed UTC:
Database before/after + migration IDs:
Backup ID/recovery point:
Configuration/flag/rule-pack digests:
Authentication-adapter approval and redacted Clerk reference digest:
Authenticated limiter policy digest:
Maintenance purge role/ownership/runtime-denial evidence IDs:
CI/staging evidence IDs:
Deployment actions:
Smoke evidence:
Monitoring observation:
Rollback status/artefact:
Deviations/incidents:
Release/security/privacy/operations approvers:
```
