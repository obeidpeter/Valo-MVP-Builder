import { UUID_PATTERN } from "../identifierPatterns";
import { isIsoDate } from "./domain";
import {
  TENDER_CONTEXT_BOUNDS,
  type TenderArtifactBindingDraft,
  type TenderContextCentre,
  type TenderContextRepository,
  type TenderContextScope,
  type TenderContextVersionDraft,
  type TenderContextVersionRecord,
  type TenderEligibilityPassportRecord,
  type TenderRequirementBindingDraft,
  type TenderReviewDraft,
  type TenderReviewDecision,
} from "./tenderContextContracts";

export type TenderContextServiceErrorCode =
  | "invalid_request"
  | "not_found"
  | "conflict"
  | "version_conflict"
  | "state_conflict";

export class TenderContextServiceError extends Error {
  constructor(
    readonly code: TenderContextServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TenderContextServiceError";
  }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function boundedString(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

function normalizedScopeList(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > TENDER_CONTEXT_BOUNDS.scopesPerContext ||
    value.some(
      (entry) => !boundedString(entry, TENDER_CONTEXT_BOUNDS.scopeCharacters),
    )
  ) {
    return null;
  }
  const normalized = (value as string[]).map((entry) => entry.trim());
  return new Set(normalized).size === normalized.length
    ? normalized.sort()
    : null;
}

function parseRequirement(
  value: unknown,
): TenderRequirementBindingDraft | null {
  if (!plainObject(value)) return null;
  if (
    !exactKeys(value, [
      "requirementId",
      "requirementCitationId",
      "evidenceKind",
      "mandatory",
      "requiresCurrentOnSubmissionDate",
      "requiresExactLegalEntityMatch",
    ]) ||
    typeof value.requirementId !== "string" ||
    !UUID_PATTERN.test(value.requirementId) ||
    typeof value.requirementCitationId !== "string" ||
    !UUID_PATTERN.test(value.requirementCitationId) ||
    !boundedString(
      value.evidenceKind,
      TENDER_CONTEXT_BOUNDS.evidenceKindCharacters,
    ) ||
    typeof value.mandatory !== "boolean" ||
    typeof value.requiresCurrentOnSubmissionDate !== "boolean" ||
    typeof value.requiresExactLegalEntityMatch !== "boolean"
  ) {
    return null;
  }
  return {
    requirementId: value.requirementId,
    requirementCitationId: value.requirementCitationId,
    evidenceKind: value.evidenceKind.trim(),
    mandatory: value.mandatory,
    requiresCurrentOnSubmissionDate: value.requiresCurrentOnSubmissionDate,
    requiresExactLegalEntityMatch: value.requiresExactLegalEntityMatch,
  };
}

function parseArtifact(value: unknown): TenderArtifactBindingDraft | null {
  if (!plainObject(value) || !plainObject(value.citation)) return null;
  const legalEntityName = value.legalEntityName;
  const citation = value.citation;
  if (
    !exactKeys(value, [
      "vaultItemVersionId",
      "evidenceKind",
      "legalEntityName",
      "citation",
    ]) ||
    !exactKeys(citation, ["startOffset", "endOffset", "quote"]) ||
    typeof value.vaultItemVersionId !== "string" ||
    !UUID_PATTERN.test(value.vaultItemVersionId) ||
    !boundedString(
      value.evidenceKind,
      TENDER_CONTEXT_BOUNDS.evidenceKindCharacters,
    ) ||
    (legalEntityName !== undefined &&
      !boundedString(
        legalEntityName,
        TENDER_CONTEXT_BOUNDS.legalEntityCharacters,
      )) ||
    !Number.isSafeInteger(citation.startOffset) ||
    !Number.isSafeInteger(citation.endOffset) ||
    Number(citation.startOffset) < 0 ||
    Number(citation.endOffset) <= Number(citation.startOffset) ||
    !boundedString(citation.quote, TENDER_CONTEXT_BOUNDS.citationCharacters)
  ) {
    return null;
  }
  return {
    vaultItemVersionId: value.vaultItemVersionId,
    evidenceKind: value.evidenceKind.trim(),
    ...(typeof legalEntityName === "string"
      ? { legalEntityName: legalEntityName.trim() }
      : {}),
    citation: {
      startOffset: Number(citation.startOffset),
      endOffset: Number(citation.endOffset),
      quote: citation.quote,
    },
  };
}

export function parseTenderContextVersionDraft(
  value: unknown,
): TenderContextVersionDraft | null {
  if (!plainObject(value)) return null;
  const entityScopes = normalizedScopeList(value.entityScopes);
  const categoryScopes = normalizedScopeList(value.categoryScopes);
  if (
    !exactKeys(value, [
      "primaryDocumentVersionId",
      "jurisdictionRulePackId",
      "legalEntityName",
      "submissionDate",
      "jurisdiction",
      "entityScopes",
      "categoryScopes",
      "requirements",
      "artifacts",
    ]) ||
    typeof value.primaryDocumentVersionId !== "string" ||
    !UUID_PATTERN.test(value.primaryDocumentVersionId) ||
    typeof value.jurisdictionRulePackId !== "string" ||
    !UUID_PATTERN.test(value.jurisdictionRulePackId) ||
    !boundedString(
      value.legalEntityName,
      TENDER_CONTEXT_BOUNDS.legalEntityCharacters,
    ) ||
    typeof value.submissionDate !== "string" ||
    !isIsoDate(value.submissionDate) ||
    typeof value.jurisdiction !== "string" ||
    !/^NG(?:-[A-Z0-9]{1,12})?$/u.test(value.jurisdiction) ||
    !entityScopes ||
    !categoryScopes ||
    !Array.isArray(value.requirements) ||
    value.requirements.length === 0 ||
    value.requirements.length > TENDER_CONTEXT_BOUNDS.requirementsPerContext ||
    !Array.isArray(value.artifacts) ||
    value.artifacts.length > TENDER_CONTEXT_BOUNDS.artifactsPerContext
  ) {
    return null;
  }
  const requirements = value.requirements.map(parseRequirement);
  const artifacts = value.artifacts.map(parseArtifact);
  if (
    requirements.some((entry) => !entry) ||
    artifacts.some((entry) => !entry)
  ) {
    return null;
  }
  const typedRequirements = requirements as TenderRequirementBindingDraft[];
  const typedArtifacts = artifacts as TenderArtifactBindingDraft[];
  if (
    new Set(typedRequirements.map((entry) => entry.requirementId)).size !==
      typedRequirements.length ||
    new Set(
      typedArtifacts.map(
        (entry) => `${entry.vaultItemVersionId}\0${entry.evidenceKind}`,
      ),
    ).size !== typedArtifacts.length
  ) {
    return null;
  }
  return {
    primaryDocumentVersionId: value.primaryDocumentVersionId,
    jurisdictionRulePackId: value.jurisdictionRulePackId,
    legalEntityName: value.legalEntityName.trim(),
    submissionDate: value.submissionDate,
    jurisdiction: value.jurisdiction,
    entityScopes,
    categoryScopes,
    requirements: typedRequirements,
    artifacts: typedArtifacts,
  };
}

export function parseTenderReviewDraft(
  value: unknown,
): TenderReviewDraft | null {
  if (!plainObject(value) || !exactKeys(value, ["decision", "note"])) {
    return null;
  }
  if (
    !["accepted", "needs_changes", "rejected"].includes(
      String(value.decision),
    ) ||
    !boundedString(value.note, TENDER_CONTEXT_BOUNDS.reviewNoteCharacters)
  ) {
    return null;
  }
  return {
    decision: value.decision as TenderReviewDecision,
    note: value.note.trim(),
  };
}

function assertScope(scope: TenderContextScope, mutation: boolean): void {
  if (
    !UUID_PATTERN.test(scope.organisationId) ||
    !UUID_PATTERN.test(scope.actorUserId) ||
    !boundedString(
      scope.actorName,
      TENDER_CONTEXT_BOUNDS.reviewerNameCharacters,
    ) ||
    !["membership", "partner", "break_glass"].includes(scope.source) ||
    (mutation &&
      (scope.source !== "membership" ||
        !scope.membershipId ||
        !UUID_PATTERN.test(scope.membershipId)))
  ) {
    throw new TenderContextServiceError(
      "invalid_request",
      mutation
        ? "A current named organisation member is required for this review action."
        : "A current named organisation identity is required.",
    );
  }
}

function assertProject(projectId: string): void {
  if (!UUID_PATTERN.test(projectId)) {
    throw new TenderContextServiceError("invalid_request", "Invalid project.");
  }
}

function assertClock(now: Date): void {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TenderContextServiceError(
      "conflict",
      "The authoritative service clock is unavailable.",
    );
  }
}

function unwrap<T>(
  result:
    | { readonly outcome: "created" | "updated"; readonly value: T }
    | {
        readonly outcome:
          | "not_found"
          | "conflict"
          | "version_conflict"
          | "state_conflict";
      },
): T {
  if (result.outcome === "created" || result.outcome === "updated") {
    return result.value;
  }
  const message =
    result.outcome === "not_found"
      ? "The project or exact tender record is unavailable."
      : result.outcome === "version_conflict"
        ? "This record changed; reload before reviewing it."
        : result.outcome === "state_conflict"
          ? "The requested action is not allowed in the record's current review state."
          : "The selected tender sources or bindings are no longer valid.";
  throw new TenderContextServiceError(result.outcome, message);
}

export class TenderContextService {
  constructor(
    private readonly repository: TenderContextRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async readCentre(
    scope: TenderContextScope,
    projectId: string,
  ): Promise<TenderContextCentre> {
    assertScope(scope, false);
    assertProject(projectId);
    const centre = await this.repository.readCentre(scope, projectId);
    if (!centre) {
      throw new TenderContextServiceError(
        "not_found",
        "The project is unavailable.",
      );
    }
    return centre;
  }

  async createContext(
    scope: TenderContextScope,
    projectId: string,
    draft: TenderContextVersionDraft,
  ): Promise<TenderContextVersionRecord> {
    assertScope(scope, true);
    assertProject(projectId);
    const now = this.now();
    assertClock(now);
    return unwrap(
      await this.repository.createContext(scope, projectId, draft, now),
    );
  }

  async reviewContext(
    scope: TenderContextScope,
    projectId: string,
    contextVersionId: string,
    expectedVersion: number,
    draft: TenderReviewDraft,
  ): Promise<TenderContextVersionRecord> {
    assertScope(scope, true);
    assertProject(projectId);
    if (
      !UUID_PATTERN.test(contextVersionId) ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1
    ) {
      throw new TenderContextServiceError(
        "invalid_request",
        "Invalid tender context review target.",
      );
    }
    const now = this.now();
    assertClock(now);
    return unwrap(
      await this.repository.reviewContext(
        scope,
        projectId,
        contextVersionId,
        expectedVersion,
        draft,
        now,
      ),
    );
  }

  async createPassport(
    scope: TenderContextScope,
    projectId: string,
    contextVersionId: string,
  ): Promise<TenderEligibilityPassportRecord> {
    assertScope(scope, true);
    assertProject(projectId);
    if (!UUID_PATTERN.test(contextVersionId)) {
      throw new TenderContextServiceError(
        "invalid_request",
        "Invalid tender context version.",
      );
    }
    const now = this.now();
    assertClock(now);
    return unwrap(
      await this.repository.createPassport(
        scope,
        projectId,
        contextVersionId,
        now,
      ),
    );
  }

  async reviewPassport(
    scope: TenderContextScope,
    projectId: string,
    passportRecordId: string,
    expectedVersion: number,
    draft: TenderReviewDraft,
  ): Promise<TenderEligibilityPassportRecord> {
    assertScope(scope, true);
    assertProject(projectId);
    if (
      !UUID_PATTERN.test(passportRecordId) ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1
    ) {
      throw new TenderContextServiceError(
        "invalid_request",
        "Invalid eligibility passport review target.",
      );
    }
    const now = this.now();
    assertClock(now);
    return unwrap(
      await this.repository.reviewPassport(
        scope,
        projectId,
        passportRecordId,
        expectedVersion,
        draft,
        now,
      ),
    );
  }
}
