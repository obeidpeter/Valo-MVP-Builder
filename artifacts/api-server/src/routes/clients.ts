import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, sql, desc } from "drizzle-orm";
import { db, clients, projects } from "@workspace/db";
import { CreateClientBody, UpdateClientBody } from "@workspace/api-zod";
import { getLocalUser } from "../middlewares/auth";
import {
  getOrganisationId,
  requirePermissionOrLegacy,
} from "../middlewares/tenancy";
import { serializeClient } from "../lib/serializers";
import { writeAudit } from "../lib/audit";

const router: IRouter = Router();

router.get(
  "/clients",
  requirePermissionOrLegacy("client:read"),
  async (req: Request, res: Response) => {
    const organisationId = getOrganisationId(req);
    const rows = await db
      .select({
        client: clients,
        projectCount: sql<number>`count(${projects.id})::int`,
      })
      .from(clients)
      .leftJoin(projects, eq(projects.clientId, clients.id))
      .where(
        organisationId ? eq(clients.organisationId, organisationId) : undefined,
      )
      .groupBy(clients.id)
      .orderBy(desc(clients.createdAt));
    res.json(
      rows.map((r) => serializeClient(r.client, Number(r.projectCount))),
    );
  },
);

router.post(
  "/clients",
  requirePermissionOrLegacy("client:create"),
  async (req: Request, res: Response) => {
    const parsed = CreateClientBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const organisationId = getOrganisationId(req);
    const [created] = await db
      .insert(clients)
      .values({ ...parsed.data, organisationId })
      .returning();
    await writeAudit({
      user: getLocalUser(req),
      organisationId,
      eventType: "client.created",
      objectType: "client",
      objectId: created.id,
      details: created.name,
    });
    res.status(201).json(serializeClient(created, 0));
  },
);

router.get(
  "/clients/:id",
  requirePermissionOrLegacy("client:read"),
  async (req: Request, res: Response) => {
    const organisationId = getOrganisationId(req);
    const [row] = await db
      .select()
      .from(clients)
      .where(
        and(
          eq(clients.id, String(req.params.id)),
          organisationId
            ? eq(clients.organisationId, organisationId)
            : undefined,
        ),
      );
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(projects)
      .where(eq(projects.clientId, row.id));
    res.json(serializeClient(row, Number(count)));
  },
);

router.patch(
  "/clients/:id",
  requirePermissionOrLegacy("client:update"),
  async (req: Request, res: Response) => {
    const parsed = UpdateClientBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const organisationId = getOrganisationId(req);
    const [updated] = await db
      .update(clients)
      .set({
        ...parsed.data,
        version: sql`${clients.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(clients.id, String(req.params.id)),
          organisationId
            ? eq(clients.organisationId, organisationId)
            : undefined,
        ),
      )
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await writeAudit({
      user: getLocalUser(req),
      organisationId,
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
  },
);

export default router;
