import { and, eq, inArray, sql } from "drizzle-orm";
import {
  boqChecks,
  capabilityItems,
  db,
  defects,
  documents,
  documentVersions,
  draftClaims,
  drafts,
  draftVersions,
  evidenceItems,
  organisationMemberships,
  organisations,
  outcomes,
  packages,
  packageSignoffs,
  packageVersions,
  projects,
  reports,
  requirementCitations,
  requirements,
  roleGrants,
  tenders,
  users,
  vaultItems,
  workTasks,
} from "@workspace/db";
import type { OrganisationType } from "../permissions";
import {
  currentEvidenceApproverIds,
  EVIDENCE_LAYER_STORE_BOUNDS,
} from "./evidenceLayerStore";
import {
  buildIntelligenceCentreSnapshot,
  type IntelligenceCentreSnapshot,
} from "./snapshot";
import {
  computeIntelligenceSourceVersion,
  hashIntelligenceSourceFields,
  type IntelligenceSourceVersion,
  type IntelligenceSourceVersionRecord,
} from "./intelligenceSourceVersion";

export const INTELLIGENCE_SOURCE_BINDING_POLICY_VERSION =
  "intelligence-snapshot-binding-v2";
export const INTELLIGENCE_SNAPSHOT_ENGINE_VERSION =
  "deterministic-intelligence-snapshot-v1";

export const INTELLIGENCE_SOURCE_BINDING_BOUNDS = Object.freeze({
  documents: 256,
  documentVersions: 1_024,
  requirements: 4_096,
  requirementCitations: 8_192,
  evidenceItems: 4_096,
  defects: 2_048,
  boqChecks: 2_048,
  drafts: 512,
  draftVersions: 1_024,
  draftClaims: 2_048,
  workTasks: 2_048,
  packages: 256,
  packageVersions: 1_024,
  packageSignoffs: 1_024,
  reports: 64,
  outcomes: 64,
  vaultItems: 1_024,
  capabilityItems: 1_024,
  tenders: 16,
  maxTextCodeUnitsPerRow: 2_000_000,
  maxTextBytesPerRow: 4_000_000,
  maxTotalBoundTextBytes: 32_000_000,
});

type IntelligenceBoundTable =
  | "documents"
  | "document_versions"
  | "requirements"
  | "requirement_citations"
  | "evidence_items"
  | "defects"
  | "boq_checks"
  | "drafts"
  | "draft_versions"
  | "draft_claims"
  | "work_tasks"
  | "packages"
  | "package_versions"
  | "package_signoffs"
  | "reports"
  | "outcomes"
  | "vault_items"
  | "capability_items"
  | "tenders";

export class IntelligenceSourceBindingStoreError extends Error {
  constructor(
    readonly code:
      | "source_set_bound_exceeded"
      | "source_text_bound_exceeded"
      | "source_set_changed",
    readonly sourceKind: string,
  ) {
    super(`AI_SOURCE_BINDING_${code.toUpperCase()}:${sourceKind}`);
    this.name = "IntelligenceSourceBindingStoreError";
  }
}

export interface IntelligenceSourceProjection {
  source: IntelligenceSourceVersion;
  snapshot: IntelligenceCentreSnapshot;
}

function boundedIds(
  sourceKind: string,
  rows: ReadonlyArray<{ id: string }>,
  maximum: number,
): string[] {
  if (rows.length > maximum)
    throw new IntelligenceSourceBindingStoreError(
      "source_set_bound_exceeded",
      sourceKind,
    );
  return rows.map((row) => row.id);
}

function requireSameRows(
  sourceKind: string,
  ids: readonly string[],
  rows: ReadonlyArray<{ id: string }>,
): void {
  if (rows.length !== ids.length || rows.some((row) => !ids.includes(row.id)))
    throw new IntelligenceSourceBindingStoreError(
      "source_set_changed",
      sourceKind,
    );
}

function lengthValue(value: number | string | null): number | null {
  if (value === null) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function assertBoundedTextMetadata(
  sourceKind: string,
  rows: ReadonlyArray<{
    codeUnits: number | string | null;
    bytes: number | string | null;
  }>,
  runningTotal: { bytes: number },
): void {
  for (const row of rows) {
    const codeUnits = lengthValue(row.codeUnits);
    const bytes = lengthValue(row.bytes);
    if (
      codeUnits === null ||
      bytes === null ||
      codeUnits > INTELLIGENCE_SOURCE_BINDING_BOUNDS.maxTextCodeUnitsPerRow ||
      bytes > INTELLIGENCE_SOURCE_BINDING_BOUNDS.maxTextBytesPerRow
    )
      throw new IntelligenceSourceBindingStoreError(
        "source_text_bound_exceeded",
        sourceKind,
      );
    runningTotal.bytes += bytes;
    if (
      !Number.isSafeInteger(runningTotal.bytes) ||
      runningTotal.bytes >
        INTELLIGENCE_SOURCE_BINDING_BOUNDS.maxTotalBoundTextBytes
    )
      throw new IntelligenceSourceBindingStoreError(
        "source_text_bound_exceeded",
        "aggregate",
      );
  }
}

function assertBoundedVerifierAuthorityMetadata(
  rows: ReadonlyArray<{
    codeUnits: number | string | null;
    bytes: number | string | null;
  }>,
  runningTotal: { bytes: number },
): void {
  const authorityTotal = { bytes: 0 };
  for (const row of rows) {
    const codeUnits = lengthValue(row.codeUnits);
    const bytes = lengthValue(row.bytes);
    if (
      codeUnits === null ||
      bytes === null ||
      codeUnits > EVIDENCE_LAYER_STORE_BOUNDS.maxAuthorityCodeUnitsPerRow ||
      bytes > EVIDENCE_LAYER_STORE_BOUNDS.maxAuthorityBytesPerRow
    )
      throw new IntelligenceSourceBindingStoreError(
        "source_text_bound_exceeded",
        "citation_verifier_authority",
      );
    authorityTotal.bytes += bytes;
    runningTotal.bytes += bytes;
    if (
      !Number.isSafeInteger(authorityTotal.bytes) ||
      authorityTotal.bytes >
        EVIDENCE_LAYER_STORE_BOUNDS.maxTotalAuthorityBytes ||
      !Number.isSafeInteger(runningTotal.bytes) ||
      runningTotal.bytes >
        INTELLIGENCE_SOURCE_BINDING_BOUNDS.maxTotalBoundTextBytes
    )
      throw new IntelligenceSourceBindingStoreError(
        "source_text_bound_exceeded",
        "citation_verifier_authority",
      );
  }
}

/**
 * Returns only IDs and SQL-computed JSON row lengths. No variable-length row
 * value crosses into Node before the individual and aggregate gates pass.
 * Table names are a closed compile-time set; identifiers are never supplied by
 * a caller.
 */
async function loadPersistedRowTextBounds(
  tableName: IntelligenceBoundTable,
  ids: readonly string[],
  maximum: number,
): Promise<
  Array<{
    id: string;
    codeUnits: number | string | null;
    bytes: number | string | null;
  }>
> {
  if (ids.length === 0) return [];
  const tableIdentifier = sql.raw(`"${tableName}"`);
  const idValues = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const result = await db.execute(sql`
    SELECT
      id::text AS id,
      char_length(to_jsonb(${tableIdentifier})::text) AS "codeUnits",
      octet_length(to_jsonb(${tableIdentifier})::text) AS bytes
    FROM ${tableIdentifier}
    WHERE id IN (${idValues})
    LIMIT ${maximum}
  `);
  return result.rows as Array<{
    id: string;
    codeUnits: number | string | null;
    bytes: number | string | null;
  }>;
}

function record(
  kind: string,
  row: { id: string },
  fields: unknown,
  version = 1,
): IntelligenceSourceVersionRecord {
  return {
    kind,
    id: row.id,
    version: Number.isSafeInteger(version) && version > 0 ? version : 1,
    fingerprint: hashIntelligenceSourceFields(fields),
  };
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function temporalState(
  value: Date | string | null | undefined,
  now: Date,
  direction: "future_is_ready" | "past_is_ready",
): "absent" | "invalid" | "ready" | "not_ready" {
  if (!value) return "absent";
  const epoch = (value instanceof Date ? value : new Date(value)).getTime();
  if (!Number.isFinite(epoch)) return "invalid";
  return direction === "future_is_ready"
    ? epoch > now.getTime()
      ? "ready"
      : "not_ready"
    : epoch <= now.getTime()
      ? "ready"
      : "not_ready";
}

/**
 * Computes a conservative project-wide review binding. Every query is first
 * bounded with an ID-only max+1 projection. Mutable and immutable inputs then
 * receive canonical SHA-256 fingerprints, including fields that do not carry
 * optimistic versions. A normalized deterministic capability-output digest,
 * policy version and closed UTC temporal classifications protect reviews from
 * code and clock-driven changes as well as row updates.
 */
export async function loadIntelligenceSourceProjection(
  projectId: string,
  options: {
    organisationId: string;
    now?: Date;
    environment?: IntelligenceCentreSnapshot["environment"];
  },
): Promise<IntelligenceSourceProjection | null> {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime()))
    throw new IntelligenceSourceBindingStoreError(
      "source_set_changed",
      "clock",
    );
  const [projectScope] = await db
    .select({
      id: projects.id,
      organisationId: projects.organisationId,
      codeUnits: sql<number>`greatest(
        coalesce(char_length(${projects.tenderTitle}), 0),
        coalesce(char_length(${projects.tenderRef}), 0),
        coalesce(char_length(${projects.status}), 0),
        coalesce(char_length(${organisations.type}), 0),
        coalesce(char_length(${organisations.status}), 0)
      )`,
      bytes: sql<number>`
        coalesce(octet_length(${projects.tenderTitle}), 0) +
        coalesce(octet_length(${projects.tenderRef}), 0) +
        coalesce(octet_length(${projects.status}), 0) +
        coalesce(octet_length(${organisations.type}), 0) +
        coalesce(octet_length(${organisations.status}), 0)
      `,
    })
    .from(projects)
    .innerJoin(organisations, eq(projects.organisationId, organisations.id))
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organisationId, options.organisationId),
      ),
    )
    .limit(1);
  if (!projectScope) return null;
  assertBoundedTextMetadata("project", [projectScope], { bytes: 0 });

  const [project] = await db
    .select({
      id: projects.id,
      organisationId: projects.organisationId,
      organisationType: organisations.type,
      organisationStatus: organisations.status,
      clientId: projects.clientId,
      tenderTitle: projects.tenderTitle,
      tenderRef: projects.tenderRef,
      status: projects.status,
      deadline: projects.deadline,
      restrictedMode: projects.restrictedMode,
      version: projects.version,
    })
    .from(projects)
    .innerJoin(organisations, eq(projects.organisationId, organisations.id))
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organisationId, options.organisationId),
      ),
    )
    .limit(1);
  if (!project) return null;
  if (!project.organisationId || project.organisationStatus !== "active")
    throw new IntelligenceSourceBindingStoreError(
      "source_set_changed",
      "project_tenant",
    );

  const [
    documentIdRows,
    requirementIdRows,
    evidenceIdRows,
    defectIdRows,
    boqIdRows,
    draftIdRows,
    taskIdRows,
    packageIdRows,
    reportIdRows,
    outcomeIdRows,
    vaultIdRows,
    capabilityIdRows,
    tenderIdRows,
  ] = await Promise.all([
    db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.projectId, projectId))
      .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.documents + 1),
    db
      .select({ id: requirements.id })
      .from(requirements)
      .where(eq(requirements.projectId, projectId))
      .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.requirements + 1),
    db
      .select({ id: evidenceItems.id })
      .from(evidenceItems)
      .where(eq(evidenceItems.projectId, projectId))
      .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.evidenceItems + 1),
    db
      .select({ id: defects.id })
      .from(defects)
      .where(eq(defects.projectId, projectId))
      .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.defects + 1),
    db
      .select({ id: boqChecks.id })
      .from(boqChecks)
      .where(eq(boqChecks.projectId, projectId))
      .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.boqChecks + 1),
    db
      .select({ id: drafts.id })
      .from(drafts)
      .where(eq(drafts.projectId, projectId))
      .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.drafts + 1),
    db
      .select({ id: workTasks.id })
      .from(workTasks)
      .where(eq(workTasks.projectId, projectId))
      .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.workTasks + 1),
    db
      .select({ id: packages.id })
      .from(packages)
      .where(eq(packages.projectId, projectId))
      .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.packages + 1),
    db
      .select({ id: reports.id })
      .from(reports)
      .where(eq(reports.projectId, projectId))
      .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.reports + 1),
    db
      .select({ id: outcomes.id })
      .from(outcomes)
      .where(eq(outcomes.projectId, projectId))
      .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.outcomes + 1),
    db
      .select({ id: vaultItems.id })
      .from(vaultItems)
      .where(
        and(
          eq(vaultItems.clientId, project.clientId),
          eq(vaultItems.organisationId, options.organisationId),
        ),
      )
      .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.vaultItems + 1),
    db
      .select({ id: capabilityItems.id })
      .from(capabilityItems)
      .where(
        and(
          eq(capabilityItems.clientId, project.clientId),
          eq(capabilityItems.organisationId, options.organisationId),
        ),
      )
      .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.capabilityItems + 1),
    project.tenderRef?.trim()
      ? db
          .select({ id: tenders.id })
          .from(tenders)
          .where(
            and(
              eq(tenders.reference, project.tenderRef),
              eq(tenders.organisationId, project.organisationId),
            ),
          )
          .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.tenders + 1)
      : Promise.resolve([]),
  ]);

  const documentIds = boundedIds(
    "documents",
    documentIdRows,
    INTELLIGENCE_SOURCE_BINDING_BOUNDS.documents,
  );
  const requirementIds = boundedIds(
    "requirements",
    requirementIdRows,
    INTELLIGENCE_SOURCE_BINDING_BOUNDS.requirements,
  );
  const evidenceIds = boundedIds(
    "evidence_items",
    evidenceIdRows,
    INTELLIGENCE_SOURCE_BINDING_BOUNDS.evidenceItems,
  );
  const defectIds = boundedIds(
    "defects",
    defectIdRows,
    INTELLIGENCE_SOURCE_BINDING_BOUNDS.defects,
  );
  const boqIds = boundedIds(
    "boq_checks",
    boqIdRows,
    INTELLIGENCE_SOURCE_BINDING_BOUNDS.boqChecks,
  );
  const draftIds = boundedIds(
    "drafts",
    draftIdRows,
    INTELLIGENCE_SOURCE_BINDING_BOUNDS.drafts,
  );
  const taskIds = boundedIds(
    "work_tasks",
    taskIdRows,
    INTELLIGENCE_SOURCE_BINDING_BOUNDS.workTasks,
  );
  const packageIds = boundedIds(
    "packages",
    packageIdRows,
    INTELLIGENCE_SOURCE_BINDING_BOUNDS.packages,
  );
  const reportIds = boundedIds(
    "reports",
    reportIdRows,
    INTELLIGENCE_SOURCE_BINDING_BOUNDS.reports,
  );
  const outcomeIds = boundedIds(
    "outcomes",
    outcomeIdRows,
    INTELLIGENCE_SOURCE_BINDING_BOUNDS.outcomes,
  );
  const vaultIds = boundedIds(
    "vault_items",
    vaultIdRows,
    INTELLIGENCE_SOURCE_BINDING_BOUNDS.vaultItems,
  );
  const capabilityIds = boundedIds(
    "capability_items",
    capabilityIdRows,
    INTELLIGENCE_SOURCE_BINDING_BOUNDS.capabilityItems,
  );
  const tenderIds = boundedIds(
    "tenders",
    tenderIdRows,
    INTELLIGENCE_SOURCE_BINDING_BOUNDS.tenders,
  );

  const [
    documentVersionIdRows,
    citationIdRows,
    draftVersionIdRows,
    packageVersionIdRows,
  ] = await Promise.all([
    documentIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: documentVersions.id })
          .from(documentVersions)
          .where(inArray(documentVersions.documentId, documentIds))
          .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.documentVersions + 1),
    requirementIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: requirementCitations.id })
          .from(requirementCitations)
          .innerJoin(
            documentVersions,
            eq(requirementCitations.documentVersionId, documentVersions.id),
          )
          .innerJoin(documents, eq(documentVersions.documentId, documents.id))
          .where(
            and(
              inArray(requirementCitations.requirementId, requirementIds),
              eq(documents.projectId, projectId),
            ),
          )
          .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.requirementCitations + 1),
    draftIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: draftVersions.id })
          .from(draftVersions)
          .where(inArray(draftVersions.draftId, draftIds))
          .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.draftVersions + 1),
    packageIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: packageVersions.id })
          .from(packageVersions)
          .where(inArray(packageVersions.packageId, packageIds))
          .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.packageVersions + 1),
  ]);
  const documentVersionIds = boundedIds(
    "document_versions",
    documentVersionIdRows,
    INTELLIGENCE_SOURCE_BINDING_BOUNDS.documentVersions,
  );
  const citationIds = boundedIds(
    "requirement_citations",
    citationIdRows,
    INTELLIGENCE_SOURCE_BINDING_BOUNDS.requirementCitations,
  );
  const draftVersionIds = boundedIds(
    "draft_versions",
    draftVersionIdRows,
    INTELLIGENCE_SOURCE_BINDING_BOUNDS.draftVersions,
  );
  const packageVersionIds = boundedIds(
    "package_versions",
    packageVersionIdRows,
    INTELLIGENCE_SOURCE_BINDING_BOUNDS.packageVersions,
  );
  const [claimIdRows, signoffIdRows] = await Promise.all([
    draftVersionIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: draftClaims.id })
          .from(draftClaims)
          .where(inArray(draftClaims.draftVersionId, draftVersionIds))
          .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.draftClaims + 1),
    packageVersionIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: packageSignoffs.id })
          .from(packageSignoffs)
          .where(inArray(packageSignoffs.packageVersionId, packageVersionIds))
          .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.packageSignoffs + 1),
  ]);
  const claimIds = boundedIds(
    "draft_claims",
    claimIdRows,
    INTELLIGENCE_SOURCE_BINDING_BOUNDS.draftClaims,
  );
  const signoffIds = boundedIds(
    "package_signoffs",
    signoffIdRows,
    INTELLIGENCE_SOURCE_BINDING_BOUNDS.packageSignoffs,
  );

  const boundedSourceSets = await Promise.all([
    loadPersistedRowTextBounds(
      "documents",
      documentIds,
      INTELLIGENCE_SOURCE_BINDING_BOUNDS.documents,
    ).then((rows) => ["documents", documentIds, rows] as const),
    loadPersistedRowTextBounds(
      "document_versions",
      documentVersionIds,
      INTELLIGENCE_SOURCE_BINDING_BOUNDS.documentVersions,
    ).then((rows) => ["document_versions", documentVersionIds, rows] as const),
    loadPersistedRowTextBounds(
      "requirements",
      requirementIds,
      INTELLIGENCE_SOURCE_BINDING_BOUNDS.requirements,
    ).then((rows) => ["requirements", requirementIds, rows] as const),
    loadPersistedRowTextBounds(
      "requirement_citations",
      citationIds,
      INTELLIGENCE_SOURCE_BINDING_BOUNDS.requirementCitations,
    ).then((rows) => ["requirement_citations", citationIds, rows] as const),
    loadPersistedRowTextBounds(
      "evidence_items",
      evidenceIds,
      INTELLIGENCE_SOURCE_BINDING_BOUNDS.evidenceItems,
    ).then((rows) => ["evidence_items", evidenceIds, rows] as const),
    loadPersistedRowTextBounds(
      "defects",
      defectIds,
      INTELLIGENCE_SOURCE_BINDING_BOUNDS.defects,
    ).then((rows) => ["defects", defectIds, rows] as const),
    loadPersistedRowTextBounds(
      "boq_checks",
      boqIds,
      INTELLIGENCE_SOURCE_BINDING_BOUNDS.boqChecks,
    ).then((rows) => ["boq_checks", boqIds, rows] as const),
    loadPersistedRowTextBounds(
      "drafts",
      draftIds,
      INTELLIGENCE_SOURCE_BINDING_BOUNDS.drafts,
    ).then((rows) => ["drafts", draftIds, rows] as const),
    loadPersistedRowTextBounds(
      "draft_versions",
      draftVersionIds,
      INTELLIGENCE_SOURCE_BINDING_BOUNDS.draftVersions,
    ).then((rows) => ["draft_versions", draftVersionIds, rows] as const),
    loadPersistedRowTextBounds(
      "draft_claims",
      claimIds,
      INTELLIGENCE_SOURCE_BINDING_BOUNDS.draftClaims,
    ).then((rows) => ["draft_claims", claimIds, rows] as const),
    loadPersistedRowTextBounds(
      "work_tasks",
      taskIds,
      INTELLIGENCE_SOURCE_BINDING_BOUNDS.workTasks,
    ).then((rows) => ["work_tasks", taskIds, rows] as const),
    loadPersistedRowTextBounds(
      "packages",
      packageIds,
      INTELLIGENCE_SOURCE_BINDING_BOUNDS.packages,
    ).then((rows) => ["packages", packageIds, rows] as const),
    loadPersistedRowTextBounds(
      "package_versions",
      packageVersionIds,
      INTELLIGENCE_SOURCE_BINDING_BOUNDS.packageVersions,
    ).then((rows) => ["package_versions", packageVersionIds, rows] as const),
    loadPersistedRowTextBounds(
      "package_signoffs",
      signoffIds,
      INTELLIGENCE_SOURCE_BINDING_BOUNDS.packageSignoffs,
    ).then((rows) => ["package_signoffs", signoffIds, rows] as const),
    loadPersistedRowTextBounds(
      "reports",
      reportIds,
      INTELLIGENCE_SOURCE_BINDING_BOUNDS.reports,
    ).then((rows) => ["reports", reportIds, rows] as const),
    loadPersistedRowTextBounds(
      "outcomes",
      outcomeIds,
      INTELLIGENCE_SOURCE_BINDING_BOUNDS.outcomes,
    ).then((rows) => ["outcomes", outcomeIds, rows] as const),
    loadPersistedRowTextBounds(
      "vault_items",
      vaultIds,
      INTELLIGENCE_SOURCE_BINDING_BOUNDS.vaultItems,
    ).then((rows) => ["vault_items", vaultIds, rows] as const),
    loadPersistedRowTextBounds(
      "capability_items",
      capabilityIds,
      INTELLIGENCE_SOURCE_BINDING_BOUNDS.capabilityItems,
    ).then((rows) => ["capability_items", capabilityIds, rows] as const),
    loadPersistedRowTextBounds(
      "tenders",
      tenderIds,
      INTELLIGENCE_SOURCE_BINDING_BOUNDS.tenders,
    ).then((rows) => ["tenders", tenderIds, rows] as const),
  ]);
  const boundedTextTotal = { bytes: 0 };
  for (const [kind, ids, rows] of boundedSourceSets) {
    requireSameRows(`${kind}.bounds`, ids, rows);
    assertBoundedTextMetadata(kind, rows, boundedTextTotal);
  }
  const citationVerifierNameBounds =
    citationIds.length === 0
      ? []
      : await db
          .select({
            id: requirementCitations.id,
            codeUnits: sql<number>`coalesce(char_length(${users.name}), 0)`,
            bytes: sql<number>`coalesce(octet_length(${users.name}), 0)`,
          })
          .from(requirementCitations)
          .leftJoin(users, eq(requirementCitations.verifiedByUserId, users.id))
          .where(inArray(requirementCitations.id, citationIds))
          .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.requirementCitations);
  requireSameRows(
    "citation_verifier_names.bounds",
    citationIds,
    citationVerifierNameBounds,
  );
  assertBoundedTextMetadata(
    "citation_verifier_names",
    citationVerifierNameBounds,
    boundedTextTotal,
  );

  const [documentMetadata, requirementMetadata, citationMetadata] =
    await Promise.all([
      documentIds.length === 0
        ? Promise.resolve([])
        : db
            .select({
              id: documents.id,
              organisationId: documents.organisationId,
              projectId: documents.projectId,
              filename: documents.filename,
              type: documents.type,
              redactionStatus: documents.redactionStatus,
              extractionStatus: documents.extractionStatus,
              sha256: documents.sha256,
              version: documents.version,
              updatedAt: documents.updatedAt,
              codeUnits: sql<
                number | null
              >`char_length(${documents.contentText})`,
              bytes: sql<number | null>`octet_length(${documents.contentText})`,
            })
            .from(documents)
            .where(inArray(documents.id, documentIds))
            .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.documents),
      requirementIds.length === 0
        ? Promise.resolve([])
        : db
            .select({
              id: requirements.id,
              organisationId: requirements.organisationId,
              projectId: requirements.projectId,
              category: requirements.category,
              isMandatory: requirements.isMandatory,
              reviewStatus: requirements.reviewStatus,
              sourceDocId: requirements.sourceDocId,
              pageRef: requirements.pageRef,
              clauseRef: requirements.clauseRef,
              confidence: requirements.confidence,
              reviewerNotes: requirements.reviewerNotes,
              version: requirements.version,
              updatedAt: requirements.updatedAt,
              codeUnits: sql<number>`char_length(${requirements.text})`,
              bytes: sql<number>`octet_length(${requirements.text})`,
            })
            .from(requirements)
            .where(inArray(requirements.id, requirementIds))
            .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.requirements),
      citationIds.length === 0
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
              version: requirementCitations.version,
              updatedAt: requirementCitations.updatedAt,
              codeUnits: sql<number>`char_length(${requirementCitations.sourceSnippet})`,
              bytes: sql<number>`octet_length(${requirementCitations.sourceSnippet})`,
            })
            .from(requirementCitations)
            .leftJoin(
              users,
              eq(requirementCitations.verifiedByUserId, users.id),
            )
            .where(inArray(requirementCitations.id, citationIds))
            .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.requirementCitations),
    ]);
  requireSameRows("documents", documentIds, documentMetadata);
  requireSameRows("requirements", requirementIds, requirementMetadata);
  requireSameRows("requirement_citations", citationIds, citationMetadata);
  const totalText = { bytes: 0 };
  assertBoundedTextMetadata(
    "documents.content_text",
    documentMetadata,
    totalText,
  );
  assertBoundedTextMetadata(
    "requirements.text",
    requirementMetadata,
    totalText,
  );
  assertBoundedTextMetadata(
    "requirement_citations.source_snippet",
    citationMetadata,
    totalText,
  );

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
              eq(
                organisationMemberships.organisationId,
                options.organisationId,
              ),
              inArray(organisationMemberships.userId, verifierIds),
            ),
          )
          .limit(EVIDENCE_LAYER_STORE_BOUNDS.maxVerifierAuthorityRows + 1);
  if (
    authorityBounds.length >
    EVIDENCE_LAYER_STORE_BOUNDS.maxVerifierAuthorityRows
  )
    throw new IntelligenceSourceBindingStoreError(
      "source_set_bound_exceeded",
      "citation_verifier_authority",
    );
  assertBoundedVerifierAuthorityMetadata(authorityBounds, boundedTextTotal);
  const authorityRows =
    authorityBounds.length === 0
      ? []
      : await db
          .select({
            id: roleGrants.id,
            userId: users.id,
            userStatus: users.status,
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
              eq(
                organisationMemberships.organisationId,
                options.organisationId,
              ),
              inArray(
                roleGrants.id,
                authorityBounds.map((row) => row.id),
              ),
            ),
          )
          .limit(EVIDENCE_LAYER_STORE_BOUNDS.maxVerifierAuthorityRows);
  requireSameRows(
    "citation_verifier_authority",
    authorityBounds.map((row) => row.id),
    authorityRows,
  );
  const authorisedVerifierIds = currentEvidenceApproverIds({
    rows: authorityRows,
    organisationType: project.organisationType as OrganisationType,
    now,
  });

  const [
    documentContentRows,
    requirementTextRows,
    citationSnippetRows,
    documentVersionRows,
    evidenceRows,
    defectRows,
    boqRows,
    draftRows,
    draftVersionRows,
    claimRows,
    taskRows,
    packageRows,
    packageVersionRows,
    signoffRows,
    reportRows,
    outcomeRows,
    vaultRows,
    capabilityRows,
    tenderRows,
  ] = await Promise.all([
    documentIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: documents.id, contentText: documents.contentText })
          .from(documents)
          .where(inArray(documents.id, documentIds))
          .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.documents),
    requirementIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: requirements.id, text: requirements.text })
          .from(requirements)
          .where(inArray(requirements.id, requirementIds))
          .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.requirements),
    citationIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: requirementCitations.id,
            sourceSnippet: requirementCitations.sourceSnippet,
          })
          .from(requirementCitations)
          .where(inArray(requirementCitations.id, citationIds))
          .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.requirementCitations),
    documentVersionIds.length === 0
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
            addendumStatus: documentVersions.addendumStatus,
            createdAt: documentVersions.createdAt,
          })
          .from(documentVersions)
          .where(inArray(documentVersions.id, documentVersionIds))
          .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.documentVersions),
    evidenceIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: evidenceItems.id,
            requirementId: evidenceItems.requirementId,
            documentId: evidenceItems.documentId,
            evidenceStatus: evidenceItems.evidenceStatus,
            excerpt: evidenceItems.excerpt,
            suggested: evidenceItems.suggested,
            confirmedBy: evidenceItems.confirmedBy,
            version: evidenceItems.version,
            updatedAt: evidenceItems.updatedAt,
          })
          .from(evidenceItems)
          .where(inArray(evidenceItems.id, evidenceIds))
          .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.evidenceItems),
    defectIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: defects.id,
            severity: defects.severity,
            status: defects.status,
            version: defects.version,
            updatedAt: defects.updatedAt,
          })
          .from(defects)
          .where(inArray(defects.id, defectIds))
          .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.defects),
    boqIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: boqChecks.id,
            sourceDocId: boqChecks.sourceDocId,
            status: boqChecks.status,
            severity: boqChecks.severity,
            version: boqChecks.version,
            updatedAt: boqChecks.updatedAt,
          })
          .from(boqChecks)
          .where(inArray(boqChecks.id, boqIds))
          .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.boqChecks),
    draftIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: drafts.id,
            status: drafts.status,
            currentVersionNumber: drafts.currentVersionNumber,
            version: drafts.version,
            updatedAt: drafts.updatedAt,
          })
          .from(drafts)
          .where(inArray(drafts.id, draftIds))
          .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.drafts),
    draftVersionIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: draftVersions.id,
            draftId: draftVersions.draftId,
            versionNumber: draftVersions.versionNumber,
            contentHash: draftVersions.contentHash,
            sourceRequirementVersionSnapshot:
              draftVersions.sourceRequirementVersionSnapshot,
            authorType: draftVersions.authorType,
            authorUserId: draftVersions.authorUserId,
            createdAt: draftVersions.createdAt,
          })
          .from(draftVersions)
          .where(inArray(draftVersions.id, draftVersionIds))
          .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.draftVersions),
    claimIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: draftClaims.id,
            draftVersionId: draftClaims.draftVersionId,
            groundingStatus: draftClaims.groundingStatus,
            reviewerUserId: draftClaims.reviewerUserId,
            reviewedAt: draftClaims.reviewedAt,
            createdAt: draftClaims.createdAt,
          })
          .from(draftClaims)
          .where(inArray(draftClaims.id, claimIds))
          .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.draftClaims),
    taskIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: workTasks.id,
            status: workTasks.status,
            dueAt: workTasks.dueAt,
            version: workTasks.version,
            updatedAt: workTasks.updatedAt,
          })
          .from(workTasks)
          .where(inArray(workTasks.id, taskIds))
          .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.workTasks),
    packageIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: packages.id,
            status: packages.status,
            currentVersionNumber: packages.currentVersionNumber,
            version: packages.version,
            updatedAt: packages.updatedAt,
          })
          .from(packages)
          .where(inArray(packages.id, packageIds))
          .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.packages),
    packageVersionIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: packageVersions.id,
            packageId: packageVersions.packageId,
            versionNumber: packageVersions.versionNumber,
            sourceSnapshotHash: packageVersions.sourceSnapshotHash,
            manifestHash: packageVersions.manifestHash,
            docxSha256: packageVersions.docxSha256,
            pdfSha256: packageVersions.pdfSha256,
            zipSha256: packageVersions.zipSha256,
            renderQaStatus: packageVersions.renderQaStatus,
            generatedByUserId: packageVersions.generatedByUserId,
            createdAt: packageVersions.createdAt,
          })
          .from(packageVersions)
          .where(inArray(packageVersions.id, packageVersionIds))
          .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.packageVersions),
    signoffIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: packageSignoffs.id,
            packageVersionId: packageSignoffs.packageVersionId,
            signerUserId: packageSignoffs.signerUserId,
            signerRole: packageSignoffs.signerRole,
            signerAuthority: packageSignoffs.signerAuthority,
            intentStatement: packageSignoffs.intentStatement,
            documentHash: packageSignoffs.documentHash,
            trustedTimestamp: packageSignoffs.trustedTimestamp,
            mfaEvidence: packageSignoffs.mfaEvidence,
            deviceEventEvidence: packageSignoffs.deviceEventEvidence,
          })
          .from(packageSignoffs)
          .where(inArray(packageSignoffs.id, signoffIds))
          .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.packageSignoffs),
    reportIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: reports.id,
            version: reports.version,
            status: reports.status,
            reviewerId: reports.reviewerId,
            reviewerName: reports.reviewerName,
            attestation: reports.attestation,
            engineVersion: reports.engineVersion,
            promptPackVersion: reports.promptPackVersion,
            modelId: reports.modelId,
            taxonomyVersion: reports.taxonomyVersion,
            signedOffAt: reports.signedOffAt,
            optimisticLockVersion: reports.optimisticLockVersion,
            updatedAt: reports.updatedAt,
          })
          .from(reports)
          .where(inArray(reports.id, reportIds))
          .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.reports),
    outcomeIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: outcomes.id,
            outcome: outcomes.outcome,
            clientConfirmed: outcomes.clientConfirmed,
            version: outcomes.version,
            updatedAt: outcomes.updatedAt,
          })
          .from(outcomes)
          .where(inArray(outcomes.id, outcomeIds))
          .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.outcomes),
    vaultIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: vaultItems.id,
            artefactType: vaultItems.artefactType,
            status: vaultItems.status,
            expiryDate: vaultItems.expiryDate,
            sourceDocumentId: vaultItems.sourceDocumentId,
            sha256: vaultItems.sha256,
            version: vaultItems.version,
            updatedAt: vaultItems.updatedAt,
          })
          .from(vaultItems)
          .where(inArray(vaultItems.id, vaultIds))
          .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.vaultItems),
    capabilityIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: capabilityItems.id,
            claimType: capabilityItems.claimType,
            approvedStatus: capabilityItems.approvedStatus,
            evidenceDocId: capabilityItems.evidenceDocId,
            verifierId: capabilityItems.verifierId,
            verifierName: capabilityItems.verifierName,
            verifiedAt: capabilityItems.verifiedAt,
            version: capabilityItems.version,
            updatedAt: capabilityItems.updatedAt,
          })
          .from(capabilityItems)
          .where(inArray(capabilityItems.id, capabilityIds))
          .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.capabilityItems),
    tenderIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: tenders.id,
            reference: tenders.reference,
            title: tenders.title,
            sourceType: tenders.sourceType,
            status: tenders.status,
            submissionDeadline: tenders.submissionDeadline,
            version: tenders.version,
            updatedAt: tenders.updatedAt,
          })
          .from(tenders)
          .where(
            and(
              inArray(tenders.id, tenderIds),
              eq(tenders.organisationId, project.organisationId),
            ),
          )
          .limit(INTELLIGENCE_SOURCE_BINDING_BOUNDS.tenders),
  ]);

  for (const [kind, ids, rows] of [
    ["documents.content", documentIds, documentContentRows],
    ["requirements.text", requirementIds, requirementTextRows],
    ["requirement_citations.snippet", citationIds, citationSnippetRows],
    ["document_versions", documentVersionIds, documentVersionRows],
    ["evidence_items", evidenceIds, evidenceRows],
    ["defects", defectIds, defectRows],
    ["boq_checks", boqIds, boqRows],
    ["drafts", draftIds, draftRows],
    ["draft_versions", draftVersionIds, draftVersionRows],
    ["draft_claims", claimIds, claimRows],
    ["work_tasks", taskIds, taskRows],
    ["packages", packageIds, packageRows],
    ["package_versions", packageVersionIds, packageVersionRows],
    ["package_signoffs", signoffIds, signoffRows],
    ["reports", reportIds, reportRows],
    ["outcomes", outcomeIds, outcomeRows],
    ["vault_items", vaultIds, vaultRows],
    ["capability_items", capabilityIds, capabilityRows],
    ["tenders", tenderIds, tenderRows],
  ] as const)
    requireSameRows(kind, ids, rows);

  const contentByDocument = new Map(
    documentContentRows.map((row) => [row.id, row.contentText]),
  );
  const textByRequirement = new Map(
    requirementTextRows.map((row) => [row.id, row.text]),
  );
  const snippetByCitation = new Map(
    citationSnippetRows.map((row) => [row.id, row.sourceSnippet]),
  );
  const documentRows = documentMetadata.map((row) => ({
    ...row,
    contentText: contentByDocument.get(row.id) ?? null,
  }));
  const requirementRows = requirementMetadata.map((row) => ({
    ...row,
    text: textByRequirement.get(row.id) ?? "",
  }));
  const citationRows = citationMetadata.map((row) => ({
    ...row,
    sourceSnippet: snippetByCitation.get(row.id) ?? "",
    verifierAuthority:
      row.verifiedByUserId && authorisedVerifierIds.has(row.verifiedByUserId)
        ? ("active_direct_tenant_evidence_approver" as const)
        : ("not_authorized" as const),
  }));
  const draftRowsForSnapshot = draftRows as Array<{
    id: string;
    status: string;
    currentVersionNumber: number;
    version: number;
    updatedAt: Date;
  }>;
  const draftVersionsForSnapshot = draftVersionRows as Array<{
    id: string;
    draftId: string;
    versionNumber: number;
    contentHash: string;
    sourceRequirementVersionSnapshot: string;
    authorType: string;
    authorUserId: string | null;
    createdAt: Date;
  }>;
  const claimsForSnapshot = claimRows as Array<{
    id: string;
    draftVersionId: string;
    groundingStatus: string;
    reviewerUserId: string | null;
    reviewedAt: Date | null;
    createdAt: Date;
  }>;
  const currentDraftVersionIds = new Set(
    draftVersionsForSnapshot.flatMap((version) =>
      draftRowsForSnapshot.some(
        (draft) =>
          draft.id === version.draftId &&
          draft.currentVersionNumber === version.versionNumber,
      )
        ? [version.id]
        : [],
    ),
  );
  const currentDraftVersions = draftVersionsForSnapshot.filter((row) =>
    currentDraftVersionIds.has(row.id),
  );
  const currentClaims = claimsForSnapshot.filter((row) =>
    currentDraftVersionIds.has(row.draftVersionId),
  );
  const outcome = [...outcomeRows].sort((left, right) =>
    left.id.localeCompare(right.id),
  )[0];

  const normalizedSnapshot = buildIntelligenceCentreSnapshot({
    environment: options.environment ?? "development",
    productionAiEnabled: false,
    generatedAt: now.toISOString(),
    project: {
      id: project.id,
      title: project.tenderTitle,
      status: project.status,
      deadline: iso(project.deadline),
      tenderReference: project.tenderRef,
      restrictedMode: project.restrictedMode,
      outcome: outcome?.outcome ?? null,
      outcomeClientConfirmed: outcome?.clientConfirmed === true,
    },
    documents: documentRows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      filename: row.filename,
      type: row.type,
      redactionStatus: row.redactionStatus,
      extractionStatus: row.extractionStatus,
      sha256: row.sha256,
      contentText: row.contentText,
      updatedAt: iso(row.updatedAt),
    })),
    documentVersions: documentVersionRows.map((row) => ({
      id: row.id,
      documentId: row.documentId,
      versionNumber: row.versionNumber,
      sha256: row.sha256,
      malwareStatus: row.malwareStatus,
      quarantineStatus: row.quarantineStatus,
      addendumStatus: row.addendumStatus,
      createdAt: iso(row.createdAt),
    })),
    requirements: requirementRows.map((row) => ({
      id: row.id,
      text: row.text,
      category: row.category,
      isMandatory: row.isMandatory,
      reviewStatus: row.reviewStatus,
      sourceDocId: row.sourceDocId,
      pageRef: row.pageRef,
      clauseRef: row.clauseRef,
      confidence: row.confidence,
      reviewerNotes: row.reviewerNotes,
      updatedAt: iso(row.updatedAt),
    })),
    requirementCitations: citationRows.map((row) => ({
      id: row.id,
      requirementId: row.requirementId,
      documentVersionId: row.documentVersionId,
      pageNumber: row.pageNumber,
      paragraphRef: row.paragraphRef,
      tableRef: row.tableRef,
      coordinateJson: row.coordinateJson,
      sourceSnippet: row.sourceSnippet,
      sourceSnippetHash: row.sourceSnippetHash,
      verificationStatus: row.verificationStatus,
      verifiedByUserId: row.verifiedByUserId,
      verifiedByName: row.verifiedByName,
      verifiedAt: iso(row.verifiedAt),
      verifierAuthority: row.verifierAuthority,
      updatedAt: iso(row.updatedAt),
    })),
    evidence: evidenceRows.map((row) => ({
      id: row.id,
      requirementId: row.requirementId,
      documentId: row.documentId,
      evidenceStatus: row.evidenceStatus,
      excerpt: row.excerpt,
      suggested: row.suggested,
      confirmedBy: row.confirmedBy,
      updatedAt: iso(row.updatedAt),
    })),
    defects: defectRows.map((row) => ({
      id: row.id,
      severity: row.severity,
      status: row.status,
      updatedAt: iso(row.updatedAt),
    })),
    boqChecks: boqRows.map((row) => ({
      id: row.id,
      sourceDocId: row.sourceDocId,
      status: row.status,
      severity: row.severity,
      updatedAt: iso(row.updatedAt),
    })),
    vaultItems: vaultRows.map((row) => ({
      id: row.id,
      artefactType: row.artefactType,
      status: row.status,
      expiryDate: row.expiryDate,
      sourceDocumentId: row.sourceDocumentId,
      sha256: row.sha256,
      updatedAt: iso(row.updatedAt),
    })),
    capabilityItems: capabilityRows.map((row) => ({
      id: row.id,
      claimType: row.claimType,
      approvedStatus: row.approvedStatus,
      evidenceDocId: row.evidenceDocId,
      verifierId: row.verifierId,
      verifierName: row.verifierName,
      verifiedAt: iso(row.verifiedAt),
      updatedAt: iso(row.updatedAt),
    })),
    drafts: draftRows.map((row) => ({
      id: row.id,
      status: row.status,
      currentVersionNumber: row.currentVersionNumber,
      updatedAt: iso(row.updatedAt),
    })),
    draftVersions: currentDraftVersions.map((row) => ({
      id: row.id,
      draftId: row.draftId,
      versionNumber: row.versionNumber,
      contentHash: row.contentHash,
      authorUserId: row.authorUserId,
      createdAt: iso(row.createdAt),
    })),
    draftClaims: currentClaims.map((row) => ({
      id: row.id,
      draftVersionId: row.draftVersionId,
      groundingStatus: row.groundingStatus,
      reviewerUserId: row.reviewerUserId,
      reviewedAt: iso(row.reviewedAt),
      createdAt: iso(row.createdAt),
    })),
    workTasks: taskRows.map((row) => ({
      id: row.id,
      status: row.status,
      dueAt: iso(row.dueAt),
      updatedAt: iso(row.updatedAt),
    })),
    opportunities: tenderRows.map((row) => ({
      id: row.id,
      reference: row.reference,
      title: row.title,
      sourceType: row.sourceType,
      status: row.status,
      submissionDeadline: iso(row.submissionDeadline),
      updatedAt: iso(row.updatedAt),
    })),
    packages: packageRows.map((row) => ({
      id: row.id,
      status: row.status,
      currentVersionNumber: row.currentVersionNumber,
      updatedAt: iso(row.updatedAt),
    })),
    packageVersions: packageVersionRows.map((row) => ({
      id: row.id,
      packageId: row.packageId,
      versionNumber: row.versionNumber,
      sourceSnapshotHash: row.sourceSnapshotHash,
      manifestHash: row.manifestHash,
      docxSha256: row.docxSha256,
      pdfSha256: row.pdfSha256,
      zipSha256: row.zipSha256,
      renderQaStatus: row.renderQaStatus,
      generatedByUserId: row.generatedByUserId,
      createdAt: iso(row.createdAt),
    })),
    packageSignoffs: signoffRows.map((row) => ({
      id: row.id,
      packageVersionId: row.packageVersionId,
      signerUserId: row.signerUserId,
      signerRole: row.signerRole,
      signerAuthority: row.signerAuthority,
      intentStatement: row.intentStatement,
      documentHash: row.documentHash,
      trustedTimestamp: iso(row.trustedTimestamp),
      mfaEvidence: row.mfaEvidence,
      deviceEventEvidence: row.deviceEventEvidence,
    })),
    reportStatuses: reportRows.map((row) => ({
      id: row.id,
      version: row.version,
      status: row.status,
      reviewerId: row.reviewerId,
      reviewerName: row.reviewerName,
      attestation: row.attestation,
      engineVersion: row.engineVersion,
      promptPackVersion: row.promptPackVersion,
      modelId: row.modelId,
      taxonomyVersion: row.taxonomyVersion,
      signedOffAt: iso(row.signedOffAt),
      updatedAt: iso(row.updatedAt),
    })),
  });

  const records: IntelligenceSourceVersionRecord[] = [
    record("project", project, project, project.version),
    ...documentRows.map((row) => record("document", row, row, row.version)),
    ...documentVersionRows.map((row) =>
      record("document_version", row, row, row.versionNumber),
    ),
    ...requirementRows.map((row) =>
      record("requirement", row, row, row.version),
    ),
    ...citationRows.map((row) =>
      record("requirement_citation", row, row, row.version),
    ),
    ...evidenceRows.map((row) => record("evidence", row, row, row.version)),
    ...defectRows.map((row) => record("defect", row, row, row.version)),
    ...boqRows.map((row) => record("boq_check", row, row, row.version)),
    ...draftRows.map((row) => record("draft", row, row, row.version)),
    ...draftVersionRows.map((row) =>
      record("draft_version", row, row, row.versionNumber),
    ),
    ...claimRows.map((row) => record("draft_claim", row, row)),
    ...taskRows.map((row) => record("work_task", row, row, row.version)),
    ...packageRows.map((row) => record("package", row, row, row.version)),
    ...packageVersionRows.map((row) =>
      record("package_version", row, row, row.versionNumber),
    ),
    ...signoffRows.map((row) => record("package_signoff", row, row)),
    ...reportRows.map((row) =>
      record("report", row, row, row.optimisticLockVersion),
    ),
    ...outcomeRows.map((row) => record("outcome", row, row, row.version)),
    ...vaultRows.map((row) => record("vault_item", row, row, row.version)),
    ...capabilityRows.map((row) =>
      record("capability_item", row, row, row.version),
    ),
    ...tenderRows.map((row) => record("tender", row, row, row.version)),
    {
      kind: "snapshot_policy",
      id: INTELLIGENCE_SOURCE_BINDING_POLICY_VERSION,
      version: 2,
      fingerprint: hashIntelligenceSourceFields({
        policyVersion: INTELLIGENCE_SOURCE_BINDING_POLICY_VERSION,
        snapshotEngineVersion: INTELLIGENCE_SNAPSHOT_ENGINE_VERSION,
        productionAiEnabled: false,
        temporalPolicy: "utc_strict-boundary-v1",
        normalizedOutput: "project-and-capabilities-without-generatedAt-v1",
      }),
    },
    {
      kind: "snapshot_temporal_state",
      id: project.id,
      version: 1,
      fingerprint: hashIntelligenceSourceFields({
        projectDeadline: temporalState(
          project.deadline,
          now,
          "future_is_ready",
        ),
        vaultExpiry: vaultRows
          .map((row) => ({
            id: row.id,
            state: row.expiryDate
              ? temporalState(row.expiryDate, now, "future_is_ready")
              : "no_expiry",
          }))
          .sort((left, right) => left.id.localeCompare(right.id)),
        packageTrustedTimestamps: signoffRows
          .map((row) => ({
            id: row.id,
            state: temporalState(row.trustedTimestamp, now, "past_is_ready"),
          }))
          .sort((left, right) => left.id.localeCompare(right.id)),
        reportSignedOffTimestamps: reportRows
          .map((row) => ({
            id: row.id,
            state: temporalState(row.signedOffAt, now, "past_is_ready"),
          }))
          .sort((left, right) => left.id.localeCompare(right.id)),
      }),
    },
    {
      kind: "snapshot_output",
      id: project.id,
      version: 1,
      fingerprint: hashIntelligenceSourceFields({
        restrictedMode: normalizedSnapshot.restrictedMode,
        project: normalizedSnapshot.project,
        capabilities: normalizedSnapshot.capabilities,
      }),
    },
  ];

  return {
    source: computeIntelligenceSourceVersion({ projectId, records }),
    snapshot: normalizedSnapshot,
  };
}

export async function loadIntelligenceSourceBinding(
  projectId: string,
  options: {
    organisationId: string;
    now?: Date;
    environment?: IntelligenceCentreSnapshot["environment"];
  },
): Promise<IntelligenceSourceVersion | null> {
  const projection = await loadIntelligenceSourceProjection(projectId, options);
  return projection?.source ?? null;
}
