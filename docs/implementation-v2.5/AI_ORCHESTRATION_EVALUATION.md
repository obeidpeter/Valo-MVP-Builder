# AI orchestration and evaluation

AI is an untrusted assistant inside a deterministic product. It may propose extraction, classification, summaries, drafts and red-team findings; it may not approve evidence, remove/reclassify a fatal blocker, grant entitlement, alter billing, assign tenant access or mark a package ready.

## Pipeline contracts

| Stage               | Inputs                                                 | Output                                 | Required gate                                                       |
| ------------------- | ------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------- |
| OCR fallback        | Cleared immutable page image                           | Page text + layout + confidence        | Schema, page alignment, provider provenance                         |
| Extraction          | Versioned page spans                                   | Candidate requirement/citation objects | Schema + citation resolver + human/approved low-risk policy         |
| Classification      | Confirmed text/context                                 | Category/severity suggestion           | Deterministic allowed values; human confirmation for material items |
| Evidence suggestion | Confirmed requirement + tenant evidence index          | Candidate evidence links/excerpts      | Tenant scope + reviewer approval                                    |
| Drafting            | Confirmed requirements + approved facts + instructions | Structured blocks with fact provenance | Claim resolver; unresolved blocks release                           |
| Red team            | Versioned package inputs/rubric                        | Suggested defects with citations       | Schema + human disposition; cannot self-clear                       |
| Summary             | Approved state only                                    | Plain-language status                  | Must not create or change authoritative state                       |

All prompts and model configurations are versioned. Runs record tenant, document/input digests, prompt/model/provider/config versions, retrieval references, output digest, schema result, latency, token/cost data, retry/fallback and human disposition.

## Retrieval boundaries

Indexes are tenant partitioned. A retrieval request names the engagement, permitted evidence states, time validity and purpose. Search results are re-authorised against source records before entering context. Provider caches and telemetry must follow the same no-training/retention/cross-border policy. The model never receives database credentials, object-store credentials or arbitrary tools.

## Prompt-injection controls

- Parse only cleared files in a sandbox with resource limits.
- Mark document text as data using fixed delimiters and typed fields.
- Use allow-listed schemas; reject extra fields and out-of-engagement IDs/citations.
- No document-controlled tool call, URL fetch, prompt override, provider choice or retrieval expansion.
- Detect hidden text/layers and retain visible-vs-extracted discrepancies for reviewer inspection.
- Include direct/indirect injection, exfiltration, fake system messages, malicious images, poisoned evidence and cross-tenant lures in the corpus.
- Capture denials and new attack patterns without logging sensitive source text.

## Evaluation datasets

Dataset manifests state source, permission/consent, jurisdiction, tender types, agencies, native/scanned mix, page ranges, layout complexity, language, time period, exclusions, labels, annotators, adjudication, leakage controls and version hash. Training/development and unseen holdout are organisation/document-family separated. Production client documents do not become shared evaluation data without an explicit lawful/contractual basis and governed consent.

## Metrics and release gates

- Requirement recall >= 95% on the unseen representative holdout.
- Citation correctness >= 98%, where both source identity and exact locator resolve.
- Fatal and likely-fatal recall reported separately; zero fatal miss on the release-blocking labelled set.
- Seeded unsupported claims rejected 100% by the claim resolver.
- Structured-output validity, false-positive rate, calibration by field class, cost, latency and fallback rate reported.
- OCR quality reported by native/scanned/layout cohort; no aggregate hides a weak critical cohort.
- Auto-confirm graduation requires >= 99% precision on an unseen representative set for a narrowly named field class, minimum sample size approved in a graduation memo, no fatal/likely-fatal class, and continuous rollback thresholds.

No threshold is claimed until a retained run report states sample size, confidence interval/limitations and failing cases. The observed repository's evaluation scripts are a useful baseline but not evidence that these v2.5 gates pass.

## Promotion and rollback

Prompt/model/OCR/provider changes run unit/schema tests, injection corpus, fixed regression set and unseen holdout comparison. Promotion requires quality owner approval and no material security, subgroup, cost or latency regression. Canary runs do not auto-confirm or release packages. Rollback pins the prior prompt/model/provider configuration and reprocesses only through an audited explicit command.

## Provider outage behaviour

Fail closed on approval/readiness. Persist visible job state, retry only retry-safe calls with bounded backoff, and use a validated fallback adapter if tenant residency/terms and evaluation gates permit it. Otherwise create a human/manual task. A fallback never changes evidence or approval semantics.

## Human correction loop

Confirm/edit/reject/merge/split/reopen decisions preserve original suggestion, reviewer, timestamp and reason. Approved corrections can be proposed for the governed evaluation corpus only after consent/licence and privacy review. Model quality is never inferred from commercial conversion or award outcome.
