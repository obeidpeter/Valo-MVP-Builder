import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc } from "drizzle-orm";
import { db, documents, users, projects, clients } from "@workspace/db";
import { CreateDocumentBody, UpdateDocumentBody } from "@workspace/api-zod";
import { requireMember, requireRoles, getLocalUser } from "../middlewares/auth";
import { serializeDocument } from "../lib/serializers";
import { writeAudit } from "../lib/audit";
import { extractDocumentText } from "../lib/extractText";
import { ObjectStorageService } from "../lib/objectStorage";

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

    // NDA gate: documents cannot be uploaded until the client's NDA position
    // is recorded (signed or explicitly not required). Pending/declined blocks.
    const [gate] = await db
      .select({ ndaStatus: clients.ndaStatus })
      .from(projects)
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .where(eq(projects.id, String(req.params.id)));
    if (!gate) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const NDA_ALLOWED = new Set(["signed", "not_required"]);
    if (!gate.ndaStatus || !NDA_ALLOWED.has(gate.ndaStatus)) {
      res.status(403).json({
        error:
          "NDA not cleared for this client. Record the NDA as signed or not required before uploading documents.",
        ndaStatus: gate.ndaStatus ?? "unknown",
      });
      return;
    }

    const user = getLocalUser(req);
    const [created] = await db
      .insert(documents)
      .values({
        ...parsed.data,
        projectId: String(req.params.id),
        uploadedBy: user?.id ?? null,
        extractionStatus: "pending",
      })
      .returning();

    // Best-effort text extraction from the stored object.
    const extraction = await extractDocumentText(created.objectPath, created.contentType, {
      projectId: created.projectId,
      filename: created.filename,
    });
    const [updated] = await db
      .update(documents)
      .set({
        contentText: extraction.text,
        extractedChars: extraction.text ? extraction.text.length : null,
        extractionStatus: extraction.status,
      })
      .where(eq(documents.id, created.id))
      .returning();

    await writeAudit({
      user,
      projectId: String(req.params.id),
      eventType: "document.created",
      objectType: "document",
      objectId: created.id,
      details: `${created.type}: ${created.filename}`,
    });
    res.status(201).json(serializeDocument(updated, user?.name));
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
