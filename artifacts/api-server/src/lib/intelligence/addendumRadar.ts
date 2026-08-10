import {
  deterministicId,
  hasBlockers,
  isValidId,
  resolveSubjectReview,
  reviewIsAccepted,
  sortIssues,
  UNREVIEWED,
  uniqueIds,
  validateCitation,
  validateHumanReview,
  validateSources,
  type DomainIssue,
  type ExactCitation,
  type GroundedCitation,
  type HumanReview,
  type SourceDocument,
  type SubjectReview,
} from "./domain";

export type AddendumFieldCategory =
  | "deadline"
  | "opening"
  | "eligibility"
  | "requirement"
  | "boq"
  | "submission_instruction"
  | "contact"
  | "other";

export interface AddendumFieldInput {
  readonly externalId: string;
  readonly category: AddendumFieldCategory;
  /** The citation range must isolate exactly this value. */
  readonly value: string;
  readonly citation: ExactCitation;
}

export interface AddendumSnapshotInput {
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly fields: readonly AddendumFieldInput[];
}

export interface AddendumTrackedArtifactInput {
  readonly externalId: string;
  readonly label: string;
  readonly dependsOnFieldExternalIds: readonly string[];
}

export interface AddendumRadarInput {
  readonly sources: readonly SourceDocument[];
  readonly baseline: AddendumSnapshotInput;
  readonly revision: AddendumSnapshotInput;
  readonly trackedArtifacts: readonly AddendumTrackedArtifactInput[];
  readonly changeReviews?: Readonly<Record<string, HumanReview>>;
  readonly radarReview?: SubjectReview;
}

export interface AddendumChange {
  readonly changeId: string;
  readonly fieldExternalId: string;
  readonly category: AddendumFieldCategory;
  readonly kind: "added" | "changed" | "removed";
  readonly beforeValue?: string;
  readonly afterValue?: string;
  readonly beforeCitation?: GroundedCitation;
  readonly afterCitation?: GroundedCitation;
  readonly affectedArtifactIds: readonly string[];
  readonly review: HumanReview;
}

export interface AddendumRadarResult {
  readonly radarId: string;
  readonly status: "blocked" | "no_changes" | "review_required" | "ready";
  readonly readyForUse: boolean;
  readonly changes: readonly AddendumChange[];
  readonly review: HumanReview;
  readonly issues: readonly DomainIssue[];
}

function sourceLookup(
  sources: readonly SourceDocument[],
  sourceId: string,
  versionId: string,
): SourceDocument | undefined {
  return sources.find(
    (source) => source.sourceId === sourceId && source.versionId === versionId,
  );
}

interface GroundedField extends AddendumFieldInput {
  readonly citation: GroundedCitation;
}

function validateSnapshot(
  snapshot: AddendumSnapshotInput,
  path: string,
  sourceSet: ReturnType<typeof validateSources>,
  issues: DomainIssue[],
): GroundedField[] {
  issues.push(...uniqueIds(snapshot.fields, `${path}.fields`));
  const grounded: GroundedField[] = [];
  snapshot.fields.forEach((field, index) => {
    const fieldPath = `${path}.fields[${index}]`;
    const result = validateCitation(
      field.citation,
      sourceSet.byKey,
      `${fieldPath}.citation`,
    );
    issues.push(...result.issues);
    if (!field.value.length || field.citation.quote !== field.value) {
      issues.push({
        code: "addendum_field_not_exact",
        severity: "blocker",
        path: `${fieldPath}.value`,
        message:
          "A field value must exactly equal its isolated source quotation.",
      });
    }
    if (
      field.citation.sourceId !== snapshot.sourceId ||
      field.citation.sourceVersionId !== snapshot.sourceVersionId
    ) {
      issues.push({
        code: "addendum_field_wrong_snapshot",
        severity: "blocker",
        path: `${fieldPath}.citation`,
        message: "Every field citation must point to its containing snapshot.",
      });
    }
    if (
      result.citation &&
      field.value.length &&
      field.citation.quote === field.value &&
      isValidId(field.externalId) &&
      field.citation.sourceId === snapshot.sourceId &&
      field.citation.sourceVersionId === snapshot.sourceVersionId
    ) {
      grounded.push({ ...field, citation: result.citation });
    }
  });
  return grounded;
}

/**
 * Compares two fully structured document snapshots. It never guesses a field
 * value or silently applies a detected change to a bid artifact.
 */
export function detectAddendumChanges(
  input: AddendumRadarInput,
): AddendumRadarResult {
  const sourceSet = validateSources(input.sources);
  const issues: DomainIssue[] = [...sourceSet.issues];
  const baselineSource = sourceLookup(
    input.sources,
    input.baseline.sourceId,
    input.baseline.sourceVersionId,
  );
  const revisionSource = sourceLookup(
    input.sources,
    input.revision.sourceId,
    input.revision.sourceVersionId,
  );
  if (!baselineSource || !revisionSource) {
    issues.push({
      code: "addendum_snapshot_source_missing",
      severity: "blocker",
      path: "baseline/revision",
      message: "Both snapshot source versions must be supplied.",
    });
  } else {
    if (baselineSource.authority !== "authoritative") {
      issues.push({
        code: "baseline_not_authoritative",
        severity: "blocker",
        path: "baseline",
        message: "The baseline must come from an authoritative source.",
      });
    }
    if (
      revisionSource.authority !== "authoritative" ||
      revisionSource.kind !== "addendum"
    ) {
      issues.push({
        code: "revision_not_authoritative_addendum",
        severity: "blocker",
        path: "revision",
        message: "A revision must be an authoritative addendum source.",
      });
    }
    if (
      Date.parse(revisionSource.capturedAt) <=
      Date.parse(baselineSource.capturedAt)
    ) {
      issues.push({
        code: "ambiguous_addendum_order",
        severity: "blocker",
        path: "revision",
        message:
          "The addendum capture must be later than the baseline capture.",
      });
    }
  }
  issues.push(...uniqueIds(input.trackedArtifacts, "trackedArtifacts"));
  input.trackedArtifacts.forEach((artifact, index) => {
    if (
      !artifact.label.trim() ||
      artifact.dependsOnFieldExternalIds.length === 0
    ) {
      issues.push({
        code: "invalid_tracked_artifact",
        severity: "blocker",
        path: `trackedArtifacts[${index}]`,
        message:
          "Tracked artifacts require a label and at least one field dependency.",
      });
    }
    if (
      new Set(artifact.dependsOnFieldExternalIds).size !==
      artifact.dependsOnFieldExternalIds.length
    ) {
      issues.push({
        code: "duplicate_artifact_dependency",
        severity: "blocker",
        path: `trackedArtifacts[${index}].dependsOnFieldExternalIds`,
        message: "Artifact dependencies must be unique.",
      });
    }
  });
  const baselineFields = validateSnapshot(
    input.baseline,
    "baseline",
    sourceSet,
    issues,
  );
  const revisionFields = validateSnapshot(
    input.revision,
    "revision",
    sourceSet,
    issues,
  );

  const baselineById = new Map(
    baselineFields.map((field) => [field.externalId, field]),
  );
  const revisionById = new Map(
    revisionFields.map((field) => [field.externalId, field]),
  );
  const fieldIds = [
    ...new Set([...baselineById.keys(), ...revisionById.keys()]),
  ].sort();
  const changes: AddendumChange[] = [];
  if (!hasBlockers(issues)) {
    for (const fieldExternalId of fieldIds) {
      const before = baselineById.get(fieldExternalId);
      const after = revisionById.get(fieldExternalId);
      if (before && after && before.category !== after.category) {
        issues.push({
          code: "addendum_field_category_changed",
          severity: "blocker",
          path: `fields.${fieldExternalId}`,
          message:
            "A stable field cannot change semantic category between snapshots.",
        });
        continue;
      }
      if (before?.value === after?.value) continue;
      const kind: AddendumChange["kind"] = before
        ? after
          ? "changed"
          : "removed"
        : "added";
      const category = before?.category ?? after?.category;
      if (!category) continue;
      const changeId = deterministicId("addchg", {
        fieldExternalId,
        category,
        kind,
        beforeValue: before?.value,
        afterValue: after?.value,
        beforeCitationId: before?.citation.citationId,
        afterCitationId: after?.citation.citationId,
      });
      const review = input.changeReviews?.[changeId] ?? UNREVIEWED;
      issues.push(...validateHumanReview(review, `changeReviews.${changeId}`));
      changes.push({
        changeId,
        fieldExternalId,
        category,
        kind,
        beforeValue: before?.value,
        afterValue: after?.value,
        beforeCitation: before?.citation,
        afterCitation: after?.citation,
        affectedArtifactIds: input.trackedArtifacts
          .filter((artifact) =>
            artifact.dependsOnFieldExternalIds.includes(fieldExternalId),
          )
          .map((artifact) => artifact.externalId)
          .sort(),
        review,
      });
    }
  }
  const generatedChangeIds = new Set(changes.map((change) => change.changeId));
  Object.keys(input.changeReviews ?? {}).forEach((changeId) => {
    if (!generatedChangeIds.has(changeId)) {
      issues.push({
        code: "orphan_change_review",
        severity: "blocker",
        path: `changeReviews.${changeId}`,
        message:
          "A review may only approve a change generated by this exact comparison.",
      });
    }
  });
  changes.sort((left, right) => left.changeId.localeCompare(right.changeId));
  const radarId = deterministicId("addradar", {
    baseline: [input.baseline.sourceId, input.baseline.sourceVersionId],
    revision: [input.revision.sourceId, input.revision.sourceVersionId],
    changes: changes.map((change) => [change.changeId, change.review.state]),
  });
  const radarReviewResult = resolveSubjectReview(
    radarId,
    input.radarReview,
    "radarReview",
  );
  issues.push(...radarReviewResult.issues);
  const radarReview = radarReviewResult.review;
  const sortedIssues = sortIssues(issues);
  const readyForUse =
    !hasBlockers(sortedIssues) &&
    reviewIsAccepted(radarReview) &&
    changes.every((change) => reviewIsAccepted(change.review));
  const status: AddendumRadarResult["status"] = hasBlockers(sortedIssues)
    ? "blocked"
    : changes.length === 0
      ? "no_changes"
      : readyForUse
        ? "ready"
        : "review_required";
  return {
    radarId,
    status,
    readyForUse,
    changes,
    review: radarReview,
    issues: sortedIssues,
  };
}
