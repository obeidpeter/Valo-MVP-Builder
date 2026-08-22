import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  parseProposedStructuredSnapshot,
  resolveEffectiveStructuredFields,
  selectExactCurrentDocumentVersion,
  type DocumentVersionCandidate,
} from "./documentVersionSnapshotPolicy";

const documentId = "22222222-2222-4222-8222-222222222222";
const versionId = "33333333-3333-4333-8333-333333333333";
const current = {
  organisationId: "11111111-1111-4111-8111-111111111111",
  documentId,
  objectPath: "documents/current.pdf",
  sha256: "a".repeat(64),
  sizeBytes: 42,
};

function candidate(
  id: string,
  overrides: Partial<DocumentVersionCandidate> = {},
): DocumentVersionCandidate {
  return { id, addendumStatus: "not_assessed", ...current, ...overrides };
}

test("selects one exact current byte identity and fails ambiguity", () => {
  const exact = candidate("current");
  assert.equal(
    selectExactCurrentDocumentVersion(
      [candidate("history", { sha256: "b".repeat(64) }), exact],
      current,
    )?.id,
    "current",
  );
  assert.equal(
    selectExactCurrentDocumentVersion(
      [candidate("current-1"), candidate("current-2")],
      current,
    ),
    null,
  );
});

describe("explicit v2 structured proposal", () => {
  const canonicalText = "Submission deadline: 30 September 2026";
  const field = {
    externalId: "submission.deadline",
    category: "deadline",
    value: "30 September 2026",
    startOffset: 21,
    endOffset: 38,
  };
  const solicitation = {
    schema: "valo.addendum-structured-snapshot/v2",
    sourceId: documentId,
    sourceKind: "solicitation",
    mode: "full",
    baseVersionId: null,
    authority: "authoritative",
    origin: `document:${documentId}:version:${versionId}`,
    fields: [field],
    operations: [],
  };

  test("accepts exact full solicitation fields", () => {
    assert.ok(
      parseProposedStructuredSnapshot({
        value: solicitation,
        canonicalText,
        documentId,
        documentVersionId: versionId,
      }),
    );
  });

  test("rejects inferred, unstable, extra-key or inexact identity", () => {
    for (const value of [
      { ...solicitation, sourceId: versionId },
      { ...solicitation, sourceKind: "addendum" },
      { ...solicitation, mode: "delta" },
      { ...solicitation, fields: [{ ...field, startOffset: 20 }] },
      { ...solicitation, fields: [{ ...field, externalId: "bad id" }] },
      { ...solicitation, filename: "tender.pdf" },
    ]) {
      assert.equal(
        parseProposedStructuredSnapshot({
          value,
          canonicalText,
          documentId,
          documentVersionId: versionId,
        }),
        null,
      );
    }
  });

  test("accepts exact delta operations only with an explicit predecessor", () => {
    const instruction = "Submission deadline";
    const delta = {
      ...solicitation,
      sourceKind: "addendum",
      mode: "delta",
      baseVersionId: "44444444-4444-4444-8444-444444444444",
      fields: [],
      operations: [
        {
          operation: "remove",
          externalId: "submission.deadline",
          category: "deadline",
          instruction,
          startOffset: 0,
          endOffset: instruction.length,
        },
      ],
    };
    const parsed = parseProposedStructuredSnapshot({
      value: delta,
      canonicalText,
      documentId,
      documentVersionId: versionId,
    });
    assert.ok(parsed);
    const predecessor = new Map([[field.externalId, field]]);
    assert.equal(
      resolveEffectiveStructuredFields(parsed, predecessor)?.size,
      0,
    );
    assert.equal(
      parseProposedStructuredSnapshot({
        value: { ...delta, baseVersionId: null },
        canonicalText,
        documentId,
        documentVersionId: versionId,
      }),
      null,
    );
  });

  test("full mode rejects an implicit deletion", () => {
    const parsed = parseProposedStructuredSnapshot({
      value: {
        ...solicitation,
        sourceKind: "addendum",
        baseVersionId: "44444444-4444-4444-8444-444444444444",
        fields: [
          {
            ...field,
            externalId: "submission.other",
          },
        ],
      },
      canonicalText,
      documentId,
      documentVersionId: versionId,
    });
    assert.ok(parsed);
    assert.equal(
      resolveEffectiveStructuredFields(
        parsed,
        new Map([[field.externalId, field]]),
      ),
      null,
    );
  });
});
