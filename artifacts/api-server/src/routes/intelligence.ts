import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
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
  outcomes,
  packages,
  packageSignoffs,
  packageVersions,
  projects,
  reports,
  requirementCitations,
  requirements,
  tenders,
  users,
  vaultItems,
  workTasks,
} from "@workspace/db";
import { requirePermissionOrLegacy } from "../middlewares/tenancy";
import { buildIntelligenceCentreSnapshot } from "../lib/intelligence/snapshot";
import type { Permission } from "../lib/permissions";

const router: IRouter = Router();

const INTELLIGENCE_READ_PERMISSIONS = [
  "client:read",
  "project:read",
  "document:read",
  "requirement:read",
  "evidence:read",
  "defect:read",
  "report:read",
  "draft:read",
  "package:read",
] as const satisfies readonly Permission[];

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function publicEnvironment(): "production" | "staging" | "development" {
  if (process.env.NODE_ENV === "production") return "production";
  if (process.env.VALO_ENVIRONMENT === "staging") return "staging";
  return "development";
}

router.get(
  "/projects/:id/intelligence",
  ...INTELLIGENCE_READ_PERMISSIONS.map((permission) =>
    requirePermissionOrLegacy(permission),
  ),
  async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "private, no-store");
    const projectId = String(req.params.id);
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!project) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const [
      projectDocuments,
      projectRequirements,
      projectEvidence,
      projectDefects,
      projectBoqChecks,
      clientVaultItems,
      clientCapabilityItems,
      projectDrafts,
      projectTasks,
      organisationOpportunities,
      projectPackages,
      projectReports,
      projectOutcomes,
    ] = await Promise.all([
      db.select().from(documents).where(eq(documents.projectId, projectId)),
      db
        .select()
        .from(requirements)
        .where(eq(requirements.projectId, projectId)),
      db
        .select()
        .from(evidenceItems)
        .where(eq(evidenceItems.projectId, projectId)),
      db.select().from(defects).where(eq(defects.projectId, projectId)),
      db.select().from(boqChecks).where(eq(boqChecks.projectId, projectId)),
      db
        .select()
        .from(vaultItems)
        .where(eq(vaultItems.clientId, project.clientId)),
      db
        .select()
        .from(capabilityItems)
        .where(eq(capabilityItems.clientId, project.clientId)),
      db.select().from(drafts).where(eq(drafts.projectId, projectId)),
      db.select().from(workTasks).where(eq(workTasks.projectId, projectId)),
      project.tenderRef?.trim()
        ? db
            .select()
            .from(tenders)
            .where(eq(tenders.reference, project.tenderRef))
        : Promise.resolve([]),
      db.select().from(packages).where(eq(packages.projectId, projectId)),
      db
        .select()
        .from(reports)
        .where(eq(reports.projectId, projectId))
        .orderBy(desc(reports.version))
        .limit(1),
      db.select().from(outcomes).where(eq(outcomes.projectId, projectId)),
    ]);

    const [
      projectDocumentVersions,
      projectRequirementCitations,
      allDraftVersions,
      packageRows,
    ] = await Promise.all([
      projectDocuments.length > 0
        ? db
            .select()
            .from(documentVersions)
            .where(
              inArray(
                documentVersions.documentId,
                projectDocuments.map((document) => document.id),
              ),
            )
        : Promise.resolve([]),
      projectRequirements.length > 0
        ? db
            .select({
              id: requirementCitations.id,
              requirementId: requirementCitations.requirementId,
              documentVersionId: requirementCitations.documentVersionId,
              pageNumber: requirementCitations.pageNumber,
              paragraphRef: requirementCitations.paragraphRef,
              tableRef: requirementCitations.tableRef,
              sourceSnippet: requirementCitations.sourceSnippet,
              sourceSnippetHash: requirementCitations.sourceSnippetHash,
              verificationStatus: requirementCitations.verificationStatus,
              verifiedByUserId: requirementCitations.verifiedByUserId,
              verifiedByName: users.name,
              verifiedAt: requirementCitations.verifiedAt,
              updatedAt: requirementCitations.updatedAt,
            })
            .from(requirementCitations)
            .innerJoin(
              documentVersions,
              eq(requirementCitations.documentVersionId, documentVersions.id),
            )
            .innerJoin(documents, eq(documentVersions.documentId, documents.id))
            .leftJoin(
              users,
              eq(requirementCitations.verifiedByUserId, users.id),
            )
            .where(
              and(
                inArray(
                  requirementCitations.requirementId,
                  projectRequirements.map((requirement) => requirement.id),
                ),
                eq(documents.projectId, projectId),
              ),
            )
        : Promise.resolve([]),
      projectDrafts.length > 0
        ? db
            .select()
            .from(draftVersions)
            .where(
              inArray(
                draftVersions.draftId,
                projectDrafts.map((draft) => draft.id),
              ),
            )
        : Promise.resolve([]),
      projectPackages.length > 0
        ? db
            .select()
            .from(packageVersions)
            .where(
              inArray(
                packageVersions.packageId,
                projectPackages.map((item) => item.id),
              ),
            )
        : Promise.resolve([]),
    ]);

    const typedDraftVersions = allDraftVersions as Array<
      typeof draftVersions.$inferSelect
    >;
    const currentDraftVersions = typedDraftVersions.filter((version) =>
      projectDrafts.some(
        (draft) =>
          draft.id === version.draftId &&
          draft.currentVersionNumber === version.versionNumber,
      ),
    );
    const [claims, packageSignoffRows] = await Promise.all([
      currentDraftVersions.length > 0
        ? db
            .select()
            .from(draftClaims)
            .where(
              inArray(
                draftClaims.draftVersionId,
                currentDraftVersions.map((version) => version.id),
              ),
            )
        : Promise.resolve([]),
      packageRows.length > 0
        ? db
            .select()
            .from(packageSignoffs)
            .where(
              inArray(
                packageSignoffs.packageVersionId,
                packageRows.map((version) => version.id),
              ),
            )
        : Promise.resolve([]),
    ]);

    const snapshot = buildIntelligenceCentreSnapshot({
      environment: publicEnvironment(),
      // The Intelligence Centre is deterministic in this release. This field
      // must not imply that any of its ten future model-backed variants is
      // production-approved merely because older bounded AI routes exist.
      productionAiEnabled: false,
      generatedAt: new Date().toISOString(),
      project: {
        id: project.id,
        title: project.tenderTitle,
        status: project.status,
        deadline: iso(project.deadline),
        tenderReference: project.tenderRef,
        restrictedMode: project.restrictedMode,
        outcome: projectOutcomes[0]?.outcome ?? null,
        outcomeClientConfirmed: projectOutcomes[0]?.clientConfirmed === true,
      },
      documents: projectDocuments.map((document) => ({
        id: document.id,
        projectId: document.projectId,
        filename: document.filename,
        type: document.type,
        redactionStatus: document.redactionStatus,
        extractionStatus: document.extractionStatus,
        sha256: document.sha256,
        contentText: document.contentText,
        updatedAt: iso(document.updatedAt),
      })),
      documentVersions: projectDocumentVersions.map((version) => ({
        id: version.id,
        documentId: version.documentId,
        versionNumber: version.versionNumber,
        sha256: version.sha256,
        malwareStatus: version.malwareStatus,
        quarantineStatus: version.quarantineStatus,
        addendumStatus: version.addendumStatus,
        createdAt: iso(version.createdAt),
      })),
      requirements: projectRequirements.map((requirement) => ({
        id: requirement.id,
        text: requirement.text,
        category: requirement.category,
        isMandatory: requirement.isMandatory,
        reviewStatus: requirement.reviewStatus,
        sourceDocId: requirement.sourceDocId,
        pageRef: requirement.pageRef,
        clauseRef: requirement.clauseRef,
        confidence: requirement.confidence,
        reviewerNotes: requirement.reviewerNotes,
        updatedAt: iso(requirement.updatedAt),
      })),
      requirementCitations: projectRequirementCitations.map((citation) => ({
        id: citation.id,
        requirementId: citation.requirementId,
        documentVersionId: citation.documentVersionId,
        pageNumber: citation.pageNumber,
        paragraphRef: citation.paragraphRef,
        tableRef: citation.tableRef,
        sourceSnippet: citation.sourceSnippet,
        sourceSnippetHash: citation.sourceSnippetHash,
        verificationStatus: citation.verificationStatus,
        verifiedByUserId: citation.verifiedByUserId,
        verifiedByName: citation.verifiedByName,
        verifiedAt: iso(citation.verifiedAt),
        updatedAt: iso(citation.updatedAt),
      })),
      evidence: projectEvidence.map((item) => ({
        id: item.id,
        requirementId: item.requirementId,
        documentId: item.documentId,
        evidenceStatus: item.evidenceStatus,
        excerpt: item.excerpt,
        suggested: item.suggested,
        confirmedBy: item.confirmedBy,
        updatedAt: iso(item.updatedAt),
      })),
      defects: projectDefects.map((defect) => ({
        id: defect.id,
        severity: defect.severity,
        status: defect.status,
        updatedAt: iso(defect.updatedAt),
      })),
      boqChecks: projectBoqChecks.map((check) => ({
        id: check.id,
        sourceDocId: check.sourceDocId,
        status: check.status,
        severity: check.severity,
        updatedAt: iso(check.updatedAt),
      })),
      vaultItems: clientVaultItems.map((item) => ({
        id: item.id,
        artefactType: item.artefactType,
        status: item.status,
        expiryDate: item.expiryDate,
        sourceDocumentId: item.sourceDocumentId,
        sha256: item.sha256,
        updatedAt: iso(item.updatedAt),
      })),
      capabilityItems: clientCapabilityItems.map((item) => ({
        id: item.id,
        claimType: item.claimType,
        approvedStatus: item.approvedStatus,
        evidenceDocId: item.evidenceDocId,
        verifierId: item.verifierId,
        verifierName: item.verifierName,
        verifiedAt: iso(item.verifiedAt),
        updatedAt: iso(item.updatedAt),
      })),
      drafts: projectDrafts.map((draft) => ({
        id: draft.id,
        status: draft.status,
        currentVersionNumber: draft.currentVersionNumber,
        updatedAt: iso(draft.updatedAt),
      })),
      draftVersions: currentDraftVersions.map((version) => ({
        id: version.id,
        draftId: version.draftId,
        versionNumber: version.versionNumber,
        contentHash: version.contentHash,
        authorUserId: version.authorUserId,
        createdAt: iso(version.createdAt),
      })),
      draftClaims: claims.map((claim) => ({
        id: claim.id,
        draftVersionId: claim.draftVersionId,
        groundingStatus: claim.groundingStatus,
        reviewerUserId: claim.reviewerUserId,
        reviewedAt: iso(claim.reviewedAt),
        createdAt: iso(claim.createdAt),
      })),
      workTasks: projectTasks.map((task) => ({
        id: task.id,
        status: task.status,
        dueAt: iso(task.dueAt),
        updatedAt: iso(task.updatedAt),
      })),
      opportunities: organisationOpportunities.map((opportunity) => ({
        id: opportunity.id,
        reference: opportunity.reference,
        title: opportunity.title,
        sourceType: opportunity.sourceType,
        status: opportunity.status,
        submissionDeadline: iso(opportunity.submissionDeadline),
        updatedAt: iso(opportunity.updatedAt),
      })),
      packages: projectPackages.map((item) => ({
        id: item.id,
        status: item.status,
        currentVersionNumber: item.currentVersionNumber,
        updatedAt: iso(item.updatedAt),
      })),
      packageVersions: packageRows.map((version) => ({
        id: version.id,
        packageId: version.packageId,
        versionNumber: version.versionNumber,
        sourceSnapshotHash: version.sourceSnapshotHash,
        manifestHash: version.manifestHash,
        docxSha256: version.docxSha256,
        pdfSha256: version.pdfSha256,
        zipSha256: version.zipSha256,
        renderQaStatus: version.renderQaStatus,
        generatedByUserId: version.generatedByUserId,
        createdAt: iso(version.createdAt),
      })),
      packageSignoffs: packageSignoffRows.map((signoff) => ({
        id: signoff.id,
        packageVersionId: signoff.packageVersionId,
        signerUserId: signoff.signerUserId,
        signerRole: signoff.signerRole,
        signerAuthority: signoff.signerAuthority,
        intentStatement: signoff.intentStatement,
        documentHash: signoff.documentHash,
        trustedTimestamp: iso(signoff.trustedTimestamp),
        mfaEvidence: signoff.mfaEvidence,
        deviceEventEvidence: signoff.deviceEventEvidence,
      })),
      reportStatuses: projectReports.map((report) => ({
        id: report.id,
        version: report.version,
        status: report.status,
        reviewerId: report.reviewerId,
        reviewerName: report.reviewerName,
        attestation: report.attestation,
        engineVersion: report.engineVersion,
        promptPackVersion: report.promptPackVersion,
        modelId: report.modelId,
        taxonomyVersion: report.taxonomyVersion,
        signedOffAt: iso(report.signedOffAt),
        updatedAt: iso(report.updatedAt),
      })),
    });

    res.json(snapshot);
  },
);

export default router;
