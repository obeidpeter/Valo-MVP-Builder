import pg from "pg";

const { Pool } = pg;
const LOCK_NAMESPACE = 1_987_650_632;

/**
 * Shared skeleton for single-flight production maintenance scripts.
 *
 * Reproduces the exact session shape both purge scripts have always used:
 * dedicated single-connection pool -> optional identity attestation ->
 * pg_try_advisory_lock -> BEGIN -> four SET LOCAL statements -> work ->
 * COMMIT (ROLLBACK on failure) -> advisory unlock -> connection cleanup.
 * Observability signal names stay inside each per-script file so
 * verify-operational-controls can map every emitted signal to its checked-in
 * producer.
 */
export async function withMaintenanceSession(
  {
    applicationName,
    connectionString,
    lockKey,
    pool,
    alreadyRunningError,
    attest,
  },
  work,
) {
  const sessionPool =
    pool ??
    new Pool({
      application_name: applicationName,
      connectionString,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 1_000,
      max: 1,
    });
  const ownsPool = pool === undefined;
  const client = await sessionPool.connect();
  let locked = false;
  try {
    if (attest) await attest(client);
    const lock = await client.query(
      "SELECT pg_catalog.pg_try_advisory_lock($1, $2) AS locked",
      [LOCK_NAMESPACE, lockKey],
    );
    locked = lock.rows[0]?.locked === true;
    if (!locked) throw new Error(alreadyRunningError);

    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL search_path = pg_catalog");
      await client.query("SET LOCAL TIME ZONE 'UTC'");
      await client.query("SET LOCAL statement_timeout = '240s'");
      await client.query("SET LOCAL lock_timeout = '10s'");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    if (locked) {
      await client
        .query("SELECT pg_catalog.pg_advisory_unlock($1, $2)", [
          LOCK_NAMESPACE,
          lockKey,
        ])
        .catch(() => undefined);
    }
    client.release();
    if (ownsPool) await sessionPool.end().catch(() => undefined);
  }
}

/**
 * Shared CLI wrapper: prints the run's JSON evidence on success; on failure
 * prints the bounded error code (never a raw message), the per-script failure
 * event and failure signals, and sets a non-zero exit code.
 */
export async function runMaintenanceCli({
  run,
  errorCodePattern,
  fallbackCode,
  failureEvent,
  failureSignals,
}) {
  try {
    console.log(JSON.stringify(await run()));
  } catch (error) {
    console.error(
      JSON.stringify({
        error:
          error instanceof Error && errorCodePattern.test(error.message)
            ? error.message
            : fallbackCode,
        event: failureEvent,
        signals: failureSignals,
      }),
    );
    process.exitCode = 1;
  }
}
