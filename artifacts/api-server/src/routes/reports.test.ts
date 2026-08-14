import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  toCsv,
  withReviewState,
  requirementReviewState,
  suggestedFlagReviewState,
} from "../lib/reportCsv";

/**
 * Guards the export handler's `review_state` stamping so a future refactor of
 * `/projects/:id/export` (or a change to how review state is derived) cannot
 * silently leak raw AI suggestions as reviewer-confirmed findings.
 *
 * The derivation mirrors the DOCX report segregation in `lib/docx.ts`:
 *   - a requirement is confirmed unless its `reviewStatus` is still "suggested"
 *   - evidence and defects carry an explicit `suggested` boolean
 */

/** Parse a CSV string into a header list and an array of row objects. */
function parseCsv(csv: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const lines = csv.split("\n");
  const headers = lines[0].split(",");
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(headers.map((h, i) => [h, cells[i]]));
  });
  return { headers, rows };
}

describe("export review_state derivation", () => {
  test("a requirement is suggested only when reviewStatus === 'suggested'", () => {
    assert.equal(
      requirementReviewState({ reviewStatus: "suggested" }),
      "suggested",
    );
    assert.equal(
      requirementReviewState({ reviewStatus: "pending" }),
      "confirmed",
    );
    assert.equal(
      requirementReviewState({ reviewStatus: "accepted" }),
      "confirmed",
    );
    assert.equal(
      requirementReviewState({ reviewStatus: "rejected" }),
      "confirmed",
    );
  });

  test("evidence/defects are driven by their `suggested` boolean", () => {
    assert.equal(suggestedFlagReviewState({ suggested: true }), "suggested");
    assert.equal(suggestedFlagReviewState({ suggested: false }), "confirmed");
  });

  test("derivation matches the DOCX confirmed-vs-suggested split", () => {
    // docx.ts confirmed requirements: reviewStatus !== "suggested"
    const reqStatuses = ["suggested", "pending", "accepted", "rejected"];
    for (const reviewStatus of reqStatuses) {
      const docxConfirmed = reviewStatus !== "suggested";
      const state = requirementReviewState({ reviewStatus });
      assert.equal(
        state === "confirmed",
        docxConfirmed,
        `requirement ${reviewStatus}`,
      );
    }
    // docx.ts confirmed defects: !d.suggested
    for (const suggested of [true, false]) {
      const docxConfirmed = !suggested;
      const state = suggestedFlagReviewState({ suggested });
      assert.equal(
        state === "confirmed",
        docxConfirmed,
        `defect suggested=${suggested}`,
      );
    }
  });
});

describe("export CSVs carry a correct review_state column", () => {
  test("requirements.csv stamps confirmed unless reviewStatus === 'suggested'", () => {
    const reqs = [
      { id: "r1", text: "Bid bond", reviewStatus: "suggested" },
      { id: "r2", text: "Tax clearance", reviewStatus: "pending" },
      { id: "r3", text: "BBBEE cert", reviewStatus: "accepted" },
      { id: "r4", text: "Reference letter", reviewStatus: "rejected" },
    ];
    const csv = toCsv(withReviewState(reqs, requirementReviewState));
    const { headers, rows } = parseCsv(csv);

    assert.ok(headers.includes("review_state"), "review_state column present");
    assert.equal(rows[0].review_state, "suggested");
    assert.equal(rows[1].review_state, "confirmed");
    assert.equal(rows[2].review_state, "confirmed");
    assert.equal(rows[3].review_state, "confirmed");
    // original columns are preserved alongside the stamp
    assert.equal(rows[0].id, "r1");
    assert.equal(rows[1].text, "Tax clearance");
  });

  test("evidence.csv stamps by the `suggested` boolean", () => {
    const ev = [
      { id: "e1", requirementId: "r1", suggested: true },
      { id: "e2", requirementId: "r2", suggested: false },
    ];
    const csv = toCsv(withReviewState(ev, suggestedFlagReviewState));
    const { headers, rows } = parseCsv(csv);

    assert.ok(headers.includes("review_state"));
    assert.equal(rows[0].review_state, "suggested");
    assert.equal(rows[1].review_state, "confirmed");
  });

  test("defects.csv stamps by the `suggested` boolean", () => {
    const defs = [
      { id: "d1", description: "Missing signature", suggested: true },
      { id: "d2", description: "Late submission", suggested: false },
    ];
    const csv = toCsv(withReviewState(defs, suggestedFlagReviewState));
    const { headers, rows } = parseCsv(csv);

    assert.ok(headers.includes("review_state"));
    assert.equal(rows[0].review_state, "suggested");
    assert.equal(rows[1].review_state, "confirmed");
  });

  test("an all-suggested register never emits a 'confirmed' row", () => {
    const reqs = [
      { id: "r1", reviewStatus: "suggested" },
      { id: "r2", reviewStatus: "suggested" },
    ];
    const { rows } = parseCsv(
      toCsv(withReviewState(reqs, requirementReviewState)),
    );
    assert.ok(rows.every((r) => r.review_state === "suggested"));
    assert.ok(!rows.some((r) => r.review_state === "confirmed"));
  });
});
