# AI platform foundation implementation

Status: **provider-free foundation implemented; runtime connection and production activation remain blocked**.

This implementation adds pure, typed control contracts for the next Valo AI
data plane and execution plane. The contracts can be exercised with synthetic
or explicitly approved redacted evidence, but importing or calling them does
not connect a model, database, queue, route, index, worker, evaluation writer,
or external tool. The existing production retrieval/index blocker and AI kill
switch remain unchanged.

## Implemented foundation map

| Improvement                                   | Implemented source                                                                                                                                                                                                                                           | Current boundary                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Evidence-grade ingestion and hybrid retrieval | `aiRetrievalPipeline.ts` validates tenant/project/version scope, lifecycle, declared source-hash shape, recomputed text hashes, lexical/vector/rerank scores, extraction quality, page/table spans, permissions, privacy approval and bounded context size.  | Pure selection contract; no immutable blob verifier, index or parser is connected.                                                     |
| Claim-level grounding and abstention          | `evaluateClaimGroundingAndAbstention` checks every material claim against exact retrieved spans and returns an explicit abstention/blocked disposition when coverage is absent, contradictory or invalid.                                                    | It does not generate prose or persist a claim.                                                                                         |
| Versioned continuous evaluation               | `aiContinuousEval.ts` binds cases and observations to model, configuration, prompt, schema, retrieval, index, policy and corpus versions and evaluates required cohorts.                                                                                     | Provider-free evaluator only; no production evidence writer is connected.                                                              |
| Risk-based human review                       | `assessAiHumanReviewRisk` derives a closed risk band and review mode from action class, data classification, grounding, calibrated confidence, injection/cross-tenant signals, monetary impact and version novelty.                                          | Consequential actions remain prohibited; decisions are not persisted.                                                                  |
| Privacy and tenant policy                     | Retrieval requires exact tenant/project actor scope, purpose, classification allow-list, redaction reference and PII minimisation. `approved_model` disclosure additionally requires approved region, no-training, retention and external-processing policy. | Approval inputs must later come from trusted policy services, never model/browser claims.                                              |
| Typed bounded orchestration                   | `createQueuedAiRun` and `transitionAiDurableRun` define idempotent, lease-aware state transitions, bounded attempts, cancellation, safe errors and named approvals.                                                                                          | No durable store, outbox, worker or scheduler is connected.                                                                            |
| End-to-end observability                      | `createPrivacySafeAiTraceEvent` validates versioned, content-free trace events and rejects unsafe error/detail fields.                                                                                                                                       | No trace sink, cost ledger or alert transport is connected.                                                                            |
| Retrieval/tool prompt-injection firewall      | `detectRetrievalInjectionSignals` and the retrieval builder reject instruction override, prompt probe, secret exfiltration, tool-execution and cross-tenant signals before context assembly.                                                                 | This is deterministic screening, not proof against every attack; live adversarial evaluation remains mandatory.                        |
| Quality-constrained model routing             | `routeQualityConstrainedModel` filters candidates by governance, region, retention, no-training, health, evaluated quality, context, latency and predicted per-request cost before deterministic selection.                                                  | It does not call a provider, evaluate Restricted Mode, enforce a worst-case retry budget or weaken the existing approved-adapter gate. |
| Scalable execution and backpressure           | The control-plane store interface defines atomic enqueue/CAS transitions, bounded `claimDue(limit)`, idempotency, leases, retries, expiry and cancellation without assuming an in-request model call.                                                        | Capacity admission, a production queue, reserved telemetry capacity and reconciliation workers are still absent.                       |
| Calibrated confidence and active learning     | `computeConfidenceCalibration`, `compareContinuousEvalRegression` and `selectActiveLearningCases` calculate calibration/regression evidence and bounded case selection without treating confidence as correctness.                                           | Selection does not train a model, move tenant data, or publish a baseline.                                                             |

The combined provider-free surface is exported by
`artifacts/api-server/src/lib/aiPlatformFoundation.ts`. Each of its three
foundation status records is immutable and reports `runtimeConnected: false`,
`productionApproved: false`, and `activation: blocked`.

## Fail-closed guarantees

- A foreign tenant/project, non-active or hash-invalid source, missing
  permission, unapproved classification, unscanned/flagged injection payload,
  stale retrieval/index version, or oversized context cannot be selected.
- A material factual claim cannot be marked grounded without exact evidence;
  unsupported or contradictory output abstains rather than relying on model
  confidence.
- A consequential action, injection signal or cross-tenant signal cannot be
  routed into execution. Reversible drafts require named review according to
  the risk decision.
- Model routing is governance- and quality-floor constrained. High/critical
  risk is quality-first; low/medium risk is cost-first only among candidates
  that meet the same quality, privacy, region, health and per-request cost
  policy. It performs no provider fallback on its own.
- Workflow transitions are deterministic and subject-bound. Approval, lease,
  idempotency and version data cannot silently transfer to a changed run.
- Evaluation results do not activate production. Release still requires the
  existing independent gate and retained evidence for the exact version set.

## Production activation remains blocked

The following are intentionally not implemented or authorised by this
foundation and remain deployment gates:

1. immutable page/table ingestion, OCR provenance, trusted source/blob hash
   verification, a scope-bound retrieval-result/manifest type, trusted claim
   classification and a real tenant-isolated lexical/vector index with deletion
   and version reconciliation;
2. approved provider/model, processing region, retention, no-training terms,
   restricted-mode eligibility, rate card and budget ledger;
3. trusted workflow/model-router registries, capacity admission, a durable
   queue/store/outbox, reserved worker/telemetry capacity, pre-disclosure
   attempt ledger, failed-attempt usage reconciliation and crash recovery;
4. authorised production holdouts and live observations for every required
   cohort, signed corpus governance and independent adjudication;
5. live two-tenant isolation, injection, load/backpressure, alert, rollback,
   shadow, pilot and canary evidence; and
6. named privacy, security, product, legal and operational acceptance.

Until those gates pass, Valo exposes only the deterministic Level-0
Intelligence Centre and provider-free foundation tests. No document content is
authorised for production model processing by this work.
