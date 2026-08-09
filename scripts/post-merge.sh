#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Database promotion is intentionally separate from source synchronisation.
# Existing push-managed databases require a verified backup and the legacy
# baseline/backfill procedure before source-controlled migrations can run.
pnpm --filter @workspace/db run migration:check
