import { Buffer } from "node:buffer";
import {
  ADDENDUM_REOPEN_CONFIRMATION,
  authoriseControlledAddendumReopening,
  buildAddendumImpactAssessment,
  type AddendumImpactAssessment,
  type AddendumImpactInput,
} from "./addendumImpact";
import {
  ADDENDUM_IMPACT_AUTHORITY_NOTE,
  ADDENDUM_IMPACT_BOUNDS,
  ADDENDUM_IMPACT_POLICY_VERSION,
  type AddendumImpactRepository,
  type AddendumImpactRepositorySnapshot,
  type AddendumImpactReviewDecision,
  type AddendumImpactScope,
  type AddendumImpactSelection,
  type StoredAddendumImpactReview,
} from "./addendumImpactContracts";
import { isValidId, type HumanReview } from "./domain";

export type AddendumImpactServiceErrorCode =
  | "invalid_request"
  | "not_found"
  | "source_bound_exceeded"
  | "comparison_blocked"
  | "review_required"
  | "stale_version"
  | "conflict";

export class AddendumImpactServiceError extends Error {
  constructor(
    readonly code: AddendumImpactServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AddendumImpactServiceError";
  }
}

export interface AddendumImpactReviewCommand {
  readonly baselineVersionId: string;
  readonly revisionVersionId: string;
  readonly assessmentId: string;
  readonly radarId: string;
  readonly expectedImpactManifestSha256: string;
  readonly expectedAssessmentVersion: number;
  readonly decision: AddendumImpactReviewDecision;
  readonly reason: string;
}

export interface AddendumImpactApplyCommand {
  readonly baselineVersionId: string;
  readonly revisionVersionId: string;
  readonly assessmentId: string;
  readonly radarId: string;
  readonly expectedImpactManifestSha256: string;
  readonly expectedAssessmentVersion: number;
  readonly reason: string;
  readonly confirmation: string;
}

export interface PublicAddendumCitation {
  readonly citationId: string;
  readonly sourceVersionId: string;
  readonly sourceTitle: string;
  readonly contentSha256: string;
  readonly quote: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly page: number | null;
  readonly section: string | null;
}

export interface PublicAddendumImpactCentre {
  readonly policyVersion: string;
  readonly authorityNote: string;
  readonly project: { readonly id: string; readonly title: string };
  readonly baseline: AddendumImpactRepositorySnapshot["baseline"];
  readonly revision: AddendumImpactRepositorySnapshot["revision"];
  readonly assessment: {
    readonly id: string;
    readonly version: number;
    readonly radarId: string;
    readonly sourceManifestSha256: string;
    readonly impactManifestSha256: string;
    readonly status: AddendumImpactAssessment["status"];
    readonly readyForReopening: boolean;
    readonly changes: readonly {
      readonly id: string;
      readonly fieldExternalId: string;
      readonly category: string;
      readonly kind: "added" | "changed" | "removed";
      readonly beforeValue: string | null;
      readonly afterValue: string | null;
      readonly beforeCitation: PublicAddendumCitation | null;
      readonly afterCitation: PublicAddendumCitation | null;
      readonly reviewState: HumanReview["state"];
    }[];
    readonly impacts: AddendumImpactAssessment["impacts"];
    readonly issues: readonly {
      readonly code: string;
      readonly severity: "blocker" | "warning";
      readonly message: string;
    }[];
  };
  readonly review: StoredAddendumImpactReview | null;
  readonly reviewStale: boolean;
  readonly application: AddendumImpactRepositorySnapshot["application"];
  readonly requiredConfirmation: typeof ADDENDUM_REOPEN_CONFIRMATION;
}

function validSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

function assertScope(scope: AddendumImpactScope): void {
  if (
    !isValidId(scope.organisationId) ||
    !isValidId(scope.actorUserId) ||
    !["membership", "partner"].includes(scope.source) ||
    (scope.source === "membership" && !isValidId(scope.membershipId ?? "")) ||
    (scope.source === "partner" && scope.membershipId !== null) ||
    scope.actorName.trim().length < 2 ||
    scope.actorName.trim().length > ADDENDUM_IMPACT_BOUNDS.reviewerNameCodeUnits
  ) {
    throw new AddendumImpactServiceError(
      "invalid_request",
      "A current named organisation member is required.",
    );
  }
}

function assertDirectMutationScope(scope: AddendumImpactScope): void {
  if (scope.source !== "membership" || !isValidId(scope.membershipId ?? "")) {
    throw new AddendumImpactServiceError(
      "invalid_request",
      "A current direct organisation membership is required.",
    );
  }
}

function assertProjectAndSelection(
  projectId: string,
  selection: AddendumImpactSelection,
): void {
  if (
    !isValidId(projectId) ||
    (selection.baselineVersionId !== undefined &&
      !isValidId(selection.baselineVersionId)) ||
    (selection.revisionVersionId !== undefined &&
      !isValidId(selection.revisionVersionId))
  ) {
    throw new AddendumImpactServiceError(
      "invalid_request",
      "The project or source-version selection is invalid.",
    );
  }
}

function withoutReview(input: AddendumImpactInput): AddendumImpactInput {
  return {
    sources: input.sources,
    baseline: input.baseline,
    revision: input.revision,
    targets: input.targets,
  };
}

function assertBoundedComparison(input: AddendumImpactInput): void {
  const tooLarge =
    input.sources.length < 2 ||
    input.sources.length > ADDENDUM_IMPACT_BOUNDS.sources ||
    input.baseline.fields.length > ADDENDUM_IMPACT_BOUNDS.fieldsPerVersion ||
    input.revision.fields.length > ADDENDUM_IMPACT_BOUNDS.fieldsPerVersion ||
    (input.baseline.removals?.length ?? 0) >
      ADDENDUM_IMPACT_BOUNDS.fieldsPerVersion ||
    (input.revision.removals?.length ?? 0) >
      ADDENDUM_IMPACT_BOUNDS.fieldsPerVersion ||
    input.targets.length > ADDENDUM_IMPACT_BOUNDS.targets ||
    input.sources.some(
      ({ content }) =>
        content.length > ADDENDUM_IMPACT_BOUNDS.sourceCodeUnitsPerVersion ||
        Buffer.byteLength(content, "utf8") >
          ADDENDUM_IMPACT_BOUNDS.sourceBytesPerVersion,
    );
  if (tooLarge) {
    throw new AddendumImpactServiceError(
      "source_bound_exceeded",
      "The addendum comparison exceeds its bounded review set.",
    );
  }
}

function reviewState(
  decision: AddendumImpactReviewDecision,
): HumanReview["state"] {
  if (decision === "changes_requested") return "needs_changes";
  return decision;
}

function withStoredReview(
  input: AddendumImpactInput,
  stored: StoredAddendumImpactReview,
): AddendumImpactInput {
  const proposed = buildAddendumImpactAssessment(withoutReview(input));
  const review: HumanReview = {
    state: reviewState(stored.decision),
    reviewerId: stored.reviewerUserId,
    reviewedAt: stored.reviewedAt,
    note: stored.reason,
  };
  const changeReviews = Object.fromEntries(
    proposed.radar.changes.map(({ changeId }) => [changeId, review]),
  );
  const changesReviewed = buildAddendumImpactAssessment({
    ...withoutReview(input),
    changeReviews,
  });
  return {
    ...withoutReview(input),
    changeReviews,
    radarReview: {
      subjectId: changesReviewed.radarId,
      review,
    },
  };
}

function resolveAssessment(snapshot: AddendumImpactRepositorySnapshot): {
  raw: AddendumImpactAssessment;
  assessment: AddendumImpactAssessment;
  review: StoredAddendumImpactReview | null;
  reviewStale: boolean;
} {
  const rawInput = withoutReview(snapshot.comparison);
  assertBoundedComparison(rawInput);
  const raw = buildAddendumImpactAssessment(rawInput);
  const stored = snapshot.review;
  const reviewStale = Boolean(
    stored &&
    (stored.assessmentId !== raw.assessmentId ||
      stored.impactManifestSha256 !== raw.impactManifestSha256),
  );
  if (!stored || reviewStale) {
    return { raw, assessment: raw, review: stored, reviewStale };
  }
  return {
    raw,
    assessment: buildAddendumImpactAssessment(
      withStoredReview(rawInput, stored),
    ),
    review: stored,
    reviewStale: false,
  };
}

function publicCitation(
  citation: NonNullable<
    AddendumImpactAssessment["radar"]["changes"][number]["beforeCitation"]
  >,
): PublicAddendumCitation {
  return {
    citationId: citation.citationId,
    sourceVersionId: citation.sourceVersionId,
    sourceTitle: citation.sourceTitle,
    contentSha256: citation.contentSha256,
    quote: citation.quote,
    startOffset: citation.startOffset,
    endOffset: citation.endOffset,
    page: citation.page ?? null,
    section: citation.section ?? null,
  };
}

function publicCentre(
  snapshot: AddendumImpactRepositorySnapshot,
  resolved: ReturnType<typeof resolveAssessment>,
): PublicAddendumImpactCentre {
  const { assessment } = resolved;
  return {
    policyVersion: ADDENDUM_IMPACT_POLICY_VERSION,
    authorityNote: ADDENDUM_IMPACT_AUTHORITY_NOTE,
    project: { id: snapshot.projectId, title: snapshot.projectTitle },
    baseline: snapshot.baseline,
    revision: snapshot.revision,
    assessment: {
      id: resolved.raw.assessmentId,
      version: snapshot.assessmentVersion,
      radarId: assessment.radarId,
      sourceManifestSha256: assessment.sourceManifestSha256,
      impactManifestSha256: assessment.impactManifestSha256,
      status: assessment.status,
      readyForReopening: assessment.readyForReopening,
      changes: assessment.radar.changes.map((change) => ({
        id: change.changeId,
        fieldExternalId: change.fieldExternalId,
        category: change.category,
        kind: change.kind,
        beforeValue: change.beforeValue ?? null,
        afterValue: change.afterValue ?? null,
        beforeCitation: change.beforeCitation
          ? publicCitation(change.beforeCitation)
          : null,
        afterCitation: change.afterCitation
          ? publicCitation(change.afterCitation)
          : null,
        reviewState: change.review.state,
      })),
      impacts: assessment.impacts,
      issues: assessment.issues.map(({ code, severity, message }) => ({
        code,
        severity,
        message,
      })),
    },
    review: resolved.review,
    reviewStale: resolved.reviewStale,
    application: snapshot.application,
    requiredConfirmation: ADDENDUM_REOPEN_CONFIRMATION,
  };
}

function validReason(value: string): boolean {
  return (
    value.trim().length > 0 &&
    value.length <= ADDENDUM_IMPACT_BOUNDS.reasonCodeUnits
  );
}

function assertExpected(
  command: {
    assessmentId: string;
    radarId: string;
    expectedImpactManifestSha256: string;
    expectedAssessmentVersion: number;
  },
  snapshot: AddendumImpactRepositorySnapshot,
  resolved: ReturnType<typeof resolveAssessment>,
): void {
  if (
    command.assessmentId !== resolved.raw.assessmentId ||
    command.radarId !== resolved.assessment.radarId ||
    command.expectedImpactManifestSha256 !==
      resolved.assessment.impactManifestSha256 ||
    command.expectedAssessmentVersion !== snapshot.assessmentVersion
  ) {
    throw new AddendumImpactServiceError(
      "stale_version",
      "The comparison, impact plan or review record changed; reload before continuing.",
    );
  }
}

function isExactReviewReplay(
  scope: AddendumImpactScope,
  command: AddendumImpactReviewCommand,
  resolved: ReturnType<typeof resolveAssessment>,
): boolean {
  const stored = resolved.review;
  return Boolean(
    stored &&
    !resolved.reviewStale &&
    command.expectedAssessmentVersion === 0 &&
    command.assessmentId === resolved.raw.assessmentId &&
    command.radarId === resolved.raw.radarId &&
    command.expectedImpactManifestSha256 ===
      resolved.raw.impactManifestSha256 &&
    stored.assessmentId === command.assessmentId &&
    stored.impactManifestSha256 === command.expectedImpactManifestSha256 &&
    stored.decision === command.decision &&
    stored.reason === command.reason.trim() &&
    stored.reviewerUserId === scope.actorUserId &&
    stored.reviewerName === scope.actorName,
  );
}

export class AddendumImpactService {
  constructor(
    private readonly repository: AddendumImpactRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private instant(): string {
    const value = this.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new AddendumImpactServiceError(
        "conflict",
        "The authoritative service clock is unavailable.",
      );
    }
    return value.toISOString();
  }

  private async load(
    scope: AddendumImpactScope,
    projectId: string,
    selection: AddendumImpactSelection = {},
  ): Promise<AddendumImpactRepositorySnapshot> {
    assertScope(scope);
    assertProjectAndSelection(projectId, selection);
    const snapshot = await this.repository.load(scope, projectId, selection);
    if (!snapshot) {
      throw new AddendumImpactServiceError(
        "not_found",
        "The project or exact source-version comparison is unavailable.",
      );
    }
    if (
      snapshot.organisationId !== scope.organisationId ||
      snapshot.projectId !== projectId ||
      !Number.isSafeInteger(snapshot.assessmentVersion) ||
      snapshot.assessmentVersion < 0
    ) {
      throw new AddendumImpactServiceError(
        "conflict",
        "The repository returned an invalid organisation-scoped comparison.",
      );
    }
    return snapshot;
  }

  async getCentre(
    scope: AddendumImpactScope,
    projectId: string,
    selection: AddendumImpactSelection = {},
  ): Promise<PublicAddendumImpactCentre> {
    const snapshot = await this.load(scope, projectId, selection);
    return publicCentre(snapshot, resolveAssessment(snapshot));
  }

  async review(
    scope: AddendumImpactScope,
    projectId: string,
    command: AddendumImpactReviewCommand,
  ): Promise<PublicAddendumImpactCentre> {
    assertScope(scope);
    assertDirectMutationScope(scope);
    if (
      !["accepted", "changes_requested", "rejected"].includes(
        command.decision,
      ) ||
      !isValidId(command.baselineVersionId) ||
      !isValidId(command.revisionVersionId) ||
      !validReason(command.reason) ||
      !isValidId(command.assessmentId) ||
      !isValidId(command.radarId) ||
      !validSha256(command.expectedImpactManifestSha256) ||
      !Number.isSafeInteger(command.expectedAssessmentVersion) ||
      command.expectedAssessmentVersion < 0
    ) {
      throw new AddendumImpactServiceError(
        "invalid_request",
        "The addendum review request is invalid.",
      );
    }
    const selection: AddendumImpactSelection = {
      baselineVersionId: command.baselineVersionId,
      revisionVersionId: command.revisionVersionId,
    };
    assertProjectAndSelection(projectId, selection);
    const snapshot = await this.load(scope, projectId, selection);
    const resolved = resolveAssessment(snapshot);
    if (isExactReviewReplay(scope, command, resolved)) {
      return publicCentre(snapshot, resolved);
    }
    assertExpected(command, snapshot, resolved);
    if (
      resolved.raw.status === "blocked" ||
      resolved.raw.status === "no_changes"
    ) {
      throw new AddendumImpactServiceError(
        "comparison_blocked",
        "Only a valid comparison with detected changes can be reviewed.",
      );
    }
    const reviewedAt = this.instant();
    const result = await this.repository.recordReview({
      scope,
      projectId,
      baselineDocumentVersionId: snapshot.baseline.documentVersionId,
      revisionDocumentVersionId: snapshot.revision.documentVersionId,
      expectedAssessmentVersion: command.expectedAssessmentVersion,
      assessmentId: resolved.raw.assessmentId,
      radarId: resolved.raw.radarId,
      impactManifestSha256: resolved.raw.impactManifestSha256,
      decision: command.decision,
      reason: command.reason.trim(),
      reviewedAt,
      assessment: resolved.raw,
    });
    if (result.outcome === "conflict") {
      throw new AddendumImpactServiceError(
        "stale_version",
        "The review record changed before this decision was stored.",
      );
    }
    const nextSnapshot: AddendumImpactRepositorySnapshot = {
      ...snapshot,
      assessmentVersion: result.value.version,
      review: result.value,
    };
    return publicCentre(nextSnapshot, resolveAssessment(nextSnapshot));
  }

  async apply(
    scope: AddendumImpactScope,
    projectId: string,
    command: AddendumImpactApplyCommand,
  ): Promise<{
    readonly replayed: boolean;
    readonly authorityNote: string;
    readonly application: NonNullable<
      AddendumImpactRepositorySnapshot["application"]
    >;
  }> {
    if (
      !validReason(command.reason) ||
      !command.baselineVersionId ||
      !command.revisionVersionId ||
      !isValidId(command.assessmentId) ||
      !isValidId(command.radarId) ||
      !validSha256(command.expectedImpactManifestSha256) ||
      !Number.isSafeInteger(command.expectedAssessmentVersion) ||
      command.expectedAssessmentVersion < 0 ||
      command.confirmation !== ADDENDUM_REOPEN_CONFIRMATION
    ) {
      throw new AddendumImpactServiceError(
        "invalid_request",
        "The controlled reopening request is invalid.",
      );
    }
    assertScope(scope);
    assertDirectMutationScope(scope);
    const selection: AddendumImpactSelection = {
      baselineVersionId: command.baselineVersionId,
      revisionVersionId: command.revisionVersionId,
    };
    assertProjectAndSelection(projectId, selection);
    const replay = await this.repository.findApplicationReplay({
      scope,
      projectId,
      baselineDocumentVersionId: command.baselineVersionId,
      revisionDocumentVersionId: command.revisionVersionId,
      expectedAssessmentVersion: command.expectedAssessmentVersion,
      assessmentId: command.assessmentId,
      radarId: command.radarId,
      impactManifestSha256: command.expectedImpactManifestSha256,
      reason: command.reason.trim(),
    });
    if (replay) {
      return {
        replayed: true,
        authorityNote: ADDENDUM_IMPACT_AUTHORITY_NOTE,
        application: replay,
      };
    }
    const snapshot = await this.load(scope, projectId, selection);
    const resolved = resolveAssessment(snapshot);
    assertExpected(command, snapshot, resolved);
    if (!resolved.review || resolved.reviewStale) {
      throw new AddendumImpactServiceError(
        "review_required",
        "A current named review is required before reopening any work.",
      );
    }
    if (resolved.review.decision !== "accepted") {
      throw new AddendumImpactServiceError(
        "review_required",
        "The current named review does not accept this impact plan.",
      );
    }
    if (resolved.review.reviewerUserId === scope.actorUserId) {
      throw new AddendumImpactServiceError(
        "review_required",
        "A different named organisation member must apply the accepted review.",
      );
    }
    const appliedAt = this.instant();
    const decision = authoriseControlledAddendumReopening({
      assessment: resolved.assessment,
      expectedRadarId: command.radarId,
      expectedImpactManifestSha256: command.expectedImpactManifestSha256,
      reason: command.reason,
      confirmation: command.confirmation,
      reviewer: {
        reviewerId: resolved.review.reviewerUserId,
        reviewerName: resolved.review.reviewerName,
        reviewedAt: resolved.review.reviewedAt,
      },
      actor: {
        actorId: scope.actorUserId,
        actorName: scope.actorName,
        appliedAt,
      },
    });
    if (!decision.allowed) {
      throw new AddendumImpactServiceError(
        decision.code === "review_required" ||
          decision.code === "named_review_required"
          ? "review_required"
          : decision.code.startsWith("stale_")
            ? "stale_version"
            : "comparison_blocked",
        decision.message,
      );
    }
    const result = await this.repository.applyReopening({
      scope,
      projectId,
      baselineDocumentVersionId: snapshot.baseline.documentVersionId,
      revisionDocumentVersionId: snapshot.revision.documentVersionId,
      expectedAssessmentVersion: command.expectedAssessmentVersion,
      assessmentId: command.assessmentId,
      radarId: command.radarId,
      sourceManifestSha256: resolved.raw.sourceManifestSha256,
      impactManifestSha256: command.expectedImpactManifestSha256,
      reason: command.reason.trim(),
      appliedAt,
      review: resolved.review,
      mutations: decision.mutations,
    });
    if (result.outcome === "conflict") {
      throw new AddendumImpactServiceError(
        "stale_version",
        "Affected work changed before the reviewed plan could be applied.",
      );
    }
    return {
      replayed: result.outcome === "replayed",
      authorityNote: ADDENDUM_IMPACT_AUTHORITY_NOTE,
      application: result.value,
    };
  }
}
