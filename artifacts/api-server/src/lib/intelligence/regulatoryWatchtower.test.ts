import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256Text, type HumanReview, type SourceDocument } from "./domain";
import {
  buildRegulatoryWatchtower,
  type RegulatoryWatchtowerInput,
} from "./regulatoryWatchtower";

const ACCEPTED: HumanReview = {
  state: "accepted",
  reviewerId: "regulatory-reviewer",
  reviewedAt: "2026-08-10T12:00:00.000Z",
};

function source(
  sourceId: string,
  content: string,
  kind: SourceDocument["kind"] = "other",
  authority: SourceDocument["authority"] = "authoritative",
): SourceDocument {
  return {
    sourceId,
    versionId: "v1",
    kind,
    title: `${sourceId}.pdf`,
    content,
    contentSha256: sha256Text(content),
    capturedAt: "2026-08-10T09:00:00.000Z",
    authority,
    origin: "https://official.example.test/rules",
  };
}

function citation(item: SourceDocument) {
  return {
    sourceId: item.sourceId,
    sourceVersionId: item.versionId,
    contentSha256: item.contentSha256,
    startOffset: 0,
    endOffset: item.content.length,
    quote: item.content,
  };
}

function fixture(): RegulatoryWatchtowerInput {
  const predecessor = source(
    "official-rule-2024",
    "Public Procurement Rule 2024 for Nigeria is effective 2024-01-01. Change kind: new. It governs evidence retention.",
  );
  const successor = source(
    "official-rule-2026",
    "Public Procurement Rule 2026 for Nigeria is effective 2026-09-01 and replaces Public Procurement Rule 2024. Change kind: replacement. It updates evidence retention.",
  );
  return {
    sources: [predecessor, successor],
    rules: [
      {
        externalId: "rule-2024",
        title: "Public Procurement Rule 2024",
        jurisdiction: "Nigeria",
        effectiveDate: "2024-01-01",
        changeKind: "new",
        citations: [citation(predecessor)],
        review: ACCEPTED,
      },
      {
        externalId: "rule-2026",
        title: "Public Procurement Rule 2026",
        jurisdiction: "Nigeria",
        effectiveDate: "2026-09-01",
        changeKind: "replacement",
        supersedesRuleExternalId: "rule-2024",
        citations: [citation(successor)],
        review: ACCEPTED,
      },
    ],
    impacts: [
      {
        externalId: "impact-2024-retention",
        ruleExternalId: "rule-2024",
        targetType: "evidence_record",
        targetExternalId: "evidence-retention-control",
        assessment:
          "Review the retained evidence record against the cited predecessor publication.",
        citations: [citation(predecessor)],
        review: ACCEPTED,
      },
      {
        externalId: "impact-2026-retention",
        ruleExternalId: "rule-2026",
        targetType: "workflow_control",
        targetExternalId: "retention-review-workflow",
        assessment:
          "Review the internal retention workflow against the cited replacement publication.",
        citations: [citation(successor)],
        review: ACCEPTED,
      },
    ],
  };
}

test("builds reviewed, linked rule impacts but requires exact watchtower acceptance", () => {
  const input = fixture();
  const proposed = buildRegulatoryWatchtower(input);
  assert.equal(proposed.status, "review_required");
  assert.equal(proposed.readyForInternalPlanningUse, false);
  assert.equal(proposed.coverage.length, 2);
  assert.ok(proposed.coverage.every((entry) => entry.state === "reviewed"));
  const successor = proposed.rules.find(
    (rule) => rule.externalId === "rule-2026",
  );
  const predecessor = proposed.rules.find(
    (rule) => rule.externalId === "rule-2024",
  );
  assert.equal(successor?.supersedesRuleId, predecessor?.ruleId);
  assert.deepEqual(predecessor?.supersededByRuleIds, [successor?.ruleId]);

  const accepted = buildRegulatoryWatchtower({
    ...input,
    watchtowerReview: { subjectId: proposed.watchtowerId, review: ACCEPTED },
  });
  assert.equal(accepted.status, "ready");
  assert.equal(accepted.readyForInternalPlanningUse, true);
  assert.equal(accepted.legalInterpretationProvided, false);
  assert.equal(accepted.regulatoryChangeActivated, false);
  assert.equal(accepted.externalNotificationAuthorized, false);
  assert.equal(accepted.safety.externalAction, "none");
  assert.equal(accepted.safety.legalDecisionAuthorized, false);
});

test("keeps missing and pending impact work fail-closed", () => {
  const input = fixture();
  const missing = buildRegulatoryWatchtower({
    ...input,
    impacts: [input.impacts[0]!],
  });
  assert.equal(missing.status, "incomplete");
  assert.equal(missing.readyForInternalPlanningUse, false);
  assert.ok(missing.coverage.some((entry) => entry.state === "missing"));

  const pending = buildRegulatoryWatchtower({
    ...input,
    impacts: [
      input.impacts[0]!,
      { ...input.impacts[1]!, review: { state: "unreviewed" } },
    ],
  });
  assert.equal(pending.status, "review_required");
  assert.equal(pending.readyForInternalPlanningUse, false);
  assert.ok(pending.coverage.some((entry) => entry.state === "pending_review"));
});

test("rejects non-official rule sources and inexact citations", () => {
  const input = fixture();
  const official = input.sources[1]!;
  const wrongKind: SourceDocument = { ...official, kind: "solicitation" };
  const invalidSource = buildRegulatoryWatchtower({
    ...input,
    sources: [input.sources[0]!, wrongKind],
  });
  assert.equal(invalidSource.status, "blocked");
  assert.ok(
    invalidSource.issues.some(
      (issue) => issue.code === "rule_source_not_authoritative_official",
    ),
  );

  const invalidCitation = buildRegulatoryWatchtower({
    ...input,
    impacts: [
      input.impacts[0]!,
      {
        ...input.impacts[1]!,
        citations: [
          {
            ...input.impacts[1]!.citations[0]!,
            contentSha256: "0".repeat(64),
          },
        ],
      },
    ],
  });
  assert.equal(invalidCitation.status, "blocked");
  assert.ok(
    invalidCitation.issues.some(
      (issue) => issue.code === "citation_hash_mismatch",
    ),
  );
});

test("rejects a declared change kind absent from the exact rule citation", () => {
  const input = fixture();
  const result = buildRegulatoryWatchtower({
    ...input,
    rules: [input.rules[0]!, { ...input.rules[1]!, changeKind: "repeal" }],
  });
  assert.equal(result.status, "blocked");
  assert.ok(
    result.issues.some((issue) => issue.code === "rule_facts_not_cited"),
  );
});

test("does not infer repeal from a negated mention in the rule text", () => {
  const input = fixture();
  const successor = source(
    "official-rule-not-repealed",
    "Public Procurement Rule 2026 for Nigeria is effective 2026-09-01 and replaces Public Procurement Rule 2024. Change kind: replacement. This rule is not repealed.",
  );
  const result = buildRegulatoryWatchtower({
    ...input,
    sources: [input.sources[0]!, successor],
    rules: [
      input.rules[0]!,
      {
        ...input.rules[1]!,
        changeKind: "repeal",
        citations: [citation(successor)],
      },
    ],
    impacts: [
      input.impacts[0]!,
      { ...input.impacts[1]!, citations: [citation(successor)] },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(
    result.rules.some((rule) => rule.externalId === "rule-2026"),
    false,
  );
  assert.ok(
    result.issues.some((issue) => issue.code === "rule_facts_not_cited"),
  );
});

test("watchtower identity and output order are deterministic", () => {
  const input = fixture();
  const baseline = buildRegulatoryWatchtower(input);
  const reordered = buildRegulatoryWatchtower({
    ...input,
    sources: [...input.sources].reverse(),
    rules: [...input.rules].reverse(),
    impacts: [...input.impacts].reverse(),
  });
  assert.equal(reordered.watchtowerId, baseline.watchtowerId);
  assert.deepEqual(reordered.rules, baseline.rules);
  assert.deepEqual(reordered.impacts, baseline.impacts);
  assert.deepEqual(reordered.coverage, baseline.coverage);
});

test("a watchtower review does not transfer after an assessment changes", () => {
  const input = fixture();
  const baseline = buildRegulatoryWatchtower(input);
  const changed = buildRegulatoryWatchtower({
    ...input,
    impacts: [
      input.impacts[0]!,
      {
        ...input.impacts[1]!,
        assessment:
          "Escalate the cited replacement publication for a fresh internal workflow review.",
      },
    ],
    watchtowerReview: {
      subjectId: baseline.watchtowerId,
      review: ACCEPTED,
    },
  });
  assert.notEqual(changed.watchtowerId, baseline.watchtowerId);
  assert.equal(changed.status, "blocked");
  assert.equal(changed.readyForInternalPlanningUse, false);
  assert.ok(
    changed.issues.some((issue) => issue.code === "review_subject_mismatch"),
  );
});

test("a watchtower review does not transfer between named item reviewers", () => {
  const input = fixture();
  const baseline = buildRegulatoryWatchtower(input);
  const changed = buildRegulatoryWatchtower({
    ...input,
    impacts: [
      input.impacts[0]!,
      {
        ...input.impacts[1]!,
        review: { ...ACCEPTED, reviewerId: "replacement-reg-reviewer" },
      },
    ],
    watchtowerReview: {
      subjectId: baseline.watchtowerId,
      review: ACCEPTED,
    },
  });
  assert.notEqual(changed.watchtowerId, baseline.watchtowerId);
  assert.equal(changed.status, "blocked");
  assert.ok(
    changed.issues.some((issue) => issue.code === "review_subject_mismatch"),
  );
});
