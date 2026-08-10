import { createHash } from "node:crypto";

export type SourceAuthority = "authoritative" | "corroborating" | "unverified";

export type SourceKind =
  | "solicitation"
  | "addendum"
  | "company_evidence"
  | "official_opportunity"
  | "other";

/**
 * Source text is an input to this pure domain layer only so citations can be
 * proven against exact offsets. Callers remain responsible for authorization
 * before supplying it. IDs deliberately have no tenant semantics.
 */
export interface SourceDocument {
  readonly sourceId: string;
  readonly versionId: string;
  readonly kind: SourceKind;
  readonly title: string;
  readonly content: string;
  readonly contentSha256: string;
  readonly capturedAt: string;
  readonly authority: SourceAuthority;
  readonly origin: string;
}

export interface ExactCitation {
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly contentSha256: string;
  /** Offsets are zero-based UTF-16 code-unit offsets, matching String.slice. */
  readonly startOffset: number;
  readonly endOffset: number;
  readonly quote: string;
  readonly page?: number;
  readonly section?: string;
}

export interface GroundedCitation extends ExactCitation {
  readonly citationId: string;
  readonly offsetUnit: "utf16_code_unit";
  readonly sourceTitle: string;
  readonly sourceCapturedAt: string;
  readonly sourceAuthority: SourceAuthority;
  readonly sourceKind: SourceKind;
  readonly sourceOrigin: string;
}

export type HumanReviewState =
  | "unreviewed"
  | "accepted"
  | "rejected"
  | "needs_changes";

export interface HumanReview {
  readonly state: HumanReviewState;
  readonly reviewerId?: string;
  readonly reviewedAt?: string;
  readonly note?: string;
}

/** Binds a decision to the exact deterministic artifact that was reviewed. */
export interface SubjectReview {
  readonly subjectId: string;
  readonly review: HumanReview;
}

export interface DomainIssue {
  readonly code: string;
  readonly severity: "blocker" | "warning";
  readonly path: string;
  readonly message: string;
}

export const UNREVIEWED: HumanReview = Object.freeze({
  state: "unreviewed",
});

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const SOURCE_AUTHORITIES: readonly SourceAuthority[] = [
  "authoritative",
  "corroborating",
  "unverified",
];
const SOURCE_KINDS: readonly SourceKind[] = [
  "solicitation",
  "addendum",
  "company_evidence",
  "official_opportunity",
  "other",
];
const REVIEW_STATES: readonly HumanReviewState[] = [
  "unreviewed",
  "accepted",
  "rejected",
  "needs_changes",
];

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function deterministicId(prefix: string, payload: unknown): string {
  if (!/^[a-z][a-z0-9_]{1,20}$/.test(prefix)) {
    throw new Error("A stable lower-case domain prefix is required");
  }
  const digest = sha256Text(JSON.stringify(canonicalize(payload)));
  return `${prefix}_${digest.slice(0, 24)}`;
}

export function isValidId(value: string): boolean {
  return ID_PATTERN.test(value);
}

export function isIsoInstant(value: string): boolean {
  if (!ISO_INSTANT_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    return false;
  }
  const canonical = new Date(value).toISOString();
  return value === canonical || value === canonical.replace(".000Z", "Z");
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function validateHumanReview(
  review: HumanReview,
  path: string,
): DomainIssue[] {
  const issues: DomainIssue[] = [];
  if (!REVIEW_STATES.includes(review.state)) {
    issues.push({
      code: "invalid_human_review_state",
      severity: "blocker",
      path,
      message: "Human review state is not recognized.",
    });
    return issues;
  }
  if (review.state !== "unreviewed") {
    if (!review.reviewerId || !isValidId(review.reviewerId)) {
      issues.push({
        code: "invalid_human_review",
        severity: "blocker",
        path,
        message: "A non-unreviewed decision requires a valid reviewer ID.",
      });
    }
    if (!review.reviewedAt || !isIsoInstant(review.reviewedAt)) {
      issues.push({
        code: "invalid_human_review",
        severity: "blocker",
        path,
        message:
          "A non-unreviewed decision requires a valid UTC review instant.",
      });
    }
  }
  return issues;
}

export function reviewIsAccepted(review: HumanReview): boolean {
  return (
    review.state === "accepted" &&
    validateHumanReview(review, "review").length === 0
  );
}

export function resolveSubjectReview(
  expectedSubjectId: string,
  subjectReview: SubjectReview | undefined,
  path: string,
): { readonly review: HumanReview; readonly issues: readonly DomainIssue[] } {
  if (!subjectReview) return { review: UNREVIEWED, issues: [] };
  const issues = validateHumanReview(subjectReview.review, `${path}.review`);
  if (subjectReview.subjectId !== expectedSubjectId) {
    issues.push({
      code: "review_subject_mismatch",
      severity: "blocker",
      path: `${path}.subjectId`,
      message:
        "A human decision applies only to the exact deterministic artifact reviewed.",
    });
  }
  return { review: subjectReview.review, issues: sortIssues(issues) };
}

function sourceKey(sourceId: string, versionId: string): string {
  return `${sourceId}\u0000${versionId}`;
}

export interface ValidatedSourceSet {
  readonly byKey: ReadonlyMap<string, SourceDocument>;
  readonly issues: readonly DomainIssue[];
}

export function validateSources(
  sources: readonly SourceDocument[],
): ValidatedSourceSet {
  const byKey = new Map<string, SourceDocument>();
  const issues: DomainIssue[] = [];
  sources.forEach((source, index) => {
    const path = `sources[${index}]`;
    if (!isValidId(source.sourceId) || !isValidId(source.versionId)) {
      issues.push({
        code: "invalid_source_id",
        severity: "blocker",
        path,
        message:
          "Source and version IDs must be stable, tenant-neutral domain IDs.",
      });
    }
    if (
      !source.title.trim() ||
      !source.content.length ||
      !source.origin.trim()
    ) {
      issues.push({
        code: "incomplete_source_provenance",
        severity: "blocker",
        path,
        message: "Source title, origin, and content are required.",
      });
    }
    if (
      !SOURCE_AUTHORITIES.includes(source.authority) ||
      !SOURCE_KINDS.includes(source.kind)
    ) {
      issues.push({
        code: "invalid_source_classification",
        severity: "blocker",
        path,
        message:
          "Source kind and authority must use recognized closed-set values.",
      });
    }
    if (
      !SHA256_PATTERN.test(source.contentSha256) ||
      sha256Text(source.content) !== source.contentSha256
    ) {
      issues.push({
        code: "source_hash_mismatch",
        severity: "blocker",
        path,
        message: "Source content does not match its declared SHA-256.",
      });
    }
    if (!isIsoInstant(source.capturedAt)) {
      issues.push({
        code: "invalid_source_capture_time",
        severity: "blocker",
        path,
        message: "Source capture time must be a valid UTC instant.",
      });
    }
    const key = sourceKey(source.sourceId, source.versionId);
    if (byKey.has(key)) {
      issues.push({
        code: "duplicate_source_version",
        severity: "blocker",
        path,
        message: "A source/version pair may occur only once.",
      });
    } else {
      byKey.set(key, source);
    }
  });
  return { byKey, issues: sortIssues(issues) };
}

export interface CitationValidation {
  readonly citation?: GroundedCitation;
  readonly issues: readonly DomainIssue[];
}

export function validateCitation(
  citation: ExactCitation,
  sources: ReadonlyMap<string, SourceDocument>,
  path: string,
): CitationValidation {
  const issues: DomainIssue[] = [];
  const source = sources.get(
    sourceKey(citation.sourceId, citation.sourceVersionId),
  );
  if (!source) {
    issues.push({
      code: "citation_source_missing",
      severity: "blocker",
      path,
      message:
        "Citation source/version is not present in the supplied source set.",
    });
  } else {
    if (citation.contentSha256 !== source.contentSha256) {
      issues.push({
        code: "citation_hash_mismatch",
        severity: "blocker",
        path,
        message: "Citation SHA-256 does not match the cited source version.",
      });
    }
    if (
      !Number.isInteger(citation.startOffset) ||
      !Number.isInteger(citation.endOffset) ||
      citation.startOffset < 0 ||
      citation.endOffset <= citation.startOffset ||
      citation.endOffset > source.content.length
    ) {
      issues.push({
        code: "citation_range_invalid",
        severity: "blocker",
        path,
        message: "Citation offsets are outside the cited source text.",
      });
    } else if (
      !citation.quote.trim() ||
      source.content.slice(citation.startOffset, citation.endOffset) !==
        citation.quote
    ) {
      issues.push({
        code: "citation_quote_mismatch",
        severity: "blocker",
        path,
        message:
          "Citation quote must exactly equal the source text at its offsets.",
      });
    }
    if (
      citation.page != null &&
      (!Number.isInteger(citation.page) || citation.page < 1)
    ) {
      issues.push({
        code: "citation_page_invalid",
        severity: "blocker",
        path,
        message: "Citation page must be a positive integer when supplied.",
      });
    }
  }
  if (!source || issues.length) return { issues: sortIssues(issues) };
  return {
    citation: {
      ...citation,
      citationId: deterministicId("cite", citation),
      offsetUnit: "utf16_code_unit",
      sourceTitle: source.title,
      sourceCapturedAt: source.capturedAt,
      sourceAuthority: source.authority,
      sourceKind: source.kind,
      sourceOrigin: source.origin,
    },
    issues: [],
  };
}

export function validateCitations(
  citations: readonly ExactCitation[],
  sources: ReadonlyMap<string, SourceDocument>,
  path: string,
): {
  readonly citations: readonly GroundedCitation[];
  readonly issues: readonly DomainIssue[];
} {
  const grounded: GroundedCitation[] = [];
  const issues: DomainIssue[] = [];
  if (citations.length === 0) {
    issues.push({
      code: "citation_required",
      severity: "blocker",
      path,
      message: "At least one exact citation is required.",
    });
  }
  citations.forEach((citation, index) => {
    const result = validateCitation(citation, sources, `${path}[${index}]`);
    issues.push(...result.issues);
    if (result.citation) grounded.push(result.citation);
  });
  return {
    citations: grounded.sort((left, right) =>
      left.citationId.localeCompare(right.citationId),
    ),
    issues: sortIssues(issues),
  };
}

export function sortIssues(issues: readonly DomainIssue[]): DomainIssue[] {
  return [...issues].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message),
  );
}

export function hasBlockers(issues: readonly DomainIssue[]): boolean {
  return issues.some((issue) => issue.severity === "blocker");
}

export function uniqueIds(
  entries: readonly { readonly externalId: string }[],
  path: string,
): DomainIssue[] {
  const seen = new Set<string>();
  const issues: DomainIssue[] = [];
  entries.forEach((entry, index) => {
    if (!isValidId(entry.externalId)) {
      issues.push({
        code: "invalid_domain_id",
        severity: "blocker",
        path: `${path}[${index}].externalId`,
        message: "External IDs must be stable tenant-neutral domain IDs.",
      });
    } else if (seen.has(entry.externalId)) {
      issues.push({
        code: "duplicate_domain_id",
        severity: "blocker",
        path: `${path}[${index}].externalId`,
        message: "External IDs must be unique within an evaluation.",
      });
    }
    seen.add(entry.externalId);
  });
  return issues;
}
