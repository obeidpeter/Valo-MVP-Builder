import {
  deterministicId,
  hasBlockers,
  isIsoDate,
  isValidId,
  resolveSubjectReview,
  reviewIsAccepted,
  sortIssues,
  uniqueIds,
  validateCitations,
  validateHumanReview,
  type DomainIssue,
  type ExactCitation,
  type GroundedCitation,
  type HumanReview,
  type SourceDocument,
  type SubjectReview,
} from "./domain";
import {
  NEXT_CAPABILITY_MAX_ITEMS,
  nextCapabilitySafety,
  validateNextCapabilityCollection,
  validateNextCapabilitySources,
  validateNextCapabilityText,
  type NextCapabilitySafetyEnvelope,
} from "./nextCapabilityContracts";

export const REGULATORY_CHANGE_KINDS = [
  "new",
  "amendment",
  "replacement",
  "repeal",
] as const;

export type RegulatoryChangeKind = (typeof REGULATORY_CHANGE_KINDS)[number];

export const REGULATORY_TARGET_TYPES = [
  "requirement",
  "evidence_record",
  "draft_section",
  "boq_item",
  "submission_package",
  "workflow_control",
] as const;

export type RegulatoryImpactTargetType =
  (typeof REGULATORY_TARGET_TYPES)[number];

export interface RegulatoryRuleInput {
  readonly externalId: string;
  readonly title: string;
  readonly jurisdiction: string;
  readonly effectiveDate: string;
  readonly changeKind: RegulatoryChangeKind;
  readonly supersedesRuleExternalId?: string;
  readonly citations: readonly ExactCitation[];
  readonly review: HumanReview;
}

export interface RegulatoryImpactAssessmentInput {
  readonly externalId: string;
  readonly ruleExternalId: string;
  readonly targetType: RegulatoryImpactTargetType;
  readonly targetExternalId: string;
  /** A human-authored internal impact hypothesis, not legal advice. */
  readonly assessment: string;
  readonly citations: readonly ExactCitation[];
  readonly review: HumanReview;
}

export interface RegulatoryWatchtowerInput {
  readonly sources: readonly SourceDocument[];
  readonly rules: readonly RegulatoryRuleInput[];
  readonly impacts: readonly RegulatoryImpactAssessmentInput[];
  readonly watchtowerReview?: SubjectReview;
}

export interface RegulatoryRuleRecord extends RegulatoryRuleInput {
  readonly ruleId: string;
  readonly supersedesRuleId?: string;
  readonly supersededByRuleIds: readonly string[];
  readonly citations: readonly GroundedCitation[];
}

export interface RegulatoryImpactAssessmentRecord extends RegulatoryImpactAssessmentInput {
  readonly impactId: string;
  readonly ruleId: string;
  readonly citations: readonly GroundedCitation[];
}

export interface RegulatoryRuleCoverage {
  readonly ruleId: string;
  readonly impactIds: readonly string[];
  readonly state: "missing" | "pending_review" | "reviewed";
}

export interface RegulatoryWatchtowerResult {
  readonly watchtowerId: string;
  readonly status: "blocked" | "incomplete" | "review_required" | "ready";
  readonly readyForInternalPlanningUse: boolean;
  readonly rules: readonly RegulatoryRuleRecord[];
  readonly impacts: readonly RegulatoryImpactAssessmentRecord[];
  readonly coverage: readonly RegulatoryRuleCoverage[];
  readonly review: HumanReview;
  readonly issues: readonly DomainIssue[];
  readonly legalInterpretationProvided: false;
  readonly regulatoryChangeActivated: false;
  readonly externalNotificationAuthorized: false;
  readonly safety: NextCapabilitySafetyEnvelope;
}

function citationText(citations: readonly GroundedCitation[]): string {
  return citations.map((citation) => citation.quote).join("\n");
}

function citationSupportsChangeKind(
  citations: readonly GroundedCitation[],
  changeKind: RegulatoryChangeKind,
): boolean {
  const declaration = `change kind: ${changeKind}`;
  return citations.some((citation) =>
    citation.quote.normalize("NFKC").toLowerCase().includes(declaration),
  );
}

function isAuthoritativeOfficialRule(
  citations: readonly GroundedCitation[],
): boolean {
  return (
    citations.length > 0 &&
    citations.every(
      (citation) =>
        citation.sourceAuthority === "authoritative" &&
        citation.sourceKind === "other",
    )
  );
}

function hasSupersessionCycle(
  rules: readonly {
    readonly externalId: string;
    readonly supersedesRuleExternalId?: string;
  }[],
): boolean {
  const predecessorByRule = new Map(
    rules.map((rule) => [rule.externalId, rule.supersedesRuleExternalId]),
  );
  for (const rule of rules) {
    const seen = new Set<string>();
    let cursor: string | undefined = rule.externalId;
    while (cursor) {
      if (seen.has(cursor)) return true;
      seen.add(cursor);
      cursor = predecessorByRule.get(cursor);
    }
  }
  return false;
}

/**
 * Builds a reviewed internal change register from declared-authoritative,
 * hash-bound rule publications. It does not interpret law, activate a rule,
 * notify a third party, or mutate any authoritative business record.
 */
export function buildRegulatoryWatchtower(
  input: RegulatoryWatchtowerInput,
): RegulatoryWatchtowerResult {
  const sourceValidation = validateNextCapabilitySources(
    input.sources,
    "Regulatory source documents",
  );
  const sourceSet = sourceValidation.sourceSet;
  const issues: DomainIssue[] = [...sourceValidation.issues];
  issues.push(
    ...validateNextCapabilityCollection(
      input.rules,
      "rules",
      "Regulatory rules",
    ),
    ...validateNextCapabilityCollection(
      input.impacts,
      "impacts",
      "Regulatory impact assessments",
    ),
  );
  const ruleInputs = input.rules.slice(0, NEXT_CAPABILITY_MAX_ITEMS);
  const impactInputs = input.impacts.slice(0, NEXT_CAPABILITY_MAX_ITEMS);
  issues.push(
    ...uniqueIds(ruleInputs, "rules"),
    ...uniqueIds(impactInputs, "impacts"),
  );

  type RuleCandidate = Omit<
    RegulatoryRuleRecord,
    "supersedesRuleId" | "supersededByRuleIds"
  >;
  const candidates: RuleCandidate[] = [];
  ruleInputs.forEach((rule, index) => {
    const path = `rules[${index}]`;
    issues.push(
      ...validateNextCapabilityCollection(
        rule.citations,
        `${path}.citations`,
        "Rule citations",
      ),
    );
    const local = validateCitations(
      rule.citations.slice(0, NEXT_CAPABILITY_MAX_ITEMS),
      sourceSet.byKey,
      `${path}.citations`,
    );
    const textIssues = [
      ...validateNextCapabilityText(rule.title, `${path}.title`, "Rule title"),
      ...validateNextCapabilityText(
        rule.jurisdiction,
        `${path}.jurisdiction`,
        "Rule jurisdiction",
      ),
    ];
    issues.push(
      ...local.issues,
      ...textIssues,
      ...validateHumanReview(rule.review, `${path}.review`),
    );
    if (!isIsoDate(rule.effectiveDate)) {
      issues.push({
        code: "invalid_rule_effective_date",
        severity: "blocker",
        path: `${path}.effectiveDate`,
        message: "A rule effective date must be an ISO calendar date.",
      });
    }
    if (!REGULATORY_CHANGE_KINDS.includes(rule.changeKind)) {
      issues.push({
        code: "invalid_regulatory_change_kind",
        severity: "blocker",
        path: `${path}.changeKind`,
        message: "A rule change kind must use the closed regulatory set.",
      });
    }
    const shouldLink = rule.changeKind !== "new";
    if (
      (shouldLink && !rule.supersedesRuleExternalId) ||
      (!shouldLink && rule.supersedesRuleExternalId !== undefined)
    ) {
      issues.push({
        code: "invalid_rule_change_linkage",
        severity: "blocker",
        path: `${path}.supersedesRuleExternalId`,
        message:
          "Amendments, replacements, and repeals require one predecessor; a new rule may not declare one.",
      });
    }
    if (
      local.citations.length &&
      !isAuthoritativeOfficialRule(local.citations)
    ) {
      issues.push({
        code: "rule_source_not_authoritative_official",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "Regulatory facts require an authoritative official-rule source classified as other.",
      });
    }
    const ruleFactsCited = local.citations.some(
      (citation) =>
        citation.quote.includes(rule.title) &&
        citation.quote.includes(rule.jurisdiction) &&
        citation.quote.includes(rule.effectiveDate) &&
        citationSupportsChangeKind([citation], rule.changeKind),
    );
    if (local.citations.length > 0 && !ruleFactsCited) {
      issues.push({
        code: "rule_facts_not_cited",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "The cited official text must contain the supplied rule title, jurisdiction, effective date, and change-kind language.",
      });
    }
    if (
      isValidId(rule.externalId) &&
      textIssues.length === 0 &&
      isIsoDate(rule.effectiveDate) &&
      REGULATORY_CHANGE_KINDS.includes(rule.changeKind) &&
      ((shouldLink && Boolean(rule.supersedesRuleExternalId)) ||
        (!shouldLink && rule.supersedesRuleExternalId === undefined)) &&
      local.issues.length === 0 &&
      isAuthoritativeOfficialRule(local.citations) &&
      ruleFactsCited
    ) {
      candidates.push({
        ...rule,
        ruleId: deterministicId("regrule", {
          externalId: rule.externalId,
          title: rule.title,
          jurisdiction: rule.jurisdiction,
          effectiveDate: rule.effectiveDate,
          changeKind: rule.changeKind,
          supersedesRuleExternalId: rule.supersedesRuleExternalId,
          citations: local.citations,
        }),
        citations: local.citations,
      });
    }
  });
  candidates.sort((left, right) => left.ruleId.localeCompare(right.ruleId));
  const candidateByExternalId = new Map(
    candidates.map((rule) => [rule.externalId, rule]),
  );

  const successorCount = new Map<string, number>();
  candidates.forEach((rule) => {
    if (!rule.supersedesRuleExternalId) return;
    const predecessor = candidateByExternalId.get(
      rule.supersedesRuleExternalId,
    );
    if (!predecessor || predecessor.externalId === rule.externalId) {
      issues.push({
        code: "rule_predecessor_missing",
        severity: "blocker",
        path: `rules.${rule.externalId}.supersedesRuleExternalId`,
        message:
          "A supersession link must reference another supplied valid rule.",
      });
      return;
    }
    if (rule.effectiveDate < predecessor.effectiveDate) {
      issues.push({
        code: "rule_supersession_date_invalid",
        severity: "blocker",
        path: `rules.${rule.externalId}.effectiveDate`,
        message: "A successor rule may not take effect before its predecessor.",
      });
    }
    if (!citationText(rule.citations).includes(predecessor.title)) {
      issues.push({
        code: "rule_supersession_not_cited",
        severity: "blocker",
        path: `rules.${rule.externalId}.citations`,
        message:
          "The successor citation must identify the predecessor rule title.",
      });
    }
    successorCount.set(
      predecessor.externalId,
      (successorCount.get(predecessor.externalId) ?? 0) + 1,
    );
  });
  successorCount.forEach((count, predecessorExternalId) => {
    if (count > 1) {
      issues.push({
        code: "ambiguous_rule_supersession",
        severity: "blocker",
        path: `rules.${predecessorExternalId}`,
        message:
          "A predecessor has multiple successors and requires explicit reconciliation.",
      });
    }
  });
  if (hasSupersessionCycle(candidates)) {
    issues.push({
      code: "cyclic_rule_supersession",
      severity: "blocker",
      path: "rules",
      message: "Regulatory supersession links may not form a cycle.",
    });
  }

  const rules: RegulatoryRuleRecord[] = candidates.map((rule) => {
    const predecessor = rule.supersedesRuleExternalId
      ? candidateByExternalId.get(rule.supersedesRuleExternalId)
      : undefined;
    return {
      ...rule,
      supersedesRuleId: predecessor?.ruleId,
      supersededByRuleIds: candidates
        .filter(
          (candidate) => candidate.supersedesRuleExternalId === rule.externalId,
        )
        .map((candidate) => candidate.ruleId)
        .sort(),
    };
  });

  const impacts: RegulatoryImpactAssessmentRecord[] = [];
  impactInputs.forEach((impact, index) => {
    const path = `impacts[${index}]`;
    const rule = candidateByExternalId.get(impact.ruleExternalId);
    issues.push(
      ...validateNextCapabilityCollection(
        impact.citations,
        `${path}.citations`,
        "Impact citations",
      ),
    );
    const local = validateCitations(
      impact.citations.slice(0, NEXT_CAPABILITY_MAX_ITEMS),
      sourceSet.byKey,
      `${path}.citations`,
    );
    const textIssues = validateNextCapabilityText(
      impact.assessment,
      `${path}.assessment`,
      "Internal impact assessment",
    );
    issues.push(
      ...local.issues,
      ...textIssues,
      ...validateHumanReview(impact.review, `${path}.review`),
    );
    if (!rule) {
      issues.push({
        code: "impact_rule_reference_missing",
        severity: "blocker",
        path: `${path}.ruleExternalId`,
        message: "Every impact must reference a supplied valid rule.",
      });
    }
    if (!REGULATORY_TARGET_TYPES.includes(impact.targetType)) {
      issues.push({
        code: "invalid_regulatory_target_type",
        severity: "blocker",
        path: `${path}.targetType`,
        message: "An impact target must use the closed internal target set.",
      });
    }
    if (!isValidId(impact.targetExternalId)) {
      issues.push({
        code: "invalid_impact_target_id",
        severity: "blocker",
        path: `${path}.targetExternalId`,
        message: "An impact target requires a stable internal domain ID.",
      });
    }
    const ruleCitationIds = new Set(
      rule?.citations.map((citation) => citation.citationId) ?? [],
    );
    const anchoredToRule =
      local.citations.length > 0 &&
      local.citations.every(
        (citation) =>
          isAuthoritativeOfficialRule([citation]) &&
          ruleCitationIds.has(citation.citationId),
      );
    if (local.citations.length && !anchoredToRule) {
      issues.push({
        code: "impact_source_not_rule_bound",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "An impact assessment must reuse an exact authoritative citation range from its specific rule.",
      });
    }
    if (
      rule &&
      isValidId(impact.externalId) &&
      isValidId(impact.targetExternalId) &&
      REGULATORY_TARGET_TYPES.includes(impact.targetType) &&
      textIssues.length === 0 &&
      local.issues.length === 0 &&
      anchoredToRule
    ) {
      impacts.push({
        ...impact,
        impactId: deterministicId("regimpact", {
          externalId: impact.externalId,
          ruleId: rule.ruleId,
          targetType: impact.targetType,
          targetExternalId: impact.targetExternalId,
          assessment: impact.assessment,
          citations: local.citations,
        }),
        ruleId: rule.ruleId,
        citations: local.citations,
      });
    }
  });
  impacts.sort((left, right) => left.impactId.localeCompare(right.impactId));

  const duplicateTargets = new Set<string>();
  const seenTargets = new Set<string>();
  impacts.forEach((impact) => {
    const key = `${impact.ruleId}\u0000${impact.targetType}\u0000${impact.targetExternalId}`;
    if (seenTargets.has(key)) duplicateTargets.add(key);
    seenTargets.add(key);
  });
  if (duplicateTargets.size > 0) {
    issues.push({
      code: "duplicate_regulatory_impact_target",
      severity: "blocker",
      path: "impacts",
      message:
        "A rule may have only one reviewed assessment for each internal target.",
    });
  }

  const coverage: RegulatoryRuleCoverage[] = rules.map((rule) => {
    const ruleImpacts = impacts.filter(
      (impact) => impact.ruleId === rule.ruleId,
    );
    return {
      ruleId: rule.ruleId,
      impactIds: ruleImpacts.map((impact) => impact.impactId).sort(),
      state:
        ruleImpacts.length === 0
          ? "missing"
          : reviewIsAccepted(rule.review) &&
              ruleImpacts.every((impact) => reviewIsAccepted(impact.review))
            ? "reviewed"
            : "pending_review",
    };
  });
  coverage.sort((left, right) => left.ruleId.localeCompare(right.ruleId));

  const watchtowerId = deterministicId("regwatch", {
    rules: rules.map((rule) => [rule.ruleId, rule.review]),
    impacts: impacts.map((impact) => [impact.impactId, impact.review]),
    coverage,
  });
  const watchtowerReviewResult = resolveSubjectReview(
    watchtowerId,
    input.watchtowerReview,
    "watchtowerReview",
  );
  issues.push(...watchtowerReviewResult.issues);
  const sortedIssues = sortIssues(issues);
  const complete =
    rules.length > 0 &&
    coverage.length === rules.length &&
    coverage.every((entry) => entry.state !== "missing");
  const readyForInternalPlanningUse =
    !hasBlockers(sortedIssues) &&
    complete &&
    coverage.every((entry) => entry.state === "reviewed") &&
    reviewIsAccepted(watchtowerReviewResult.review);
  const status: RegulatoryWatchtowerResult["status"] = hasBlockers(sortedIssues)
    ? "blocked"
    : !complete
      ? "incomplete"
      : readyForInternalPlanningUse
        ? "ready"
        : "review_required";
  return {
    watchtowerId,
    status,
    readyForInternalPlanningUse,
    rules,
    impacts,
    coverage,
    review: watchtowerReviewResult.review,
    issues: sortedIssues,
    legalInterpretationProvided: false,
    regulatoryChangeActivated: false,
    externalNotificationAuthorized: false,
    safety: nextCapabilitySafety(),
  };
}
