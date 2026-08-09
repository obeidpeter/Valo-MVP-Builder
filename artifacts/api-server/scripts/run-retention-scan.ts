/**
 * Retention automation scheduler entrypoint (Task: Retention automation
 * scheduler). Runs one retention scan and exits — designed to be invoked by a
 * Replit Scheduled Deployment (this app deploys to autoscale, which scales to
 * zero, so an in-process interval would be unreliable; a cron-style scheduled
 * job is the correct mechanism).
 *
 * It opens retention requests for concluded engagements whose retention window
 * has elapsed. It NEVER purges data — a named admin completes each request
 * through the existing manual flow (archive gate + deletion certificate).
 *
 * Usage: pnpm --filter @workspace/api-server run retention:scan
 * Production requires DATABASE_URL only for target attestation plus the
 * constrained VALO_RUNTIME_DATABASE_URL used by the pool.
 */
import { assertRuntimeDatabaseSecurity, pool } from "@workspace/db";
import { runRetentionScan } from "../src/lib/retentionScan";

async function main(): Promise<number> {
  await assertRuntimeDatabaseSecurity();
  const result = await runRetentionScan();
  console.log(
    `Retention scan: ${result.scanned} concluded engagement(s) considered, ` +
      `${result.opened.length} request(s) opened, ` +
      `${result.skippedExisting} skipped (already open).`,
  );
  for (const candidate of result.opened) {
    console.log(
      `  opened retention request for project ${candidate.projectId} ` +
        `(window elapsed ${candidate.dueAt.toISOString()})`,
    );
  }
  return 0;
}

main()
  .then(async (code) => {
    await pool.end();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error("retention scan crashed:", err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
