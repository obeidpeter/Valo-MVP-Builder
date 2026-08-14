import { createHash, randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, isNull, ne, or } from "drizzle-orm";
import {
  db,
  documentVersions,
  documents,
  users,
  projects,
  clients,
} from "@workspace/db";
import { CreateDocumentBody, UpdateDocumentBody } from "@workspace/api-zod";
import { getLocalUser } from "../middlewares/auth";
import {
  getOrganisationId,
  hasRequestPermission,
  requirePermissionOrLegacy,
} from "../middlewares/tenancy";
import { serializeDocument } from "../lib/serializers";
import { writeAudit } from "../lib/audit";
import {
  downloadDocumentBuffer,
  extractDocumentTextFromBuffer,
  type ExtractionResult,
} from "../lib/extractText";
import {
  ObjectNotFoundError,
  ObjectPromotionCleanupError,
  ObjectQuarantinePartialMoveError,
  ObjectStorageService,
} from "../lib/objectStorage";
import { inspectDocumentIntake } from "../lib/documentIntakeSecurity";
import { canonicalMimeForDetectedFormat } from "../lib/uploadInspection";
import { productionFeatureIssues } from "../lib/productionReadiness";
import {
  EXCLUDED_EXTRACTION_NOTES,
  initialExtractionState,
  stateAfterRedactionChange,
} from "../lib/documentExtractionPolicy";
import { isOwnedStagedUploadPath } from "../lib/stagedUploadCleanup";
import { lockStagedUploadObject } from "../lib/stagedUploadLock";
import { storagePathReferenceKinds } from "../lib/storageReferences";
import { lockCanonicalEvidenceDigest } from "../lib/canonicalEvidence";
import { enqueueStorageDeletionIntent } from "../lib/storageLifecycle/repository";
import { holdTenantDatabaseUntilComplete } from "../middlewares/databaseTenancy";

const sha256Hex = (buf: Buffer): string =>
  createHash("sha256").update(buf).digest("hex");

function governedVersionIntegrityManifest(input: {
  organisationId: string;
  documentId: string;
  objectPath: string;
  sha256: string;
  sizeBytes: number;
  detectedFormat: string;
  detectedMime: string;
  scannerProvider: string;
  scannerEngineVersion: string;
  scannerEvidence: string | null;
}): string {
  const scannerEvidenceSha256 = input.scannerEvidence
    ? createHash("sha256").update(input.scannerEvidence, "utf8").digest("hex")
    : null;
  return JSON.stringify({
    schema: "valo.document-version-integrity/v1",
    versionNumber: 1,
    organisationId: input.organisationId,
    documentId: input.documentId,
    objectPath: input.objectPath,
    sha256: input.sha256,
    sizeBytes: input.sizeBytes,
    detectedFormat: input.detectedFormat,
    detectedMime: input.detectedMime,
    malwareStatus: "clean",
    quarantineStatus: "cleared",
    scanner: {
      provider: input.scannerProvider,
      engineVersion: input.scannerEngineVersion,
      evidenceSha256: scannerEvidenceSha256,
    },
  });
}

class PromotedObjectIntegrityError extends Error {
  constructor(
    public readonly expectedSha256: string,
    public readonly actualSha256: string,
  ) {
    super("Promoted document bytes did not match the inspected intake bytes");
    this.name = "PromotedObjectIntegrityError";
  }
}

const NDA_ALLOWED = new Set(["signed", "not_required"]);

/** Look up the client NDA status backing a project (null = project missing). */
async function projectNdaStatus(
  projectId: string,
  lockClient = false,
): Promise<{ ndaStatus: string | null; conflictStatus: string | null } | null> {
  const query = db
    .select({
      ndaStatus: clients.ndaStatus,
      conflictStatus: projects.conflictStatus,
    })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(eq(projects.id, projectId));
  // A final registration read takes a row SHARE lock on the client. Concurrent
  // NDA UPDATE then waits until the document transaction commits, closing the
  // recheck→promotion/insert race without blocking ordinary list reads.
  const [row] = lockClient
    ? await query.for("share", { of: clients })
    : await query;
  return row ?? null;
}

const objectStorage = new ObjectStorageService();

const router: IRouter = Router();

router.get(
  "/projects/:id/documents",
  requirePermissionOrLegacy("document:read"),
  async (req: Request, res: Response) => {
    const rows = await db
      .select({ doc: documents, uploadedByName: users.name })
      .from(documents)
      .leftJoin(users, eq(documents.uploadedBy, users.id))
      .where(eq(documents.projectId, String(req.params.id)))
      .orderBy(desc(documents.createdAt));
    res.json(rows.map((r) => serializeDocument(r.doc, r.uploadedByName)));
  },
);

router.post(
  "/projects/:id/documents",
  requirePermissionOrLegacy("document:upload"),
  async (req: Request, res: Response) => {
    const parsed = CreateDocumentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    const projectId = String(req.params.id);
    const user = getLocalUser(req);
    const organisationId = getOrganisationId(req);
    if (
      !organisationId ||
      !isOwnedStagedUploadPath(parsed.data.objectPath, organisationId)
    ) {
      res.status(400).json({
        error:
          "Uploaded object is outside the active organisation's staging namespace",
      });
      return;
    }

    // NDA gate: documents cannot be uploaded until the client's NDA position
    // is recorded (signed or explicitly not required). Pending/declined blocks.
    // Fail closed AND leave a trace (FR-INT-01: denied intakes are logged with
    // actor and timestamp, not silently rejected).
    const denyNda = async (ndaStatus: string | null) => {
      await writeAudit({
        user,
        projectId,
        eventType: "document.intake_denied",
        objectType: "project",
        objectId: projectId,
        details: `NDA gate blocked upload of "${parsed.data.filename}" (client NDA status: ${ndaStatus ?? "unknown"}).`,
      });
      res.status(403).json({
        error:
          "NDA not cleared for this client. Record the NDA as signed or not required before uploading documents.",
        ndaStatus: ndaStatus ?? "unknown",
      });
    };

    const gate = await projectNdaStatus(projectId);
    if (!gate) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!gate.ndaStatus || !NDA_ALLOWED.has(gate.ndaStatus)) {
      await denyNda(gate.ndaStatus);
      return;
    }
    if (
      gate.conflictStatus === "blocked" ||
      gate.conflictStatus === "declined"
    ) {
      await writeAudit({
        user,
        projectId,
        eventType: "document.intake_denied",
        objectType: "project",
        objectId: projectId,
        details: `Conflict gate blocked upload of "${parsed.data.filename}" (status: ${gate.conflictStatus}).`,
      });
      res.status(409).json({
        error:
          "Conflict check is not clear or consented. Resolve conflict status before intake.",
        conflictStatus: gate.conflictStatus,
      });
      return;
    }
    if (parsed.data.redactionStatus !== "excluded") {
      await writeAudit({
        user,
        projectId,
        eventType: "document.intake_denied",
        objectType: "project",
        objectId: projectId,
        details: `Document registration for "${parsed.data.filename}" was denied because new uploads must begin excluded; extraction requires a later reviewer decision and deliberate start.`,
      });
      res.status(400).json({
        error:
          "New documents must be registered as excluded. A reviewer can make the saved document included or redacted before deliberately starting extraction.",
      });
      return;
    }

    // Take the object lock before the first storage read or any secure-intake
    // disposition. Reusing an already-registered object path must never let a
    // caller trigger duplicate handling that purges/quarantines another
    // document's blob.
    await lockStagedUploadObject(parsed.data.objectPath);
    const pathReferences = await storagePathReferenceKinds(
      parsed.data.objectPath,
    );
    if (pathReferences.length > 0) {
      await writeAudit({
        user,
        projectId,
        eventType: "document.intake_denied",
        objectType: "staged_upload",
        objectId: parsed.data.objectPath.split("/").at(-1) ?? null,
        details: `Registration denied because this staged object path is already referenced by persisted tenant artefact categories (${pathReferences.join(", ")}); storage was not read, deleted or quarantined.`,
      });
      res.status(409).json({
        error:
          "This uploaded object is already referenced by a tenant artefact and was not changed.",
        disposition: "referenced",
      });
      return;
    }

    // Download the stored object once for its intake hash and security
    // inspection (FR-INT-02). No parser/model extraction runs during create.
    // Fail closed: an unreadable object cannot enter the corpus without an
    // integrity baseline.
    let buffer: Buffer;
    try {
      buffer = await downloadDocumentBuffer(parsed.data.objectPath);
    } catch (error) {
      req.log.warn(
        { err: error, objectPath: parsed.data.objectPath },
        "could not read uploaded object for hashing and security inspection",
      );
      await writeAudit({
        user,
        projectId,
        eventType: "document.intake_failed",
        objectType: "project",
        objectId: projectId,
        details: `Uploaded object for "${parsed.data.filename}" could not be read from storage (${parsed.data.objectPath}); intake rejected without an integrity hash.`,
      });
      res.status(422).json({
        error:
          "The uploaded file could not be read back from storage, so its intake hash could not be recorded. Please upload it again.",
      });
      return;
    }
    const measuredSha256 = sha256Hex(buffer);
    const knownTenantHashes = organisationId
      ? (
          await db
            .select({ sha256: documents.sha256 })
            .from(documents)
            .where(
              and(
                eq(documents.organisationId, organisationId),
                eq(documents.sha256, measuredSha256),
              ),
            )
            .limit(1)
        )
          .map((row) => row.sha256)
          .filter((value): value is string => Boolean(value))
      : [];
    const inspection = await inspectDocumentIntake({
      tenantId: organisationId ?? "legacy",
      filename: parsed.data.filename,
      declaredMime: parsed.data.contentType ?? "application/octet-stream",
      bytes: buffer,
      idempotencyKey: req.get("Idempotency-Key") ?? parsed.data.objectPath,
      knownTenantHashes,
    });
    const providerIssues =
      process.env.NODE_ENV === "production"
        ? productionFeatureIssues("document_intake")
        : [];
    if (!inspection.mayProcess || providerIssues.length > 0) {
      await disposeRejectedIntake({
        req,
        res,
        user,
        projectId,
        parsed,
        buffer,
        inspection,
        providerIssues,
      });
      return;
    }
    const sha256 = inspection.sha256;
    const detectedMime = canonicalMimeForDetectedFormat(
      inspection.detectedFormat,
    );
    if (
      inspection.malware.state !== "clean" ||
      inspection.disposition !== "ready" ||
      !inspection.mayProcess ||
      !detectedMime ||
      !inspection.malware.provider ||
      !inspection.malware.engineVersion
    ) {
      res.status(503).json({
        error:
          "Secure intake did not establish the governed version metadata required for registration.",
      });
      return;
    }

    // Re-check the NDA gate after the (slow) download so a mid-flight NDA
    // revocation cannot slip a document in behind the earlier check.
    const regate = await projectNdaStatus(projectId, true);
    if (!regate || !regate.ndaStatus || !NDA_ALLOWED.has(regate.ndaStatus)) {
      await denyNda(regate?.ndaStatus ?? null);
      return;
    }
    if (
      regate.conflictStatus === "blocked" ||
      regate.conflictStatus === "declined"
    ) {
      await writeAudit({
        user,
        projectId,
        eventType: "document.intake_denied",
        objectType: "project",
        objectId: projectId,
        details: `Conflict gate blocked upload of "${parsed.data.filename}" after storage read (status: ${regate.conflictStatus}).`,
      });
      res.status(409).json({
        error:
          "Conflict check is not clear or consented. Resolve conflict status before intake.",
        conflictStatus: regate.conflictStatus,
      });
      return;
    }

    const extractionState = initialExtractionState("excluded");
    const documentId = randomUUID();
    let finalizedObjectPath: string | null = null;
    let created: typeof documents.$inferSelect;
    try {
      // Keep registration ordered with privacy evidence revalidation. This
      // transaction-scoped key remains held through the request commit.
      await lockCanonicalEvidenceDigest(organisationId, sha256);

      // Write the exact inspected buffer to a create-only, server-controlled
      // path and revoke the staged path before the row can be committed. A
      // still-live signed PUT can therefore never replace registered bytes.
      finalizedObjectPath = await objectStorage.promoteStagedUploadToDocument(
        parsed.data.objectPath,
        documentId,
        buffer,
        detectedMime,
      );

      // Verify the stable object before registration as an independent storage
      // integrity check. Manual extraction repeats this SHA-256 gate later.
      const finalizedBuffer = await downloadDocumentBuffer(finalizedObjectPath);
      const finalizedSha256 = sha256Hex(finalizedBuffer);
      if (
        finalizedBuffer.length !== buffer.length ||
        finalizedSha256 !== sha256
      ) {
        throw new PromotedObjectIntegrityError(sha256, finalizedSha256);
      }

      [created] = await db
        .insert(documents)
        .values({
          ...parsed.data,
          id: documentId,
          objectPath: finalizedObjectPath,
          redactionStatus: "excluded",
          organisationId,
          projectId,
          uploadedBy: user?.id ?? null,
          sha256,
          // Record the measured size of the bytes we hashed, not the client's
          // claim — the manifest must be internally consistent.
          size: buffer.length,
          ...extractionState,
        })
        .returning();

      await db.insert(documentVersions).values({
        organisationId,
        documentId: created.id,
        versionNumber: 1,
        objectPath: finalizedObjectPath,
        sha256,
        detectedMime,
        detectedFormat: inspection.detectedFormat,
        sizeBytes: buffer.length,
        malwareStatus: "clean",
        quarantineStatus: "cleared",
        integrityManifest: governedVersionIntegrityManifest({
          organisationId,
          documentId: created.id,
          objectPath: finalizedObjectPath,
          sha256,
          sizeBytes: buffer.length,
          detectedFormat: inspection.detectedFormat,
          detectedMime,
          scannerProvider: inspection.malware.provider,
          scannerEngineVersion: inspection.malware.engineVersion,
          scannerEvidence: inspection.malware.evidence,
        }),
        uploadedBy: user?.id ?? null,
      });

      // Intake manifest: filename, SHA-256, measured size, received-at all
      // live in the audit chain so the record is tamper-evident from intake
      // onward. Registration never starts extraction.
      await writeAudit({
        user,
        projectId,
        eventType: "document.created",
        objectType: "document",
        objectId: created.id,
        details: `${created.type}: ${created.filename} | sha256=${sha256} | size=${buffer.length}B | redaction=${created.redactionStatus} | extraction=${created.extractionStatus} | storage=promoted`,
      });

      await writeAudit({
        user,
        projectId,
        eventType: "document.extraction_skipped",
        objectType: "document",
        objectId: created.id,
        details: EXCLUDED_EXTRACTION_NOTES,
      });
    } catch (error) {
      await cleanupFailedPromotion({
        req,
        res,
        user,
        projectId,
        parsed,
        error,
        finalizedObjectPath,
      });
      return;
    }

    res.status(201).json(serializeDocument(created, user?.name));
  },
);

/**
 * Rejected-intake disposition ladder (moved verbatim out of the create
 * handler): purge or quarantine the staged object, record the content-free
 * audit manifest, and answer with the explicit storage disposition. Ambiguous
 * quarantine retention stays explicitly unknown in both audit and response.
 */
async function disposeRejectedIntake({
  req,
  res,
  user,
  projectId,
  parsed,
  buffer,
  inspection,
  providerIssues,
}: {
  req: Request;
  res: Response;
  user: ReturnType<typeof getLocalUser>;
  projectId: string;
  parsed: { data: ReturnType<(typeof CreateDocumentBody)["parse"]> };
  buffer: Buffer;
  inspection: Awaited<ReturnType<typeof inspectDocumentIntake>>;
  providerIssues: ReturnType<typeof productionFeatureIssues>;
}): Promise<void> {
  let storedObjectDisposition = "retained outside the document corpus";
  let quarantinedPath: string | null = null;
  let possibleQuarantinedPath: string | null = null;
  let quarantineRetained: boolean | null = false;
  let cleanupConfirmed = false;
  try {
    if (
      inspection.disposition === "rejected" ||
      inspection.disposition === "duplicate"
    ) {
      const deleted = await objectStorage.deleteObjectEntity(
        parsed.data.objectPath,
      );
      storedObjectDisposition = deleted ? "purged" : "already absent";
      cleanupConfirmed = true;
    } else {
      quarantinedPath = await objectStorage.quarantineObjectEntity(
        parsed.data.objectPath,
        buffer,
        parsed.data.contentType ?? null,
      );
      storedObjectDisposition = "moved to inaccessible quarantine";
      quarantineRetained = true;
      cleanupConfirmed = true;
    }
  } catch (error) {
    req.log.error(
      { err: error, objectPath: parsed.data.objectPath },
      "failed to move rejected intake into quarantine",
    );
    if (error instanceof ObjectQuarantinePartialMoveError) {
      // The exact inspected copy is either confirmed retained, or its
      // write/cleanup acknowledgement is explicitly unknown. A second
      // source cleanup must never erase that fact from response or audit.
      quarantinedPath = error.quarantineCopyConfirmed
        ? error.quarantinePath
        : null;
      possibleQuarantinedPath = error.quarantineCopyConfirmed
        ? null
        : error.quarantinePath;
      quarantineRetained = error.quarantineCopyConfirmed ? true : null;
      storedObjectDisposition = error.quarantineCopyConfirmed
        ? "security-quarantine copy retained; original staging cleanup could not be confirmed"
        : "security-quarantine copy may be retained; copy and original staging dispositions could not be confirmed";
      try {
        const deleted = await objectStorage.deleteObjectEntity(
          parsed.data.objectPath,
        );
        storedObjectDisposition = error.quarantineCopyConfirmed
          ? deleted
            ? "original staging object purged; security-quarantine copy retained"
            : "original staging object already absent; security-quarantine copy retained"
          : deleted
            ? "original staging object purged; security-quarantine copy disposition remains unconfirmed"
            : "original staging object already absent; security-quarantine copy disposition remains unconfirmed";
        cleanupConfirmed = error.quarantineCopyConfirmed;
      } catch (deleteError) {
        req.log.error(
          { err: deleteError, objectPath: parsed.data.objectPath },
          "failed to confirm staging cleanup after quarantine copy succeeded",
        );
      }
    } else {
      try {
        const deleted = await objectStorage.deleteObjectEntity(
          parsed.data.objectPath,
        );
        storedObjectDisposition = deleted
          ? "purged after quarantine move failed"
          : "not found after quarantine move failed";
        cleanupConfirmed = true;
      } catch (deleteError) {
        req.log.error(
          { err: deleteError, objectPath: parsed.data.objectPath },
          "failed to purge rejected intake after quarantine move failed",
        );
        storedObjectDisposition = "quarantine move and purge both failed";
      }
    }
  }
  const eventDisposition = providerIssues.length
    ? "quarantined"
    : inspection.disposition;
  await writeAudit({
    user,
    projectId,
    eventType: `document.intake_${eventDisposition}`,
    objectType: "project",
    objectId: projectId,
    details: JSON.stringify({
      filename: parsed.data.filename,
      sha256: inspection.sha256,
      detectedFormat: inspection.detectedFormat,
      findings: inspection.findings.map((finding) => finding.code),
      providerIssues: providerIssues.map((issue) => ({
        kind: issue.kind,
        code: issue.code,
      })),
      malware: {
        state: inspection.malware.state,
        provider: inspection.malware.provider,
        engineVersion: inspection.malware.engineVersion,
      },
      archiveReason: inspection.archiveReason,
      storedObjectDisposition,
      quarantinedPath,
      possibleQuarantinedPath,
    }),
  });
  const scannerUnavailable =
    inspection.findings.some(
      (finding) => finding.code === "malware_scan_incomplete",
    ) || providerIssues.length > 0;
  res
    .status(
      scannerUnavailable
        ? 503
        : inspection.disposition === "duplicate"
          ? 409
          : 422,
    )
    .json({
      error: scannerUnavailable
        ? "Secure document intake is temporarily unavailable. The file was not accepted or extracted."
        : "The file failed secure intake and was not accepted or extracted.",
      disposition: eventDisposition,
      findings: inspection.findings.map((finding) => finding.code),
      providerIssues: providerIssues.map((issue) => ({
        kind: issue.kind,
        code: issue.code,
      })),
      storedObjectDisposition,
      quarantineRetained,
      cleanupConfirmed,
    });
}

/**
 * Promotion-failure cleanup ladder (moved verbatim out of the create
 * handler): confirm or report the disposition of any promoted copy, audit the
 * failure reason, and answer with the matching status without ever claiming
 * an unconfirmed cleanup.
 */
async function cleanupFailedPromotion({
  req,
  res,
  user,
  projectId,
  parsed,
  error,
  finalizedObjectPath,
}: {
  req: Request;
  res: Response;
  user: ReturnType<typeof getLocalUser>;
  projectId: string;
  parsed: { data: ReturnType<(typeof CreateDocumentBody)["parse"]> };
  error: unknown;
  finalizedObjectPath: string | null;
}): Promise<void> {
  const cleanupPath =
    error instanceof ObjectPromotionCleanupError
      ? error.destinationPath
      : finalizedObjectPath;
  let cleanupConfirmed = cleanupPath === null;
  let storedObjectDisposition = cleanupPath
    ? "promoted copy cleanup not yet attempted"
    : "no promoted copy was retained; original staging cleanup is pending";
  if (cleanupPath) {
    try {
      const deleted = await objectStorage.deleteObjectEntity(cleanupPath);
      cleanupConfirmed = true;
      storedObjectDisposition = deleted
        ? "promoted copy purged"
        : "promoted copy already absent";
    } catch (cleanupError) {
      req.log.error(
        { err: cleanupError, objectPath: cleanupPath },
        "could not confirm cleanup of failed document promotion",
      );
      storedObjectDisposition = "promoted copy cleanup could not be confirmed";
    }
  }

  req.log.error(
    { err: error, objectPath: parsed.data.objectPath },
    "document promotion or registration failed",
  );
  await writeAudit({
    user,
    projectId,
    eventType: "document.intake_failed",
    objectType: "project",
    objectId: projectId,
    details: JSON.stringify({
      filename: parsed.data.filename,
      reason:
        error instanceof PromotedObjectIntegrityError
          ? "promoted_object_integrity_mismatch"
          : error instanceof ObjectNotFoundError
            ? "staged_or_promoted_object_missing"
            : "promotion_or_registration_failed",
      storedObjectDisposition,
      cleanupConfirmed,
    }),
  });

  if (!cleanupConfirmed) {
    res.status(503).json({
      error:
        "The document was not registered, and cleanup of its promoted storage copy could not be confirmed. Contact an administrator before retrying.",
      storedObjectDisposition,
      cleanupConfirmed: false,
    });
    return;
  }
  if (error instanceof PromotedObjectIntegrityError) {
    res.status(422).json({
      error:
        "The promoted object failed its integrity check, so no document was registered.",
      storedObjectDisposition,
      cleanupConfirmed: true,
    });
    return;
  }
  if (error instanceof ObjectNotFoundError) {
    res.status(422).json({
      error:
        "The uploaded object disappeared during secure finalisation, so no document was registered. Upload the file again.",
      storedObjectDisposition,
      cleanupConfirmed: true,
    });
    return;
  }
  res.status(503).json({
    error:
      "Secure document finalisation failed, so no document was registered.",
    storedObjectDisposition,
    cleanupConfirmed: true,
  });
}

/**
 * Run text extraction only after the route atomically changed the persisted
 * state to "extracting". Completion/failure writes use the same state as a
 * compare-and-set token, so a stale worker cannot overwrite a later policy
 * state. The route awaits this function while its project lock is held.
 */
async function runClaimedExtraction(
  documentId: string,
  buffer: Buffer,
  contentType: string | null,
  projectId: string,
  filename: string,
  req: Request,
  signal: AbortSignal,
): Promise<void> {
  try {
    signal.throwIfAborted();
    const extraction: ExtractionResult = await extractDocumentTextFromBuffer(
      buffer,
      contentType,
      {
        projectId,
        filename,
        signal,
      },
    );
    signal.throwIfAborted();
    await db
      .update(documents)
      .set({
        contentText: extraction.text,
        extractedChars: extraction.text ? extraction.text.length : null,
        extractionStatus: extraction.status,
        extractionMethod: extraction.method,
        extractionConfidence: extraction.confidence,
        extractionNotes: extraction.notes,
      })
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.extractionStatus, "extracting"),
          ne(documents.redactionStatus, "excluded"),
        ),
      );
    signal.throwIfAborted();
  } catch (error) {
    // A disconnected request retains the project lock until the parser/model
    // attempt settles, then rolls the whole claim/result transaction back.
    // Never convert cancellation into a committed ordinary failure state.
    if (signal.aborted) signal.throwIfAborted();
    req.log.error({ err: error, documentId }, "async extraction failed");
    await db
      .update(documents)
      .set({
        extractionStatus: "failed",
        extractionMethod: "none",
        extractionNotes: `async extraction crashed: ${(error instanceof Error ? error.message : String(error)).slice(0, 200)}`,
      })
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.extractionStatus, "extracting"),
          ne(documents.redactionStatus, "excluded"),
        ),
      )
      .catch(() => {});
  }
}

router.post(
  "/documents/:id/extract",
  requirePermissionOrLegacy("evidence:approve"),
  async (req: Request, res: Response) => {
    const releaseTenantWork = holdTenantDatabaseUntilComplete(req);
    const disconnectController = new AbortController();
    const abortOnDisconnect = () => disconnectController.abort();
    res.once("close", abortOnDisconnect);
    let routeError: unknown;
    try {
      const [doc] = await db
        .select()
        .from(documents)
        .where(eq(documents.id, String(req.params.id)));
      if (!doc) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      if (doc.extractionStatus === "quarantined") {
        await writeAudit({
          user: getLocalUser(req),
          projectId: doc.projectId,
          eventType: "document.extraction_denied",
          objectType: "document",
          objectId: doc.id,
          details:
            "Manual extraction was denied because secure re-inspection placed this document in a logical quarantine; only a future explicit security-release workflow may clear it.",
        });
        res.status(409).json({
          error:
            "This document is security-quarantined. It cannot be extracted or released through ordinary redaction controls.",
          redactionStatus: doc.redactionStatus,
          extractionStatus: doc.extractionStatus,
        });
        return;
      }
      if (doc.redactionStatus === "excluded") {
        await db
          .update(documents)
          .set(stateAfterRedactionChange("excluded"))
          .where(eq(documents.id, doc.id));
        await writeAudit({
          user: getLocalUser(req),
          projectId: doc.projectId,
          eventType: "document.extraction_denied",
          objectType: "document",
          objectId: doc.id,
          details:
            "Manual extraction was denied because the document is excluded; no storage read, parser, or model OCR was invoked.",
        });
        res.status(409).json({
          error:
            "This document is excluded from processing. A reviewer must change it to included or redacted before deliberately starting extraction.",
          redactionStatus: doc.redactionStatus,
        });
        return;
      }
      if (doc.extractionStatus === "extracting") {
        await writeAudit({
          user: getLocalUser(req),
          projectId: doc.projectId,
          eventType: "document.extraction_denied",
          objectType: "document",
          objectId: doc.id,
          details:
            "A duplicate extraction request was denied because this document is already processing.",
        });
        res.status(409).json({
          error: "This document is already being extracted.",
          extractionStatus: doc.extractionStatus,
        });
        return;
      }
      let buffer: Buffer;
      try {
        disconnectController.signal.throwIfAborted();
        buffer = await downloadDocumentBuffer(doc.objectPath);
      } catch (error) {
        req.log.error(
          { err: error, objectPath: doc.objectPath },
          "re-extract: object unreadable",
        );
        await db
          .update(documents)
          .set({ extractionStatus: "failed" })
          .where(eq(documents.id, doc.id));
        res.status(404).json({ error: "Stored object could not be read" });
        return;
      }
      disconnectController.signal.throwIfAborted();
      const actualSha256 = sha256Hex(buffer);
      if (!doc.sha256 || actualSha256 !== doc.sha256) {
        const reason = doc.sha256
          ? "Stored bytes no longer match the intake manifest."
          : "This legacy document has no trusted intake hash.";
        await db
          .update(documents)
          .set({
            extractionStatus: "failed",
            extractionMethod: "none",
            extractionNotes: `${reason} Extraction was blocked before secure inspection, parsing, or model OCR.`,
          })
          .where(eq(documents.id, doc.id));
        await writeAudit({
          user: getLocalUser(req),
          projectId: doc.projectId,
          eventType: "document.extraction_integrity_denied",
          objectType: "document",
          objectId: doc.id,
          details: JSON.stringify({
            expectedSha256: doc.sha256,
            actualSha256,
            parserOrModelInvoked: false,
          }),
        });
        res.status(409).json({
          error: `${reason} Extraction was not started.`,
          expectedSha256: doc.sha256,
          actualSha256,
        });
        return;
      }
      disconnectController.signal.throwIfAborted();
      const inspection = await inspectDocumentIntake({
        tenantId: doc.organisationId ?? "legacy",
        filename: doc.filename,
        declaredMime: doc.contentType ?? "application/octet-stream",
        bytes: buffer,
        idempotencyKey: `reextract:${doc.id}:${doc.sha256}`,
      });
      disconnectController.signal.throwIfAborted();
      const providerIssues =
        process.env.NODE_ENV === "production"
          ? productionFeatureIssues("document_intake")
          : [];
      const securityFindings = inspection.findings.filter(
        (finding) =>
          finding.code !== "malware_scan_incomplete" &&
          finding.severity !== "notice",
      );
      const scannerUnavailable = inspection.findings.some(
        (finding) => finding.code === "malware_scan_incomplete",
      );
      const securityBlocked =
        securityFindings.length > 0 ||
        (!inspection.mayProcess && !scannerUnavailable);
      if (securityBlocked) {
        const notes =
          `Secure re-inspection security-blocked this source: ${securityFindings
            .map((finding) => finding.code)
            .join(", ")}`.slice(0, 500);
        await db
          .update(documents)
          .set({
            redactionStatus: "excluded",
            extractionStatus: "quarantined",
            extractionMethod: "none",
            extractionConfidence: null,
            extractionNotes: notes,
            contentText: null,
            extractedChars: null,
          })
          .where(eq(documents.id, doc.id));
        await writeAudit({
          user: getLocalUser(req),
          projectId: doc.projectId,
          eventType: "document.reinspection_security_blocked",
          objectType: "document",
          objectId: doc.id,
          details: JSON.stringify({
            findings: inspection.findings.map((finding) => finding.code),
            malwareState: inspection.malware.state,
            extractionStatus: "quarantined",
            redactionStatus: "excluded",
            storageMoved: false,
            genericObjectDownloadAllowed: false,
          }),
        });
        res.status(422).json({
          error:
            "Secure re-inspection blocked this source. It is now excluded and inaccessible through generic object downloads pending an explicit security-release workflow.",
          extractionStatus: "quarantined",
        });
        return;
      }
      if (scannerUnavailable || providerIssues.length > 0) {
        const notes = `Secure re-inspection could not complete: ${[
          ...(scannerUnavailable ? ["malware_scan_incomplete"] : []),
          ...providerIssues.map(
            (issue) => `provider_${issue.kind}_${issue.code}`,
          ),
        ].join(", ")}`.slice(0, 500);
        await db
          .update(documents)
          .set({
            extractionStatus: "failed",
            extractionMethod: "none",
            extractionConfidence: null,
            extractionNotes: notes,
          })
          .where(eq(documents.id, doc.id));
        await writeAudit({
          user: getLocalUser(req),
          projectId: doc.projectId,
          eventType: "document.reinspection_blocked",
          objectType: "document",
          objectId: doc.id,
          details: JSON.stringify({
            findings: inspection.findings.map((finding) => finding.code),
            providerIssues: providerIssues.map((issue) => ({
              kind: issue.kind,
              code: issue.code,
            })),
            malwareState: inspection.malware.state,
            storageMoved: false,
          }),
        });
        res.status(503).json({
          error:
            "Secure re-inspection is temporarily unavailable. The source was not described as quarantined and extraction was not started.",
          extractionStatus: "failed",
        });
        return;
      }
      disconnectController.signal.throwIfAborted();
      const [claimed] = await db
        .update(documents)
        .set({ extractionStatus: "extracting" })
        .where(
          and(
            eq(documents.id, doc.id),
            ne(documents.redactionStatus, "excluded"),
            or(
              isNull(documents.extractionStatus),
              ne(documents.extractionStatus, "extracting"),
            ),
          ),
        )
        .returning();
      if (!claimed) {
        const [current] = await db
          .select()
          .from(documents)
          .where(eq(documents.id, doc.id));
        await writeAudit({
          user: getLocalUser(req),
          projectId: doc.projectId,
          eventType: "document.extraction_denied",
          objectType: "document",
          objectId: doc.id,
          details:
            "Extraction lost its atomic eligibility claim; no parser or model OCR was invoked.",
        });
        res.status(409).json({
          error:
            current?.redactionStatus === "excluded"
              ? "This document became excluded before extraction could start. No parser or model OCR was invoked."
              : "This document is already being extracted.",
          redactionStatus: current?.redactionStatus,
          extractionStatus: current?.extractionStatus,
        });
        return;
      }
      await writeAudit({
        user: getLocalUser(req),
        projectId: doc.projectId,
        eventType: "document.reextract",
        objectType: "document",
        objectId: doc.id,
        details: doc.filename,
      });
      // Keep the request-long tenant transaction and project advisory lock held
      // across parser/model execution and persistence. This deliberately avoids
      // a faux background task inheriting a released AsyncLocal transaction and
      // prevents an exclusion request from interleaving after the claim but
      // before model OCR. A durable queue can replace this only with equivalent
      // tenant context, cancellation and generation semantics.
      await runClaimedExtraction(
        claimed.id,
        buffer,
        claimed.contentType,
        claimed.projectId,
        claimed.filename,
        req,
        disconnectController.signal,
      );
      const [completed] = await db
        .select()
        .from(documents)
        .where(eq(documents.id, claimed.id));
      res.status(200).json(serializeDocument(completed ?? claimed));
    } catch (error) {
      routeError = error;
      throw error;
    } finally {
      if (disconnectController.signal.aborted && !routeError) {
        routeError = disconnectController.signal.reason;
      }
      res.off("close", abortOnDisconnect);
      releaseTenantWork(routeError);
    }
  },
);

router.post(
  "/documents/:id/verify",
  requirePermissionOrLegacy("document:read"),
  async (req: Request, res: Response) => {
    const [doc] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, String(req.params.id)));
    if (!doc) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const user = getLocalUser(req);

    if (!doc.sha256) {
      res.status(409).json({
        error:
          "No intake hash is recorded for this document (uploaded before integrity manifests, or the object was unreadable at intake), so it cannot be verified.",
      });
      return;
    }

    let actualSha256: string | null = null;
    try {
      actualSha256 = sha256Hex(await downloadDocumentBuffer(doc.objectPath));
    } catch (error) {
      req.log.error(
        { err: error, objectPath: doc.objectPath },
        "verify: object unreadable",
      );
    }

    // Three distinct outcomes, three distinct immutable audit records: a
    // storage outage must never be recorded as (or read like) tampering.
    const unreadable = actualSha256 === null;
    const ok = !unreadable && actualSha256 === doc.sha256;
    await writeAudit({
      user,
      projectId: doc.projectId,
      eventType: ok
        ? "document.integrity_verified"
        : unreadable
          ? "document.integrity_unverifiable"
          : "document.integrity_failed",
      objectType: "document",
      objectId: doc.id,
      details: ok
        ? `${doc.filename}: stored object matches intake sha256.`
        : unreadable
          ? `${doc.filename}: stored object could not be read — integrity could not be verified (intake sha256=${doc.sha256}).`
          : `${doc.filename}: INTEGRITY FAILURE — intake sha256=${doc.sha256}, current=${actualSha256}.`,
    });
    res.json({
      documentId: doc.id,
      ok,
      expectedSha256: doc.sha256,
      actualSha256,
    });
  },
);

router.get(
  "/documents/:id",
  requirePermissionOrLegacy("document:read"),
  async (req: Request, res: Response) => {
    const [row] = await db
      .select({ doc: documents, uploadedByName: users.name })
      .from(documents)
      .leftJoin(users, eq(documents.uploadedBy, users.id))
      .where(eq(documents.id, String(req.params.id)));
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await writeAudit({
      user: getLocalUser(req),
      projectId: row.doc.projectId,
      eventType: "document.viewed",
      objectType: "document",
      objectId: row.doc.id,
      details: row.doc.filename,
    });
    res.json(serializeDocument(row.doc, row.uploadedByName));
  },
);

router.patch(
  "/documents/:id",
  requirePermissionOrLegacy("document:upload"),
  async (req: Request, res: Response) => {
    const parsed = UpdateDocumentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const [existing] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, String(req.params.id)));
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (
      existing.extractionStatus === "quarantined" &&
      parsed.data.redactionStatus !== undefined
    ) {
      await writeAudit({
        user: getLocalUser(req),
        projectId: existing.projectId,
        eventType: "document.redaction_change_denied",
        objectType: "document",
        objectId: existing.id,
        details:
          "Ordinary redaction controls cannot alter a logical security-quarantine state; a future explicit security-release workflow is required.",
      });
      res.status(409).json({
        error:
          "This document is security-quarantined. Its redaction cannot be changed through ordinary document controls.",
        redactionStatus: existing.redactionStatus,
        extractionStatus: existing.extractionStatus,
      });
      return;
    }
    const redactionChange = parsed.data.redactionStatus !== undefined;
    if (redactionChange && !hasRequestPermission(req, "evidence:approve")) {
      await writeAudit({
        user: getLocalUser(req),
        projectId: existing.projectId,
        eventType: "document.redaction_change_denied",
        objectType: "document",
        objectId: existing.id,
        details:
          "A non-reviewer attempted to change document redaction policy; redaction and extraction state were not changed.",
      });
      res.status(403).json({
        error: "Reviewer approval is required to change document redaction.",
      });
      return;
    }
    const extractionState = stateAfterRedactionChange(
      parsed.data.redactionStatus,
      existing.redactionStatus,
    );
    const excluding = parsed.data.redactionStatus === "excluded";
    const updatePredicate = excluding
      ? and(
          eq(documents.id, String(req.params.id)),
          or(
            isNull(documents.extractionStatus),
            ne(documents.extractionStatus, "extracting"),
          ),
        )
      : eq(documents.id, String(req.params.id));
    const [updated] = await db
      .update(documents)
      .set({ ...parsed.data, ...extractionState })
      .where(updatePredicate)
      .returning();
    if (!updated) {
      const [current] = await db
        .select()
        .from(documents)
        .where(eq(documents.id, String(req.params.id)));
      if (excluding && current?.extractionStatus === "extracting") {
        await writeAudit({
          user: getLocalUser(req),
          projectId: current.projectId,
          eventType: "document.redaction_change_denied",
          objectType: "document",
          objectId: current.id,
          details:
            "Exclusion was denied because extraction had already atomically entered processing; redaction and extraction state were not changed.",
        });
        res.status(409).json({
          error:
            "Extraction is already processing. Wait for it to finish or fail, then exclude the document. Its redaction status was not changed.",
          redactionStatus: current.redactionStatus,
          extractionStatus: current.extractionStatus,
        });
        return;
      }
      res.status(404).json({ error: "Not found" });
      return;
    }
    await writeAudit({
      user: getLocalUser(req),
      projectId: updated.projectId,
      eventType: "document.updated",
      objectType: "document",
      objectId: updated.id,
      details: JSON.stringify({
        changedFields: Object.keys(parsed.data),
        redactionFrom: existing.redactionStatus,
        redactionTo: updated.redactionStatus,
        extractionStatus: updated.extractionStatus,
        derivedContentCleared: parsed.data.redactionStatus === "excluded",
        extractionAutoStarted: false,
      }),
    });
    res.json(serializeDocument(updated));
  },
);

router.delete(
  "/documents/:id",
  requirePermissionOrLegacy("document:delete"),
  async (req: Request, res: Response) => {
    const [existing] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, String(req.params.id)));
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // A cross-project registration uses a different project lock, so row and
    // blob deletion must also hold the shared object-path lock. Otherwise a
    // create could observe the deleted row and register just before this route
    // purged the shared blob.
    await lockStagedUploadObject(existing.objectPath);
    if (existing.extractionStatus === "quarantined") {
      const otherReferences = await storagePathReferenceKinds(
        existing.objectPath,
        { excludeDocumentId: existing.id },
      );
      if (otherReferences.length > 0) {
        await writeAudit({
          user: getLocalUser(req),
          projectId: existing.projectId,
          eventType: "document.security_quarantine_delete_denied",
          objectType: "document",
          objectId: existing.id,
          details: `Logical quarantine marker retained because the blocked path is also referenced by: ${otherReferences.join(", ")}.`,
        });
        res.status(409).json({
          error:
            "This security-quarantined document cannot be deleted while another tenant artefact references its blocked storage path.",
          references: otherReferences,
        });
        return;
      }
    }
    const [deleted] = await db
      .delete(documents)
      .where(
        and(
          eq(documents.id, String(req.params.id)),
          eq(documents.objectPath, existing.objectPath),
        ),
      )
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // Keep the blob whenever any other persisted tenant artefact still owns
    // this path (vault, version, report, package or branding). The document
    // row itself is gone before this fail-closed reference inventory runs.
    const remainingReferences = await storagePathReferenceKinds(
      deleted.objectPath,
    );
    const referencedElsewhere = remainingReferences.length > 0;
    let deletionIntentId: string | null = null;
    if (!referencedElsewhere) {
      const organisationId = getOrganisationId(req);
      if (!organisationId) {
        throw new Error(
          "Active organisation is required for durable document cleanup",
        );
      }
      const intent = await enqueueStorageDeletionIntent({
        organisationId,
        projectId: deleted.projectId,
        objectPath: deleted.objectPath,
        aggregateType: "document",
        aggregateId: deleted.id,
        reason: "record_deleted",
        requestedAt: new Date(),
        actor: getLocalUser(req),
      });
      deletionIntentId = intent.id;
    }
    await writeAudit({
      user: getLocalUser(req),
      projectId: deleted.projectId,
      eventType: "document.deleted",
      objectType: "document",
      objectId: deleted.id,
      details: `${deleted.filename} (file ${
        referencedElsewhere
          ? `retained for ${remainingReferences.join(", ")}`
          : `queued for durable deletion reconciliation (${deletionIntentId})`
      })`,
    });
    res.status(204).end();
  },
);

export default router;
