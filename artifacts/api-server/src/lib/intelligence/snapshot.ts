import { createHash } from "node:crypto";

export const INTELLIGENCE_CAPABILITY_IDS = [
  "evidence_graph",
  "addendum_radar",
  "eligibility_passport",
  "grounded_copilot",
  "opportunity_radar",
  "response_studio",
  "submission_preflight",
  "clarification_assistant",
  "boq_sanity",
  "award_handoff",
  "evaluation_score_planner",
  "bid_security_integrity",
  "regulatory_watchtower",
  "consortium_responsibility",
  "portal_submission_rehearsal",
  "commercial_exposure",
  "nigerian_content_composer",
  "personnel_tailoring",
  "contract_deviation",
  "critical_path_simulator",
  "integrity_sentinel",
  "outcome_learning",
] as const;

export type IntelligenceCapabilityId =
  (typeof INTELLIGENCE_CAPABILITY_IDS)[number];

export type IntelligenceCapabilityState =
  | "review_ready"
  | "partial"
  | "empty"
  | "restricted"
  | "production_disabled";

export interface IntelligenceCitationSnapshot {
  id: string;
  sourceName: string;
  locator: string;
  excerpt?: string;
}

export interface IntelligenceCapabilitySnapshot {
  id: IntelligenceCapabilityId;
  state: IntelligenceCapabilityState;
  stateReason: string;
  summary?: string;
  reviewItemCount: number | null;
  citationCount: number | null;
  citations: IntelligenceCitationSnapshot[];
  lastUpdatedAt: string | null;
}

export interface IntelligenceCentreSnapshot {
  environment: "production" | "staging" | "development";
  productionAiEnabled: boolean;
  restrictedMode: boolean;
  generatedAt: string;
  project: {
    id: string;
    title: string;
    status: string;
    deadline: string | null;
  };
  capabilities: IntelligenceCapabilitySnapshot[];
}

export interface ProjectIntelligenceInput {
  environment: IntelligenceCentreSnapshot["environment"];
  productionAiEnabled: boolean;
  generatedAt: string;
  project: {
    id: string;
    title: string;
    status: string;
    deadline?: string | null;
    tenderReference?: string | null;
    restrictedMode: boolean;
    outcome?: string | null;
    outcomeClientConfirmed?: boolean;
  };
  documents: Array<{
    id: string;
    projectId: string;
    filename: string;
    type: string;
    redactionStatus: string;
    extractionStatus?: string | null;
    sha256?: string | null;
    contentText?: string | null;
    updatedAt?: string | null;
  }>;
  documentVersions: Array<{
    id: string;
    documentId: string;
    versionNumber: number;
    sha256: string;
    malwareStatus: string;
    quarantineStatus: string;
    addendumStatus: string;
    createdAt?: string | null;
  }>;
  requirements: Array<{
    id: string;
    text: string;
    category: string;
    isMandatory: boolean;
    reviewStatus: string;
    sourceDocId?: string | null;
    pageRef?: string | null;
    clauseRef?: string | null;
    confidence?: string | null;
    reviewerNotes?: string | null;
    updatedAt?: string | null;
  }>;
  requirementCitations: Array<{
    id: string;
    requirementId: string;
    documentVersionId: string;
    pageNumber?: number | null;
    paragraphRef?: string | null;
    tableRef?: string | null;
    coordinateJson?: string | null;
    sourceSnippet: string;
    sourceSnippetHash: string;
    verificationStatus: string;
    verifiedByUserId?: string | null;
    verifiedByName?: string | null;
    verifiedAt?: string | null;
    verifierAuthority?:
      | "active_direct_tenant_evidence_approver"
      | "not_authorized";
    updatedAt?: string | null;
  }>;
  evidence: Array<{
    id: string;
    requirementId: string;
    documentId?: string | null;
    evidenceStatus: string;
    excerpt?: string | null;
    suggested?: boolean | null;
    confirmedBy?: string | null;
    updatedAt?: string | null;
  }>;
  defects: Array<{
    id: string;
    severity: string;
    status: string;
    updatedAt?: string | null;
  }>;
  boqChecks: Array<{
    id: string;
    sourceDocId?: string | null;
    status: string;
    severity: string;
    updatedAt?: string | null;
  }>;
  vaultItems: Array<{
    id: string;
    artefactType: string;
    status: string;
    expiryDate?: string | null;
    sourceDocumentId?: string | null;
    sha256?: string | null;
    updatedAt?: string | null;
  }>;
  capabilityItems: Array<{
    id: string;
    claimType: string;
    approvedStatus: string;
    evidenceDocId?: string | null;
    verifierId?: string | null;
    verifierName?: string | null;
    verifiedAt?: string | null;
    updatedAt?: string | null;
  }>;
  drafts: Array<{
    id: string;
    status: string;
    currentVersionNumber: number;
    updatedAt?: string | null;
  }>;
  draftVersions: Array<{
    id: string;
    draftId: string;
    versionNumber: number;
    contentHash: string;
    authorUserId?: string | null;
    createdAt?: string | null;
  }>;
  draftClaims: Array<{
    id: string;
    draftVersionId: string;
    groundingStatus: string;
    reviewerUserId?: string | null;
    reviewedAt?: string | null;
    createdAt?: string | null;
  }>;
  workTasks: Array<{
    id: string;
    status: string;
    dueAt?: string | null;
    updatedAt?: string | null;
  }>;
  opportunities: Array<{
    id: string;
    reference: string;
    title: string;
    sourceType: string;
    status: string;
    submissionDeadline?: string | null;
    updatedAt?: string | null;
  }>;
  packages: Array<{
    id: string;
    status: string;
    currentVersionNumber: number;
    updatedAt?: string | null;
  }>;
  packageVersions: Array<{
    id: string;
    packageId: string;
    versionNumber: number;
    sourceSnapshotHash: string;
    manifestHash: string;
    docxSha256?: string | null;
    pdfSha256?: string | null;
    zipSha256?: string | null;
    renderQaStatus: string;
    generatedByUserId?: string | null;
    createdAt?: string | null;
  }>;
  packageSignoffs: Array<{
    id: string;
    packageVersionId: string;
    signerUserId: string;
    signerRole: string;
    signerAuthority: string;
    intentStatement: string;
    documentHash: string;
    trustedTimestamp?: string | null;
    mfaEvidence: string;
    deviceEventEvidence: string;
  }>;
  reportStatuses: Array<{
    id: string;
    version: number;
    status: string;
    reviewerId?: string | null;
    reviewerName?: string | null;
    attestation?: string | null;
    engineVersion?: string | null;
    promptPackVersion?: string | null;
    modelId?: string | null;
    taxonomyVersion?: string | null;
    signedOffAt?: string | null;
    updatedAt?: string | null;
  }>;
}

const ACCEPTED_REQUIREMENT_STATES = new Set(["confirmed", "edited"]);
const CONFIRMED_EVIDENCE_STATES = new Set(["present", "not_applicable"]);
const INCLUDED_DOCUMENT_STATES = new Set(["included", "redacted"]);
// Package delivery/export has separate records; `signed` is the documented
// immutable package state. Free-text or draft-like states therefore fail closed.
const FINAL_PACKAGE_STATES = new Set(["signed"]);
const AWARDED_OUTCOMES = new Set(["won", "awarded", "contract_awarded"]);
const SHA_256 = /^[a-f0-9]{64}$/iu;

function isSha256(value: string | null | undefined): value is string {
  return Boolean(value && SHA_256.test(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function latestDate(values: Array<string | null | undefined>): string | null {
  const valid = values
    .flatMap((value) => {
      const epoch = validDate(value);
      return epoch == null || !value ? [] : [{ epoch, value }];
    })
    .sort((left, right) => right.epoch - left.epoch);
  return valid[0]?.value ?? null;
}

function clippedExcerpt(value: string): string | undefined {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized) return undefined;
  return normalized.length <= 280
    ? normalized
    : `${normalized.slice(0, 277)}...`;
}

function locatorFor(input: {
  pageNumber?: number | null;
  paragraphRef?: string | null;
  tableRef?: string | null;
  coordinateJson?: string | null;
}): string {
  const parts = [
    input.pageNumber != null ? `Page ${input.pageNumber}` : null,
    input.paragraphRef?.trim() || null,
    input.tableRef?.trim() || null,
    input.coordinateJson != null ? "Coordinates retained" : null,
  ].filter((value): value is string => Boolean(value));
  return parts.join(" · ");
}

function hasValidExactLocator(input: {
  pageNumber?: number | null;
  paragraphRef?: string | null;
  tableRef?: string | null;
  coordinateJson?: string | null;
}): boolean {
  if (
    input.pageNumber != null &&
    (!Number.isSafeInteger(input.pageNumber) || input.pageNumber < 1)
  )
    return false;
  if (input.coordinateJson != null) {
    try {
      JSON.parse(input.coordinateJson);
    } catch {
      return false;
    }
  }
  return Boolean(
    input.pageNumber != null ||
    input.paragraphRef?.trim() ||
    input.tableRef?.trim() ||
    input.coordinateJson?.trim(),
  );
}

function capability(
  value: IntelligenceCapabilitySnapshot,
): IntelligenceCapabilitySnapshot {
  return value;
}

/**
 * Produces a tenant-scoped, content-minimised read model for the Intelligence
 * Centre. It never invokes a model and never mutates workflow state. Empty and
 * partial evidence remain explicit rather than being converted into a score or
 * approval.
 */
export function buildIntelligenceCentreSnapshot(
  input: ProjectIntelligenceInput,
): IntelligenceCentreSnapshot {
  const documentById = new Map(
    input.documents
      .filter((item) => item.projectId === input.project.id)
      .map((item) => [item.id, item]),
  );
  const versionById = new Map(
    input.documentVersions.map((item) => [item.id, item]),
  );
  const versionsByDocumentId = new Map<
    string,
    ProjectIntelligenceInput["documentVersions"]
  >();
  for (const version of input.documentVersions) {
    const versions = versionsByDocumentId.get(version.documentId) ?? [];
    versions.push(version);
    versionsByDocumentId.set(version.documentId, versions);
  }
  const currentVersionByDocumentId = new Map<
    string,
    ProjectIntelligenceInput["documentVersions"][number]
  >();
  for (const [documentId, versions] of versionsByDocumentId) {
    const validVersions = versions.filter(
      (version) =>
        Number.isSafeInteger(version.versionNumber) &&
        version.versionNumber > 0,
    );
    const highestVersion = validVersions.reduce(
      (highest, version) => Math.max(highest, version.versionNumber),
      0,
    );
    const candidates = validVersions.filter(
      (version) => version.versionNumber === highestVersion,
    );
    if (candidates.length === 1) {
      currentVersionByDocumentId.set(documentId, candidates[0]!);
    }
  }
  const requirementById = new Map(
    input.requirements.map((item) => [item.id, item]),
  );
  const isSafeCurrentVersion = (
    version: ProjectIntelligenceInput["documentVersions"][number],
  ): boolean => {
    const document = documentById.get(version.documentId);
    const currentVersion = currentVersionByDocumentId.get(version.documentId);
    return Boolean(
      document &&
      currentVersion?.id === version.id &&
      INCLUDED_DOCUMENT_STATES.has(document.redactionStatus) &&
      document.extractionStatus === "extracted" &&
      isSha256(document.sha256) &&
      isSha256(version.sha256) &&
      document.sha256.toLowerCase() === version.sha256.toLowerCase() &&
      version.malwareStatus === "clean" &&
      version.quarantineStatus === "cleared",
    );
  };
  const safeCurrentDocumentIds = new Set(
    input.documentVersions
      .filter(isSafeCurrentVersion)
      .map((version) => version.documentId),
  );
  const verifiedCitations = input.requirementCitations.flatMap((citation) => {
    const requirement = requirementById.get(citation.requirementId);
    const version = versionById.get(citation.documentVersionId);
    const document = version ? documentById.get(version.documentId) : undefined;
    const exactSnippetHash = sha256(citation.sourceSnippet);
    const verifiedAt = validDate(citation.verifiedAt);
    const evaluatedAt = validDate(input.generatedAt);
    const valid = Boolean(
      requirement &&
      version &&
      document &&
      requirement.sourceDocId === document.id &&
      isSafeCurrentVersion(version) &&
      isSha256(citation.sourceSnippetHash) &&
      citation.sourceSnippetHash.toLowerCase() === exactSnippetHash &&
      citation.sourceSnippet.length > 0 &&
      document.contentText?.includes(citation.sourceSnippet) &&
      citation.verificationStatus === "verified" &&
      hasValidExactLocator(citation) &&
      citation.verifiedByUserId?.trim() &&
      citation.verifiedByName?.trim() &&
      citation.verifierAuthority === "active_direct_tenant_evidence_approver" &&
      verifiedAt != null &&
      evaluatedAt != null &&
      verifiedAt <= evaluatedAt,
    );
    if (!valid || !version || !document || !citation.verifiedAt) return [];
    return [
      {
        id: citation.id,
        requirementId: citation.requirementId,
        snapshot: {
          id: citation.id,
          sourceName: document.filename,
          locator: locatorFor(citation),
          excerpt: clippedExcerpt(citation.sourceSnippet),
        } satisfies IntelligenceCitationSnapshot,
      },
    ];
  });
  const acceptedRequirements = input.requirements.filter((item) =>
    ACCEPTED_REQUIREMENT_STATES.has(item.reviewStatus),
  );
  const acceptedRequirementIds = new Set(
    acceptedRequirements.map((item) => item.id),
  );
  const acceptedCitations = verifiedCitations.filter((citation) =>
    acceptedRequirementIds.has(citation.requirementId),
  );
  const citedRequirementIds = new Set(
    acceptedCitations.map((citation) => citation.requirementId),
  );
  const confirmedEvidence = input.evidence.filter((item) => {
    if (
      item.suggested === true ||
      !item.confirmedBy?.trim() ||
      !acceptedRequirementIds.has(item.requirementId) ||
      !CONFIRMED_EVIDENCE_STATES.has(item.evidenceStatus)
    ) {
      return false;
    }
    if (item.evidenceStatus === "not_applicable") return true;
    const document = item.documentId
      ? documentById.get(item.documentId)
      : undefined;
    return Boolean(
      document &&
      safeCurrentDocumentIds.has(document.id) &&
      item.excerpt?.trim() &&
      document.contentText?.includes(item.excerpt),
    );
  });
  const coveredRequirementIds = new Set(
    confirmedEvidence.map((item) => item.requirementId),
  );
  const uncoveredMandatory = acceptedRequirements.filter(
    (item) => item.isMandatory && !coveredRequirementIds.has(item.id),
  );
  const uncitedRequirements = acceptedRequirements.filter(
    (item) => !citedRequirementIds.has(item.id),
  );
  const uncoveredRequirements = acceptedRequirements.filter(
    (item) => !coveredRequirementIds.has(item.id),
  );
  const includedDocuments = [...documentById.values()].filter((item) =>
    INCLUDED_DOCUMENT_STATES.has(item.redactionStatus),
  );
  const boqDocuments = includedDocuments.filter((item) => item.type === "boq");
  const safeBoqDocuments = boqDocuments.filter((item) =>
    safeCurrentDocumentIds.has(item.id),
  );
  const safeBoqDocumentIds = new Set(safeBoqDocuments.map((item) => item.id));
  const boundBoqChecks = input.boqChecks.filter(
    (item) =>
      Boolean(item.sourceDocId) && safeBoqDocumentIds.has(item.sourceDocId!),
  );
  const unboundBoqChecks = input.boqChecks.filter(
    (item) => !boundBoqChecks.includes(item),
  );
  const checkedBoqDocumentIds = new Set(
    boundBoqChecks.flatMap((item) =>
      item.sourceDocId ? [item.sourceDocId] : [],
    ),
  );
  const uncheckedBoqDocuments = safeBoqDocuments.filter(
    (item) => !checkedBoqDocumentIds.has(item.id),
  );
  const unsafeBoqDocuments = boqDocuments.filter(
    (item) => !safeCurrentDocumentIds.has(item.id),
  );

  const evidenceState: IntelligenceCapabilityState =
    acceptedRequirements.length === 0 && confirmedEvidence.length === 0
      ? "empty"
      : acceptedRequirements.length === 0 ||
          uncitedRequirements.length > 0 ||
          uncoveredRequirements.length > 0
        ? "partial"
        : "review_ready";
  const evidenceGraph = capability({
    id: "evidence_graph",
    state: evidenceState,
    stateReason:
      evidenceState === "empty"
        ? "No reviewed requirement and approved evidence graph is available for this pursuit."
        : evidenceState === "partial"
          ? "The graph contains reviewable records, but mandatory coverage or first-class verified citations are incomplete."
          : "Reviewed requirements, approved evidence and verified source citations are connected for human inspection.",
    summary: `${acceptedRequirements.length} accepted requirement(s), ${confirmedEvidence.length} source-grounded named-review evidence mapping(s), ${uncitedRequirements.length} citation gap(s), ${uncoveredRequirements.length} evidence gap(s), ${uncoveredMandatory.length} mandatory evidence gap(s).`,
    reviewItemCount: new Set([
      ...uncitedRequirements.map((item) => item.id),
      ...uncoveredRequirements.map((item) => item.id),
    ]).size,
    citationCount: acceptedCitations.length,
    citations: acceptedCitations.slice(0, 20).map((item) => item.snapshot),
    lastUpdatedAt: latestDate([
      ...input.requirements.map((item) => item.updatedAt),
      ...input.evidence.map((item) => item.updatedAt),
      ...input.requirementCitations.map((item) => item.updatedAt),
    ]),
  });

  const projectDocumentVersions = input.documentVersions.filter((item) =>
    documentById.has(item.documentId),
  );
  const addendumVersions = projectDocumentVersions.filter(
    (item) =>
      item.addendumStatus !== "not_assessed" &&
      isSha256(item.sha256) &&
      item.malwareStatus === "clean" &&
      item.quarantineStatus === "cleared",
  );
  const unsafeOrUnassessedVersions = projectDocumentVersions.filter(
    (item) => !addendumVersions.includes(item),
  );
  const addendumRadar = capability({
    id: "addendum_radar",
    state:
      projectDocumentVersions.length === 0
        ? "empty"
        : unsafeOrUnassessedVersions.length > 0
          ? "partial"
          : "review_ready",
    stateReason:
      projectDocumentVersions.length === 0
        ? "No immutable tender or addendum versions are connected to this pursuit."
        : unsafeOrUnassessedVersions.length > 0
          ? "One or more project document versions are unsafe or still need an addendum-impact assessment."
          : "Every connected project document version is safe and has a recorded addendum assessment for reviewer confirmation.",
    summary: `${projectDocumentVersions.length} project version(s), ${addendumVersions.length} safe and assessed, ${unsafeOrUnassessedVersions.length} unsafe or not assessed.`,
    reviewItemCount: unsafeOrUnassessedVersions.length,
    citationCount: 0,
    citations: [],
    lastUpdatedAt: latestDate(
      projectDocumentVersions.map((item) => item.createdAt),
    ),
  });

  const now = validDate(input.generatedAt);
  const expiredVault = input.vaultItems.filter((item) => {
    const expiry = validDate(item.expiryDate);
    return now == null || (expiry != null && expiry < now);
  });
  const verifiedCapabilities = input.capabilityItems.filter((item) => {
    const evidenceDocument = item.evidenceDocId
      ? documentById.get(item.evidenceDocId)
      : undefined;
    return Boolean(
      item.approvedStatus === "approved" &&
      item.verifierId?.trim() &&
      item.verifierName?.trim() &&
      validDate(item.verifiedAt) != null &&
      evidenceDocument &&
      safeCurrentDocumentIds.has(evidenceDocument.id) &&
      isSha256(evidenceDocument.sha256),
    );
  });
  const verifiedCapabilityDocumentIds = new Set(
    verifiedCapabilities.flatMap((item) =>
      item.evidenceDocId ? [item.evidenceDocId] : [],
    ),
  );
  const activeProvenanceVaultItems = input.vaultItems.filter((item) => {
    const sourceDocument = item.sourceDocumentId
      ? documentById.get(item.sourceDocumentId)
      : undefined;
    const expiry = validDate(item.expiryDate);
    return Boolean(
      item.status === "active" &&
      now != null &&
      (expiry == null || expiry >= now) &&
      sourceDocument &&
      safeCurrentDocumentIds.has(sourceDocument.id) &&
      isSha256(item.sha256) &&
      isSha256(sourceDocument.sha256) &&
      item.sha256.toLowerCase() === sourceDocument.sha256.toLowerCase() &&
      verifiedCapabilityDocumentIds.has(sourceDocument.id),
    );
  });
  const unapprovedCapabilities = input.capabilityItems.filter(
    (item) => !verifiedCapabilities.includes(item),
  );
  const invalidVaultItems = input.vaultItems.filter(
    (item) => !activeProvenanceVaultItems.includes(item),
  );
  const passportItemCount =
    input.vaultItems.length + input.capabilityItems.length;
  const passportIssues =
    invalidVaultItems.length + unapprovedCapabilities.length;
  const eligibilityPassport = capability({
    id: "eligibility_passport",
    state:
      passportItemCount === 0
        ? "empty"
        : input.vaultItems.length === 0 || passportIssues > 0
          ? "partial"
          : "review_ready",
    stateReason:
      passportItemCount === 0
        ? "No Vault or approved capability record is available for tender-specific eligibility review."
        : input.vaultItems.length === 0 || passportIssues > 0
          ? "Eligibility evidence is missing an active hash-bound Vault source or named, timestamped verification."
          : "Active Vault evidence is hash-bound to a safe source and carries named verification, subject to tender-specific applicability review.",
    summary: `${activeProvenanceVaultItems.length} active provenance-complete Vault item(s), ${expiredVault.length} expired or time-unverifiable item(s), ${invalidVaultItems.length} Vault item(s) lacking safe provenance, and ${unapprovedCapabilities.length} capability record(s) lacking named verification.`,
    reviewItemCount: passportIssues,
    citationCount: 0,
    citations: [],
    lastUpdatedAt: latestDate([
      ...input.vaultItems.map((item) => item.updatedAt),
      ...input.capabilityItems.map((item) => item.updatedAt),
    ]),
  });

  const copilotFacts = acceptedRequirements.filter((requirement) =>
    acceptedCitations.some(
      (citation) => citation.requirementId === requirement.id,
    ),
  );
  const copilotCitations = acceptedCitations.filter((citation) =>
    copilotFacts.some(
      (requirement) => requirement.id === citation.requirementId,
    ),
  );
  const groundedCopilot = capability({
    id: "grounded_copilot",
    state: input.project.restrictedMode
      ? "restricted"
      : copilotFacts.length > 0
        ? "review_ready"
        : input.productionAiEnabled
          ? "partial"
          : "production_disabled",
    stateReason: input.project.restrictedMode
      ? "Restricted Mode blocks any provider that is not explicitly approved for this data boundary."
      : copilotFacts.length > 0
        ? "Accepted facts with verified citations are available to the extractive answer planner; users must inspect every source."
        : input.productionAiEnabled
          ? "Model execution may be enabled, but no accepted cited fact is available for a grounded answer."
          : "Production model execution is disabled and there is no connected verified fact set for extractive answers.",
    summary: `${copilotFacts.length} accepted fact(s) have first-class verified citations. Unsupported questions must abstain.`,
    reviewItemCount: copilotFacts.length,
    citationCount: copilotCitations.length,
    citations: copilotCitations.slice(0, 20).map((item) => item.snapshot),
    lastUpdatedAt: evidenceGraph.lastUpdatedAt,
  });

  const tenderReference = input.project.tenderReference?.trim();
  const openOpportunities = input.opportunities.filter(
    (item) =>
      Boolean(tenderReference) &&
      item.reference === tenderReference &&
      !new Set(["closed", "withdrawn", "archived"]).has(item.status),
  );
  const opportunityRadar = capability({
    id: "opportunity_radar",
    state: openOpportunities.length > 0 ? "review_ready" : "empty",
    stateReason:
      openOpportunities.length > 0
        ? "Recorded opportunities are available for deterministic fit review; no award probability is calculated."
        : "No authoritative opportunity record is connected to this organisation and pursuit.",
    summary: `${openOpportunities.length} open opportunity record(s); bid/no-bid remains a human decision.`,
    reviewItemCount: openOpportunities.length,
    citationCount: 0,
    citations: [],
    lastUpdatedAt: latestDate(openOpportunities.map((item) => item.updatedAt)),
  });

  const currentDraftVersionByDraftId = new Map(
    input.drafts.flatMap((draft) => {
      const version = input.draftVersions.find(
        (candidate) =>
          candidate.draftId === draft.id &&
          candidate.versionNumber === draft.currentVersionNumber &&
          isSha256(candidate.contentHash) &&
          Boolean(candidate.authorUserId?.trim()),
      );
      return version ? [[draft.id, version] as const] : [];
    }),
  );
  const currentDraftVersionIds = new Set(
    [...currentDraftVersionByDraftId.values()].map((version) => version.id),
  );
  const unboundClaims = input.draftClaims.filter(
    (claim) => !currentDraftVersionIds.has(claim.draftVersionId),
  );
  const unsupportedClaims = input.draftClaims.filter(
    (item) =>
      item.groundingStatus !== "verified" ||
      !item.reviewerUserId?.trim() ||
      validDate(item.reviewedAt) == null,
  );
  const draftsWithoutCurrentVersion = input.drafts.filter(
    (draft) => !currentDraftVersionByDraftId.has(draft.id),
  );
  const draftsWithoutGroundedClaim = input.drafts.filter((draft) => {
    const version = currentDraftVersionByDraftId.get(draft.id);
    return (
      !version ||
      !input.draftClaims.some(
        (claim) =>
          claim.draftVersionId === version.id &&
          claim.groundingStatus === "verified" &&
          Boolean(claim.reviewerUserId?.trim()) &&
          validDate(claim.reviewedAt) != null,
      )
    );
  });
  const responseIssueCount = new Set([
    ...draftsWithoutCurrentVersion.map((item) => `draft:${item.id}`),
    ...draftsWithoutGroundedClaim.map((item) => `draft:${item.id}`),
    ...unboundClaims.map((item) => `claim:${item.id}`),
    ...unsupportedClaims.map((item) => `claim:${item.id}`),
  ]).size;
  const responseStudio = capability({
    id: "response_studio",
    state:
      input.drafts.length === 0
        ? "empty"
        : input.draftClaims.length === 0 || responseIssueCount > 0
          ? "partial"
          : "review_ready",
    stateReason:
      input.drafts.length === 0
        ? "No versioned response draft is connected to this pursuit."
        : input.draftClaims.length === 0 || responseIssueCount > 0
          ? "Every current draft needs an immutable authored version and at least one named-review grounded claim; unbound claims fail closed."
          : "Every current draft is version-bound and has a named-review grounded claim for human inspection.",
    summary: `${input.drafts.length} draft section(s), ${input.draftClaims.length} current-version claim(s), ${draftsWithoutCurrentVersion.length} draft version gap(s), ${draftsWithoutGroundedClaim.length} draft grounding gap(s), ${unboundClaims.length} unbound claim(s), ${unsupportedClaims.length} claim review gap(s).`,
    reviewItemCount: responseIssueCount,
    citationCount: 0,
    citations: [],
    lastUpdatedAt: latestDate([
      ...input.drafts.map((item) => item.updatedAt),
      ...input.draftClaims.map((item) => item.createdAt),
    ]),
  });

  const unreviewedRequirements = input.requirements.filter(
    (item) =>
      !new Set(["confirmed", "edited", "rejected"]).has(item.reviewStatus),
  );
  const openFatalDefects = input.defects.filter(
    (item) =>
      item.status === "open" &&
      new Set(["fatal", "likely_fatal"]).has(item.severity),
  );
  const openBoqExceptions = boundBoqChecks.filter(
    (item) => item.status === "flagged",
  );
  const boqBindingGaps = unboundBoqChecks.length + uncheckedBoqDocuments.length;
  const incompleteDocuments = includedDocuments.filter(
    (item) => !safeCurrentDocumentIds.has(item.id),
  );
  const deterministicPreflightBlockers =
    unreviewedRequirements.length +
    uncoveredMandatory.length +
    openFatalDefects.length +
    openBoqExceptions.length +
    boqBindingGaps +
    incompleteDocuments.length;

  const deadline = validDate(input.project.deadline);
  const deadlineReady = Boolean(
    now != null && deadline != null && deadline > now,
  );
  const addendumReady =
    projectDocumentVersions.length > 0 &&
    unsafeOrUnassessedVersions.length === 0;

  const currentPackageVersionByPackageId = new Map(
    input.packages.flatMap((item) => {
      const version = input.packageVersions.find(
        (candidate) =>
          candidate.packageId === item.id &&
          FINAL_PACKAGE_STATES.has(item.status) &&
          candidate.versionNumber === item.currentVersionNumber &&
          isSha256(candidate.sourceSnapshotHash) &&
          isSha256(candidate.manifestHash) &&
          Boolean(candidate.generatedByUserId?.trim()) &&
          candidate.renderQaStatus === "passed" &&
          [candidate.docxSha256, candidate.pdfSha256, candidate.zipSha256].some(
            isSha256,
          ),
      );
      return version ? [[item.id, version] as const] : [];
    }),
  );
  const packagesReady =
    input.packages.length > 0 &&
    currentPackageVersionByPackageId.size === input.packages.length;
  const signedCurrentPackageVersionIds = new Set(
    [...currentPackageVersionByPackageId.values()].flatMap((version) => {
      const outputHashes = new Set(
        [version.docxSha256, version.pdfSha256, version.zipSha256]
          .filter(isSha256)
          .map((hash) => hash.toLowerCase()),
      );
      const validSignoff = input.packageSignoffs.some((signoff) => {
        const trustedTimestamp = validDate(signoff.trustedTimestamp);
        return Boolean(
          signoff.packageVersionId === version.id &&
          signoff.signerUserId.trim() &&
          signoff.signerRole.trim() &&
          signoff.signerAuthority.trim() &&
          signoff.intentStatement.trim() &&
          isSha256(signoff.documentHash) &&
          outputHashes.has(signoff.documentHash.toLowerCase()) &&
          now != null &&
          trustedTimestamp != null &&
          trustedTimestamp <= now &&
          signoff.mfaEvidence.trim() &&
          signoff.deviceEventEvidence.trim(),
        );
      });
      return validSignoff ? [version.id] : [];
    }),
  );
  const packageSignoffsReady =
    packagesReady &&
    signedCurrentPackageVersionIds.size ===
      currentPackageVersionByPackageId.size;

  const reportVersions = input.reportStatuses.filter(
    (item) => Number.isSafeInteger(item.version) && item.version > 0,
  );
  const highestReportVersion = reportVersions.reduce(
    (highest, item) => Math.max(highest, item.version),
    0,
  );
  const currentReportCandidates = reportVersions.filter(
    (item) => item.version === highestReportVersion,
  );
  const currentReport =
    currentReportCandidates.length === 1
      ? currentReportCandidates[0]
      : undefined;
  const currentReportSignedOffAt = validDate(currentReport?.signedOffAt);
  const signedReportReady = Boolean(
    currentReport &&
    currentReport.status === "signed_off" &&
    currentReport.reviewerId?.trim() &&
    currentReport.reviewerName?.trim() &&
    currentReport.attestation?.trim() &&
    currentReport.engineVersion?.trim() &&
    currentReport.promptPackVersion?.trim() &&
    currentReport.modelId?.trim() &&
    currentReport.taxonomyVersion?.trim() &&
    now != null &&
    currentReportSignedOffAt != null &&
    currentReportSignedOffAt <= now,
  );

  const preflightProofGaps = [
    evidenceState === "review_ready",
    deadlineReady,
    addendumReady,
    packagesReady,
    packageSignoffsReady,
    signedReportReady,
  ].filter((ready) => !ready).length;
  const preflightBlockers = deterministicPreflightBlockers + preflightProofGaps;
  const submissionPreflight = capability({
    id: "submission_preflight",
    state:
      includedDocuments.length === 0
        ? "empty"
        : preflightBlockers > 0
          ? "partial"
          : "review_ready",
    stateReason:
      includedDocuments.length === 0
        ? "No included pursuit documents are available for deterministic preflight."
        : preflightBlockers > 0
          ? "Recorded deterministic blockers require review; this snapshot never authorises submission."
          : "The current source set, deadline, addendum assessment, package, sign-off and signed report are proven; a named release decision is still required.",
    summary: `${preflightBlockers} counted blocker or proof gap(s): ${unreviewedRequirements.length} unreviewed requirement(s), ${uncoveredMandatory.length} mandatory evidence gap(s), ${openFatalDefects.length} material defect(s), ${openBoqExceptions.length} current-record BOQ exception(s), ${boqBindingGaps} BOQ binding gap(s), ${incompleteDocuments.length} document lifecycle gap(s), ${preflightProofGaps} release-proof gap(s).`,
    reviewItemCount: preflightBlockers,
    citationCount: acceptedCitations.length,
    citations: acceptedCitations.slice(0, 20).map((item) => item.snapshot),
    lastUpdatedAt: latestDate([
      evidenceGraph.lastUpdatedAt,
      ...input.defects.map((item) => item.updatedAt),
      ...input.boqChecks.map((item) => item.updatedAt),
      ...input.packageVersions.map((item) => item.createdAt),
      ...input.reportStatuses.map((item) => item.updatedAt),
    ]),
  });

  const clarificationCandidates = input.requirements.filter((item) => {
    const text =
      `${item.confidence ?? ""} ${item.reviewerNotes ?? ""}`.toLowerCase();
    return (
      item.reviewStatus === "suggested" ||
      /unclear|ambiguous|contradict|clarif|unpriceable/u.test(text)
    );
  });
  const citedClarificationRequirementIds = new Set(
    verifiedCitations
      .filter((citation) =>
        clarificationCandidates.some(
          (requirement) => requirement.id === citation.requirementId,
        ),
      )
      .map((citation) => citation.requirementId),
  );
  const uncitedClarificationCandidates = clarificationCandidates.filter(
    (item) => !citedClarificationRequirementIds.has(item.id),
  );
  const clarificationCitations = verifiedCitations.filter((citation) =>
    clarificationCandidates.some(
      (requirement) => requirement.id === citation.requirementId,
    ),
  );
  const clarificationAssistant = capability({
    id: "clarification_assistant",
    state: input.project.restrictedMode
      ? "restricted"
      : clarificationCandidates.length === 0
        ? "empty"
        : uncitedClarificationCandidates.length > 0
          ? "partial"
          : "review_ready",
    stateReason: input.project.restrictedMode
      ? "Restricted Mode prevents unapproved processing; no clarification is sent or drafted externally."
      : clarificationCandidates.length === 0
        ? "No recorded ambiguity signal is available for a clarification proposal."
        : uncitedClarificationCandidates.length > 0
          ? "One or more clarification candidates lack a verified in-project source citation and remain blocked for review."
          : "Every clarification candidate has a verified in-project source citation for a human-reviewed question proposal.",
    summary: `${clarificationCandidates.length} requirement(s) carry an ambiguity or review signal; ${uncitedClarificationCandidates.length} lack verified source coverage. Valo never sends a clarification.`,
    reviewItemCount: clarificationCandidates.length,
    citationCount: clarificationCitations.length,
    citations: clarificationCitations.slice(0, 20).map((item) => item.snapshot),
    lastUpdatedAt: latestDate(
      clarificationCandidates.map((item) => item.updatedAt),
    ),
  });

  const boqSourceIssueCount =
    unboundBoqChecks.length +
    uncheckedBoqDocuments.length +
    unsafeBoqDocuments.length;
  const boqReviewItemCount = openBoqExceptions.length + boqSourceIssueCount;
  const boqSanity = capability({
    id: "boq_sanity",
    state:
      boqDocuments.length === 0 && input.boqChecks.length === 0
        ? "empty"
        : boqSourceIssueCount > 0 || boundBoqChecks.length === 0
          ? "partial"
          : "review_ready",
    stateReason:
      boqDocuments.length === 0 && input.boqChecks.length === 0
        ? "No included BOQ is available for deterministic checking."
        : boqSourceIssueCount > 0 || boundBoqChecks.length === 0
          ? "BOQ document lifecycle or check-to-source binding is incomplete; without a check version, arithmetic is not version-proven."
          : "Recorded checks are bound to safe current BOQ documents for current-record commercial review; arithmetic is not version-proven and no price is selected or changed.",
    summary: `${boundBoqChecks.length} safe current-record check(s), ${unboundBoqChecks.length} unbound or unsafe check(s), ${uncheckedBoqDocuments.length} unchecked safe BOQ(s), ${unsafeBoqDocuments.length} unsafe BOQ(s), ${openBoqExceptions.length} open current-record exception(s).`,
    reviewItemCount: boqReviewItemCount,
    citationCount: 0,
    citations: [],
    lastUpdatedAt: latestDate([
      ...boqDocuments.map((item) => item.updatedAt),
      ...input.boqChecks.map((item) => item.updatedAt),
    ]),
  });

  const awarded =
    input.project.outcomeClientConfirmed === true &&
    AWARDED_OUTCOMES.has(input.project.outcome ?? "");
  const openHandoffTasks = input.workTasks.filter(
    (item) => item.status !== "completed" && item.status !== "cancelled",
  );
  const awardHandoff = capability({
    id: "award_handoff",
    state: !awarded ? "empty" : "partial",
    stateReason: !awarded
      ? "No client-confirmed award outcome is recorded, so delivery obligations are not inferred."
      : "A client-confirmed award exists, but generic work tasks are not accepted source-bound contract obligations and cannot prove handoff readiness.",
    summary: `${openHandoffTasks.length} open generic task(s) are visible but excluded from handoff proof. External notices and downstream actions remain manual.`,
    reviewItemCount: openHandoffTasks.length,
    citationCount: 0,
    citations: [],
    lastUpdatedAt: latestDate(
      input.workTasks.map((item) => item.updatedAt ?? item.dueAt),
    ),
  });

  const acceptedRequirementCitationById = new Map(
    acceptedCitations.map((citation) => [citation.requirementId, citation]),
  );
  const matchingAcceptedRequirements = (pattern: RegExp) =>
    acceptedRequirements.filter((requirement) =>
      pattern.test(`${requirement.category} ${requirement.text}`),
    );
  const citationsForRequirements = (
    requirements: typeof acceptedRequirements,
  ) =>
    requirements.flatMap((requirement) => {
      const citation = acceptedRequirementCitationById.get(requirement.id);
      return citation ? [citation] : [];
    });

  const scoringRequirements = matchingAcceptedRequirements(
    /\b(score|scoring|evaluation|mark|marks|point|points|weight|weighted)\b/iu,
  );
  const scoringCitations = citationsForRequirements(scoringRequirements);
  const evaluationScorePlanner = capability({
    id: "evaluation_score_planner",
    state: scoringRequirements.length === 0 ? "empty" : "partial",
    stateReason:
      scoringRequirements.length === 0
        ? "No accepted, cited published-evaluation criterion is connected to this pursuit."
        : "Published-evaluation signals exist, but no reviewed structured scoring rule pack is connected; Valo does not predict evaluator behaviour or award probability.",
    summary: `${scoringRequirements.length} accepted scoring-related requirement(s), ${scoringCitations.length} verified citation(s), and no authoritative score allocation ready for use.`,
    reviewItemCount: scoringRequirements.length,
    citationCount: scoringCitations.length,
    citations: scoringCitations.slice(0, 20).map((item) => item.snapshot),
    lastUpdatedAt: latestDate(
      scoringRequirements.map((item) => item.updatedAt),
    ),
  });

  const bidSecurityRequirements = matchingAcceptedRequirements(
    /\b(bid security|bid bond|bank guarantee|performance guarantee|guarantee validity)\b/iu,
  );
  const bidSecurityCitations = citationsForRequirements(
    bidSecurityRequirements,
  );
  const bidSecurityIntegrity = capability({
    id: "bid_security_integrity",
    state: bidSecurityRequirements.length === 0 ? "empty" : "partial",
    stateReason:
      bidSecurityRequirements.length === 0
        ? "No accepted, cited bid-security or guarantee term is connected to this pursuit."
        : "Cited security terms are available, but no verified issued instrument and prescribed-form comparison is connected; Valo cannot represent validity or instruct a bank.",
    summary: `${bidSecurityRequirements.length} security-related requirement(s) need an instrument-bound human review.`,
    reviewItemCount: bidSecurityRequirements.length,
    citationCount: bidSecurityCitations.length,
    citations: bidSecurityCitations.slice(0, 20).map((item) => item.snapshot),
    lastUpdatedAt: latestDate(
      bidSecurityRequirements.map((item) => item.updatedAt),
    ),
  });

  const regulatoryDocuments = includedDocuments.filter((document) =>
    /\b(regulation|regulatory|procurement act|guideline|circular|bpp)\b/iu.test(
      document.filename,
    ),
  );
  const safeRegulatoryDocuments = regulatoryDocuments.filter((document) =>
    safeCurrentDocumentIds.has(document.id),
  );
  const regulatoryWatchtower = capability({
    id: "regulatory_watchtower",
    state: regulatoryDocuments.length === 0 ? "empty" : "partial",
    stateReason:
      regulatoryDocuments.length === 0
        ? "No verified official regulatory rule-pack version is connected to this pursuit."
        : "Potential rule documents are present, but source authority, activation decision and portfolio impact remain unproven.",
    summary: `${regulatoryDocuments.length} possible regulatory document(s), ${safeRegulatoryDocuments.length} safe current version(s), and no activated interpretation.`,
    reviewItemCount: regulatoryDocuments.length,
    citationCount: 0,
    citations: [],
    lastUpdatedAt: latestDate(
      regulatoryDocuments.map((item) => item.updatedAt),
    ),
  });

  const consortiumSignals = input.capabilityItems.filter((item) =>
    /\b(joint venture|jv|consortium|partner|subcontractor|oem)\b/iu.test(
      item.claimType,
    ),
  );
  const consortiumResponsibility = capability({
    id: "consortium_responsibility",
    state: consortiumSignals.length === 0 ? "empty" : "partial",
    stateReason:
      consortiumSignals.length === 0
        ? "No verified consortium, JV, OEM or subcontractor responsibility record is connected to this pursuit."
        : "Partner-related capability records exist, but no accepted entity-bound responsibility matrix proves who owns each obligation.",
    summary: `${consortiumSignals.length} partner-related capability record(s) require entity-bound evidence and named acceptance.`,
    reviewItemCount: consortiumSignals.length,
    citationCount: 0,
    citations: [],
    lastUpdatedAt: latestDate(consortiumSignals.map((item) => item.updatedAt)),
  });

  const portalSubmissionRehearsal = capability({
    id: "portal_submission_rehearsal",
    state: input.packages.length === 0 ? "empty" : "partial",
    stateReason:
      input.packages.length === 0
        ? "No current submission package is connected for a portal rehearsal."
        : "A package exists, but no approved portal profile, field map, size-rule receipt or operator rehearsal is connected; Valo never logs in or submits.",
    summary: `${input.packages.length} package record(s), ${currentPackageVersionByPackageId.size} provenance-complete current version(s), and no authorised portal submission action.`,
    reviewItemCount: input.packages.length,
    citationCount: 0,
    citations: [],
    lastUpdatedAt: latestDate([
      ...input.packages.map((item) => item.updatedAt),
      ...input.packageVersions.map((item) => item.createdAt),
    ]),
  });

  const commercialRequirements = matchingAcceptedRequirements(
    /\b(payment|retention|mobilisation|tax|currency|foreign exchange|fx|price adjustment|cashflow|cash flow)\b/iu,
  );
  const commercialCitations = citationsForRequirements(commercialRequirements);
  const commercialExposure = capability({
    id: "commercial_exposure",
    state:
      commercialRequirements.length === 0 && boqDocuments.length === 0
        ? "empty"
        : "partial",
    stateReason:
      commercialRequirements.length === 0 && boqDocuments.length === 0
        ? "No accepted commercial clause or safe current BOQ is connected for deterministic exposure scenarios."
        : "Commercial source signals exist, but no reviewed assumption set and cashflow scenario is connected; Valo cannot select prices or financing decisions.",
    summary: `${commercialRequirements.length} commercial requirement(s), ${safeBoqDocuments.length} safe current BOQ(s), and no approved scenario assumptions.`,
    reviewItemCount: commercialRequirements.length + boqDocuments.length,
    citationCount: commercialCitations.length,
    citations: commercialCitations.slice(0, 20).map((item) => item.snapshot),
    lastUpdatedAt: latestDate([
      ...commercialRequirements.map((item) => item.updatedAt),
      ...boqDocuments.map((item) => item.updatedAt),
    ]),
  });

  const localContentRequirements = matchingAcceptedRequirements(
    /\b(nigerian content|local content|indigenous|local personnel|local training|local subcontract)\b/iu,
  );
  const localContentCitations = citationsForRequirements(
    localContentRequirements,
  );
  const nigerianContentComposer = capability({
    id: "nigerian_content_composer",
    state:
      localContentRequirements.length === 0 && verifiedCapabilities.length === 0
        ? "empty"
        : "partial",
    stateReason:
      localContentRequirements.length === 0 && verifiedCapabilities.length === 0
        ? "No tender-specific local-content clause or verified company capability is connected."
        : "Local-content evidence signals exist, but no source-exact, availability-reviewed plan line has been accepted; Valo cannot make a commitment.",
    summary: `${localContentRequirements.length} local-content requirement(s) and ${verifiedCapabilities.length} named-review capability fact(s) await exact plan-line review.`,
    reviewItemCount:
      localContentRequirements.length + verifiedCapabilities.length,
    citationCount: localContentCitations.length,
    citations: localContentCitations.slice(0, 20).map((item) => item.snapshot),
    lastUpdatedAt: latestDate([
      ...localContentRequirements.map((item) => item.updatedAt),
      ...verifiedCapabilities.map((item) => item.updatedAt),
    ]),
  });

  const personnelEvidence = input.vaultItems.filter((item) =>
    /\b(cv|curriculum|personnel|staff|past performance|project reference|experience)\b/iu.test(
      item.artefactType,
    ),
  );
  const personnelTailoring = capability({
    id: "personnel_tailoring",
    state: personnelEvidence.length === 0 ? "empty" : "partial",
    stateReason:
      personnelEvidence.length === 0
        ? "No active CV, personnel or past-performance evidence is connected for criterion tailoring."
        : "Potential personnel or experience evidence exists, but criterion matching, availability and owner attestation remain unaccepted.",
    summary: `${personnelEvidence.length} potential personnel or past-performance item(s) require current, criterion-bound verification.`,
    reviewItemCount: personnelEvidence.length,
    citationCount: 0,
    citations: [],
    lastUpdatedAt: latestDate(personnelEvidence.map((item) => item.updatedAt)),
  });

  const contractDocuments = includedDocuments.filter((document) =>
    /\b(contract|award|clarification|letter of acceptance)\b/iu.test(
      document.filename,
    ),
  );
  const contractDeviation = capability({
    id: "contract_deviation",
    state: contractDocuments.length === 0 ? "empty" : "partial",
    stateReason:
      contractDocuments.length === 0
        ? "No contract, award or clarification source is connected for a tender-to-contract comparison."
        : "Potential comparison sources exist, but no accepted topic-by-topic source lineage is connected; Valo cannot accept or communicate terms.",
    summary: `${contractDocuments.length} potential contract-stage document(s) need exact clause extraction and legal/commercial review.`,
    reviewItemCount: contractDocuments.length,
    citationCount: 0,
    citations: [],
    lastUpdatedAt: latestDate(contractDocuments.map((item) => item.updatedAt)),
  });

  const criticalPathSimulator = capability({
    id: "critical_path_simulator",
    state:
      input.workTasks.length === 0 && input.project.deadline == null
        ? "empty"
        : "partial",
    stateReason:
      input.workTasks.length === 0 && input.project.deadline == null
        ? "No deadline or accepted milestone dependency record is connected for a pursuit schedule scenario."
        : "Deadline or task signals exist, but generic tasks are not source-bound milestones and no reviewed dependency scenario is connected.",
    summary: `${input.workTasks.length} generic task(s) are visible but excluded from source-proven critical-path readiness. No owner or date is changed.`,
    reviewItemCount: input.workTasks.length,
    citationCount: 0,
    citations: [],
    lastUpdatedAt: latestDate(
      input.workTasks.map((item) => item.updatedAt ?? item.dueAt),
    ),
  });

  const integritySentinel = capability({
    id: "integrity_sentinel",
    state: "empty",
    stateReason:
      "No restricted immutable audit-event projection is exposed through this project read model. The deterministic engine never treats a control signal as a misconduct finding.",
    summary:
      "Integrity signals require a separately authorised ethics/legal evidence boundary and named review; no external report is authorised.",
    reviewItemCount: 0,
    citationCount: 0,
    citations: [],
    lastUpdatedAt: null,
  });

  const outcomeLearning = capability({
    id: "outcome_learning",
    state: input.project.outcomeClientConfirmed === true ? "partial" : "empty",
    stateReason:
      input.project.outcomeClientConfirmed === true
        ? "A client-confirmed outcome exists, but no cited debrief recurrence and governance-approved tenant-local lesson is connected. Content is not authorised for model training."
        : "No client-confirmed outcome is recorded, so Valo does not infer or publish lessons.",
    summary:
      input.project.outcomeClientConfirmed === true
        ? `${input.defects.length} recorded defect(s) remain outside learning until debrief provenance and named governance review are supplied.`
        : "Outcome learning remains empty and cross-tenant reuse is disabled.",
    reviewItemCount:
      input.project.outcomeClientConfirmed === true ? input.defects.length : 0,
    citationCount: 0,
    citations: [],
    lastUpdatedAt: latestDate(input.defects.map((item) => item.updatedAt)),
  });

  return {
    environment: input.environment,
    productionAiEnabled: input.productionAiEnabled,
    restrictedMode: input.project.restrictedMode,
    generatedAt: input.generatedAt,
    project: {
      id: input.project.id,
      title: input.project.title,
      status: input.project.status,
      deadline: input.project.deadline ?? null,
    },
    capabilities: [
      evidenceGraph,
      addendumRadar,
      eligibilityPassport,
      groundedCopilot,
      opportunityRadar,
      responseStudio,
      submissionPreflight,
      clarificationAssistant,
      boqSanity,
      awardHandoff,
      evaluationScorePlanner,
      bidSecurityIntegrity,
      regulatoryWatchtower,
      consortiumResponsibility,
      portalSubmissionRehearsal,
      commercialExposure,
      nigerianContentComposer,
      personnelTailoring,
      contractDeviation,
      criticalPathSimulator,
      integritySentinel,
      outcomeLearning,
    ],
  };
}
