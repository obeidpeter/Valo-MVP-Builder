# Valo Bid Autopsy Workbench

Private internal workbench for Valo's bid-compliance service: turns a tender document and a submitted bid into a reviewer-confirmed requirement matrix, defect register, disqualification-risk score, and signed Bid Autopsy Report (DOCX). Doctrine: deterministic core, LLM shell, named-human sign-off.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run test` — unit + route tests (route tests need `DATABASE_URL`; the lib suites are pure)
- `pnpm --filter @workspace/api-server run verify:audit` — verify the tamper-evident audit chain (prints the head to record externally)
- `pnpm --filter @workspace/api-server run prove:doctrine[:offline]` — AI-doctrine proof harness
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/db/src/schema/index.ts` — DB schema (single source of truth)
- `lib/api-spec/openapi.yaml` — API contract; codegen writes `lib/api-client-react` (React hooks) and `lib/api-zod` (request schemas)
- `artifacts/api-server/src/routes/*` — one router per resource; registered in `routes/index.ts`
- `artifacts/api-server/src/lib/deterministic.ts` — the deterministic core: exact-kobo BOQ arithmetic, risk scoring, fatal-block invariant, expiry telemetry, words-to-kobo parsing (unit tests alongside)
- `artifacts/api-server/src/lib/` — `auditChain.ts` (hash-chain rules), `scorecard.ts` (Gate 0 recall), `sanitizeLlm.ts` (LLM output containment), `llm.ts` (prompt pack), `provenance.ts` (engine/prompt/model ids), `docx.ts` (report assembly)
- `artifacts/valo-workbench/` — React app; project tabs in `src/pages/project-tabs/`, client sections in `src/components/client-*.tsx`
- `.agents/memory/` — non-obvious decisions and build gotchas; read `valo-doctrine-decisions.md` before touching risk, sign-off, audit, intake, BOQ, or LLM code

## Architecture decisions

- Everything AI-produced is a suggestion until a named human confirms it; reviewer identity is always server-derived, never client-supplied.
- Deterministic checks (risk, BOQ, expiry, sign-off gating, scorecard) are pure functions with the reference date/inputs as parameters — no DB or clock inside.
- The audit log is a tamper-evident hash chain; never insert into `audit_events` except through `writeAudit`.
- Money paths use exact integer-kobo BigInt arithmetic with zero default tolerance — no floats.
- No per-user project isolation by design (small internal tool); "isolation" means per-project/per-client data scoping, which every query enforces.

## Product

Clients → tender projects → NDA-gated document intake (SHA-256 manifests) → AI requirement extraction with a human verification queue (Gate 0 scorecard tracks engine recall) → evidence mapping → defect register → exact-kobo BOQ verification (CSV/XLSX upload) → explainable risk score with reviewer override → sign-off-gated DOCX report (provenance-stamped, fatal-block enforced) → ZIP export with reproducible scorecard. Per client: Certificate Vault with expiry telemetry (dashboard renewal radar) and an evidence-linked Capability Library (claims are unusable until evidenced and approved).

## User preferences

- Follow the Valo doctrine documents (Business Plan, Build Brief, TRD, Product Roadmap in `attached_assets/` and the docs the founder shares) — commercial gates govern build sequencing; do not build ahead of the gate (no portal, billing, drafting engine until Phase 1 exit).

## Gotchas

- See `.agents/memory/api-server-build-gotchas.md` (archiver@8 ESM shape, Express 5 param typing, pdf-parse subpath) and `valo-doctrine-decisions.md` (doctrine seams that must not be regressed).
- Route test files import `@workspace/db` and fail fast without `DATABASE_URL`; the `src/lib/*.test.ts` suites are pure and always runnable.
- After editing `openapi.yaml`, always run codegen before typechecking the frontend.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
