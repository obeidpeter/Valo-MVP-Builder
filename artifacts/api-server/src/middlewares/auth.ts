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

    // TEMP DEBUG: diagnose why cookie-based auth returns 401 in the preview.
    // Decodes __session* JWT *claims only* (iss/exp/iat/nbf/sub/azp) — never the
    // signature or raw token — to see if the session token is expired, from the
    // wrong issuer, or if duplicate cookies carry conflicting values.
    const cookieHeader = req.headers.cookie ?? "";
    const cookieMap: Record<string, string[]> = {};
    for (const pair of cookieHeader.split(";").map((c) => c.trim()).filter(Boolean)) {
      const idx = pair.indexOf("=");
      const name = (idx === -1 ? pair : pair.slice(0, idx)).trim();
      const val = idx === -1 ? "" : pair.slice(idx + 1);
      (cookieMap[name] ??= []).push(val);
    }
    const cookieNames = Object.keys(cookieMap);
    const nowSec = Math.floor(Date.now() / 1000);
    const decodeJwtClaims = (token: string) => {
      try {
        const parts = token.split(".");
        if (parts.length < 2) return { error: "not-a-jwt", len: token.length };
        const payload = JSON.parse(
          Buffer.from(
            parts[1].replace(/-/g, "+").replace(/_/g, "/"),
            "base64",
          ).toString("utf8"),
        ) as Record<string, unknown>;
        return {
          iss: payload.iss,
          sub: payload.sub,
          azp: payload.azp,
          sid: payload.sid,
          iat: payload.iat,
          nbf: payload.nbf,
          exp: payload.exp,
          expired: typeof payload.exp === "number" ? payload.exp < nowSec : null,
          notYetValid: typeof payload.nbf === "number" ? payload.nbf > nowSec : null,
          ageSec:
            typeof payload.iat === "number" ? nowSec - (payload.iat as number) : null,
        };
      } catch (e) {
        return { error: String(e) };
      }
    };
    const sessionCookieClaims: Record<string, unknown[]> = {};
    for (const name of cookieNames) {
      if (name === "__session" || name.startsWith("__session_")) {
        sessionCookieClaims[name] = cookieMap[name].map((v) =>
          decodeJwtClaims(decodeURIComponent(v)),
        );
      }
    }
    req.log.info(
      {
        authDebug: {
          userId: clerkUserId ?? null,
          sessionId: auth?.sessionId ?? null,
          nowSec,
          cookieNameCounts: Object.fromEntries(
            cookieNames.map((n) => [n, cookieMap[n].length]),
          ),
          sessionCookieClaims,
          host: req.headers.host,
          xForwardedHost: req.headers["x-forwarded-host"],
          forwardedProto: req.headers["x-forwarded-proto"],
          referer: req.headers.referer,
        },
      },
      "attachUser auth debug",
    );

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
