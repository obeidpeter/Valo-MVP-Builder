import {
  deterministicId,
  hasBlockers,
  isValidId,
  reviewIsAccepted,
  sortIssues,
  UNREVIEWED,
  validateCitations,
  validateHumanReview,
  uniqueIds,
  type DomainIssue,
  type ExactCitation,
  type GroundedCitation,
  type HumanReview,
  type SourceDocument,
} from "./domain";
import {
  NEXT_CAPABILITY_MAX_ITEMS,
  boundedNextCapabilityRecordKeys,
  nextCapabilitySafety,
  validateNextCapabilityCollection,
  validateNextCapabilitySources,
  validateNextCapabilityText,
  type NextCapabilitySafetyEnvelope,
} from "./nextCapabilityContracts";

export interface ConfirmedOutcomeInput {
  readonly externalId: string;
  readonly disposition: "won" | "lost" | "withdrawn" | "no_award";
  readonly clientConfirmed: boolean;
  readonly citations: readonly ExactCitation[];
  readonly review: HumanReview;
}

export interface OutcomeDefectInput {
  readonly externalId: string;
  readonly defectCode: string;
  readonly description: string;
  readonly citations: readonly ExactCitation[];
  readonly review: HumanReview;
}

export interface OutcomeLearningInput {
  readonly organisationId: string;
  readonly projectId: string;
  readonly sources: readonly SourceDocument[];
  readonly outcome: ConfirmedOutcomeInput;
  readonly defects: readonly OutcomeDefectInput[];
  readonly minimumRepeatCount?: number;
  readonly lessonReviews?: Readonly<Record<string, HumanReview>>;
}

export interface OutcomeLessonProposal {
  readonly lessonId: string;
  readonly defectCode: string;
  readonly occurrenceCount: number;
  readonly lessonText: string;
  readonly sourceDefectIds: readonly string[];
  readonly citations: readonly GroundedCitation[];
  readonly review: HumanReview;
  readonly reusableInsideTenant: boolean;
  readonly published: false;
}

export interface OutcomeLearningResult {
  readonly scope: {
    readonly organisationId: string;
    readonly projectId: string;
  };
  readonly learningRunId: string;
  readonly status: "blocked" | "review_required" | "ready";
  readonly readyForUse: boolean;
  readonly lessons: readonly OutcomeLessonProposal[];
  readonly issues: readonly DomainIssue[];
  readonly safety: NextCapabilitySafetyEnvelope;
  readonly modelTrainingAuthorized: false;
  readonly crossTenantReuseAuthorized: false;
}

const OUTCOME_DISPOSITIONS = new Set<ConfirmedOutcomeInput["disposition"]>([
  "won",
  "lost",
  "withdrawn",
  "no_award",
]);

function dispositionIsCited(
  disposition: ConfirmedOutcomeInput["disposition"],
  citations: readonly GroundedCitation[],
): boolean {
  const dispositionPattern =
    disposition === "won"
      ? /\b(won|awarded)\b/u
      : disposition === "lost"
        ? /\b(lost|loss|unsuccessful)\b/u
        : disposition === "withdrawn"
          ? /\bwithdrawn\b/u
          : /\bno[ -]award\b/u;
  return citations.some((citation) => {
    const text = citation.quote.toLowerCase();
    const confirmationIndex = text.search(/\bclient\s+confirmed\b/u);
    if (confirmationIndex < 0) return false;
    const assertion = text.slice(confirmationIndex, confirmationIndex + 200);
    return (
      !/\b(not|never|pending|awaiting|unconfirmed|without)\b/u.test(
        assertion,
      ) && dispositionPattern.test(assertion)
    );
  });
}

function defectIsCited(
  defect: OutcomeDefectInput,
  citations: readonly GroundedCitation[],
): boolean {
  const text = citations
    .map((citation) => citation.quote.toLowerCase())
    .join(" ");
  const codeTokens = defect.defectCode
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 1);
  return (
    citations.some((citation) =>
      citation.quote.includes(defect.description.trim()),
    ) &&
    codeTokens.every((token) => {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "u").test(text);
    })
  );
}

/** Proposes tenant-local lessons from confirmed outcomes; no content is used for model training by default. */
export function proposeOutcomeLessons(
  input: OutcomeLearningInput,
): OutcomeLearningResult {
  const { sourceSet, issues: sourceIssues } = validateNextCapabilitySources(
    input.sources,
    "Outcome-learning sources",
  );
  const defectInputs = input.defects.slice(0, NEXT_CAPABILITY_MAX_ITEMS);
  const issues: DomainIssue[] = [
    ...sourceIssues,
    ...validateNextCapabilityCollection(input.defects, "defects", "Defects"),
    ...uniqueIds(defectInputs, "defects"),
    ...validateHumanReview(input.outcome.review, "outcome.review"),
  ];
  if (!isValidId(input.organisationId) || !isValidId(input.projectId)) {
    issues.push({
      code: "invalid_outcome_learning_scope",
      severity: "blocker",
      path: "scope",
      message:
        "Outcome learning requires stable organisation and project scope IDs.",
    });
  }
  if (!isValidId(input.outcome.externalId)) {
    issues.push({
      code: "invalid_outcome_id",
      severity: "blocker",
      path: "outcome.externalId",
      message: "Outcome identity must be a stable domain ID.",
    });
  }
  issues.push(
    ...validateNextCapabilityCollection(
      input.outcome.citations,
      "outcome.citations",
      "Outcome citations",
    ),
  );
  const outcomeCitations = validateCitations(
    input.outcome.citations.slice(0, NEXT_CAPABILITY_MAX_ITEMS),
    sourceSet.byKey,
    "outcome.citations",
  );
  issues.push(...outcomeCitations.issues);
  if (
    !OUTCOME_DISPOSITIONS.has(input.outcome.disposition) ||
    outcomeCitations.citations.some(
      (citation) => citation.sourceAuthority === "unverified",
    ) ||
    !dispositionIsCited(input.outcome.disposition, outcomeCitations.citations)
  ) {
    issues.push({
      code: "outcome_disposition_not_cited",
      severity: "blocker",
      path: "outcome.disposition",
      message:
        "The closed-set outcome disposition must be stated in verified client outcome evidence.",
    });
  }
  if (
    !input.outcome.clientConfirmed ||
    !reviewIsAccepted(input.outcome.review)
  ) {
    issues.push({
      code: "outcome_not_client_confirmed",
      severity: "blocker",
      path: "outcome",
      message: "Lessons require a client-confirmed, named-review outcome.",
    });
  }
  const minimumRepeatCount = input.minimumRepeatCount ?? 2;
  if (
    !Number.isInteger(minimumRepeatCount) ||
    minimumRepeatCount < 1 ||
    minimumRepeatCount > 20
  ) {
    issues.push({
      code: "invalid_lesson_repeat_threshold",
      severity: "blocker",
      path: "minimumRepeatCount",
      message: "The repeat threshold must be an integer between 1 and 20.",
    });
  }

  const verifiedDefects = defectInputs.flatMap((defect, index) => {
    const path = `defects[${index}]`;
    issues.push(
      ...validateNextCapabilityCollection(
        defect.citations,
        `${path}.citations`,
        "Defect citations",
      ),
    );
    const citations = validateCitations(
      defect.citations.slice(0, NEXT_CAPABILITY_MAX_ITEMS),
      sourceSet.byKey,
      `${path}.citations`,
    );
    const local = [
      ...citations.issues,
      ...validateHumanReview(defect.review, `${path}.review`),
      ...validateNextCapabilityText(
        defect.defectCode,
        `${path}.defectCode`,
        "Defect code",
        { maximum: 128 },
      ),
      ...validateNextCapabilityText(
        defect.description,
        `${path}.description`,
        "Defect description",
      ),
    ];
    if (
      citations.citations.some(
        (citation) => citation.sourceAuthority === "unverified",
      ) ||
      !defectIsCited(defect, citations.citations)
    ) {
      local.push({
        code: "outcome_defect_not_cited",
        severity: "blocker" as const,
        path,
        message:
          "The defect code and exact description must be supported by verified outcome evidence.",
      });
    }
    issues.push(...local);
    return local.some((issue) => issue.severity === "blocker") ||
      !reviewIsAccepted(defect.review)
      ? []
      : [{ ...defect, citations: citations.citations }];
  });
  const byCode = new Map<string, typeof verifiedDefects>();
  for (const defect of verifiedDefects) {
    const code = defect.defectCode.trim().toLowerCase();
    byCode.set(code, [...(byCode.get(code) ?? []), defect]);
  }
  const lessons: OutcomeLessonProposal[] = [];
  for (const [defectCode, unsortedDefects] of byCode) {
    const defects = [...unsortedDefects].sort((left, right) =>
      left.externalId.localeCompare(right.externalId),
    );
    if (defects.length < minimumRepeatCount) continue;
    const sourceDefectIds = defects.map((defect) => defect.externalId).sort();
    const citations = [
      ...new Map(
        defects
          .flatMap((defect) => defect.citations)
          .map((citation) => [citation.citationId, citation]),
      ).values(),
    ].sort((left, right) => left.citationId.localeCompare(right.citationId));
    const lessonId = deterministicId("lesson", {
      organisationId: input.organisationId,
      projectId: input.projectId,
      outcomeExternalId: input.outcome.externalId,
      disposition: input.outcome.disposition,
      defectCode,
      sourceDefectIds,
      citationIds: citations.map((citation) => citation.citationId).sort(),
      outcomeCitationIds: outcomeCitations.citations
        .map((citation) => citation.citationId)
        .sort(),
      outcomeReview: input.outcome.review,
      defects: defects.map((defect) => ({
        externalId: defect.externalId,
        description: defect.description,
        review: defect.review,
      })),
    });
    const review = input.lessonReviews?.[lessonId] ?? UNREVIEWED;
    issues.push(...validateHumanReview(review, `lessonReviews.${lessonId}`));
    lessons.push({
      lessonId,
      defectCode,
      occurrenceCount: defects.length,
      lessonText: `Review and strengthen the ${defectCode} control before the next authorised pursuit.`,
      sourceDefectIds,
      citations,
      review,
      reusableInsideTenant: reviewIsAccepted(review),
      published: false,
    });
  }
  lessons.sort((left, right) => left.lessonId.localeCompare(right.lessonId));
  const lessonReviewKeys = boundedNextCapabilityRecordKeys(
    input.lessonReviews,
    "lessonReviews",
    "Lesson reviews",
  );
  issues.push(...lessonReviewKeys.issues);
  for (const lessonId of lessonReviewKeys.keys) {
    if (!lessons.some((lesson) => lesson.lessonId === lessonId)) {
      issues.push({
        code: "orphan_lesson_review",
        severity: "blocker",
        path: `lessonReviews.${lessonId}`,
        message:
          "A lesson review must bind to a proposal generated by this exact run.",
      });
    }
  }
  const learningRunId = deterministicId("learning", {
    organisationId: input.organisationId,
    projectId: input.projectId,
    outcomeExternalId: input.outcome.externalId,
    outcomeCitationIds: outcomeCitations.citations
      .map((citation) => citation.citationId)
      .sort(),
    lessonIds: lessons.map((lesson) => lesson.lessonId),
  });
  const sortedIssues = sortIssues(issues);
  const blocked = hasBlockers(sortedIssues);
  const readyForUse =
    !blocked &&
    lessons.length > 0 &&
    lessons.every((lesson) => reviewIsAccepted(lesson.review));
  return {
    scope: {
      organisationId: input.organisationId,
      projectId: input.projectId,
    },
    learningRunId,
    status: blocked ? "blocked" : readyForUse ? "ready" : "review_required",
    readyForUse,
    lessons: lessons.map((lesson) => ({
      ...lesson,
      reusableInsideTenant: readyForUse && lesson.reusableInsideTenant,
    })),
    issues: sortedIssues,
    safety: nextCapabilitySafety(2),
    modelTrainingAuthorized: false,
    crossTenantReuseAuthorized: false,
  };
}
