# Monitoring and alerting contract

Status: **privacy-safe runtime signal foundation implemented; telemetry backend and paging adapter not deployed**.

The machine-readable alert pack is `config/observability/alerts.v2.5.json`. CI validates that every mandatory operational signal has an identifier, severity, condition and runbook. The API now emits aggregate HTTP duration/status, database-pool pressure and lifecycle snapshots to structured logs, with bounded request correlation IDs. Its delivery status explicitly reports external metrics and paging as `disconnected`. The pack deliberately carries `deployment_adapter_required`; source signals and policy are not evidence that alerts are evaluated or people are paged.

## Probe contract

- `GET /api/healthz` is unauthenticated process **liveness**. It does not query Clerk, PostgreSQL or a provider. Use it only to decide whether the process should be restarted.
- `GET /api/readyz` is unauthenticated deployment **readiness**. It returns `200` only while the runtime accepts traffic and a bounded PostgreSQL probe succeeds; starting, draining, timeout and database failure return `503`. Responses are `private, no-store` and expose no dependency error details.
- The deployment load balancer and the `deployment_health` alert use `readyz`. They must not substitute `healthz`, because a live process can correctly refuse traffic while its dependency is unavailable or while it drains.
- External metrics/paging delivery is informational in the readiness body and remains `disconnected` until installed and verified. Missing optional delivery does not make the API dependency probe lie; the release gates below still prohibit calling monitoring verified.

## Required signal flow

1. API, worker, database, storage and provider adapters emit structured metrics without document content, personal data, tokens or secrets.
2. The deployment adapter maps each stable signal name in the alert pack to the selected metrics backend.
3. Alert evaluation preserves organisation identifiers only where the incident responder is authorised to see them; shared dashboards use aggregate or pseudonymous dimensions.
4. Critical and high alerts create an immutable delivery receipt and link to the named runbook.
5. Liveness, backup and audit-anchor alerts remain independent of the application database they supervise. Deployment readiness deliberately probes the application database.
6. Staging injects a synthetic failure for every alert before production approval; the deployment record retains the result and acknowledgement latency.

## Release gates

- No production release may label monitoring **verified** until the deployment adapter, dashboard, paging route and synthetic alert evidence exist.
- `deployment_health`, `backup_freshness` and `audit_anchor_failure` are release-blocking.
- Extraction quality is evaluated against the promoted holdout; a missing holdout result is a failed signal, not a zero-error result.
- Unit-cost thresholds are effective-dated configuration and must not be embedded in source.
- Tenant-denial and break-glass alerts are security events; access to their details follows the restricted audit role, not ordinary project membership.

## Operator evidence record

For each environment record the alert-pack hash, telemetry adapter/version, dashboard URL, paging destination reference, synthetic trigger time, delivery receipt, acknowledgement time, resolver, linked incident/change ID and any suppression with expiry/approver. Add those references to `DEPLOYMENT_RECORD.md`; never paste secrets or personal recipient details into source control.

Runtime budgets, graceful shutdown behavior and the commit-before-stream gate are recorded in [RUNTIME_RELIABILITY.md](RUNTIME_RELIABILITY.md).
