import type { Request, Response, NextFunction } from "express";

/**
 * De-duplicates Clerk auth cookies before Clerk reads them.
 *
 * On the Replit dev preview a browser can accumulate two copies of each Clerk
 * cookie (e.g. two `__session` / `__session_<suffix>`) set at different scopes:
 * clerk-js keeps refreshing the copy at its own scope while a stale copy at
 * another scope lingers past its ~60s expiry. When both are sent, Clerk's
 * request parser reads the first occurrence — which can be the expired one — and
 * treats the request as signed-out (401) even though a valid session token is
 * also present in the same header.
 *
 * This middleware collapses any duplicated Clerk cookie name to a single value,
 * preferring the freshest: JWT-valued cookies keep the one with the latest
 * `exp`; the numeric `__client_uat` keeps the largest value; otherwise the last
 * occurrence wins. Non-Clerk cookies are left untouched, the Cookie header is
 * only rewritten when a Clerk duplicate is actually present, and any parse error
 * fails open (the header is left unchanged) so normalization can never block a
 * request.
 */

const isClerkCookie = (name: string): boolean =>
  name.startsWith("__session") ||
  name.startsWith("__client_uat") ||
  name.startsWith("__clerk");

function jwtExp(value: string): number | null {
  const parts = value.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(
        parts[1].replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf8"),
    ) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

/** Chooses the freshest value among duplicates of a single Clerk cookie name. */
function pickFreshest(values: string[]): string {
  const withExp = values
    .map((v) => ({ v, exp: jwtExp(decodeURIComponent(v)) }))
    .filter((x): x is { v: string; exp: number } => x.exp !== null);
  if (withExp.length > 0) {
    return withExp.reduce((a, b) => (b.exp > a.exp ? b : a)).v;
  }
  // __client_uat is a unix-seconds integer; the largest is the most recent.
  if (values.every((v) => /^\d+$/.test(v))) {
    return values.reduce((a, b) => (Number(b) > Number(a) ? b : a));
  }
  return values[values.length - 1];
}

export function dedupeClerkCookies(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  try {
    const header = req.headers.cookie;
    if (!header || !header.includes("__")) {
      next();
      return;
    }

    const pairs = header
      .split(";")
      .map((c) => c.trim())
      .filter(Boolean)
      .map((pair) => {
        const idx = pair.indexOf("=");
        return {
          name: (idx === -1 ? pair : pair.slice(0, idx)).trim(),
          value: idx === -1 ? "" : pair.slice(idx + 1),
        };
      });

    const clerkValues = new Map<string, string[]>();
    for (const { name, value } of pairs) {
      if (isClerkCookie(name)) {
        const list = clerkValues.get(name);
        if (list) list.push(value);
        else clerkValues.set(name, [value]);
      }
    }

    const hasDuplicate = [...clerkValues.values()].some((v) => v.length > 1);
    if (!hasDuplicate) {
      next();
      return;
    }

    const freshest = new Map<string, string>();
    for (const [name, values] of clerkValues) {
      freshest.set(name, values.length > 1 ? pickFreshest(values) : values[0]);
    }

    const emitted = new Set<string>();
    req.headers.cookie = pairs
      .filter(({ name }) => {
        if (!isClerkCookie(name)) return true;
        if (emitted.has(name)) return false;
        emitted.add(name);
        return true;
      })
      .map(({ name, value }) =>
        isClerkCookie(name) ? `${name}=${freshest.get(name)}` : `${name}=${value}`,
      )
      .join("; ");
  } catch {
    // Fail open: never block a request because of cookie normalization.
  }
  next();
}
