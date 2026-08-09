# ADR-0005: Provider-neutral adapters and fail-closed environments

Status: Accepted
Date: 2026-08-08

## Context

Identity, storage, scanning, OCR, models, messaging, payment and licensed feeds carry privacy, outage and lock-in risk. Missing paid providers must not be presented as production complete.

## Decision

Define typed internal adapters with normalised errors, timeouts, retry-safety, idempotency, reconciliation, health and data-governance metadata. Select implementations by validated server configuration. Development/fake adapters identify themselves and abort startup in staging/production. Fallback occurs only when its residency/terms and evaluation gates satisfy the tenant policy.

## Consequences

Contract suites are required for each adapter. Some provider-specific capability remains explicit rather than hidden by a lowest-common-denominator interface. Production readiness includes provider terms, secrets, webhook and outage evidence.

## Rejected

Direct provider calls throughout routes; silent no-op adapters; fallback to an unapproved model/region.
