import { Router, type IRouter, type Request, type Response } from "express";
import { eq, sql, desc } from "drizzle-orm";
import { db, clients, projects } from "@workspace/db";
import { CreateClientBody, UpdateClientBody } from "@workspace/api-zod";
import { requireMember, getLocalUser } from "../middlewares/auth";
import { serializeClient } from "../lib/serializers";
import { writeAudit } from "../lib/audit";

const router: IRouter = Router();

router.get("/clients", requireMember, async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      client: clients,
      projectCount: sql<number>`count(${projects.id})::int`,
    })
    .from(clients)
    .leftJoin(projects, eq(projects.clientId, clients.id))
    .groupBy(clients.id)
    .orderBy(desc(clients.createdAt));
  res.json(rows.map((r) => serializeClient(r.client, Number(r.projectCount))));
});

router.post("/clients", requireMember, async (req: Request, res: Response) => {
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const [created] = await db.insert(clients).values({ ...parsed.data }).returning();
  await writeAudit({
    user: getLocalUser(req),
    eventType: "client.created",
    objectType: "client",
    objectId: created.id,
    details: created.name,
  });
  res.status(201).json(serializeClient(created, 0));
});

router.get("/clients/:id", requireMember, async (req: Request, res: Response) => {
  const [row] = await db.select().from(clients).where(eq(clients.id, String(req.params.id)));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(eq(projects.clientId, row.id));
  res.json(serializeClient(row, Number(count)));
});

router.patch("/clients/:id", requireMember, async (req: Request, res: Response) => {
  const parsed = UpdateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const [updated] = await db
    .update(clients)
    .set({ ...parsed.data })
    .where(eq(clients.id, String(req.params.id)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await writeAudit({
    user: getLocalUser(req),
    eventType: "client.updated",
    objectType: "client",
    objectId: updated.id,
  });
  // Recompute projectCount so the response doesn't clobber cached list/detail
  // views with a null count.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(eq(projects.clientId, updated.id));
  res.json(serializeClient(updated, Number(count)));
});

export default router;
