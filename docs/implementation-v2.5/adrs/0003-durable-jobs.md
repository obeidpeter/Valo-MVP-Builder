# ADR-0003: Persistent jobs and transactional outbox

Status: Accepted target
Date: 2026-08-08

## Context

Scanning, OCR, extraction, notifications, rendering, anchoring and deletion outlive HTTP requests and must recover from provider/process failure without duplicate side effects.

## Decision

Use PostgreSQL-backed jobs/outbox first, with claim leases (`FOR UPDATE SKIP LOCKED` or equivalent), heartbeats, progress, bounded retry/backoff, dead-letter state and audited replay. Commands commit domain mutation, audit and outbox together. Consumers and provider calls use stable idempotency keys. A managed queue may replace transport behind an adapter when scale evidence justifies it.

## Consequences

At-least-once delivery is normal; consumers must be idempotent. Queue/tenant fairness, lease recovery, provider reconciliation and operator tooling become required. Database load is monitored before changing transport.

## Rejected

In-memory queues; fire-and-forget promises; unbounded automatic retries; premature external event platform.
