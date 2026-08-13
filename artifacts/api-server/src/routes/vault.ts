import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, desc, sql } from "drizzle-orm";
import { db, vaultItems, clients, documents, projects } from "@workspace/db";
import { CreateVaultItemBody, UpdateVaultItemBody } from "@workspace/api-zod";
import { getLocalUser } from "../middlewares/auth";
import {
  getOrganisationId,
  requirePermissionOrLegacy,
} from "../middlewares/tenancy";
import { serializeVaultItem } from "../lib/serializers";
import { writeAudit } from "../lib/audit";
import { computeExpiry, type ExpiryBand } from "../lib/deterministic";
import { lockStagedUploadObject } from "../lib/stagedUploadLock";
import { enqueueStorageDeletionIntent } from "../lib/storageLifecycle/repository";

const router: IRouter = Router();

/** Bands that appear on the renewal radar, in urgency order. */
const RADAR_BANDS: ExpiryBand[] = [
  "expired",
  "critical",
  "warning",
  "upcoming",
];

async function clientDocument(clientId: string, documentId: string) {
  const [row] = await db
    .select({ doc: documents })
    .from(documents)
    .innerJoin(projects, eq(documents.projectId, projects.id))
    .where(eq(documents.id, documentId));
  if (!row) return null;
  const [project] = await db
    .select({ clientId: projects.clientId })
    .from(projects)
    .where(eq(projects.id, row.doc.projectId));
  return project?.clientId === clientId ? row.doc : null;
}

async function findDuplicateVaultHash(
  clientId: string,
  sha256: string,
  excludeId?: string,
) {
  const rows = await db
    .select()
    .from(vaultItems)
    .where(eq(vaultItems.clientId, clientId));
  return rows.find((v) => v.id !== excludeId && v.sha256 === sha256) ?? null;
}

async function lockObjectPaths(paths: Array<string | null | undefined>) {
  const uniquePaths = [
    ...new Set(paths.filter((path): path is string => !!path)),
  ].sort();
  for (const path of uniquePaths) await lockStagedUploadObject(path);
}

router.get(
  "/clients/:id/vault-items",
  requirePermissionOrLegacy("evidence:read"),
  async (req: Request, res: Response) => {
    const clientId = String(req.params.id);
    const [client] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.id, clientId));
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const rows = await db
      .select()
      .from(vaultItems)
      .where(eq(vaultItems.clientId, clientId))
      .orderBy(desc(vaultItems.createdAt));
    const now = new Date();
    res.json(
      rows.map((v) =>
        serializeVaultItem(
          v,
          computeExpiry(v.expiryDate, now, v.renewalLeadDays),
        ),
      ),
    );
  },
);

router.post(
  "/clients/:id/vault-items",
  requirePermissionOrLegacy("evidence:write"),
  async (req: Request, res: Response) => {
    const parsed = CreateVaultItemBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const clientId = String(req.params.id);
    const [client] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.id, clientId));
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const user = getLocalUser(req);
    let sourceDoc: typeof documents.$inferSelect | null = null;
    if (parsed.data.sourceDocumentId) {
      const candidate = await clientDocument(
        clientId,
        parsed.data.sourceDocumentId,
      );
      if (!candidate) {
        res
          .status(400)
          .json({ error: "sourceDocumentId does not belong to this client" });
        return;
      }
      // Resolve the path once so it can be locked, then re-read the source
      // document under that lock. Document deletion takes this same lock.
      await lockObjectPaths([candidate.objectPath]);
      sourceDoc = await clientDocument(clientId, parsed.data.sourceDocumentId);
      if (!sourceDoc || sourceDoc.objectPath !== candidate.objectPath) {
        res.status(409).json({
          error:
            "The source document changed while the vault item was being created. Try again.",
        });
        return;
      }
      if (sourceDoc.extractionStatus === "quarantined") {
        await writeAudit({
          user,
          organisationId: getOrganisationId(req),
          eventType: "vault.source_link_denied",
          objectType: "document",
          objectId: sourceDoc.id,
          details:
            "Vault linkage denied because secure re-inspection logically quarantined the source document.",
        });
        res.status(409).json({
          error:
            "A security-quarantined document cannot be linked into the Certificate Vault.",
        });
        return;
      }
    }
    const duplicate = sourceDoc?.sha256
      ? await findDuplicateVaultHash(clientId, sourceDoc.sha256)
      : null;
    const [created] = await db
      .insert(vaultItems)
      .values({
        ...parsed.data,
        organisationId: getOrganisationId(req),
        clientId,
        objectPath: sourceDoc?.objectPath ?? null,
        sha256: sourceDoc?.sha256 ?? null,
      })
      .returning();
    await writeAudit({
      user,
      organisationId: getOrganisationId(req),
      eventType: "vault.item_created",
      objectType: "vault_item",
      objectId: created.id,
      details: `${created.artefactType}${created.expiryDate ? ` (expires ${created.expiryDate})` : ""} for client ${clientId}${
        duplicate ? ` | duplicate sha256 of vault item ${duplicate.id}` : ""
      }`,
    });
    res
      .status(201)
      .json(
        serializeVaultItem(
          created,
          computeExpiry(
            created.expiryDate,
            new Date(),
            created.renewalLeadDays,
          ),
        ),
      );
  },
);

router.patch(
  "/vault-items/:id",
  requirePermissionOrLegacy("evidence:write"),
  async (req: Request, res: Response) => {
    const parsed = UpdateVaultItemBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    if (Object.keys(parsed.data).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    const [existing] = await db
      .select()
      .from(vaultItems)
      .where(eq(vaultItems.id, String(req.params.id)));
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    let sourceDocCandidate: typeof documents.$inferSelect | null = null;
    if (parsed.data.sourceDocumentId) {
      sourceDocCandidate = await clientDocument(
        existing.clientId,
        parsed.data.sourceDocumentId,
      );
      if (!sourceDocCandidate) {
        res
          .status(400)
          .json({ error: "sourceDocumentId does not belong to this client" });
        return;
      }
    }
    await lockObjectPaths([
      existing.objectPath,
      sourceDocCandidate?.objectPath,
    ]);
    const [lockedExisting] = await db
      .select()
      .from(vaultItems)
      .where(eq(vaultItems.id, String(req.params.id)));
    if (
      !lockedExisting ||
      lockedExisting.version !== existing.version ||
      lockedExisting.objectPath !== existing.objectPath
    ) {
      res.status(409).json({
        error: "The vault item changed while it was being updated. Try again.",
      });
      return;
    }
    let sourceDoc: typeof documents.$inferSelect | null = null;
    if (parsed.data.sourceDocumentId) {
      sourceDoc = await clientDocument(
        lockedExisting.clientId,
        parsed.data.sourceDocumentId,
      );
      if (
        !sourceDoc ||
        sourceDoc.objectPath !== sourceDocCandidate?.objectPath
      ) {
        res.status(409).json({
          error:
            "The source document changed while the vault item was being updated. Try again.",
        });
        return;
      }
      if (sourceDoc.extractionStatus === "quarantined") {
        await writeAudit({
          user: getLocalUser(req),
          organisationId: getOrganisationId(req),
          eventType: "vault.source_link_denied",
          objectType: "document",
          objectId: sourceDoc.id,
          details:
            "Vault source replacement denied because secure re-inspection logically quarantined the source document.",
        });
        res.status(409).json({
          error:
            "A security-quarantined document cannot be linked into the Certificate Vault.",
        });
        return;
      }
    }
    const duplicate = sourceDoc?.sha256
      ? await findDuplicateVaultHash(
          lockedExisting.clientId,
          sourceDoc.sha256,
          lockedExisting.id,
        )
      : null;
    // Unlinking the source document must also drop the copied file pointers,
    // otherwise the row keeps a stale objectPath/sha256 with no provenance.
    const documentPatch = sourceDoc
      ? { objectPath: sourceDoc.objectPath, sha256: sourceDoc.sha256 }
      : parsed.data.sourceDocumentId === null
        ? { objectPath: null, sha256: null }
        : {};
    const [updated] = await db
      .update(vaultItems)
      .set({
        ...parsed.data,
        ...documentPatch,
        version: sql`${vaultItems.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(vaultItems.id, String(req.params.id)),
          eq(vaultItems.version, lockedExisting.version),
        ),
      )
      .returning();
    if (!updated) {
      res.status(409).json({
        error: "The vault item changed while it was being updated. Try again.",
      });
      return;
    }
    let previousObjectDisposition = "unchanged";
    if (
      lockedExisting.objectPath &&
      lockedExisting.objectPath !== updated.objectPath
    ) {
      const organisationId = getOrganisationId(req);
      if (!organisationId) {
        throw new Error(
          "Active organisation is required for durable vault cleanup",
        );
      }
      const intent = await enqueueStorageDeletionIntent({
        organisationId,
        // Vault artefacts are client-owned and may serve several pursuits.
        // Keep their deletion queue independent of any one project cascade.
        projectId: null,
        objectPath: lockedExisting.objectPath,
        aggregateType: "vault_item",
        aggregateId: lockedExisting.id,
        reason: "reference_replaced",
        requestedAt: new Date(),
        actor: getLocalUser(req),
      });
      previousObjectDisposition = `queued for durable deletion reconciliation (${intent.id})`;
    }
    await writeAudit({
      user: getLocalUser(req),
      organisationId: getOrganisationId(req),
      eventType: "vault.item_updated",
      objectType: "vault_item",
      objectId: updated.id,
      details: `${updated.artefactType}${duplicate ? ` | duplicate sha256 of vault item ${duplicate.id}` : ""} | previous object ${previousObjectDisposition}`,
    });
    res.json(
      serializeVaultItem(
        updated,
        computeExpiry(updated.expiryDate, new Date(), updated.renewalLeadDays),
      ),
    );
  },
);

router.delete(
  "/vault-items/:id",
  requirePermissionOrLegacy("evidence:write"),
  async (req: Request, res: Response) => {
    const [existing] = await db
      .select()
      .from(vaultItems)
      .where(eq(vaultItems.id, String(req.params.id)));
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await lockObjectPaths([existing.objectPath]);
    const [deleted] = await db
      .delete(vaultItems)
      .where(
        and(
          eq(vaultItems.id, String(req.params.id)),
          eq(vaultItems.version, existing.version),
        ),
      )
      .returning();
    if (!deleted) {
      res.status(409).json({
        error: "The vault item changed while it was being deleted. Try again.",
      });
      return;
    }
    const objectDisposition = deleted.objectPath
      ? "queued for durable storage reconciliation"
      : "no linked object";
    if (deleted.objectPath) {
      const organisationId = getOrganisationId(req);
      if (!organisationId) {
        throw new Error(
          "Active organisation is required for durable vault cleanup",
        );
      }
      await enqueueStorageDeletionIntent({
        organisationId,
        projectId: null,
        objectPath: deleted.objectPath,
        aggregateType: "vault_item",
        aggregateId: deleted.id,
        reason: "record_deleted",
        requestedAt: new Date(),
        actor: getLocalUser(req),
      });
    }
    await writeAudit({
      user: getLocalUser(req),
      organisationId: getOrganisationId(req),
      eventType: "vault.item_deleted",
      objectType: "vault_item",
      objectId: deleted.id,
      details: `${deleted.artefactType} (client ${deleted.clientId}) | object ${objectDisposition}`,
    });
    res.status(204).end();
  },
);

router.get(
  "/vault/expiring",
  requirePermissionOrLegacy("evidence:read"),
  async (req: Request, res: Response) => {
    const rows = await db
      .select({ item: vaultItems, clientName: clients.name })
      .from(vaultItems)
      .leftJoin(clients, eq(vaultItems.clientId, clients.id))
      .where(
        getOrganisationId(req)
          ? eq(vaultItems.organisationId, getOrganisationId(req)!)
          : undefined,
      );

    const now = new Date();
    const buckets: Record<
      "expired" | "critical" | "warning" | "upcoming",
      number
    > = {
      expired: 0,
      critical: 0,
      warning: 0,
      upcoming: 0,
    };
    const radar: ReturnType<typeof serializeVaultItem>[] = [];
    for (const { item, clientName } of rows) {
      const telemetry = computeExpiry(
        item.expiryDate,
        now,
        item.renewalLeadDays,
      );
      if (!RADAR_BANDS.includes(telemetry.band)) continue;
      buckets[telemetry.band as keyof typeof buckets] += 1;
      radar.push(serializeVaultItem(item, telemetry, clientName));
    }
    // Most urgent first: unknown-day items can't occur here (radar bands all
    // have a parseable date), so sort purely by days remaining.
    radar.sort((a, b) => (a.daysToExpiry ?? 0) - (b.daysToExpiry ?? 0));

    res.json({ buckets, items: radar });
  },
);

export default router;
