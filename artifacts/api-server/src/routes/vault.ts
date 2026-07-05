import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc } from "drizzle-orm";
import { db, vaultItems, clients } from "@workspace/db";
import { CreateVaultItemBody, UpdateVaultItemBody } from "@workspace/api-zod";
import { requireMember, getLocalUser } from "../middlewares/auth";
import { serializeVaultItem } from "../lib/serializers";
import { writeAudit } from "../lib/audit";
import { computeExpiry, type ExpiryBand } from "../lib/deterministic";

const router: IRouter = Router();

/** Bands that appear on the renewal radar, in urgency order. */
const RADAR_BANDS: ExpiryBand[] = ["expired", "critical", "warning", "upcoming"];

router.get(
  "/clients/:id/vault-items",
  requireMember,
  async (req: Request, res: Response) => {
    const clientId = String(req.params.id);
    const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId));
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
      rows.map((v) => serializeVaultItem(v, computeExpiry(v.expiryDate, now, v.renewalLeadDays))),
    );
  },
);

router.post(
  "/clients/:id/vault-items",
  requireMember,
  async (req: Request, res: Response) => {
    const parsed = CreateVaultItemBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const clientId = String(req.params.id);
    const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId));
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const user = getLocalUser(req);
    const [created] = await db
      .insert(vaultItems)
      .values({ ...parsed.data, clientId })
      .returning();
    await writeAudit({
      user,
      eventType: "vault.item_created",
      objectType: "vault_item",
      objectId: created.id,
      details: `${created.artefactType}${created.expiryDate ? ` (expires ${created.expiryDate})` : ""} for client ${clientId}`,
    });
    res
      .status(201)
      .json(serializeVaultItem(created, computeExpiry(created.expiryDate, new Date(), created.renewalLeadDays)));
  },
);

router.patch("/vault-items/:id", requireMember, async (req: Request, res: Response) => {
  const parsed = UpdateVaultItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const [updated] = await db
    .update(vaultItems)
    .set({ ...parsed.data })
    .where(eq(vaultItems.id, String(req.params.id)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await writeAudit({
    user: getLocalUser(req),
    eventType: "vault.item_updated",
    objectType: "vault_item",
    objectId: updated.id,
    details: updated.artefactType,
  });
  res.json(serializeVaultItem(updated, computeExpiry(updated.expiryDate, new Date(), updated.renewalLeadDays)));
});

router.delete("/vault-items/:id", requireMember, async (req: Request, res: Response) => {
  const [deleted] = await db
    .delete(vaultItems)
    .where(eq(vaultItems.id, String(req.params.id)))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await writeAudit({
    user: getLocalUser(req),
    eventType: "vault.item_deleted",
    objectType: "vault_item",
    objectId: deleted.id,
    details: `${deleted.artefactType} (client ${deleted.clientId})`,
  });
  res.status(204).end();
});

router.get("/vault/expiring", requireMember, async (_req: Request, res: Response) => {
  const rows = await db
    .select({ item: vaultItems, clientName: clients.name })
    .from(vaultItems)
    .leftJoin(clients, eq(vaultItems.clientId, clients.id));

  const now = new Date();
  const buckets: Record<"expired" | "critical" | "warning" | "upcoming", number> = {
    expired: 0,
    critical: 0,
    warning: 0,
    upcoming: 0,
  };
  const radar: ReturnType<typeof serializeVaultItem>[] = [];
  for (const { item, clientName } of rows) {
    const telemetry = computeExpiry(item.expiryDate, now, item.renewalLeadDays);
    if (!RADAR_BANDS.includes(telemetry.band)) continue;
    buckets[telemetry.band as keyof typeof buckets] += 1;
    radar.push(serializeVaultItem(item, telemetry, clientName));
  }
  // Most urgent first: unknown-day items can't occur here (radar bands all
  // have a parseable date), so sort purely by days remaining.
  radar.sort((a, b) => (a.daysToExpiry ?? 0) - (b.daysToExpiry ?? 0));

  res.json({ buckets, items: radar });
});

export default router;
