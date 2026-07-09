import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeText,
  requirementMatched,
  computeTenderRecall,
  aggregateReport,
  validateCorpus,
  EVAL_RECALL_TARGET_V0,
  type EvalTender,
  type GroundTruthRequirement,
} from "./evalHarness";

const gt = (over: Partial<GroundTruthRequirement>): GroundTruthRequirement => ({
  id: "g1",
  label: "Tax clearance certificate",
  mandatory: true,
  match: [["tax clearance", "tax compliance", "sars"], ["certificate", "pin", "status"]],
  ...over,
});

const tender = (over: Partial<EvalTender>): EvalTender => ({
  id: "t1",
  title: "Test tender",
  documentText: "Some tender text.",
  groundTruth: [gt({})],
  ...over,
});

describe("normalizeText", () => {
  test("lowercases, strips punctuation, collapses whitespace", () => {
    assert.equal(normalizeText("  Tax-Clearance   CERTIFICATE!! "), "tax clearance certificate");
  });
});

describe("requirementMatched - AND-of-ORs", () => {
  test("recalled when one extracted text satisfies every group", () => {
    const norm = ["Bidders must submit a valid Tax Clearance Certificate."].map(normalizeText);
    assert.equal(requirementMatched(gt({}), norm), true);
  });

  test("alternative in a group is enough", () => {
    const norm = ["A valid SARS PIN is required."].map(normalizeText);
    assert.equal(requirementMatched(gt({}), norm), true);
  });

  test("not recalled when a group has no satisfying alternative", () => {
    // Has the certificate group but nothing from the tax group.
    const norm = ["Submit a B-BBEE certificate."].map(normalizeText);
    assert.equal(requirementMatched(gt({}), norm), false);
  });

  test("groups must be satisfied within a SINGLE extracted text, not spread", () => {
    // "tax clearance" in one row, "certificate" in another — must NOT count.
    const norm = ["tax clearance is needed", "attach the certificate"].map(normalizeText);
    assert.equal(requirementMatched(gt({}), norm), false);
  });

  test("empty match spec never matches", () => {
    assert.equal(requirementMatched(gt({ match: [] }), ["anything"].map(normalizeText)), false);
  });
});

describe("computeTenderRecall", () => {
  test("counts matched and lists the missed ground-truth rows", () => {
    const t = tender({
      groundTruth: [
        gt({ id: "g1" }),
        gt({
          id: "g2",
          label: "Bid security",
          match: [["bid security", "bid bond"], ["required", "must", "shall"]],
        }),
      ],
    });
    const r = computeTenderRecall(t, ["Provide a valid Tax Clearance Certificate."]);
    assert.equal(r.total, 2);
    assert.equal(r.matched, 1);
    assert.equal(r.recall, 0.5);
    assert.deepEqual(r.missed.map((m) => m.id), ["g2"]);
  });

  test("empty ground truth yields recall 1", () => {
    const r = computeTenderRecall(tender({ groundTruth: [] }), []);
    assert.equal(r.recall, 1);
  });
});

describe("aggregateReport", () => {
  test("aggregates across tenders and applies the target", () => {
    const perTender = [
      computeTenderRecall(tender({ id: "t1" }), ["Tax Clearance Certificate attached."]),
      computeTenderRecall(
        tender({
          id: "t2",
          groundTruth: [
            gt({ id: "g1" }),
            gt({ id: "g2", label: "Bid security", match: [["bid security", "bid bond"]] }),
          ],
        }),
        ["Tax Clearance Certificate attached."],
      ),
    ];
    const report = aggregateReport(perTender, 0.85);
    assert.equal(report.totalGroundTruth, 3);
    assert.equal(report.totalMatched, 2);
    assert.ok(Math.abs(report.overallRecall - 2 / 3) < 1e-9);
    assert.equal(report.passed, false);
  });

  test("passes at exactly the target boundary", () => {
    const perTender = [computeTenderRecall(tender({}), ["Tax Clearance Certificate."])];
    const report = aggregateReport(perTender, 1);
    assert.equal(report.overallRecall, 1);
    assert.equal(report.passed, true);
  });

  test("default target is the v0 bar", () => {
    const report = aggregateReport([]);
    assert.equal(report.target, EVAL_RECALL_TARGET_V0);
  });

  test("a degraded extraction drops below the v0 target and fails (no silent pass)", () => {
    // Simulate a prompt/model regression: across a 10-tender corpus the engine
    // now surfaces only the tax-clearance obligation and drops the bid-security
    // one — i.e. 1 of 2 mandatory requirements per tender. Overall recall = 50%,
    // well under the 85% v0 bar, so the report MUST report failure.
    const degradedExtraction = ["Tax Clearance Certificate attached."];
    const perTender = Array.from({ length: 10 }, (_, i) =>
      computeTenderRecall(
        tender({
          id: `t${i}`,
          groundTruth: [
            gt({ id: "g1" }),
            gt({ id: "g2", label: "Bid security", mandatory: true, match: [["bid security", "bid bond"]] }),
          ],
        }),
        degradedExtraction,
      ),
    );
    const report = aggregateReport(perTender, EVAL_RECALL_TARGET_V0);
    assert.equal(report.overallRecall, 0.5);
    assert.equal(report.passed, false);
    // Every tender must name the dropped requirement so the failure is actionable.
    assert.ok(report.perTender.every((t) => t.missed.some((m) => m.id === "g2")));
  });
});

describe("validateCorpus", () => {
  test("flags a corpus below the minimum size", () => {
    const problems = validateCorpus([tender({})]);
    assert.ok(problems.some((p) => p.includes("need >=")));
  });

  test("flags duplicate ids, empty specs, and missing mandatory rows", () => {
    const bad: EvalTender[] = [
      tender({ id: "dup", groundTruth: [gt({ mandatory: false })] }),
      tender({ id: "dup", groundTruth: [gt({ id: "x", match: [] })] }),
    ];
    const problems = validateCorpus(bad);
    assert.ok(problems.some((p) => p.includes("duplicate tender id")));
    assert.ok(problems.some((p) => p.includes("no mandatory")));
    assert.ok(problems.some((p) => p.includes("empty match spec")));
  });

  test("a well-formed minimal corpus of >= 10 tenders has no problems", () => {
    const corpus = Array.from({ length: 10 }, (_, i) => tender({ id: `t${i}` }));
    assert.deepEqual(validateCorpus(corpus), []);
  });
});

describe("mandatory recall (FR-EXT-05 gate figure)", () => {
  test("mandatory recall counts only mandatory rows; desirable misses do not gate", () => {
    const t = tender({
      groundTruth: [
        gt({ id: "g1", label: "Tax clearance", mandatory: true, match: [["tax clearance"]] }),
        gt({ id: "g2", label: "Brochures", mandatory: false, match: [["brochure"]] }),
      ],
    });
    // Engine surfaces the mandatory row but not the desirable one.
    const result = computeTenderRecall(t, ["Submit a valid tax clearance certificate"]);
    assert.equal(result.mandatoryTotal, 1);
    assert.equal(result.mandatoryMatched, 1);
    assert.equal(result.mandatoryRecall, 1);
    assert.ok(Math.abs(result.recall - 0.5) < 1e-9);

    const report = aggregateReport([result]);
    assert.equal(report.mandatoryPassed, true);
    assert.equal(report.passed, false); // overall 50% < 85% target
  });

  test("a missed mandatory row fails the mandatory gate", () => {
    const t = tender({
      groundTruth: [
        gt({ id: "g1", label: "Bid security", mandatory: true, match: [["bid security", "bid bond"]] }),
      ],
    });
    const report = aggregateReport([computeTenderRecall(t, ["Unrelated text"])]);
    assert.equal(report.mandatoryRecall, 0);
    assert.equal(report.mandatoryPassed, false);
  });
});
