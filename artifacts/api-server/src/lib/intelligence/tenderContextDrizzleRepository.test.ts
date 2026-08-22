import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  citationMatchesImmutableSnapshot,
  currentArtifactAuthorityMatches,
  isCanonicalSnapshotRedactionStatus,
  legalEntityNameMatchesCitation,
  serializedTenderValueWithinBound,
  uniqueCitationOffset,
} from "./tenderContextPersistencePolicy";

const acceptedAuthority = {
  vaultItemVersionId: "version-1",
  documentVersionId: "document-version-1",
  documentVersionSha256: "a".repeat(64),
  label: "CAC certificate",
  issuer: "CAC",
  validFrom: "2026-01-01",
  validUntil: "2026-12-31",
  reviewerId: "reviewer-1",
  reviewedAt: "2026-01-02T00:00:00.000Z",
};

const currentAuthority = {
  vaultItemVersionId: "version-1",
  vaultItemOrganisationId: "organisation-1",
  versionOrganisationId: "organisation-1",
  expectedOrganisationId: "organisation-1",
  clientId: "client-1",
  expectedClientId: "client-1",
  itemStatus: "active",
  sourceDocumentId: "document-1",
  documentId: "document-1",
  versionDocumentId: "document-1",
  documentVersionId: "document-version-1",
  documentVersionSha256: "a".repeat(64),
  snapshotDocumentVersionSha256: "a".repeat(64),
  verificationState: "approved",
  withdrawnAt: null,
  approvedByUserId: "reviewer-1",
  approvedAt: new Date("2026-01-02T00:00:00.000Z"),
  approverStatus: "active",
  approverName: "Named Reviewer",
  label: "CAC certificate",
  issuer: "CAC",
  validFrom: "2026-01-01",
  validUntil: "2026-12-31",
};

describe("tender context immutable citation boundary", () => {
  test("rejects withdrawn, inactive, unlinked or byte-drifted live evidence", () => {
    assert.equal(
      currentArtifactAuthorityMatches(acceptedAuthority, currentAuthority),
      true,
    );
    for (const drift of [
      { withdrawnAt: new Date("2026-02-01T00:00:00.000Z") },
      { itemStatus: "inactive" },
      { sourceDocumentId: null },
      { verificationState: "revoked" },
      { documentVersionId: "replacement-version" },
      { documentVersionSha256: "b".repeat(64) },
      { snapshotDocumentVersionSha256: "b".repeat(64) },
      { approverStatus: "disabled" },
    ]) {
      assert.equal(
        currentArtifactAuthorityMatches(acceptedAuthority, {
          ...currentAuthority,
          ...drift,
        }),
        false,
      );
    }
  });
  test("accepts only an exact UTF-16 offset and quote", () => {
    const text = "Eligibility: Ada Infrastructure Limited\nCAC certificate";
    const quote = "Ada Infrastructure Limited";
    const startOffset = text.indexOf(quote);
    assert.equal(
      citationMatchesImmutableSnapshot(text, {
        startOffset,
        endOffset: startOffset + quote.length,
        quote,
      }),
      true,
    );
    assert.equal(
      citationMatchesImmutableSnapshot(text, {
        startOffset: startOffset + 1,
        endOffset: startOffset + quote.length,
        quote,
      }),
      false,
    );
    assert.equal(
      citationMatchesImmutableSnapshot(text, {
        startOffset,
        endOffset: startOffset + quote.length,
        quote: "Unrelated Limited",
      }),
      false,
    );
  });

  test("rejects a repeated legacy snippet instead of inventing an offset", () => {
    assert.equal(uniqueCitationOffset("Clause A — Clause A", "Clause A"), null);
    assert.equal(uniqueCitationOffset("aaaa", "aaa"), null);
    assert.equal(uniqueCitationOffset("Before Clause A After", "Clause A"), 7);
    assert.equal(uniqueCitationOffset("No match", "Clause A"), null);
  });

  test("a caller cannot type the tender entity name onto unrelated evidence", () => {
    assert.equal(
      legalEntityNameMatchesCitation(
        "Ada Infrastructure Limited",
        "Unrelated Holdings Limited",
      ),
      false,
    );
    assert.equal(
      legalEntityNameMatchesCitation(
        "ADA  INFRASTRUCTURE LIMITED",
        "Ada Infrastructure Limited",
      ),
      true,
    );
  });

  test("only included or redacted snapshots enter the canonical source set", () => {
    assert.equal(isCanonicalSnapshotRedactionStatus("included"), true);
    assert.equal(isCanonicalSnapshotRedactionStatus("redacted"), true);
    assert.equal(isCanonicalSnapshotRedactionStatus("excluded"), false);
    assert.equal(isCanonicalSnapshotRedactionStatus("pending"), false);
  });

  test("rejects serialized values before either code-unit or UTF-8 persistence bounds", () => {
    assert.equal(serializedTenderValueWithinBound("{}", 2, 2), true);
    assert.equal(serializedTenderValueWithinBound("{}x", 2, 16), false);
    assert.equal(serializedTenderValueWithinBound("é", 2, 1), false);
    assert.equal(serializedTenderValueWithinBound("", 10, 10), false);
  });
});
