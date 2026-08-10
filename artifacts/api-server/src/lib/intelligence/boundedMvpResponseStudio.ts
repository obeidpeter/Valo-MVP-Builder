import {
  assertBoundedItems,
  assertBoundedText,
  boundedProposalSafety,
  normalizeBoundedText,
  validateBoundedCitation,
  type BoundedScope,
  type BoundedSourceCitation,
  type ProposalSafetyEnvelope,
} from "./boundedMvpContracts";

export type ResponseClaimKind = "factual" | "instructional" | "opinion";
export type ResponseSupportMode = "exact_quote" | "paraphrase";

export interface CitationFirstResponseClaim {
  id: string;
  sectionId: string;
  text: string;
  kind: ResponseClaimKind;
  supportMode?: ResponseSupportMode;
  citations: readonly BoundedSourceCitation[];
}

export interface CitationFirstResponseInput extends BoundedScope {
  claims: readonly CitationFirstResponseClaim[];
}

export type ResponseValidationCode =
  | "duplicate_claim_id"
  | "empty_claim"
  | "placeholder_text"
  | "factual_citation_missing"
  | "citation_invalid"
  | "exact_claim_not_in_quote"
  | "semantic_support_requires_review";

export interface ResponseValidationFinding {
  code: ResponseValidationCode;
  severity: "blocker" | "review";
  claimId: string;
  message: string;
  citationIndexes?: number[];
}

export interface CitationFirstResponseValidation {
  validationStatus: "blocked" | "eligible_for_human_review";
  citationCoverageComplete: boolean;
  releaseAuthorized: false;
  findings: ResponseValidationFinding[];
  safety: ProposalSafetyEnvelope;
}

const MAX_CLAIMS = 500;
const MAX_CLAIM_CHARS = 5_000;
const PLACEHOLDER =
  /(?:\bTBC\b|\bTODO\b|\[\s*insert[^\]]*\]|<\s*insert[^>]*>)/iu;

/**
 * Validates citation-first response claims without treating source location as
 * proof of semantic entailment. Exact-quote claims can be checked locally;
 * paraphrases always remain subject to named-human support review.
 */
export function validateCitationFirstResponse(
  input: CitationFirstResponseInput,
): CitationFirstResponseValidation {
  assertBoundedItems("Response claims", input.claims, MAX_CLAIMS);
  const findings: ResponseValidationFinding[] = [];
  const seenClaimIds = new Set<string>();

  for (const claim of input.claims) {
    assertBoundedText(
      `Response claim ${claim.id}`,
      claim.text,
      MAX_CLAIM_CHARS,
    );
    if (seenClaimIds.has(claim.id)) {
      findings.push({
        code: "duplicate_claim_id",
        severity: "blocker",
        claimId: claim.id,
        message: "Claim identifiers must be unique within a response draft.",
      });
    }
    seenClaimIds.add(claim.id);

    if (!normalizeBoundedText(claim.text)) {
      findings.push({
        code: "empty_claim",
        severity: "blocker",
        claimId: claim.id,
        message: "The claim text is empty.",
      });
    }
    if (PLACEHOLDER.test(claim.text)) {
      findings.push({
        code: "placeholder_text",
        severity: "blocker",
        claimId: claim.id,
        message: "The claim contains unresolved placeholder text.",
      });
    }

    const invalidCitationIndexes = claim.citations.flatMap((citation, index) =>
      validateBoundedCitation(citation, input).length > 0 ? [index] : [],
    );
    if (invalidCitationIndexes.length > 0) {
      findings.push({
        code: "citation_invalid",
        severity: "blocker",
        claimId: claim.id,
        message:
          "One or more citations are inactive, ungrounded, or outside the response scope.",
        citationIndexes: invalidCitationIndexes,
      });
    }

    if (claim.kind !== "factual") continue;
    if (claim.citations.length === 0) {
      findings.push({
        code: "factual_citation_missing",
        severity: "blocker",
        claimId: claim.id,
        message:
          "Every factual claim requires at least one exact source citation.",
      });
      continue;
    }

    if (claim.supportMode === "exact_quote") {
      const normalizedClaim = normalizeBoundedText(claim.text);
      const hasExactSupport = claim.citations.some(
        (citation, index) =>
          !invalidCitationIndexes.includes(index) &&
          normalizeBoundedText(citation.quote).includes(normalizedClaim),
      );
      if (!hasExactSupport) {
        findings.push({
          code: "exact_claim_not_in_quote",
          severity: "blocker",
          claimId: claim.id,
          message:
            "An exact-quote claim does not occur in any valid cited quote.",
        });
      }
    } else {
      findings.push({
        code: "semantic_support_requires_review",
        severity: "review",
        claimId: claim.id,
        message:
          "Citation location is valid, but a named reviewer must confirm that it supports the paraphrase.",
      });
    }
  }

  const hasBlocker = findings.some((finding) => finding.severity === "blocker");
  const citationCoverageComplete = !findings.some((finding) =>
    new Set<ResponseValidationCode>([
      "factual_citation_missing",
      "citation_invalid",
      "exact_claim_not_in_quote",
    ]).has(finding.code),
  );

  return {
    validationStatus: hasBlocker ? "blocked" : "eligible_for_human_review",
    citationCoverageComplete,
    releaseAuthorized: false,
    findings,
    safety: boundedProposalSafety(),
  };
}
