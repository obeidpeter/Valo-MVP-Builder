# Valo — Expansion Opportunities

An audit of the codebase (July 2026) against the Valo Business Plan v1.1 and the Replit Build Brief, identifying what to build next. Ordered by leverage: schema-ready Phase 1 features first, then deepening of existing Gate 0 features, then new Phase 1 surfaces, then platform prep.

## Where the build stands (Gate 0 — complete)

The Gate 0 MVP described in the build brief is implemented end to end: clients → projects (with commercial outcome tracking) → document intake with text extraction (including a multimodal fallback for scanned PDFs) → AI requirement extraction with a human review queue → evidence mapping → defect register → deterministic BOQ Lite checks → explainable risk scoring with named-reviewer override → sign-off-gated DOCX report → ZIP/CSV export → audit trail, role-based access, LLM run logging, and a dashboard with most Gate 0 metrics. The doctrine (deterministic core, LLM shell, human sign-off, no fabrication) is enforced in code and covered by tests and a proof harness.

## Tier 1 — Schema exists, feature doesn't (highest leverage)

These two tables are in `lib/db/src/schema/index.ts` and in the seed data, but have **no API routes and no UI**. They are the first two Phase 1 extensions in the build brief, and the plumbing is already half done.

### 1. Certificate Vault v1 (`vault_items`)
Structured storage per client for CAC, tax clearance, PENCOM, ITF, NSITF, group life, audited accounts, BPP/CCSP, NCDMB/NipeX and sector licences, with issue/expiry dates and `renewal_lead_days`. Build: CRUD routes (`/clients/:id/vault-items`), a Vault tab on the client-details page, and OpenAPI spec + codegen. The table's fields already match the brief's spec exactly.

### 2. Expiry telemetry (builds on the Vault)
Dashboard widget + per-client reminder list for certificates expiring within 90/60/30/7 days (pure date arithmetic — belongs in the deterministic core, `deterministic.ts`, with unit tests alongside the existing suite). High doctrine fit: today "expired" evidence status is AI-suggested or manual; the Vault can drive it deterministically. A follow-on step is to let evidence mapping consult the Vault so an expired mandatory certificate flags automatically.

### 3. Capability Library v1 (`capability_items`)
Evidence-linked record of projects, personnel, equipment and approved claims per client. Beyond CRUD + UI, this is doctrinally load-bearing: the brief states AI "can only summarise evidence already uploaded or approved in the Capability Library" — once built, it becomes the grounding corpus for `unsupported_claim` defect detection, which is currently the weakest defect type.

## Tier 2 — Deepen what Gate 0 shipped

### 4. BOQ Verifier v1: real spreadsheet upload
`run-boq-checks` accepts JSON rows; the UI (`boq-tab.tsx`) is a paste-only textarea assuming tab-separated Excel paste. The brief's Phase 1 spec calls for CSV/XLSX file upload. Build: server-side XLSX/CSV parsing with column mapping, linked to the uploaded document (`sourceDocId`), feeding the existing deterministic checker. Note the doctrine memory: `section_total` checks need a subtotal marker row + section tag, and `wordsToNumber` has a known characterized bug (spelled-out cents are absorbed into the whole-number value) to fix when tightening `words_vs_figures`.

### 5. Asynchronous extraction pipeline
Document text extraction (including the multimodal OCR fallback) and LLM requirement extraction run synchronously inside request handlers. The brief explicitly requires long-running extraction/OCR/report jobs to run asynchronously with status in the UI. Large scanned PDFs will hit request timeouts. `documents.extraction_status` already exists — add a lightweight job runner and poll/refresh in the UI.

### 6. Configurable scoring and real Settings
`SEVERITY_WEIGHTS`, the missing-evidence weight, and the band cutoffs (15/40/70) are hard-coded in `deterministic.ts`. The brief's Settings screen covers score thresholds, report template details and retention settings; none of that is configurable today. Keep `engine_version` stamping on reports so historic sign-offs remain traceable to the scoring config that produced them.

### 7. PDF export
Reports are DOCX-only, which the brief endorsed for Gate 0 ("PDF export can follow"). DOCX quality is now stable and tested — PDF is the natural next step for client delivery.

### 8. Requirement merge
The review workflow supports confirm/edit/reject/add but not **merge**, which the brief lists explicitly. AI extraction routinely produces near-duplicate requirements; merging them (preserving both source citations) beats delete-and-retype.

### 9. Complete the Gate 0 founder metrics
The dashboard tracks packages shared, material-defect rate, and paid mandates, but not **decision-maker conversations** (threshold: ≥ 8) or **mandate quality** (≥ 1 assisted-bid/retainer mandate). A minimal conversations log per client would let the founder run the §10.2 pass/kill table entirely in-app.

## Tier 3 — New Phase 1 surfaces (after the first paid mandates)

### 10. Assisted Bid Workspace
Task board for building submission-ready packages: requirements → owners → evidence slots → draft sections → red-team status → delivery checklist, including the mandatory T-minus-72-hour red-team pass from the business plan. Reuses the requirements and evidence models; needs a tasks table. This is the delivery tool for the "assisted bid" mandate type that Gate 0 is meant to sell, so build it as soon as one is signed — not before.

### 11. Retainer dashboard
Active retainers, included usage, overage, renewal calendar, monthly service outputs. Requires a small commercial model beyond the current single `outcome` field on projects. The Replacement-Cost Crossover (recurring MRR ≥ ₦4.5m) is a named KPI in the plan — this dashboard is where it lives.

### 12. Template library
Report templates, requirement categories, defect taxonomy, and common agency/tender formats (federal, NipeX/NCDMB, donor) are all hard-coded today. Externalizing the taxonomy also feeds the anonymised defect corpus (below).

## Tier 4 — Platform prep (Phase 2; only on traction)

- **Anonymised defect corpus / flagship defect report.** The business plan names the anonymised, aggregated defect statistics as Valo-owned IP and a Phase 2 marketing asset. A cross-project analytics view over the defect register (type × severity × segment) is cheap to build once the taxonomy is externalized.
- **Security hardening before live vaults.** The brief requires a proper security review and hardened infrastructure before storing live certificate vaults or many unredacted documents — sequence this with Certificate Vault adoption, not after it.
- **Retention automation.** Deletion controls and audit logging exist; automated retention windows per the Settings spec do not.
- **Explicitly out of scope until Phase 2 gates pass** (do not build yet, per the brief): client portal / self-serve Vault tier, payments/billing, white-label channel tooling, pricing-strategy engine, automated portal submission, GCC localisation.

## Suggested sequence

1. Certificate Vault v1 + expiry telemetry (small, schema-ready, deterministic, immediately useful in service delivery)
2. BOQ XLSX/CSV upload (removes the clunkiest step in the current workflow)
3. Capability Library v1 (unlocks grounded unsupported-claim detection)
4. Async extraction pipeline (reliability for real-world scanned tenders)
5. Configurable scoring + Settings, requirement merge, PDF export (polish for paid engagements)
6. Assisted Bid Workspace and retainer dashboard, gated on the first paid mandates
