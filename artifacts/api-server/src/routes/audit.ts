import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc } from "drizzle-orm";
import { db, auditEvents } from "@workspace/db";
import { requireMember } from "../middlewares/auth";
import { serializeAudit } from "../lib/serializers";

const router: IRouter = Router();

router.get(
  "/projects/:id/audit",
  requireMember,
  async (req: Request, res: Response) => {
    const rows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.projectId, String(req.params.id)))
      .orderBy(desc(auditEvents.createdAt));
    res.json(rows.map(serializeAudit));
  },
);

export default router;
