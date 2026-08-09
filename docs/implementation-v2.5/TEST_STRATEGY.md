# Test and evaluation strategy

Status: target verification plan. A command listed here is not a result. Results belong in retained CI/deployment artefacts and `ACCEPTANCE_REPORT.md`.

## Principles

- Test invariants at the lowest layer and again at API/end-to-end boundaries.
- Use a disposable real PostgreSQL database with RLS, S3-compatible storage, durable queue/job store and provider simulators for integration/E2E.
- No production client document enters a fixture without explicit permission, minimisation and tenant-isolated handling.
- Critical claims require observable evidence: command, artefact version, environment, timestamp, result and retained logs/report.
- A flaky, skipped or quarantined critical-path test is a failed release gate.

## Test layers

| Layer                  | Scope                                                                                        | Gate                                   |
| ---------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------- |
| Unit                   | Value objects, state transitions, permissions, money/time, rule packs, sanitisation          | Every PR                               |
| Property-based         | Fatal/readiness invariants, decimal arithmetic, entitlement, idempotency, transition closure | Every PR for critical modules          |
| Database integration   | Constraints, transactions, RLS, migrations, locks, outbox/jobs                               | Every PR with disposable PostgreSQL    |
| Adapter contract       | Normalised provider behaviour, timeouts, retries, signatures, reconciliation                 | Every PR; live sandbox pre-release     |
| API contract           | OpenAPI conformance, generated-client drift, auth/tenant/error/idempotency/version headers   | Every PR                               |
| Component              | Accessible UI state and server error/partial outcomes                                        | Every PR                               |
| End-to-end             | Role journeys through real persistence/storage/jobs                                          | Merge/release                          |
| AI/OCR evaluation      | Holdout quality, injection, schema, citations, cost/latency                                  | Model/prompt/provider changes; release |
| Golden/render          | DOCX/PDF/ZIP structure and visual pages                                                      | Assembly changes; release              |
| Security               | SAST/SCA/secrets/SBOM, DAST, tenant/role abuse, file hostility                               | PR/release as applicable               |
| Accessibility          | axe plus keyboard/screen-reader/reflow/zoom                                                  | PR for screens; manual release gate    |
| Performance/resilience | Load, soak, queue fairness, failover, recovery                                               | Staging release gate                   |
| Operations             | Migration, backup/restore, rollback, incident/DR, smoke                                      | Release cadence and before GA          |

## Critical invariant matrix

| Requirement                         | Test design                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| INV-01 citations                    | Generate valid/invalid page/paragraph/table/coordinate references; reject wrong version/out-of-source locators                       |
| INV-05 grounded claims              | Seed valid, expired, withdrawn, missing and cross-tenant evidence; only valid approved facts can render                              |
| INV-06 fatal gate                   | Generate arbitrary state/defect sequences; package sign never succeeds with open fatal/likely-fatal                                  |
| INV-07 independent reclassification | Same actor, missing reason/evidence, expired grant and concurrent decisions all fail                                                 |
| INV-08 no price generation          | Model/provider outputs containing new rates cannot populate BOQ/commercial entities or released draft                                |
| INV-10 tenant isolation             | For every endpoint/table/object/search/job, tenant B identities cannot observe/mutate tenant A, including IDs discovered out of band |
| INV-11 conflicts                    | Same canonical tender+lot under concurrency blocks assignment until governed decision; changed lot rechecks                          |
| INV-13 audit                        | Mutation/denial/provider/replay/break-glass produces chained event; tamper and missing anchor alert                                  |
| ENT-002 entitlement                 | Stale/failed/refunded/ambiguous payment and disabled flag cannot grant work/export                                                   |
| PKG-002 visual QA                   | Render fixtures; structural test plus named visual checklist required before sign                                                    |

Critical invariant modules require 100% branch coverage. Coverage includes negative/denial branches and is reported by requirement ID.

## Security/role matrix

For each permission action, generate: every role, owning/non-owning tenant, assigned/unassigned engagement, direct/partner relationship, active/expired/revoked grant, feature on/off, normal/break-glass session and object state. Assert status/body non-disclosure, database effect and audit event. Direct database tests run with the application role and prove `FORCE ROW LEVEL SECURITY`; table owners/bypass roles are prohibited.

## Document fixture corpus

- Native and scanned PDFs; mixed orientation; stamps; low contrast; handwriting flags; hidden text/layers.
- DOCX with tables, tracked changes, comments, headers/footers and malicious hyperlinks/fields.
- XLSX with formulas vs cached values, hidden rows/columns/sheets, merged cells, dates, locales, currencies, multiple lots, circular/error cells and words/figures.
- JPEG/PNG; ZIP nesting, duplicate names, traversal paths, decompression bombs and encrypted archives.
- Corrupt, truncated, password-protected, wrong MIME/signature, duplicate and very large boundary cases.
- Tender addenda/replacements with requirement impact and stale approval/package invalidation.

Malware test samples use safe industry fixtures such as EICAR only in an isolated test environment; never commit active malware.

## AI/OCR evaluation

Follow `AI_ORCHESTRATION_EVALUATION.md`. Retain dataset manifest, per-case outputs, aggregate/cohort metrics, exact prompt/model/OCR versions, cost/latency, errors and reviewer adjudication. Release gates are >=95% requirement recall, >=98% citation correctness, separate fatal/likely-fatal recall, zero fatal miss in the blocking set, 100% seeded unsupported-claim rejection and approved auto-confirm precision >=99% for each narrow field class. No pass is inferred from undersized or leaked data.

## BOQ properties

- Exact decimal distributive/boundary cases under the applicable rounding rule.
- Sum of extensions and cross-document total consistency.
- Currency/lot/tax/bid-security rules resolve by effective pack and tender overlay.
- Parser preserves raw/formula/display/hidden/merged metadata and original hash.
- Seeded deterministic errors are all detected; verifier never writes a rate/price.
- Large magnitudes cannot overflow JS safe integer or decimal precision.

## Concurrency/idempotency

Race: two reviewers edit/approve/reclassify; addendum during sign-off; evidence expires during assembly; payment webhook repeats/reorders; worker lease expires; upload completion repeats; export delivery times out after provider success. Exactly one intended effect occurs, stale commands return a conflict/recovery path, and audit/outbox stay consistent.

## Accessibility

Automated checks cover every critical page state. Manual script covers skip/focus, keyboard review and grids, modal focus restore, error recovery, progress announcements, 200% zoom, 320px reflow, contrast/non-colour status, reduced motion and accessible authentication. Test NVDA+Chrome on Windows and one mobile browser/screen reader. Store issue IDs/screenshots where policy permits; no critical/serious issue remains at release.

## Performance and resilience profiles

The release test plan declares realistic tenant/document/queue distributions before execution. Measure ordinary API P50/P95/P99, error rate, DB saturation, queue wait/run time, OCR/model/provider failure, cost and tenant fairness. P95 ordinary interactive response must be under 2 seconds excluding async processing. Exercise provider latency/outage, database restart, storage errors, worker loss, dead letters, retry storms and deadline peaks. Do not load-test production without written approval.

## Migration, backup and rollback

- Apply migrations to an anonymised production-shaped snapshot; verify counts, constraints, RLS and representative packages.
- Re-run safely/idempotently where designed; test interrupted backfill/resume.
- Restore encrypted backup into an isolated environment, rotate credentials, run integrity/anchor checks and critical smoke.
- Demonstrate RTO <=4 hours and the approved RPO; record actual values.
- Deploy previous compatible application against expanded schema and execute rollback runbook; forward repair is tested for data changes.

## CI gates

Formatting, lint, typecheck, build, migration validation, unit/property/integration/contract tests, critical coverage, secret scan, SAST, dependency/container/IaC scan, SBOM/provenance, AI/injection regression, document render tests and artefact signing. Staging promotion adds E2E, DAST, accessibility manual evidence, performance, backup/restore/rollback and post-deploy smoke.

## Observed baseline tests

The archive includes focused tests for deterministic logic, scorecard, audit chain, report/golden generation, sanitisation/evaluation, retention, governance/config/dashboard/merge/export routes and frontend readiness/access routing. This is useful partial coverage. Property testing, exhaustive permission/RLS, full E2E, accessibility, load, migrations/rollback, restore/DR and broad document hostility are not evidenced by filenames alone.

## Result template

```text
Evidence ID:
Requirement IDs:
Artefact/commit:
Environment and dependency versions:
Dataset/fixture version and sample size:
Command or runbook step:
Started/completed UTC:
Result and measurements:
Report/log URI + SHA-256:
Known exclusions/limitations:
Approver:
```
