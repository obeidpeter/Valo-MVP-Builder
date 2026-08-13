/**
 * Durable first-party object deletion reconciler. Run from a scheduled
 * deployment; each invocation takes one bounded rotating tenant page.
 * It never sends a message or follows a user-supplied URL.
 */
import { assertRuntimeDatabaseSecurity, pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { APP_CONFIG_ID } from "../src/lib/appConfig";
import { runStorageDeletionReconciliation } from "../src/lib/storageLifecycle/reconciler";

const STORAGE_LIFECYCLE_RUN_LOCK = 894_721_306;
const STORAGE_LIFECYCLE_LEASE_MINUTES = 10;

async function main(): Promise<number> {
  await assertRuntimeDatabaseSecurity();
  const runOwner = randomUUID();
  const client = await pool.connect();
  let lockAcquired = false;
  let result;
  try {
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_catalog.pg_try_advisory_lock($1) AS locked",
      [STORAGE_LIFECYCLE_RUN_LOCK],
    );
    lockAcquired = lock.rows[0]?.locked === true;
    if (!lockAcquired) {
      throw new Error("storage lifecycle reconciliation is already running");
    }
    await client.query(
      "INSERT INTO app_config (id) VALUES ($1) ON CONFLICT (id) DO NOTHING",
      [APP_CONFIG_ID],
    );
    const claimed = await client.query<{ cursor: string | null }>(
      `UPDATE app_config
         SET storage_lifecycle_lease_owner = $2,
             storage_lifecycle_lease_expires_at =
               pg_catalog.clock_timestamp() + ($3 * interval '1 minute')
       WHERE id = $1
         AND (storage_lifecycle_lease_expires_at IS NULL
           OR storage_lifecycle_lease_expires_at <= pg_catalog.clock_timestamp()
           OR storage_lifecycle_lease_owner = $2)
       RETURNING storage_lifecycle_cursor_organisation_id AS cursor`,
      [APP_CONFIG_ID, runOwner, STORAGE_LIFECYCLE_LEASE_MINUTES],
    );
    if (claimed.rowCount !== 1) {
      throw new Error("storage lifecycle durable lease is already held");
    }
    result = await runStorageDeletionReconciliation(undefined, {
      afterOrganisationId: claimed.rows[0]?.cursor ?? null,
    });
    const released = await client.query(
      `UPDATE app_config
         SET storage_lifecycle_cursor_organisation_id = $3,
             storage_lifecycle_lease_owner = NULL,
             storage_lifecycle_lease_expires_at = NULL
       WHERE id = $1 AND storage_lifecycle_lease_owner = $2`,
      [APP_CONFIG_ID, runOwner, result.nextOrganisationCursor],
    );
    if (released.rowCount !== 1) {
      throw new Error("storage lifecycle cursor update was not persisted");
    }
  } finally {
    if (lockAcquired) {
      await client
        .query("SELECT pg_catalog.pg_advisory_unlock($1)", [
          STORAGE_LIFECYCLE_RUN_LOCK,
        ])
        .catch(() => {});
    }
    client.release();
  }
  if (!result) throw new Error("storage lifecycle reconciliation did not run");
  console.log(
    JSON.stringify({
      event: "valo.storage.deletion_reconciliation",
      ...result,
      signals: {
        "valo.storage.deletion_dead_letter_transitions": result.deadLetter,
        "valo.storage.deletion_oldest_sampled_age_seconds":
          result.oldestPendingAgeSeconds,
        "valo.storage.deletion_sample_complete":
          result.cycleComplete && result.tenantPagesRemaining === 0 ? 1 : 0,
      },
    }),
  );
  return result.tenantFailures > 0 || result.intentFailures > 0 ? 1 : 0;
}

main()
  .then(async (code) => {
    await pool.end();
    process.exit(code);
  })
  .catch(async (error) => {
    console.error("storage deletion reconciliation crashed:", error);
    await pool.end().catch(() => {});
    process.exit(1);
  });
