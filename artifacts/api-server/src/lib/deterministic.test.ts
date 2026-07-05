import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  runBoqChecks,
  computeRisk,
  wordsToNumber,
  blockingSignOffDefects,
  computeExpiry,
  type BoqRow,
  type BoqCheckType,
  type RiskInput,
  type Severity,
} from "./deterministic";

/** Collect the check types produced by a run, for concise assertions. */
function checkTypes(rows: BoqRow[], grandTotal?: number | null, tolerance?: number): BoqCheckType[] {
  return runBoqChecks(rows, grandTotal, tolerance).findings.map((f) => f.checkType);
}

describe("wordsToNumber", () => {
  test("parses simple and compound amounts", () => {
    assert.equal(wordsToNumber("one hundred"), 100);
    assert.equal(wordsToNumber("one hundred twenty three"), 123);
    assert.equal(wordsToNumber("one thousand five hundred"), 1500);
    assert.equal(wordsToNumber("two million"), 2_000_000);
    assert.equal(wordsToNumber("forty two"), 42);
  });

  test("ignores currency/filler words", () => {
    assert.equal(wordsToNumber("one hundred rand only"), 100);
    assert.equal(wordsToNumber("one thousand two hundred and thirty four dollars"), 1234);
  });

  test("stops at a bare 'cents' token so a trailing fraction is dropped", () => {
    // The whole-unit value before 'cents' is retained; the 'cents' token halts parsing.
    assert.equal(wordsToNumber("one hundred dollars cents twenty"), 100);
  });

  test("returns null when nothing parseable is present", () => {
    assert.equal(wordsToNumber(null), null);
    assert.equal(wordsToNumber(undefined), null);
    assert.equal(wordsToNumber(""), null);
    assert.equal(wordsToNumber("   "), null);
    assert.equal(wordsToNumber("R1,234.00"), null);
  });
});

describe("runBoqChecks - extension_mismatch", () => {
  test("flags a line whose extension != quantity x rate beyond tolerance", () => {
    const rows: BoqRow[] = [
      { lineRef: "1", description: "Concrete", quantity: 10, unitRate: 5, extension: 60 },
    ];
    const res = runBoqChecks(rows);
    assert.equal(res.findings.length, 1);
    assert.equal(res.findings[0].checkType, "extension_mismatch");
    assert.equal(res.findings[0].computedExtension, 50);
    assert.equal(res.findings[0].severity, "likely_fatal");
  });

  test("passes a correct line with no finding", () => {
    const rows: BoqRow[] = [
      { lineRef: "1", description: "Concrete", quantity: 10, unitRate: 5, extension: 50 },
    ];
    assert.deepEqual(checkTypes(rows), []);
  });

  test("respects the tolerance band on both edges", () => {
    // default tolerance 0.5: a delta exactly at tolerance is NOT flagged (> tol)
    const atTol: BoqRow[] = [{ quantity: 1, unitRate: 100, extension: 100.5 }];
    assert.deepEqual(checkTypes(atTol), []);

    // just beyond tolerance IS flagged
    const beyondTol: BoqRow[] = [{ quantity: 1, unitRate: 100, extension: 100.51 }];
    assert.deepEqual(checkTypes(beyondTol), ["extension_mismatch"]);

    // custom larger tolerance suppresses a small mismatch
    const custom: BoqRow[] = [{ quantity: 1, unitRate: 100, extension: 102 }];
    assert.deepEqual(checkTypes(custom, null, 5), []);
    assert.deepEqual(checkTypes(custom, null, 1), ["extension_mismatch"]);
  });

  test("uses rounded arithmetic to avoid float noise", () => {
    // 0.1 * 3 = 0.30000000000000004; round2 keeps it clean, no false flag
    const rows: BoqRow[] = [{ quantity: 0.1, unitRate: 3, extension: 0.3 }];
    assert.deepEqual(checkTypes(rows), []);
  });
});

describe("runBoqChecks - grand_total", () => {
  test("flags a submitted grand total that != sum of extensions", () => {
    const rows: BoqRow[] = [
      { quantity: 10, unitRate: 5, extension: 50 },
      { quantity: 2, unitRate: 25, extension: 50 },
    ];
    const res = runBoqChecks(rows, 200);
    const gt = res.findings.find((f) => f.checkType === "grand_total");
    assert.ok(gt, "expected a grand_total finding");
    assert.equal(gt.severity, "fatal");
    assert.equal(res.computedGrandTotal, 100);
  });

  test("passes when submitted grand total matches computed total", () => {
    const rows: BoqRow[] = [
      { quantity: 10, unitRate: 5, extension: 50 },
      { quantity: 2, unitRate: 25, extension: 50 },
    ];
    assert.deepEqual(checkTypes(rows, 100), []);
  });

  test("does not run the grand-total check when no grand total is supplied", () => {
    const rows: BoqRow[] = [{ quantity: 10, unitRate: 5, extension: 50 }];
    assert.deepEqual(checkTypes(rows), []);
    assert.deepEqual(checkTypes(rows, null), []);
  });

  test("sums extension-only lines into the computed total", () => {
    const rows: BoqRow[] = [
      { extension: 30 },
      { quantity: 2, unitRate: 10, extension: 20 },
    ];
    const res = runBoqChecks(rows, 50);
    assert.equal(res.computedGrandTotal, 50);
    assert.deepEqual(res.findings.map((f) => f.checkType), []);
  });
});

describe("runBoqChecks - section_total", () => {
  test("flags a declared subtotal marker that != sum of its section lines", () => {
    const rows: BoqRow[] = [
      { lineRef: "1", description: "Earthworks A", quantity: 1, unitRate: 100, extension: 100, section: "A" },
      { lineRef: "2", description: "Earthworks B", quantity: 1, unitRate: 50, extension: 50, section: "A" },
      { lineRef: "S", description: "Subtotal", extension: 200, section: "A" },
    ];
    const res = runBoqChecks(rows);
    const st = res.findings.find((f) => f.checkType === "section_total");
    assert.ok(st, "expected a section_total finding");
    assert.equal(st.computedExtension, 150);
    assert.equal(st.extension, 200);
    // the subtotal marker must not be double-counted into the grand total
    assert.equal(res.computedGrandTotal, 150);
  });

  test("passes when subtotal marker matches its section sum", () => {
    const rows: BoqRow[] = [
      { description: "A1", quantity: 1, unitRate: 100, extension: 100, section: "A" },
      { description: "A2", quantity: 1, unitRate: 50, extension: 50, section: "A" },
      { description: "Sub-total", extension: 150, section: "A" },
    ];
    assert.deepEqual(checkTypes(rows), []);
  });

  test("a subtotal-worded row without a section is treated as a normal line", () => {
    const rows: BoqRow[] = [{ description: "Subtotal", extension: 999 }];
    // no section tag -> not a marker -> counted, no section_total finding
    const res = runBoqChecks(rows, 999);
    assert.deepEqual(res.findings.map((f) => f.checkType), []);
    assert.equal(res.computedGrandTotal, 999);
  });
});

describe("runBoqChecks - blank_line", () => {
  test("flags a priced line with no quantity, rate, or extension", () => {
    const rows: BoqRow[] = [{ lineRef: "1", description: "Mystery item" }];
    const res = runBoqChecks(rows);
    assert.equal(res.findings.length, 1);
    assert.equal(res.findings[0].checkType, "blank_line");
    assert.equal(res.findings[0].severity, "likely_fatal");
  });

  test("null-valued numeric fields count as blank", () => {
    const rows: BoqRow[] = [
      { description: "x", quantity: null, unitRate: null, extension: null },
    ];
    assert.deepEqual(checkTypes(rows), ["blank_line"]);
  });

  test("a line with only an extension is not blank", () => {
    const rows: BoqRow[] = [{ description: "x", extension: 10 }];
    assert.deepEqual(checkTypes(rows), []);
  });
});

describe("runBoqChecks - suspicious_zero", () => {
  test("flags a described line with a zero unit rate", () => {
    const rows: BoqRow[] = [
      { lineRef: "1", description: "Provisional item", quantity: 5, unitRate: 0, extension: 0 },
    ];
    const res = runBoqChecks(rows);
    const sz = res.findings.find((f) => f.checkType === "suspicious_zero");
    assert.ok(sz, "expected suspicious_zero finding");
    assert.equal(sz.severity, "scoring_risk");
  });

  test("does not flag a zero rate when there is no description", () => {
    const rows: BoqRow[] = [{ quantity: 5, unitRate: 0, extension: 0 }];
    assert.deepEqual(checkTypes(rows), []);
  });

  test("does not flag a whitespace-only description", () => {
    const rows: BoqRow[] = [{ description: "   ", quantity: 5, unitRate: 0, extension: 0 }];
    assert.deepEqual(checkTypes(rows), []);
  });
});

describe("runBoqChecks - words_vs_figures", () => {
  test("flags when the amount-in-words disagrees with the figure", () => {
    const rows: BoqRow[] = [
      { quantity: 1, unitRate: 100, extension: 100, amountInWords: "two hundred" },
    ];
    assert.deepEqual(checkTypes(rows), ["words_vs_figures"]);
  });

  test("passes when the words match the figure", () => {
    const rows: BoqRow[] = [
      { quantity: 1, unitRate: 100, extension: 100, amountInWords: "one hundred" },
    ];
    assert.deepEqual(checkTypes(rows), []);
  });

  test("skips the check when words are unparseable", () => {
    const rows: BoqRow[] = [
      { quantity: 1, unitRate: 100, extension: 100, amountInWords: "R100.00" },
    ];
    assert.deepEqual(checkTypes(rows), []);
  });
});

describe("runBoqChecks - combined & empty", () => {
  test("empty rows produce no findings and a zero total", () => {
    const res = runBoqChecks([]);
    assert.deepEqual(res.findings, []);
    assert.equal(res.computedGrandTotal, 0);
  });

  test("a single line can raise multiple independent findings", () => {
    // zero rate (suspicious_zero) AND words disagree (words_vs_figures)
    const rows: BoqRow[] = [
      { description: "Item", quantity: 2, unitRate: 0, extension: 0, amountInWords: "ten" },
    ];
    const types = checkTypes(rows).sort();
    assert.deepEqual(types, ["suspicious_zero", "words_vs_figures"]);
  });
});

/** Build a defect list of a given severity/status. */
function defects(
  spec: { severity: Severity; status: string; n?: number }[],
): RiskInput["defects"] {
  const out: RiskInput["defects"] = [];
  for (const s of spec) {
    for (let i = 0; i < (s.n ?? 1); i++) out.push({ severity: s.severity, status: s.status });
  }
  return out;
}

describe("computeRisk - banding thresholds", () => {
  test("no defects -> score 0, low band", () => {
    const r = computeRisk({ defects: [], requirements: [], evidence: [] });
    assert.equal(r.score, 0);
    assert.equal(r.band, "low");
  });

  test("medium band starts at score 15", () => {
    // 15 = scoring_risk(10) + scoring_risk(10) would be 20; use one scoring_risk + cosmetic to hit exactly 15? 10+3=13 low; add another cosmetic -> 16
    const low = computeRisk({
      defects: defects([{ severity: "scoring_risk", status: "open" }]),
      requirements: [],
      evidence: [],
    });
    assert.equal(low.score, 10);
    assert.equal(low.band, "low");

    const medium = computeRisk({
      defects: defects([
        { severity: "scoring_risk", status: "open" },
        { severity: "scoring_risk", status: "open" },
      ]),
      requirements: [],
      evidence: [],
    });
    assert.equal(medium.score, 20);
    assert.equal(medium.band, "medium");
  });

  test("high band starts at score 40", () => {
    // three likely_fatal = 75 -> but that would be critical(>=70). Use likely_fatal + scoring_risk*? build 40 exactly.
    const r = computeRisk({
      defects: defects([
        { severity: "likely_fatal", status: "open" }, // 25
        { severity: "scoring_risk", status: "open", n: 1 }, // 10
        { severity: "cosmetic", status: "open", n: 1 }, // 3 => 38 medium
      ]),
      requirements: [],
      evidence: [],
    });
    assert.equal(r.score, 38);
    assert.equal(r.band, "medium");

    const high = computeRisk({
      defects: defects([
        { severity: "likely_fatal", status: "open" }, // 25
        { severity: "likely_fatal", status: "open" }, // 25 => 50
      ]),
      requirements: [],
      evidence: [],
    });
    assert.equal(high.score, 50);
    assert.equal(high.band, "high");
  });

  test("critical band starts at score 70 even without a fatal defect", () => {
    const r = computeRisk({
      defects: defects([{ severity: "likely_fatal", status: "open", n: 3 }]), // 75
      requirements: [],
      evidence: [],
    });
    assert.equal(r.score, 75);
    assert.equal(r.band, "critical");
  });

  test("score is clamped to 100", () => {
    const r = computeRisk({
      defects: defects([{ severity: "fatal", status: "open", n: 5 }]), // 200 -> clamp 100
      requirements: [],
      evidence: [],
    });
    assert.equal(r.score, 100);
    assert.equal(r.band, "critical");
  });
});

describe("computeRisk - fatal forces critical", () => {
  test("a single live fatal defect forces critical regardless of low score", () => {
    const r = computeRisk({
      defects: defects([{ severity: "fatal", status: "open" }]), // 40 alone -> high, but fatal forces critical
      requirements: [],
      evidence: [],
    });
    assert.equal(r.band, "critical");
    assert.match(r.explanation, /fatal defect forces the CRITICAL band/i);
  });

  test("a remediated fatal defect does not force critical", () => {
    const r = computeRisk({
      defects: defects([{ severity: "fatal", status: "remediated" }]),
      requirements: [],
      evidence: [],
    });
    assert.equal(r.score, 0);
    assert.equal(r.band, "low");
  });
});

describe("computeRisk - live defect filtering", () => {
  test("only open defects contribute; suggested/waived/remediated are excluded", () => {
    const r = computeRisk({
      defects: defects([
        { severity: "fatal", status: "waived" },
        { severity: "fatal", status: "remediated" },
        { severity: "scoring_risk", status: "suggested" }, // excluded: unconfirmed AI suggestion
        { severity: "cosmetic", status: "open" }, // 3 counts
      ]),
      requirements: [],
      evidence: [],
    });
    assert.equal(r.score, 3);
    assert.equal(r.band, "low");
    assert.equal(r.distribution.fatal, 0);
    assert.equal(r.distribution.scoring_risk, 0);
    assert.equal(r.distribution.cosmetic, 1);
  });
});

describe("computeRisk - evidence penalty (mandatory-only, deduplicated)", () => {
  test("missing/expired evidence on a mandatory requirement adds +5 each", () => {
    const r = computeRisk({
      defects: [],
      requirements: [
        { id: "r1", isMandatory: true, reviewStatus: "pending" },
        { id: "r2", isMandatory: true, reviewStatus: "pending" },
      ],
      evidence: [
        { requirementId: "r1", evidenceStatus: "missing", suggested: false },
        { requirementId: "r2", evidenceStatus: "expired", suggested: false },
      ],
    });
    assert.equal(r.score, 10);
    assert.equal(r.band, "low");
    assert.match(r.explanation, /2 missing\/expired evidence item\(s\) at \+5 each/);
  });

  test("non-mandatory requirements are never penalised", () => {
    const r = computeRisk({
      defects: [],
      requirements: [{ id: "r1", isMandatory: false, reviewStatus: "pending" }],
      evidence: [{ requirementId: "r1", evidenceStatus: "missing", suggested: false }],
    });
    assert.equal(r.score, 0);
    assert.equal(r.band, "low");
  });

  test("present/valid evidence is not penalised", () => {
    const r = computeRisk({
      defects: [],
      requirements: [{ id: "r1", isMandatory: true, reviewStatus: "pending" }],
      evidence: [{ requirementId: "r1", evidenceStatus: "present", suggested: false }],
    });
    assert.equal(r.score, 0);
  });

  test("multiple bad evidence items on the same requirement are deduplicated to one penalty", () => {
    const r = computeRisk({
      defects: [],
      requirements: [{ id: "r1", isMandatory: true, reviewStatus: "pending" }],
      evidence: [
        { requirementId: "r1", evidenceStatus: "missing", suggested: false },
        { requirementId: "r1", evidenceStatus: "expired", suggested: false },
        { requirementId: "r1", evidenceStatus: "missing", suggested: false },
      ],
    });
    assert.equal(r.score, 5);
  });

  test("evidence pointing at an unknown requirement id is ignored", () => {
    const r = computeRisk({
      defects: [],
      requirements: [{ id: "r1", isMandatory: true, reviewStatus: "pending" }],
      evidence: [{ requirementId: "ghost", evidenceStatus: "missing", suggested: false }],
    });
    assert.equal(r.score, 0);
  });

  test("defect score and evidence penalty combine", () => {
    const r = computeRisk({
      defects: defects([{ severity: "likely_fatal", status: "open" }]), // 25
      requirements: [{ id: "r1", isMandatory: true, reviewStatus: "pending" }],
      evidence: [{ requirementId: "r1", evidenceStatus: "expired", suggested: false }], // +5 => 30
    });
    assert.equal(r.score, 30);
    assert.equal(r.band, "medium");
  });
});

describe("computeExpiry - certificate expiry telemetry", () => {
  const TODAY = "2026-07-05";

  test("no or unparseable expiry date -> unknown", () => {
    assert.deepEqual(computeExpiry(null, TODAY), { band: "unknown", daysToExpiry: null });
    assert.deepEqual(computeExpiry(undefined, TODAY), { band: "unknown", daysToExpiry: null });
    assert.deepEqual(computeExpiry("", TODAY), { band: "unknown", daysToExpiry: null });
    assert.deepEqual(computeExpiry("not-a-date", TODAY), { band: "unknown", daysToExpiry: null });
  });

  test("past dates are expired with negative days", () => {
    assert.deepEqual(computeExpiry("2026-07-04", TODAY), { band: "expired", daysToExpiry: -1 });
    assert.deepEqual(computeExpiry("2026-01-10", TODAY), { band: "expired", daysToExpiry: -176 });
  });

  test("expiring today is critical (day 0), not expired", () => {
    assert.deepEqual(computeExpiry("2026-07-05", TODAY), { band: "critical", daysToExpiry: 0 });
  });

  test("T-3 boundary: 3 days out is critical, 4 is warning", () => {
    assert.equal(computeExpiry("2026-07-08", TODAY).band, "critical");
    assert.equal(computeExpiry("2026-07-09", TODAY).band, "warning");
  });

  test("T-14 boundary: 14 days out is warning, 15 is upcoming", () => {
    assert.equal(computeExpiry("2026-07-19", TODAY).band, "warning");
    assert.equal(computeExpiry("2026-07-20", TODAY).band, "upcoming");
  });

  test("T-30 boundary: 30 days out is upcoming, 31 is ok", () => {
    assert.equal(computeExpiry("2026-08-04", TODAY).band, "upcoming");
    assert.equal(computeExpiry("2026-08-05", TODAY).band, "ok");
  });

  test("a long renewal lead time widens the upcoming window", () => {
    // 45 days out: ok by default, but upcoming for an artefact that takes
    // 60 days to renew.
    const d = "2026-08-19";
    assert.equal(computeExpiry(d, TODAY).band, "ok");
    assert.equal(computeExpiry(d, TODAY, 60).band, "upcoming");
    // Lead time never narrows the window below 30 days.
    assert.equal(computeExpiry("2026-08-04", TODAY, 7).band, "upcoming");
  });

  test("lead time does not change the critical/warning ladder", () => {
    assert.equal(computeExpiry("2026-07-08", TODAY, 90).band, "critical");
    assert.equal(computeExpiry("2026-07-15", TODAY, 90).band, "warning");
  });

  test("accepts a Date object for today and datetime strings for expiry", () => {
    const today = new Date("2026-07-05T09:30:00Z");
    assert.deepEqual(computeExpiry("2026-07-06T23:59:00Z", today), {
      band: "critical",
      daysToExpiry: 1,
    });
  });

  test("deterministic: same inputs, same output", () => {
    const a = computeExpiry("2026-09-01", TODAY, 45);
    const b = computeExpiry("2026-09-01", TODAY, 45);
    assert.deepEqual(a, b);
  });
});

describe("blockingSignOffDefects - fatal-block invariant", () => {
  test("an open fatal defect blocks sign-off", () => {
    const blocking = blockingSignOffDefects([
      { severity: "fatal", status: "open" },
    ]);
    assert.equal(blocking.length, 1);
  });

  test("an open likely-fatal defect blocks sign-off", () => {
    const blocking = blockingSignOffDefects([
      { severity: "likely_fatal", status: "open" },
    ]);
    assert.equal(blocking.length, 1);
  });

  test("open scoring-risk and cosmetic defects never block sign-off", () => {
    const blocking = blockingSignOffDefects([
      { severity: "scoring_risk", status: "open" },
      { severity: "cosmetic", status: "open" },
    ]);
    assert.deepEqual(blocking, []);
  });

  test("resolved fatal defects (remediated/waived) do not block sign-off", () => {
    const blocking = blockingSignOffDefects([
      { severity: "fatal", status: "remediated" },
      { severity: "likely_fatal", status: "waived" },
    ]);
    assert.deepEqual(blocking, []);
  });

  test("an unconfirmed (suggested) fatal defect does not block sign-off", () => {
    // A raw AI suggestion is not a confirmed-live defect; it must be reviewer-
    // confirmed to "open" before it can hold up a sign-off. This mirrors the
    // live-defect semantics computeRisk uses.
    const blocking = blockingSignOffDefects([
      { severity: "fatal", status: "suggested" },
    ]);
    assert.deepEqual(blocking, []);
  });

  test("returns every blocking defect, preserving the caller's row shape", () => {
    const blocking = blockingSignOffDefects([
      { id: "d1", severity: "fatal", status: "open" },
      { id: "d2", severity: "likely_fatal", status: "open" },
      { id: "d3", severity: "cosmetic", status: "open" },
      { id: "d4", severity: "fatal", status: "remediated" },
    ]);
    assert.deepEqual(
      blocking.map((d) => d.id),
      ["d1", "d2"],
    );
  });

  test("what blocks sign-off is exactly what forces critical risk, for the fatal case", () => {
    // Consistency guard: an open fatal defect both blocks sign-off AND forces a
    // critical band, so the two deterministic checks can never disagree.
    const defs = [{ severity: "fatal" as Severity, status: "open" }];
    assert.equal(blockingSignOffDefects(defs).length, 1);
    assert.equal(
      computeRisk({ defects: defs, requirements: [], evidence: [] }).band,
      "critical",
    );
  });
});
