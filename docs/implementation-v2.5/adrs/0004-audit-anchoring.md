# ADR-0004: Externally anchored audit checkpoints

Status: Accepted target; provider selection pending
Date: 2026-08-08

## Context

The repository has a useful hash chain, but an attacker with database/application control could rewrite records and recompute the chain.

## Decision

Keep append-only sequenced event hashes, then periodically compute/sign a checkpoint root and write it to an independent immutable/WORM destination with retention lock or equivalent witness. Store anchor receipt, provider/object version and reconciliation state. Alert on sequence/hash/anchor freshness/divergence. Restore validates against the external anchor.

## Consequences

Tampering becomes independently detectable; an anchor provider/retention/cost/region decision and key-custody runbook are needed. Event payloads remain minimised; anchors contain digests, not client content.

## Rejected

Local hash chain alone; mutable backup bucket; public blockchain by default (privacy/cost/complexity without need).
