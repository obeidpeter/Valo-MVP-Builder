# Restore and disaster-recovery runbook

## Authorisation and safety

Named incident/DR commander approves exact environment, backup ID/time and recovery point. Restore only into a new isolated database/bucket first; never overwrite a broad/unknown target. Freeze writes or establish a documented cutover boundary. Preserve suspected-corruption evidence.

## Procedure

1. Declare exercise/incident, scope, desired recovery point and RTO/RPO clocks.
2. Resolve and record exact backup/database/bucket/keys/config/artefact versions; verify checksums and custody.
3. Provision isolated recovery environment with separate network/credentials and no outbound notifications/payments/models by default.
4. Restore PostgreSQL/PITR, then object versions/inventory consistent with the checkpoint.
5. Apply only migrations compatible with the selected application artefact; do not improvise schema changes.
6. Run integrity checks: table/FK/count/orphan reconciliation, tenant IDs and forced RLS using app role, file/package hashes, job/outbox/inbox uniqueness, signed approvals, audit chain and external anchor consistency.
7. Run critical smoke with synthetic tenant; providers remain simulators until cutover approval.
8. Quantify actual data loss window and recovery time; compare to RPO/RTO. Investigate any divergence.
9. For production recovery, rotate potentially exposed credentials/keys, configure providers/flags conservatively, change DNS/routing using approved platform mechanism and monitor closely.
10. Reconcile external provider events that occurred after the recovery point before enabling side effects.
11. Document retained/lost/replayed work and notify affected tenants/regulators under incident/privacy decision.

## Acceptance

Restore is accepted only when data and object manifests reconcile, RLS/role negative tests pass, audit anchors validate, signed packages verify, no duplicate provider side effect occurs, smoke passes and measured RTO/RPO are within approved targets or an exception is escalated. Record artefact/report hashes.

## Failure

If backup corrupt/incomplete, keys unavailable, anchor divergence unexplained, RLS fails or target cannot meet safe isolation, stop cutover and escalate. Never issue deletion/restoration assurance without verification.
