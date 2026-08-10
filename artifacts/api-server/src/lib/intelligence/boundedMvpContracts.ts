export const BOUNDED_MVP_MAX_ITEMS = 1_000;
export const BOUNDED_MVP_MAX_TEXT_CHARS = 60_000;

export interface BoundedScope {
  organisationId: string;
  projectId: string;
}

export type SourceLifecycleState =
  | "active"
  | "superseded"
  | "deleted"
  | "quarantined";

/**
 * A citation carries the canonical text used for local verification. Callers
 * must populate scope and lifecycle fields from trusted server state, never
 * from a model or browser payload.
 */
export interface BoundedSourceCitation extends BoundedScope {
  documentId: string;
  documentVersionId: string;
  sourceSha256: string;
  pageNumber: number;
  quote: string;
  canonicalPageText: string;
  startOffset?: number;
  endOffset?: number;
  lifecycleState: SourceLifecycleState;
}

export type CitationValidationCode =
  | "citation_scope_missing"
  | "citation_scope_mismatch"
  | "citation_source_inactive"
  | "citation_identity_missing"
  | "citation_hash_invalid"
  | "citation_page_invalid"
  | "citation_quote_missing"
  | "citation_quote_not_found"
  | "citation_text_too_large"
  | "citation_offset_invalid";

export interface CitationValidationIssue {
  code: CitationValidationCode;
  message: string;
}

export interface ProposalSafetyEnvelope {
  proposalOnly: true;
  requiresNamedHumanApproval: true;
  authoritativeStateChange: false;
  externalAction: "none";
}

const SAFETY_ENVELOPE: ProposalSafetyEnvelope = Object.freeze({
  proposalOnly: true,
  requiresNamedHumanApproval: true,
  authoritativeStateChange: false,
  externalAction: "none",
});

export function boundedProposalSafety(): ProposalSafetyEnvelope {
  return SAFETY_ENVELOPE;
}

const INVISIBLE_FORMATTING = /[\u00ad\u200b-\u200d\u2060\ufeff]/gu;
const WHITESPACE = /\s+/gu;
const SHA_256 = /^[a-f0-9]{64}$/iu;

export function normalizeBoundedText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(INVISIBLE_FORMATTING, "")
    .replace(WHITESPACE, " ")
    .trim();
}

export function validateBoundedCitation(
  citation: BoundedSourceCitation,
  scope: BoundedScope,
): CitationValidationIssue[] {
  const issues: CitationValidationIssue[] = [];

  if (
    !scope.organisationId.trim() ||
    !scope.projectId.trim() ||
    !citation.organisationId.trim() ||
    !citation.projectId.trim()
  ) {
    issues.push({
      code: "citation_scope_missing",
      message:
        "The citation or requested scope lacks an organisation or project identity.",
    });
  }
  if (
    citation.organisationId !== scope.organisationId ||
    citation.projectId !== scope.projectId
  ) {
    issues.push({
      code: "citation_scope_mismatch",
      message: "The citation is outside the requested organisation or project.",
    });
  }
  if (citation.lifecycleState !== "active") {
    issues.push({
      code: "citation_source_inactive",
      message: "The citation source is not an active document version.",
    });
  }
  if (!citation.documentId.trim() || !citation.documentVersionId.trim()) {
    issues.push({
      code: "citation_identity_missing",
      message: "The citation lacks a document or document-version identity.",
    });
  }
  if (!SHA_256.test(citation.sourceSha256)) {
    issues.push({
      code: "citation_hash_invalid",
      message: "The citation lacks a valid SHA-256 source identity.",
    });
  }
  if (!Number.isInteger(citation.pageNumber) || citation.pageNumber < 1) {
    issues.push({
      code: "citation_page_invalid",
      message: "The citation page must be a positive integer.",
    });
  }

  const citationTextTooLarge =
    citation.quote.length > BOUNDED_MVP_MAX_TEXT_CHARS ||
    citation.canonicalPageText.length > BOUNDED_MVP_MAX_TEXT_CHARS;
  if (citationTextTooLarge) {
    issues.push({
      code: "citation_text_too_large",
      message:
        "Citation text exceeds the bounded deterministic processing limit.",
    });
  }
  const normalizedQuote = citationTextTooLarge
    ? ""
    : normalizeBoundedText(citation.quote);
  const normalizedPage = citationTextTooLarge
    ? ""
    : normalizeBoundedText(citation.canonicalPageText);
  if (!citationTextTooLarge && !normalizedQuote) {
    issues.push({
      code: "citation_quote_missing",
      message: "The citation quote is empty.",
    });
  } else if (
    !citationTextTooLarge &&
    !normalizedPage.includes(normalizedQuote)
  ) {
    issues.push({
      code: "citation_quote_not_found",
      message:
        "The exact normalized quote does not occur in the canonical page text.",
    });
  }

  const hasStart = citation.startOffset !== undefined;
  const hasEnd = citation.endOffset !== undefined;
  if (hasStart || hasEnd) {
    const start = citation.startOffset;
    const end = citation.endOffset;
    if (
      start === undefined ||
      end === undefined ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end <= start ||
      end > citation.canonicalPageText.length ||
      citation.canonicalPageText.slice(start, end) !== citation.quote
    ) {
      issues.push({
        code: "citation_offset_invalid",
        message:
          "Citation offsets do not identify the exact quote in canonical text.",
      });
    }
  }

  return issues;
}

export function isBoundedCitationValid(
  citation: BoundedSourceCitation,
  scope: BoundedScope,
): boolean {
  return validateBoundedCitation(citation, scope).length === 0;
}

export function assertBoundedItems(
  label: string,
  items: readonly unknown[],
  maximum = BOUNDED_MVP_MAX_ITEMS,
): void {
  if (items.length > maximum) {
    throw new RangeError(
      `${label} exceeds the safe limit of ${maximum} items.`,
    );
  }
}

export function assertBoundedText(
  label: string,
  value: string,
  maximum = BOUNDED_MVP_MAX_TEXT_CHARS,
): void {
  if (value.length > maximum) {
    throw new RangeError(
      `${label} exceeds the safe limit of ${maximum} characters.`,
    );
  }
}
