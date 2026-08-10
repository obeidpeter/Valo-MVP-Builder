# Final AI acceptance matrix

Status: **not accepted for production; production AI disabled**.

| Gate                             | Current evidence                                                                              | Result/blocker                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Source requirements baseline     | BP v1.1, Roadmap v1.0, TRD v1.0 observed                                                      | Blocked: requested BP v1.2/Roadmap v1.1 missing                                              |
| Human authority                  | Formal Level-2 policies, suggestion states, named review permissions, no AI status transition | Partial: full unauthorised-action/concurrency/replay E2E pending                             |
| Central gateway/runtime          | All five source workflows use project runtime/gateway                                         | Implemented in source; complete integration/deployment proof pending                         |
| Production release enforcement   | Every production project call recomputes private evidence gate                                | Implemented; correctly denies because valid evidence and retrieval/index versions are absent |
| Strict output containment        | Strict JSON Schemas, independent exact validators/sanitisers                                  | Implemented/unit-tested; live approved-adapter conformance pending                           |
| Production evaluation thresholds | Recomputed production profile                                                                 | Control implemented; no authorised live run                                                  |
| Authorised representative corpus | Manifest contract rejects current development corpus                                          | Blocked: current 14 cases synthetic/unverified; need 25+ adjudicated holdout cases           |
| Requirement/evidence grounding   | Exact named-source quote/excerpt checks and release recheck                                   | Partial: no independent immutable version/page/span resolver or live score                   |
| Fatal requirement recall         | Zero-miss gate and seeded-case requirement                                                    | Blocked: no authorised fatal holdout run                                                     |
| Unsupported claims               | Zero-rate/full-label gate                                                                     | Blocked: no complete claim registry/render/export coverage or live labels                    |
| Abstention/safe failure          | Separate production metrics                                                                   | Blocked: authorised negative corpus absent                                                   |
| Prompt injection                 | Structural taxonomy and strict containment                                                    | Partial: behavioural real file/OCR/retrieval/tool proof absent                               |
| Cross-tenant isolation           | Server-derived tenant and RLS/schema foundations                                              | Blocked: production-like two-tenant proof across every data plane absent                     |
| OCR truthfulness                 | Verbatim prompt and extraction telemetry                                                      | Blocked: page-level labelled results absent                                                  |
| Provider/privacy/residency       | Fail-closed adapter/gateway contracts and decision template                                   | Blocked: provider/DPA/DPIA/region/retention/no-training decisions unapproved                 |
| Restricted Mode                  | Current external adapter is ineligible and gateway denies it                                  | Control implemented; manual/approved alternative operational proof pending                   |
| Cost/latency budgets             | Per-run ceilings, budget/rate-card and usage checks                                           | Blocked: budgets undecided; no durable concurrent ledger or measured envelope                |
| Version traceability             | Gate binds model/prompt/schema-set/retrieval/index versions                                   | Blocked: retrieval/index unimplemented/unpinned; no valid evidence bundle                    |
| Kill switch/capability gates     | Source-level global, environment and tenant gates                                             | Partial: deployed in-flight/alert/rollback exercise absent                                   |
| Operations visibility            | Direct-internal-role, organisation-scoped safe endpoint and UI with generated contract        | Partial: target deployment/security/monitoring acceptance pending                            |
| Durable run trace                | Same-tenant independent settlement survives business-workflow rollback                        | Partial: pre-disclosure start record, dedicated capacity and durable cost ledger absent      |
| Monitoring/alerts                | Signal/runbook design                                                                         | Blocked: backend, pager, thresholds and delivery receipts absent                             |
| Shadow/pilot/canary              | Staged plan                                                                                   | Blocked: no retained execution evidence                                                      |
| Deployment/smoke/rollback        | Acceptance checklist exists                                                                   | Blocked: target-environment evidence absent                                                  |

## Release verdict

The current controls materially reduce risk and should be retained. They do not
authorise production. Resolve every blocked row, all high/critical security
findings, source-version control and named owner approvals before setting any
production global or capability enablement.

The only accepted target-environment state today is **AI disabled with manual
workflows available**.
