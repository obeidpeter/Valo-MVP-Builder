import assert from "node:assert/strict";
import test from "node:test";
import {
  validateEvidenceGrounding,
  type ApprovedEvidence,
  type GroundedClaim,
} from "./evidenceGrounding";

const evidence: ApprovedEvidence = {
  id: "ev-1",
  versionId: "ev-1-v2",
  tenantId: "tenant-a",
  state: "approved",
  validFrom: "2026-01-01T00:00:00Z",
  validUntil: "2026-12-31T23:59:59Z",
};

const claim = (overrides: Partial<GroundedClaim> = {}): GroundedClaim => ({
  id: "claim-1",
  tenantId: "tenant-a",
  text: "The bidder completed three bridge projects.",
  kind: "material_factual",
  evidenceLinks: [
    {
      evidenceId: "ev-1",
      evidenceVersionId: "ev-1-v2",
      citation: "p. 4, table 2",
    },
  ],
  ...overrides,
});

const validate = (
  claims: GroundedClaim[],
  evidenceSet: ApprovedEvidence[] = [evidence],
) =>
  validateEvidenceGrounding({
    tenantId: "tenant-a",
    engagementId: "eng-1",
    tenderCategory: "works",
    claims,
    evidence: evidenceSet,
    asOf: "2026-08-08T12:00:00Z",
    releaseMode: true,
  });

test("approved, current, cited evidence releases a material claim", () => {
  const result = validate([claim()]);
  assert.equal(result.releasable, true);
  assert.deepEqual(result.approvedEvidenceIds, ["ev-1"]);
});

test("all deliberately unsupported claim forms are rejected", () => {
  const cases: Array<[GroundedClaim, ApprovedEvidence[], string]> = [
    [claim({ evidenceLinks: [] }), [evidence], "missing_evidence"],
    [
      claim({
        evidenceLinks: [
          { evidenceId: "missing", evidenceVersionId: "v1", citation: "p. 1" },
        ],
      }),
      [evidence],
      "evidence_not_found",
    ],
    [
      claim({
        evidenceLinks: [
          { evidenceId: "ev-1", evidenceVersionId: "stale", citation: "p. 1" },
        ],
      }),
      [evidence],
      "evidence_version_mismatch",
    ],
    [claim(), [{ ...evidence, tenantId: "tenant-b" }], "cross_tenant_evidence"],
    [claim(), [{ ...evidence, state: "withdrawn" }], "evidence_not_approved"],
    [
      claim(),
      [{ ...evidence, validFrom: "2027-01-01T00:00:00Z" }],
      "evidence_not_yet_valid",
    ],
    [
      claim(),
      [{ ...evidence, validUntil: "2026-01-02T00:00:00Z" }],
      "evidence_expired",
    ],
    [
      claim(),
      [{ ...evidence, allowedEngagementIds: ["other"] }],
      "evidence_restricted",
    ],
    [
      claim(),
      [{ ...evidence, prohibitedTenderCategories: ["works"] }],
      "evidence_restricted",
    ],
    [
      claim({
        evidenceLinks: [{ evidenceId: "ev-1", evidenceVersionId: "ev-1-v2" }],
      }),
      [evidence],
      "evidence_citation_missing",
    ],
  ];

  for (const [seededClaim, seededEvidence, expected] of cases) {
    const result = validate([seededClaim], seededEvidence);
    assert.equal(result.releasable, false);
    assert.equal(result.blockers[0]?.code, expected);
  }
});

test("release rejects placeholders while draft review may retain them", () => {
  const placeholder = claim({
    kind: "unresolved_placeholder",
    evidenceLinks: [],
  });
  assert.equal(
    validate([placeholder]).blockers[0]?.code,
    "unresolved_placeholder",
  );
  const draft = validateEvidenceGrounding({
    tenantId: "tenant-a",
    engagementId: "eng-1",
    claims: [placeholder],
    evidence: [],
    asOf: "2026-08-08T12:00:00Z",
    releaseMode: false,
  });
  assert.equal(draft.releasable, true);
});

test("non-factual prose needs no fabricated citation", () => {
  assert.equal(
    validate([claim({ kind: "non_factual", evidenceLinks: [] })]).releasable,
    true,
  );
});
