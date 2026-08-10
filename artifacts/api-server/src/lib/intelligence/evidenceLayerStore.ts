import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  documents,
  documentVersions,
  organisationMemberships,
  organisations,
  projects,
  requirementCitations,
  requirements,
  roleGrants,
  users,
} from "@workspace/db";
import {
  hasPermission,
  isActiveAccessWindow,
  isOrganisationRole,
  isRoleAllowedForOrganisation,
  type OrganisationType,
} from "../permissions";
import {
  buildBlockedEvidenceLayer,
  buildEvidenceLayer,
  evidenceFieldLengthExceedsBounds,
  EVIDENCE_LAYER_BOUNDS,
  type EvidenceCorpusMode,
  type EvidenceLayerActor,
  type EvidenceLayerBlockerCode,
  type EvidenceLayerResult,
} from "./evidenceLayer";

export const EVIDENCE_LAYER_STORE_BOUNDS = Object.freeze({
  maxVerifierAuthorityRows: 16_384,
  maxAuthorityCodeUnitsPerRow: 4_096,
  maxAuthorityBytesPerRow: 8_192,
  maxTotalAuthorityBytes: 8_000_000,
});

export interface EvidenceVerifierAuthorityRow {
  userId: string;
  userStatus: string;
  membershipStatus: string;
  membershipStartsAt: Date | null;
  membershipExpiresAt: Date | null;
  delegatedByMembershipId: string | null;
  role: string;
  roleStartsAt: Date | null;
  roleExpiresAt: Date | null;
  roleRevokedAt: Date | null;
}

/**
 * One shared current-authority rule for deterministic snapshots and evidence
 * search. Historical authority is deliberately not inferred from this result.
 */
export function currentEvidenceApproverIds(input: {
  rows: readonly EvidenceVerifierAuthorityRow[];
  organisationType: OrganisationType;
  now: Date;
}): Set<string> {
  return new Set(
    input.rows.flatMap((row) => {
      const role = isOrganisationRole(row.role) ? row.role : null;
      const authorised =
        row.userStatus === "active" &&
        row.delegatedByMembershipId === null &&
        isActiveAccessWindow(
          {
            status: row.membershipStatus,
            startsAt: row.membershipStartsAt,
            expiresAt: row.membershipExpiresAt,
          },
          input.now,
        ) &&
        isActiveAccessWindow(
          {
            status: row.roleRevokedAt ? "revoked" : "active",
            startsAt: row.roleStartsAt,
            expiresAt: row.roleExpiresAt,
            revokedAt: row.roleRevokedAt,
          },
          input.now,
        ) &&
        role !== null &&
        isRoleAllowedForOrganisation(role, input.organisationType) &&
        hasPermission([role], "evidence:approve");
      return authorised ? [row.userId] : [];
    }),
  );
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function finiteLength(value: number | string | null): number | null {
  if (value === null) return 0;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
}

function exceedsTextPolicy(
  rows: ReadonlyArray<{
    codeUnits: number | string | null;
    bytes: number | string | null;
  }>,
  individualCodeUnits: number,
  individualBytes: number,
  totalBytes: number,
): boolean {
  let total = 0;
  for (const row of rows) {
    const codeUnits = finiteLength(row.codeUnits);
    const bytes = finiteLength(row.bytes);
    if (
      codeUnits === null ||
      bytes === null ||
      codeUnits > individualCodeUnits ||
      bytes > individualBytes
    ) {
      return true;
    }
    total += bytes;
    if (!Number.isSafeInteger(total) || total > totalBytes) return true;
  }
  return false;
}

function blocked(
  input: {
    organisationId: string;
    projectId: string;
    requestedMode: EvidenceCorpusMode;
    now?: Date;
  },
  actor: EvidenceLayerActor,
  path: string,
  message: string,
  code: EvidenceLayerBlockerCode = "input_bound_exceeded",
): { layer: EvidenceLayerResult; actor: EvidenceLayerActor } {
  return {
    actor,
    layer: buildBlockedEvidenceLayer({
      organisationId: input.organisationId,
      projectId: input.projectId,
      requestedMode: input.requestedMode,
      evaluatedAt:
        input.now && Number.isFinite(input.now.getTime())
          ? input.now.toISOString()
          : new Date().toISOString(),
      actor,
      code,
      path,
      message,
    }),
  };
}

/**
 * Loads an evidence projection in two phases. Metadata and SQL-computed text
 * lengths are bounded first; document content, requirement text and citation
 * snippets are fetched only after every individual and aggregate length gate
 * passes. This prevents oversized tenant data from being materialised merely
 * to discover that the pure layer would reject it.
 */
export async function loadProjectEvidenceLayer(input: {
  organisationId: string;
  projectId: string;
  actorUserId: string;
  permissions: readonly string[];
  requestedMode?: EvidenceCorpusMode;
  now?: Date;
}): Promise<{ layer: EvidenceLayerResult; actor: EvidenceLayerActor } | null> {
  const requestedMode = input.requestedMode ?? "verified_spans";
  const now = input.now ?? new Date();
  const [project] = await db
    .select({
      id: projects.id,
      organisationId: projects.organisationId,
      organisationType: organisations.type,
      organisationStatus: organisations.status,
    })
    .from(projects)
    .innerJoin(organisations, eq(projects.organisationId, organisations.id))
    .where(eq(projects.id, input.projectId))
    .limit(1);
  if (!project) return null;

  const emptyActor: EvidenceLayerActor = {
    userId: input.actorUserId,
    organisationId: input.organisationId,
    projectId: input.projectId,
    permissions: [...input.permissions],
    visibleDocumentIds: [],
  };
  if (
    project.organisationId !== input.organisationId ||
    project.organisationStatus !== "active"
  ) {
    return blocked(
      { ...input, requestedMode },
      emptyActor,
      "project.organisationId",
      "The repository refused a project outside the active tenant scope.",
      "project_scope_mismatch",
    );
  }

  const [documentBounds, requirementBounds] = await Promise.all([
    db
      .select({
        id: documents.id,
        filenameCodeUnits: sql<number>`coalesce(char_length(${documents.filename}), 0)`,
        filenameBytes: sql<number>`coalesce(octet_length(${documents.filename}), 0)`,
        codeUnits: sql<number>`greatest(
          coalesce(char_length(${documents.filename}), 0),
          coalesce(char_length(${documents.type}), 0),
          coalesce(char_length(${documents.redactionStatus}), 0),
          coalesce(char_length(${documents.extractionStatus}), 0),
          coalesce(char_length(${documents.sha256}), 0),
          coalesce(char_length(${documents.contentText}), 0)
        )`,
        bytes: sql<number>`
          coalesce(octet_length(${documents.filename}), 0) +
          coalesce(octet_length(${documents.type}), 0) +
          coalesce(octet_length(${documents.redactionStatus}), 0) +
          coalesce(octet_length(${documents.extractionStatus}), 0) +
          coalesce(octet_length(${documents.sha256}), 0) +
          coalesce(octet_length(${documents.contentText}), 0)
        `,
      })
      .from(documents)
      .where(eq(documents.projectId, input.projectId))
      .limit(EVIDENCE_LAYER_BOUNDS.maxDocuments + 1),
    db
      .select({
        id: requirements.id,
        codeUnits: sql<number>`greatest(
          coalesce(char_length(${requirements.text}), 0),
          coalesce(char_length(${requirements.category}), 0),
          coalesce(char_length(${requirements.pageRef}), 0),
          coalesce(char_length(${requirements.clauseRef}), 0),
          coalesce(char_length(${requirements.confidence}), 0),
          coalesce(char_length(${requirements.reviewStatus}), 0),
          coalesce(char_length(${requirements.reviewerNotes}), 0)
        )`,
        bytes: sql<number>`
          coalesce(octet_length(${requirements.text}), 0) +
          coalesce(octet_length(${requirements.category}), 0) +
          coalesce(octet_length(${requirements.pageRef}), 0) +
          coalesce(octet_length(${requirements.clauseRef}), 0) +
          coalesce(octet_length(${requirements.confidence}), 0) +
          coalesce(octet_length(${requirements.reviewStatus}), 0) +
          coalesce(octet_length(${requirements.reviewerNotes}), 0)
        `,
      })
      .from(requirements)
      .where(eq(requirements.projectId, input.projectId))
      .limit(EVIDENCE_LAYER_BOUNDS.maxRequirements + 1),
  ]);

  if (documentBounds.length > EVIDENCE_LAYER_BOUNDS.maxDocuments)
    return blocked(
      { ...input, requestedMode },
      emptyActor,
      "documents",
      "The project exceeds the bounded evidence-document set.",
    );
  if (requirementBounds.length > EVIDENCE_LAYER_BOUNDS.maxRequirements)
    return blocked(
      { ...input, requestedMode },
      emptyActor,
      "requirements",
      "The project exceeds the bounded evidence-requirement set.",
    );

  const actor: EvidenceLayerActor = {
    ...emptyActor,
    visibleDocumentIds: documentBounds.map((row) => row.id),
  };
  if (
    evidenceFieldLengthExceedsBounds(
      documentBounds.map((row) => ({
        codeUnits: row.filenameCodeUnits,
        bytes: row.filenameBytes,
      })),
      EVIDENCE_LAYER_BOUNDS.maxFilenameCodeUnits,
      EVIDENCE_LAYER_BOUNDS.maxFilenameBytes,
    )
  )
    return blocked(
      { ...input, requestedMode },
      actor,
      "documents.filename",
      "A document filename exceeds the bounded evidence metadata policy.",
    );
  if (
    exceedsTextPolicy(
      documentBounds,
      EVIDENCE_LAYER_BOUNDS.maxDocumentTextCodeUnits,
      EVIDENCE_LAYER_BOUNDS.maxDocumentTextBytes,
      EVIDENCE_LAYER_BOUNDS.maxTotalDocumentTextBytes,
    )
  )
    return blocked(
      { ...input, requestedMode },
      actor,
      "documents.contentText",
      "Document text exceeds the bounded evidence-text policy.",
    );
  if (
    exceedsTextPolicy(
      requirementBounds,
      EVIDENCE_LAYER_BOUNDS.maxRequirementTextCodeUnits,
      EVIDENCE_LAYER_BOUNDS.maxRequirementTextBytes,
      EVIDENCE_LAYER_BOUNDS.maxTotalRequirementTextBytes,
    )
  )
    return blocked(
      { ...input, requestedMode },
      actor,
      "requirements.text",
      "Requirement text exceeds the bounded evidence-text policy.",
    );

  const [documentMetadata, requirementMetadata] = await Promise.all([
    documentBounds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: documents.id,
            organisationId: documents.organisationId,
            projectId: documents.projectId,
            filename: documents.filename,
            redactionStatus: documents.redactionStatus,
            extractionStatus: documents.extractionStatus,
            sha256: documents.sha256,
          })
          .from(documents)
          .where(
            and(
              eq(documents.projectId, input.projectId),
              inArray(
                documents.id,
                documentBounds.map((row) => row.id),
              ),
            ),
          )
          .limit(EVIDENCE_LAYER_BOUNDS.maxDocuments),
    requirementBounds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: requirements.id,
            organisationId: requirements.organisationId,
            projectId: requirements.projectId,
            sourceDocId: requirements.sourceDocId,
            reviewStatus: requirements.reviewStatus,
          })
          .from(requirements)
          .where(
            and(
              eq(requirements.projectId, input.projectId),
              inArray(
                requirements.id,
                requirementBounds.map((row) => row.id),
              ),
            ),
          )
          .limit(EVIDENCE_LAYER_BOUNDS.maxRequirements),
  ]);
  if (
    documentMetadata.length !== documentBounds.length ||
    requirementMetadata.length !== requirementBounds.length
  )
    return blocked(
      { ...input, requestedMode, now },
      actor,
      "repository.concurrentChange",
      "The evidence source set changed while its bounded metadata was loading.",
      "source_reference_missing",
    );

  const [versionBounds, citationBounds] = await Promise.all([
    documentMetadata.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: documentVersions.id,
            codeUnits: sql<number>`greatest(
              coalesce(char_length(${documentVersions.sha256}), 0),
              coalesce(char_length(${documentVersions.malwareStatus}), 0),
              coalesce(char_length(${documentVersions.quarantineStatus}), 0),
              coalesce(char_length(${documentVersions.addendumStatus}), 0)
            )`,
            bytes: sql<number>`
              coalesce(octet_length(${documentVersions.sha256}), 0) +
              coalesce(octet_length(${documentVersions.malwareStatus}), 0) +
              coalesce(octet_length(${documentVersions.quarantineStatus}), 0) +
              coalesce(octet_length(${documentVersions.addendumStatus}), 0)
            `,
          })
          .from(documentVersions)
          .where(
            inArray(
              documentVersions.documentId,
              documentMetadata.map((row) => row.id),
            ),
          )
          .limit(EVIDENCE_LAYER_BOUNDS.maxDocumentVersions + 1),
    requirementMetadata.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: requirementCitations.id,
            locatorCodeUnits: sql<number>`greatest(
              coalesce(char_length(${requirementCitations.paragraphRef}), 0),
              coalesce(char_length(${requirementCitations.tableRef}), 0),
              coalesce(char_length(${requirementCitations.coordinateJson}), 0)
            )`,
            locatorBytes: sql<number>`greatest(
              coalesce(octet_length(${requirementCitations.paragraphRef}), 0),
              coalesce(octet_length(${requirementCitations.tableRef}), 0),
              coalesce(octet_length(${requirementCitations.coordinateJson}), 0)
            )`,
            verifierNameCodeUnits: sql<number>`coalesce(char_length(${users.name}), 0)`,
            verifierNameBytes: sql<number>`coalesce(octet_length(${users.name}), 0)`,
            codeUnits: sql<number>`greatest(
              coalesce(char_length(${requirementCitations.paragraphRef}), 0),
              coalesce(char_length(${requirementCitations.tableRef}), 0),
              coalesce(char_length(${requirementCitations.coordinateJson}), 0),
              coalesce(char_length(${requirementCitations.sourceSnippet}), 0),
              coalesce(char_length(${requirementCitations.sourceSnippetHash}), 0),
              coalesce(char_length(${requirementCitations.verificationStatus}), 0),
              coalesce(char_length(${users.name}), 0)
            )`,
            bytes: sql<number>`
              coalesce(octet_length(${requirementCitations.paragraphRef}), 0) +
              coalesce(octet_length(${requirementCitations.tableRef}), 0) +
              coalesce(octet_length(${requirementCitations.coordinateJson}), 0) +
              coalesce(octet_length(${requirementCitations.sourceSnippet}), 0) +
              coalesce(octet_length(${requirementCitations.sourceSnippetHash}), 0) +
              coalesce(octet_length(${requirementCitations.verificationStatus}), 0) +
              coalesce(octet_length(${users.name}), 0)
            `,
          })
          .from(requirementCitations)
          .innerJoin(
            documentVersions,
            eq(requirementCitations.documentVersionId, documentVersions.id),
          )
          .innerJoin(documents, eq(documentVersions.documentId, documents.id))
          .leftJoin(users, eq(requirementCitations.verifiedByUserId, users.id))
          .where(
            and(
              inArray(
                requirementCitations.requirementId,
                requirementMetadata.map((row) => row.id),
              ),
              eq(documents.projectId, input.projectId),
            ),
          )
          .limit(EVIDENCE_LAYER_BOUNDS.maxRequirementCitations + 1),
  ]);

  if (versionBounds.length > EVIDENCE_LAYER_BOUNDS.maxDocumentVersions)
    return blocked(
      { ...input, requestedMode },
      actor,
      "documentVersions",
      "The project exceeds the bounded document-version set.",
    );
  if (citationBounds.length > EVIDENCE_LAYER_BOUNDS.maxRequirementCitations)
    return blocked(
      { ...input, requestedMode },
      actor,
      "requirementCitations",
      "The project exceeds the bounded citation set.",
    );
  if (
    exceedsTextPolicy(
      versionBounds,
      EVIDENCE_LAYER_BOUNDS.maxIdentifierCodeUnits,
      EVIDENCE_LAYER_BOUNDS.maxIdentifierBytes,
      EVIDENCE_LAYER_BOUNDS.maxTotalDocumentTextBytes,
    )
  )
    return blocked(
      { ...input, requestedMode },
      actor,
      "documentVersions.text",
      "Document-version metadata exceeds the bounded evidence policy.",
    );
  if (
    evidenceFieldLengthExceedsBounds(
      citationBounds.map((row) => ({
        codeUnits: row.locatorCodeUnits,
        bytes: row.locatorBytes,
      })),
      EVIDENCE_LAYER_BOUNDS.maxLocatorCodeUnits,
      EVIDENCE_LAYER_BOUNDS.maxLocatorBytes,
    )
  )
    return blocked(
      { ...input, requestedMode },
      actor,
      "requirementCitations.locator",
      "A citation locator exceeds the bounded evidence metadata policy.",
    );
  if (
    evidenceFieldLengthExceedsBounds(
      citationBounds.map((row) => ({
        codeUnits: row.verifierNameCodeUnits,
        bytes: row.verifierNameBytes,
      })),
      EVIDENCE_LAYER_BOUNDS.maxVerifierNameCodeUnits,
      EVIDENCE_LAYER_BOUNDS.maxVerifierNameBytes,
    )
  )
    return blocked(
      { ...input, requestedMode },
      actor,
      "requirementCitations.verifiedByName",
      "A verifier name exceeds the bounded evidence metadata policy.",
    );
  if (
    exceedsTextPolicy(
      citationBounds,
      EVIDENCE_LAYER_BOUNDS.maxSnippetCodeUnits,
      EVIDENCE_LAYER_BOUNDS.maxSnippetBytes,
      EVIDENCE_LAYER_BOUNDS.maxTotalSnippetBytes,
    )
  )
    return blocked(
      { ...input, requestedMode },
      actor,
      "requirementCitations.text",
      "Citation metadata exceeds the bounded evidence policy.",
    );

  const [versionRows, citationMetadata] = await Promise.all([
    versionBounds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: documentVersions.id,
            organisationId: documentVersions.organisationId,
            documentId: documentVersions.documentId,
            versionNumber: documentVersions.versionNumber,
            sha256: documentVersions.sha256,
            malwareStatus: documentVersions.malwareStatus,
            quarantineStatus: documentVersions.quarantineStatus,
          })
          .from(documentVersions)
          .where(
            inArray(
              documentVersions.id,
              versionBounds.map((row) => row.id),
            ),
          )
          .limit(EVIDENCE_LAYER_BOUNDS.maxDocumentVersions),
    citationBounds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: requirementCitations.id,
            organisationId: requirementCitations.organisationId,
            requirementId: requirementCitations.requirementId,
            documentVersionId: requirementCitations.documentVersionId,
            pageNumber: requirementCitations.pageNumber,
            paragraphRef: requirementCitations.paragraphRef,
            tableRef: requirementCitations.tableRef,
            coordinateJson: requirementCitations.coordinateJson,
            sourceSnippetHash: requirementCitations.sourceSnippetHash,
            verificationStatus: requirementCitations.verificationStatus,
            verifiedByUserId: requirementCitations.verifiedByUserId,
            verifiedByName: users.name,
            verifiedAt: requirementCitations.verifiedAt,
          })
          .from(requirementCitations)
          .leftJoin(users, eq(requirementCitations.verifiedByUserId, users.id))
          .where(
            inArray(
              requirementCitations.id,
              citationBounds.map((row) => row.id),
            ),
          )
          .limit(EVIDENCE_LAYER_BOUNDS.maxRequirementCitations),
  ]);
  if (
    versionRows.length !== versionBounds.length ||
    citationMetadata.length !== citationBounds.length
  )
    return blocked(
      { ...input, requestedMode, now },
      actor,
      "repository.concurrentChange",
      "The evidence source set changed while its bounded projection was loading.",
      "source_reference_missing",
    );

  const documentIdByVersionId = new Map(
    versionRows.map((row) => [row.id, row.documentId]),
  );
  const citationsPerDocument = new Map<string, number>();
  for (const citation of citationMetadata) {
    const documentId = documentIdByVersionId.get(citation.documentVersionId);
    if (!documentId) continue;
    const count = (citationsPerDocument.get(documentId) ?? 0) + 1;
    citationsPerDocument.set(documentId, count);
    if (count > EVIDENCE_LAYER_BOUNDS.maxCitationsPerDocument)
      return blocked(
        { ...input, requestedMode, now },
        actor,
        "requirementCitations.byDocument",
        "A document exceeds the bounded citation fan-out policy.",
      );
  }
  const verifierIds = [
    ...new Set(
      citationMetadata.flatMap((row) =>
        row.verifiedByUserId ? [row.verifiedByUserId] : [],
      ),
    ),
  ];
  const authorityBounds =
    verifierIds.length === 0
      ? []
      : await db
          .select({
            id: roleGrants.id,
            codeUnits: sql<number>`greatest(
              coalesce(char_length(${users.status}), 0),
              coalesce(char_length(${organisationMemberships.status}), 0),
              coalesce(char_length(${roleGrants.role}), 0)
            )`,
            bytes: sql<number>`
              coalesce(octet_length(${users.status}), 0) +
              coalesce(octet_length(${organisationMemberships.status}), 0) +
              coalesce(octet_length(${roleGrants.role}), 0)
            `,
          })
          .from(organisationMemberships)
          .innerJoin(users, eq(organisationMemberships.userId, users.id))
          .innerJoin(
            roleGrants,
            eq(roleGrants.membershipId, organisationMemberships.id),
          )
          .where(
            and(
              eq(organisationMemberships.organisationId, input.organisationId),
              inArray(organisationMemberships.userId, verifierIds),
            ),
          )
          .limit(EVIDENCE_LAYER_STORE_BOUNDS.maxVerifierAuthorityRows + 1);
  if (
    authorityBounds.length >
      EVIDENCE_LAYER_STORE_BOUNDS.maxVerifierAuthorityRows ||
    exceedsTextPolicy(
      authorityBounds,
      EVIDENCE_LAYER_STORE_BOUNDS.maxAuthorityCodeUnitsPerRow,
      EVIDENCE_LAYER_STORE_BOUNDS.maxAuthorityBytesPerRow,
      EVIDENCE_LAYER_STORE_BOUNDS.maxTotalAuthorityBytes,
    )
  )
    return blocked(
      { ...input, requestedMode },
      actor,
      "requirementCitations.verifierAuthority",
      "Verifier authority grants exceed the bounded repository projection.",
    );
  const [
    documentContentRows,
    requirementTextRows,
    citationSnippetRows,
    authorityRows,
  ] = await Promise.all([
    documentMetadata.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: documents.id, contentText: documents.contentText })
          .from(documents)
          .where(
            and(
              eq(documents.projectId, input.projectId),
              inArray(
                documents.id,
                documentMetadata.map((row) => row.id),
              ),
            ),
          )
          .limit(EVIDENCE_LAYER_BOUNDS.maxDocuments),
    requirementMetadata.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: requirements.id, text: requirements.text })
          .from(requirements)
          .where(
            and(
              eq(requirements.projectId, input.projectId),
              inArray(
                requirements.id,
                requirementMetadata.map((row) => row.id),
              ),
            ),
          )
          .limit(EVIDENCE_LAYER_BOUNDS.maxRequirements),
    citationMetadata.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: requirementCitations.id,
            sourceSnippet: requirementCitations.sourceSnippet,
          })
          .from(requirementCitations)
          .where(
            inArray(
              requirementCitations.id,
              citationMetadata.map((row) => row.id),
            ),
          )
          .limit(EVIDENCE_LAYER_BOUNDS.maxRequirementCitations),
    authorityBounds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            userId: users.id,
            userStatus: users.status,
            membershipId: organisationMemberships.id,
            membershipStatus: organisationMemberships.status,
            membershipStartsAt: organisationMemberships.accessStartsAt,
            membershipExpiresAt: organisationMemberships.accessExpiresAt,
            delegatedByMembershipId:
              organisationMemberships.delegatedByMembershipId,
            role: roleGrants.role,
            roleStartsAt: roleGrants.startsAt,
            roleExpiresAt: roleGrants.expiresAt,
            roleRevokedAt: roleGrants.revokedAt,
          })
          .from(organisationMemberships)
          .innerJoin(users, eq(organisationMemberships.userId, users.id))
          .innerJoin(
            roleGrants,
            eq(roleGrants.membershipId, organisationMemberships.id),
          )
          .where(
            and(
              eq(organisationMemberships.organisationId, input.organisationId),
              inArray(
                roleGrants.id,
                authorityBounds.map((row) => row.id),
              ),
            ),
          )
          .limit(EVIDENCE_LAYER_STORE_BOUNDS.maxVerifierAuthorityRows),
  ]);

  if (authorityRows.length !== authorityBounds.length)
    return blocked(
      { ...input, requestedMode },
      actor,
      "requirementCitations.verifierAuthority",
      "Verifier authority grants exceed the bounded repository projection.",
    );
  if (
    documentContentRows.length !== documentMetadata.length ||
    requirementTextRows.length !== requirementMetadata.length ||
    citationSnippetRows.length !== citationMetadata.length
  )
    return blocked(
      { ...input, requestedMode },
      actor,
      "repository.concurrentChange",
      "The evidence source set changed while its bounded projection was loading.",
      "source_reference_missing",
    );

  const contentByDocument = new Map(
    documentContentRows.map((row) => [row.id, row.contentText]),
  );
  const textByRequirement = new Map(
    requirementTextRows.map((row) => [row.id, row.text]),
  );
  const snippetByCitation = new Map(
    citationSnippetRows.map((row) => [row.id, row.sourceSnippet]),
  );
  const authorisedVerifierIds = currentEvidenceApproverIds({
    rows: authorityRows,
    organisationType: project.organisationType as OrganisationType,
    now,
  });

  const layer = buildEvidenceLayer({
    organisationId: input.organisationId,
    projectId: input.projectId,
    requestedMode,
    evaluatedAt: now.toISOString(),
    project: { id: project.id, organisationId: project.organisationId },
    actor,
    documents: documentMetadata.map((row) => ({
      id: row.id,
      organisationId: row.organisationId,
      projectId: row.projectId,
      filename: row.filename,
      redactionStatus: row.redactionStatus,
      extractionStatus: row.extractionStatus,
      sha256: row.sha256,
      contentText: contentByDocument.get(row.id) ?? null,
    })),
    documentVersions: versionRows,
    requirements: requirementMetadata.map((row) => ({
      id: row.id,
      organisationId: row.organisationId,
      projectId: row.projectId,
      sourceDocId: row.sourceDocId,
      text: textByRequirement.get(row.id) ?? "",
      reviewStatus: row.reviewStatus,
    })),
    requirementCitations: citationMetadata.map((row) => ({
      id: row.id,
      organisationId: row.organisationId,
      requirementId: row.requirementId,
      documentVersionId: row.documentVersionId,
      pageNumber: row.pageNumber,
      paragraphRef: row.paragraphRef,
      tableRef: row.tableRef,
      coordinateJson: row.coordinateJson,
      sourceSnippet: snippetByCitation.get(row.id) ?? "",
      sourceSnippetHash: row.sourceSnippetHash,
      verificationStatus: row.verificationStatus,
      verifiedByUserId: row.verifiedByUserId,
      verifiedByName: row.verifiedByName,
      verifiedAt: iso(row.verifiedAt),
      verifierAuthority:
        row.verifiedByUserId && authorisedVerifierIds.has(row.verifiedByUserId)
          ? "active_direct_tenant_evidence_approver"
          : "not_authorized",
    })),
  });
  return { layer, actor };
}
