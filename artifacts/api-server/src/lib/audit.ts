import { db, auditEvents } from "@workspace/db";
import type { LocalUser } from "../middlewares/auth";

export async function writeAudit(params: {
  user?: LocalUser | null;
  projectId?: string | null;
  eventType: string;
  objectType?: string | null;
  objectId?: string | null;
  details?: string | null;
}): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      userId: params.user?.id ?? null,
      userName: params.user?.name ?? params.user?.email ?? null,
      projectId: params.projectId ?? null,
      eventType: params.eventType,
      objectType: params.objectType ?? null,
      objectId: params.objectId ?? null,
      details: params.details ?? null,
    });
  } catch {
    // Audit logging must never break the primary request path.
  }
}
