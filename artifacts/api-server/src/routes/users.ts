import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { UpdateUserBody } from "@workspace/api-zod";
import { requireRoles, getLocalUser } from "../middlewares/auth";
import { serializeUser } from "../lib/serializers";
import { writeAudit } from "../lib/audit";

const router: IRouter = Router();

router.get("/users", requireRoles("admin"), async (_req: Request, res: Response) => {
  const rows = await db.select().from(users).orderBy(users.createdAt);
  res.json(rows.map(serializeUser));
});

router.patch(
  "/users/:id",
  requireRoles("admin"),
  async (req: Request, res: Response) => {
    const parsed = UpdateUserBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const [updated] = await db
      .update(users)
      .set({ ...parsed.data })
      .where(eq(users.id, String(req.params.id)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await writeAudit({
      user: getLocalUser(req),
      eventType: "user.updated",
      objectType: "user",
      objectId: updated.id,
      details: JSON.stringify(parsed.data),
    });
    res.json(serializeUser(updated));
  },
);

export default router;
