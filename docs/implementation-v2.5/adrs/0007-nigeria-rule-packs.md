# ADR-0007: Versioned Nigeria and tender rule packs

Status: Accepted target; initial packs require legal approval
Date: 2026-08-08

## Context

Privacy, procurement, tax, bid-security, certificate, calendar and tender rules change. Supplied documents contain version discrepancies and working assumptions; tax law changed through the Nigeria Tax Act 2025 transition effective 2026-01-01.

## Decision

Represent changeable rules as signed, effective-dated packs with authoritative source URLs/document hashes, applicability/precedence, deterministic tests, preparer, Nigerian legal reviewer and product approval. Tender-specific instructions are signed overlays. Historical results retain the selected version. Ambiguity produces `needs_legal_review`, never a guessed calculation. Sources and governance are defined in `SECURITY_PRIVACY.md`.

## Consequences

Legal/product operations own a regulatory watch and pack promotion/rollback process. The application must expose the rule version in BOQ/findings/packages. Correcting an old pack is a new version with impact analysis, not silent mutation.

## Rejected

Hard-coded VAT/threshold/certificate/retention constants; Business Plan appendices as legal authority; fetching live web values during a package calculation; one global pack for every tender.
