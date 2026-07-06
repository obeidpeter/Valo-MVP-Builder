# Valo — Expansion Opportunities

Audit of the codebase against the Valo Business Plan v1.1/v1.2, the Replit Build Brief, the Product Roadmap v1.0, and the TRD v1.0. Originally written July 2026 against the Gate 0 MVP; updated after the Phase 1 hardening milestone (PR #1), the pipeline/UX milestone (PR #2), the parallel operations/readiness work (PRs #3–#4), and the July 2026 cleanup/hardening sweep — to keep what is built separated from what remains.

## Shipped

- **Fatal-block invariant** (TRD I3 / FR-CSM-02) — sign-off is impossible with open fatal/likely-fatal defects; no override path.
- **Hash-chained, tamper-evident audit log** (FR-WFM-02) with verifier script, external head-anchor workflow, and DB-ordinal stray detection.
- **Fail-closed document intake** (FR-INT-01/02) — server-side SHA-256 manifests, measured sizes, NDA gate with audited denials and post-download re-check, integrity re-verification endpoint + UI, `documents_manifest.csv` in exports.
- **Full provenance stamps** (NFR-AUD-01) — engine/prompt-pack/model on every report row and DOCX sign-off block.
- **Certificate Vault v1 + expiry telemetry** (FR-VLT-01/02) — CRUD + client Vault section, deterministic T-3/T-14/T-30 bands (widened by renewal lead time), dashboard renewal radar. Vault-referenced blobs now survive project deletion, document deletion, and retention purges (ownership transfers to the vault). Delivery channels (FR-NTF-01) deliberately not faked — in-app notification log only.
- **Exact-kobo BOQ arithmetic** (FR-BOQ-01) — BigInt money paths, zero default tolerance; **kobo-aware words-vs-figures** (FR-BOQ-02) fixing the historical fifty-cents bug.
- **LLM output containment** (FR-EXT-02) — sanitizeLlm schema clamping, fail-closed defect taxonomy, untrusted-input guardrail clause, hostile-payload suite, **plus a ≥12-fixture hostile-document corpus** (`prove:injection` / `prove:injection:offline`) covering exfiltration, instruction injection, taxonomy forging, prototype pollution, and flood attacks. The offline half runs in CI; run the live half in the deploy environment where the OpenAI key lives.
- **Gate 0 Technical Scorecard** (FR-EXT-03/04/05) — origin/engineText/reviewer stamps on requirements, fixed recall definitions, live endpoint + `scorecard.json` in exports, scorecard strip vs the 85% gate.
- **Human verification queue UI** — confirm/edit/reject/add with engine-proposal diffs.
- **Capability Library v1** (FR-CAP-01 / I4 seam) — evidence-linked claims, approval hard-blocked without evidence, `claimable` derived never stored.
- **BOQ Verifier upload** — CSV/XLSX with column mapping (incl. section + amount-in-words), preview, declared grand total.
- **Async extraction pipeline** — extraction runs as a background job with `extraction_status` polling in the Documents tab; re-extract endpoint included.
- **Workflow governance + SLA clocks** (FR-CSM-01/03, FR-WFM-01) — deterministic status-transition gate (named reviewer, conflict, payment, physical-archive instruction), SLA breach + red-team-window alerts on the dashboard (red-team alerts now expire at the tender deadline).
- **Dual payment confirmation with identities** (FR-BIL-01) — `POST /projects/:id/payment-confirmations` derives the confirming identity server-side, requires two *distinct* people for the founder/advisor legs, and stamps who/when. The gate no longer trusts client-supplied booleans.
- **Conflict register with decisions** — same-tender/lot conflicts block intake; consent/decline decisions now stamp `decidedBy`/`decidedAt` on the open conflict record, and an unrelated PATCH can no longer silently re-block a consented conflict.
- **Retention workflow with honest deletion certificates** (NFR-PRV-02, manual half) — completion purges every stored content class (blobs, requirement text, evidence excerpts, defect snapshots, BOQ lines, LLM run summaries, narrative fields) in one transaction, enforces the archive gate, refuses to certify over failed blob deletions, and the certificate enumerates exactly what was purged and what was retained (audit chain, vault artefacts).
- **Project Readiness Gate** — reviewer-facing checklist across governance/intake/evidence/defects/BOQ/risk/report; gate logic extracted to a pure, unit-tested module aligned with the server's deterministic gates (dual payment confirmation; only OPEN material defects block).
- **SBD Corpus v1** — templates + agency-quirk annotations; single-active-lineage enforced on activation, version cloning supersedes the source.
- **DOCX report** — document control block, table of contents, requirement matrix with evidence-trace annex, defect register, risk score, responsiveness review (UI trigger in the Reports tab), BOQ annex, remediation plan, copies manifest, signature/seal checklist, process warranty.
- **CI** (`.github/workflows/ci.yml`) — typecheck, unit + DB-backed integration tests (including the retention-purge and export end-to-end suites), offline doctrine + injection proofs, the offline eval-harness self-check, and both production builds on every push/PR.
- **Eval harness v0** (FR-EXT-05, §9) — ≥10 hand-labelled tenders (`scripts/eval-corpus/`) run as a recall regression suite (`eval:harness`) that measures the engine against verified ground truth and fails below the 85% v0 target, naming the missed requirements per tender. The offline self-check (corpus well-formed + deterministic matcher consistent) runs in CI; the live recall measurement runs where the model key lives.
- **Live pre-ship proof gate** — `prove:ship` runs the live doctrine, injection, and eval-harness proofs together (fail-fast) in the Replit environment where the model key lives; run it before shipping any model/prompt change (a `MODEL_ID`/`PROMPT_PACK_VERSION` bump). Runbook: `docs/PRE_SHIP_PROOFS.md`.

## Remaining — near-term (current gate)

1. **Configurable scoring + real Settings** — severity weights and band cutoffs are hard-coded in `deterministic.ts`; the Settings screen (thresholds, report template details, retention defaults) is unbuilt. Keep engine-version stamping so historic sign-offs stay traceable.
2. **PDF export** — reports are DOCX-only; brief says PDF follows once DOCX is stable (it is).
3. **Requirement merge** — the review queue lacks merge for near-duplicate AI extractions (brief lists it; preserve both source citations).
4. **Gate 0 founder metrics completeness** — decision-maker conversations count (≥8 threshold) and mandate-quality breakdown are still not tracked in-app.
5. **Retention automation** (NFR-PRV-02, scheduled half) — the manual workflow with honest certificates exists; the 12-month clock that *opens* requests automatically does not. Needs a scheduler (cron/queue) in the deploy environment.

## Remaining — v1.0 trio (gated on Phase 1 commercial exit; do not build early)

- **Drafting Engine v1** (FR-DRF-01/02, FR-CAP-02) — criteria-mapped responsive sections generated ONLY from `claimable` Capability Library records; an unevidenced claim hard-fails the render. The claimable seam is already enforced at the data layer.
- **Red-Team Scorer v1** (FR-RTS-01) — rubric-driven hostile-evaluator pass at T-72h, unskippable, feeding the defect taxonomy; the T-72h window clock already exists in the alerts feed.
- **Assembly Engine v1** (FR-ASM-02) — full package to tender spec (pagination, tabbing, TOC, cross-refs, copies manifest, signature/seal checklist) with golden-file tests; the DOCX report already carries the manifest/checklist annexes to grow from.
- Supporting: extraction recall ≥95% on a ≥25-doc harness, BPP SBD format detection (FR-EXT-06), cross-document BOQ consistency (FR-BOQ-03), anonymised defect dataset with the k≥8 gate (FR-ANL-02), runbooks (NFR-OPS-01).

## Remaining — Phase 2+ (explicitly out of scope until gates pass)

Client portal (v1.5), self-serve tier + billing/entitlements (v2.0), automation graduation via confidence scores, Restricted Mode in-country inference, white-label channel, flagship defect report, GCC localisation. Per the roadmap's own rule: none of this is entitled to exist before its commercial gate.

## Deploy note

Schema changes require `pnpm --filter @workspace/db run push` in the deploy environment. Latest addition: the six `payment_*_confirmed_by`/`_by_name`/`_at` identity columns on `projects` (dual-confirmation stamps). The DB-dependent test suites pass only where `DATABASE_URL` exists; CI provisions a throwaway Postgres for them.
