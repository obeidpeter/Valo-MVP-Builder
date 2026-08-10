import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIntelligenceReviewInbox,
  intelligenceCapabilityFromReviewType,
  type IntelligenceReviewRecord,
} from "./reviewInbox";
import {
  INTELLIGENCE_CAPABILITY_IDS,
  type IntelligenceCentreSnapshot,
} from "./snapshot";

function snapshot(): IntelligenceCentreSnapshot {
  return {
    environment: "production",
    productionAiEnabled: false,
    restrictedMode: false,
    generatedAt: "2026-08-10T12:00:00.000Z",
    project: {
      id: "00000000-0000-4000-8000-000000000001",
      title: "Road works",
      status: "active",
      deadline: "2026-08-12T12:00:00.000Z",
    },
    capabilities: INTELLIGENCE_CAPABILITY_IDS.map((id) => ({
      id,
      state: id === "submission_preflight" ? "review_ready" : "partial",
      stateReason:
        id === "evidence_graph"
          ? "A newer version makes one source stale."
          : "Named review remains required.",
      reviewItemCount: 1,
      citationCount: 2,
      citations: [],
      lastUpdatedAt: "2026-08-10T11:00:00.000Z",
    })),
  };
}

function review(
  overrides: Partial<IntelligenceReviewRecord> = {},
): IntelligenceReviewRecord {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    projectId: "00000000-0000-4000-8000-000000000001",
    reviewType: "intelligence.evidence_graph",
    objectType: "intelligence_capability",
    objectId: "00000000-0000-4000-8000-000000000001",
    reviewerUserId: "00000000-0000-4000-8000-000000000020",
    reviewerName: "Named Reviewer",
    status: "in_review",
    sourceVersion: 1,
    sourceManifestHash: "a".repeat(64),
    findingsValid: true,
    findingsDecision: null,
    version: 1,
    completedAt: null,
    updatedAt: "2026-08-10T11:30:00.000Z",
    ...overrides,
  };
}

test("builds a deterministic deadline-aware inbox without implying AI activation", () => {
  const result = buildIntelligenceReviewInbox({
    snapshot: snapshot(),
    reviews: [review()],
    sourceVersion: 7,
    sourceManifestSha256: "b".repeat(64),
    actorUserId: "00000000-0000-4000-8000-000000000020",
    now: new Date("2026-08-10T12:00:00.000Z"),
    readOnly: false,
  });

  assert.equal(result.productionAiEnabled, false);
  assert.equal(result.readOnly, false);
  assert.equal(result.items.length, 22);
  const preflight = result.items.find(
    ({ capabilityId }) => capabilityId === "submission_preflight",
  );
  assert.equal(preflight?.priority, "critical");
  assert.equal(preflight?.sourceVersion, 7);
  const evidence = result.items.find(
    ({ capabilityId }) => capabilityId === "evidence_graph",
  );
  assert.equal(evidence?.status, "pending");
  assert.equal(evidence?.reviewerName, null);
  assert.equal(evidence?.assignedToCurrentUser, false);
  assert.equal(evidence?.staleSource, true);
  assert.match(result.authorityNote, /does not approve evidence/iu);
});

test("ignores foreign and malformed review records", () => {
  const result = buildIntelligenceReviewInbox({
    snapshot: snapshot(),
    reviews: [
      review({
        version: 2,
        status: "approved",
        sourceVersion: 7,
        sourceManifestHash: "b".repeat(64),
        findingsDecision: "approved",
        completedAt: "2026-08-10T11:45:00.000Z",
      }),
      review({
        id: "00000000-0000-4000-8000-000000000012",
        projectId: "00000000-0000-4000-8000-000000000099",
        objectId: "00000000-0000-4000-8000-000000000099",
      }),
      review({
        id: "00000000-0000-4000-8000-000000000013",
        reviewType: "intelligence.not_real",
      }),
      review({
        id: "00000000-0000-4000-8000-000000000014",
        status: "authoritative",
        reviewType: "intelligence.opportunity_radar",
      }),
    ],
    sourceVersion: 7,
    sourceManifestSha256: "b".repeat(64),
    actorUserId: "00000000-0000-4000-8000-000000000020",
    now: new Date("2026-08-10T12:00:00.000Z"),
  });

  const evidence = result.items.find(
    ({ capabilityId }) => capabilityId === "evidence_graph",
  );
  const opportunity = result.items.find(
    ({ capabilityId }) => capabilityId === "opportunity_radar",
  );
  assert.equal(evidence?.status, "approved");
  assert.equal(evidence?.reviewVersion, 2);
  assert.equal(evidence?.assignedToCurrentUser, false);
  assert.equal(opportunity?.status, "pending");
});

test("fails closed when persisted status, decision and completion disagree", () => {
  const result = buildIntelligenceReviewInbox({
    snapshot: snapshot(),
    reviews: [
      review({
        status: "approved",
        sourceVersion: 7,
        sourceManifestHash: "b".repeat(64),
        findingsDecision: "rejected",
        completedAt: "2026-08-10T11:45:00.000Z",
      }),
      review({
        id: "00000000-0000-4000-8000-000000000015",
        reviewType: "intelligence.response_studio",
        status: "approved",
        sourceVersion: 7,
        sourceManifestHash: "b".repeat(64),
        findingsDecision: "approved",
        completedAt: null,
      }),
    ],
    sourceVersion: 7,
    sourceManifestSha256: "b".repeat(64),
    actorUserId: "00000000-0000-4000-8000-000000000020",
    now: new Date("2026-08-10T12:00:00.000Z"),
  });

  for (const capabilityId of ["evidence_graph", "response_studio"] as const) {
    const item = result.items.find(
      (entry) => entry.capabilityId === capabilityId,
    );
    assert.equal(item?.status, "pending");
    assert.equal(item?.reviewerName, null);
    assert.equal(item?.assignedToCurrentUser, false);
    assert.equal(item?.staleSource, true);
  }
});

test("fails closed when reviewer identity is absent, opaque, blank or unbounded", () => {
  const invalidNames = [
    null,
    "",
    "   ",
    "\u200B",
    "Assigned reviewer",
    "A".repeat(513),
  ];

  for (const [index, reviewerName] of invalidNames.entries()) {
    const result = buildIntelligenceReviewInbox({
      snapshot: snapshot(),
      reviews: [
        review({
          id: `00000000-0000-4000-8000-${String(index + 30).padStart(12, "0")}`,
          reviewerName,
          sourceVersion: 7,
          sourceManifestHash: "b".repeat(64),
        }),
      ],
      sourceVersion: 7,
      sourceManifestSha256: "b".repeat(64),
      actorUserId: "00000000-0000-4000-8000-000000000020",
      now: new Date("2026-08-10T12:00:00.000Z"),
    });

    const evidence = result.items.find(
      ({ capabilityId }) => capabilityId === "evidence_graph",
    );
    assert.equal(evidence?.status, "pending");
    assert.equal(evidence?.reviewerName, null);
    assert.equal(evidence?.assignedToCurrentUser, false);
    assert.equal(evidence?.staleSource, true);
  }
});

test("fails closed instead of choosing among duplicate capability reviews", () => {
  const result = buildIntelligenceReviewInbox({
    snapshot: snapshot(),
    reviews: [
      review({
        id: "00000000-0000-4000-8000-000000000016",
        sourceVersion: 7,
        sourceManifestHash: "b".repeat(64),
      }),
      review({
        id: "00000000-0000-4000-8000-000000000017",
        version: 2,
        sourceVersion: 7,
        sourceManifestHash: "b".repeat(64),
      }),
    ],
    sourceVersion: 7,
    sourceManifestSha256: "b".repeat(64),
    actorUserId: "00000000-0000-4000-8000-000000000020",
    now: new Date("2026-08-10T12:00:00.000Z"),
  });

  const evidence = result.items.find(
    ({ capabilityId }) => capabilityId === "evidence_graph",
  );
  assert.equal(evidence?.status, "pending");
  assert.equal(evidence?.reviewerName, null);
  assert.equal(evidence?.assignedToCurrentUser, false);
  assert.equal(evidence?.staleSource, true);
});

test("an exact manifest mismatch invalidates a numerically colliding review", () => {
  const result = buildIntelligenceReviewInbox({
    snapshot: snapshot(),
    reviews: [
      review({
        status: "approved",
        sourceVersion: 7,
        sourceManifestHash: "c".repeat(64),
      }),
    ],
    sourceVersion: 7,
    sourceManifestSha256: "d".repeat(64),
    actorUserId: "00000000-0000-4000-8000-000000000020",
    now: new Date("2026-08-10T12:00:00.000Z"),
  });

  const evidence = result.items.find(
    ({ capabilityId }) => capabilityId === "evidence_graph",
  );
  assert.equal(evidence?.status, "pending");
  assert.equal(evidence?.staleSource, true);
  assert.equal(evidence?.reviewVersion, 1);
});

test("review type parser accepts only the closed capability set", () => {
  assert.equal(
    intelligenceCapabilityFromReviewType("intelligence.response_studio"),
    "response_studio",
  );
  assert.equal(
    intelligenceCapabilityFromReviewType("intelligence.response_studio.extra"),
    null,
  );
  assert.equal(intelligenceCapabilityFromReviewType("__proto__"), null);
});
