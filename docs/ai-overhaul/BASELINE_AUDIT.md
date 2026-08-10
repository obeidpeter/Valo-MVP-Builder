# Baseline AI audit

## Decision

Production AI remains disabled. The working tree now has a materially stronger
bounded runtime, policy, schema, grounding, release-gate and operations
foundation. It still lacks the business/provider/privacy/budget decisions,
production data/evaluation evidence, retrieval/index versions, isolation proof
and deployed operational evidence needed for production acceptance.

## Source authority and gaps

The overhaul request names Business Plan v1.2 and Product Roadmap v1.1. Those
versions were not available in the supplied source set. The observed versions
are Business Plan v1.1, Product Roadmap v1.0 and TRD v1.0. This is an explicit
requirements-control blocker; no missing content has been inferred.

## Current AI scope

Five provider-backed capabilities exist: PDF multimodal transcription,
requirement extraction, evidence mapping, defect suggestion and responsiveness
drafting. All are Level-2 reversible, non-authoritative suggestions requiring a
named reviewer. There is no Copilot, autonomous agent, production retrieval,
AI memory, general tool plane, queue worker or AI outbox.

## Controls implemented in the working tree

- Central project-scoped runtime and gateway for all five capabilities.
- Production release gate enforced before the gateway from a private retained
  evidence path; missing/invalid evidence denies execution.
- Global and per-capability environment gates plus tenant feature flags.
- Provider abstraction with strict structured output, timeout, bounded retry and
  equivalent-or-stronger fallback policy.
- Fail-closed model, budget, provider approval, privacy, region, retention,
  Restricted Mode, health, usage and cost checks.
- Formal capability limits and named human approval contracts.
- Exact-key/type/length/enum server validation and sanitisation.
- Requirement source quote verification and evidence excerpt verification;
  unsupported positive evidence is downgraded to `unclear`.
- No silent complete-corpus truncation; oversized selected text fails.
- AI suggestions do not advance project status or count as reviewed facts.
- Defect/responsiveness inputs are restricted to reviewed workflow state.
- Release readiness rechecks grounded requirement citations and blocks an
  AI-suggested responsiveness narrative.
- Organisation-scoped operations API with safe blockers/run/evaluation metadata.
- Manifest-backed production evaluation profile and version-specific release
  recomputation in source.

These are implementation facts, not production validation claims.

## Development evidence and its limit

Automated source/unit tests and local structural doctrine, injection and
evaluation self-checks exercise important fail-closed contracts. The current
evaluation corpus has 14 inline synthetic/unverified cases and is deliberately
ineligible for production. Structural injection fixtures do not demonstrate
behaviour on authorised real PDF/OCR/table/image/retrieval/tool data. No local
pass proves target database migrations, provider behaviour, network controls,
alert delivery or production tenant isolation.

## Principal production blockers

1. Business Plan v1.2 and Roadmap v1.1 are unavailable.
2. No approved provider/model/fallback, DPA/DPIA, region/residency, retention,
   no-training/deletion or Restricted Mode decision is supplied.
3. No approved monthly/tenant/engagement budget or concurrency-safe budget
   ledger exists.
4. No retained live production-profile evaluation exists.
5. Current corpus has 14 synthetic cases, not at least 25 authorised,
   adjudicated holdout cases across required cohorts.
6. Retrieval and index are not implemented/versioned; the wired release gate
   correctly rejects missing and placeholder versions.
7. Exact text containment is not an independent document-version/page/span
   citation resolver; OCR quality is not page-level evaluated.
8. No end-to-end two-tenant proof covers every deployed DB/storage/cache/
   retrieval/queue/tool plane.
9. No operational alerting/paging, live provider-health semantics, budget
   settlement or deletion proof exists.
10. No retained shadow, internal pilot, tenant pilot, canary, rollback or
    deployed smoke evidence exists.

Gate-0 and synthetic tests remain useful regression signals only.
