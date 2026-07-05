import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeScorecard, type ScorecardRow } from "./scorecard";

const row = (over: Partial<ScorecardRow>): ScorecardRow => ({
  sourceDocId: "doc-1",
  origin: "engine",
  isMandatory: true,
  reviewStatus: "confirmed",
  ...over,
});

describe("computeScorecard - mandatory recall (FR-EXT-05)", () => {
  test("perfect extraction: recall 1 when every verified mandatory row is engine-surfaced", () => {
    const sc = computeScorecard([
      row({}),
      row({ reviewStatus: "edited" }),
    ]);
    assert.equal(sc.totals.mandatoryEngineVerified, 2);
    assert.equal(sc.totals.mandatoryVerifiedTotal, 2);
    assert.equal(sc.totals.mandatoryRecall, 1);
  });

  test("manual additions are engine misses and lower recall", () => {
    // Engine surfaced 3 verified mandatory; reviewer added 1 the engine missed.
    const sc = computeScorecard([
      row({}),
      row({}),
      row({ reviewStatus: "edited" }),
      row({ origin: "manual" }),
    ]);
    assert.equal(sc.totals.mandatoryEngineVerified, 3);
    assert.equal(sc.totals.mandatoryVerifiedTotal, 4);
    assert.equal(sc.totals.mandatoryRecall, 0.75);
    assert.equal(sc.totals.manualVerified, 1);
  });

  test("rejected engine rows are false positives and never enter recall", () => {
    const sc = computeScorecard([
      row({}),
      row({ reviewStatus: "rejected" }),
      row({ reviewStatus: "rejected", isMandatory: false }),
    ]);
    assert.equal(sc.totals.engineRejected, 2);
    assert.equal(sc.totals.mandatoryEngineVerified, 1);
    assert.equal(sc.totals.mandatoryVerifiedTotal, 1);
    assert.equal(sc.totals.mandatoryRecall, 1);
  });

  test("suggested/pending rows are counted but excluded from recall", () => {
    const sc = computeScorecard([
      row({ reviewStatus: "suggested" }),
      row({ reviewStatus: "pending" }),
    ]);
    assert.equal(sc.totals.engineUnreviewed, 2);
    assert.equal(sc.totals.mandatoryVerifiedTotal, 0);
    assert.equal(sc.totals.mandatoryRecall, null);
  });

  test("non-mandatory rows never affect mandatory recall", () => {
    const sc = computeScorecard([
      row({ isMandatory: false }),
      row({ origin: "manual", isMandatory: false }),
      row({}),
    ]);
    assert.equal(sc.totals.mandatoryEngineVerified, 1);
    assert.equal(sc.totals.mandatoryVerifiedTotal, 1);
    assert.equal(sc.totals.mandatoryRecall, 1);
  });

  test("recall is null (not 0, not 1) when nothing has been verified", () => {
    assert.equal(computeScorecard([]).totals.mandatoryRecall, null);
  });
});

describe("computeScorecard - legacy rows and grouping", () => {
  test("legacy rows (origin null) are excluded from every figure and reported", () => {
    const sc = computeScorecard([
      row({ origin: null }),
      row({ origin: "unknown-junk" }),
      row({}),
    ]);
    assert.equal(sc.legacyRows, 2);
    assert.equal(sc.totals.mandatoryVerifiedTotal, 1);
    assert.equal(sc.totals.mandatoryRecall, 1);
  });

  test("per-document breakdown groups by sourceDocId with unattributed last", () => {
    const sc = computeScorecard([
      row({ sourceDocId: "doc-b" }),
      row({ sourceDocId: "doc-a" }),
      row({ sourceDocId: "doc-a", origin: "manual" }),
      row({ sourceDocId: null, origin: "manual" }),
    ]);
    assert.deepEqual(
      sc.perDocument.map((d) => d.documentId),
      ["doc-a", "doc-b", null],
    );
    const docA = sc.perDocument[0];
    assert.equal(docA.mandatoryEngineVerified, 1);
    assert.equal(docA.mandatoryVerifiedTotal, 2);
    assert.equal(docA.mandatoryRecall, 0.5);
    const docB = sc.perDocument[1];
    assert.equal(docB.mandatoryRecall, 1);
  });

  test("figures are reproducible: totals equal the sum of per-document counts", () => {
    const rows: ScorecardRow[] = [
      row({ sourceDocId: "d1" }),
      row({ sourceDocId: "d1", reviewStatus: "rejected" }),
      row({ sourceDocId: "d2", reviewStatus: "edited" }),
      row({ sourceDocId: "d2", origin: "manual" }),
      row({ sourceDocId: null, origin: "manual", isMandatory: false }),
    ];
    const sc = computeScorecard(rows);
    const summed = sc.perDocument.reduce(
      (acc, d) => ({
        engineConfirmed: acc.engineConfirmed + d.engineConfirmed,
        engineEdited: acc.engineEdited + d.engineEdited,
        engineRejected: acc.engineRejected + d.engineRejected,
        engineUnreviewed: acc.engineUnreviewed + d.engineUnreviewed,
        manualVerified: acc.manualVerified + d.manualVerified,
        mandatoryEngineVerified: acc.mandatoryEngineVerified + d.mandatoryEngineVerified,
        mandatoryVerifiedTotal: acc.mandatoryVerifiedTotal + d.mandatoryVerifiedTotal,
      }),
      {
        engineConfirmed: 0, engineEdited: 0, engineRejected: 0, engineUnreviewed: 0,
        manualVerified: 0, mandatoryEngineVerified: 0, mandatoryVerifiedTotal: 0,
      },
    );
    assert.equal(summed.engineConfirmed, sc.totals.engineConfirmed);
    assert.equal(summed.engineEdited, sc.totals.engineEdited);
    assert.equal(summed.engineRejected, sc.totals.engineRejected);
    assert.equal(summed.engineUnreviewed, sc.totals.engineUnreviewed);
    assert.equal(summed.manualVerified, sc.totals.manualVerified);
    assert.equal(summed.mandatoryEngineVerified, sc.totals.mandatoryEngineVerified);
    assert.equal(summed.mandatoryVerifiedTotal, sc.totals.mandatoryVerifiedTotal);
  });
});
