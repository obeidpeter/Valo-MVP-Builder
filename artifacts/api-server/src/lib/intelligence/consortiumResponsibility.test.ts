import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256Text, type HumanReview, type SourceDocument } from "./domain";
import {
  buildConsortiumResponsibilityMatrix,
  type ConsortiumResponsibilityInput,
} from "./consortiumResponsibility";

const ACCEPTED: HumanReview = {
  state: "accepted",
  reviewerId: "consortium-reviewer",
  reviewedAt: "2026-08-10T12:00:00.000Z",
};

function source(
  sourceId: string,
  kind: SourceDocument["kind"],
  content: string,
  authority: SourceDocument["authority"] = "authoritative",
): SourceDocument {
  return {
    sourceId,
    versionId: "v1",
    kind,
    title: `${sourceId}.pdf`,
    content,
    contentSha256: sha256Text(content),
    capturedAt: "2026-08-10T09:00:00.000Z",
    authority,
    origin: "controlled-test-fixture",
  };
}

function citation(item: SourceDocument) {
  return {
    sourceId: item.sourceId,
    sourceVersionId: item.versionId,
    contentSha256: item.contentSha256,
    startOffset: 0,
    endOffset: item.content.length,
    quote: item.content,
  };
}

function fixture(): ConsortiumResponsibilityInput {
  const tender = source(
    "consortium-tender",
    "solicitation",
    "Lead and technical responsibility requires one lead and one technical member. All consortium members are joint and several for this obligation. Propose the cited lead-capable member for the tender's lead role. Propose the cited technical-capable member for the tender's technical role.",
  );
  const lead = source(
    "atlas-company-record",
    "company_evidence",
    "Atlas Infrastructure Ltd company evidence records lead delivery capability.",
    "corroborating",
  );
  const technical = source(
    "beta-company-record",
    "company_evidence",
    "Beta Engineering Ltd company evidence records technical delivery capability.",
    "corroborating",
  );
  return {
    sources: [tender, lead, technical],
    obligations: [
      {
        externalId: "delivery-responsibility",
        label: "Lead and technical responsibility",
        requiredRoles: ["lead", "technical"],
        jointAndSeveralRequired: true,
        citations: [citation(tender)],
        review: ACCEPTED,
      },
    ],
    members: [
      {
        externalId: "atlas",
        legalName: "Atlas Infrastructure Ltd",
        eligibleRoles: ["lead"],
        companyEvidenceStatement:
          "Atlas Infrastructure Ltd company evidence records lead delivery capability.",
        citations: [citation(lead)],
        review: ACCEPTED,
      },
      {
        externalId: "beta",
        legalName: "Beta Engineering Ltd",
        eligibleRoles: ["technical"],
        companyEvidenceStatement:
          "Beta Engineering Ltd company evidence records technical delivery capability.",
        citations: [citation(technical)],
        review: ACCEPTED,
      },
    ],
    allocations: [
      {
        externalId: "atlas-lead-allocation",
        obligationExternalId: "delivery-responsibility",
        memberExternalId: "atlas",
        role: "lead",
        responsibility: "joint_and_several",
        rationale:
          "Propose the cited lead-capable member for the tender's lead role.",
        citations: [citation(tender)],
        review: ACCEPTED,
      },
      {
        externalId: "beta-technical-allocation",
        obligationExternalId: "delivery-responsibility",
        memberExternalId: "beta",
        role: "technical",
        responsibility: "joint_and_several",
        rationale:
          "Propose the cited technical-capable member for the tender's technical role.",
        citations: [citation(tender)],
        review: ACCEPTED,
      },
    ],
  };
}

test("builds a reviewed responsibility proposal but requires exact matrix acceptance", () => {
  const input = fixture();
  const proposed = buildConsortiumResponsibilityMatrix(input);
  assert.equal(proposed.status, "review_required");
  assert.equal(proposed.coverage[0]?.state, "covered");
  assert.deepEqual(proposed.coverage[0]?.missingRoles, []);
  assert.equal(proposed.coverage[0]?.jointAndSeveralCovered, true);

  const accepted = buildConsortiumResponsibilityMatrix({
    ...input,
    matrixReview: { subjectId: proposed.matrixId, review: ACCEPTED },
  });
  assert.equal(accepted.status, "ready");
  assert.equal(accepted.readyForInternalPlanningUse, true);
  assert.equal(accepted.partnerCommitmentConfirmed, false);
  assert.equal(accepted.consortiumAgreementGenerated, false);
  assert.equal(accepted.legalAgreementAuthorized, false);
  assert.equal(accepted.safety.externalAction, "none");
  assert.equal(accepted.safety.legalDecisionAuthorized, false);
});

test("keeps missing and pending responsibility work fail-closed", () => {
  const input = fixture();
  const missing = buildConsortiumResponsibilityMatrix({
    ...input,
    allocations: [input.allocations[0]!],
  });
  assert.equal(missing.status, "incomplete");
  assert.equal(missing.readyForInternalPlanningUse, false);
  assert.equal(missing.coverage[0]?.state, "constraint_gap");
  assert.deepEqual(missing.coverage[0]?.missingRoles, ["technical"]);
  assert.equal(missing.unallocatedMemberIds.length, 1);

  const pending = buildConsortiumResponsibilityMatrix({
    ...input,
    allocations: [
      input.allocations[0]!,
      { ...input.allocations[1]!, review: { state: "unreviewed" } },
    ],
  });
  assert.equal(pending.status, "review_required");
  assert.equal(pending.readyForInternalPlanningUse, false);
  assert.equal(pending.coverage[0]?.state, "pending_review");
});

test("does not treat supporting-only allocations as required-role coverage", () => {
  const input = fixture();
  const result = buildConsortiumResponsibilityMatrix({
    ...input,
    allocations: input.allocations.map((allocation) => ({
      ...allocation,
      responsibility: "supporting" as const,
    })),
  });
  assert.equal(result.readyForInternalPlanningUse, false);
  assert.equal(result.coverage[0]?.state, "constraint_gap");
  assert.deepEqual(result.coverage[0]?.missingRoles, ["lead", "technical"]);
});

test("requires an explicit citation for the joint-liability machine flag", () => {
  const input = fixture();
  const result = buildConsortiumResponsibilityMatrix({
    ...input,
    obligations: [{ ...input.obligations[0]!, jointAndSeveralRequired: false }],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.obligations.length, 0);
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "consortium_obligation_facts_not_cited",
    ),
  );
});

test("does not infer a member role from a longer or negated word", () => {
  const input = fixture();
  const misleadingLead = source(
    "misleading-lead-record",
    "company_evidence",
    "Atlas Infrastructure Ltd company evidence records leader delivery capability and is not eligible for lead.",
    "corroborating",
  );
  const result = buildConsortiumResponsibilityMatrix({
    ...input,
    sources: [input.sources[0]!, misleadingLead, input.sources[2]!],
    members: [
      {
        ...input.members[0]!,
        companyEvidenceStatement: misleadingLead.content,
        citations: [citation(misleadingLead)],
      },
      input.members[1]!,
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(
    result.members.some((member) => member.externalId === "atlas"),
    false,
  );
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "consortium_member_provenance_not_cited",
    ),
  );
});

test("requires the emitted allocation rationale in its exact obligation citation", () => {
  const input = fixture();
  const result = buildConsortiumResponsibilityMatrix({
    ...input,
    allocations: [
      {
        ...input.allocations[0]!,
        rationale: "An uncited allocation assertion.",
      },
      input.allocations[1]!,
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(
    result.allocations.some(
      (allocation) => allocation.externalId === "atlas-lead-allocation",
    ),
    false,
  );
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "allocation_rationale_not_cited",
    ),
  );
});

test("rejects invalid member provenance and allocations cited elsewhere", () => {
  const input = fixture();
  const technical = input.sources[2]!;
  const invalidSource = buildConsortiumResponsibilityMatrix({
    ...input,
    sources: [
      input.sources[0]!,
      input.sources[1]!,
      { ...technical, kind: "other" },
    ],
  });
  assert.equal(invalidSource.status, "blocked");
  assert.ok(
    invalidSource.issues.some(
      (issue) => issue.code === "consortium_member_source_invalid",
    ),
  );

  const invalidCitation = buildConsortiumResponsibilityMatrix({
    ...input,
    allocations: [
      input.allocations[0]!,
      {
        ...input.allocations[1]!,
        citations: [citation(input.sources[2]!)],
      },
    ],
  });
  assert.equal(invalidCitation.status, "blocked");
  assert.ok(
    invalidCitation.issues.some(
      (issue) => issue.code === "allocation_citation_not_obligation_bound",
    ),
  );
});

test("matrix identity and output order are deterministic", () => {
  const input = fixture();
  const baseline = buildConsortiumResponsibilityMatrix(input);
  const reordered = buildConsortiumResponsibilityMatrix({
    ...input,
    sources: [...input.sources].reverse(),
    obligations: [...input.obligations].reverse(),
    members: [...input.members].reverse(),
    allocations: [...input.allocations].reverse(),
  });
  assert.equal(reordered.matrixId, baseline.matrixId);
  assert.deepEqual(reordered.obligations, baseline.obligations);
  assert.deepEqual(reordered.members, baseline.members);
  assert.deepEqual(reordered.allocations, baseline.allocations);
  assert.deepEqual(reordered.coverage, baseline.coverage);
});

test("a matrix review does not transfer after an allocation changes", () => {
  const input = fixture();
  const baseline = buildConsortiumResponsibilityMatrix(input);
  const changed = buildConsortiumResponsibilityMatrix({
    ...input,
    allocations: [
      {
        ...input.allocations[0]!,
        rationale:
          "Propose the cited lead-capable member for a fresh human allocation review.",
      },
      input.allocations[1]!,
    ],
    matrixReview: { subjectId: baseline.matrixId, review: ACCEPTED },
  });
  assert.notEqual(changed.matrixId, baseline.matrixId);
  assert.equal(changed.status, "blocked");
  assert.equal(changed.readyForInternalPlanningUse, false);
  assert.ok(
    changed.issues.some((issue) => issue.code === "review_subject_mismatch"),
  );
});

test("blocks and slices an overflowing nested citation collection", () => {
  const input = fixture();
  const repeatedCitation = input.allocations[0]!.citations[0]!;
  const result = buildConsortiumResponsibilityMatrix({
    ...input,
    allocations: [
      {
        ...input.allocations[0]!,
        citations: Array.from({ length: 501 }, () => repeatedCitation),
      },
      input.allocations[1]!,
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(
    result.allocations.find(
      (allocation) => allocation.externalId === "atlas-lead-allocation",
    )?.citations.length,
    500,
  );
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === "capability_item_limit_exceeded" &&
        issue.path === "allocations[0].citations",
    ),
  );
});
