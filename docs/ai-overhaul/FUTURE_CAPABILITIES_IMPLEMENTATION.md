# Future intelligence capabilities: implementation handoff

Status: **deterministic foundation implemented; production model execution remains disabled**.

This handoff covers the ten Intelligence Centre capabilities added to the
current working tree. The release is deliberately read-only: it projects
tenant-scoped, human-review decision support from records Valo already holds.
It does not call an AI provider and it does not create or change authoritative
workflow state.

No provider calls were made while implementing or validating this capability
set. Valo does not autonomously send a clarification, submit a tender, approve
evidence or a package, select or change a price, or make or predict an award
decision. The existing dormant schema was reused; this work adds no database
migration.

## What is connected now

- `GET /projects/{id}/intelligence` is the sole public endpoint for this set.
  It requires the complete server-side read-authority set for every returned
  data class and returns a content-minimised snapshot for exactly one
  server-authorised pursuit.
- The endpoint is deterministic and read-only. It invokes no model, performs no
  insert/update/delete, returns explicit empty/partial/restricted states, and
  sets `Cache-Control: private, no-store`.
- The snapshot joins existing project, document/version, requirement/citation,
  evidence, Vault, capability, draft/claim, defect, BOQ, package, report, task,
  opportunity and outcome records. Missing evidence stays missing; it is never
  converted into an approval, score or inferred obligation.
- `/intelligence` is a protected Intelligence Centre screen with pursuit
  selection, loading/error/empty/partial/restricted handling, source locators
  and the human-control boundary for every card.
- The OpenAPI operation and generated client expose the same ten-item contract.
  `productionAiEnabled` is intentionally `false` for this release.
- Pure, deterministic domain functions provide fail-closed building blocks for
  all ten capabilities. They validate source scope, versions, exact citations,
  review state and bounded inputs where applicable; they do not persist their
  outputs or perform external actions.

The public snapshot states are `review_ready`, `partial`, `empty`, `restricted`
and `production_disabled`. `review_ready` is emitted only when the
capability-specific, joined and provenance-checked prerequisites are present;
it means that recorded material is ready for a person to inspect. It never
means approved, eligible, compliant, priced, submitted or awarded.

## Capability boundary

The **current runtime level is Level 0 for every row**: deterministic projection
only, with no model output and no mutation. The “bounded product ceiling” below
describes the most autonomous future behaviour represented by the product
catalogue, not an enabled runtime. Level 1 is a non-persistent preview; Level 2
is a reversible proposal or draft that still requires named-human review. No
Level 3 bounded action or Level 4 autonomous consequential action is authorised.

| Capability                       | ID                        | Implemented deterministic behaviour                                                                                                                                        | Bounded product ceiling                                                  |
| -------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Evidence Graph                   | `evidence_graph`          | Builds provenance-checked requirement/evidence links and coverage; a link is unusable until its requirement, evidence and link reviews are accepted.                       | Level 2; reviewer accepts each citation and applicability decision.      |
| Addendum & Deadline Radar        | `addendum_radar`          | Compares two structured, authoritative source versions, identifies exact added/changed/removed fields and lists dependent artifacts for review. It never applies a change. | Level 2; reviewer confirms the version diff and each downstream impact.  |
| Tender Eligibility Passport      | `eligibility_passport`    | Evaluates only tender-cited criteria against source-backed company artifacts, validity dates and legal-entity rules. It does not invent a universal checklist.             | Level 1; owner verifies applicability, authority, dates and remediation. |
| Grounded Tender Copilot          | `grounded_copilot`        | Produces an extractive claim plan from accepted, role-visible, in-scope facts, or abstains. It does not compose unsupported prose.                                         | Level 1; user inspects the exact source before reuse.                    |
| Opportunity Radar                | `opportunity_radar`       | Screens recorded opportunities using explicit capability, region, deadline and capacity policy. It never estimates win probability or makes bid/no-bid decisions.          | Level 1; business-development lead makes the bid/no-bid decision.        |
| Citation-first Response Studio   | `response_studio`         | Validates factual draft claims, exact-quote support, placeholders and citation scope; paraphrases remain subject to semantic review.                                       | Level 2; named authors/reviewers accept or reject each draft claim.      |
| Submission Pack Preflight        | `submission_preflight`    | Checks source-backed obligations, addenda, filenames, hashes, final/approval state and deadlines and proposes remediation. A passing result is not release authority.      | Level 1; the named signatory makes the release and submission decision.  |
| Clarification Question Assistant | `clarification_assistant` | Proposes source-linked questions for conflicting, ambiguous or missing values. Every proposal has `deliveryStatus: not_sent` and no recipient.                             | Level 2; authorised tender lead decides whether and how to send.         |
| BOQ & Commercial Sanity Checker  | `boq_sanity`              | Projects source-backed arithmetic in configured minor units and flags decimal, extension and mixed-currency issues. It makes no rate, FX, tax or pricing recommendation.   | Level 1; commercial reviewer owns rates, assumptions and approval.       |
| Award-to-Delivery Handoff        | `award_handoff`           | Converts accepted, cited award obligations into internal draft-task proposals and checks dates, owners and dependencies. It creates no task or external commitment.        | Level 2; contract/project manager accepts obligations, owners and dates. |

## Deterministic API map

The public API is implemented by
[`routes/intelligence.ts`](../../artifacts/api-server/src/routes/intelligence.ts)
and the content-minimised projection by
[`snapshot.ts`](../../artifacts/api-server/src/lib/intelligence/snapshot.ts).
The internal deterministic function surface is exported from
[`lib/intelligence/index.ts`](../../artifacts/api-server/src/lib/intelligence/index.ts):

| Capability                       | Pure function                       |
| -------------------------------- | ----------------------------------- |
| Evidence Graph                   | `buildEvidenceGraph`                |
| Addendum & Deadline Radar        | `detectAddendumChanges`             |
| Tender Eligibility Passport      | `evaluateEligibilityPassport`       |
| Grounded Tender Copilot          | `planGroundedCopilotAnswer`         |
| Opportunity Radar                | `screenOpportunities`               |
| Citation-first Response Studio   | `validateCitationFirstResponse`     |
| Submission Pack Preflight        | `runExtendedSubmissionPreflight`    |
| Clarification Question Assistant | `suggestSourceBackedClarifications` |
| BOQ & Commercial Sanity Checker  | `projectSourceBackedBoqSanity`      |
| Award-to-Delivery Handoff        | `proposeAwardToDeliveryHandoff`     |

The HTTP contract is in
[`openapi.yaml`](../../lib/api-spec/openapi.yaml), and the protected screen is
connected by
[`intelligence-centre-route.tsx`](../../artifacts/valo-workbench/src/pages/intelligence-centre-route.tsx).
Unit and static tests sit beside the deterministic engines, route and UI.

## Safety and authority invariants

- Tenant and project scope is established by the authenticated request,
  permission middleware and existing database isolation controls. Internal pure
  functions are not standalone authorisation boundaries.
- Active source version, lifecycle state, authority, role visibility and exact
  source quotations are validated before a bounded proposal can be used.
- Restricted Mode and absent/partial evidence fail closed. The UI does not hide
  those states behind a confidence score.
- Model execution, persistence, notifications, emails, portal operations,
  submissions, approvals, pricing changes, award decisions and downstream task
  creation are outside this implementation.
- A deterministic check passing is evidence for a reviewer, not a release
  decision. Human approval cannot be inferred from system output.
- The feature set adds no general tool-execution plane, cross-client learning or
  long-term conversational memory.

## Production blockers and next stages

1. **Authoritative retrieval:** build immutable page/table text ingestion,
   version-aware indexing and citation re-verification, with tenant-isolation
   and deletion tests. The current Copilot is an extractive planner, not a
   conversational retrieval service.
2. **Governance decisions:** approve provider/model, processing region,
   retention, privacy terms, customer-data scope, rate card and budget. Keep the
   global/capability kill switches and fail-closed gateway in the activation
   path.
3. **Durable workflow controls:** add idempotent background jobs, audit ledger,
   transactional outbox and explicit review/persistence endpoints before any
   Level 2 draft is connected. Schema changes, if later required, need their own
   migration and tenant-policy review.
4. **Feature evaluations:** assemble representative and adversarial holdouts for
   citation correctness, abstention, addendum recall, eligibility false claims,
   BOQ arithmetic and scope leakage. Retain model/prompt/schema/data versions
   with every evaluation and require release thresholds.
5. **Operational proof:** exercise shadow, pilot and canary stages; verify
   concurrency, cost ceilings, alert delivery, incident handling, rollback and
   Restricted Mode in a production-like environment.
6. **Separate product approval:** only after the preceding controls pass should
   an owner decide whether any model-backed Level 1 preview or Level 2 reversible
   draft is worth enabling. Send/submit/approve/price/award actions remain out of
   scope and require a separate threat model and authority decision.

Until those stages are complete, the connected Intelligence Centre is a
deterministic review surface. It is not evidence that production AI has been
approved or enabled.
