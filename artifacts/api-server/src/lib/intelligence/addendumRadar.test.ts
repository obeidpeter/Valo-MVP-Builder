import assert from "node:assert/strict";
import test from "node:test";
import { sha256Text, type ExactCitation, type SourceDocument } from "./domain";
import {
  detectAddendumChanges,
  type AddendumRadarInput,
} from "./addendumRadar";

const accepted = {
  state: "accepted" as const,
  reviewerId: "bid-lead-1",
  reviewedAt: "2026-08-10T10:00:00.000Z",
};

function source(
  sourceId: string,
  kind: SourceDocument["kind"],
  capturedAt: string,
  content: string,
): SourceDocument {
  return {
    sourceId,
    versionId: "v1",
    kind,
    title: sourceId,
    content,
    contentSha256: sha256Text(content),
    capturedAt,
    authority: "authoritative",
    origin: `official:${sourceId}`,
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
  "tender-base",
  "solicitation",
  "2026-08-01T08:00:00.000Z",
  "Submission deadline: 12 August 2026. Opening: Abuja.",
);
const addendum = source(
  "tender-addendum-1",
  "addendum",
  "2026-08-05T08:00:00.000Z",
  "Submission deadline: 19 August 2026. Opening: Abuja.",
);

const input: AddendumRadarInput = {
  sources: [baseline, addendum],
  baseline: {
    sourceId: baseline.sourceId,
    sourceVersionId: baseline.versionId,
    fields: [
      {
        externalId: "submission-deadline",
        category: "deadline",
        value: "12 August 2026",
        citation: cite(baseline, "12 August 2026"),
      },
      {
        externalId: "opening-location",
        category: "opening",
        value: "Abuja",
        citation: cite(baseline, "Abuja"),
      },
    ],
  },
  revision: {
    sourceId: addendum.sourceId,
    sourceVersionId: addendum.versionId,
    fields: [
      {
        externalId: "submission-deadline",
        category: "deadline",
        value: "19 August 2026",
        citation: cite(addendum, "19 August 2026"),
      },
      {
        externalId: "opening-location",
        category: "opening",
        value: "Abuja",
        citation: cite(addendum, "Abuja"),
      },
    ],
  },
  trackedArtifacts: [
    {
      externalId: "submission-plan",
      label: "Submission plan",
      dependsOnFieldExternalIds: ["submission-deadline"],
    },
    {
      externalId: "technical-response",
      label: "Technical response",
      dependsOnFieldExternalIds: ["opening-location"],
    },
  ],
};

test("radar detects exact addendum changes and affected artifacts", () => {
  const result = detectAddendumChanges(input);
  assert.equal(result.status, "review_required");
  assert.equal(result.readyForUse, false);
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0]?.kind, "changed");
  assert.equal(result.changes[0]?.beforeValue, "12 August 2026");
  assert.equal(result.changes[0]?.afterValue, "19 August 2026");
  assert.deepEqual(result.changes[0]?.affectedArtifactIds, ["submission-plan"]);
  assert.equal(result.changes[0]?.review.state, "unreviewed");
  assert.equal(result.issues.length, 0);
});

test("the exact generated change and radar require named human acceptance", () => {
  const proposed = detectAddendumChanges(input);
  const changeId = proposed.changes[0]?.changeId;
  assert.ok(changeId);
  const reviewedChanges = detectAddendumChanges({
    ...input,
    changeReviews: { [changeId]: accepted },
  });
  const acceptedResult = detectAddendumChanges({
    ...input,
    changeReviews: { [changeId]: accepted },
    radarReview: { subjectId: reviewedChanges.radarId, review: accepted },
  });
  assert.equal(acceptedResult.status, "ready");
  assert.equal(acceptedResult.readyForUse, true);
});

test("comparison identity is deterministic across field and source order", () => {
  const first = detectAddendumChanges(input);
  const second = detectAddendumChanges({
    ...input,
    sources: [...input.sources].reverse(),
    baseline: {
      ...input.baseline,
      fields: [...input.baseline.fields].reverse(),
    },
    revision: {
      ...input.revision,
      fields: [...input.revision.fields].reverse(),
    },
  });
  assert.equal(second.radarId, first.radarId);
  assert.deepEqual(second.changes, first.changes);
});

test("an unverified addendum fails closed without emitting changes", () => {
  const result = detectAddendumChanges({
    ...input,
    sources: [baseline, { ...addendum, authority: "unverified" }],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.readyForUse, false);
  assert.equal(result.changes.length, 0);
  assert.equal(
    result.issues.some(
      (issue) => issue.code === "revision_not_authoritative_addendum",
    ),
    true,
  );
});

test("a normalized value that does not equal its exact quotation is blocked", () => {
  const result = detectAddendumChanges({
    ...input,
    revision: {
      ...input.revision,
      fields: [
        {
          ...input.revision.fields[0],
          value: "2026-08-19",
        },
        input.revision.fields[1],
      ],
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.changes.length, 0);
  assert.equal(
    result.issues.some((issue) => issue.code === "addendum_field_not_exact"),
    true,
  );
});
