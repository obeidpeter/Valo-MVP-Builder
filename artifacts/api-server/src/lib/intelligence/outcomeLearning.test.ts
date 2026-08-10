import assert from "node:assert/strict";
import test from "node:test";
import { sha256Text, type ExactCitation, type SourceDocument } from "./domain";
import { proposeOutcomeLessons } from "./outcomeLearning";

const accepted = {
  state: "accepted" as const,
  reviewerId: "governance-1",
  reviewedAt: "2026-08-10T10:00:00.000Z",
};
const content =
  "Client confirmed loss. Missing signature: Signature absent on form A. Missing signature: Signature absent on form B.";
const source: SourceDocument = {
  sourceId: "debrief",
  versionId: "v1",
  kind: "other",
  title: "Client debrief",
  content,
  contentSha256: sha256Text(content),
  capturedAt: "2026-08-09T10:00:00.000Z",
  authority: "authoritative",
  origin: "client:debrief",
};
function citeFrom(item: SourceDocument, quote = item.content): ExactCitation {
  const startOffset = item.content.indexOf(quote);
  return {
    sourceId: item.sourceId,
    sourceVersionId: item.versionId,
    contentSha256: item.contentSha256,
    startOffset,
    endOffset: startOffset + quote.length,
    quote,
  };
}
function cite(quote = content): ExactCitation {
  return citeFrom(source, quote);
}
const base = {
  organisationId: "org-1",
  projectId: "project-1",
  sources: [source],
  outcome: {
    externalId: "outcome-1",
    disposition: "lost" as const,
    clientConfirmed: true,
    citations: [cite("Client confirmed loss.")],
    review: accepted,
  },
  defects: [
    {
      externalId: "defect-1",
      defectCode: "missing_signature",
      description: "Signature absent on form A",
      citations: [cite("Missing signature: Signature absent on form A.")],
      review: accepted,
    },
    {
      externalId: "defect-2",
      defectCode: "missing_signature",
      description: "Signature absent on form B",
      citations: [cite("Missing signature: Signature absent on form B.")],
      review: accepted,
    },
  ],
};

test("proposes a repeated-defect lesson only after named review", () => {
  const first = proposeOutcomeLessons(base);
  const lessonId = first.lessons[0]?.lessonId;
  assert.ok(lessonId);
  const ready = proposeOutcomeLessons({
    ...base,
    lessonReviews: { [lessonId]: accepted },
  });
  assert.equal(ready.status, "ready");
  assert.equal(ready.lessons[0]?.reusableInsideTenant, true);
  assert.equal(ready.modelTrainingAuthorized, false);
  assert.equal(ready.crossTenantReuseAuthorized, false);
  assert.deepEqual(ready.scope, {
    organisationId: "org-1",
    projectId: "project-1",
  });
});

test("blocks a defect description or code that is unrelated to its citation", () => {
  const result = proposeOutcomeLessons({
    ...base,
    defects: [
      { ...base.defects[0], description: "Uncited pricing defect" },
      base.defects[1],
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(
    result.issues.some((issue) => issue.code === "outcome_defect_not_cited"),
    true,
  );
});

test("binds every lesson run to an explicit tenant and project scope", () => {
  const result = proposeOutcomeLessons({ ...base, projectId: "bad id" });
  assert.equal(result.status, "blocked");
  assert.equal(
    result.issues.some(
      (issue) => issue.code === "invalid_outcome_learning_scope",
    ),
    true,
  );
});

test("blocks learning from an unconfirmed outcome", () => {
  const result = proposeOutcomeLessons({
    ...base,
    outcome: { ...base.outcome, clientConfirmed: false },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.readyForUse, false);
});

test("does not create a lesson below the configured recurrence threshold", () => {
  const result = proposeOutcomeLessons({ ...base, defects: [base.defects[0]] });
  assert.equal(result.lessons.length, 0);
  assert.equal(result.status, "review_required");
});

test("a lesson review cannot transfer after a defect reviewer changes", () => {
  const first = proposeOutcomeLessons(base);
  const lessonId = first.lessons[0]?.lessonId;
  assert.ok(lessonId);
  const changed = proposeOutcomeLessons({
    ...base,
    defects: [
      {
        ...base.defects[0],
        review: { ...accepted, reviewerId: "governance-2" },
      },
      base.defects[1],
    ],
    lessonReviews: { [lessonId]: accepted },
  });
  assert.notEqual(changed.lessons[0]?.lessonId, lessonId);
  assert.equal(changed.status, "blocked");
});

test("defect order does not change lesson identity or citation order", () => {
  const first = proposeOutcomeLessons(base);
  const reversed = proposeOutcomeLessons({
    ...base,
    defects: [...base.defects].reverse(),
  });
  assert.equal(first.lessons[0]?.lessonId, reversed.lessons[0]?.lessonId);
  assert.deepEqual(first.lessons[0]?.citations, reversed.lessons[0]?.citations);
});

test("a lesson review cannot transfer to different outcome evidence", () => {
  const first = proposeOutcomeLessons(base);
  const lessonId = first.lessons[0]!.lessonId;
  const changed = proposeOutcomeLessons({
    ...base,
    outcome: { ...base.outcome, citations: [cite(content)] },
    lessonReviews: { [lessonId]: accepted },
  });
  assert.notEqual(changed.lessons[0]?.lessonId, lessonId);
  assert.equal(changed.status, "blocked");
});

test("does not treat a negated award statement as an affirmative win", () => {
  const negativeContent = "Client confirmed the bid was not awarded.";
  const negativeSource: SourceDocument = {
    ...source,
    sourceId: "negative-debrief",
    content: negativeContent,
    contentSha256: sha256Text(negativeContent),
  };
  const result = proposeOutcomeLessons({
    ...base,
    sources: [source, negativeSource],
    outcome: {
      ...base.outcome,
      disposition: "won",
      citations: [citeFrom(negativeSource)],
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(
    result.issues.some(
      (issue) => issue.code === "outcome_disposition_not_cited",
    ),
    true,
  );
});

test("defect-code tokens require boundaries rather than substrings", () => {
  const briskContent =
    "The brisk review issue occurred twice. The brisk approval issue occurred twice.";
  const briskSource: SourceDocument = {
    ...source,
    sourceId: "brisk-debrief",
    content: briskContent,
    contentSha256: sha256Text(briskContent),
  };
  const result = proposeOutcomeLessons({
    ...base,
    sources: [source, briskSource],
    defects: [
      {
        ...base.defects[0],
        defectCode: "risk",
        description: "The brisk review issue occurred twice",
        citations: [
          citeFrom(briskSource, "The brisk review issue occurred twice."),
        ],
      },
      {
        ...base.defects[1],
        defectCode: "risk",
        description: "The brisk approval issue occurred twice",
        citations: [
          citeFrom(briskSource, "The brisk approval issue occurred twice."),
        ],
      },
    ],
  });
  assert.equal(result.status, "blocked");
});
