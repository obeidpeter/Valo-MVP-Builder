import type { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db, users } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

export type LocalUser = typeof users.$inferSelect;

function getLocalUser(req: Request): LocalUser | undefined {
  return (req as unknown as { localUser?: LocalUser }).localUser;
}

export { getLocalUser };

/**
 * Requires a valid Clerk session, then loads (or just-in-time provisions) the
 * matching internal user row. The very first user to sign in becomes an admin;
 * every subsequent new user is provisioned with role "none" (awaiting approval).
 */
export async function attachUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = getAuth(req);
    const clerkUserId = auth?.userId;
    if (!clerkUserId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.clerkUserId, clerkUserId));

    if (!user) {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(users);
      const isFirst = Number(count) === 0;

      let email = `${clerkUserId}@unknown.local`;
      let name: string | null = null;
      try {
        const cu = await clerkClient.users.getUser(clerkUserId);
        email =
          cu.primaryEmailAddress?.emailAddress ||
          cu.emailAddresses[0]?.emailAddress ||
          email;
        name =
          [cu.firstName, cu.lastName].filter(Boolean).join(" ") ||
          cu.username ||
          null;
      } catch {
        // Fall back to placeholder identity if Clerk lookup fails.
      }

      [user] = await db
        .insert(users)
        .values({
          clerkUserId,
          email,
          name,
          role: isFirst ? "admin" : "none",
          status: "active",
          lastLoginAt: new Date(),
        })
        .onConflictDoUpdate({
          target: users.clerkUserId,
          set: { lastLoginAt: new Date() },
        })
        .returning();
    } else {
      await db
        .update(users)
        .set({ lastLoginAt: new Date() })
        .where(eq(users.id, user.id));
    }

    if (user.status === "disabled") {
      res.status(403).json({ error: "Account disabled" });
      return;
    }

    (req as unknown as { localUser?: LocalUser }).localUser = user;
    next();
  } catch (error) {
    req.log.error({ err: error }, "attachUser failed");
    res.status(500).json({ error: "Authentication error" });
  }
}

/** Requires an approved member (any role other than "none"). */
export function requireMember(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const user = getLocalUser(req);
  if (!user || user.role === "none") {
    res.status(403).json({ error: "Awaiting access approval" });
    return;
  }
  next();
}

/** Requires the current user to hold one of the given roles. */
export function requireRoles(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = getLocalUser(req);
    if (!user || !roles.includes(user.role)) {
      res.status(403).json({ error: "Insufficient role" });
      return;
    }
    next();
  };
}
