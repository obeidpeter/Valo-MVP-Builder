import { createHash } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc } from "drizzle-orm";
import { db, documents, users, projects, clients } from "@workspace/db";
import { CreateDocumentBody, UpdateDocumentBody } from "@workspace/api-zod";
import { requireMember, requireRoles, getLocalUser } from "../middlewares/auth";
import { serializeDocument } from "../lib/serializers";
import { writeAudit } from "../lib/audit";
import {
  downloadDocumentBuffer,
  extractDocumentTextFromBuffer,
  type ExtractionResult,
} from "../lib/extractText";
import { ObjectStorageService } from "../lib/objectStorage";

const sha256Hex = (buf: Buffer): string =>
  createHash("sha256").update(buf).digest("hex");

const NDA_ALLOWED = new Set(["signed", "not_required"]);

/** Look up the client NDA status backing a project (null = project missing). */
async function projectNdaStatus(
  projectId: string,
): Promise<{ ndaStatus: string | null } | null> {
  const [row] = await db
    .select({ ndaStatus: clients.ndaStatus })
    .from(projects)
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .where(eq(projects.id, projectId));
  return row ?? null;
}

const objectStorage = new ObjectStorageService();

const router: IRouter = Router();

router.get(
  "/projects/:id/documents",
  requireMember,
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
  requireMember,
  async (req: Request, res: Response) => {
    const parsed = CreateDocumentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    const projectId = String(req.params.id);
    const user = getLocalUser(req);

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

    // Download the stored object once: hash it for the intake manifest
    // (FR-INT-02) and extract text from the same bytes, so the hash is
    // guaranteed to describe exactly what extraction saw. Fail closed: a
    // document that cannot be read (and therefore cannot be hashed) must not
    // enter the corpus as a success with no integrity baseline.
    let buffer: Buffer;
    try {
      buffer = await downloadDocumentBuffer(parsed.data.objectPath);
    } catch (error) {
      req.log.warn(
        { err: error, objectPath: parsed.data.objectPath },
        "could not read uploaded object for hashing/extraction",
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
    const sha256 = sha256Hex(buffer);

    // Re-check the NDA gate after the (slow) download so a mid-flight NDA
    // revocation cannot slip a document in behind the earlier check.
    const regate = await projectNdaStatus(projectId);
    if (!regate || !regate.ndaStatus || !NDA_ALLOWED.has(regate.ndaStatus)) {
      await denyNda(regate?.ndaStatus ?? null);
      return;
    }

    const [created] = await db
      .insert(documents)
      .values({
        ...parsed.data,
        projectId,
        uploadedBy: user?.id ?? null,
        sha256,
        // Record the measured size of the bytes we hashed, not the client's
        // claim — the manifest must be internally consistent.
        size: buffer.length,
        extractionStatus: "pending",
      })
      .returning();

    // Intake manifest: filename, SHA-256, measured size, received-at all live
    // in the audit chain so the record is tamper-evident from intake onward.
    // (Hashing is synchronous and fail-closed above; only the slow text
    // extraction is deferred so a large scanned PDF cannot time out intake.)
    await writeAudit({
      user,
      projectId,
      eventType: "document.created",
      objectType: "document",
      objectId: created.id,
      details: `${created.type}: ${created.filename} | sha256=${sha256} | size=${buffer.length}B`,
    });

    // Kick off text extraction OFF the request path. The row is already
    // persisted with extractionStatus "pending"; the UI polls until it flips.
    void runExtraction(created.id, buffer, created.contentType, created.projectId, created.filename, req);

    res.status(201).json(serializeDocument(created, user?.name));
  },
);

/**
 * Run (or re-run) text extraction for a stored document and persist the
 * result. Fire-and-forget: never rejects, so a slow or failing extraction can
 * never crash the request that scheduled it. Marks the row "extracting" while
 * in flight so the UI can show progress.
 */
async function runExtraction(
  documentId: string,
  buffer: Buffer,
  contentType: string | null,
  projectId: string,
  filename: string,
  req: Request,
): Promise<void> {
  try {
    await db
      .update(documents)
      .set({ extractionStatus: "extracting" })
      .where(eq(documents.id, documentId));
    const extraction: ExtractionResult = await extractDocumentTextFromBuffer(buffer, contentType, {
      projectId,
      filename,
    });
    await db
      .update(documents)
      .set({
        contentText: extraction.text,
        extractedChars: extraction.text ? extraction.text.length : null,
        extractionStatus: extraction.status,
      })
      .where(eq(documents.id, documentId));
  } catch (error) {
    req.log.error({ err: error, documentId }, "async extraction failed");
    await db
      .update(documents)
      .set({ extractionStatus: "failed" })
      .where(eq(documents.id, documentId))
      .catch(() => {});
  }
}

router.post("/documents/:id/extract", requireMember, async (req: Request, res: Response) => {
  const [doc] = await db.select().from(documents).where(eq(documents.id, String(req.params.id)));
  if (!doc) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  let buffer: Buffer;
  try {
    buffer = await downloadDocumentBuffer(doc.objectPath);
  } catch (error) {
    req.log.error({ err: error, objectPath: doc.objectPath }, "re-extract: object unreadable");
    await db.update(documents).set({ extractionStatus: "failed" }).where(eq(documents.id, doc.id));
    res.status(404).json({ error: "Stored object could not be read" });
    return;
  }
  await db.update(documents).set({ extractionStatus: "pending" }).where(eq(documents.id, doc.id));
  await writeAudit({
    user: getLocalUser(req),
    projectId: doc.projectId,
    eventType: "document.reextract",
    objectType: "document",
    objectId: doc.id,
    details: doc.filename,
  });
  void runExtraction(doc.id, buffer, doc.contentType, doc.projectId, doc.filename, req);
  res.status(202).json(serializeDocument({ ...doc, extractionStatus: "pending" }));
});

router.post(
  "/documents/:id/verify",
  requireMember,
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
      req.log.error({ err: error, objectPath: doc.objectPath }, "verify: object unreadable");
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

router.get("/documents/:id", requireMember, async (req: Request, res: Response) => {
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
});

router.patch("/documents/:id", requireMember, async (req: Request, res: Response) => {
  const parsed = UpdateDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const [updated] = await db
    .update(documents)
    .set({ ...parsed.data })
    .where(eq(documents.id, String(req.params.id)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await writeAudit({
    user: getLocalUser(req),
    projectId: updated.projectId,
    eventType: "document.updated",
    objectType: "document",
    objectId: updated.id,
  });
  res.json(serializeDocument(updated));
});

router.delete(
  "/documents/:id",
  requireRoles("admin"),
  async (req: Request, res: Response) => {
    const [deleted] = await db
      .delete(documents)
      .where(eq(documents.id, String(req.params.id)))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    let blobDeleted = false;
    try {
      blobDeleted = await objectStorage.deleteObjectEntity(deleted.objectPath);
    } catch (error) {
      req.log.error({ err: error, objectPath: deleted.objectPath }, "failed to delete document blob");
    }
    await writeAudit({
      user: getLocalUser(req),
      projectId: deleted.projectId,
      eventType: "document.deleted",
      objectType: "document",
      objectId: deleted.id,
      details: `${deleted.filename} (file ${blobDeleted ? "purged" : "not found"} in storage)`,
    });
    res.status(204).end();
  },
);

export default router;
