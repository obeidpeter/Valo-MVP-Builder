export const AUTH_PATHS = new Set([
  "/sign-in",
  "/accept-invitation",
  "/sso-callback",
]);

export const PROTECTED_PREFIXES = [
  "/app",
  "/dashboard",
  "/clients",
  "/projects",
  "/intelligence",
  "/sbd",
  "/operations",
  "/portal",
  "/partner",
  "/evidence-readiness",
  "/reports",
  "/billing",
  "/notifications",
  "/organisation-settings",
  "/settings",
  "/account",
] as const;

export type RouteSurface = "public" | "access" | "protected";

export function classifyRoute(location: string): RouteSurface {
  const path = location.split("?", 1)[0] || "/";
  if (AUTH_PATHS.has(path)) return "access";
  if (
    PROTECTED_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    )
  ) {
    return "protected";
  }
  return "public";
}
