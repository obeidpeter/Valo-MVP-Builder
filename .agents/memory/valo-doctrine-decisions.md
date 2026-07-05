---
name: Valo doctrine decisions
description: Non-obvious design decisions for the Valo Bid Autopsy Workbench that future work must stay consistent with.
---

- **Reviewer identity is derived server-side, never trusted from the client.** Report sign-off and risk-override endpoints ignore any client-supplied `reviewerName` and instead use the authenticated local user's `name || email`. The request body still carries `reviewerName` because the generated client type requires it, but the server overwrites it.
  **Why:** the doctrine requires a *named human reviewer* for accountability; trusting a client string lets anyone attribute a sign-off to an arbitrary name.

- **There is no per-user project/client isolation, by design.** The schema has no user↔project membership table; `projects.reviewerId` is a single optional pointer. Any approved member (role ≠ `none`) can access every project. Routes gate on `requireMember` / `requireRoles(...)`, not on resource ownership.
  **Why:** it is a small private internal tool where all approved staff work across all packages. Do NOT add IDOR-style ownership checks expecting a membership model — there isn't one. "Isolation" in the spec means queries are scoped by `projectId` so data doesn't bleed between projects, which they already are.

- **Deterministic risk: missing/expired-evidence penalty applies only to mandatory requirements, deduplicated per requirement.** `computeRisk` builds a set of mandatory requirement IDs and counts distinct requirements with missing/expired evidence (not raw evidence rows).
  **Why:** penalising every evidence row (or non-mandatory ones) over-inflates the score and mis-bands projects.

- **Risk `distribution` is serialised as `CountBucket[]` (`{key,count}`) at the route boundary**, even though `computeRisk` returns a `Record<Severity, number>` internally. The generated OpenAPI client expects the array shape.
  **How to apply:** any new consumer of the risk assessment must map the record→array at the edge, matching the OpenAPI contract.

- **`wordsToNumber` does NOT actually drop a spelled-out fractional part despite its docstring.** It only halts on a literal `cent`/`cents` token, so "one hundred dollars and fifty cents" returns 150 (the "fifty" is consumed as tens before "cents" breaks). Whole-number and currency-filler cases work correctly.
  **Why:** noted while writing unit tests; treated as existing behavior, not fixed, to keep the test task in scope. If a future task tightens `words_vs_figures`, fix the parser to drop the fraction and update the characterization test.

- **Deterministic-core unit tests live at `artifacts/api-server/src/lib/deterministic.test.ts`** and run via Node's built-in test runner through `tsx` (`pnpm --filter @workspace/api-server run test`), registered as the `test` validation command. No vitest/jest — imports must be extensionless so `tsc` typecheck also passes.
