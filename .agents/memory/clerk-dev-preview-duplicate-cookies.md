---
name: Clerk duplicate cookies on Replit dev preview
description: Why signed-in requests can 401 in the Replit preview even with valid Clerk config, and the server-side de-dup fix.
---

# Clerk "Authentication Failed" / spurious 401 on the Replit dev preview

## Symptom
A signed-in user keeps hitting "Authentication Failed" / `/api/me` → 401 in the
**dev preview** even though Clerk keys match, the secret is valid, and the server
`clerkMiddleware` block is canonical. Survives reloads; clearing cookies fixes it
only temporarily.

## Root cause
The browser sends **two copies of the same Clerk cookie** (`__session`,
`__session_<suffix>`, sometimes `__client_uat`) set at different scopes. clerk-js
only refreshes the copy at its own scope, so a stale copy at another scope lingers
past its ~60s expiry. Both are sent in one `Cookie` header; Clerk's request parser
reads the **first** occurrence, which can be the expired token → `userId:null` →
401. Same user/session/issuer on both copies — only the freshness differs.

**How it was proven:** temporary middleware decoded `__session*` JWT *claims only*
(iss/exp/iat/nbf/sub) and logged per-cookie-name counts; one copy showed
`expired:true, ageSec≈5600`, the other `ageSec≈1`, first-in-header was the expired
one.

## Fix (durable)
A tiny Express middleware mounted **before** `clerkMiddleware` that collapses
duplicated Clerk cookies (`__session*`, `__client_uat*`, `__clerk*`) to the
freshest value (JWT: max `exp`; `__client_uat`: max int; else last occurrence),
leaves non-Clerk cookies untouched, only rewrites the header when a Clerk dup
exists, and fails open. This tolerates the stale duplicate so no cookie-clearing
is ever needed.

**Why server-side, not client:** the stale duplicate lives at a cookie scope
clerk-js won't touch, so the client can't reliably evict it; the server can always
pick the valid token it already receives.

## Debugging gotchas hit along the way
- The api-server `dev` script is `build && start` via **esbuild**, which does
  **not** type-check — a type error won't fail the build. Run `pnpm --filter
  <pkg> run typecheck` (tsc `--noEmit`) separately to catch type errors.
- Restart is required after server edits (no watch on that dev script).
- `@clerk/shared` version skew: the client's `@clerk/clerk-react` pulls
  `@clerk/shared@3.47.x` (no `publishableKeyFromHost` in `/keys`), while the
  server's `@clerk/express` pulls `@clerk/shared@4.x` (has it). Don't add
  `@clerk/shared` to the client to reach `publishableKeyFromHost` — you'll bind
  the old version. The canonical client path is `@clerk/react/internal`.
- For a single-domain Replit app, `publishableKeyFromHost(host, key)` returns the
  fallback `key` anyway, so the raw publishable key is functionally identical. The
  functionally important client prop is `proxyUrl={VITE_CLERK_PROXY_URL}`
  (unconditional; empty in dev, populated in prod).
