import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, sql } from "drizzle-orm";
import {
  db,
  capabilityItems,
  clients,
  documents,
  projects,
} from "@workspace/db";
import {
  CreateCapabilityItemBody,
  UpdateCapabilityItemBody,
} from "@workspace/api-zod";
import { getLocalUser } from "../middlewares/auth";
import {
  getOrganisationId,
  hasRequestPermission,
  requirePermissionOrLegacy,
} from "../middlewares/tenancy";
import { serializeCapabilityItem } from "../lib/serializers";
import { writeAudit, writeAuditTx } from "../lib/audit";
import { capabilityMutationRequiresApproval } from "../lib/reviewIntegrityPolicy";

const router: IRouter = Router();

async function clientExists(clientId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, clientId));
  return !!row;
}

/**
 * Documents reachable from a client (across all of the client's projects) —
 * the pool a capability claim may cite as evidence. A claim can never point
 * at another client's material.
 */
async function clientDocumentIds(clientId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .innerJoin(projects, eq(documents.projectId, projects.id))
    .where(eq(projects.clientId, clientId));
  return new Set(rows.map((r) => r.id));
}

router.get(
  "/clients/:id/documents",
  requirePermissionOrLegacy("document:read"),
  async (req: Request, res: Response) => {
    const clientId = String(req.params.id);
    if (!(await clientExists(clientId))) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const rows = await db
      .select({
        id: documents.id,
        projectId: documents.projectId,
        filename: documents.filename,
        type: documents.type,
      })
      .from(documents)
      .innerJoin(projects, eq(documents.projectId, projects.id))
      .where(eq(projects.clientId, clientId))
      .orderBy(desc(documents.createdAt));
    res.json(rows);
  },
);

router.get(
  "/clients/:id/capability-items",
  requirePermissionOrLegacy("evidence:read"),
  async (req: Request, res: Response) => {
    const clientId = String(req.params.id);
    if (!(await clientExists(clientId))) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const rows = await db
      .select({ item: capabilityItems, evidenceDocName: documents.filename })
      .from(capabilityItems)
      .leftJoin(documents, eq(capabilityItems.evidenceDocId, documents.id))
      .where(eq(capabilityItems.clientId, clientId))
      .orderBy(desc(capabilityItems.createdAt));
    res.json(
      rows.map((r) => serializeCapabilityItem(r.item, r.evidenceDocName)),
    );
  },
);

router.post(
  "/clients/:id/capability-items",
  requirePermissionOrLegacy("evidence:write"),
  async (req: Request, res: Response) => {
    const parsed = CreateCapabilityItemBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const clientId = String(req.params.id);
    if (!(await clientExists(clientId))) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    // Evidence links may only cite this client's own documents.
    if (parsed.data.evidenceDocId) {
      const ownDocs = await clientDocumentIds(clientId);
      if (!ownDocs.has(parsed.data.evidenceDocId)) {
        res
          .status(400)
          .json({ error: "evidenceDocId does not belong to this client" });
        return;
      }
    }
    const user = getLocalUser(req);
    const [created] = await db
      .insert(capabilityItems)
      .values({
        ...parsed.data,
        organisationId: getOrganisationId(req),
        clientId,
      })
      .returning();
    await writeAudit({
      user,
      organisationId: getOrganisationId(req),
      eventType: "capability.item_created",
      objectType: "capability_item",
      objectId: created.id,
      details: `${created.claimType} claim for client ${clientId}${created.evidenceDocId ? " (evidence-linked)" : " (NO evidence link)"}`,
    });
    res.status(201).json(serializeCapabilityItem(created));
  },
);

router.patch(
  "/capability-items/:id",
  requirePermissionOrLegacy("evidence:write"),
  async (req: Request, res: Response) => {
    const parsed = UpdateCapabilityItemBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const [existing] = await db
      .select()
      .from(capabilityItems)
      .where(eq(capabilityItems.id, String(req.params.id)));
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (parsed.data.evidenceDocId) {
      const ownDocs = await clientDocumentIds(existing.clientId);
      if (!ownDocs.has(parsed.data.evidenceDocId)) {
        res
          .status(400)
          .json({ error: "evidenceDocId does not belong to this client" });
        return;
      }
    }
    const user = getLocalUser(req);
    const canApprove = hasRequestPermission(req, "evidence:approve");
    const result = await db.transaction(
      async (tx) => {
        const [locked] = await tx
          .select()
          .from(capabilityItems)
          .where(eq(capabilityItems.id, existing.id))
          .for("update");
        if (!locked) return { kind: "not_found" } as const;
        if (
          capabilityMutationRequiresApproval(
            locked.approvedStatus,
            parsed.data.approvedStatus,
          ) &&
          !canApprove
        ) {
          return { kind: "denied" } as const;
        }

        // Approval doctrine: a claim cannot be approved without an evidence
        // link — approving an unevidenced claim would legitimise fabrication.
        const nextEvidence =
          parsed.data.evidenceDocId !== undefined
            ? parsed.data.evidenceDocId
            : locked.evidenceDocId;
        const nextStatus =
          parsed.data.approvedStatus !== undefined
            ? parsed.data.approvedStatus
            : locked.approvedStatus;
        if (nextStatus === "approved" && !nextEvidence)
          return { kind: "evidence_required" } as const;

        const verificationPatch =
          parsed.data.approvedStatus === "approved" &&
          locked.approvedStatus !== "approved"
            ? {
                verifierId: user?.id ?? null,
                verifierName: user?.name ?? user?.email ?? null,
                verifiedAt: new Date(),
              }
            : parsed.data.approvedStatus &&
                parsed.data.approvedStatus !== "approved"
              ? { verifierId: null, verifierName: null, verifiedAt: null }
              : {};
        const [updated] = await tx
          .update(capabilityItems)
          .set({
            ...parsed.data,
            ...verificationPatch,
            version: sql`${capabilityItems.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(capabilityItems.id, locked.id))
          .returning();
        await writeAuditTx(tx, {
          user,
          organisationId: getOrganisationId(req),
          eventType:
            parsed.data.approvedStatus &&
            parsed.data.approvedStatus !== locked.approvedStatus
              ? `capability.item_${parsed.data.approvedStatus}`
              : "capability.item_updated",
          objectType: "capability_item",
          objectId: updated.id,
          details: updated.claimType,
        });
        return { kind: "updated", updated } as const;
      },
      { isolationLevel: "read committed" },
    );
    if (result.kind === "not_found") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (result.kind === "denied") {
      res.status(403).json({ error: "Evidence approval permission required" });
      return;
    }
    if (result.kind === "evidence_required") {
      res.status(409).json({
        error:
          "A capability claim cannot be approved without an evidence link. Attach evidence first.",
      });
      return;
    }
    const updated = result.updated;
    const evidenceDocName = updated.evidenceDocId
      ? ((
          await db
            .select({ f: documents.filename })
            .from(documents)
            .where(eq(documents.id, updated.evidenceDocId))
        )[0]?.f ?? null)
      : null;
    res.json(serializeCapabilityItem(updated, evidenceDocName));
  },
);

router.delete(
  "/capability-items/:id",
  requirePermissionOrLegacy("evidence:write"),
  async (req: Request, res: Response) => {
    const canApprove = hasRequestPermission(req, "evidence:approve");
    const result = await db.transaction(
      async (tx) => {
        const [existing] = await tx
          .select()
          .from(capabilityItems)
          .where(eq(capabilityItems.id, String(req.params.id)))
          .for("update");
        if (!existing) return { kind: "not_found" } as const;
        if (
          capabilityMutationRequiresApproval(existing.approvedStatus) &&
          !canApprove
        ) {
          return { kind: "denied" } as const;
        }
        const [deleted] = await tx
          .delete(capabilityItems)
          .where(eq(capabilityItems.id, existing.id))
          .returning();
        await writeAuditTx(tx, {
          user: getLocalUser(req),
          organisationId: getOrganisationId(req),
          eventType: "capability.item_deleted",
          objectType: "capability_item",
          objectId: deleted.id,
          details: `${deleted.claimType} (client ${deleted.clientId})`,
        });
        return { kind: "deleted" } as const;
      },
      { isolationLevel: "read committed" },
    );
    if (result.kind === "not_found") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (result.kind === "denied") {
      res.status(403).json({ error: "Evidence approval permission required" });
      return;
    }
    res.status(204).end();
  },
);

export default router;
