import { createHash } from "node:crypto";

/**
 * The bounded deterministic projection is connected to the tenant-scoped
 * evidence route and repository. Model and vector runtimes remain deliberately
 * disconnected, and this status must not be interpreted as production-model
 * approval.
 */
export const EVIDENCE_LAYER_FOUNDATION_STATUS = Object.freeze({
  runtimeConnected: true,
  deterministicRuntimeConnected: true,
  modelRuntimeConnected: false,
  vectorRuntimeConnected: false,
  extractionArtifactIntegrity: "unproven_schema_gap" as const,
  verifierAuthorityProvenance: "current_state_only" as const,
  activationBlockers: [
    "immutable_extraction_artifact_provenance",
    "immutable_historical_verifier_authority",
  ] as const,
  productionApproved: false,
  activation: "blocked" as const,
  retrieval: "bounded_lexical_verified_spans" as const,
  writesEnabled: false,
  externalActionsEnabled: false,
});

export const EVIDENCE_LAYER_POLICY_VERSION = "evidence-layer-policy-v1";

export const EVIDENCE_LAYER_BOUNDS = Object.freeze({
  maxDocuments: 256,
  maxDocumentVersions: 1_024,
  maxRequirements: 4_096,
  maxRequirementCitations: 8_192,
  maxCitationsPerDocument: 512,
  maxActorPermissions: 128,
  maxVisibleDocumentIds: 256,
  maxIdentifierCodeUnits: 128,
  maxIdentifierBytes: 256,
  maxFilenameCodeUnits: 512,
  maxFilenameBytes: 1_024,
  maxDocumentTextCodeUnits: 1_000_000,
  maxDocumentTextBytes: 2_000_000,
  maxTotalDocumentTextBytes: 12_000_000,
  maxRequirementTextCodeUnits: 64_000,
  maxRequirementTextBytes: 128_000,
  maxTotalRequirementTextBytes: 4_000_000,
  maxSnippetCodeUnits: 32_000,
  maxSnippetBytes: 64_000,
  maxTotalSnippetBytes: 4_000_000,
  maxLocatorCodeUnits: 4_096,
  maxLocatorBytes: 8_192,
  maxVerifierNameCodeUnits: 256,
  maxVerifierNameBytes: 512,
  maxQueryCodeUnits: 2_000,
  maxQueryBytes: 4_000,
  maxQueryTokens: 64,
  maxSearchResults: 20,
});

/** Validates SQL length projections without materializing the bounded text field. */
export function evidenceFieldLengthExceedsBounds(
  rows: ReadonlyArray<{
    readonly codeUnits: number | string | null;
    readonly bytes: number | string | null;
  }>,
  maxCodeUnits: number,
  maxBytes: number,
): boolean {
  const length = (value: number | string | null): number | null => {
    if (value === null) return 0;
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
  };
  return rows.some((row) => {
    const codeUnits = length(row.codeUnits);
    const bytes = length(row.bytes);
    return (
      codeUnits === null ||
      bytes === null ||
      codeUnits > maxCodeUnits ||
      bytes > maxBytes
    );
  });
}

export type EvidenceCorpusMode = "complete_corpus" | "verified_spans";

export interface EvidenceLayerActor {
  readonly userId: string;
  readonly organisationId: string;
  readonly projectId: string;
  readonly permissions: readonly string[];
  /**
   * The exact document IDs admitted by the caller's authorised query. The
   * engine requires this set to equal the supplied document rows, preventing
   * an unfiltered row from becoming visible through evidence search.
   */
  readonly visibleDocumentIds: readonly string[];
}

export interface EvidenceLayerProjectRow {
  readonly id: string;
  readonly organisationId: string | null;
}

export interface EvidenceLayerDocumentRow {
  readonly id: string;
  readonly organisationId: string | null;
  readonly projectId: string;
  readonly filename: string;
  readonly redactionStatus: string;
  readonly extractionStatus: string | null;
  readonly sha256: string | null;
  readonly contentText: string | null;
}

export interface EvidenceLayerDocumentVersionRow {
  readonly id: string;
  readonly organisationId: string;
  readonly documentId: string;
  readonly versionNumber: number;
  readonly sha256: string;
  readonly malwareStatus: string;
  readonly quarantineStatus: string;
}

export interface EvidenceLayerRequirementRow {
  readonly id: string;
  readonly organisationId: string | null;
  readonly projectId: string;
  readonly sourceDocId: string | null;
  readonly text: string;
  readonly reviewStatus: string;
}

export interface EvidenceLayerRequirementCitationRow {
  readonly id: string;
  readonly organisationId: string;
  readonly requirementId: string;
  readonly documentVersionId: string;
  readonly pageNumber: number | null;
  readonly paragraphRef: string | null;
  readonly tableRef: string | null;
  readonly coordinateJson: string | null;
  readonly sourceSnippet: string;
  readonly sourceSnippetHash: string;
  readonly verificationStatus: string;
  readonly verifiedByUserId: string | null;
  /** Joined from users.name by the authorised repository query. */
  readonly verifiedByName: string | null;
  readonly verifiedAt: string | null;
  /**
   * Current-state authority resolved by the repository: the verifier must be
   * an active user with an active, non-delegated membership in this exact
   * tenant and an active native role grant that includes evidence:approve.
   * This is not an immutable historical authority snapshot; production-model
   * activation remains blocked until that provenance is persisted at review.
   */
  readonly verifierAuthority:
    | "active_direct_tenant_evidence_approver"
    | "not_authorized";
}

export interface EvidenceLayerInput {
  readonly organisationId: string;
  readonly projectId: string;
  readonly requestedMode: EvidenceCorpusMode;
  /** Caller-controlled evaluation instant; prevents hidden wall-clock reads. */
  readonly evaluatedAt: string;
  readonly project: EvidenceLayerProjectRow;
  readonly actor: EvidenceLayerActor;
  readonly documents: readonly EvidenceLayerDocumentRow[];
  readonly documentVersions: readonly EvidenceLayerDocumentVersionRow[];
  readonly requirements: readonly EvidenceLayerRequirementRow[];
  readonly requirementCitations: readonly EvidenceLayerRequirementCitationRow[];
}

export type EvidenceLayerBlockerCode =
  | "input_bound_exceeded"
  | "input_invalid"
  | "duplicate_entity"
  | "project_scope_mismatch"
  | "actor_scope_mismatch"
  | "permission_denied"
  | "document_visibility_mismatch"
  | "document_scope_mismatch"
  | "version_scope_mismatch"
  | "requirement_scope_mismatch"
  | "citation_scope_mismatch"
  | "source_reference_missing"
  | "current_version_ambiguous"
  | "complete_corpus_not_proven"
  | "layer_not_ready"
  | "manifest_mismatch"
  | "query_invalid";

export interface EvidenceLayerBlocker {
  readonly code: EvidenceLayerBlockerCode;
  readonly path: string;
  readonly message: string;
}

export type EvidenceLayerRejectionCode =
  | "document_redaction_ineligible"
  | "document_extraction_incomplete"
  | "document_hash_invalid"
  | "document_hash_mismatch"
  | "malware_not_clean"
  | "quarantine_not_cleared"
  | "citation_unverified"
  | "citation_verifier_missing"
  | "citation_verifier_unauthorised"
  | "citation_timestamp_invalid"
  | "citation_timestamp_future"
  | "requirement_not_accepted"
  | "citation_document_mismatch"
  | "citation_version_not_current"
  | "citation_locator_missing"
  | "citation_locator_invalid"
  | "snippet_empty"
  | "snippet_hash_invalid"
  | "snippet_hash_mismatch"
  | "snippet_not_in_current_content";

export interface EvidenceLayerRejection {
  readonly code: EvidenceLayerRejectionCode;
  readonly citationId: string;
  readonly documentId?: string;
  readonly message: string;
}

export interface EvidenceLocator {
  readonly pageNumber: number | null;
  readonly paragraphRef: string | null;
  readonly tableRef: string | null;
  readonly coordinateJson: string | null;
  readonly label: string;
}

export interface VerifiedEvidenceSpan {
  readonly citationId: string;
  readonly organisationId: string;
  readonly projectId: string;
  readonly requirementId: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly documentVersionNumber: number;
  readonly sourceName: string;
  readonly sourceSha256: string;
  readonly snippetSha256: string;
  readonly text: string;
  readonly locator: EvidenceLocator;
  readonly verifier: {
    readonly userId: string;
    readonly name: string;
    readonly verifiedAt: string;
    readonly authority: "active_direct_tenant_evidence_approver";
  };
  readonly instructionAuthority: "none";
}

export interface EvidenceLayerScope {
  readonly organisationId: string;
  readonly projectId: string;
  readonly actorUserId: string;
  readonly visibilitySha256: string;
  readonly permissionSnapshotSha256: string;
}

export interface EvidenceLayerResult {
  readonly disposition: "ready" | "abstain" | "blocked";
  readonly requestedMode: EvidenceCorpusMode;
  readonly actualMode: EvidenceCorpusMode;
  readonly abstentionReason?:
    | "no_verified_spans"
    | "complete_corpus_not_proven";
  readonly scope: EvidenceLayerScope;
  readonly sources: readonly VerifiedEvidenceSpan[];
  readonly blockers: readonly EvidenceLayerBlocker[];
  readonly rejected: readonly EvidenceLayerRejection[];
  readonly coverage: {
    readonly visibleDocumentCount: number;
    readonly redactionEligibleDocumentCount: number;
    readonly safeCurrentDocumentCount: number;
    readonly verifiedDocumentCount: number;
    readonly fullyVerifiedDocumentCount: number;
  };
  readonly manifestSha256: string | null;
  readonly versionSha256: string | null;
}

export interface EvidenceLayerSearchRequest {
  readonly actor: EvidenceLayerActor;
  readonly expectedManifestSha256: string;
  readonly query: string;
  readonly limit: number;
}

export interface EvidenceLayerSearchMatch {
  readonly source: VerifiedEvidenceSpan;
  readonly lexicalScoreBasisPoints: number;
  readonly exactPhraseMatch: boolean;
  readonly matchedTokens: readonly string[];
}

export interface EvidenceLayerSearchResult {
  readonly disposition: "ready" | "abstain" | "blocked";
  readonly matches: readonly EvidenceLayerSearchMatch[];
  readonly blockers: readonly EvidenceLayerBlocker[];
  readonly abstentionReason?: "no_lexical_match";
  readonly querySha256: string | null;
  readonly searchManifestSha256: string | null;
}

const REQUIRED_PERMISSIONS = [
  "project:read",
  "document:read",
  "requirement:read",
  "evidence:read",
] as const;
const ACCEPTED_REQUIREMENT_STATES = new Set(["confirmed", "edited"]);
const REDACTION_ELIGIBLE_STATES = new Set(["included", "redacted"]);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function sha256Unchecked(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Hashes only text that is within the evidence layer's document-text bound. */
export function hashEvidenceLayerText(value: string): string {
  if (
    typeof value !== "string" ||
    value.length > EVIDENCE_LAYER_BOUNDS.maxDocumentTextCodeUnits ||
    Buffer.byteLength(value, "utf8") >
      EVIDENCE_LAYER_BOUNDS.maxDocumentTextBytes
  ) {
    throw new RangeError("Evidence text exceeds the bounded hashing policy.");
  }
  return sha256Unchecked(value);
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.test(value);
}

function validSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function validTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    RFC3339_UTC.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isValidJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function boundedText(
  value: unknown,
  codeUnits: number,
  bytes: number,
  allowEmpty = true,
): value is string {
  if (typeof value !== "string" || value.length > codeUnits) return false;
  if (!allowEmpty && value.length === 0) return false;
  return Buffer.byteLength(value, "utf8") <= bytes;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalStringList(values: readonly string[]): string[] {
  return [...values].sort(compareText);
}

function hashStringList(values: readonly string[]): string {
  return sha256Unchecked(JSON.stringify(canonicalStringList(values)));
}

function emptyScope(input: EvidenceLayerInput): EvidenceLayerScope {
  return {
    organisationId:
      typeof input.organisationId === "string" ? input.organisationId : "",
    projectId: typeof input.projectId === "string" ? input.projectId : "",
    actorUserId:
      typeof input.actor?.userId === "string" ? input.actor.userId : "",
    visibilitySha256: sha256Unchecked("[]"),
    permissionSnapshotSha256: sha256Unchecked("[]"),
  };
}

function blockedBuild(
  input: EvidenceLayerInput,
  blockers: readonly EvidenceLayerBlocker[],
): EvidenceLayerResult {
  return {
    disposition: "blocked",
    requestedMode:
      input.requestedMode === "complete_corpus"
        ? "complete_corpus"
        : "verified_spans",
    actualMode: "verified_spans",
    scope: emptyScope(input),
    sources: [],
    blockers: [...blockers],
    rejected: [],
    coverage: {
      visibleDocumentCount: 0,
      redactionEligibleDocumentCount: 0,
      safeCurrentDocumentCount: 0,
      verifiedDocumentCount: 0,
      fullyVerifiedDocumentCount: 0,
    },
    manifestSha256: null,
    versionSha256: null,
  };
}

/**
 * Allows the authorised repository to fail closed before loading oversized
 * text columns. No source row or content is reflected in this result.
 */
export function buildBlockedEvidenceLayer(input: {
  readonly organisationId: string;
  readonly projectId: string;
  readonly requestedMode: EvidenceCorpusMode;
  readonly evaluatedAt: string;
  readonly actor: EvidenceLayerActor;
  readonly code: EvidenceLayerBlockerCode;
  readonly path: string;
  readonly message: string;
}): EvidenceLayerResult {
  const emptyInput: EvidenceLayerInput = {
    organisationId: input.organisationId,
    projectId: input.projectId,
    requestedMode: input.requestedMode,
    evaluatedAt: input.evaluatedAt,
    project: { id: input.projectId, organisationId: input.organisationId },
    actor: input.actor,
    documents: [],
    documentVersions: [],
    requirements: [],
    requirementCitations: [],
  };
  return blockedBuild(emptyInput, [
    { code: input.code, path: input.path, message: input.message },
  ]);
}

function boundBlocker(path: string): EvidenceLayerBlocker {
  return {
    code: "input_bound_exceeded",
    path,
    message: "The input exceeded a deterministic evidence-layer bound.",
  };
}

function validateBuildBounds(
  input: EvidenceLayerInput,
): EvidenceLayerBlocker[] {
  if (input.documents.length > EVIDENCE_LAYER_BOUNDS.maxDocuments)
    return [boundBlocker("documents")];
  if (input.documentVersions.length > EVIDENCE_LAYER_BOUNDS.maxDocumentVersions)
    return [boundBlocker("documentVersions")];
  if (input.requirements.length > EVIDENCE_LAYER_BOUNDS.maxRequirements)
    return [boundBlocker("requirements")];
  if (
    input.requirementCitations.length >
    EVIDENCE_LAYER_BOUNDS.maxRequirementCitations
  )
    return [boundBlocker("requirementCitations")];
  if (
    input.actor.permissions.length > EVIDENCE_LAYER_BOUNDS.maxActorPermissions
  )
    return [boundBlocker("actor.permissions")];
  if (
    input.actor.visibleDocumentIds.length >
    EVIDENCE_LAYER_BOUNDS.maxVisibleDocumentIds
  )
    return [boundBlocker("actor.visibleDocumentIds")];

  const blockers: EvidenceLayerBlocker[] = [];
  const checkId = (value: unknown, path: string): void => {
    if (
      !boundedText(
        value,
        EVIDENCE_LAYER_BOUNDS.maxIdentifierCodeUnits,
        EVIDENCE_LAYER_BOUNDS.maxIdentifierBytes,
        false,
      )
    )
      blockers.push(boundBlocker(path));
  };
  checkId(input.organisationId, "organisationId");
  checkId(input.projectId, "projectId");
  checkId(input.evaluatedAt, "evaluatedAt");
  checkId(input.project.id, "project.id");
  checkId(input.project.organisationId, "project.organisationId");
  checkId(input.actor.userId, "actor.userId");
  checkId(input.actor.organisationId, "actor.organisationId");
  checkId(input.actor.projectId, "actor.projectId");
  input.actor.permissions.forEach((value, index) =>
    checkId(value, `actor.permissions[${index}]`),
  );
  input.actor.visibleDocumentIds.forEach((value, index) =>
    checkId(value, `actor.visibleDocumentIds[${index}]`),
  );

  let totalDocumentBytes = 0;
  input.documents.forEach((document, index) => {
    const path = `documents[${index}]`;
    checkId(document.id, `${path}.id`);
    checkId(document.organisationId, `${path}.organisationId`);
    checkId(document.projectId, `${path}.projectId`);
    checkId(document.redactionStatus, `${path}.redactionStatus`);
    if (document.extractionStatus !== null)
      checkId(document.extractionStatus, `${path}.extractionStatus`);
    if (document.sha256 !== null) checkId(document.sha256, `${path}.sha256`);
    if (
      !boundedText(
        document.filename,
        EVIDENCE_LAYER_BOUNDS.maxFilenameCodeUnits,
        EVIDENCE_LAYER_BOUNDS.maxFilenameBytes,
        false,
      )
    )
      blockers.push(boundBlocker(`${path}.filename`));
    if (document.contentText !== null) {
      if (
        !boundedText(
          document.contentText,
          EVIDENCE_LAYER_BOUNDS.maxDocumentTextCodeUnits,
          EVIDENCE_LAYER_BOUNDS.maxDocumentTextBytes,
        )
      ) {
        blockers.push(boundBlocker(`${path}.contentText`));
      } else {
        totalDocumentBytes += Buffer.byteLength(document.contentText, "utf8");
      }
    }
  });
  if (totalDocumentBytes > EVIDENCE_LAYER_BOUNDS.maxTotalDocumentTextBytes)
    blockers.push(boundBlocker("documents.contentText.totalBytes"));

  input.documentVersions.forEach((version, index) => {
    const path = `documentVersions[${index}]`;
    checkId(version.id, `${path}.id`);
    checkId(version.organisationId, `${path}.organisationId`);
    checkId(version.documentId, `${path}.documentId`);
    checkId(version.sha256, `${path}.sha256`);
    checkId(version.malwareStatus, `${path}.malwareStatus`);
    checkId(version.quarantineStatus, `${path}.quarantineStatus`);
  });

  let totalRequirementBytes = 0;
  input.requirements.forEach((requirement, index) => {
    const path = `requirements[${index}]`;
    checkId(requirement.id, `${path}.id`);
    checkId(requirement.organisationId, `${path}.organisationId`);
    checkId(requirement.projectId, `${path}.projectId`);
    if (requirement.sourceDocId !== null)
      checkId(requirement.sourceDocId, `${path}.sourceDocId`);
    checkId(requirement.reviewStatus, `${path}.reviewStatus`);
    if (
      !boundedText(
        requirement.text,
        EVIDENCE_LAYER_BOUNDS.maxRequirementTextCodeUnits,
        EVIDENCE_LAYER_BOUNDS.maxRequirementTextBytes,
      )
    ) {
      blockers.push(boundBlocker(`${path}.text`));
    } else {
      totalRequirementBytes += Buffer.byteLength(requirement.text, "utf8");
    }
  });
  if (
    totalRequirementBytes > EVIDENCE_LAYER_BOUNDS.maxTotalRequirementTextBytes
  )
    blockers.push(boundBlocker("requirements.text.totalBytes"));

  let totalSnippetBytes = 0;
  input.requirementCitations.forEach((citation, index) => {
    const path = `requirementCitations[${index}]`;
    checkId(citation.id, `${path}.id`);
    checkId(citation.organisationId, `${path}.organisationId`);
    checkId(citation.requirementId, `${path}.requirementId`);
    checkId(citation.documentVersionId, `${path}.documentVersionId`);
    checkId(citation.sourceSnippetHash, `${path}.sourceSnippetHash`);
    checkId(citation.verificationStatus, `${path}.verificationStatus`);
    checkId(citation.verifierAuthority, `${path}.verifierAuthority`);
    if (citation.verifiedByUserId !== null)
      checkId(citation.verifiedByUserId, `${path}.verifiedByUserId`);
    if (citation.verifiedAt !== null)
      checkId(citation.verifiedAt, `${path}.verifiedAt`);
    if (
      !boundedText(
        citation.sourceSnippet,
        EVIDENCE_LAYER_BOUNDS.maxSnippetCodeUnits,
        EVIDENCE_LAYER_BOUNDS.maxSnippetBytes,
      )
    ) {
      blockers.push(boundBlocker(`${path}.sourceSnippet`));
    } else {
      totalSnippetBytes += Buffer.byteLength(citation.sourceSnippet, "utf8");
    }
    if (
      citation.verifiedByName !== null &&
      !boundedText(
        citation.verifiedByName,
        EVIDENCE_LAYER_BOUNDS.maxVerifierNameCodeUnits,
        EVIDENCE_LAYER_BOUNDS.maxVerifierNameBytes,
      )
    )
      blockers.push(boundBlocker(`${path}.verifiedByName`));
    for (const [name, value] of [
      ["paragraphRef", citation.paragraphRef],
      ["tableRef", citation.tableRef],
      ["coordinateJson", citation.coordinateJson],
    ] as const) {
      if (
        value !== null &&
        !boundedText(
          value,
          EVIDENCE_LAYER_BOUNDS.maxLocatorCodeUnits,
          EVIDENCE_LAYER_BOUNDS.maxLocatorBytes,
        )
      )
        blockers.push(boundBlocker(`${path}.${name}`));
    }
  });
  if (totalSnippetBytes > EVIDENCE_LAYER_BOUNDS.maxTotalSnippetBytes)
    blockers.push(
      boundBlocker("requirementCitations.sourceSnippet.totalBytes"),
    );
  const documentIdByVersionId = new Map(
    input.documentVersions.map((version) => [version.id, version.documentId]),
  );
  const citationCountByDocumentId = new Map<string, number>();
  for (const citation of input.requirementCitations) {
    const documentId = documentIdByVersionId.get(citation.documentVersionId);
    if (!documentId) continue;
    const count = (citationCountByDocumentId.get(documentId) ?? 0) + 1;
    citationCountByDocumentId.set(documentId, count);
    if (count > EVIDENCE_LAYER_BOUNDS.maxCitationsPerDocument) {
      blockers.push(boundBlocker("requirementCitations.byDocument"));
      break;
    }
  }
  return blockers;
}

function duplicateBlockers(
  values: readonly { readonly id: string }[],
  path: string,
): EvidenceLayerBlocker[] {
  const seen = new Set<string>();
  const blockers: EvidenceLayerBlocker[] = [];
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      blockers.push({
        code: "duplicate_entity",
        path: `${path}[${index}].id`,
        message: "Duplicate persisted identities make provenance ambiguous.",
      });
    }
    seen.add(value.id);
  });
  return blockers;
}

function validateScope(input: EvidenceLayerInput): EvidenceLayerBlocker[] {
  const blockers: EvidenceLayerBlocker[] = [];
  if (
    input.requestedMode !== "complete_corpus" &&
    input.requestedMode !== "verified_spans"
  ) {
    blockers.push({
      code: "input_invalid",
      path: "requestedMode",
      message: "A closed-set evidence corpus mode is required.",
    });
  }
  if (!validTimestamp(input.evaluatedAt))
    blockers.push({
      code: "input_invalid",
      path: "evaluatedAt",
      message: "A valid explicit UTC evaluation timestamp is required.",
    });
  for (const [value, path] of [
    [input.organisationId, "organisationId"],
    [input.projectId, "projectId"],
    [input.actor.userId, "actor.userId"],
  ] as const) {
    if (!validIdentifier(value))
      blockers.push({
        code: "input_invalid",
        path,
        message: "A stable bounded identifier is required.",
      });
  }
  if (
    input.project.id !== input.projectId ||
    input.project.organisationId !== input.organisationId
  )
    blockers.push({
      code: "project_scope_mismatch",
      path: "project",
      message: "The project row does not match the requested tenant scope.",
    });
  if (
    input.actor.organisationId !== input.organisationId ||
    input.actor.projectId !== input.projectId
  )
    blockers.push({
      code: "actor_scope_mismatch",
      path: "actor",
      message: "The actor is not bound to the requested tenant and project.",
    });
  const permissionSet = new Set(input.actor.permissions);
  for (const permission of REQUIRED_PERMISSIONS) {
    if (!permissionSet.has(permission))
      blockers.push({
        code: "permission_denied",
        path: "actor.permissions",
        message: `The authorised projection requires ${permission}.`,
      });
  }
  if (
    permissionSet.size !== input.actor.permissions.length ||
    new Set(input.actor.visibleDocumentIds).size !==
      input.actor.visibleDocumentIds.length
  )
    blockers.push({
      code: "input_invalid",
      path: "actor",
      message: "Actor permission and visibility lists must be unique.",
    });

  blockers.push(
    ...duplicateBlockers(input.documents, "documents"),
    ...duplicateBlockers(input.documentVersions, "documentVersions"),
    ...duplicateBlockers(input.requirements, "requirements"),
    ...duplicateBlockers(input.requirementCitations, "requirementCitations"),
  );
  const documentById = new Map(
    input.documents.map((document) => [document.id, document]),
  );
  const versionById = new Map(
    input.documentVersions.map((version) => [version.id, version]),
  );
  const requirementById = new Map(
    input.requirements.map((requirement) => [requirement.id, requirement]),
  );
  const documentIds = canonicalStringList(input.documents.map(({ id }) => id));
  const visibleIds = canonicalStringList(input.actor.visibleDocumentIds);
  if (JSON.stringify(documentIds) !== JSON.stringify(visibleIds))
    blockers.push({
      code: "document_visibility_mismatch",
      path: "actor.visibleDocumentIds",
      message:
        "Supplied document rows must exactly match the authorised visibility set.",
    });

  input.documents.forEach((document, index) => {
    if (
      document.organisationId !== input.organisationId ||
      document.projectId !== input.projectId
    )
      blockers.push({
        code: "document_scope_mismatch",
        path: `documents[${index}]`,
        message: "A document row crossed the requested tenant/project scope.",
      });
  });
  const versionNumbers = new Set<string>();
  input.documentVersions.forEach((version, index) => {
    const document = documentById.get(version.documentId);
    if (!document)
      blockers.push({
        code: "source_reference_missing",
        path: `documentVersions[${index}].documentId`,
        message: "A document version references a missing or deleted document.",
      });
    if (
      version.organisationId !== input.organisationId ||
      document?.organisationId !== input.organisationId ||
      document?.projectId !== input.projectId
    )
      blockers.push({
        code: "version_scope_mismatch",
        path: `documentVersions[${index}]`,
        message: "A document version crossed its document tenant scope.",
      });
    if (
      !Number.isSafeInteger(version.versionNumber) ||
      version.versionNumber < 1
    )
      blockers.push({
        code: "input_invalid",
        path: `documentVersions[${index}].versionNumber`,
        message: "Document version numbers must be positive safe integers.",
      });
    const versionKey = `${version.documentId}:${version.versionNumber}`;
    if (versionNumbers.has(versionKey))
      blockers.push({
        code: "current_version_ambiguous",
        path: `documentVersions[${index}].versionNumber`,
        message: "A document has duplicate version numbers.",
      });
    versionNumbers.add(versionKey);
  });
  input.requirements.forEach((requirement, index) => {
    const sourceDocument = requirement.sourceDocId
      ? documentById.get(requirement.sourceDocId)
      : undefined;
    if (requirement.sourceDocId && !sourceDocument)
      blockers.push({
        code: "source_reference_missing",
        path: `requirements[${index}].sourceDocId`,
        message: "A requirement references a missing or deleted document.",
      });
    if (
      requirement.organisationId !== input.organisationId ||
      requirement.projectId !== input.projectId ||
      (sourceDocument !== undefined &&
        (sourceDocument.organisationId !== input.organisationId ||
          sourceDocument.projectId !== input.projectId))
    )
      blockers.push({
        code: "requirement_scope_mismatch",
        path: `requirements[${index}]`,
        message: "A requirement crossed its document tenant/project scope.",
      });
  });
  input.requirementCitations.forEach((citation, index) => {
    const requirement = requirementById.get(citation.requirementId);
    const version = versionById.get(citation.documentVersionId);
    if (!requirement || !version)
      blockers.push({
        code: "source_reference_missing",
        path: `requirementCitations[${index}]`,
        message:
          "A requirement citation references a missing requirement or version.",
      });
    if (
      citation.organisationId !== input.organisationId ||
      requirement?.organisationId !== input.organisationId ||
      requirement?.projectId !== input.projectId ||
      version?.organisationId !== input.organisationId
    )
      blockers.push({
        code: "citation_scope_mismatch",
        path: `requirementCitations[${index}]`,
        message: "A citation crossed its requirement/version tenant scope.",
      });
  });
  return blockers;
}

function locatorFor(
  citation: EvidenceLayerRequirementCitationRow,
): EvidenceLocator {
  const label = [
    citation.pageNumber !== null ? `Page ${citation.pageNumber}` : null,
    citation.paragraphRef,
    citation.tableRef,
    citation.coordinateJson !== null ? "Coordinates retained" : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  return {
    pageNumber: citation.pageNumber,
    paragraphRef: citation.paragraphRef,
    tableRef: citation.tableRef,
    coordinateJson: citation.coordinateJson,
    label,
  };
}

function rejection(
  code: EvidenceLayerRejectionCode,
  citation: EvidenceLayerRequirementCitationRow,
  message: string,
  documentId?: string,
): EvidenceLayerRejection {
  return { code, citationId: citation.id, documentId, message };
}

function evidenceManifestPayload(result: {
  readonly requestedMode: EvidenceCorpusMode;
  readonly actualMode: EvidenceCorpusMode;
  readonly scope: EvidenceLayerScope;
  readonly sources: readonly VerifiedEvidenceSpan[];
  readonly coverage: EvidenceLayerResult["coverage"];
}): unknown {
  return {
    policyVersion: EVIDENCE_LAYER_POLICY_VERSION,
    requestedMode: result.requestedMode,
    actualMode: result.actualMode,
    scope: result.scope,
    coverage: result.coverage,
    sources: result.sources.map((source) => ({
      citationId: source.citationId,
      organisationId: source.organisationId,
      projectId: source.projectId,
      requirementId: source.requirementId,
      documentId: source.documentId,
      documentVersionId: source.documentVersionId,
      documentVersionNumber: source.documentVersionNumber,
      sourceName: source.sourceName,
      sourceSha256: source.sourceSha256,
      snippetSha256: source.snippetSha256,
      locator: source.locator,
      verifier: source.verifier,
      instructionAuthority: source.instructionAuthority,
    })),
  };
}

function manifestSha256(result: {
  readonly requestedMode: EvidenceCorpusMode;
  readonly actualMode: EvidenceCorpusMode;
  readonly scope: EvidenceLayerScope;
  readonly sources: readonly VerifiedEvidenceSpan[];
  readonly coverage: EvidenceLayerResult["coverage"];
}): string {
  return sha256Unchecked(JSON.stringify(evidenceManifestPayload(result)));
}

/**
 * Builds a scope-bound evidence manifest from existing document/version,
 * requirement, and citation rows. It never writes or invokes an external
 * action. Earlier safe versions never substitute for an unsafe/deleted latest
 * version.
 */
export function buildEvidenceLayer(
  input: EvidenceLayerInput,
): EvidenceLayerResult {
  const boundBlockers = validateBuildBounds(input);
  if (boundBlockers.length > 0) return blockedBuild(input, boundBlockers);
  const scopeBlockers = validateScope(input);
  if (scopeBlockers.length > 0) return blockedBuild(input, scopeBlockers);

  const scope: EvidenceLayerScope = {
    organisationId: input.organisationId,
    projectId: input.projectId,
    actorUserId: input.actor.userId,
    visibilitySha256: hashStringList(input.actor.visibleDocumentIds),
    permissionSnapshotSha256: hashStringList(
      REQUIRED_PERMISSIONS.filter((permission) =>
        input.actor.permissions.includes(permission),
      ),
    ),
  };
  const documentById = new Map(
    input.documents.map((document) => [document.id, document]),
  );
  const versionById = new Map(
    input.documentVersions.map((version) => [version.id, version]),
  );
  const requirementById = new Map(
    input.requirements.map((requirement) => [requirement.id, requirement]),
  );
  const versionsByDocument = new Map<
    string,
    EvidenceLayerDocumentVersionRow[]
  >();
  for (const version of input.documentVersions) {
    const versions = versionsByDocument.get(version.documentId) ?? [];
    versions.push(version);
    versionsByDocument.set(version.documentId, versions);
  }
  const currentVersionByDocument = new Map<
    string,
    EvidenceLayerDocumentVersionRow
  >();
  for (const [documentId, versions] of versionsByDocument) {
    const ordered = [...versions].sort(
      (left, right) =>
        right.versionNumber - left.versionNumber ||
        compareText(left.id, right.id),
    );
    const current = ordered[0];
    if (current) currentVersionByDocument.set(documentId, current);
  }

  const documentSafety = new Map<
    string,
    { readonly safe: boolean; readonly code?: EvidenceLayerRejectionCode }
  >();
  for (const document of input.documents) {
    const current = currentVersionByDocument.get(document.id);
    let code: EvidenceLayerRejectionCode | undefined;
    if (!REDACTION_ELIGIBLE_STATES.has(document.redactionStatus))
      code = "document_redaction_ineligible";
    else if (document.extractionStatus !== "extracted")
      code = "document_extraction_incomplete";
    else if (
      !validSha256(document.sha256) ||
      !current ||
      !validSha256(current.sha256)
    )
      code = "document_hash_invalid";
    else if (document.sha256.toLowerCase() !== current.sha256.toLowerCase())
      code = "document_hash_mismatch";
    else if (current.malwareStatus !== "clean") code = "malware_not_clean";
    else if (current.quarantineStatus !== "cleared")
      code = "quarantine_not_cleared";
    documentSafety.set(document.id, { safe: code === undefined, code });
  }

  const rejected: EvidenceLayerRejection[] = [];
  const sources: VerifiedEvidenceSpan[] = [];
  const sortedCitations = [...input.requirementCitations].sort((left, right) =>
    compareText(left.id, right.id),
  );
  for (const citation of sortedCitations) {
    const requirement = requirementById.get(citation.requirementId)!;
    const version = versionById.get(citation.documentVersionId)!;
    const document = documentById.get(version.documentId)!;
    const current = currentVersionByDocument.get(document.id);
    const safety = documentSafety.get(document.id)!;
    let item: EvidenceLayerRejection | undefined;
    if (citation.verificationStatus !== "verified")
      item = rejection(
        "citation_unverified",
        citation,
        "Only explicitly verified citations are searchable.",
        document.id,
      );
    else if (
      !validIdentifier(citation.verifiedByUserId) ||
      citation.verifiedByName === null ||
      citation.verifiedByName.trim().length === 0
    )
      item = rejection(
        "citation_verifier_missing",
        citation,
        "A named verifier identity is required.",
        document.id,
      );
    else if (
      citation.verifierAuthority !== "active_direct_tenant_evidence_approver"
    )
      item = rejection(
        "citation_verifier_unauthorised",
        citation,
        "The verifier does not currently hold direct active tenant evidence-approval authority.",
        document.id,
      );
    else if (!validTimestamp(citation.verifiedAt))
      item = rejection(
        "citation_timestamp_invalid",
        citation,
        "A valid UTC verification timestamp is required.",
        document.id,
      );
    else if (Date.parse(citation.verifiedAt) > Date.parse(input.evaluatedAt))
      item = rejection(
        "citation_timestamp_future",
        citation,
        "A verification timestamp cannot be later than the explicit evidence evaluation instant.",
        document.id,
      );
    else if (!ACCEPTED_REQUIREMENT_STATES.has(requirement.reviewStatus))
      item = rejection(
        "requirement_not_accepted",
        citation,
        "The cited requirement has not been accepted by review.",
        document.id,
      );
    else if (requirement.sourceDocId !== document.id)
      item = rejection(
        "citation_document_mismatch",
        citation,
        "The citation version does not belong to the requirement source document.",
        document.id,
      );
    else if (!current || current.id !== version.id)
      item = rejection(
        "citation_version_not_current",
        citation,
        "A citation may not use a superseded or deleted current version.",
        document.id,
      );
    else if (!safety.safe)
      item = rejection(
        safety.code!,
        citation,
        "The current source failed its safe lifecycle or integrity gate.",
        document.id,
      );
    else if (
      citation.pageNumber !== null &&
      (!Number.isSafeInteger(citation.pageNumber) || citation.pageNumber < 1)
    )
      item = rejection(
        "citation_locator_invalid",
        citation,
        "Citation page numbers must be positive safe integers.",
        document.id,
      );
    else if (
      citation.coordinateJson !== null &&
      !isValidJson(citation.coordinateJson)
    )
      item = rejection(
        "citation_locator_invalid",
        citation,
        "Citation coordinates must be valid bounded JSON.",
        document.id,
      );
    else if (
      citation.pageNumber === null &&
      !citation.paragraphRef?.trim() &&
      !citation.tableRef?.trim() &&
      !citation.coordinateJson?.trim()
    )
      item = rejection(
        "citation_locator_missing",
        citation,
        "At least one exact page, paragraph, table, or coordinate locator is required.",
        document.id,
      );
    else if (citation.sourceSnippet.length === 0)
      item = rejection(
        "snippet_empty",
        citation,
        "An empty source span is never evidence.",
        document.id,
      );
    else if (!validSha256(citation.sourceSnippetHash))
      item = rejection(
        "snippet_hash_invalid",
        citation,
        "The verified span requires a SHA-256 digest.",
        document.id,
      );
    else if (
      citation.sourceSnippetHash.toLowerCase() !==
      sha256Unchecked(citation.sourceSnippet)
    )
      item = rejection(
        "snippet_hash_mismatch",
        citation,
        "The verified span digest does not match its exact text.",
        document.id,
      );
    else if (!document.contentText?.includes(citation.sourceSnippet))
      item = rejection(
        "snippet_not_in_current_content",
        citation,
        "The verified span is not present verbatim in current document content.",
        document.id,
      );
    if (item) {
      rejected.push(item);
      continue;
    }
    sources.push({
      citationId: citation.id,
      organisationId: input.organisationId,
      projectId: input.projectId,
      requirementId: requirement.id,
      documentId: document.id,
      documentVersionId: version.id,
      documentVersionNumber: version.versionNumber,
      sourceName: document.filename,
      sourceSha256: version.sha256.toLowerCase(),
      snippetSha256: citation.sourceSnippetHash.toLowerCase(),
      text: citation.sourceSnippet,
      locator: locatorFor(citation),
      verifier: {
        userId: citation.verifiedByUserId!,
        name: citation.verifiedByName!,
        verifiedAt: citation.verifiedAt!,
        authority: "active_direct_tenant_evidence_approver",
      },
      instructionAuthority: "none",
    });
  }
  sources.sort(
    (left, right) =>
      compareText(left.documentId, right.documentId) ||
      left.documentVersionNumber - right.documentVersionNumber ||
      compareText(left.locator.label, right.locator.label) ||
      compareText(left.citationId, right.citationId),
  );
  rejected.sort(
    (left, right) =>
      compareText(left.citationId, right.citationId) ||
      compareText(left.code, right.code),
  );

  const redactionEligibleDocuments = input.documents.filter((document) =>
    REDACTION_ELIGIBLE_STATES.has(document.redactionStatus),
  );
  const safeCurrentDocuments = redactionEligibleDocuments.filter(
    (document) => documentSafety.get(document.id)?.safe === true,
  );
  const verifiedDocumentIds = new Set(
    sources.map(({ documentId }) => documentId),
  );
  const fullyVerifiedDocumentIds = new Set(
    safeCurrentDocuments.flatMap((document) =>
      sources.some(
        (source) =>
          source.documentId === document.id &&
          document.contentText !== null &&
          source.text === document.contentText,
      )
        ? [document.id]
        : [],
    ),
  );
  const coverage: EvidenceLayerResult["coverage"] = {
    visibleDocumentCount: input.documents.length,
    redactionEligibleDocumentCount: redactionEligibleDocuments.length,
    safeCurrentDocumentCount: safeCurrentDocuments.length,
    verifiedDocumentCount: verifiedDocumentIds.size,
    fullyVerifiedDocumentCount: fullyVerifiedDocumentIds.size,
  };
  const completeCorpus =
    redactionEligibleDocuments.length > 0 &&
    safeCurrentDocuments.length === redactionEligibleDocuments.length &&
    fullyVerifiedDocumentIds.size === redactionEligibleDocuments.length;
  const actualMode: EvidenceCorpusMode = completeCorpus
    ? "complete_corpus"
    : "verified_spans";
  const modeUnproven =
    input.requestedMode === "complete_corpus" && !completeCorpus;
  const blockers: EvidenceLayerBlocker[] = modeUnproven
    ? [
        {
          code: "complete_corpus_not_proven",
          path: "requestedMode",
          message:
            "Complete-corpus mode requires every readable, redaction-eligible document to have a safe current version and a full-content verified citation.",
        },
      ]
    : [];
  const disposition = modeUnproven
    ? "abstain"
    : sources.length === 0
      ? "abstain"
      : "ready";
  const draft = {
    requestedMode: input.requestedMode,
    actualMode,
    scope,
    sources,
    coverage,
  };
  const manifest = manifestSha256(draft);
  return {
    disposition,
    requestedMode: input.requestedMode,
    actualMode,
    ...(modeUnproven
      ? { abstentionReason: "complete_corpus_not_proven" as const }
      : sources.length === 0
        ? { abstentionReason: "no_verified_spans" as const }
        : {}),
    scope,
    sources,
    blockers,
    rejected,
    coverage,
    manifestSha256: manifest,
    versionSha256: sha256Unchecked(
      `${EVIDENCE_LAYER_POLICY_VERSION}:${manifest}`,
    ),
  };
}

function validateSearchRequest(
  layer: EvidenceLayerResult,
  request: EvidenceLayerSearchRequest,
): EvidenceLayerBlocker[] {
  const blockers: EvidenceLayerBlocker[] = [];
  const boundedId = (value: unknown): value is string =>
    boundedText(
      value,
      EVIDENCE_LAYER_BOUNDS.maxIdentifierCodeUnits,
      EVIDENCE_LAYER_BOUNDS.maxIdentifierBytes,
      false,
    );
  const actorTextIsBounded =
    boundedId(request.actor.userId) &&
    boundedId(request.actor.organisationId) &&
    boundedId(request.actor.projectId) &&
    request.actor.permissions.length <=
      EVIDENCE_LAYER_BOUNDS.maxActorPermissions &&
    request.actor.visibleDocumentIds.length <=
      EVIDENCE_LAYER_BOUNDS.maxVisibleDocumentIds &&
    request.actor.permissions.every(boundedId) &&
    request.actor.visibleDocumentIds.every(boundedId);
  const scopeTextIsBounded =
    boundedId(layer.scope.actorUserId) &&
    boundedId(layer.scope.organisationId) &&
    boundedId(layer.scope.projectId) &&
    validSha256(layer.scope.visibilitySha256) &&
    validSha256(layer.scope.permissionSnapshotSha256);
  let totalSourceBytes = 0;
  const sourcesAreBounded =
    layer.sources.length <= EVIDENCE_LAYER_BOUNDS.maxRequirementCitations &&
    layer.sources.every((source) => {
      const textIsBounded = boundedText(
        source.text,
        EVIDENCE_LAYER_BOUNDS.maxSnippetCodeUnits,
        EVIDENCE_LAYER_BOUNDS.maxSnippetBytes,
      );
      if (textIsBounded)
        totalSourceBytes += Buffer.byteLength(source.text, "utf8");
      return (
        textIsBounded &&
        boundedId(source.citationId) &&
        boundedId(source.organisationId) &&
        boundedId(source.projectId) &&
        boundedId(source.requirementId) &&
        boundedId(source.documentId) &&
        boundedId(source.documentVersionId) &&
        boundedText(
          source.sourceName,
          EVIDENCE_LAYER_BOUNDS.maxFilenameCodeUnits,
          EVIDENCE_LAYER_BOUNDS.maxFilenameBytes,
          false,
        ) &&
        validSha256(source.sourceSha256) &&
        validSha256(source.snippetSha256) &&
        boundedText(
          source.locator.label,
          EVIDENCE_LAYER_BOUNDS.maxLocatorCodeUnits,
          EVIDENCE_LAYER_BOUNDS.maxLocatorBytes,
        ) &&
        (source.locator.paragraphRef === null ||
          boundedText(
            source.locator.paragraphRef,
            EVIDENCE_LAYER_BOUNDS.maxLocatorCodeUnits,
            EVIDENCE_LAYER_BOUNDS.maxLocatorBytes,
          )) &&
        (source.locator.tableRef === null ||
          boundedText(
            source.locator.tableRef,
            EVIDENCE_LAYER_BOUNDS.maxLocatorCodeUnits,
            EVIDENCE_LAYER_BOUNDS.maxLocatorBytes,
          )) &&
        (source.locator.coordinateJson === null ||
          boundedText(
            source.locator.coordinateJson,
            EVIDENCE_LAYER_BOUNDS.maxLocatorCodeUnits,
            EVIDENCE_LAYER_BOUNDS.maxLocatorBytes,
          )) &&
        boundedId(source.verifier.userId) &&
        boundedText(
          source.verifier.name,
          EVIDENCE_LAYER_BOUNDS.maxVerifierNameCodeUnits,
          EVIDENCE_LAYER_BOUNDS.maxVerifierNameBytes,
          false,
        ) &&
        boundedId(source.verifier.verifiedAt) &&
        source.verifier.authority === "active_direct_tenant_evidence_approver"
      );
    }) &&
    totalSourceBytes <= EVIDENCE_LAYER_BOUNDS.maxTotalSnippetBytes;
  if (!actorTextIsBounded || !scopeTextIsBounded || !sourcesAreBounded)
    return [
      {
        code: "input_bound_exceeded",
        path: "request.actor|layer.scope|layer.sources",
        message:
          "Search inputs exceeded the deterministic evidence-layer bounds.",
      },
    ];
  if (layer.disposition !== "ready")
    blockers.push({
      code: "layer_not_ready",
      path: "layer.disposition",
      message: "Only a ready evidence layer may be searched.",
    });
  if (
    !boundedText(
      request.query,
      EVIDENCE_LAYER_BOUNDS.maxQueryCodeUnits,
      EVIDENCE_LAYER_BOUNDS.maxQueryBytes,
      false,
    ) ||
    !Number.isSafeInteger(request.limit) ||
    request.limit < 1 ||
    request.limit > EVIDENCE_LAYER_BOUNDS.maxSearchResults
  )
    blockers.push({
      code: "query_invalid",
      path: "request",
      message: "The lexical query or result limit exceeded its closed bounds.",
    });
  if (
    request.actor.userId !== layer.scope.actorUserId ||
    request.actor.organisationId !== layer.scope.organisationId ||
    request.actor.projectId !== layer.scope.projectId
  )
    blockers.push({
      code: "actor_scope_mismatch",
      path: "request.actor",
      message: "The search actor differs from the manifest-bound actor.",
    });
  const permissionSet = new Set(request.actor.permissions);
  for (const permission of REQUIRED_PERMISSIONS) {
    if (!permissionSet.has(permission))
      blockers.push({
        code: "permission_denied",
        path: "request.actor.permissions",
        message: `The authorised search requires ${permission}.`,
      });
  }
  if (
    hashStringList(request.actor.visibleDocumentIds) !==
    layer.scope.visibilitySha256
  )
    blockers.push({
      code: "document_visibility_mismatch",
      path: "request.actor.visibleDocumentIds",
      message: "Document visibility changed after the manifest was built.",
    });
  if (
    !validSha256(request.expectedManifestSha256) ||
    request.expectedManifestSha256.toLowerCase() !== layer.manifestSha256
  )
    blockers.push({
      code: "manifest_mismatch",
      path: "request.expectedManifestSha256",
      message: "The requested evidence manifest is stale or invalid.",
    });
  if (
    layer.sources.some(
      (source) =>
        source.organisationId !== layer.scope.organisationId ||
        source.projectId !== layer.scope.projectId ||
        source.snippetSha256 !== sha256Unchecked(source.text),
    )
  )
    blockers.push({
      code: "manifest_mismatch",
      path: "layer.sources",
      message: "The evidence source collection no longer matches its hashes.",
    });
  if (
    layer.manifestSha256 === null ||
    manifestSha256(layer) !== layer.manifestSha256
  )
    blockers.push({
      code: "manifest_mismatch",
      path: "layer.manifestSha256",
      message: "The evidence manifest failed deterministic re-verification.",
    });
  return blockers;
}

function tokenize(value: string): string[] {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Searches only the exact named-verified spans retained by buildEvidenceLayer. */
export function searchEvidenceLayer(
  layer: EvidenceLayerResult,
  request: EvidenceLayerSearchRequest,
): EvidenceLayerSearchResult {
  const blockers = validateSearchRequest(layer, request);
  if (blockers.length > 0)
    return {
      disposition: "blocked",
      matches: [],
      blockers,
      querySha256: null,
      searchManifestSha256: null,
    };
  const normalizedQuery = request.query.normalize("NFKC");
  if (
    normalizedQuery.length > EVIDENCE_LAYER_BOUNDS.maxQueryCodeUnits ||
    Buffer.byteLength(normalizedQuery, "utf8") >
      EVIDENCE_LAYER_BOUNDS.maxQueryBytes
  )
    return {
      disposition: "blocked",
      matches: [],
      blockers: [
        {
          code: "query_invalid",
          path: "request.query",
          message: "Normalised query text exceeded its closed bounds.",
        },
      ],
      querySha256: null,
      searchManifestSha256: null,
    };
  const queryTokens = [...new Set(tokenize(normalizedQuery))];
  if (
    queryTokens.length === 0 ||
    queryTokens.length > EVIDENCE_LAYER_BOUNDS.maxQueryTokens
  )
    return {
      disposition: "blocked",
      matches: [],
      blockers: [
        {
          code: "query_invalid",
          path: "request.query",
          message: "The lexical query requires one to 64 searchable tokens.",
        },
      ],
      querySha256: null,
      searchManifestSha256: null,
    };
  const querySha256 = sha256Unchecked(normalizedQuery);
  const phrase = normalizedQuery.toLocaleLowerCase("en").trim();
  const matches = layer.sources.flatMap((source) => {
    const normalizedSource = source.text
      .normalize("NFKC")
      .toLocaleLowerCase("en");
    const sourceTokens = tokenize(normalizedSource);
    const sourceTokenSet = new Set(sourceTokens);
    const matchedTokens = queryTokens.filter((token) =>
      sourceTokenSet.has(token),
    );
    const exactPhraseMatch =
      phrase.length > 0 && normalizedSource.includes(phrase);
    if (matchedTokens.length === 0 && !exactPhraseMatch) return [];
    const lexicalScoreBasisPoints = Math.min(
      10_000,
      Math.round((matchedTokens.length / queryTokens.length) * 8_000) +
        (exactPhraseMatch ? 2_000 : 0),
    );
    return [
      {
        source,
        lexicalScoreBasisPoints,
        exactPhraseMatch,
        matchedTokens,
      } satisfies EvidenceLayerSearchMatch,
    ];
  });
  matches.sort(
    (left, right) =>
      right.lexicalScoreBasisPoints - left.lexicalScoreBasisPoints ||
      Number(right.exactPhraseMatch) - Number(left.exactPhraseMatch) ||
      compareText(left.source.documentId, right.source.documentId) ||
      compareText(left.source.citationId, right.source.citationId),
  );
  const selected = matches.slice(0, request.limit);
  if (selected.length === 0)
    return {
      disposition: "abstain",
      matches: [],
      blockers: [],
      abstentionReason: "no_lexical_match",
      querySha256,
      searchManifestSha256: sha256Unchecked(
        JSON.stringify({
          policyVersion: EVIDENCE_LAYER_POLICY_VERSION,
          evidenceManifestSha256: layer.manifestSha256,
          querySha256,
          citationIds: [],
        }),
      ),
    };
  return {
    disposition: "ready",
    matches: selected,
    blockers: [],
    querySha256,
    searchManifestSha256: sha256Unchecked(
      JSON.stringify({
        policyVersion: EVIDENCE_LAYER_POLICY_VERSION,
        evidenceManifestSha256: layer.manifestSha256,
        querySha256,
        citationIds: selected.map(({ source }) => source.citationId),
      }),
    ),
  };
}
