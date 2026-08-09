# Administrator guide

This guide covers organisation/operations/platform administrators. It never authorises standing cross-tenant content access.

## Daily start

Check health/readiness, queue/dead letters, provider reconciliation, SLA/deadlines, notification failures, backup age, audit-anchor freshness, security alerts and expiring evidence. Work from redacted metadata; open restricted content only through assignment or approved break-glass.

## Organisations and access

Verify legal/tenant identity before activation. Invite users by scoped membership; use the minimum role and engagement scope with expiry. Ownership, privileged grants, partner relationship and break-glass require the configured dual control. Revocation must invalidate sessions/jobs/download links where supported. Review access monthly and after personnel/partner changes.

## Operational queues

For quarantined files, do not download to an unmanaged device; inspect scanner/parser metadata, obtain password through approved channel if policy allows, and explicitly clear/reject/retry. Dead-letter replay requires root cause, idempotency review and reason. Provider/webhook exceptions reconcile before state/entitlement is changed.

## Flags, adapters and rule packs

Development adapters are forbidden outside development/test. Feature flags default off; record owner, reason, tenant scope and expiry. Test on/off and server denial before activation. Rule packs require authoritative source/hash, effective dates, deterministic tests and legal/product approval; supersede rather than edit historical versions.

## Security/privacy operations

Use break-glass only for a ticketed urgent purpose with narrow tenant/scope/TTL and after-action review. Legal holds block deletion. DSR/retention completion verifies all storage/search/provider actions before certificate. Escalate suspected exposure, wrong-tenant result, fatal bypass, secret/content logs or anchor gap immediately under incident response.

## Release/export

Administrators cannot make a blocked package ready. Verify named reviewer/approver, source/evidence versions, fatal/BOQ/red-team gates, render and human visual QA. Exports are signed/expiring and delivery receipts reconciled. Never send through personal email/WhatsApp or a public link.
