# AI deployment and acceptance plan

Current verdict: **do not deploy or enable production AI**.

Source-level controls do not substitute for provider decisions, authorised
evaluation, production-like validation, staged rollout or named acceptance.

## 1. Hard prerequisites

All items require retained evidence for the exact release candidate:

- reconcile Business Plan v1.2 and Product Roadmap v1.1 with this baseline;
- approve capability/autonomy owners and human review contracts;
- approve provider and fallback, legal entity, model allowlist and DPA;
- approve processing region/residency, retention/deletion, no-training evidence,
  DPIA and Restricted Mode posture;
- approve currency, per-run, monthly, tenant and engagement budgets, token and
  latency envelopes and rate card;
- build/version retrieval and index components required by the release gate, or
  formally revise and re-review the gate design for a non-retrieval release;
- run the production evaluation on at least 25 authorised adjudicated holdout
  cases and pass every metric/cohort/security threshold;
- prove two-tenant isolation across all deployed data planes;
- prove global/capability kill switches, rollback and alert delivery;
- complete shadow, internal pilot, tenant pilot and canary evidence.

None of these approvals should be inferred from code or environment values.

## 2. Configuration inventory

Values below are configuration inputs, not approval records. Secrets must come
from the deployment secret manager and must never appear in logs or this pack.

### Global, capability and release gates

- `NODE_ENV=production`
- `VALO_AI_KILL_SWITCH` (set `true` for emergency disable)
- `VALO_AI_GLOBAL_ENABLED=true` only after final acceptance
- `VALO_AI_<CAPABILITY>_ENABLED=true` only for accepted capabilities
- tenant feature flag `ai_<capability>` only for accepted tenants
- `VALO_AI_RELEASE_EVIDENCE_PATH` to a private absolute retained evidence file
- a deployed tenant-isolated retrieval/index registry that reports its live
  pinned versions; operator-authored environment labels are intentionally
  ignored and cannot unlock production

The evidence file must be a regular, non-symlink file, non-empty and at most 5
MiB. On non-Windows systems it must not grant group/other permissions. It must
not live in a user-upload or otherwise writable content directory.

### Model and evaluation status

- `VALO_AI_MODEL_ID`
- `VALO_AI_MODEL_CONFIGURATION_VERSION`
- `VALO_AI_MODEL_STATUS=promoted`
- `VALO_AI_MODEL_EVALUATION_APPROVED=true`

The runtime still recomputes the retained release evidence; these flags cannot
bypass it.

### Provider governance (current OpenAI adapter)

- `AI_INTEGRATIONS_OPENAI_BASE_URL` and secret API key
- `OPENAI_ADAPTER_PRODUCTION_APPROVED=true`
- `OPENAI_ADAPTER_NO_TRAINING_VERIFIED=true`
- `OPENAI_ADAPTER_RETENTION_MODE` and, for bounded mode, retention days
- `OPENAI_ADAPTER_APPROVED_REGIONS`
- `OPENAI_ADAPTER_DPA_APPROVED=true`
- `OPENAI_ADAPTER_GOVERNANCE_EVIDENCE_VERSION`

The current adapter is externally hosted and explicitly ineligible for
Restricted Mode. Provider approval and region/retention evidence are undecided.

### Runtime privacy and budget policy

- `VALO_AI_REQUIRED_REGION`
- `VALO_AI_REQUIRE_ZERO_RETENTION`
- `VALO_AI_MAX_RETENTION_DAYS`
- `VALO_AI_BUDGET_APPROVED=true`
- `VALO_AI_BUDGET_CURRENCY=NGN` for the current capability policy
- `VALO_AI_APPROVED_BUDGET_REMAINING_MINOR`
- `VALO_AI_INPUT_COST_MINOR_PER_1K_TOKENS`
- `VALO_AI_OUTPUT_COST_MINOR_PER_1K_TOKENS`
- `VALO_AI_RATE_CARD_VERSION`

The remaining-balance variable is not a durable concurrent budget ledger. That
gap must be resolved or explicitly risk-accepted before production.

## 3. Build and migration verification

Retain results for:

- clean install from lockfile and production build;
- API and workbench typechecks/tests;
- AI policy, prompt/schema, gateway/runtime, provider, grounding, release-gate,
  operations authorisation/redaction and workflow tests;
- OpenAPI validation and generated-client drift check;
- database migration rehearsal, RLS policy inspection and rollback;
- secret/conflict/PII/canary scan of source, build artefacts and logs;
- dependency/licence/vulnerability review;
- production-like two-tenant, concurrency, cancellation and replay tests.

Offline structural tests and synthetic fixtures are useful but do not satisfy
live evaluation or deployment evidence.

## 4. Pre-disclosure smoke test

With provider disclosure still disabled:

1. verify the application starts and non-AI workflows remain available;
2. verify operations shows production AI disabled and expected blockers;
3. verify global kill switch denies every capability;
4. verify missing/unsafe/invalid release evidence denies every capability with
   `AI_RELEASE_GATE_DENIED`;
5. verify absent tenant flag, environment flag, model promotion, budget,
   privacy/region/retention or provider health each fails closed;
6. verify Restricted Mode denies the external adapter;
7. verify no denial discloses document content or provider detail;
8. verify manual workflows and actionable safe errors.

## 5. Authorised-provider smoke test

Only after privacy/security approval, use non-sensitive authorised fixtures:

- one valid strict-schema response per capability;
- invalid JSON, valid-but-wrong-schema and oversized output;
- timeout, cancellation, 429/5xx and total outage;
- fallback with weaker governance (must be denied) and approved equivalent
  fallback;
- missing token usage and cost overrun;
- exact source grounding success/failure;
- telemetry persistence failure (successful output must fail closed);
- canary-string scan across all logs and provider controls.

Do not use customer data for a smoke test unless explicitly authorised.

## 6. Staged rollout acceptance

| Stage          | User-visible output                 | Business writes  | Required exit evidence                                                                          |
| -------------- | ----------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------- |
| Offline        | None                                | None             | All code/security/eval-contract tests; approved decisions                                       |
| Shadow         | None                                | None             | Authorised traffic, comparison report, no tenant/privacy/cost breach, alerts/kill switch proven |
| Internal pilot | Named internal reviewers            | Suggestions only | Review outcomes, support readiness, no high/critical open finding                               |
| Tenant pilot   | Selected tenants/roles/capabilities | Suggestions only | Tenant consent/communications, correction and incident thresholds pass                          |
| Canary         | Bounded accepted traffic            | Suggestions only | Automatic stops, rollback, monitoring and cost evidence                                         |
| GA             | Accepted scope only                 | Suggestions only | Final matrix and named owner sign-off                                                           |

Adding retrieval, memory, Copilot, tools, provider/model, schema or data class
after a stage invalidates applicable evidence and requires re-evaluation.

## 7. Rollback test

Before canary:

1. set the global kill switch and prove new provider disclosures stop;
2. allow in-flight calls to settle safely while route locks/tenant holds prevent
   unsafe state change;
3. verify no partial suggestion is persisted;
4. quarantine uncertain outputs and preserve safe provenance;
5. select only a previously evaluated/approved configuration, otherwise remain
   manual;
6. verify feature flags, provider route and release manifest returned to the
   intended state;
7. confirm alerts, audit events and manual workflows;
8. retain timestamps, owners and evidence IDs.

## 8. Final sign-off

Required named approvers:

- product/business requirements owner;
- AI quality/evaluation owner;
- application/security owner;
- privacy/data-protection owner;
- infrastructure/operations owner;
- finance/budget owner;
- pilot/canary business owner.

Each signs the exact code release, provider/model, prompt/schema set,
retrieval/index versions, corpus/evaluation run, privacy/provider/budget records,
tenant/capability scope, rollout evidence and rollback target. Expired or stale
evidence denies release.

## 9. Current blockers

- Business Plan v1.2 and Roadmap v1.1 are missing.
- Provider, DPA, region/residency, retention and no-training approvals are not
  supplied.
- Monthly/per-engagement budget and durable ledger are undecided.
- Retrieval/index versions required by the current release gate are absent.
- No authorised live 25+ case production-profile evaluation exists.
- No complete behavioural injection/OCR/citation/two-tenant proof exists.
- No shadow, pilot, canary, alert delivery, rollback or deployed smoke evidence
  exists.

Therefore the only accepted production state is **AI disabled with manual
workflows available**.
