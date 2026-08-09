# Rollback runbook

## Principle

Rollback restores safe service without erasing evidence. Application/config/flag rollback is preferred. Database changes use backward-compatible expand/contract and forward repair; destructive down migrations are not assumed safe.

## Decision

Release/incident commander records trigger, affected version/environment/tenants, last safe artefact/config/schema, provider side effects and deadline impact. Security/data events also start incident response.

## Fast containment

1. Disable affected server feature flag/provider/job class/export.
2. Stop new deployments/migrations and preserve logs/audit/anchors.
3. If exposure/corruption is possible, isolate affected component/tenant and revoke sessions/keys as needed.

## Application/config rollback

1. Confirm previous signed artefact supports current expanded schema and rule-pack/config versions.
2. Capture current deployment/config/flag digest.
3. Deploy previous artefact; restore prior safe configuration/routing without rolling back secrets to compromised values.
4. Drain/restart workers carefully; do not lose leased jobs. Reconcile provider events and idempotency records.
5. Run health/readiness and critical smoke, including tenant denial and fatal/package gates.

## Data issue

Pause affected mutations. Prefer audited compensating migration/forward fix. Restore/PITR only with incident commander approval after determining external side effects and safe recovery point; follow `RESTORE.md`. Never overwrite production before isolated validation and backup.

## Verification and closure

Confirm error/latency/queue/provider health, database reconciliation/RLS, audit anchor freshness, signed package hashes, no duplicate payment/notification/export and affected user journey. Record start/end, downtime, versions, commands/platform actions, evidence, residual issues and follow-up release. Re-enable flags only after regression approval.
