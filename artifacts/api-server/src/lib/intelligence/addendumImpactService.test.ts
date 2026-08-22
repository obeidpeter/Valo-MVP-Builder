import assert from "node:assert/strict";
import test from "node:test";
import {
  ADDENDUM_REOPEN_CONFIRMATION,
  type AddendumImpactInput,
} from "./addendumImpact";
import {
  type AddendumImpactRepository,
  type AddendumImpactRepositorySnapshot,
  type StoredAddendumImpactApplication,
  type StoredAddendumImpactReview,
} from "./addendumImpactContracts";
import {
  AddendumImpactService,
  AddendumImpactServiceError,
} from "./addendumImpactService";
import { sha256Text, type ExactCitation, type SourceDocument } from "./domain";

const ORGANISATION_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";
const APPLIER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BASELINE_VERSION_ID = "44444444-4444-4444-8444-444444444444";
const REVISION_VERSION_ID = "55555555-5555-4555-8555-555555555555";
const TARGET_ID = "66666666-6666-4666-8666-666666666666";
const NOW = new Date("2026-08-21T12:00:00.000Z");

function source(
  versionId: string,
  kind: SourceDocument["kind"],
  capturedAt: string,
  content: string,
): SourceDocument {
  return {
    sourceId: "source-tender",
    versionId,
    kind,
    title: kind === "addendum" ? "Addendum 1" : "Invitation to tender",
    content,
    contentSha256: sha256Text(content),
    capturedAt,
    authority: "authoritative",
    origin: `project-document:${versionId}`,
  };
}

function citation(document: SourceDocument, quote: string): ExactCitation {
  const startOffset = document.content.indexOf(quote);
  return {
    sourceId: document.sourceId,
    sourceVersionId: document.versionId,
    contentSha256: document.contentSha256,
    startOffset,
    endOffset: startOffset + quote.length,
    quote,
    page: 3,
    section: "Submission deadline",
  };
}

function comparison(): AddendumImpactInput {
  const baseline = source(
    BASELINE_VERSION_ID,
    "solicitation",
    "2026-08-01T08:00:00.000Z",
    "Submit by 20 August 2026.",
  );
  const revision = source(
    REVISION_VERSION_ID,
    "addendum",
    "2026-08-18T08:00:00.000Z",
    "Submit by 27 August 2026.",
  );
  return {
    sources: [baseline, revision],
    baseline: {
      sourceId: baseline.sourceId,
      sourceVersionId: baseline.versionId,
      fields: [
        {
          externalId: "submission-deadline",
          category: "deadline",
          value: "20 August 2026",
          citation: citation(baseline, "20 August 2026"),
        },
      ],
    },
    revision: {
      sourceId: revision.sourceId,
      sourceVersionId: revision.versionId,
      fields: [
        {
          externalId: "submission-deadline",
          category: "deadline",
          value: "27 August 2026",
          citation: citation(revision, "27 August 2026"),
        },
      ],
    },
    targets: [
      {
        externalId: TARGET_ID,
        objectType: "package",
        label: "Signed submission package",
        currentState: "signed_off",
        currentVersion: 3,
        dependsOnFieldExternalIds: ["submission-deadline"],
        proposedAction: "invalidate",
      },
    ],
  };
}

function createHarness() {
  let review: StoredAddendumImpactReview | null = null;
  let application: StoredAddendumImpactApplication | null = null;
  let version = 0;
  const reviewInputs: Parameters<
    AddendumImpactRepository["recordReview"]
  >[0][] = [];
  const applyInputs: Parameters<
    AddendumImpactRepository["applyReopening"]
  >[0][] = [];
  const replayInputs: Parameters<
    AddendumImpactRepository["findApplicationReplay"]
  >[0][] = [];
  const loadInputs: Array<{
    organisationId: string;
    projectId: string;
    baselineVersionId?: string;
    revisionVersionId?: string;
  }> = [];
  const snapshot = (): AddendumImpactRepositorySnapshot => ({
    organisationId: ORGANISATION_ID,
    projectId: PROJECT_ID,
    projectTitle: "Road rehabilitation bid",
    baseline: {
      documentId: "77777777-7777-4777-8777-777777777777",
      documentVersionId: BASELINE_VERSION_ID,
      filename: "invitation.pdf",
      versionNumber: 1,
      sha256: "a".repeat(64),
      capturedAt: "2026-08-01T08:00:00.000Z",
    },
    revision: {
      documentId: "88888888-8888-4888-8888-888888888888",
      documentVersionId: REVISION_VERSION_ID,
      filename: "addendum-1.pdf",
      versionNumber: 1,
      sha256: "b".repeat(64),
      capturedAt: "2026-08-18T08:00:00.000Z",
    },
    comparison: comparison(),
    assessmentVersion: version,
    review,
    application,
  });
  const repository: AddendumImpactRepository = {
    load: async (scope, projectId, selection) => {
      loadInputs.push({
        organisationId: scope.organisationId,
        projectId,
        ...selection,
      });
      return scope.organisationId === ORGANISATION_ID &&
        projectId === PROJECT_ID &&
        (!selection.baselineVersionId ||
          selection.baselineVersionId === BASELINE_VERSION_ID) &&
        (!selection.revisionVersionId ||
          selection.revisionVersionId === REVISION_VERSION_ID)
        ? snapshot()
        : null;
    },
    recordReview: async (input) => {
      reviewInputs.push(input);
      if (review || input.expectedAssessmentVersion !== version) {
        return { outcome: "conflict" };
      }
      // Persistence inserts a guarded pending record at v1 and transitions it
      // to the terminal named review at v2 in the same transaction.
      version = 2;
      review = {
        assessmentId: input.assessmentId,
        impactManifestSha256: input.impactManifestSha256,
        decision: input.decision,
        reason: input.reason,
        reviewerUserId: input.scope.actorUserId,
        reviewerName: input.scope.actorName,
        reviewedAt: input.reviewedAt,
        version,
      };
      return { outcome: "recorded", value: review };
    },
    findApplicationReplay: async (input) => {
      replayInputs.push(input);
      return application &&
        application.assessmentId === input.assessmentId &&
        application.impactManifestSha256 === input.impactManifestSha256 &&
        application.appliedByUserId === input.scope.actorUserId &&
        application.appliedByName === input.scope.actorName &&
        application.reason === input.reason
        ? application
        : null;
    },
    applyReopening: async (input) => {
      applyInputs.push(input);
      if (
        input.expectedAssessmentVersion !== version ||
        !review ||
        review.decision !== "accepted"
      ) {
        return { outcome: "conflict" };
      }
      application = {
        assessmentId: input.assessmentId,
        impactManifestSha256: input.impactManifestSha256,
        appliedByUserId: input.scope.actorUserId,
        appliedByName: input.scope.actorName,
        appliedAt: input.appliedAt,
        reason: input.reason,
        mutationCount: input.mutations.length,
      };
      return { outcome: "recorded", value: application };
    },
  };
  return {
    service: new AddendumImpactService(repository, () => NOW),
    reviewInputs,
    applyInputs,
    replayInputs,
    loadInputs,
    snapshot,
  };
}

const scope = {
  organisationId: ORGANISATION_ID,
  actorUserId: ACTOR_ID,
  actorName: "Ada Bid Manager",
  source: "membership" as const,
  membershipId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};

const applyingScope = {
  organisationId: ORGANISATION_ID,
  actorUserId: APPLIER_ID,
  actorName: "Bola Operations Manager",
  source: "membership" as const,
  membershipId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};

test("loads a read-only exact-version comparison with citations and impacts", async () => {
  const harness = createHarness();
  const centre = await harness.service.getCentre(scope, PROJECT_ID);
  assert.equal(centre.assessment.status, "review_required");
  assert.equal(centre.assessment.changes.length, 1);
  assert.equal(
    centre.assessment.changes[0]?.beforeCitation?.sourceVersionId,
    BASELINE_VERSION_ID,
  );
  assert.equal(
    centre.assessment.changes[0]?.afterCitation?.sourceVersionId,
    REVISION_VERSION_ID,
  );
  assert.equal(centre.assessment.impacts[0]?.targetId, TARGET_ID);
  assert.equal(harness.reviewInputs.length, 0);
  assert.equal(harness.applyInputs.length, 0);
});

test("review records a named assessment but never applies a mutation", async () => {
  const harness = createHarness();
  const before = structuredClone(harness.snapshot().comparison.targets);
  const centre = await harness.service.getCentre(scope, PROJECT_ID);
  const reviewed = await harness.service.review(scope, PROJECT_ID, {
    baselineVersionId: BASELINE_VERSION_ID,
    revisionVersionId: REVISION_VERSION_ID,
    assessmentId: centre.assessment.id,
    radarId: centre.assessment.radarId,
    expectedImpactManifestSha256: centre.assessment.impactManifestSha256,
    expectedAssessmentVersion: centre.assessment.version,
    decision: "accepted",
    reason: "The exact deadline change and listed package impact are correct.",
  });
  assert.equal(reviewed.review?.reviewerName, "Ada Bid Manager");
  assert.equal(reviewed.assessment.status, "ready_to_reopen");
  assert.equal(harness.reviewInputs.length, 1);
  assert.equal(harness.applyInputs.length, 0);
  assert.equal(
    harness.reviewInputs[0]?.baselineDocumentVersionId,
    BASELINE_VERSION_ID,
  );
  assert.equal(
    harness.reviewInputs[0]?.revisionDocumentVersionId,
    REVISION_VERSION_ID,
  );
  assert.deepEqual(harness.loadInputs.at(-1), {
    organisationId: ORGANISATION_ID,
    projectId: PROJECT_ID,
    baselineVersionId: BASELINE_VERSION_ID,
    revisionVersionId: REVISION_VERSION_ID,
  });
  assert.deepEqual(harness.snapshot().comparison.targets, before);
});

test("an exact review retry replays while a changed terminal decision cannot overwrite history", async () => {
  const harness = createHarness();
  const centre = await harness.service.getCentre(scope, PROJECT_ID);
  const command = {
    baselineVersionId: BASELINE_VERSION_ID,
    revisionVersionId: REVISION_VERSION_ID,
    assessmentId: centre.assessment.id,
    radarId: centre.assessment.radarId,
    expectedImpactManifestSha256: centre.assessment.impactManifestSha256,
    expectedAssessmentVersion: 0,
    decision: "accepted" as const,
    reason: "The exact deadline change and listed package impact are correct.",
  };

  const reviewed = await harness.service.review(scope, PROJECT_ID, command);
  const replayed = await harness.service.review(scope, PROJECT_ID, command);
  assert.deepEqual(replayed.review, reviewed.review);
  assert.equal(harness.reviewInputs.length, 1);

  await assert.rejects(
    harness.service.review(scope, PROJECT_ID, {
      ...command,
      expectedAssessmentVersion: reviewed.assessment.version,
      decision: "rejected",
      reason: "Replace the terminal review in place.",
    }),
    (error: unknown) =>
      error instanceof AddendumImpactServiceError &&
      error.code === "stale_version",
  );
  assert.equal(harness.reviewInputs.length, 2);
  assert.equal(harness.snapshot().review?.decision, "accepted");
});

test("reopening is denied until the current named review accepts the plan", async () => {
  const harness = createHarness();
  const centre = await harness.service.getCentre(scope, PROJECT_ID);
  await assert.rejects(
    harness.service.apply(scope, PROJECT_ID, {
      baselineVersionId: BASELINE_VERSION_ID,
      revisionVersionId: REVISION_VERSION_ID,
      assessmentId: centre.assessment.id,
      radarId: centre.assessment.radarId,
      expectedImpactManifestSha256: centre.assessment.impactManifestSha256,
      expectedAssessmentVersion: centre.assessment.version,
      reason: "Apply the deadline addendum.",
      confirmation: ADDENDUM_REOPEN_CONFIRMATION,
    }),
    (error: unknown) =>
      error instanceof AddendumImpactServiceError &&
      error.code === "review_required",
  );
  assert.equal(harness.applyInputs.length, 0);
});

test("a separate confirmed action applies only the reviewed version-bound plan", async () => {
  const harness = createHarness();
  const centre = await harness.service.getCentre(scope, PROJECT_ID);
  const reviewed = await harness.service.review(scope, PROJECT_ID, {
    baselineVersionId: BASELINE_VERSION_ID,
    revisionVersionId: REVISION_VERSION_ID,
    assessmentId: centre.assessment.id,
    radarId: centre.assessment.radarId,
    expectedImpactManifestSha256: centre.assessment.impactManifestSha256,
    expectedAssessmentVersion: centre.assessment.version,
    decision: "accepted",
    reason: "The exact deadline change and package impact are correct.",
  });
  const command = {
    baselineVersionId: BASELINE_VERSION_ID,
    revisionVersionId: REVISION_VERSION_ID,
    assessmentId: reviewed.assessment.id,
    radarId: reviewed.assessment.radarId,
    expectedImpactManifestSha256: reviewed.assessment.impactManifestSha256,
    expectedAssessmentVersion: reviewed.assessment.version,
    reason: "Reopen only the reviewed affected work.",
    confirmation: ADDENDUM_REOPEN_CONFIRMATION,
  } as const;
  const applied = await harness.service.apply(
    applyingScope,
    PROJECT_ID,
    command,
  );
  assert.equal(applied.application.mutationCount, 1);
  assert.equal(applied.application.appliedByUserId, APPLIER_ID);
  assert.equal(harness.applyInputs.length, 1);
  assert.deepEqual(harness.applyInputs[0]?.mutations, [
    {
      targetId: TARGET_ID,
      objectType: "package",
      expectedVersion: 3,
      fromState: "signed_off",
      toState: "invalidated",
      reason: "Reopen only the reviewed affected work.",
      changeIds: [reviewed.assessment.changes[0]?.id],
    },
  ]);
  const replayed = await harness.service.apply(
    applyingScope,
    PROJECT_ID,
    command,
  );
  assert.equal(replayed.replayed, true);
  assert.equal(harness.applyInputs.length, 1);
});

test("the same person cannot review and apply even with both permissions", async () => {
  const harness = createHarness();
  const centre = await harness.service.getCentre(scope, PROJECT_ID);
  const reviewed = await harness.service.review(scope, PROJECT_ID, {
    baselineVersionId: BASELINE_VERSION_ID,
    revisionVersionId: REVISION_VERSION_ID,
    assessmentId: centre.assessment.id,
    radarId: centre.assessment.radarId,
    expectedImpactManifestSha256: centre.assessment.impactManifestSha256,
    expectedAssessmentVersion: centre.assessment.version,
    decision: "accepted",
    reason: "The exact impact plan is correct.",
  });

  await assert.rejects(
    harness.service.apply(scope, PROJECT_ID, {
      baselineVersionId: BASELINE_VERSION_ID,
      revisionVersionId: REVISION_VERSION_ID,
      assessmentId: reviewed.assessment.id,
      radarId: reviewed.assessment.radarId,
      expectedImpactManifestSha256: reviewed.assessment.impactManifestSha256,
      expectedAssessmentVersion: reviewed.assessment.version,
      reason: "Attempt to apply my own review.",
      confirmation: ADDENDUM_REOPEN_CONFIRMATION,
    }),
    (error: unknown) =>
      error instanceof AddendumImpactServiceError &&
      error.code === "review_required",
  );
  assert.equal(harness.applyInputs.length, 0);
});

test("stale manifests are rejected before repository writes", async () => {
  const harness = createHarness();
  const centre = await harness.service.getCentre(scope, PROJECT_ID);
  await assert.rejects(
    harness.service.review(scope, PROJECT_ID, {
      baselineVersionId: BASELINE_VERSION_ID,
      revisionVersionId: REVISION_VERSION_ID,
      assessmentId: centre.assessment.id,
      radarId: centre.assessment.radarId,
      expectedImpactManifestSha256: "f".repeat(64),
      expectedAssessmentVersion: centre.assessment.version,
      decision: "accepted",
      reason: "This request is stale.",
    }),
    (error: unknown) =>
      error instanceof AddendumImpactServiceError &&
      error.code === "stale_version",
  );
  assert.equal(harness.reviewInputs.length, 0);
});
