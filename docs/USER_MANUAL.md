# Valo Bid Autopsy Workbench — User Manual

_A plain-language guide to every screen, button, and rule in the application._

---

## 1. What Valo is

Valo is an internal tool for **forensic tender review**. You give it a client's tender (what the government or agency asked for) and the client's bid (what they submitted, or plan to submit). Valo helps you find every requirement in the tender, check whether the bid answers each one, catch the defects that get bids disqualified in Nigeria — missing certificates, expired documents, arithmetic errors in the Bill of Quantities, formatting breaches — and produce a signed, professional report.

Four principles run through everything, and they explain most of the rules you'll bump into:

1. **The computer checks; a named human decides.** AI reads documents and _suggests_ requirements, evidence, and defects — but nothing counts until a named reviewer confirms it. Suggestions are always visually separated from confirmed findings.
2. **Everything that must be exactly right is done by ordinary tested code, not AI.** Arithmetic, risk scores, expiry dates, and workflow rules are deterministic — the same inputs always give the same answer.
3. **No claim without evidence.** A capability claim can't be marked usable without a linked evidence document. A "present" evidence ruling points at an excerpt. The report traces findings to sources.
4. **Client confidentiality is the #1 risk.** Hence the NDA gate before any upload, the tamper-evident audit log, and the deletion workflow that only issues a certificate when everything is actually gone.

If a button seems blocked, one of these principles is almost always the reason — and section 12 has a cheat-sheet for exactly which rule you've hit and how to satisfy it.

---

## 2. Signing in, roles, and who can do what

Sign in from the landing page (email-based sign-in). The **first person ever to sign in becomes the admin automatically**. Everyone after that is created with **no role** and sees an "awaiting access approval" state until an admin assigns them a role in **Settings**.

| Role                   | Can do                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Admin**              | Everything: all reviewer/analyst work, plus manage users, delete projects and documents, run retention (deletion) workflows, see the Settings page, monthly cost and access-review reports. |
| **Reviewer / Analyst** | All day-to-day work: clients, projects, documents, requirements, evidence, defects, BOQ, risk, reports, sign-offs.                                                                          |
| **None**               | Nothing — waiting for approval.                                                                                                                                                             |

An admin can also **disable** an account (Settings → Personnel Management), which blocks sign-in immediately.

---

## 3. Finding your way around

The left sidebar has five destinations:

- **Dashboard** — portfolio overview and alerts. Start here each morning.
- **Clients** — the companies you work for: their NDA status, Certificate Vault, and Capability Library.
- **Projects** — one project = one engagement = one tender/bid pair under review.
- **SBD Corpus** — your library of Standard Bidding Document templates and agency quirks.
- **Settings** _(admins only)_ — people, scoring/report configuration, and retention workflows.

Almost all of your working time is spent inside a single project's page, which has nine tabs. Section 6 walks through them in the order you'd actually use them.

---

## 4. Dashboard

Four headline numbers: **Active Projects**, **Material Defect Rate** (share of reviewed bids with fatal or likely-fatal defects), **Packages Shared** (signed-off reports), and **Paid Mandates**.

Below them, two alert feeds appear when there is something to act on:

- **Operations Alerts** — red **SLA breach** entries (a project has been open longer than its service class allows: 5 working days standard, 48 hours for live tenders) and amber **red-team due** entries (a project's tender deadline is within 72 hours — time for the final hostile review pass; these disappear once the deadline passes).
- **Certificate Renewal Radar** — client vault artefacts that are expired or expiring: **expired**, **≤3 days** (critical), **≤14 days** (warning), and **upcoming** (≤30 days, or earlier if the artefact has a longer renewal lead time — a certificate that takes 60 days to renew shows up 60 days out). Click any row to jump to that client.

A **Gate 0 Readiness** panel tracks the founder's commercial gate metrics (decision-maker conversations against the ≥8 threshold, mandate quality) alongside the technical ones.

Then a list of recent projects with their risk band, requirement and defect counts.

---

## 5. Clients

Create a client before creating projects for them. Each client page holds three things:

**NDA status** — `pending`, `signed`, or `not_required`. This is the intake gate: **you cannot upload a single document to any of this client's projects until the NDA status is `signed` or `not_required`.** Attempts while pending are refused and logged. This is deliberate — no client papers ever sit in the system without a signed NDA.

**Certificate Vault** — the client's long-lived compliance artefacts (CAC certificate, tax clearance, PENCOM, ITF, NSITF, etc.) with issue/expiry dates and an optional **renewal lead time** in days. The Vault drives the renewal radar on the dashboard. You can link a vault item to a document already uploaded in one of the client's projects — the file then _belongs to the vault_: it survives even if the project it came from is later deleted or purged. Duplicate files (same fingerprint) are flagged.

**Capability Library** — verifiable claims about the client (past projects, key personnel, equipment, certifications). Each claim can link to an evidence document and be approved by a named verifier. A claim is only **claimable** (usable in future drafting) when it has _both_ an evidence link _and_ approval — the system derives this; you can't set it by hand. Approval without evidence is refused.

---

## 6. Projects — the autopsy workflow

### 6.1 Creating a project

Projects → **New Project**. You must pick a client and a **named reviewer** — a project cannot exist without one. Fill in the tender title, issuing entity, tender reference, lot, deadline, and:

- **SLA class** — `standard` (5 working days) or `live` (48 hours). Sets the SLA clock.
- **Payment gate** — `not_required`, `pending`, or `confirmed`. See §6.3.
- **Physical archive instruction** — what happens to hard-copy originals (return/destroy). You can add it later, but the project can never be exported or archived without it.
- **Restricted mode** and **redaction scope** — for sensitive engagements. If restricted mode is on, record the redaction scope; the report will carry a limitation banner automatically.

**Conflict check:** if another active project has the _same tender reference and lot_, the new project is created in **Blocked-Conflict** state — you're reviewing two bidders on the same tender, which needs disclosure. Resolve it on the Overview tab by setting conflict status to `consented` (with the decision and rationale recorded) or `declined`. One caution: consent covers _that_ tender only — if you later change the project's tender reference or lot onto a different tender that also conflicts, it re-blocks and needs fresh consent.

### 6.2 Overview tab — readiness gate and governance

**Project Readiness Gate** — a live checklist of twelve checks (payment/governance, conflict, documents, extraction, requirements, Gate 0 scorecard, evidence, BOQ, defects, risk, report, export). Each card is **Ready**, **Needs review**, or **Blocked**, with a one-line explanation and a button that takes you to the right tab. The "Next action" banner at the top always names the first thing standing between you and sign-off. When every required check is green, the project is ready for the sign-off path.

**Governance & Gates** — the project's status and control fields. Status moves **one step at a time**: `intake → extraction → review → defects → reporting → signed_off → exported → archived` (you can also move backwards to review/defects/reporting for remediation). Moving forward into any production status requires: a named reviewer, a conflict status that is clear or consented, and a satisfied payment gate. Export and archive additionally require the physical archive instruction. Archived is terminal. If a transition is refused, the error message names the exact rule; the refusal is also written to the audit log.

**Payment confirmation** — when the payment gate is `confirmed`, two _different people_ must each press their confirmation button: **Confirm as founder** and **Confirm as advisor**. The system records who confirmed and when, and refuses to let the same person confirm both legs. (Older projects confirmed before this rule show "Legacy confirmation — no identity recorded" with a re-confirm button.)

**Notifications** — log client communications (deadline reminder, payment confirmation, certificate renewal, report ready) with the channel used. The system writes out the actual message text from the project's data, so the log shows what was communicated, not just a template name.

**Retention Request** — starts the deletion workflow for this engagement (see §9).

### 6.3 Documents tab

> **AI availability:** production AI is default-off and is not approved for
> activation in the current release. Model-backed extraction, requirement,
> evidence, defect and responsiveness actions return a safe unavailable state
> unless every global, capability, tenant, release-evidence, provider, privacy,
> region, budget and model gate passes. The current external adapter is denied
> for Restricted Mode projects. Continue with the manual review paths below
> when an AI action is unavailable.

Upload the tender, the bid, and supporting files. Rules and features:

- **Uploads are locked** until the client's NDA status is `signed`/`not_required`, and while the project's conflict status is blocked/declined.
- Every file gets a **SHA-256 fingerprint** at intake — a tamper-evidence manifest. The **verify** action re-downloads the file and re-checks the fingerprint at any time.
- Set each document's **type** — `tender`, `bid`, `boq`, `certificate`, `evidence`, `other`. The readiness gate requires at least one tender and one bid document; BOQ checks look for a `boq` document.
- Set each document's **redaction status** — `excluded` (default: not used for AI extraction at all), `redacted`, or `included`. Only included/redacted documents are read by the extraction engine. This is your control over what the model ever sees.
- New uploads remain **excluded** and are not sent to a parser or model. An authorised reviewer must first make the document eligible and explicitly start extraction. The badge then tells you how it went:
  - `text ready 90%` — read from the PDF's embedded text.
  - `OCR 60% — verify` — the document was scanned, so a model transcription was used; treat it as a draft and verify against the source pages.
  - `no text (paste?)` — unsupported format; paste the text manually.
  - `failed` — hover for the reason, and use the retry button.
- Deleting a document (admin only) also deletes its stored file — unless a Certificate Vault item points at it, in which case the file is kept for the vault.

### 6.4 Requirements tab

The heart of the autopsy: what does the tender demand?

- **Run Extraction**, when the control plane is available, sends only the selected eligible documents through the bounded AI gateway. It returns a candidate list of requirements — each with category (eligibility, administrative, technical, financial-format, other), a mandatory flag, expected evidence, and an exact named-source quote. All arrive as **suggested**. When unavailable, add requirements manually.
- **Nothing counts until you rule on it.** For each suggestion: **Confirm** it, **Edit** it (your edit is kept alongside the engine's original wording, so the diff is visible), or **Reject** it. You can also **Add** requirements the engine missed — those count as engine misses on the scorecard.
- **Merge** near-duplicate extractions into one requirement — both source citations are preserved, so nothing loses its trace back to the tender.
- The **Gate 0 Scorecard** strip shows _mandatory recall_: of all the mandatory requirements a human confirmed, what share did the engine surface by itself? The business target is ≥85%. This is measured, not asserted — the underlying records are exportable and recomputable.

### 6.5 Evidence tab

For every confirmed requirement: does the bid answer it?

- **AI-suggest**, when available, proposes evidence mappings with exact named-source excerpts from the bid; otherwise map manually.
- Each mapping gets a status: `present` (with the supporting excerpt), `missing`, `expired`, `unclear`, `not_applicable`, or `pending`.
- The readiness gate demands every confirmed **mandatory** requirement have resolved evidence (`present` or `not_applicable`) before sign-off.

### 6.6 BOQ Lite tab

Deterministic arithmetic verification of the Bill of Quantities — no AI anywhere in this tab.

- Load rows by **uploading a CSV/XLSX** (with column mapping — tell it which column is quantity, rate, extension, amount-in-words) or pasting data.
- **Run Checks** verifies, in exact kobo arithmetic with zero tolerance: quantity × rate = extension for each line, section sums, the grand total against the declared total, and **words-vs-figures** (the amount written in words against the figures, kobo-aware).
- Every discrepancy becomes a flagged finding citing the exact line. You can **promote a finding to the defect register** in one click, resolve it, or waive it. The readiness gate wants zero still-flagged findings if a BOQ document exists.

### 6.7 Defects tab

The defect register — everything wrong with the bid.

- **AI-suggest**, when available, proposes defects from reviewed requirements and confirmed evidence; each is typed against the versioned taxonomy (`omission`, `expiry`, `arithmetic`, `formatting`, `responsiveness`, `eligibility`, `unsupported_claim`, `validity`) and given a severity. Authorised reviewers can add or edit defects and can supersede them through a governed decision; defect records are immutable and cannot be deleted.
- **Severities**, in plain language:
  - `fatal` — certain disqualification if submitted as-is.
  - `likely_fatal` — disqualification probable, at the evaluator's discretion.
  - `scoring_risk` — survives compliance but loses evaluation points.
  - `cosmetic` — polish only.
- **Statuses:** `suggested` (unconfirmed AI — counts for nothing), `open` (confirmed and live), `remediated`, `waived`.
- **The one unbreakable rule:** a report can never be signed off while any `open` fatal or likely-fatal defect exists. There is no override. Resolve it, or waive it with your name on the waiver.

### 6.8 Risk tab

The disqualification-risk score, computed by documented arithmetic (never by AI):

- Each confirmed live defect adds its weight — by default fatal 40, likely-fatal 25, scoring-risk 10, cosmetic 3 — plus 5 per mandatory requirement without resolved evidence. Capped at 100. Admins can adjust the weights and band cutoffs in **Settings → Scoring & Risk Bands**; new scores use the new settings while historic signed reports keep the figures they were signed with.
- **Default bands:** `critical` at ≥70 (or automatically if _any_ fatal defect is open, regardless of score), `high` ≥40, `medium` ≥15, otherwise `low`.
- A named reviewer can **override the band** — the override requires a written note and the reviewer's name, and the report will show both the computed and the overridden band.

### 6.9 Reports tab

- **Draft Responsiveness Review** — when AI is available, asks for a bounded narrative preview based only on reviewed requirements and defects. It lands as a _suggested_ narrative on the project, clearly marked pending named-human confirmation. Use the manual narrative path while AI is unavailable.
- **Generate Report** — assembles the DOCX: document control block (with the engine, prompt-pack, model, and defect-taxonomy versions that produced it), table of contents, engagement summary (with the redaction limitation banner where applicable), requirement matrix with an evidence-trace annex, defect register (confirmed findings separated from unconfirmed suggestions), risk score with method note, responsiveness review, BOQ annex, remediation plan, copies manifest, signature/seal checklist, sign-off page, and the process warranty.
- **Sign Off** — the named-reviewer attestation. Blocked while open fatal/likely-fatal defects exist. Once signed, the report can be **downloaded as DOCX or PDF**.
- **Export ZIP** _(admin)_ — the full engagement package: all registers as CSV, the document manifest with fingerprints, the scorecard, the audit trail, project metadata, and the signed report. Requires a signed-off report and the physical archive instruction. Exporting moves the project to `exported`.

### 6.10 Audit tab

Every action on the project — views, uploads, rulings, transitions, denials, sign-offs, exports — with who and when. The log is **append-only and hash-chained**: each entry is cryptographically linked to the previous one, so any after-the-fact tampering with history is detectable by the verification tool. Nothing is ever deleted from it, even by the deletion workflow.

---

## 7. SBD Corpus

Your library of BPP Standard Bidding Document templates. Create templates by code and category (goods, works, consultancy, non-consultancy, special); attach **annotations** recording agency-specific quirks ("Agency X wants the bid security on the bank's letterhead, not the template form"). Templates version cleanly: **New version** clones a template as the next draft; **activating** a version automatically supersedes the previously active one, so there is exactly one active version per code. A template's code can't be edited after creation — that's what keeps its version history in one line.

---

## 8. Settings (admins)

- **Scoring & Risk Bands** — adjust the severity weights and band cutoffs the risk score uses. Changes apply to new computations only; historic signed reports are never rescored.
- **Report Template & Retention** — the firm name and confidentiality legend printed on reports, and the default retention window.
- **Personnel Management** — assign roles (`admin`, `reviewer`, `analyst`, `none`) and enable/disable accounts.
- **Retention Workflows** — the queue of deletion requests (see §9), with a **Complete** button for each pending request and the deletion certificate for finished ones.

---

## 9. Deleting an engagement (retention workflow)

When a client asks for their data to be deleted (or the retention period ends):

1. On the project's **Overview tab**, open a **Retention Request** with a reason. One open request per project; the due date defaults to 14 days out (the NDPR-aligned window). A scheduled scan (`retention:scan`, run in the deploy environment) also auto-opens requests for engagements that reach the 12-month retention mark — it only _opens_ them; deletion always remains a human admin decision.
2. An **admin** completes it from **Settings → Retention Workflows**. Completion refuses to run until the project's physical archive instruction is recorded (the same gate as archiving) — the system will not certify digital deletion while nobody has said what happens to the paper.
3. Completion then deletes, in a single all-or-nothing operation: every stored file, all extracted requirement text, evidence excerpts, defect records, BOQ lines, AI-run summaries, and the project's narrative fields. If any stored file cannot be deleted (e.g. storage is down), **no certificate is issued** and the request stays pending for retry.
4. What is _kept_, on purpose: the project's bare metadata, the retention record itself, the tamper-evident audit chain (your accountability record), and any files owned by the client's Certificate Vault (those belong to the client relationship, not the engagement).
5. The **deletion certificate** states exactly what was purged, item by item, and what was retained. It's shown in the Settings queue — that text is your formal representation to the client.

Deleting a project outright (admin, Projects) removes everything at once, with the same vault-file protection — but produces no certificate. Use the retention workflow when the client needs one.

---

## 10. Costs

Every AI call records its token usage. The project Overview shows the engagement's **estimated model cost** in naira, and admins can pull a monthly per-engagement variance report (against the ₦15–30k unit-cost assumption) from `/api/analytics/cost?month=YYYY-MM`. Rates are configurable by environment variables (`LLM_COST_INPUT_KOBO_PER_1K`, `LLM_COST_OUTPUT_KOBO_PER_1K`).

---

## 11. Security and confidentiality, briefly

- Nothing is stored without an NDA-cleared client; every access is logged; the log is tamper-evident.
- Tender documents are treated as **hostile input**: text inside a document can never change what the system does — instructions embedded in a PDF are just data on a page. This is enforced by code and continuously tested against a corpus of attack documents.
- AI output is schema-checked before it can touch the database: invented defect types are dropped, references outside the engagement are stripped, and nothing the model says becomes a finding without a human ruling.
- Admins can export a **monthly access review** (who touched which client's documents, when) from `/api/audit/access-review?month=YYYY-MM` — also available as CSV.

---

## 12. "Why is this blocked?" — cheat-sheet

| You're trying to…               | It's blocked because…                   | Fix                                                                                                            |
| ------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Upload a document               | Client NDA is `pending`                 | Set NDA status to `signed`/`not_required` on the client                                                        |
| Upload a document               | Conflict status is `blocked`/`declined` | Resolve the conflict on Overview (consent with rationale, or decline and stop)                                 |
| Move status forward             | No named reviewer                       | Assign a reviewer                                                                                              |
| Move status forward             | Payment gate unsatisfied                | Set payment to `not_required`, or `confirmed` **plus** founder + advisor confirmations by two different people |
| Confirm second payment leg      | You confirmed the first leg             | A different person must confirm the other leg                                                                  |
| Run extraction                  | No included documents                   | Set at least one document's redaction status to `included`/`redacted`                                          |
| Sign off a report               | Open fatal/likely-fatal defect          | Resolve or waive it — there is no override                                                                     |
| Export ZIP / archive            | No physical archive instruction         | Record the return/destroy instruction on Overview                                                              |
| Export ZIP                      | No signed-off report                    | Generate and sign off a report first                                                                           |
| Complete a retention request    | Archive gate fails                      | Record the physical archive instruction first                                                                  |
| Complete a retention request    | A stored file couldn't be deleted       | Retry when storage is reachable — certificates are never issued over undeleted files                           |
| Open a second retention request | One is already pending                  | Complete or wait on the existing one                                                                           |
| Save an empty edit              | No fields changed                       | Change something before saving                                                                                 |

---

## 13. Glossary

| Term                     | Meaning                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **Autopsy**              | Forensic review of a tender/bid pair to find disqualification risks                                                              |
| **Engagement / Project** | One tender/bid review for one client                                                                                             |
| **Mandatory recall**     | Share of human-confirmed mandatory requirements the AI surfaced by itself (85% is Gate-0 only; production requires at least 95%) |
| **Fatal-block rule**     | No sign-off while a confirmed fatal/likely-fatal defect is open — enforced in code                                               |
| **Readiness gate**       | The twelve-check dashboard on a project's Overview tab                                                                           |
| **SLA class**            | Turnaround commitment: standard = 5 working days, live = 48 hours                                                                |
| **Red-team window**      | Final hostile review pass in the 72 hours before the tender deadline                                                             |
| **Certificate Vault**    | A client's long-lived compliance artefacts with expiry tracking                                                                  |
| **Claimable**            | A capability claim that has both evidence and named approval                                                                     |
| **BOQ**                  | Bill of Quantities — priced schedule of works/goods, verified in exact kobo                                                      |
| **Provenance stamp**     | The engine/prompt/model/taxonomy versions recorded on every report                                                               |
| **Deletion certificate** | The formal statement of what a retention completion purged and retained                                                          |
| **Audit chain**          | The append-only, hash-linked log of every action in the system                                                                   |

---

## Appendix — for whoever operates the deployment

Not needed for day-to-day use; kept here so the knowledge isn't tribal.

- **After schema changes** (pulling new code): run `pnpm --filter @workspace/db run push` in the deploy environment.
- **Before merging model or prompt changes**, run `pnpm --filter @workspace/api-server prove:ship`. It is an offline compatibility gate only. Do not commit client/model outputs or treat it as production approval. Production requires the private evidence contract, an authorised adjudicated holdout, and the separate shadow/evaluation runner described in `docs/ai-overhaul/DEPLOYMENT_ACCEPTANCE.md`.
- **Audit chain verification**: `pnpm --filter @workspace/api-server verify:audit`.
- **CI** runs on every push/PR: secret scan, typecheck, all tests (with a throwaway database), the offline proof suites, the eval-harness gates, and both production builds. A red CI is a stop signal, not a suggestion.
- The defect taxonomy is versioned; changes go through the process in `docs/DEFECT_TAXONOMY.md`.
