import assert from "node:assert/strict";
import test from "node:test";
import {
  ADDENDUM_REOPEN_CONFIRMATION,
  authoriseControlledAddendumReopening,
  buildAddendumImpactAssessment,
  type AddendumImpactInput,
} from "./addendumImpact";
import { sha256Text, type ExactCitation, type SourceDocument } from "./domain";

const review = {
  state: "accepted" as const,
  reviewerId: "reviewer-1",
  reviewedAt: "2026-08-20T09:00:00.000Z",
};

function source(
  sourceId: string,
  versionId: string,
  kind: SourceDocument["kind"],
  capturedAt: string,
  content: string,
): SourceDocument {
  return {
    sourceId,
    versionId,
    kind,
    title: sourceId,
    content,
    contentSha256: sha256Text(content),
    capturedAt,
    authority: "authoritative",
    origin: `project-document:${sourceId}:${versionId}`,
  };
}

function cite(document: SourceDocument, quote: string): ExactCitation {
  const startOffset = document.content.indexOf(quote);
  return {
    sourceId: document.sourceId,
    sourceVersionId: document.versionId,
    contentSha256: document.contentSha256,
    startOffset,
    endOffset: startOffset + quote.length,
    quote,
  };
}

const baseline = source(
  "tender",
  "version-1",
  "solicitation",
  "2026-08-01T08:00:00.000Z",
  "Deadline 20 August 2026. Bid security NGN 10,000,000.",
);
const revision = source(
  "tender",
  "version-2",
  "addendum",
  "2026-08-18T08:00:00.000Z",
  "Deadline 27 August 2026. Bid security NGN 10,000,000.",
);

const baseInput: AddendumImpactInput = {
  sources: [baseline, revision],
  baseline: {
    sourceId: baseline.sourceId,
    sourceVersionId: baseline.versionId,
    fields: [
      {
        externalId: "deadline",
        category: "deadline",
        value: "20 August 2026",
        citation: cite(baseline, "20 August 2026"),
      },
      {
        externalId: "bid-security",
        category: "requirement",
        value: "NGN 10,000,000",
        citation: cite(baseline, "NGN 10,000,000"),
      },
    ],
  },
  revision: {
    sourceId: revision.sourceId,
    sourceVersionId: revision.versionId,
    fields: [
      {
        externalId: "deadline",
        category: "deadline",
        value: "27 August 2026",
        citation: cite(revision, "27 August 2026"),
      },
      {
        externalId: "bid-security",
        category: "requirement",
        value: "NGN 10,000,000",
        citation: cite(revision, "NGN 10,000,000"),
      },
    ],
  },
  targets: [
    {
      externalId: "requirement-deadline",
      objectType: "requirement",
      label: "Submission deadline requirement",
      currentState: "accepted",
      currentVersion: 4,
      dependsOnFieldExternalIds: ["deadline"],
      proposedAction: "reopen",
    },
    {
      externalId: "submission-package",
      objectType: "package",
      label: "Submission package",
      currentState: "signed_off",
      currentVersion: 2,
      dependsOnFieldExternalIds: ["deadline", "bid-security"],
      proposedAction: "invalidate",
    },
    {
      externalId: "security-check",
      objectType: "boq_check",
      label: "Bid security check",
      currentState: "complete",
      currentVersion: 1,
      dependsOnFieldExternalIds: ["bid-security"],
      proposedAction: "recheck",
    },
  ],
};

function acceptedInput(): AddendumImpactInput {
  const proposed = buildAddendumImpactAssessment(baseInput);
  const changeReviews = Object.fromEntries(
    proposed.radar.changes.map(({ changeId }) => [changeId, review]),
  );
  const withChangeReviews = buildAddendumImpactAssessment({
    ...baseInput,
    changeReviews,
  });
  return {
    ...baseInput,
    changeReviews,
    radarReview: {
      subjectId: withChangeReviews.radarId,
      review,
    },
  };
}

test("compares exact source versions and reports only changed dependencies", () => {
  const result = buildAddendumImpactAssessment(baseInput);
  assert.equal(result.status, "review_required");
  assert.equal(result.readyForReopening, false);
  assert.equal(result.radar.changes.length, 1);
  assert.equal(result.radar.changes[0]?.beforeValue, "20 August 2026");
  assert.equal(result.radar.changes[0]?.afterValue, "27 August 2026");
  assert.equal(
    result.radar.changes[0]?.beforeCitation?.sourceVersionId,
    "version-1",
  );
  assert.equal(
    result.radar.changes[0]?.afterCitation?.sourceVersionId,
    "version-2",
  );
  assert.deepEqual(
    result.impacts.map(({ targetId }) => targetId),
    ["submission-package", "requirement-deadline"],
  );
  assert.equal(
    result.impacts.some(({ targetId }) => targetId === "security-check"),
    false,
  );
});

test("removed fields require and preserve the selected revision's exact instruction citation", () => {
  const removalRevision = source(
    baseline.sourceId,
    "version-3",
    "addendum",
    "2026-08-19T08:00:00.000Z",
    "The bid security requirement is withdrawn.",
  );
  const removalCitation = cite(
    removalRevision,
    "bid security requirement is withdrawn",
  );
  const comparison: AddendumImpactInput = {
    ...baseInput,
    sources: [baseline, removalRevision],
    revision: {
      sourceId: removalRevision.sourceId,
      sourceVersionId: removalRevision.versionId,
      fields: [baseInput.baseline.fields[0]!],
      removals: [
        {
          externalId: "bid-security",
          category: "requirement",
          citation: removalCitation,
        },
      ],
    },
  };

  const result = buildAddendumImpactAssessment(comparison);
  assert.equal(result.status, "review_required");
  assert.equal(result.radar.changes.length, 1);
  assert.equal(result.radar.changes[0]?.kind, "removed");
  assert.equal(
    result.radar.changes[0]?.beforeCitation?.sourceVersionId,
    baseline.versionId,
  );
  assert.equal(
    result.radar.changes[0]?.afterCitation?.sourceVersionId,
    removalRevision.versionId,
  );
  assert.equal(
    result.radar.changes[0]?.afterCitation?.quote,
    removalCitation.quote,
  );
});

test("an omitted field without an exact removal instruction fails closed", () => {
  const removalRevision = source(
    baseline.sourceId,
    "version-3",
    "addendum",
    "2026-08-19T08:00:00.000Z",
    "No implicit deletion instruction is present.",
  );
  const result = buildAddendumImpactAssessment({
    ...baseInput,
    sources: [baseline, removalRevision],
    revision: {
      sourceId: removalRevision.sourceId,
      sourceVersionId: removalRevision.versionId,
      fields: [baseInput.baseline.fields[0]!],
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(
    result.issues.some(({ code }) => code === "implicit_addendum_deletion"),
    true,
  );
});

test("accepted change reviews and whole-comparison review make the plan ready", () => {
  const result = buildAddendumImpactAssessment(acceptedInput());
  assert.equal(result.status, "ready_to_reopen");
  assert.equal(result.readyForReopening, true);
  assert.match(result.impactManifestSha256, /^[a-f0-9]{64}$/u);
});

test("source identity stays stable while a changed target creates a new plan revision", () => {
  const first = buildAddendumImpactAssessment(baseInput);
  const changedTarget = buildAddendumImpactAssessment({
    ...baseInput,
    targets: baseInput.targets.map((target) =>
      target.externalId === "submission-package"
        ? { ...target, currentState: "invalidated", currentVersion: 3 }
        : target,
    ),
  });

  assert.equal(changedTarget.radarId, first.radarId);
  assert.equal(changedTarget.sourceManifestSha256, first.sourceManifestSha256);
  assert.notEqual(
    changedTarget.impactManifestSha256,
    first.impactManifestSha256,
  );
  assert.notEqual(changedTarget.assessmentId, first.assessmentId);
});

test("controlled reopening requires current review, manifest, reason and typed confirmation", () => {
  const unreviewed = buildAddendumImpactAssessment(baseInput);
  const reviewed = buildAddendumImpactAssessment(acceptedInput());
  const common = {
    assessment: reviewed,
    expectedRadarId: reviewed.radarId,
    expectedImpactManifestSha256: reviewed.impactManifestSha256,
    reason: "Addendum 1 moves the submission deadline.",
    confirmation: ADDENDUM_REOPEN_CONFIRMATION,
    reviewer: {
      reviewerId: "reviewer-1",
      reviewerName: "Ada Reviewer",
      reviewedAt: "2026-08-20T09:00:00.000Z",
    },
    actor: {
      actorId: "bid-owner-1",
      actorName: "Bola Owner",
      appliedAt: "2026-08-20T09:30:00.000Z",
    },
  };

  assert.equal(
    authoriseControlledAddendumReopening({
      ...common,
      assessment: unreviewed,
      expectedRadarId: unreviewed.radarId,
      expectedImpactManifestSha256: unreviewed.impactManifestSha256,
    }).allowed,
    false,
  );
  assert.equal(
    authoriseControlledAddendumReopening({
      ...common,
      expectedImpactManifestSha256: "0".repeat(64),
    }).allowed,
    false,
  );
  assert.equal(
    authoriseControlledAddendumReopening({
      ...common,
      confirmation: "yes",
    }).allowed,
    false,
  );
  assert.equal(
    authoriseControlledAddendumReopening({ ...common, reason: " " }).allowed,
    false,
  );
});

test("authorised output is an explicit version-bound plan and does not mutate the assessment", () => {
  const assessment = buildAddendumImpactAssessment(acceptedInput());
  const before = structuredClone(assessment);
  const decision = authoriseControlledAddendumReopening({
    assessment,
    expectedRadarId: assessment.radarId,
    expectedImpactManifestSha256: assessment.impactManifestSha256,
    reason: "Apply the reviewed deadline change.",
    confirmation: ADDENDUM_REOPEN_CONFIRMATION,
    reviewer: {
      reviewerId: "reviewer-1",
      reviewerName: "Ada Reviewer",
      reviewedAt: "2026-08-20T09:00:00.000Z",
    },
    actor: {
      actorId: "bid-owner-1",
      actorName: "Bola Owner",
      appliedAt: "2026-08-20T09:30:00.000Z",
    },
  });

  assert.equal(decision.allowed, true);
  if (!decision.allowed) return;
  assert.deepEqual(
    decision.mutations.map((mutation) => ({
      id: mutation.targetId,
      expectedVersion: mutation.expectedVersion,
      toState: mutation.toState,
    })),
    [
      {
        id: "submission-package",
        expectedVersion: 2,
        toState: "invalidated",
      },
      {
        id: "requirement-deadline",
        expectedVersion: 4,
        toState: "reopened",
      },
    ],
  );
  assert.deepEqual(assessment, before);
});

test("the named reviewer cannot also apply the controlled reopening", () => {
  const assessment = buildAddendumImpactAssessment(acceptedInput());
  const decision = authoriseControlledAddendumReopening({
    assessment,
    expectedRadarId: assessment.radarId,
    expectedImpactManifestSha256: assessment.impactManifestSha256,
    reason: "Apply the reviewed deadline change.",
    confirmation: ADDENDUM_REOPEN_CONFIRMATION,
    reviewer: {
      reviewerId: "reviewer-1",
      reviewerName: "Ada Reviewer",
      reviewedAt: "2026-08-20T09:00:00.000Z",
    },
    actor: {
      actorId: "reviewer-1",
      actorName: "Ada Reviewer",
      appliedAt: "2026-08-20T09:30:00.000Z",
    },
  });

  assert.equal(decision.allowed, false);
  if (decision.allowed) return;
  assert.equal(decision.code, "segregation_of_duties_required");
  assert.deepEqual(decision.mutations, []);
});

test("unknown downstream dependencies fail closed", () => {
  const result = buildAddendumImpactAssessment({
    ...baseInput,
    targets: [
      {
        ...baseInput.targets[0],
        dependsOnFieldExternalIds: ["not-in-comparison"],
      },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(
    result.issues.some(({ code }) => code === "unknown_impact_dependency"),
    true,
  );
});
