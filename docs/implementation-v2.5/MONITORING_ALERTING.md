# Monitoring and alerting contract

Status: **source-controlled policy implemented; telemetry backend and paging adapter not deployed**.

The machine-readable alert pack is `config/observability/alerts.v2.5.json`. CI validates that every mandatory operational signal has an identifier, severity, condition and runbook. The pack deliberately carries `deployment_adapter_required`; its presence is not evidence that metrics are emitted, alerts are evaluated, or people are paged.

## Required signal flow

1. API, worker, database, storage and provider adapters emit structured metrics without document content, personal data, tokens or secrets.
2. The deployment adapter maps each stable signal name in the alert pack to the selected metrics backend.
3. Alert evaluation preserves organisation identifiers only where the incident responder is authorised to see them; shared dashboards use aggregate or pseudonymous dimensions.
4. Critical and high alerts create an immutable delivery receipt and link to the named runbook.
5. Health, backup and audit-anchor alerts remain independent of the application database they supervise.
6. Staging injects a synthetic failure for every alert before production approval; the deployment record retains the result and acknowledgement latency.

## Release gates

- No production release may label monitoring **verified** until the deployment adapter, dashboard, paging route and synthetic alert evidence exist.
- `deployment_health`, `backup_freshness` and `audit_anchor_failure` are release-blocking.
- Extraction quality is evaluated against the promoted holdout; a missing holdout result is a failed signal, not a zero-error result.
- Unit-cost thresholds are effective-dated configuration and must not be embedded in source.
- Tenant-denial and break-glass alerts are security events; access to their details follows the restricted audit role, not ordinary project membership.

## Operator evidence record

For each environment record the alert-pack hash, telemetry adapter/version, dashboard URL, paging destination reference, synthetic trigger time, delivery receipt, acknowledgement time, resolver, linked incident/change ID and any suppression with expiry/approver. Add those references to `DEPLOYMENT_RECORD.md`; never paste secrets or personal recipient details into source control.
