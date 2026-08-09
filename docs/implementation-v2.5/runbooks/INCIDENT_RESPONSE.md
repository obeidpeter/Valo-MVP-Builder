# Incident response runbook

## Severity

| Severity | Examples                                                                                                                                            | Initial response target |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| SEV-1    | Cross-tenant exposure, confirmed data exfiltration, fatal-gate bypass in released package, destructive corruption, widespread outage near deadlines | Immediate page/war room |
| SEV-2    | Contained tenant security/privacy incident, significant provider outage, audit anchor gap, missed backup/RPO, major workflow unavailable            | Urgent same shift       |
| SEV-3    | Degraded non-critical feature, recoverable job backlog, isolated notification failure                                                               | Business-hours queue    |

Targets are operational goals, not external notification-law conclusions.

## First response

1. Create incident ID and appoint commander, security/privacy lead, operations lead and communications owner.
2. Record detection time, affected environments/tenants/data/workflows, current deadline impact and known facts; do not speculate.
3. Contain with the narrowest reversible action: disable feature/provider, revoke grants/sessions/keys, pause job class/export, isolate node/tenant. Preserve audit/log/provider evidence.
4. For cross-tenant or release-gate risk, disable affected capability globally and prevent package export until proven safe.
5. Establish clean communication channel; never paste credentials or tender content into chat/tickets.

## Investigate and eradicate

Build a timeline from redacted logs, database/audit/anchor, provider receipts and artefact hashes. Identify entry, scope, persistence, impacted data subjects/clients/packages and whether safeguards failed. Patch/configure in staging, run regression/tenant/invariant tests, rotate affected secrets/keys and reconcile external side effects.

## Privacy/legal decision

Privacy lead/DPO records controller/processor roles, data/categories/subjects, likely risk, discovery/awareness times, containment, transfers and notification decision under the current NDPA/GAID rule pack and contract. Processor informs controllers without undue delay. Regulatory/data-subject/client timing/content is determined by authorised counsel/DPO, not improvised or delayed until perfect certainty.

## Recover

Use clean artefacts and `RESTORE.md`/`ROLLBACK.md`; enable side effects/flags gradually; verify tenant isolation, critical gates, provider reconciliation, audit anchors, backup and smoke. Communications state what happened, impact, actions, required client steps and next update without exposing another tenant.

## Close

Named owners approve closure after monitoring. Within the agreed review window, produce blameless timeline/root cause, control/test/runbook changes, affected requirement IDs, notification record, evidence hashes and due-dated actions. Add new malicious/provider/document cases to the governed test corpus where lawful.
