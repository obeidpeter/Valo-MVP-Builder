# Business-rule traceability

The source-version gap in [Baseline audit](BASELINE_AUDIT.md) applies to this
matrix. “Required evidence” means retained execution evidence, not a design
statement or environment variable.

| Rule                                                | Current enforcement in source                                                                                                   | Required evidence before production                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| AI assists; humans decide                           | Five Level-2 draft policies; suggestion states; named review authorities; no AI status transitions                              | End-to-end approval, unauthorised-action, concurrency and replay suite                                |
| Every requirement has exact source provenance       | Non-empty source quote required; exact containment in selected named document; merge provenance retained                        | Independent document-version/page/span resolver and authorised citation score                         |
| Positive evidence uses approved source              | `present`/`expired` requires named-document excerpt or becomes `unclear`; release uses reviewed/grounded state                  | Validity/applicability rules, claim graph and every render/export-path proof                          |
| Fatal findings cannot be waived by AI               | Defect output is suggested; AI cannot close/downgrade; deterministic readiness uses reviewed state                              | Property/concurrency tests over every release/export path and reviewer authority                      |
| Tenant boundaries are server-derived                | Runtime derives organisation/Restricted Mode from project; route/RLS foundations; operations queries filter active organisation | Two-tenant DB/storage/retrieval/cache/queue/tool/provider/export E2E in target environment            |
| Files and retrieved content are tainted             | Shared prompt policy, strict schemas, sanitisation and structural injection taxonomy                                            | Behavioural authorised PDF/OCR/table/image/metadata and future retrieval/tool suite                   |
| Model/prompt/data changes are evaluation-gated      | Runtime recomputes release evidence; exact model/prompt/schema/retrieval/index comparison                                       | Valid private evidence bundle and live production-profile run for real pinned versions                |
| AI spend is bounded                                 | Capability ceilings, approved budget requirement, pre-disclosure conservative estimate and post-call usage/cost check           | Approved monthly/tenant/engagement budgets and transactional reservation/settlement under concurrency |
| Every capability can be disabled                    | Emergency/global and environment/tenant capability gates in source                                                              | Deployed kill-switch, in-flight behaviour, alert and rollback drill receipts                          |
| Provider processing is approved                     | Provider governance/region/retention/Restricted Mode/health gates; fallback cannot weaken governance                            | Approved provider/DPA/DPIA/residency/deletion evidence and live conformance test                      |
| Ordinary logs contain no client content             | Input hash, counts, bounded provenance and safe errors; operations redacts legacy errors                                        | Canary-string scan across application/provider/infrastructure/alerts and retention proof              |
| No partial or malformed AI output becomes fact      | Strict provider schema, exact server validator, sanitiser, grounding, suggestion state                                          | Integration/property tests against live approved adapter and telemetry/database failure paths         |
| Production requires representative quality evidence | Production profile and manifest contract reject current corpus                                                                  | At least 25 authorised adjudicated holdout cases, all cohorts/thresholds, retained per-case results   |

Commercial results, award predictions and evaluator simulation are never AI
quality labels and must not be introduced into the evaluation corpus.
