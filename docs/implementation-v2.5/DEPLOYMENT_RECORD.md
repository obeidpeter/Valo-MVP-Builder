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

The repository contains Replit-oriented configuration, but that does not establish authorisation, environment security, domain, production version or successful deployment.

## Evidence required for a future deployment

| Evidence          | Expected record                                                   | Status  |
| ----------------- | ----------------------------------------------------------------- | ------- |
| Source/repository | Commit/tag, private visibility/permissions, branch protection     | Pending |
| Artefacts         | Immutable API/worker/web hashes, signature, SBOM/provenance       | Pending |
| CI                | Run URL/ID for required gates, no skipped critical tests          | Pending |
| Migration         | Version, backup ID, dry run/reconciliation, approvers             | Pending |
| Configuration     | Redacted digest, environment, flags, rule packs, adapters/regions | Pending |
| Security/privacy  | Scans, RLS negative, DPIA/DPA/transfer/subprocessor approvals     | Pending |
| Staging           | URL/version, E2E/a11y/load/restore/rollback evidence              | Pending |
| Production        | URL/version/time/change ticket/approvers                          | Pending |
| Smoke             | Synthetic tenant journey and invariant checks                     | Pending |
| Observation       | SLO/queues/providers/anchors/backups and incident state           | Pending |

## Future deployment entry template

```text
Change/release ID:
Commit/tag and artefact digests:
Environment, region and URLs:
Started/completed UTC:
Database before/after + migration IDs:
Backup ID/recovery point:
Configuration/flag/rule-pack digests:
CI/staging evidence IDs:
Deployment actions:
Smoke evidence:
Monitoring observation:
Rollback status/artefact:
Deviations/incidents:
Release/security/privacy/operations approvers:
```
