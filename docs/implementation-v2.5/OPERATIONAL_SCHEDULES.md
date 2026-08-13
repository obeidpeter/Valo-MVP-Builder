# Operational schedule manifest

Status: **source entrypoints and UTC cadence declared; no platform schedule installation is evidenced**.

`config/operations/schedules.v1.json` is the only repository schedule manifest. It declares bounded commands, non-overlap policy, timeouts, last-success/full-cycle signals and activation prerequisites. It is not infrastructure-as-code and must never be used as evidence that Replit or another scheduler is running a job.

## Declared jobs

| Job                                | UTC cadence         | Source capability                                                                                    | Current gate                                                                                                  |
| ---------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Storage deletion reconciliation    | Every 15 minutes    | Tenant-fair bounded reconciliation, durable cursor and lease, failure/full-cycle signals             | Blocked on provider PUT cap, terminal queue retention, audited replay, metrics/paging and platform receipt    |
| Retention request scan             | Daily 01:15         | Opens eligible requests only; never purges or certifies deletion                                     | Ready for platform installation after approved retention configuration and scheduler identity                 |
| Public intake expiry purge         | Daily 01:45         | Calls only the two owner-defined expiry functions under advisory lock                                | Blocked on a dedicated non-superuser/non-owner maintenance login, explicit function grants and full ACL audit |
| Authenticated rate-limit purge     | Hourly at minute 15 | Calls one owner-only, 1,000-row bounded purge page under advisory lock                               | Source-ready; needs exact owner authority for FORCE-RLS traversal and proof runtime cannot execute            |
| Audit-anchor evidence verification | Hourly at minute 5  | Verifies independently pinned, complete, provider-verified chain-head evidence                       | Does not create anchors; blocked on approved immutable provider/capture/signature adapter                     |
| Backup evidence verification       | Daily 03:30         | Verifies independently pinned encrypted backup and restore-drill evidence against configured RPO/age | Does not create backups; blocked on provider backup/inventory hooks and retained restore evidence             |

## Platform installation evidence

For every installed job retain the platform job/deployment ID, exact command and source commit, UTC cadence, timeout, overlap policy, workload identity, secret references, first successful run, last-success/full-cycle metric observation, synthetic stale-worker alert receipt, acknowledgement and rollback/disable procedure. Update `DEPLOYMENT_RECORD.md`; do not change `platformScheduleStatus` until that evidence exists.

The maintenance purge process requires `NODE_ENV=production`, `VALO_MAINTENANCE_EXECUTE=confirmed`, `VALO_MAINTENANCE_DATABASE_URL` and the exact `VALO_MAINTENANCE_DATABASE_ROLE`. The connected login must be neither superuser nor `BYPASSRLS`, must not own intake tables and must have only explicit execution rights to both expiry functions.

The authenticated rate-limit purge is a separate owner-only boundary. It requires `VALO_AUTH_RATE_LIMIT_MAINTENANCE_EXECUTE=confirmed`, the same maintenance URL and exact `VALO_MAINTENANCE_DATABASE_OWNER_ROLE`. Before mutation the entrypoint proves that the session owns both the function and table, has explicit global FORCE-RLS authority, and that `valo_app_runtime` cannot execute the function. A 1,000-row result deliberately leaves the full-cycle signal false so backlog remains visible; the scheduler must not loop without a separately reviewed budget.

Both evidence validators require the exact target in `VALO_OPERATION_EVIDENCE_ENVIRONMENT` (`production` or `staging`) and the independently deployed source in `VALO_OPERATION_EVIDENCE_SOURCE_SHA`. Backup validation additionally requires `VALO_BACKUP_EVIDENCE_FILE`, `VALO_BACKUP_EVIDENCE_SHA256`, `VALO_BACKUP_RPO_HOURS` and `VALO_RESTORE_DRILL_MAX_AGE_DAYS`. Audit-anchor validation requires `VALO_AUDIT_ANCHOR_EVIDENCE_FILE`, `VALO_AUDIT_ANCHOR_EVIDENCE_SHA256`, `VALO_AUDIT_ANCHOR_MAX_AGE_HOURS`, `VALO_AUDIT_ANCHOR_EXPECTED_RETAINED_ORGANISATION_COUNT` and `VALO_AUDIT_ANCHOR_EXPECTED_RETAINED_ORGANISATION_SET_SHA256`. The latter two values must be captured from an independently controlled catalog of every tenant whose audit or retention obligation still exists—including suspended or offboarded tenants—never copied from the provider evidence document. Evidence paths must be absolute regular files; every expected digest must come from a control plane independent of the file being checked.
