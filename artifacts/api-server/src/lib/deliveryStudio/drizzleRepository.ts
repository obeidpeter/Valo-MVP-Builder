import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  claimEvidenceLinks,
  currentTenantDatabaseOrganisation,
  db,
  documentVersionSnapshots,
  documentVersions,
  documents,
  draftClaims,
  drafts,
  draftVersions,
  evidenceItems,
  outcomes,
  packageManifestItems,
  packages,
  packageVersions,
  projects,
  redTeamFindings,
  redTeamRuns,
  requirements,
  reviews,
} from "@workspace/db";
import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  inArray,
  ne,
  sql,
} from "drizzle-orm";
import { writeAudit, type AuditParams } from "../audit";
import {
  parseProposedStructuredSnapshot,
  type ProposedStructuredSnapshot,
  type StructuredField,
} from "../documentVersionSnapshotPolicy";
import { validateCitationFirstResponse } from "../intelligence/boundedMvpResponseStudio";
import {
  buildPortalSubmissionRehearsal,
  type PortalSubmissionRehearsalInput,
} from "../intelligence/portalSubmissionRehearsal";
import type { BoundedSourceCitation } from "../intelligence/boundedMvpContracts";
import {
  sha256Text,
  type ExactCitation,
  type HumanReview,
  type SourceDocument,
} from "../intelligence/domain";
import {
  bindDeliveryStudioSingleUnitCitation,
  buildDeliveryStudioRehearsalManifestText,
  deliveryStudioRehearsalManifestOrigin,
  deliveryStudioRehearsalManifestTitle,
  DeliveryStudioError,
  type DeliveryStudioAction,
  type DeliveryStudioMutationInput,
  type DeliveryStudioMutationRecord,
  type DeliveryStudioPackage,
  type DeliveryStudioRehearsalReceipt,
  type DeliveryStudioRepository,
  type DeliveryStudioRepositorySnapshot,
  type DeliveryStudioScope,
  type PortfolioRepositorySnapshot,
  type SaveResponseAction,
} from "./contracts";

const PLACEHOLDER =
  /(?:\bTBC\b|\bTODO\b|\[\s*insert[^\]]*\]|<\s*insert[^>]*>)/iu;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RECEIPT_SCHEMA = "valo.delivery-studio-receipt/v1";
const ACTION_RECEIPT = "delivery_studio_action_receipt";
const REHEARSAL_RECEIPT = "delivery_studio_rehearsal_receipt";
const TERMINAL_PROJECT_STATUSES = new Set([
  "signed_off",
  "exported",
  "archived",
]);
// These are the governed project-document types the product exposes as the
// bidder's own evidence. `other`, `boq`, and tender material stay fail-closed.
const COMPANY_EVIDENCE_DOCUMENT_TYPES = new Set([
  "bid",
  "certificate",
  "evidence",
  "company_evidence",
]);
export type DeliveryStudioQueryExecutor =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

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

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function deterministicUuid(value: string): string {
  const digest = createHash("sha256").update(value, "utf8").digest("hex");
  const variant = (
    (Number.parseInt(digest[16] ?? "0", 16) & 0x3) |
    0x8
  ).toString(16);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function assertTenant(organisationId: string): void {
  if (currentTenantDatabaseOrganisation() !== organisationId) {
    throw new DeliveryStudioError(
      "invalid_request",
      "The active tenant database does not match Delivery Studio authority.",
    );
  }
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function eligibleRedactionStatus(
  value: string | null,
): value is "included" | "redacted" {
  return value === "included" || value === "redacted";
}

function receiptPayload(value: string | null): Record<string, unknown> | null {
  if (!value || value.length > 1_000_000) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

type RedTeamApprovalReceiptCandidate = {
  readonly reviewerUserId: string;
  readonly completedAt: Date | null;
  readonly findings: string | null;
};

function redTeamApprovalAttestationFromReceipts(
  candidates: readonly RedTeamApprovalReceiptCandidate[],
  approvedByUserId: string | null,
  approvedAt: Date | null,
): string | null {
  if (!approvedByUserId || !approvedAt) return null;
  for (const candidate of candidates) {
    if (
      candidate.reviewerUserId !== approvedByUserId ||
      candidate.completedAt?.getTime() !== approvedAt.getTime()
    ) {
      continue;
    }
    const payload = receiptPayload(candidate.findings);
    const attestation = payload?.attestation;
    if (
      payload?.action === "approve_red_team" &&
      typeof attestation === "string" &&
      attestation.trim().length >= 10 &&
      attestation.length <= 2_000
    ) {
      return attestation.trim();
    }
  }
  return null;
}

export function isAttestedRedTeamApproval(input: {
  readonly runStatus: string;
  readonly sourceSnapshotMatches: boolean;
  readonly initiatedByUserId: string | null;
  readonly approvedByUserId: string | null;
  readonly approvedAt: Date | null;
  readonly approvalAttestation: string | null;
  readonly openFindingCount: number;
}): boolean {
  return (
    input.runStatus === "approved" &&
    input.sourceSnapshotMatches &&
    Boolean(input.approvedAt && input.approvedByUserId) &&
    input.approvedByUserId !== input.initiatedByUserId &&
    input.approvalAttestation !== null &&
    input.openFindingCount === 0
  );
}

export async function loadRedTeamApprovalAttestation(
  query: DeliveryStudioQueryExecutor,
  input: {
    readonly organisationId: string;
    readonly projectId: string;
    readonly runId: string;
    readonly approvedByUserId: string | null;
    readonly approvedAt: Date | null;
  },
): Promise<string | null> {
  const candidates = await query
    .select({
      reviewerUserId: reviews.reviewerUserId,
      completedAt: reviews.completedAt,
      findings: reviews.findings,
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.organisationId, input.organisationId),
        eq(reviews.projectId, input.projectId),
        eq(reviews.reviewType, ACTION_RECEIPT),
        eq(reviews.objectType, "red_team_run"),
        eq(reviews.objectId, input.runId),
      ),
    )
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(501);
  // A corrupted/unbounded receipt history is not approval evidence. Normal
  // runs have one start receipt and at most one approval receipt.
  if (candidates.length > 500) return null;
  return redTeamApprovalAttestationFromReceipts(
    candidates,
    input.approvedByUserId,
    input.approvedAt,
  );
}

function parseVerifiedStructuredSnapshot(input: {
  readonly structuredSnapshot: string | null;
  readonly structuredSnapshotSha256: string | null;
  readonly canonicalText: string;
  readonly canonicalTextSha256: string;
  readonly documentId: string;
  readonly documentVersionId: string;
}): ProposedStructuredSnapshot | null {
  if (
    !input.structuredSnapshot ||
    !input.structuredSnapshotSha256 ||
    sha256Text(input.canonicalText) !== input.canonicalTextSha256 ||
    sha256Text(input.structuredSnapshot) !== input.structuredSnapshotSha256
  ) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(input.structuredSnapshot);
  } catch {
    return null;
  }
  return parseProposedStructuredSnapshot({
    value,
    canonicalText: input.canonicalText,
    documentId: input.documentId,
    documentVersionId: input.documentVersionId,
  });
}

interface BoundStructuredCitationSpan {
  readonly canonicalPageText: string;
  readonly startOffset?: number;
  readonly endOffset?: number;
}

function bindCitationToStructuredPageSpan(
  snapshot: ProposedStructuredSnapshot,
  canonicalText: string,
  citation: {
    readonly pageNumber: number;
    readonly quote: string;
    readonly startOffset?: number;
    readonly endOffset?: number;
  },
): BoundStructuredCitationSpan | null {
  const candidates: StructuredField[] = [
    ...snapshot.fields,
    ...snapshot.operations.map((operation) =>
      operation.operation === "remove"
        ? {
            externalId: operation.externalId,
            category: operation.category,
            value: operation.instruction,
            startOffset: operation.startOffset,
            endOffset: operation.endOffset,
            ...(operation.page !== undefined ? { page: operation.page } : {}),
            ...(operation.section !== undefined
              ? { section: operation.section }
              : {}),
          }
        : {
            externalId: operation.externalId,
            category: operation.category,
            value: operation.value,
            startOffset: operation.startOffset,
            endOffset: operation.endOffset,
            ...(operation.page !== undefined ? { page: operation.page } : {}),
            ...(operation.section !== undefined
              ? { section: operation.section }
              : {}),
          },
    ),
  ];
  const hasStart = citation.startOffset !== undefined;
  const hasEnd = citation.endOffset !== undefined;
  if (hasStart !== hasEnd) return null;
  const matched = candidates.flatMap((span) => {
    if (
      span.page !== citation.pageNumber ||
      !span.value.includes(citation.quote)
    ) {
      return [];
    }
    if (!hasStart || !hasEnd) {
      return [{ canonicalPageText: span.value }];
    }
    const startOffset = citation.startOffset as number;
    const endOffset = citation.endOffset as number;
    if (
      startOffset < span.startOffset ||
      endOffset > span.endOffset ||
      endOffset <= startOffset ||
      canonicalText.slice(startOffset, endOffset) !== citation.quote
    ) {
      return [];
    }
    const localStart = startOffset - span.startOffset;
    const localEnd = endOffset - span.startOffset;
    return span.value.slice(localStart, localEnd) === citation.quote
      ? [
          {
            canonicalPageText: span.value,
            startOffset: localStart,
            endOffset: localEnd,
          },
        ]
      : [];
  });
  return matched.length === 1 ? matched[0]! : null;
}

function bindCitationToVerifiedDocumentSpan(input: {
  readonly documentType: string;
  readonly pageCount: number | null;
  readonly structuredSnapshot: string | null;
  readonly structuredSnapshotSha256: string | null;
  readonly canonicalText: string;
  readonly canonicalTextSha256: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly citation: {
    readonly pageNumber: number;
    readonly quote: string;
    readonly startOffset?: number;
    readonly endOffset?: number;
  };
}): BoundStructuredCitationSpan | null {
  if (sha256Text(input.canonicalText) !== input.canonicalTextSha256) {
    return null;
  }
  const structured = parseVerifiedStructuredSnapshot(input);
  if (structured) {
    return bindCitationToStructuredPageSpan(
      structured,
      input.canonicalText,
      input.citation,
    );
  }
  // A present-but-invalid structured proposal never falls back to unstructured
  // text. Solicitation/addendum/BOQ material always requires reviewed spans.
  if (
    input.structuredSnapshot !== null ||
    input.structuredSnapshotSha256 !== null ||
    !COMPANY_EVIDENCE_DOCUMENT_TYPES.has(input.documentType)
  ) {
    return null;
  }
  return bindDeliveryStudioSingleUnitCitation({
    canonicalText: input.canonicalText,
    pageCount: input.pageCount,
    citation: input.citation,
  });
}

async function sourceSnapshotProjection(
  organisationId: string,
  projectId: string,
  query: DeliveryStudioQueryExecutor = db,
): Promise<Record<string, unknown> | null> {
  assertTenant(organisationId);
  const [project] = await query
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!project) return null;

  const responseRows = await query
    .select({
      sectionKey: drafts.sectionKey,
      draftStatus: drafts.status,
      draftVersion: drafts.currentVersionNumber,
      draftVersionId: draftVersions.id,
      contentHash: draftVersions.contentHash,
      claimId: draftClaims.id,
      claimKey: draftClaims.claimKey,
      claimText: draftClaims.claimText,
      claimKind: draftClaims.claimKind,
      groundingStatus: draftClaims.groundingStatus,
      reviewerUserId: draftClaims.reviewerUserId,
      evidenceId: claimEvidenceLinks.id,
      documentVersionId: claimEvidenceLinks.documentVersionId,
      evidenceHash: claimEvidenceLinks.evidenceHash,
      evidenceCitation: claimEvidenceLinks.evidenceCitation,
    })
    .from(drafts)
    .leftJoin(
      draftVersions,
      and(
        eq(draftVersions.draftId, drafts.id),
        eq(draftVersions.versionNumber, drafts.currentVersionNumber),
      ),
    )
    .leftJoin(draftClaims, eq(draftClaims.draftVersionId, draftVersions.id))
    .leftJoin(
      claimEvidenceLinks,
      eq(claimEvidenceLinks.draftClaimId, draftClaims.id),
    )
    .where(
      and(
        eq(drafts.organisationId, organisationId),
        eq(drafts.projectId, projectId),
      ),
    )
    .orderBy(
      asc(drafts.sectionKey),
      asc(draftClaims.claimKey),
      asc(claimEvidenceLinks.id),
    )
    .limit(250_001);
  if (responseRows.length > 250_000) {
    throw new DeliveryStudioError(
      "conflict",
      "The current response exceeds the bounded source fingerprint.",
    );
  }

  const documentRows = await query
    .select({
      documentId: documents.id,
      documentType: documents.type,
      documentStatus: documents.extractionStatus,
      redactionStatus: documents.redactionStatus,
      documentVersion: documents.version,
      documentSha256: documents.sha256,
      versionId: documentVersions.id,
      versionNumber: documentVersions.versionNumber,
      pageCount: documentVersions.pageCount,
      versionSha256: documentVersions.sha256,
      malwareStatus: documentVersions.malwareStatus,
      quarantineStatus: documentVersions.quarantineStatus,
      addendumStatus: documentVersions.addendumStatus,
      snapshotStatus: documentVersionSnapshots.status,
      canonicalTextSha256: documentVersionSnapshots.canonicalTextSha256,
      structuredSnapshotSha256:
        documentVersionSnapshots.structuredSnapshotSha256,
      capturedRedactionStatus: documentVersionSnapshots.capturedRedactionStatus,
    })
    .from(documents)
    .leftJoin(documentVersions, eq(documentVersions.documentId, documents.id))
    .leftJoin(
      documentVersionSnapshots,
      eq(documentVersionSnapshots.documentVersionId, documentVersions.id),
    )
    .where(
      and(
        eq(documents.organisationId, organisationId),
        eq(documents.projectId, projectId),
      ),
    )
    .orderBy(asc(documents.id), asc(documentVersions.versionNumber))
    .limit(2_001);
  if (documentRows.length > 2_000) {
    throw new DeliveryStudioError(
      "conflict",
      "Project documents exceed the bounded source fingerprint.",
    );
  }
  const requirementRows = await query
    .select({
      id: requirements.id,
      sourceDocId: requirements.sourceDocId,
      pageRef: requirements.pageRef,
      clauseRef: requirements.clauseRef,
      text: requirements.text,
      category: requirements.category,
      expectedEvidence: requirements.expectedEvidence,
      isMandatory: requirements.isMandatory,
      reviewStatus: requirements.reviewStatus,
      version: requirements.version,
    })
    .from(requirements)
    .where(
      and(
        eq(requirements.organisationId, organisationId),
        eq(requirements.projectId, projectId),
      ),
    )
    .orderBy(asc(requirements.id))
    .limit(2_001);
  if (requirementRows.length > 2_000) {
    throw new DeliveryStudioError(
      "conflict",
      "Requirements exceed the bounded source fingerprint.",
    );
  }
  const evidenceRows = await query
    .select({
      id: evidenceItems.id,
      requirementId: evidenceItems.requirementId,
      documentId: evidenceItems.documentId,
      evidenceStatus: evidenceItems.evidenceStatus,
      excerpt: evidenceItems.excerpt,
      notes: evidenceItems.notes,
      suggested: evidenceItems.suggested,
      confirmedBy: evidenceItems.confirmedBy,
      version: evidenceItems.version,
    })
    .from(evidenceItems)
    .where(
      and(
        eq(evidenceItems.organisationId, organisationId),
        eq(evidenceItems.projectId, projectId),
      ),
    )
    .orderBy(asc(evidenceItems.id))
    .limit(4_001);
  if (evidenceRows.length > 4_000) {
    throw new DeliveryStudioError(
      "conflict",
      "Evidence rows exceed the bounded source fingerprint.",
    );
  }

  return {
    response: responseRows.map((row) => ({
      sectionKey: row.sectionKey,
      draftStatus: row.draftStatus,
      draftVersion: row.draftVersion,
      draftVersionId: row.draftVersionId,
      contentHash: row.contentHash,
      claimId: row.claimId,
      claimKey: row.claimKey,
      claimTextSha256:
        row.claimText !== null ? sha256Text(row.claimText) : null,
      claimKind: row.claimKind,
      groundingStatus: row.groundingStatus,
      reviewerUserId: row.reviewerUserId,
      evidenceId: row.evidenceId,
      documentVersionId: row.documentVersionId,
      evidenceHash: row.evidenceHash,
      evidenceCitationSha256:
        row.evidenceCitation !== null ? sha256Text(row.evidenceCitation) : null,
    })),
    documents: documentRows,
    requirements: requirementRows.map(({ text, expectedEvidence, ...row }) => ({
      ...row,
      textSha256: sha256Text(text),
      expectedEvidenceSha256:
        expectedEvidence !== null ? sha256Text(expectedEvidence) : null,
    })),
    evidence: evidenceRows.map(({ excerpt, notes, ...row }) => ({
      ...row,
      excerptSha256: excerpt !== null ? sha256Text(excerpt) : null,
      notesSha256: notes !== null ? sha256Text(notes) : null,
    })),
  };
}

/**
 * Returns the exact tenant-local current source snapshot hash used to bind
 * response evidence, red-team approval and package assembly. Raw source text
 * is reduced to content hashes. A missing or foreign project is null.
 */
export async function computeCurrentDeliveryStudioSourceSnapshotHash(
  organisationId: string,
  projectId: string,
  query: DeliveryStudioQueryExecutor = db,
): Promise<string | null> {
  const projection = await sourceSnapshotProjection(
    organisationId,
    projectId,
    query,
  );
  return projection === null
    ? null
    : sha256Text(
        canonicalJson({
          schema: "valo.delivery-studio-source/v1",
          organisationId,
          projectId,
          sources: projection,
        }),
      );
}

async function loadSections(organisationId: string, projectId: string) {
  const rows = await db
    .select({
      draftId: drafts.id,
      sectionKey: drafts.sectionKey,
      title: drafts.title,
      draftStatus: drafts.status,
      currentVersionNumber: drafts.currentVersionNumber,
      versionId: draftVersions.id,
      content: draftVersions.content,
      contentHash: draftVersions.contentHash,
      authorUserId: draftVersions.authorUserId,
      claimId: draftClaims.id,
      claimKey: draftClaims.claimKey,
      claimText: draftClaims.claimText,
      claimKind: draftClaims.claimKind,
      groundingStatus: draftClaims.groundingStatus,
      reviewerUserId: draftClaims.reviewerUserId,
      citationId: claimEvidenceLinks.id,
      documentVersionId: claimEvidenceLinks.documentVersionId,
      evidenceCitation: claimEvidenceLinks.evidenceCitation,
      evidenceHash: claimEvidenceLinks.evidenceHash,
    })
    .from(drafts)
    .leftJoin(
      draftVersions,
      and(
        eq(draftVersions.draftId, drafts.id),
        eq(draftVersions.versionNumber, drafts.currentVersionNumber),
      ),
    )
    .leftJoin(draftClaims, eq(draftClaims.draftVersionId, draftVersions.id))
    .leftJoin(
      claimEvidenceLinks,
      eq(claimEvidenceLinks.draftClaimId, draftClaims.id),
    )
    .where(
      and(
        eq(drafts.organisationId, organisationId),
        eq(drafts.projectId, projectId),
      ),
    )
    .orderBy(
      asc(drafts.sectionKey),
      asc(draftClaims.claimKey),
      asc(claimEvidenceLinks.id),
    )
    .limit(250_001);
  if (rows.length > 250_000) {
    throw new DeliveryStudioError(
      "conflict",
      "Response projection exceeds its bounded citation set.",
    );
  }

  const sectionMap = new Map<
    string,
    {
      id: string;
      sectionKey: string;
      title: string;
      status: string;
      currentVersionNumber: number;
      version: {
        id: string;
        content: string;
        contentHash: string;
        authorUserId: string | null;
        claims: Array<{
          id: string;
          claimKey: string;
          text: string;
          kind: string;
          supportMode: "exact_quote" | "paraphrase" | null;
          groundingStatus: string;
          reviewerUserId: string | null;
          citations: Array<{
            id: string;
            documentVersionId: string | null;
            evidenceCitation: string;
            evidenceHash: string;
          }>;
        }>;
      } | null;
      claimMap: Map<string, number>;
    }
  >();

  for (const row of rows) {
    let section = sectionMap.get(row.draftId);
    if (!section) {
      section = {
        id: row.draftId,
        sectionKey: row.sectionKey,
        title: row.title,
        status: row.draftStatus,
        currentVersionNumber: row.currentVersionNumber,
        version:
          row.versionId && row.content != null && row.contentHash
            ? {
                id: row.versionId,
                content: row.content,
                contentHash: row.contentHash,
                authorUserId: row.authorUserId,
                claims: [],
              }
            : null,
        claimMap: new Map(),
      };
      sectionMap.set(row.draftId, section);
    }
    if (!section.version || !row.claimId || !row.claimKey || !row.claimText) {
      continue;
    }
    let claimIndex = section.claimMap.get(row.claimId);
    if (claimIndex === undefined) {
      claimIndex = section.version.claims.length;
      section.claimMap.set(row.claimId, claimIndex);
      section.version.claims.push({
        id: row.claimId,
        claimKey: row.claimKey,
        text: row.claimText,
        kind: row.claimKind ?? "unknown",
        supportMode: null,
        groundingStatus: row.groundingStatus ?? "unverified",
        reviewerUserId: row.reviewerUserId,
        citations: [],
      });
    }
    const claim = section.version.claims[claimIndex];
    if (
      !claim ||
      !row.citationId ||
      !row.evidenceCitation ||
      !row.evidenceHash
    ) {
      continue;
    }
    const metadata = receiptPayload(row.evidenceCitation);
    const mode = metadata?.supportMode;
    if (mode === "exact_quote" || mode === "paraphrase") {
      claim.supportMode = mode;
    }
    claim.citations.push({
      id: row.citationId,
      documentVersionId: row.documentVersionId,
      evidenceCitation: row.evidenceCitation,
      evidenceHash: row.evidenceHash,
    });
  }
  const sections = [...sectionMap.values()].map((section) => ({
    id: section.id,
    sectionKey: section.sectionKey,
    title: section.title,
    status: section.status,
    currentVersionNumber: section.currentVersionNumber,
    version: section.version,
  }));
  const claimTotal = sections.reduce(
    (total, section) => total + (section.version?.claims.length ?? 0),
    0,
  );
  const citationTotal = sections.reduce(
    (total, section) =>
      total +
      (section.version?.claims.reduce(
        (claimTotal, claim) => claimTotal + claim.citations.length,
        0,
      ) ?? 0),
    0,
  );
  if (sections.length > 500 || claimTotal > 500 || citationTotal > 500) {
    throw new DeliveryStudioError(
      "conflict",
      "Response projection exceeds the public 500-item bound.",
    );
  }
  return sections;
}

interface EvidenceLinkIdentity {
  readonly id: string;
  readonly documentVersionId: string | null;
  readonly evidenceHash: string;
}

async function currentActiveEvidenceLinkIds(
  organisationId: string,
  projectId: string,
  links: readonly EvidenceLinkIdentity[],
): Promise<ReadonlySet<string>> {
  if (links.length === 0) return new Set();
  if (links.length > 500) {
    throw new DeliveryStudioError(
      "conflict",
      "Claim evidence exceeds the active-citation review bound.",
    );
  }
  const linkIds = links.map((link) => link.id);
  const rows = await db
    .select({
      linkId: claimEvidenceLinks.id,
      evidenceHash: claimEvidenceLinks.evidenceHash,
      evidenceCitation: claimEvidenceLinks.evidenceCitation,
      documentId: documents.id,
      documentType: documents.type,
      redactionStatus: documents.redactionStatus,
      documentVersionId: documentVersions.id,
      versionNumber: documentVersions.versionNumber,
      pageCount: documentVersions.pageCount,
      versionSha256: documentVersions.sha256,
      malwareStatus: documentVersions.malwareStatus,
      quarantineStatus: documentVersions.quarantineStatus,
      snapshotStatus: documentVersionSnapshots.status,
      canonicalText: documentVersionSnapshots.canonicalText,
      canonicalTextSha256: documentVersionSnapshots.canonicalTextSha256,
      structuredSnapshot: documentVersionSnapshots.structuredSnapshot,
      structuredSnapshotSha256:
        documentVersionSnapshots.structuredSnapshotSha256,
      capturedRedactionStatus: documentVersionSnapshots.capturedRedactionStatus,
    })
    .from(claimEvidenceLinks)
    .innerJoin(
      documentVersions,
      eq(documentVersions.id, claimEvidenceLinks.documentVersionId),
    )
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .innerJoin(
      documentVersionSnapshots,
      eq(documentVersionSnapshots.documentVersionId, documentVersions.id),
    )
    .where(
      and(
        eq(claimEvidenceLinks.organisationId, organisationId),
        eq(documentVersions.organisationId, organisationId),
        eq(documents.organisationId, organisationId),
        eq(documents.projectId, projectId),
        inArray(claimEvidenceLinks.id, linkIds),
      ),
    );
  const documentIds = [...new Set(rows.map((row) => row.documentId))];
  const versions =
    documentIds.length === 0
      ? []
      : await db
          .select({
            documentId: documentVersions.documentId,
            versionNumber: documentVersions.versionNumber,
          })
          .from(documentVersions)
          .where(
            and(
              eq(documentVersions.organisationId, organisationId),
              inArray(documentVersions.documentId, documentIds),
            ),
          );
  const latest = new Map<string, number>();
  for (const version of versions) {
    latest.set(
      version.documentId,
      Math.max(latest.get(version.documentId) ?? 0, version.versionNumber),
    );
  }
  const expected = new Map(links.map((link) => [link.id, link]));
  return new Set(
    rows.flatMap((row) => {
      const requested = expected.get(row.linkId);
      const citation = receiptPayload(row.evidenceCitation);
      const boundSpan =
        citation &&
        citation.documentId === row.documentId &&
        citation.documentVersionId === row.documentVersionId &&
        Number.isSafeInteger(citation.pageNumber) &&
        typeof citation.quote === "string"
          ? bindCitationToVerifiedDocumentSpan({
              documentType: row.documentType,
              pageCount: row.pageCount,
              structuredSnapshot: row.structuredSnapshot,
              structuredSnapshotSha256: row.structuredSnapshotSha256,
              canonicalText: row.canonicalText,
              canonicalTextSha256: row.canonicalTextSha256,
              documentId: row.documentId,
              documentVersionId: row.documentVersionId,
              citation: {
                pageNumber: citation.pageNumber as number,
                quote: citation.quote,
                ...(Number.isSafeInteger(citation.startOffset)
                  ? { startOffset: citation.startOffset as number }
                  : {}),
                ...(Number.isSafeInteger(citation.endOffset)
                  ? { endOffset: citation.endOffset as number }
                  : {}),
              },
            })
          : null;
      return requested &&
        requested.documentVersionId === row.documentVersionId &&
        requested.evidenceHash === row.evidenceHash &&
        row.evidenceHash === row.versionSha256 &&
        row.malwareStatus === "clean" &&
        row.quarantineStatus === "cleared" &&
        row.snapshotStatus === "verified" &&
        boundSpan !== null &&
        row.capturedRedactionStatus === row.redactionStatus &&
        eligibleRedactionStatus(row.capturedRedactionStatus) &&
        latest.get(row.documentId) === row.versionNumber
        ? [row.linkId]
        : [];
    }),
  );
}

async function loadLatestRedTeam(
  organisationId: string,
  projectId: string,
  sourceSnapshotHash: string,
) {
  const [run] = await db
    .select()
    .from(redTeamRuns)
    .where(
      and(
        eq(redTeamRuns.organisationId, organisationId),
        eq(redTeamRuns.projectId, projectId),
      ),
    )
    .orderBy(desc(redTeamRuns.createdAt), desc(redTeamRuns.id))
    .limit(1);
  if (!run) {
    return { status: "not_started" as const, dueAt: null, run: null };
  }
  const findings = await db
    .select()
    .from(redTeamFindings)
    .where(
      and(
        eq(redTeamFindings.organisationId, organisationId),
        eq(redTeamFindings.redTeamRunId, run.id),
      ),
    )
    .orderBy(asc(redTeamFindings.createdAt), asc(redTeamFindings.id))
    .limit(501);
  if (findings.length > 500) {
    throw new DeliveryStudioError(
      "conflict",
      "Red-team findings exceed the public 500-item bound.",
    );
  }
  const isStale = run.sourceSnapshotHash !== sourceSnapshotHash;
  const open = findings.filter(
    (finding) => finding.status !== "resolved",
  ).length;
  const approvalAttestation = await loadRedTeamApprovalAttestation(db, {
    organisationId,
    projectId,
    runId: run.id,
    approvedByUserId: run.approvedByUserId,
    approvedAt: run.approvedAt,
  });
  const status = isStale
    ? ("stale" as const)
    : isAttestedRedTeamApproval({
          runStatus: run.status,
          sourceSnapshotMatches: !isStale,
          initiatedByUserId: run.initiatedByUserId,
          approvedByUserId: run.approvedByUserId,
          approvedAt: run.approvedAt,
          approvalAttestation,
          openFindingCount: open,
        })
      ? ("approved" as const)
      : open > 0
        ? ("findings_open" as const)
        : run.status === "running"
          ? ("running" as const)
          : ("ready_for_approval" as const);
  return {
    status,
    dueAt: new Date(
      run.createdAt.getTime() + 48 * 60 * 60 * 1_000,
    ).toISOString(),
    run: {
      id: run.id,
      status: run.status,
      sourceSnapshotHash: run.sourceSnapshotHash,
      policyVersion: run.policyVersion,
      initiatedByUserId: run.initiatedByUserId,
      approvedByUserId: run.approvedByUserId,
      approvedAt: iso(run.approvedAt),
      approvalAttestation,
      createdAt: run.createdAt.toISOString(),
      findings: findings.map((finding) => ({
        id: finding.id,
        category: finding.category,
        severity: finding.severity,
        finding: finding.finding,
        status: finding.status,
        resolution: finding.resolution,
        resolvedByUserId: finding.resolvedByUserId,
        resolvedAt: iso(finding.resolvedAt),
        version: finding.version,
      })),
    },
  };
}

async function loadLatestPackage(
  organisationId: string,
  projectId: string,
  sourceSnapshotHash: string,
) {
  const [pkg] = await db
    .select()
    .from(packages)
    .where(
      and(
        eq(packages.organisationId, organisationId),
        eq(packages.projectId, projectId),
        eq(packages.packageType, "submission"),
      ),
    )
    .orderBy(desc(packages.updatedAt), desc(packages.id))
    .limit(1);
  if (!pkg || pkg.currentVersionNumber < 1) {
    return { status: "not_started" as const, package: null };
  }
  const [version] = await db
    .select()
    .from(packageVersions)
    .where(
      and(
        eq(packageVersions.organisationId, organisationId),
        eq(packageVersions.packageId, pkg.id),
        eq(packageVersions.versionNumber, pkg.currentVersionNumber),
      ),
    )
    .limit(1);
  if (!version) return { status: "draft" as const, package: null };
  const items = await db
    .select()
    .from(packageManifestItems)
    .where(
      and(
        eq(packageManifestItems.organisationId, organisationId),
        eq(packageManifestItems.packageVersionId, version.id),
      ),
    )
    .orderBy(asc(packageManifestItems.ordinal))
    .limit(1_001);
  if (items.length > 1_000) {
    throw new DeliveryStudioError(
      "conflict",
      "Package manifest exceeds the public 1,000-item bound.",
    );
  }
  const projected: DeliveryStudioPackage = {
    id: pkg.id,
    status: pkg.status,
    versionId: version.id,
    versionNumber: version.versionNumber,
    sourceSnapshotHash: version.sourceSnapshotHash,
    manifestHash: version.manifestHash,
    renderQaStatus: version.renderQaStatus,
    manifestItems: items.map((item) => ({
      id: item.id,
      ordinal: item.ordinal,
      itemType: item.itemType,
      sourceObjectId: item.sourceObjectId,
      sourceVersion: item.sourceVersion,
      filename: item.filename,
      sha256: item.sha256,
      sizeBytes: item.sizeBytes,
    })),
  };
  return {
    status:
      version.sourceSnapshotHash !== sourceSnapshotHash
        ? ("stale" as const)
        : items.length > 0 && pkg.status === "assembled"
          ? ("ready" as const)
          : ("draft" as const),
    package: projected,
  };
}

async function loadLatestRehearsal(
  organisationId: string,
  projectId: string,
  sourceSnapshotHash: string,
  latestPackageVersionId: string | null,
) {
  const [review] = await db
    .select()
    .from(reviews)
    .where(
      and(
        eq(reviews.organisationId, organisationId),
        eq(reviews.projectId, projectId),
        eq(reviews.reviewType, REHEARSAL_RECEIPT),
      ),
    )
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(1);
  if (!review) {
    return { status: "not_started" as const, receipt: null };
  }
  const payload = receiptPayload(review.findings);
  const result = payload?.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { status: "blocked" as const, receipt: null };
  }
  const record = result as Record<string, unknown>;
  const status = record.status;
  const packageVersionId = String(payload?.packageVersionId ?? review.objectId);
  const validStatus: DeliveryStudioRehearsalReceipt["status"] =
    status === "blocked" ||
    status === "incomplete" ||
    status === "review_required" ||
    status === "rehearsal_ready"
      ? status
      : "blocked";
  const issues: Array<{
    code: string;
    severity: "blocker" | "warning";
    message: string;
  }> = [];
  if (Array.isArray(record.issues)) {
    for (const issue of record.issues.slice(0, 500)) {
      if (!issue || typeof issue !== "object" || Array.isArray(issue)) continue;
      const item = issue as Record<string, unknown>;
      if (
        typeof item.code === "string" &&
        (item.severity === "blocker" || item.severity === "warning") &&
        typeof item.message === "string"
      ) {
        issues.push({
          code: item.code,
          severity: item.severity,
          message: item.message,
        });
      }
    }
  }
  const completedAt = review.completedAt ?? review.createdAt;
  const receipt: DeliveryStudioRehearsalReceipt = {
    id: review.id,
    packageVersionId,
    status: validStatus,
    rehearsalId: String(record.rehearsalId ?? "unavailable"),
    readyForOperatorRehearsal: record.readyForOperatorRehearsal === true,
    reviewerUserId: review.reviewerUserId,
    completedAt: completedAt.toISOString(),
    issues,
  };
  const stale =
    payload?.sourceSnapshotHash !== sourceSnapshotHash ||
    latestPackageVersionId !== packageVersionId;
  const projectedStatus = stale ? ("stale" as const) : validStatus;
  return {
    status: projectedStatus,
    receipt,
  };
}

async function loadSnapshot(
  organisationId: string,
  projectId: string,
): Promise<DeliveryStudioRepositorySnapshot | null> {
  assertTenant(organisationId);
  const [project] = await db
    .select({
      id: projects.id,
      title: projects.tenderTitle,
      status: projects.status,
      deadline: projects.deadline,
      version: projects.version,
    })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!project) return null;
  const sourceSnapshotHash =
    await computeCurrentDeliveryStudioSourceSnapshotHash(
      organisationId,
      projectId,
    );
  if (!sourceSnapshotHash) return null;
  const sections = await loadSections(organisationId, projectId);
  const claims = sections.flatMap((section) => section.version?.claims ?? []);
  const activeEvidenceLinkIds = await currentActiveEvidenceLinkIds(
    organisationId,
    projectId,
    claims.flatMap((claim) => claim.citations),
  );
  const claimCount = claims.length;
  const groundedClaimCount = claims.filter(
    (claim) =>
      claim.groundingStatus === "approved" &&
      (!new Set(["factual", "instructional"]).has(claim.kind) ||
        claim.citations.some((citation) =>
          activeEvidenceLinkIds.has(citation.id),
        )),
  ).length;
  const placeholderCount = sections.filter(
    (section) =>
      PLACEHOLDER.test(section.version?.content ?? "") ||
      (section.version?.claims ?? []).some((claim) =>
        PLACEHOLDER.test(claim.text),
      ),
  ).length;
  const responseStatus =
    sections.length === 0
      ? ("empty" as const)
      : claimCount === 0 || placeholderCount > 0
        ? ("draft" as const)
        : groundedClaimCount === claimCount
          ? ("ready" as const)
          : ("review_required" as const);
  const redTeamReview = await loadLatestRedTeam(
    organisationId,
    projectId,
    sourceSnapshotHash,
  );
  const packageAssembly = await loadLatestPackage(
    organisationId,
    projectId,
    sourceSnapshotHash,
  );
  const submissionRehearsal = await loadLatestRehearsal(
    organisationId,
    projectId,
    sourceSnapshotHash,
    packageAssembly.package?.versionId ?? null,
  );
  return {
    version: project.version,
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
      deadline: project.deadline,
    },
    sourceSnapshotHash,
    responseStudio: {
      status: responseStatus,
      sectionCount: sections.length,
      claimCount,
      groundedClaimCount,
      placeholderCount,
      sections,
    },
    redTeamReview,
    packageAssembly,
    submissionRehearsal,
  };
}

async function prepareResponseValidation(
  organisationId: string,
  projectId: string,
  action: SaveResponseAction,
) {
  assertTenant(organisationId);
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!project)
    throw new DeliveryStudioError("not_found", "Project was not found.");

  const requested = action.claims.flatMap((claim) => claim.citations);
  const versionIds = [
    ...new Set(requested.map((citation) => citation.documentVersionId)),
  ];
  const rows =
    versionIds.length === 0
      ? []
      : await db
          .select({
            documentId: documents.id,
            documentType: documents.type,
            projectId: documents.projectId,
            redactionStatus: documents.redactionStatus,
            documentVersionId: documentVersions.id,
            versionNumber: documentVersions.versionNumber,
            pageCount: documentVersions.pageCount,
            sha256: documentVersions.sha256,
            malwareStatus: documentVersions.malwareStatus,
            quarantineStatus: documentVersions.quarantineStatus,
            canonicalText: documentVersionSnapshots.canonicalText,
            canonicalTextSha256: documentVersionSnapshots.canonicalTextSha256,
            structuredSnapshot: documentVersionSnapshots.structuredSnapshot,
            structuredSnapshotSha256:
              documentVersionSnapshots.structuredSnapshotSha256,
            capturedRedactionStatus:
              documentVersionSnapshots.capturedRedactionStatus,
            snapshotStatus: documentVersionSnapshots.status,
          })
          .from(documentVersions)
          .innerJoin(documents, eq(documents.id, documentVersions.documentId))
          .innerJoin(
            documentVersionSnapshots,
            eq(documentVersionSnapshots.documentVersionId, documentVersions.id),
          )
          .where(
            and(
              eq(documentVersions.organisationId, organisationId),
              eq(documents.organisationId, organisationId),
              eq(documents.projectId, projectId),
              inArray(documentVersions.id, versionIds),
            ),
          );
  const byVersion = new Map(rows.map((row) => [row.documentVersionId, row]));
  const documentIds = [...new Set(rows.map((row) => row.documentId))];
  const allVersions =
    documentIds.length === 0
      ? []
      : await db
          .select({
            documentId: documentVersions.documentId,
            versionNumber: documentVersions.versionNumber,
          })
          .from(documentVersions)
          .where(
            and(
              eq(documentVersions.organisationId, organisationId),
              inArray(documentVersions.documentId, documentIds),
            ),
          );
  const latest = new Map<string, number>();
  for (const row of allVersions) {
    latest.set(
      row.documentId,
      Math.max(latest.get(row.documentId) ?? 0, row.versionNumber),
    );
  }

  return {
    organisationId,
    projectId,
    claims: action.claims.map((claim) => ({
      id: claim.claimKey,
      sectionId: action.sectionKey,
      text: claim.text,
      kind: claim.kind,
      ...(claim.supportMode ? { supportMode: claim.supportMode } : {}),
      citations: claim.citations.map((citation): BoundedSourceCitation => {
        const row = byVersion.get(citation.documentVersionId);
        if (!row || row.documentId !== citation.documentId) {
          return {
            organisationId,
            projectId,
            documentId: citation.documentId,
            documentVersionId: citation.documentVersionId,
            sourceSha256: "invalid",
            pageNumber: citation.pageNumber,
            quote: citation.quote,
            canonicalPageText: "",
            ...(citation.startOffset !== undefined
              ? { startOffset: citation.startOffset }
              : {}),
            ...(citation.endOffset !== undefined
              ? { endOffset: citation.endOffset }
              : {}),
            lifecycleState: "quarantined",
          };
        }
        const boundSpan = bindCitationToVerifiedDocumentSpan({
          documentType: row.documentType,
          pageCount: row.pageCount,
          structuredSnapshot: row.structuredSnapshot,
          structuredSnapshotSha256: row.structuredSnapshotSha256,
          canonicalText: row.canonicalText,
          canonicalTextSha256: row.canonicalTextSha256,
          documentId: row.documentId,
          documentVersionId: row.documentVersionId,
          citation,
        });
        const active =
          row.projectId === projectId &&
          row.malwareStatus === "clean" &&
          row.quarantineStatus === "cleared" &&
          row.snapshotStatus === "verified" &&
          row.capturedRedactionStatus === row.redactionStatus &&
          eligibleRedactionStatus(row.capturedRedactionStatus) &&
          latest.get(row.documentId) === row.versionNumber &&
          boundSpan !== null;
        return {
          organisationId,
          projectId,
          documentId: row.documentId,
          documentVersionId: row.documentVersionId,
          sourceSha256: row.sha256,
          pageNumber: citation.pageNumber,
          quote: citation.quote,
          canonicalPageText: boundSpan?.canonicalPageText ?? "",
          ...(boundSpan?.startOffset !== undefined
            ? { startOffset: boundSpan.startOffset }
            : {}),
          ...(boundSpan?.endOffset !== undefined
            ? { endOffset: boundSpan.endOffset }
            : {}),
          lifecycleState: active ? "active" : "superseded",
        };
      }),
    })),
  };
}

async function saveResponse(
  input: DeliveryStudioMutationInput,
  action: SaveResponseAction,
) {
  if (!input.derived.responseValidation) {
    throw new DeliveryStudioError(
      "conflict",
      "Response validation is missing.",
    );
  }
  const [otherCurrentResponse] = await db
    .select({
      sectionCount: countDistinct(drafts.id),
      claimCount: countDistinct(draftClaims.id),
      citationCount: countDistinct(claimEvidenceLinks.id),
    })
    .from(drafts)
    .leftJoin(
      draftVersions,
      and(
        eq(draftVersions.draftId, drafts.id),
        eq(draftVersions.versionNumber, drafts.currentVersionNumber),
      ),
    )
    .leftJoin(draftClaims, eq(draftClaims.draftVersionId, draftVersions.id))
    .leftJoin(
      claimEvidenceLinks,
      eq(claimEvidenceLinks.draftClaimId, draftClaims.id),
    )
    .where(
      and(
        eq(drafts.organisationId, input.scope.organisationId),
        eq(drafts.projectId, input.projectId),
        ne(drafts.sectionKey, action.sectionKey),
      ),
    );
  const projectedSections = Number(otherCurrentResponse?.sectionCount ?? 0) + 1;
  const projectedClaims =
    Number(otherCurrentResponse?.claimCount ?? 0) + action.claims.length;
  const projectedCitations =
    Number(otherCurrentResponse?.citationCount ?? 0) +
    action.claims.reduce((total, claim) => total + claim.citations.length, 0);
  if (
    projectedSections > 500 ||
    projectedClaims > 500 ||
    projectedCitations > 500
  ) {
    throw new DeliveryStudioError(
      "conflict",
      "Saving this section would exceed the 500-section, claim, or citation response bound.",
    );
  }
  const validationInput = await prepareResponseValidation(
    input.scope.organisationId,
    input.projectId,
    action,
  );
  const currentValidation = validateCitationFirstResponse(validationInput);
  if (
    canonicalJson(currentValidation) !==
    canonicalJson(input.derived.responseValidation)
  ) {
    throw new DeliveryStudioError(
      "stale_version",
      "Response source validation changed before the project mutation lock.",
    );
  }
  const [existing] = await db
    .select()
    .from(drafts)
    .where(
      and(
        eq(drafts.organisationId, input.scope.organisationId),
        eq(drafts.projectId, input.projectId),
        eq(drafts.sectionKey, action.sectionKey),
      ),
    )
    .limit(1);
  const nextVersion = (existing?.currentVersionNumber ?? 0) + 1;
  const [draft] = existing
    ? await db
        .update(drafts)
        .set({
          title: action.title,
          status: "review_required",
          currentVersionNumber: nextVersion,
          version: sql`${drafts.version} + 1`,
          updatedAt: new Date(input.occurredAt),
        })
        .where(eq(drafts.id, existing.id))
        .returning()
    : await db
        .insert(drafts)
        .values({
          organisationId: input.scope.organisationId,
          projectId: input.projectId,
          sectionKey: action.sectionKey,
          title: action.title,
          status: "review_required",
          currentVersionNumber: nextVersion,
        })
        .returning();
  if (!draft)
    throw new DeliveryStudioError("conflict", "Draft could not be saved.");
  const contentHash = sha256Text(action.content);
  const [version] = await db
    .insert(draftVersions)
    .values({
      organisationId: input.scope.organisationId,
      draftId: draft.id,
      versionNumber: nextVersion,
      content: action.content,
      contentHash,
      sourceRequirementVersionSnapshot: canonicalJson({
        schema: "valo.delivery-studio-response/v1",
        validation: currentValidation,
        citations: validationInput.claims.map((claim) =>
          claim.citations.map((citation) => ({
            documentVersionId: citation.documentVersionId,
            sourceSha256: citation.sourceSha256,
          })),
        ),
      }),
      authorType: "human",
      authorUserId: input.scope.actorUserId,
      changeSummary: action.changeSummary,
    })
    .returning();
  if (!version)
    throw new DeliveryStudioError("conflict", "Draft version was not stored.");

  for (const [claimIndex, claim] of action.claims.entries()) {
    const [storedClaim] = await db
      .insert(draftClaims)
      .values({
        organisationId: input.scope.organisationId,
        draftVersionId: version.id,
        claimKey: claim.claimKey,
        claimText: claim.text,
        claimKind: claim.kind,
        groundingStatus: "unverified",
      })
      .returning();
    if (!storedClaim) {
      throw new DeliveryStudioError(
        "conflict",
        "Response claim was not stored.",
      );
    }
    const resolved = validationInput.claims[claimIndex];
    for (const [citationIndex, citation] of claim.citations.entries()) {
      const serverCitation = resolved?.citations[citationIndex];
      if (!serverCitation || serverCitation.lifecycleState !== "active")
        continue;
      await db.insert(claimEvidenceLinks).values({
        organisationId: input.scope.organisationId,
        draftClaimId: storedClaim.id,
        documentVersionId: citation.documentVersionId,
        evidenceCitation: canonicalJson({
          ...citation,
          sourceSha256: serverCitation.sourceSha256,
          supportMode: claim.supportMode ?? null,
        }),
        evidenceHash: serverCitation.sourceSha256,
      });
    }
  }
  return { objectType: "draft_version", objectId: version.id };
}

async function reviewResponseClaim(
  input: DeliveryStudioMutationInput,
  action: Extract<DeliveryStudioAction, { action: "review_response_claim" }>,
) {
  const [claim] = await db
    .select({
      claimId: draftClaims.id,
      claimKey: draftClaims.claimKey,
      claimKind: draftClaims.claimKind,
      draftVersionId: draftClaims.draftVersionId,
      authorUserId: draftVersions.authorUserId,
      validationSnapshot: draftVersions.sourceRequirementVersionSnapshot,
      draftId: drafts.id,
    })
    .from(draftClaims)
    .innerJoin(draftVersions, eq(draftVersions.id, draftClaims.draftVersionId))
    .innerJoin(
      drafts,
      and(
        eq(drafts.id, draftVersions.draftId),
        eq(drafts.currentVersionNumber, draftVersions.versionNumber),
      ),
    )
    .where(
      and(
        eq(draftClaims.id, action.claimId),
        eq(draftClaims.organisationId, input.scope.organisationId),
        eq(drafts.projectId, input.projectId),
      ),
    )
    .limit(1);
  if (!claim) {
    throw new DeliveryStudioError(
      "not_found",
      "The claim is not part of a current response version.",
    );
  }
  if (!claim.authorUserId || claim.authorUserId === input.scope.actorUserId) {
    throw new DeliveryStudioError(
      "review_required",
      "A claim must be reviewed by someone other than its author.",
    );
  }
  if (action.decision === "accepted") {
    const snapshot = receiptPayload(claim.validationSnapshot);
    const validation = snapshot?.validation;
    const findings =
      validation && typeof validation === "object" && !Array.isArray(validation)
        ? (validation as Record<string, unknown>).findings
        : null;
    const hasStoredBlocker =
      !Array.isArray(findings) ||
      findings.some(
        (finding) =>
          finding &&
          typeof finding === "object" &&
          !Array.isArray(finding) &&
          (finding as Record<string, unknown>).claimId === claim.claimKey &&
          (finding as Record<string, unknown>).severity === "blocker",
      );
    const evidence = await db
      .select({
        id: claimEvidenceLinks.id,
        documentVersionId: claimEvidenceLinks.documentVersionId,
        evidenceHash: claimEvidenceLinks.evidenceHash,
      })
      .from(claimEvidenceLinks)
      .where(
        and(
          eq(claimEvidenceLinks.organisationId, input.scope.organisationId),
          eq(claimEvidenceLinks.draftClaimId, claim.claimId),
        ),
      )
      .limit(501);
    const activeEvidence = await currentActiveEvidenceLinkIds(
      input.scope.organisationId,
      input.projectId,
      evidence,
    );
    if (
      hasStoredBlocker ||
      (new Set(["factual", "instructional"]).has(claim.claimKind) &&
        activeEvidence.size === 0)
    ) {
      throw new DeliveryStudioError(
        "review_required",
        "A claim with a deterministic validation blocker or missing factual/instructional evidence cannot be approved.",
      );
    }
  }
  const groundingStatus =
    action.decision === "accepted"
      ? "approved"
      : action.decision === "rejected"
        ? "rejected"
        : "review_required";
  await db
    .update(draftClaims)
    .set({
      groundingStatus,
      reviewerUserId: input.scope.actorUserId,
      reviewedAt: new Date(input.occurredAt),
    })
    .where(eq(draftClaims.id, action.claimId));
  const currentClaims = await db
    .select({ status: draftClaims.groundingStatus })
    .from(draftClaims)
    .where(eq(draftClaims.draftVersionId, claim.draftVersionId));
  await db
    .update(drafts)
    .set({
      status:
        currentClaims.length > 0 &&
        currentClaims.every(({ status }) => status === "approved")
          ? "reviewed"
          : "review_required",
      updatedAt: new Date(input.occurredAt),
    })
    .where(eq(drafts.id, claim.draftId));
  return { objectType: "draft_claim", objectId: claim.claimId };
}

async function startRedTeam(
  input: DeliveryStudioMutationInput,
  action: Extract<DeliveryStudioAction, { action: "start_red_team" }>,
) {
  const snapshot = await loadSnapshot(
    input.scope.organisationId,
    input.projectId,
  );
  if (!snapshot)
    throw new DeliveryStudioError("not_found", "Project was not found.");
  if (snapshot.responseStudio.status !== "ready") {
    throw new DeliveryStudioError(
      "review_required",
      "Red-team review can start only after every current response claim is approved against current evidence.",
    );
  }
  const sourceSnapshotHash = snapshot.sourceSnapshotHash;
  const [existingRun] = await db
    .select({ id: redTeamRuns.id })
    .from(redTeamRuns)
    .where(
      and(
        eq(redTeamRuns.organisationId, input.scope.organisationId),
        eq(redTeamRuns.projectId, input.projectId),
        eq(redTeamRuns.sourceSnapshotHash, sourceSnapshotHash),
      ),
    )
    .limit(1);
  if (existingRun) {
    throw new DeliveryStudioError(
      "conflict",
      "The current response snapshot already has a red-team run; its findings cannot be abandoned by restarting.",
    );
  }
  const [run] = await db
    .insert(redTeamRuns)
    .values({
      organisationId: input.scope.organisationId,
      projectId: input.projectId,
      sourceSnapshotHash,
      policyVersion: action.policyVersion,
      status:
        action.findings.length > 0 ? "findings_open" : "ready_for_approval",
      initiatedByUserId: input.scope.actorUserId,
      createdAt: new Date(input.occurredAt),
      updatedAt: new Date(input.occurredAt),
    })
    .returning();
  if (!run)
    throw new DeliveryStudioError("conflict", "Red-team run was not stored.");
  if (action.findings.length > 0) {
    await db.insert(redTeamFindings).values(
      action.findings.map((finding) => ({
        organisationId: input.scope.organisationId,
        redTeamRunId: run.id,
        category: finding.category,
        severity: finding.severity,
        objectType: finding.objectType,
        objectId: finding.objectId,
        finding: finding.finding,
        status: "open",
      })),
    );
  }
  return { objectType: "red_team_run", objectId: run.id };
}

async function resolveFinding(
  input: DeliveryStudioMutationInput,
  action: Extract<DeliveryStudioAction, { action: "resolve_red_team_finding" }>,
) {
  const [finding] = await db
    .select({
      id: redTeamFindings.id,
      runId: redTeamRuns.id,
      runStatus: redTeamRuns.status,
      findingStatus: redTeamFindings.status,
      severity: redTeamFindings.severity,
    })
    .from(redTeamFindings)
    .innerJoin(redTeamRuns, eq(redTeamRuns.id, redTeamFindings.redTeamRunId))
    .where(
      and(
        eq(redTeamFindings.id, action.findingId),
        eq(redTeamRuns.id, action.runId),
        eq(redTeamRuns.organisationId, input.scope.organisationId),
        eq(redTeamRuns.projectId, input.projectId),
      ),
    )
    .limit(1);
  if (!finding)
    throw new DeliveryStudioError(
      "not_found",
      "Red-team finding was not found.",
    );
  if (
    finding.runStatus === "approved" ||
    finding.findingStatus === "resolved"
  ) {
    throw new DeliveryStudioError(
      "conflict",
      "The red-team finding is no longer open.",
    );
  }
  if (finding.severity === "fatal" || finding.severity === "likely_fatal") {
    throw new DeliveryStudioError(
      "review_required",
      "Fatal and likely-fatal findings cannot be cleared by a Delivery Studio note. Remediate the source and run a new independent review.",
    );
  }
  await db
    .update(redTeamFindings)
    .set({
      status: "resolved",
      resolution: action.resolution,
      resolvedByUserId: input.scope.actorUserId,
      resolvedAt: new Date(input.occurredAt),
      version: sql`${redTeamFindings.version} + 1`,
      updatedAt: new Date(input.occurredAt),
    })
    .where(eq(redTeamFindings.id, finding.id));
  const statuses = await db
    .select({ status: redTeamFindings.status })
    .from(redTeamFindings)
    .where(eq(redTeamFindings.redTeamRunId, finding.runId));
  if (statuses.every(({ status }) => status === "resolved")) {
    await db
      .update(redTeamRuns)
      .set({
        status: "ready_for_approval",
        updatedAt: new Date(input.occurredAt),
      })
      .where(eq(redTeamRuns.id, finding.runId));
  }
  return { objectType: "red_team_finding", objectId: finding.id };
}

async function approveRedTeam(
  input: DeliveryStudioMutationInput,
  action: Extract<DeliveryStudioAction, { action: "approve_red_team" }>,
) {
  const [latest] = await db
    .select()
    .from(redTeamRuns)
    .where(
      and(
        eq(redTeamRuns.organisationId, input.scope.organisationId),
        eq(redTeamRuns.projectId, input.projectId),
      ),
    )
    .orderBy(desc(redTeamRuns.createdAt), desc(redTeamRuns.id))
    .limit(1);
  if (!latest || latest.id !== action.runId) {
    throw new DeliveryStudioError(
      "not_found",
      "The current red-team run was not found.",
    );
  }
  const snapshot = await loadSnapshot(
    input.scope.organisationId,
    input.projectId,
  );
  if (!snapshot || snapshot.responseStudio.status !== "ready") {
    throw new DeliveryStudioError(
      "review_required",
      "Red-team approval requires a currently ready response with active evidence.",
    );
  }
  const currentHash = snapshot.sourceSnapshotHash;
  const findings = await db
    .select({ status: redTeamFindings.status })
    .from(redTeamFindings)
    .where(eq(redTeamFindings.redTeamRunId, latest.id));
  if (
    latest.status !== "ready_for_approval" ||
    latest.initiatedByUserId === input.scope.actorUserId ||
    latest.sourceSnapshotHash !== currentHash ||
    findings.some(({ status }) => status !== "resolved")
  ) {
    throw new DeliveryStudioError(
      "review_required",
      "Approval requires an independent reviewer, the current response snapshot, and resolved findings.",
    );
  }
  await db
    .update(redTeamRuns)
    .set({
      status: "approved",
      approvedByUserId: input.scope.actorUserId,
      approvedAt: new Date(input.occurredAt),
      updatedAt: new Date(input.occurredAt),
    })
    .where(eq(redTeamRuns.id, latest.id));
  return { objectType: "red_team_run", objectId: latest.id };
}

function safeFilename(sectionKey: string, ordinal: number): string {
  const safe = sectionKey
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  return `${String(ordinal).padStart(3, "0")}-${safe || "response"}.txt`;
}

async function assemblePackage(input: DeliveryStudioMutationInput) {
  const snapshot = await loadSnapshot(
    input.scope.organisationId,
    input.projectId,
  );
  if (
    !snapshot ||
    snapshot.responseStudio.status !== "ready" ||
    snapshot.redTeamReview.status !== "approved"
  ) {
    throw new DeliveryStudioError(
      "review_required",
      "Package assembly requires approved response claims and a current independent red-team approval.",
    );
  }
  const [existing] = await db
    .select()
    .from(packages)
    .where(
      and(
        eq(packages.organisationId, input.scope.organisationId),
        eq(packages.projectId, input.projectId),
        eq(packages.packageType, "submission"),
      ),
    )
    .orderBy(desc(packages.updatedAt), desc(packages.id))
    .limit(1);
  const nextVersion = (existing?.currentVersionNumber ?? 0) + 1;
  const [pkg] = existing
    ? await db
        .update(packages)
        .set({
          status: "assembled",
          currentVersionNumber: nextVersion,
          version: sql`${packages.version} + 1`,
          updatedAt: new Date(input.occurredAt),
        })
        .where(eq(packages.id, existing.id))
        .returning()
    : await db
        .insert(packages)
        .values({
          organisationId: input.scope.organisationId,
          projectId: input.projectId,
          packageType: "submission",
          status: "assembled",
          currentVersionNumber: nextVersion,
        })
        .returning();
  if (!pkg)
    throw new DeliveryStudioError(
      "conflict",
      "Package could not be assembled.",
    );
  const manifest = snapshot.responseStudio.sections.flatMap(
    (section, index) => {
      const version = section.version;
      return version
        ? [
            {
              ordinal: index + 1,
              itemType: "response_section",
              sourceObjectId: section.id,
              sourceVersion: section.currentVersionNumber,
              filename: safeFilename(section.sectionKey, index + 1),
              sha256: version.contentHash,
              sizeBytes: Buffer.byteLength(version.content, "utf8"),
            },
          ]
        : [];
    },
  );
  if (manifest.length === 0) {
    throw new DeliveryStudioError(
      "review_required",
      "No current response sections can be packaged.",
    );
  }
  const manifestHash = sha256Text(canonicalJson(manifest));
  const [version] = await db
    .insert(packageVersions)
    .values({
      organisationId: input.scope.organisationId,
      packageId: pkg.id,
      versionNumber: nextVersion,
      sourceSnapshotHash: snapshot.sourceSnapshotHash,
      manifestHash,
      renderQaStatus: "pending",
      readinessSnapshot: canonicalJson({
        schema: "valo.delivery-studio-package-readiness/v1",
        responseStatus: snapshot.responseStudio.status,
        redTeamRunId: snapshot.redTeamReview.run?.id ?? null,
        redTeamStatus: snapshot.redTeamReview.status,
        manifestHash,
      }),
      generatedByUserId: input.scope.actorUserId,
    })
    .returning();
  if (!version)
    throw new DeliveryStudioError(
      "conflict",
      "Package version was not stored.",
    );
  await db.insert(packageManifestItems).values(
    manifest.map((item) => ({
      organisationId: input.scope.organisationId,
      packageVersionId: version.id,
      ...item,
    })),
  );
  return { objectType: "package_version", objectId: version.id };
}

async function normalizeRehearsalForMutation(
  input: DeliveryStudioMutationInput,
  action: Extract<DeliveryStudioAction, { action: "rehearse_submission" }>,
): Promise<PortalSubmissionRehearsalInput> {
  const [packageVersion] = await db
    .select({
      id: packageVersions.id,
      packageId: packageVersions.packageId,
      createdAt: packageVersions.createdAt,
    })
    .from(packageVersions)
    .innerJoin(packages, eq(packages.id, packageVersions.packageId))
    .where(
      and(
        eq(packageVersions.id, action.packageVersionId),
        eq(packageVersions.organisationId, input.scope.organisationId),
        eq(packages.projectId, input.projectId),
      ),
    )
    .limit(1);
  if (!packageVersion) {
    throw new DeliveryStudioError(
      "stale_version",
      "Submission rehearsal requires a current project package version.",
    );
  }

  const manifestItems = await db
    .select({
      filename: packageManifestItems.filename,
      sizeBytes: packageManifestItems.sizeBytes,
      sha256: packageManifestItems.sha256,
    })
    .from(packageManifestItems)
    .where(
      and(
        eq(packageManifestItems.organisationId, input.scope.organisationId),
        eq(packageManifestItems.packageVersionId, packageVersion.id),
      ),
    )
    .orderBy(asc(packageManifestItems.ordinal))
    .limit(1_001);
  if (manifestItems.length === 0 || manifestItems.length > 1_000) {
    throw new DeliveryStudioError(
      "review_required",
      "Submission rehearsal requires a bounded current package manifest.",
    );
  }
  const fieldByExternalId = new Map(
    action.rehearsal.fields.map((field) => [field.externalId, field]),
  );
  const fileByExternalId = new Map(
    action.rehearsal.files.map((file) => [file.externalId, file]),
  );
  const manifestContent = buildDeliveryStudioRehearsalManifestText({
    packageId: packageVersion.packageId,
    packageVersionId: packageVersion.id,
    files: manifestItems.map((item) => ({
      ...item,
      mappings: action.rehearsal.mappings.flatMap((mapping) => {
        const suppliedFile = fileByExternalId.get(mapping.fileExternalId);
        const field = fieldByExternalId.get(mapping.fieldExternalId);
        return suppliedFile?.filename === item.filename && field
          ? [{ fieldLabel: field.label, rationale: mapping.rationale }]
          : [];
      }),
    })),
  });
  if (manifestContent.length > 2_000_000) {
    throw new DeliveryStudioError(
      "review_required",
      "The canonical package manifest exceeds the bounded rehearsal source limit.",
    );
  }

  const projectVersionIds = action.rehearsal.sources
    .filter((source) => source.kind !== "company_evidence")
    .map((source) => source.versionId)
    .filter((versionId) => UUID.test(versionId));
  const projectSourceRows =
    projectVersionIds.length === 0
      ? []
      : await db
          .select({
            documentId: documents.id,
            filename: documents.filename,
            versionId: documentVersionSnapshots.documentVersionId,
            canonicalText: documentVersionSnapshots.canonicalText,
            canonicalTextSha256: documentVersionSnapshots.canonicalTextSha256,
            structuredSnapshot: documentVersionSnapshots.structuredSnapshot,
            structuredSnapshotSha256:
              documentVersionSnapshots.structuredSnapshotSha256,
            capturedAt: documentVersionSnapshots.createdAt,
          })
          .from(documentVersionSnapshots)
          .innerJoin(
            documentVersions,
            eq(documentVersions.id, documentVersionSnapshots.documentVersionId),
          )
          .innerJoin(documents, eq(documents.id, documentVersions.documentId))
          .where(
            and(
              eq(
                documentVersionSnapshots.organisationId,
                input.scope.organisationId,
              ),
              eq(documentVersions.organisationId, input.scope.organisationId),
              eq(documents.organisationId, input.scope.organisationId),
              eq(documents.projectId, input.projectId),
              inArray(
                documentVersionSnapshots.documentVersionId,
                projectVersionIds,
              ),
            ),
          )
          .limit(501);
  if (projectSourceRows.length > 500) {
    throw new DeliveryStudioError(
      "review_required",
      "Portal-rule sources exceed the bounded rehearsal source limit.",
    );
  }
  const projectSourceByVersion = new Map(
    projectSourceRows.map((row) => [row.versionId, row]),
  );
  const normalizedSources: SourceDocument[] = action.rehearsal.sources.map(
    (source) => {
      if (source.kind === "company_evidence") {
        if (
          source.sourceId !== packageVersion.packageId ||
          source.versionId !== packageVersion.id
        ) {
          throw new DeliveryStudioError(
            "review_required",
            "The company-evidence source must identify the current package manifest.",
          );
        }
        return {
          ...source,
          title: deliveryStudioRehearsalManifestTitle(packageVersion.id),
          content: manifestContent,
          contentSha256: sha256Text(manifestContent),
          capturedAt: packageVersion.createdAt.toISOString(),
          authority: "authoritative" as const,
          origin: deliveryStudioRehearsalManifestOrigin(
            packageVersion.packageId,
            packageVersion.id,
          ),
        };
      }

      const row = projectSourceByVersion.get(source.versionId);
      const structured = row
        ? parseVerifiedStructuredSnapshot({
            structuredSnapshot: row.structuredSnapshot,
            structuredSnapshotSha256: row.structuredSnapshotSha256,
            canonicalText: row.canonicalText,
            canonicalTextSha256: row.canonicalTextSha256,
            documentId: row.documentId,
            documentVersionId: row.versionId,
          })
        : null;
      if (!row || !structured || structured.sourceId !== source.sourceId) {
        throw new DeliveryStudioError(
          "review_required",
          "Portal-rule source identity must match a verified project document snapshot.",
        );
      }
      return {
        ...source,
        kind: structured.sourceKind,
        title: row.filename,
        content: row.canonicalText,
        contentSha256: row.canonicalTextSha256,
        capturedAt: row.capturedAt.toISOString(),
        authority: structured.authority,
        origin: structured.origin,
      };
    },
  );
  if (
    normalizedSources.reduce(
      (total, source) => total + source.content.length,
      0,
    ) > 3_000_000
  ) {
    throw new DeliveryStudioError(
      "review_required",
      "Portal rehearsal sources exceed the three-million-character aggregate limit.",
    );
  }
  const sourceByKey = new Map(
    normalizedSources.map((source) => [
      `${source.sourceId}\u0000${source.versionId}`,
      source,
    ]),
  );
  const normalizeCitation = (citation: ExactCitation): ExactCitation => {
    const source = sourceByKey.get(
      `${citation.sourceId}\u0000${citation.sourceVersionId}`,
    );
    if (!source) {
      throw new DeliveryStudioError(
        "review_required",
        "Every rehearsal citation must identify one supplied bound source.",
      );
    }
    let startOffset = citation.startOffset;
    let endOffset = citation.endOffset;
    if (source.content.slice(startOffset, endOffset) !== citation.quote) {
      startOffset = source.content.indexOf(citation.quote);
      endOffset = startOffset + citation.quote.length;
      if (
        startOffset < 0 ||
        source.content.indexOf(citation.quote, startOffset + 1) >= 0
      ) {
        throw new DeliveryStudioError(
          "review_required",
          "A rehearsal quote must use exact offsets or occur uniquely in its verified source.",
        );
      }
    }
    return {
      ...citation,
      contentSha256: source.contentSha256,
      startOffset,
      endOffset,
    };
  };
  const normalizeReview = (review: HumanReview): HumanReview => {
    if (review.state === "unreviewed") return { state: "unreviewed" };
    if (review.reviewerId !== input.scope.actorUserId) {
      throw new DeliveryStudioError(
        "review_required",
        "Recorded rehearsal decisions must belong to the current named operator.",
      );
    }
    return {
      ...review,
      reviewerId: input.scope.actorUserId,
      reviewedAt: input.occurredAt,
    };
  };

  return {
    ...action.rehearsal,
    sources: normalizedSources,
    fields: action.rehearsal.fields.map((field) => ({
      ...field,
      citations: field.citations.map(normalizeCitation),
      review: normalizeReview(field.review),
    })),
    files: action.rehearsal.files.map((file) => ({
      ...file,
      citations: file.citations.map(normalizeCitation),
      review: normalizeReview(file.review),
    })),
    mappings: action.rehearsal.mappings.map((mapping) => ({
      ...mapping,
      citations: mapping.citations.map(normalizeCitation),
      review: normalizeReview(mapping.review),
    })),
    ...(action.rehearsal.rehearsalReview
      ? {
          rehearsalReview: {
            ...action.rehearsal.rehearsalReview,
            review: normalizeReview(action.rehearsal.rehearsalReview.review),
          },
        }
      : {}),
  };
}

async function rehearseSubmission(
  input: DeliveryStudioMutationInput,
  action: Extract<DeliveryStudioAction, { action: "rehearse_submission" }>,
) {
  const rehearsal = input.derived.normalizedRehearsal;
  if (!input.derived.rehearsalResult || !rehearsal) {
    throw new DeliveryStudioError(
      "conflict",
      "Submission rehearsal result is missing.",
    );
  }
  const [version] = await db
    .select({
      id: packageVersions.id,
      packageId: packages.id,
      packageType: packages.packageType,
      sourceSnapshotHash: packageVersions.sourceSnapshotHash,
      versionNumber: packageVersions.versionNumber,
      currentVersionNumber: packages.currentVersionNumber,
      createdAt: packageVersions.createdAt,
    })
    .from(packageVersions)
    .innerJoin(packages, eq(packages.id, packageVersions.packageId))
    .where(
      and(
        eq(packageVersions.id, action.packageVersionId),
        eq(packageVersions.organisationId, input.scope.organisationId),
        eq(packages.projectId, input.projectId),
      ),
    )
    .limit(1);
  const currentHash = await computeCurrentDeliveryStudioSourceSnapshotHash(
    input.scope.organisationId,
    input.projectId,
  );
  if (
    !version ||
    version.packageType !== "submission" ||
    version.versionNumber !== version.currentVersionNumber ||
    version.sourceSnapshotHash !== currentHash
  ) {
    throw new DeliveryStudioError(
      "stale_version",
      "Submission rehearsal requires the current package and response snapshot.",
    );
  }

  const manifestItems = await db
    .select({
      filename: packageManifestItems.filename,
      sizeBytes: packageManifestItems.sizeBytes,
      sha256: packageManifestItems.sha256,
    })
    .from(packageManifestItems)
    .where(
      and(
        eq(packageManifestItems.organisationId, input.scope.organisationId),
        eq(packageManifestItems.packageVersionId, version.id),
      ),
    )
    .orderBy(asc(packageManifestItems.ordinal))
    .limit(1_001);
  if (manifestItems.length === 0 || manifestItems.length > 1_000) {
    throw new DeliveryStudioError(
      "review_required",
      "Submission rehearsal requires a bounded current package manifest.",
    );
  }
  const expectedFiles = manifestItems
    .map(({ filename, sizeBytes, sha256 }) => ({ filename, sizeBytes, sha256 }))
    .sort((left, right) => left.filename.localeCompare(right.filename));
  if (
    rehearsal.files.some((file) => file.sizeText !== `${file.sizeBytes} bytes`)
  ) {
    throw new DeliveryStudioError(
      "review_required",
      "Every rehearsal file must use the canonical '<sizeBytes> bytes' size text.",
    );
  }
  const suppliedFiles = rehearsal.files
    .map(({ filename, sizeBytes, sha256 }) => ({ filename, sizeBytes, sha256 }))
    .sort((left, right) => left.filename.localeCompare(right.filename));
  if (canonicalJson(expectedFiles) !== canonicalJson(suppliedFiles)) {
    throw new DeliveryStudioError(
      "review_required",
      "Rehearsal files must exactly match the current package manifest.",
    );
  }

  const fieldByExternalId = new Map(
    rehearsal.fields.map((field) => [field.externalId, field]),
  );
  const fileByExternalId = new Map(
    rehearsal.files.map((file) => [file.externalId, file]),
  );
  const mappingReferencesValid =
    fieldByExternalId.size === rehearsal.fields.length &&
    fileByExternalId.size === rehearsal.files.length &&
    rehearsal.mappings.every((mapping) => {
      const field = fieldByExternalId.get(mapping.fieldExternalId);
      const file = fileByExternalId.get(mapping.fileExternalId);
      return Boolean(field?.fieldType === "file" && file);
    });
  if (!mappingReferencesValid) {
    throw new DeliveryStudioError(
      "review_required",
      "Every rehearsal mapping must reference one unique supplied file and a file-type portal field.",
    );
  }
  if (
    rehearsal.mappings.some(
      (mapping) =>
        mapping.review.state !== "accepted" ||
        mapping.review.reviewerId !== input.scope.actorUserId,
    )
  ) {
    throw new DeliveryStudioError(
      "review_required",
      "Every package-to-field mapping rationale requires acceptance by the current named operator.",
    );
  }

  const manifestSourceContent = buildDeliveryStudioRehearsalManifestText({
    packageId: version.packageId,
    packageVersionId: version.id,
    files: expectedFiles.map((file) => ({
      ...file,
      mappings: rehearsal.mappings.flatMap((mapping) => {
        const suppliedFile = fileByExternalId.get(mapping.fileExternalId);
        const field = fieldByExternalId.get(mapping.fieldExternalId);
        return suppliedFile?.filename === file.filename && field
          ? [{ fieldLabel: field.label, rationale: mapping.rationale }]
          : [];
      }),
    })),
  });
  const manifestTitle = deliveryStudioRehearsalManifestTitle(version.id);
  const manifestOrigin = deliveryStudioRehearsalManifestOrigin(
    version.packageId,
    version.id,
  );
  const companySources = rehearsal.sources.filter(
    (source) => source.kind === "company_evidence",
  );
  if (
    companySources.length !== 1 ||
    companySources.some(
      (source) =>
        source.sourceId !== version.packageId ||
        source.versionId !== version.id ||
        source.title !== manifestTitle ||
        source.origin !== manifestOrigin ||
        source.content !== manifestSourceContent ||
        source.contentSha256 !== sha256Text(manifestSourceContent) ||
        source.capturedAt !== version.createdAt.toISOString() ||
        source.authority !== "authoritative",
    )
  ) {
    throw new DeliveryStudioError(
      "review_required",
      "Company-evidence rehearsal sources must be the exact server-derived package manifest.",
    );
  }

  const projectSources = rehearsal.sources.filter(
    (source) => source.kind !== "company_evidence",
  );
  if (
    projectSources.some(
      (source) => !UUID.test(source.sourceId) || !UUID.test(source.versionId),
    )
  ) {
    throw new DeliveryStudioError(
      "review_required",
      "Portal-rule sources must identify verified project document versions.",
    );
  }
  const sourceVersionIds = projectSources.map((source) => source.versionId);
  const sourceRows =
    sourceVersionIds.length === 0
      ? []
      : await db
          .select({
            documentId: documents.id,
            filename: documents.filename,
            redactionStatus: documents.redactionStatus,
            versionId: documentVersions.id,
            versionNumber: documentVersions.versionNumber,
            malwareStatus: documentVersions.malwareStatus,
            quarantineStatus: documentVersions.quarantineStatus,
            canonicalText: documentVersionSnapshots.canonicalText,
            canonicalTextSha256: documentVersionSnapshots.canonicalTextSha256,
            structuredSnapshot: documentVersionSnapshots.structuredSnapshot,
            structuredSnapshotSha256:
              documentVersionSnapshots.structuredSnapshotSha256,
            capturedRedactionStatus:
              documentVersionSnapshots.capturedRedactionStatus,
            snapshotStatus: documentVersionSnapshots.status,
            capturedAt: documentVersionSnapshots.createdAt,
          })
          .from(documentVersions)
          .innerJoin(documents, eq(documents.id, documentVersions.documentId))
          .innerJoin(
            documentVersionSnapshots,
            eq(documentVersionSnapshots.documentVersionId, documentVersions.id),
          )
          .where(
            and(
              eq(documentVersions.organisationId, input.scope.organisationId),
              eq(documents.organisationId, input.scope.organisationId),
              eq(documents.projectId, input.projectId),
              inArray(documentVersions.id, sourceVersionIds),
            ),
          );
  const sourceByVersion = new Map(
    sourceRows.map((row) => [row.versionId, row]),
  );
  const sourceDocumentIds = [
    ...new Set(sourceRows.map((row) => row.documentId)),
  ];
  const sourceVersionRows =
    sourceDocumentIds.length === 0
      ? []
      : await db
          .select({
            documentId: documentVersions.documentId,
            versionNumber: documentVersions.versionNumber,
          })
          .from(documentVersions)
          .where(
            and(
              eq(documentVersions.organisationId, input.scope.organisationId),
              inArray(documentVersions.documentId, sourceDocumentIds),
            ),
          );
  const latestVersions = new Map<string, number>();
  for (const row of sourceVersionRows) {
    latestVersions.set(
      row.documentId,
      Math.max(latestVersions.get(row.documentId) ?? 0, row.versionNumber),
    );
  }
  if (
    projectSources.some((source) => {
      const row = sourceByVersion.get(source.versionId);
      const structured = row
        ? parseVerifiedStructuredSnapshot({
            structuredSnapshot: row.structuredSnapshot,
            structuredSnapshotSha256: row.structuredSnapshotSha256,
            canonicalText: row.canonicalText,
            canonicalTextSha256: row.canonicalTextSha256,
            documentId: row.documentId,
            documentVersionId: row.versionId,
          })
        : null;
      return (
        !row ||
        !structured ||
        structured.sourceId !== source.sourceId ||
        structured.sourceKind !== source.kind ||
        structured.authority !== source.authority ||
        structured.origin !== source.origin ||
        row.filename !== source.title ||
        row.canonicalText !== source.content ||
        row.canonicalTextSha256 !== source.contentSha256 ||
        source.capturedAt !== row.capturedAt.toISOString() ||
        row.snapshotStatus !== "verified" ||
        row.malwareStatus !== "clean" ||
        row.quarantineStatus !== "cleared" ||
        row.capturedRedactionStatus !== row.redactionStatus ||
        !eligibleRedactionStatus(row.capturedRedactionStatus) ||
        latestVersions.get(row.documentId) !== row.versionNumber ||
        source.authority !== "authoritative"
      );
    })
  ) {
    throw new DeliveryStudioError(
      "review_required",
      "Every portal-rule source must exactly match a current verified project snapshot.",
    );
  }

  const finalReview = rehearsal.rehearsalReview?.review;
  const suppliedReviews = [
    ...rehearsal.fields.map((field) => field.review),
    ...rehearsal.files.map((file) => file.review),
    ...rehearsal.mappings.map((mapping) => mapping.review),
    ...(finalReview ? [finalReview] : []),
  ];
  if (
    suppliedReviews.some(
      (review) =>
        review.state !== "unreviewed" &&
        review.reviewerId !== input.scope.actorUserId,
    ) ||
    (input.derived.rehearsalResult.status === "rehearsal_ready" &&
      (!finalReview ||
        finalReview.state !== "accepted" ||
        finalReview.reviewerId !== input.scope.actorUserId))
  ) {
    throw new DeliveryStudioError(
      "review_required",
      "The final rehearsal review must be accepted by the current named operator.",
    );
  }
  return { objectType: "package_version", objectId: version.id };
}

async function applyAction(input: DeliveryStudioMutationInput) {
  switch (input.data.action) {
    case "save_response":
      return saveResponse(input, input.data);
    case "review_response_claim":
      return reviewResponseClaim(input, input.data);
    case "start_red_team":
      return startRedTeam(input, input.data);
    case "resolve_red_team_finding":
      return resolveFinding(input, input.data);
    case "approve_red_team":
      return approveRedTeam(input, input.data);
    case "assemble_package":
      return assemblePackage(input);
    case "rehearse_submission":
      return rehearseSubmission(input, input.data);
  }
}

function responseReviewPayload(
  input: DeliveryStudioMutationInput,
  requestDigest: string,
  newVersion: number,
  sourceSnapshotHash: string,
) {
  const result = input.derived.rehearsalResult;
  return {
    schema: RECEIPT_SCHEMA,
    requestDigest,
    action: input.data.action,
    projectVersion: newVersion,
    sourceSnapshotHash,
    ...(input.data.action === "rehearse_submission"
      ? {
          packageVersionId: input.data.packageVersionId,
          result,
        }
      : {}),
    ...(input.data.action === "review_response_claim"
      ? {
          decision: input.data.decision,
          note: input.data.note,
        }
      : {}),
    ...(input.data.action === "approve_red_team"
      ? { attestation: input.data.attestation.trim() }
      : {}),
  };
}

async function mutate(
  input: DeliveryStudioMutationInput,
): Promise<DeliveryStudioMutationRecord> {
  assertTenant(input.scope.organisationId);
  const receiptId = deterministicUuid(
    canonicalJson({
      organisationId: input.scope.organisationId,
      projectId: input.projectId,
      actorUserId: input.scope.actorUserId,
      idempotencyKey: input.idempotencyKey,
    }),
  );
  const requestDigest = sha256Text(
    canonicalJson({
      projectId: input.projectId,
      ifMatch: input.ifMatch,
      data: input.data,
    }),
  );
  const [prior] = await db
    .select({ findings: reviews.findings })
    .from(reviews)
    .where(
      and(
        eq(reviews.id, receiptId),
        eq(reviews.organisationId, input.scope.organisationId),
        eq(reviews.projectId, input.projectId),
      ),
    )
    .limit(1);
  if (prior) {
    const payload = receiptPayload(prior.findings);
    if (payload?.requestDigest !== requestDigest) {
      throw new DeliveryStudioError(
        "idempotency_conflict",
        "Idempotency-Key was already used for a different Delivery Studio action.",
      );
    }
    return { outcome: "replayed", receiptId };
  }

  const [project] = await db
    .select({
      id: projects.id,
      version: projects.version,
      status: projects.status,
    })
    .from(projects)
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.organisationId, input.scope.organisationId),
      ),
    )
    .for("update");
  if (!project)
    throw new DeliveryStudioError("not_found", "Project was not found.");
  // A concurrent identical request can miss the optimistic pre-check, wait on
  // this project lock, and then observe the winner's committed receipt. Replay
  // it before evaluating the now-advanced project version.
  const [lockedPrior] = await db
    .select({ findings: reviews.findings })
    .from(reviews)
    .where(
      and(
        eq(reviews.id, receiptId),
        eq(reviews.organisationId, input.scope.organisationId),
        eq(reviews.projectId, input.projectId),
      ),
    )
    .limit(1);
  if (lockedPrior) {
    const payload = receiptPayload(lockedPrior.findings);
    if (payload?.requestDigest !== requestDigest) {
      throw new DeliveryStudioError(
        "idempotency_conflict",
        "Idempotency-Key was already used for a different Delivery Studio action.",
      );
    }
    return { outcome: "replayed", receiptId };
  }
  if (TERMINAL_PROJECT_STATUSES.has(project.status)) {
    throw new DeliveryStudioError(
      "conflict",
      "Released or archived projects are immutable in Delivery Studio.",
    );
  }
  if (project.version !== input.ifMatch) {
    throw new DeliveryStudioError(
      "stale_version",
      `Project version ${project.version} does not match If-Match ${input.ifMatch}.`,
    );
  }

  let effectiveInput = input;
  if (input.data.action === "rehearse_submission") {
    const normalizedRehearsal = await normalizeRehearsalForMutation(
      input,
      input.data,
    );
    effectiveInput = {
      ...input,
      derived: {
        ...input.derived,
        normalizedRehearsal,
        rehearsalResult: buildPortalSubmissionRehearsal(normalizedRehearsal),
      },
    };
  }

  const target = await applyAction(effectiveInput);
  const [updated] = await db
    .update(projects)
    .set({
      version: sql`${projects.version} + 1`,
      updatedAt: new Date(input.occurredAt),
    })
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.organisationId, input.scope.organisationId),
        eq(projects.version, input.ifMatch),
      ),
    )
    .returning({ version: projects.version });
  if (!updated) {
    throw new DeliveryStudioError(
      "stale_version",
      "Project version changed concurrently.",
    );
  }
  const sourceSnapshotHash =
    await computeCurrentDeliveryStudioSourceSnapshotHash(
      input.scope.organisationId,
      input.projectId,
    );
  if (!sourceSnapshotHash)
    throw new DeliveryStudioError(
      "conflict",
      "Source snapshot is unavailable.",
    );
  const isRehearsal = input.data.action === "rehearse_submission";
  const [insertedReceipt] = await db
    .insert(reviews)
    .values({
      id: receiptId,
      organisationId: input.scope.organisationId,
      projectId: input.projectId,
      reviewType: isRehearsal ? REHEARSAL_RECEIPT : ACTION_RECEIPT,
      objectType: target.objectType,
      objectId: target.objectId,
      reviewerUserId: input.scope.actorUserId,
      status: isRehearsal
        ? (effectiveInput.derived.rehearsalResult?.status ?? "blocked")
        : "completed",
      findings: canonicalJson(
        responseReviewPayload(
          effectiveInput,
          requestDigest,
          updated.version,
          sourceSnapshotHash,
        ),
      ),
      sourceVersion: updated.version,
      completedAt: new Date(input.occurredAt),
      createdAt: new Date(input.occurredAt),
      updatedAt: new Date(input.occurredAt),
    })
    .onConflictDoNothing({ target: reviews.id })
    .returning({ id: reviews.id });
  if (!insertedReceipt) {
    throw new DeliveryStudioError(
      "idempotency_conflict",
      "A concurrent receipt conflict prevented this action from being recorded.",
    );
  }

  const auditUser = {
    id: input.scope.actorUserId,
    name: input.scope.actorName,
  } as NonNullable<AuditParams["user"]>;
  await writeAudit({
    user: auditUser,
    organisationId: input.scope.organisationId,
    projectId: input.projectId,
    eventType: `delivery_studio.${input.data.action}`,
    objectType: target.objectType,
    objectId: target.objectId,
    details: canonicalJson({
      schema: RECEIPT_SCHEMA,
      receiptId,
      expectedVersion: input.ifMatch,
      committedVersion: updated.version,
      sourceSnapshotHash,
      requestDigest,
    }),
    createdAt: new Date(input.occurredAt),
  });
  return { outcome: "recorded", receiptId };
}

function portfolioNextAction(input: {
  readonly projectStatus: string;
  readonly responseStatus: PortfolioRepositorySnapshot["projects"][number]["responseStatus"];
  readonly redTeamStatus: PortfolioRepositorySnapshot["projects"][number]["redTeamStatus"];
  readonly packageStatus: PortfolioRepositorySnapshot["projects"][number]["packageStatus"];
  readonly rehearsalStatus: PortfolioRepositorySnapshot["projects"][number]["rehearsalStatus"];
}): string {
  if (TERMINAL_PROJECT_STATUSES.has(input.projectStatus))
    return "Released pursuit is read-only";
  if (input.responseStatus === "empty")
    return "Draft the first response section";
  if (input.responseStatus !== "ready")
    return "Complete independent claim review";
  if (input.redTeamStatus !== "approved")
    return "Complete independent red-team review";
  if (input.packageStatus !== "ready") return "Assemble the current package";
  if (input.rehearsalStatus !== "rehearsal_ready")
    return "Rehearse the current package";
  return "Maintain named-human submission authority";
}

function groupPortfolioRows<T extends { readonly projectId: string }>(
  projectIds: readonly string[],
  rows: readonly T[],
): Map<string, T[]> {
  const grouped = new Map(
    projectIds.map((projectId) => [projectId, [] as T[]]),
  );
  for (const row of rows) grouped.get(row.projectId)?.push(row);
  return grouped;
}

const PORTFOLIO_CHUNK_SIZE = 25;
const PORTFOLIO_RAW_CITATION_BYTES = 32_000_000;
const PORTFOLIO_PLACEHOLDER_PATTERN =
  "\\y(TBC|TODO)\\y|\\[[[:space:]]*insert[^]]*]|<[[:space:]]*insert[^>]*>";

async function loadPortfolioSummaryChunk(
  organisationId: string,
  projectChunk: readonly {
    readonly id: string;
    readonly title: string;
    readonly status: string;
    readonly deadline: string | null;
  }[],
): Promise<PortfolioRepositorySnapshot["projects"]> {
  const projectIds = projectChunk.map(({ id }) => id);
  if (projectIds.length === 0) return [];

  const responseRows = await db
    .select({
      projectId: drafts.projectId,
      draftId: drafts.id,
      sectionKey: drafts.sectionKey,
      draftStatus: drafts.status,
      draftVersion: drafts.currentVersionNumber,
      draftVersionId: draftVersions.id,
      contentHash: draftVersions.contentHash,
      sectionHasPlaceholder: sql<boolean>`coalesce(${draftVersions.content} ~* ${PORTFOLIO_PLACEHOLDER_PATTERN}, false)`,
      claimId: draftClaims.id,
      claimKey: draftClaims.claimKey,
      claimTextSha256: sql<
        string | null
      >`case when ${draftClaims.claimText} is null then null else encode(sha256(convert_to(${draftClaims.claimText}, 'UTF8')), 'hex') end`,
      claimHasPlaceholder: sql<boolean>`coalesce(${draftClaims.claimText} ~* ${PORTFOLIO_PLACEHOLDER_PATTERN}, false)`,
      claimKind: draftClaims.claimKind,
      groundingStatus: draftClaims.groundingStatus,
      reviewerUserId: draftClaims.reviewerUserId,
      evidenceId: claimEvidenceLinks.id,
      documentVersionId: claimEvidenceLinks.documentVersionId,
      evidenceHash: claimEvidenceLinks.evidenceHash,
      evidenceCitationSha256: sql<
        string | null
      >`case when ${claimEvidenceLinks.evidenceCitation} is null then null else encode(sha256(convert_to(${claimEvidenceLinks.evidenceCitation}, 'UTF8')), 'hex') end`,
    })
    .from(drafts)
    .leftJoin(
      draftVersions,
      and(
        eq(draftVersions.draftId, drafts.id),
        eq(draftVersions.versionNumber, drafts.currentVersionNumber),
      ),
    )
    .leftJoin(draftClaims, eq(draftClaims.draftVersionId, draftVersions.id))
    .leftJoin(
      claimEvidenceLinks,
      eq(claimEvidenceLinks.draftClaimId, draftClaims.id),
    )
    .where(
      and(
        eq(drafts.organisationId, organisationId),
        inArray(drafts.projectId, projectIds),
      ),
    )
    .orderBy(
      asc(drafts.projectId),
      asc(drafts.sectionKey),
      asc(draftClaims.claimKey),
      asc(claimEvidenceLinks.id),
    )
    .limit(projectIds.length * 1_500 + 1);
  if (responseRows.length > projectIds.length * 1_500) {
    throw new DeliveryStudioError(
      "conflict",
      "Portfolio response summaries exceed their bounded batch projection.",
    );
  }

  const documentRows = await db
    .select({
      projectId: documents.projectId,
      documentId: documents.id,
      documentType: documents.type,
      documentStatus: documents.extractionStatus,
      redactionStatus: documents.redactionStatus,
      documentVersion: documents.version,
      documentSha256: documents.sha256,
      versionId: documentVersions.id,
      versionNumber: documentVersions.versionNumber,
      pageCount: documentVersions.pageCount,
      versionSha256: documentVersions.sha256,
      malwareStatus: documentVersions.malwareStatus,
      quarantineStatus: documentVersions.quarantineStatus,
      addendumStatus: documentVersions.addendumStatus,
      snapshotStatus: documentVersionSnapshots.status,
      canonicalTextSha256: documentVersionSnapshots.canonicalTextSha256,
      structuredSnapshotSha256:
        documentVersionSnapshots.structuredSnapshotSha256,
      capturedRedactionStatus: documentVersionSnapshots.capturedRedactionStatus,
    })
    .from(documents)
    .leftJoin(documentVersions, eq(documentVersions.documentId, documents.id))
    .leftJoin(
      documentVersionSnapshots,
      eq(documentVersionSnapshots.documentVersionId, documentVersions.id),
    )
    .where(
      and(
        eq(documents.organisationId, organisationId),
        inArray(documents.projectId, projectIds),
      ),
    )
    .orderBy(
      asc(documents.projectId),
      asc(documents.id),
      asc(documentVersions.versionNumber),
    )
    .limit(projectIds.length * 2_000 + 1);
  if (documentRows.length > projectIds.length * 2_000) {
    throw new DeliveryStudioError(
      "conflict",
      "Portfolio document summaries exceed their bounded batch projection.",
    );
  }

  const requirementRows = await db
    .select({
      projectId: requirements.projectId,
      id: requirements.id,
      sourceDocId: requirements.sourceDocId,
      pageRef: requirements.pageRef,
      clauseRef: requirements.clauseRef,
      textSha256: sql<string>`encode(sha256(convert_to(${requirements.text}, 'UTF8')), 'hex')`,
      category: requirements.category,
      expectedEvidenceSha256: sql<
        string | null
      >`case when ${requirements.expectedEvidence} is null then null else encode(sha256(convert_to(${requirements.expectedEvidence}, 'UTF8')), 'hex') end`,
      isMandatory: requirements.isMandatory,
      reviewStatus: requirements.reviewStatus,
      version: requirements.version,
    })
    .from(requirements)
    .where(
      and(
        eq(requirements.organisationId, organisationId),
        inArray(requirements.projectId, projectIds),
      ),
    )
    .orderBy(asc(requirements.projectId), asc(requirements.id))
    .limit(projectIds.length * 2_000 + 1);
  if (requirementRows.length > projectIds.length * 2_000) {
    throw new DeliveryStudioError(
      "conflict",
      "Portfolio requirement summaries exceed their bounded batch projection.",
    );
  }

  const evidenceRows = await db
    .select({
      projectId: evidenceItems.projectId,
      id: evidenceItems.id,
      requirementId: evidenceItems.requirementId,
      documentId: evidenceItems.documentId,
      evidenceStatus: evidenceItems.evidenceStatus,
      excerptSha256: sql<
        string | null
      >`case when ${evidenceItems.excerpt} is null then null else encode(sha256(convert_to(${evidenceItems.excerpt}, 'UTF8')), 'hex') end`,
      notesSha256: sql<
        string | null
      >`case when ${evidenceItems.notes} is null then null else encode(sha256(convert_to(${evidenceItems.notes}, 'UTF8')), 'hex') end`,
      suggested: evidenceItems.suggested,
      confirmedBy: evidenceItems.confirmedBy,
      version: evidenceItems.version,
    })
    .from(evidenceItems)
    .where(
      and(
        eq(evidenceItems.organisationId, organisationId),
        inArray(evidenceItems.projectId, projectIds),
      ),
    )
    .orderBy(asc(evidenceItems.projectId), asc(evidenceItems.id))
    .limit(projectIds.length * 4_000 + 1);
  if (evidenceRows.length > projectIds.length * 4_000) {
    throw new DeliveryStudioError(
      "conflict",
      "Portfolio evidence summaries exceed their bounded batch projection.",
    );
  }

  const responseByProject = groupPortfolioRows(projectIds, responseRows);
  const documentsByProject = groupPortfolioRows(projectIds, documentRows);
  const requirementsByProject = groupPortfolioRows(projectIds, requirementRows);
  const evidenceByProject = groupPortfolioRows(projectIds, evidenceRows);
  for (const projectId of projectIds) {
    const response = responseByProject.get(projectId) ?? [];
    const sectionCount = new Set(response.map(({ draftId }) => draftId)).size;
    const claimCount = new Set(
      response.flatMap(({ claimId }) => (claimId ? [claimId] : [])),
    ).size;
    const citationCount = new Set(
      response.flatMap(({ evidenceId }) => (evidenceId ? [evidenceId] : [])),
    ).size;
    if (
      sectionCount > 500 ||
      claimCount > 500 ||
      citationCount > 500 ||
      (documentsByProject.get(projectId)?.length ?? 0) > 2_000 ||
      (requirementsByProject.get(projectId)?.length ?? 0) > 2_000 ||
      (evidenceByProject.get(projectId)?.length ?? 0) > 4_000
    ) {
      throw new DeliveryStudioError(
        "conflict",
        "A portfolio project exceeds its bounded source summary.",
      );
    }
  }

  const citedLinkIds = [
    ...new Set(
      responseRows.flatMap(({ evidenceId }) =>
        evidenceId ? [evidenceId] : [],
      ),
    ),
  ];
  const citedVersionIds = [
    ...new Set(
      responseRows.flatMap(({ documentVersionId }) =>
        documentVersionId ? [documentVersionId] : [],
      ),
    ),
  ];
  const [citationBytes] =
    citedLinkIds.length === 0
      ? [{ total: 0 }]
      : await db
          .select({
            total: sql<number>`coalesce(sum(octet_length(${claimEvidenceLinks.evidenceCitation})), 0)`,
          })
          .from(claimEvidenceLinks)
          .where(
            and(
              eq(claimEvidenceLinks.organisationId, organisationId),
              inArray(claimEvidenceLinks.id, citedLinkIds),
            ),
          );
  const [sourceBytes] =
    citedVersionIds.length === 0
      ? [{ total: 0 }]
      : await db
          .select({
            total: sql<number>`coalesce(sum(octet_length(${documentVersionSnapshots.canonicalText}) + coalesce(octet_length(${documentVersionSnapshots.structuredSnapshot}), 0)), 0)`,
          })
          .from(documentVersionSnapshots)
          .where(
            and(
              eq(documentVersionSnapshots.organisationId, organisationId),
              inArray(
                documentVersionSnapshots.documentVersionId,
                citedVersionIds,
              ),
            ),
          );
  if (
    Number(citationBytes?.total ?? 0) + Number(sourceBytes?.total ?? 0) >
    PORTFOLIO_RAW_CITATION_BYTES
  ) {
    throw new DeliveryStudioError(
      "conflict",
      "Portfolio active-citation material exceeds the bounded 32 MB batch budget.",
    );
  }

  const citationRows =
    citedLinkIds.length === 0
      ? []
      : await db
          .select({
            id: claimEvidenceLinks.id,
            evidenceCitation: claimEvidenceLinks.evidenceCitation,
          })
          .from(claimEvidenceLinks)
          .where(
            and(
              eq(claimEvidenceLinks.organisationId, organisationId),
              inArray(claimEvidenceLinks.id, citedLinkIds),
            ),
          )
          .limit(citedLinkIds.length + 1);
  const sourceRows =
    citedVersionIds.length === 0
      ? []
      : await db
          .select({
            projectId: documents.projectId,
            documentId: documents.id,
            documentType: documents.type,
            redactionStatus: documents.redactionStatus,
            documentVersionId: documentVersions.id,
            versionNumber: documentVersions.versionNumber,
            pageCount: documentVersions.pageCount,
            versionSha256: documentVersions.sha256,
            malwareStatus: documentVersions.malwareStatus,
            quarantineStatus: documentVersions.quarantineStatus,
            snapshotVersionSha256:
              documentVersionSnapshots.documentVersionSha256,
            snapshotStatus: documentVersionSnapshots.status,
            canonicalText: documentVersionSnapshots.canonicalText,
            canonicalTextSha256: documentVersionSnapshots.canonicalTextSha256,
            structuredSnapshot: documentVersionSnapshots.structuredSnapshot,
            structuredSnapshotSha256:
              documentVersionSnapshots.structuredSnapshotSha256,
            capturedRedactionStatus:
              documentVersionSnapshots.capturedRedactionStatus,
          })
          .from(documentVersions)
          .innerJoin(documents, eq(documents.id, documentVersions.documentId))
          .innerJoin(
            documentVersionSnapshots,
            eq(documentVersionSnapshots.documentVersionId, documentVersions.id),
          )
          .where(
            and(
              eq(documentVersions.organisationId, organisationId),
              eq(documents.organisationId, organisationId),
              inArray(documents.projectId, projectIds),
              inArray(documentVersions.id, citedVersionIds),
            ),
          )
          .limit(citedVersionIds.length + 1);
  if (
    citationRows.length > citedLinkIds.length ||
    sourceRows.length > citedVersionIds.length
  ) {
    throw new DeliveryStudioError(
      "conflict",
      "Portfolio citation identity is not unique.",
    );
  }
  const citationById = new Map(
    citationRows.map((row) => [row.id, receiptPayload(row.evidenceCitation)]),
  );
  const sourceByVersion = new Map(
    sourceRows.map((row) => [row.documentVersionId, row]),
  );
  const latestVersionByDocument = new Map<string, number>();
  for (const row of documentRows) {
    if (row.versionNumber === null) continue;
    latestVersionByDocument.set(
      row.documentId,
      Math.max(
        latestVersionByDocument.get(row.documentId) ?? 0,
        row.versionNumber,
      ),
    );
  }
  const activeEvidenceIds = new Set<string>();
  for (const row of responseRows) {
    if (!row.evidenceId || !row.documentVersionId || !row.evidenceHash)
      continue;
    const source = sourceByVersion.get(row.documentVersionId);
    const citation = citationById.get(row.evidenceId);
    if (!source || !citation) continue;
    const boundSpan =
      citation.documentId === source.documentId &&
      citation.documentVersionId === source.documentVersionId &&
      Number.isSafeInteger(citation.pageNumber) &&
      typeof citation.quote === "string"
        ? bindCitationToVerifiedDocumentSpan({
            documentType: source.documentType,
            pageCount: source.pageCount,
            structuredSnapshot: source.structuredSnapshot,
            structuredSnapshotSha256: source.structuredSnapshotSha256,
            canonicalText: source.canonicalText,
            canonicalTextSha256: source.canonicalTextSha256,
            documentId: source.documentId,
            documentVersionId: source.documentVersionId,
            citation: {
              pageNumber: citation.pageNumber as number,
              quote: citation.quote,
              ...(Number.isSafeInteger(citation.startOffset)
                ? { startOffset: citation.startOffset as number }
                : {}),
              ...(Number.isSafeInteger(citation.endOffset)
                ? { endOffset: citation.endOffset as number }
                : {}),
            },
          })
        : null;
    if (
      source.projectId === row.projectId &&
      row.evidenceHash === source.versionSha256 &&
      source.snapshotVersionSha256 === source.versionSha256 &&
      source.malwareStatus === "clean" &&
      source.quarantineStatus === "cleared" &&
      source.snapshotStatus === "verified" &&
      source.capturedRedactionStatus === source.redactionStatus &&
      eligibleRedactionStatus(source.capturedRedactionStatus) &&
      latestVersionByDocument.get(source.documentId) === source.versionNumber &&
      boundSpan !== null
    ) {
      activeEvidenceIds.add(row.evidenceId);
    }
  }

  const latestRuns = await db
    .selectDistinctOn([redTeamRuns.projectId], {
      projectId: redTeamRuns.projectId,
      id: redTeamRuns.id,
      status: redTeamRuns.status,
      sourceSnapshotHash: redTeamRuns.sourceSnapshotHash,
      initiatedByUserId: redTeamRuns.initiatedByUserId,
      approvedByUserId: redTeamRuns.approvedByUserId,
      approvedAt: redTeamRuns.approvedAt,
    })
    .from(redTeamRuns)
    .where(
      and(
        eq(redTeamRuns.organisationId, organisationId),
        inArray(redTeamRuns.projectId, projectIds),
      ),
    )
    .orderBy(
      asc(redTeamRuns.projectId),
      desc(redTeamRuns.createdAt),
      desc(redTeamRuns.id),
    );
  const runIds = latestRuns.map(({ id }) => id);
  const findingCounts =
    runIds.length === 0
      ? []
      : await db
          .select({
            runId: redTeamFindings.redTeamRunId,
            total: count(),
            open: sql<number>`count(*) filter (where ${redTeamFindings.status} <> 'resolved')`,
          })
          .from(redTeamFindings)
          .where(
            and(
              eq(redTeamFindings.organisationId, organisationId),
              inArray(redTeamFindings.redTeamRunId, runIds),
            ),
          )
          .groupBy(redTeamFindings.redTeamRunId);
  if (findingCounts.some(({ total }) => Number(total) > 500)) {
    throw new DeliveryStudioError(
      "conflict",
      "Portfolio red-team findings exceed the per-project bound.",
    );
  }
  const runByProject = new Map(latestRuns.map((row) => [row.projectId, row]));
  const findingsByRun = new Map(
    findingCounts.map((row) => [
      row.runId,
      { total: Number(row.total), open: Number(row.open) },
    ]),
  );
  const approvalReceiptRows =
    runIds.length === 0
      ? []
      : await db
          .select({
            runId: reviews.objectId,
            reviewerUserId: reviews.reviewerUserId,
            completedAt: reviews.completedAt,
            findings: reviews.findings,
          })
          .from(reviews)
          .where(
            and(
              eq(reviews.organisationId, organisationId),
              eq(reviews.reviewType, ACTION_RECEIPT),
              eq(reviews.objectType, "red_team_run"),
              inArray(reviews.objectId, runIds),
            ),
          )
          .orderBy(
            asc(reviews.objectId),
            desc(reviews.createdAt),
            desc(reviews.id),
          )
          .limit(runIds.length * 500 + 1);
  if (approvalReceiptRows.length > runIds.length * 500) {
    throw new DeliveryStudioError(
      "conflict",
      "Portfolio red-team approval receipts exceed the per-project bound.",
    );
  }
  const approvalReceiptsByRun = new Map<
    string,
    RedTeamApprovalReceiptCandidate[]
  >();
  for (const row of approvalReceiptRows) {
    const candidates = approvalReceiptsByRun.get(row.runId) ?? [];
    candidates.push(row);
    approvalReceiptsByRun.set(row.runId, candidates);
  }

  const latestPackages = await db
    .selectDistinctOn([packages.projectId], {
      projectId: packages.projectId,
      id: packages.id,
      status: packages.status,
      currentVersionNumber: packages.currentVersionNumber,
    })
    .from(packages)
    .where(
      and(
        eq(packages.organisationId, organisationId),
        eq(packages.packageType, "submission"),
        inArray(packages.projectId, projectIds),
      ),
    )
    .orderBy(
      asc(packages.projectId),
      desc(packages.updatedAt),
      desc(packages.id),
    );
  const packageIds = latestPackages.map(({ id }) => id);
  const currentPackageVersions =
    packageIds.length === 0
      ? []
      : await db
          .select({
            packageId: packageVersions.packageId,
            id: packageVersions.id,
            sourceSnapshotHash: packageVersions.sourceSnapshotHash,
          })
          .from(packageVersions)
          .innerJoin(
            packages,
            and(
              eq(packages.id, packageVersions.packageId),
              eq(packages.currentVersionNumber, packageVersions.versionNumber),
            ),
          )
          .where(
            and(
              eq(packageVersions.organisationId, organisationId),
              inArray(packageVersions.packageId, packageIds),
            ),
          );
  const packageVersionIds = currentPackageVersions.map(({ id }) => id);
  const manifestCounts =
    packageVersionIds.length === 0
      ? []
      : await db
          .select({
            packageVersionId: packageManifestItems.packageVersionId,
            total: count(),
          })
          .from(packageManifestItems)
          .where(
            and(
              eq(packageManifestItems.organisationId, organisationId),
              inArray(packageManifestItems.packageVersionId, packageVersionIds),
            ),
          )
          .groupBy(packageManifestItems.packageVersionId);
  if (manifestCounts.some(({ total }) => Number(total) > 1_000)) {
    throw new DeliveryStudioError(
      "conflict",
      "Portfolio package manifests exceed the per-project bound.",
    );
  }
  const packageByProject = new Map(
    latestPackages.map((row) => [row.projectId, row]),
  );
  const versionByPackage = new Map(
    currentPackageVersions.map((row) => [row.packageId, row]),
  );
  const manifestCountByVersion = new Map(
    manifestCounts.map((row) => [row.packageVersionId, Number(row.total)]),
  );

  const latestRehearsals = await db
    .selectDistinctOn([reviews.projectId], {
      projectId: reviews.projectId,
      objectId: reviews.objectId,
      findings: reviews.findings,
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.organisationId, organisationId),
        eq(reviews.reviewType, REHEARSAL_RECEIPT),
        inArray(reviews.projectId, projectIds),
      ),
    )
    .orderBy(asc(reviews.projectId), desc(reviews.createdAt), desc(reviews.id));
  const rehearsalByProject = new Map(
    latestRehearsals.map((row) => [row.projectId, row]),
  );

  return projectChunk.map((project) => {
    const response = responseByProject.get(project.id) ?? [];
    const projectDocuments = documentsByProject.get(project.id) ?? [];
    const projectRequirements = requirementsByProject.get(project.id) ?? [];
    const projectEvidence = evidenceByProject.get(project.id) ?? [];
    const sourceSnapshotHash = sha256Text(
      canonicalJson({
        schema: "valo.delivery-studio-source/v1",
        organisationId,
        projectId: project.id,
        sources: {
          response: response.map((row) => ({
            sectionKey: row.sectionKey,
            draftStatus: row.draftStatus,
            draftVersion: row.draftVersion,
            draftVersionId: row.draftVersionId,
            contentHash: row.contentHash,
            claimId: row.claimId,
            claimKey: row.claimKey,
            claimTextSha256: row.claimTextSha256,
            claimKind: row.claimKind,
            groundingStatus: row.groundingStatus,
            reviewerUserId: row.reviewerUserId,
            evidenceId: row.evidenceId,
            documentVersionId: row.documentVersionId,
            evidenceHash: row.evidenceHash,
            evidenceCitationSha256: row.evidenceCitationSha256,
          })),
          documents: projectDocuments.map(
            ({ projectId: _projectId, ...row }) => row,
          ),
          requirements: projectRequirements.map(
            ({ projectId: _projectId, ...row }) => row,
          ),
          evidence: projectEvidence.map(
            ({ projectId: _projectId, ...row }) => row,
          ),
        },
      }),
    );
    const claims = new Map<
      string,
      { kind: string | null; groundingStatus: string | null; active: boolean }
    >();
    const placeholderSections = new Set<string>();
    for (const row of response) {
      if (row.sectionHasPlaceholder || row.claimHasPlaceholder) {
        placeholderSections.add(row.draftId);
      }
      if (!row.claimId) continue;
      const claim = claims.get(row.claimId) ?? {
        kind: row.claimKind,
        groundingStatus: row.groundingStatus,
        active: false,
      };
      if (row.evidenceId && activeEvidenceIds.has(row.evidenceId)) {
        claim.active = true;
      }
      claims.set(row.claimId, claim);
    }
    const sectionCount = new Set(response.map(({ draftId }) => draftId)).size;
    const groundedClaimCount = [...claims.values()].filter(
      (claim) =>
        claim.groundingStatus === "approved" &&
        (!new Set(["factual", "instructional"]).has(claim.kind ?? "") ||
          claim.active),
    ).length;
    const responseStatus =
      sectionCount === 0
        ? ("empty" as const)
        : claims.size === 0 || placeholderSections.size > 0
          ? ("draft" as const)
          : groundedClaimCount === claims.size
            ? ("ready" as const)
            : ("review_required" as const);

    const run = runByProject.get(project.id);
    const openFindings = run ? (findingsByRun.get(run.id)?.open ?? 0) : 0;
    const approvalAttestation = run
      ? redTeamApprovalAttestationFromReceipts(
          approvalReceiptsByRun.get(run.id) ?? [],
          run.approvedByUserId,
          run.approvedAt,
        )
      : null;
    const redTeamStatus = !run
      ? ("not_started" as const)
      : run.sourceSnapshotHash !== sourceSnapshotHash
        ? ("stale" as const)
        : isAttestedRedTeamApproval({
              runStatus: run.status,
              sourceSnapshotMatches:
                run.sourceSnapshotHash === sourceSnapshotHash,
              initiatedByUserId: run.initiatedByUserId,
              approvedByUserId: run.approvedByUserId,
              approvedAt: run.approvedAt,
              approvalAttestation,
              openFindingCount: openFindings,
            })
          ? ("approved" as const)
          : openFindings > 0
            ? ("findings_open" as const)
            : run.status === "running"
              ? ("running" as const)
              : ("ready_for_approval" as const);

    const pkg = packageByProject.get(project.id);
    const version = pkg ? versionByPackage.get(pkg.id) : undefined;
    const packageStatus =
      !pkg || pkg.currentVersionNumber < 1
        ? ("not_started" as const)
        : !version
          ? ("draft" as const)
          : version.sourceSnapshotHash !== sourceSnapshotHash
            ? ("stale" as const)
            : (manifestCountByVersion.get(version.id) ?? 0) > 0 &&
                pkg.status === "assembled"
              ? ("ready" as const)
              : ("draft" as const);

    const rehearsal = rehearsalByProject.get(project.id);
    let rehearsalStatus:
      | "not_started"
      | "blocked"
      | "incomplete"
      | "review_required"
      | "rehearsal_ready"
      | "stale" = "not_started";
    if (rehearsal) {
      const payload = receiptPayload(rehearsal.findings);
      const result = payload?.result;
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        rehearsalStatus = "blocked";
      } else {
        const status = (result as Record<string, unknown>).status;
        const validStatus =
          status === "blocked" ||
          status === "incomplete" ||
          status === "review_required" ||
          status === "rehearsal_ready"
            ? status
            : "blocked";
        const receiptPackageVersionId = String(
          payload?.packageVersionId ?? rehearsal.objectId,
        );
        rehearsalStatus =
          payload?.sourceSnapshotHash !== sourceSnapshotHash ||
          version?.id !== receiptPackageVersionId
            ? "stale"
            : validStatus;
      }
    }
    const statuses = {
      responseStatus,
      redTeamStatus,
      packageStatus,
      rehearsalStatus,
    };
    return {
      id: project.id,
      title: project.title,
      status: project.status,
      deadline: project.deadline,
      ...statuses,
      nextAction: portfolioNextAction({
        projectStatus: project.status,
        ...statuses,
      }),
    };
  });
}

async function portfolio(
  organisationId: string,
): Promise<PortfolioRepositorySnapshot> {
  assertTenant(organisationId);
  const projectRows = await db
    .select({
      id: projects.id,
      title: projects.tenderTitle,
      status: projects.status,
      deadline: projects.deadline,
    })
    .from(projects)
    .where(eq(projects.organisationId, organisationId))
    .orderBy(
      asc(projects.deadline),
      asc(projects.tenderTitle),
      asc(projects.id),
    )
    .limit(501);
  if (projectRows.length > 500) {
    throw new DeliveryStudioError(
      "conflict",
      "Portfolio intelligence is bounded to 500 current-tenant projects.",
    );
  }
  const summaries: PortfolioRepositorySnapshot["projects"][number][] = [];
  for (
    let index = 0;
    index < projectRows.length;
    index += PORTFOLIO_CHUNK_SIZE
  ) {
    summaries.push(
      ...(await loadPortfolioSummaryChunk(
        organisationId,
        projectRows.slice(index, index + PORTFOLIO_CHUNK_SIZE),
      )),
    );
  }
  const [confirmed] = await db
    .select({ total: count() })
    .from(outcomes)
    .where(
      and(
        eq(outcomes.organisationId, organisationId),
        eq(outcomes.clientConfirmed, true),
      ),
    );
  return {
    totals: {
      projectCount: summaries.length,
      responseReadyCount: summaries.filter(
        (summary) => summary.responseStatus === "ready",
      ).length,
      redTeamApprovedCount: summaries.filter(
        (summary) => summary.redTeamStatus === "approved",
      ).length,
      packageReadyCount: summaries.filter(
        (summary) => summary.packageStatus === "ready",
      ).length,
      rehearsalReadyCount: summaries.filter(
        (summary) => summary.rehearsalStatus === "rehearsal_ready",
      ).length,
      confirmedOutcomeCount: confirmed?.total ?? 0,
    },
    projects: summaries,
  };
}

export class DrizzleDeliveryStudioRepository implements DeliveryStudioRepository {
  async load(
    scope: Pick<DeliveryStudioScope, "organisationId">,
    projectId: string,
  ): Promise<DeliveryStudioRepositorySnapshot | null> {
    return loadSnapshot(scope.organisationId, projectId);
  }

  async prepareResponseValidation(
    scope: Pick<DeliveryStudioScope, "organisationId">,
    projectId: string,
    action: SaveResponseAction,
  ) {
    return prepareResponseValidation(scope.organisationId, projectId, action);
  }

  async mutate(input: DeliveryStudioMutationInput) {
    return mutate(input);
  }

  async portfolio(
    scope: Pick<DeliveryStudioScope, "organisationId">,
  ): Promise<PortfolioRepositorySnapshot> {
    return portfolio(scope.organisationId);
  }
}

export function createDrizzleDeliveryStudioRepository(): DeliveryStudioRepository {
  return new DrizzleDeliveryStudioRepository();
}
