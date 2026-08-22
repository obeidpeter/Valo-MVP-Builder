import type { ExactCitation } from "./domain";

export function serializedTenderValueWithinBound(
  value: string,
  maximumCodeUnits: number,
  maximumUtf8Bytes: number,
): boolean {
  return (
    value.length >= 2 &&
    value.length <= maximumCodeUnits &&
    Buffer.byteLength(value, "utf8") <= maximumUtf8Bytes
  );
}

/** Exact UTF-16 offset/quote validation used before a client citation is stored. */
export function citationMatchesImmutableSnapshot(
  canonicalText: string,
  citation: Pick<ExactCitation, "startOffset" | "endOffset" | "quote">,
): boolean {
  return (
    Number.isSafeInteger(citation.startOffset) &&
    Number.isSafeInteger(citation.endOffset) &&
    citation.startOffset >= 0 &&
    citation.endOffset > citation.startOffset &&
    citation.endOffset <= canonicalText.length &&
    canonicalText.slice(citation.startOffset, citation.endOffset) ===
      citation.quote
  );
}

/** Legacy verified snippets without offsets are safe only when uniquely located. */
export function uniqueCitationOffset(
  canonicalText: string,
  quote: string,
): number | null {
  if (!quote.length) return null;
  const offset = canonicalText.indexOf(quote);
  if (offset < 0 || canonicalText.indexOf(quote, offset + 1) !== -1) {
    return null;
  }
  return offset;
}

export function isCanonicalSnapshotRedactionStatus(value: string): boolean {
  return value === "included" || value === "redacted";
}

function normalizedLegalEntity(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-NG");
}

/** A typed entity name is usable only when the exact verified quote is that name. */
export function legalEntityNameMatchesCitation(
  legalEntityName: string,
  citationQuote: string,
): boolean {
  return (
    normalizedLegalEntity(legalEntityName) ===
    normalizedLegalEntity(citationQuote)
  );
}

export interface AcceptedArtifactAuthoritySnapshot {
  readonly vaultItemVersionId: string;
  readonly documentVersionId: string;
  readonly documentVersionSha256: string;
  readonly label: string;
  readonly issuer: string;
  readonly validFrom: string | null;
  readonly validUntil: string | null;
  readonly reviewerId: string;
  readonly reviewedAt: string;
}

export interface CurrentArtifactAuthorityState {
  readonly vaultItemVersionId: string;
  readonly vaultItemOrganisationId: string | null;
  readonly versionOrganisationId: string;
  readonly expectedOrganisationId: string;
  readonly clientId: string;
  readonly expectedClientId: string;
  readonly itemStatus: string;
  readonly sourceDocumentId: string | null;
  readonly documentId: string;
  readonly versionDocumentId: string;
  readonly documentVersionId: string;
  readonly documentVersionSha256: string;
  readonly snapshotDocumentVersionSha256: string;
  readonly verificationState: string;
  readonly withdrawnAt: Date | null;
  readonly approvedByUserId: string | null;
  readonly approvedAt: Date | null;
  readonly approverStatus: string | null;
  readonly approverName: string | null;
  readonly label: string;
  readonly issuer: string | null;
  readonly validFrom: string | null;
  readonly validUntil: string | null;
}

/** Accepted history cannot authorize evidence that has since been withdrawn. */
export function currentArtifactAuthorityMatches(
  accepted: AcceptedArtifactAuthoritySnapshot,
  current: CurrentArtifactAuthorityState,
): boolean {
  return (
    current.vaultItemVersionId === accepted.vaultItemVersionId &&
    current.vaultItemOrganisationId === current.expectedOrganisationId &&
    current.versionOrganisationId === current.expectedOrganisationId &&
    current.clientId === current.expectedClientId &&
    current.itemStatus === "active" &&
    current.sourceDocumentId === current.documentId &&
    current.versionDocumentId === current.documentId &&
    current.documentVersionId === accepted.documentVersionId &&
    current.documentVersionSha256 === accepted.documentVersionSha256 &&
    current.snapshotDocumentVersionSha256 === accepted.documentVersionSha256 &&
    current.verificationState === "approved" &&
    current.withdrawnAt === null &&
    current.approvedByUserId === accepted.reviewerId &&
    current.approvedAt?.toISOString() === accepted.reviewedAt &&
    current.approverStatus === "active" &&
    Boolean(current.approverName?.trim()) &&
    current.label === accepted.label &&
    current.issuer === accepted.issuer &&
    current.validFrom === accepted.validFrom &&
    current.validUntil === accepted.validUntil
  );
}
