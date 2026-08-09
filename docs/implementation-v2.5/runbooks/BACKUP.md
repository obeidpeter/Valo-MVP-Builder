# Backup runbook

## Objective

Create encrypted, restorable, access-controlled backups of PostgreSQL and object storage metadata/content sufficient to meet the approved RPO, without weakening retention, legal hold or tenant confidentiality.

## Required coverage

- PostgreSQL continuous recovery/PITR plus periodic full logical/physical backups as provider supports.
- Object storage versioning/replication or inventory-backed copy, including signed packages and audit-anchor receipts.
- Critical configuration as code, migration history, rule packs, prompt/model configurations and deployment/SBOM/provenance.
- Key references and recovery procedures, but never plaintext secrets in backup bundles.

## Policy

Provisional RPO is no worse than 24 hours pending business-impact approval; RTO target is <=4 hours. Backup frequency/retention/region/legal hold/deletion propagation are versioned policy. Backup keys and administration are separated from application identities. Copies are immutable where supported and monitored for age, completion, size anomaly, encryption and restore test freshness.

## Procedure

1. Scheduler starts under dedicated backup identity and records backup ID, source version/LSN/time, object inventory checkpoint and policy version.
2. Provider creates encrypted database backup/PITR point and storage version/inventory/copy.
3. Validate checksums/manifests, encryption/key version, expected table/object counts and anchor receipt inclusion.
4. Write success/failure evidence to operations store; page on missed RPO or validation failure.
5. Apply retention/immutability. Legal-hold material remains protected; expired copies are destroyed by provider lifecycle and verified.
6. Never call a backup successful from API acceptance alone; only validated artefacts count.

## Daily operator checks

Latest successful/validated age, PITR window, replica/storage replication lag, failed lifecycle actions, key health, immutable-lock status and latest restore exercise. Record/resolve alert; do not silence repeated failures.

## Restore exercise cadence

At least quarterly and before GA/material storage/database changes, restore into an isolated account/environment using `RESTORE.md`; measure actual RPO/RTO and verify RLS, hashes, packages, jobs and audit anchors. A backup without successful restore evidence is not accepted.
