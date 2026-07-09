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
- **CI** (`.github/workflows/ci.yml`) — the full TRD §12.2 gate order: secret scan (gitleaks, NFR-SEC-04), typecheck, unit + DB-backed integration tests (including the retention-purge, governance, and export end-to-end suites plus the FR-ASM-01 golden-file report test), offline injection + doctrine proofs, the eval-harness offline gates, and both production builds on every push/PR.
- **Eval harness v0** (FR-EXT-05 / FR-EXT-04 / NFR-QLT-02) — 14 hand-labelled tenders (`scripts/eval-corpus/`, incl. Nigerian federal goods/works and NIPEX cases) scored by the unit-tested AND-of-ORs matcher in `src/lib/evalHarness.ts`, with both overall and MANDATORY recall. Live mode (`eval:harness`) records engine outputs + figures to `eval-corpus/runs/latest.json`; the CI offline mode self-checks the corpus/matcher, independently recomputes recorded figures (reproducibility), and enforces the ≥85% mandatory-recall threshold plus the >2-point baseline-drift block once a live run is committed (`eval:promote-baseline` sets the baseline).
- **Live pre-ship proof gate** — `prove:ship` runs the live doctrine, injection, and eval-harness proofs together (fail-fast) in the Replit environment where the model key lives; run it before shipping any model/prompt change. Runbook: `docs/PRE_SHIP_PROOFS.md`.
- **Configurable scoring + Settings** — severity weights, band cutoffs, report template details and retention defaults are editable app config (with the active config versioned); reports keep their provenance stamps so historic sign-offs stay traceable.
- **PDF export** — reports render to PDF alongside DOCX.
- **Requirement merge** — near-duplicate AI extractions can be merged in the review queue with citations preserved.
- **Founder Gate 0 metrics** — decision-maker conversations and mandate-quality tracking with a readiness dashboard.
- **Retention automation** (NFR-PRV-02, scheduled half) — `retention:scan` auto-opens retention requests at the 12-month mark (it never purges by itself; completion stays a human admin act).
- **Cost telemetry** (FR-ANL-03) — token counts on every llm_runs row, per-engagement rollup (`GET /projects/:id/cost`, shown on the project overview) and an admin monthly variance report (`GET /analytics/cost?month=`) against the BP ₦15–30k unit assumption.
- **Extraction telemetry** (FR-OCR-01/02) — every document records how its text was obtained (text layer / multimodal OCR / native), a deterministic confidence heuristic, and per-document notes that accumulate into the OCR evaluation set; surfaced in the Documents tab.
- **Versioned defect taxonomy** (FR-ANL-01) — `TAXONOMY_VERSION` joins the provenance stamp on every report row and DOCX; registry + governed change process in `docs/DEFECT_TAXONOMY.md`.
- **Report fidelity** — redacted/restricted engagements auto-render their limitation banner (FR-INT-03); notification templates render actual messages from engagement data (FR-NTF-01); the report timestamp is pinned to Nigerian local time.
- **User manual** — `docs/USER_MANUAL.md`: every screen, workflow, and gate in plain language, with a "why is this blocked?" cheat-sheet.

## Remaining — near-term (current gate)

1. **Run the live proofs + first eval-harness run in the deploy environment** — `prove:ship` (or the three proofs individually), then commit `eval-corpus/runs/latest.json` and run `eval:promote-baseline`; that activates CI's recall gates.
2. **Grow the eval corpus from real engagements** — 14 seeded cases today; ≥25 by v1.0, harvested from delivered autopsies (roadmap §9 rule: labels never edited to make a run pass).

## Remaining — v1.0 trio (gated on Phase 1 commercial exit; do not build early)

- **Drafting Engine v1** (FR-DRF-01/02, FR-CAP-02) — criteria-mapped responsive sections generated ONLY from `claimable` Capability Library records; an unevidenced claim hard-fails the render. The claimable seam is already enforced at the data layer.
- **Red-Team Scorer v1** (FR-RTS-01) — rubric-driven hostile-evaluator pass at T-72h, unskippable, feeding the defect taxonomy; the T-72h window clock already exists in the alerts feed.
- **Assembly Engine v1** (FR-ASM-02) — full package to tender spec (pagination, tabbing, TOC, cross-refs, copies manifest, signature/seal checklist) with golden-file tests; the DOCX report already carries the manifest/checklist annexes to grow from.
- Supporting: extraction recall ≥95% on a ≥25-doc harness, BPP SBD format detection (FR-EXT-06), cross-document BOQ consistency (FR-BOQ-03), anonymised defect dataset with the k≥8 gate (FR-ANL-02), runbooks (NFR-OPS-01).

## Remaining — Phase 2+ (explicitly out of scope until gates pass)

Client portal (v1.5), self-serve tier + billing/entitlements (v2.0), automation graduation via confidence scores, Restricted Mode in-country inference, white-label channel, flagship defect report, GCC localisation. Per the roadmap's own rule: none of this is entitled to exist before its commercial gate.

## Deploy note

Schema changes require `pnpm --filter @workspace/db run push` in the deploy environment. Latest additions: the six `payment_*` identity columns on `projects`, `prompt_tokens`/`completion_tokens` on `llm_runs`, `extraction_method`/`extraction_confidence`/`extraction_notes` on `documents`, and `taxonomy_version` on `reports`. The DB-dependent test suites pass only where `DATABASE_URL` exists; CI provisions a throwaway Postgres for them.
