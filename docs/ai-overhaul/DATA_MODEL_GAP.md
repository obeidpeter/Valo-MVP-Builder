# AI data-model inventory and gap analysis

Status: **schema inventory, not migration/deployment proof**.

The repository declares both legacy workflow tables used by current routes and
broader governed-platform tables intended for later processing/evaluation. A
declared table is not necessarily populated, migrated in the target database or
used by the AI runtime.

## 1. Current workflow records

| Record           | Relevant fields                                                                                         | Current AI use                                       | Gap                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `documents`      | tenant/project, object path, SHA-256, extracted text/status/method/confidence/notes                     | Source text and OCR/transcription state              | No immutable page/span model in current route path; heuristic OCR quality                                                      |
| `requirements`   | source document/page/clause, text, review state, origin, engine text, merged citations, reviewer stamps | Suggested grounded requirements and human review     | Grounded quote is encoded in citation JSON rather than a first-class immutable citation relation in current path               |
| `evidence_items` | requirement/document, status, excerpt, notes, `suggested`, confirmer                                    | Suggested mappings; confirmed rows feed later review | No first-class grounding verification/version/date-decision record                                                             |
| `defects`        | requirement, type, severity, description, evidence snapshot, status, `suggested`                        | Suggested defects and reviewer state                 | Reviewer identity/history is less explicit than requirements; lifecycle event model should be verified                         |
| `projects`       | Restricted Mode, responsiveness narrative and `responsivenessSuggested`                                 | Source for tenant/privacy mode and AI draft marker   | Draft provenance is not a dedicated versioned narrative entity                                                                 |
| `llm_runs`       | tenant/project, task, model/prompt, input hash, bounded output summary, tokens, safe error              | Current safe run/provenance telemetry                | No dedicated columns for all gateway telemetry, reservation/actual cost, status, provider/schema/config IDs or retention class |
| `feature_flags`  | optional tenant, key, enabled/configuration                                                             | Per-tenant capability gate                           | Need lifecycle/approval/expiry and tested global-vs-tenant precedence                                                          |

## 2. Declared governed-platform records

The schema also declares `document_versions`, `processing_jobs`,
`processing_runs`, `model_configurations`, `prompt_configurations`,
`requirement_citations`, `evaluation_cases`, `evaluation_runs` and
`evaluation_results`, plus retention/deletion records. These are useful target
foundations, but the current request/response AI runtime does not use them as a
complete authoritative orchestration/promotion plane.

Do not claim durable AI jobs, queue processing, relational citation resolution,
database-backed model promotion or corpus execution solely because these table
definitions exist.

## 3. Material gaps

### DM-AI-001 — Capability and policy versions

Add an immutable capability-policy version or release manifest that binds
autonomy, limits, approval authority, code release and effective dates. Source
constants alone are difficult to audit after deployment.

### DM-AI-002 — Provider governance decisions

Add records for provider/legal entity/model, DPA/subprocessor reference,
no-training verification, approved regions, retention/deletion posture,
Restricted Mode eligibility, evidence version, approvers, effective/expiry
dates and revocation. Environment variables should reference approved records,
not substitute for them.

### DM-AI-003 — Budget reservation and settlement

Add tenant/engagement/period budget policies and an append-only ledger with
reservation, release, actual settlement, currency, rate-card version,
idempotency key and concurrency-safe remaining balance. The current
environment-provided `remainingMinor` check is a per-call fail-closed guard, not
a durable monthly/engagement budget.

### DM-AI-004 — First-class AI run provenance

Each run should bind:

- capability/policy version and organisation/project;
- provider/model configuration and governance evidence;
- prompt/schema versions and hashes;
- retrieval/index/source-manifest versions;
- idempotency, status, attempts/fallback and cancellation;
- input/output hashes, token usage, latency and reserved/actual cost;
- safe error, retention class and review/output entity links.

Raw tender/bid content must not be copied into the run record.

### DM-AI-005 — Suggestion/review event ledger

Create immutable events for proposed, grounded/downgraded/dropped, edited,
confirmed, rejected, merged, superseded and released states. Record actor,
permission, timestamp, before/after hashes and reason. Avoid relying only on a
mutable Boolean/status plus general audit log.

### DM-AI-006 — Citation and claim graph

Use first-class immutable document-version spans and claim-to-citation links.
Store canonical snippet hash, coordinates, resolver version, verification
status and human adjudication. Requirements, evidence, defects and report
claims should link to these records rather than only embedding JSON/text.

### DM-AI-007 — Retrieval/index data

If retrieval is approved, add tenant-partitioned chunk manifests, embedding and
index versions, active/superseded/tombstone state, parser/OCR/chunker versions,
source hashes, cache invalidations and deletion receipts. This does not exist
today.

### DM-AI-008 — Evaluation manifest and approvals

Persist corpus authorisation, pseudonymous source hash, split/cohorts,
synthetic/production eligibility, annotation/adjudication evidence, exact
release-version manifest, per-case results, limitations and named release
approvals. The current source manifest is development-only and has 14 synthetic
cases.

### DM-AI-009 — Alerts and incidents

Add alert rule/version, event, tenant-safe dimensions, delivery attempts,
acknowledgement, incident link, suppression and resolution. Operations source
currently exposes recent state but is not an alerting backend.

### DM-AI-010 — Memory, tool and outbox records

No memory, general tool or transactional AI outbox should be added under the
current release. If separately approved, they need immutable tenant scope,
purpose/expiry, authorisation and execution/replay ledgers.

## 4. Migration requirements

Before adopting new records:

1. create additive migrations with explicit tenant keys, foreign keys, unique
   idempotency constraints and indexes;
2. enable and test RLS for every tenant record;
3. backfill only from verifiable source, labelling legacy/unknown values;
4. dual-write and reconcile before changing the read authority;
5. test rollback without dropping user data;
6. verify retention/deletion cascades, backups and legal holds;
7. generate and validate API/client contracts;
8. retain production-like migration and two-tenant negative-test evidence.

This overhaul does not add database migrations. Schema changes require a
separate reviewed migration plan after the provider, retrieval and budget
decisions are made.
