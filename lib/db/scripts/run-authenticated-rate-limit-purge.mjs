import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Pool } = pg;
const LOCK_NAMESPACE = 1_987_650_632;
const LOCK_KEY = 7_105;
const MAX_PURGE_ROWS = 1_000;
const ROLE = /^[a-z][a-z0-9_]{2,62}$/u;
const EXPECTED_PURGE_SOURCE_SHA256 =
  "beeae6ab916be432aa0749085de35145912e9fd0d8277d186485f20c09c625bf";

function normalizedSourceSha256(source) {
  return createHash("sha256")
    .update(String(source).replaceAll("\r\n", "\n").trim())
    .digest("hex");
}

export function authenticatedRateLimitPurgeConfiguration(environment) {
  if (environment.NODE_ENV !== "production") {
    throw new Error("AUTH_RATE_LIMIT_PURGE_NOT_PRODUCTION");
  }
  if (environment.VALO_AUTH_RATE_LIMIT_MAINTENANCE_EXECUTE !== "confirmed") {
    throw new Error("AUTH_RATE_LIMIT_PURGE_CONFIRMATION_REQUIRED");
  }
  const connectionString = environment.VALO_MAINTENANCE_DATABASE_URL?.trim();
  const expectedOwnerRole =
    environment.VALO_MAINTENANCE_DATABASE_OWNER_ROLE?.trim();
  if (!connectionString) {
    throw new Error("AUTH_RATE_LIMIT_PURGE_DATABASE_REQUIRED");
  }
  if (!expectedOwnerRole || !ROLE.test(expectedOwnerRole)) {
    throw new Error("AUTH_RATE_LIMIT_PURGE_OWNER_ROLE_REQUIRED");
  }
  if (expectedOwnerRole === "valo_app_runtime") {
    throw new Error("AUTH_RATE_LIMIT_PURGE_RUNTIME_ROLE_PROHIBITED");
  }
  return { connectionString, expectedOwnerRole };
}

export async function runAuthenticatedRateLimitPurge(options = {}) {
  const environment = options.environment ?? process.env;
  const { connectionString, expectedOwnerRole } =
    authenticatedRateLimitPurgeConfiguration(environment);
  const pool =
    options.pool ??
    new Pool({
      application_name: "valo-authenticated-rate-limit-purge",
      connectionString,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 1_000,
      max: 1,
    });
  const ownsPool = options.pool === undefined;
  const client = await pool.connect();
  let locked = false;
  try {
    const identity = await client.query(
      `SELECT current_user AS current_user,
              session_user AS session_user,
              role.rolsuper,
              role.rolbypassrls,
              pg_catalog.has_function_privilege(
                current_user,
                'valo_security.purge_expired_authenticated_rate_limit_buckets()',
                'EXECUTE'
              ) AS can_execute,
              COALESCE((
                SELECT pg_catalog.has_function_privilege(
                  runtime_role.oid,
                  'valo_security.purge_expired_authenticated_rate_limit_buckets()',
                  'EXECUTE'
                )
                FROM pg_catalog.pg_roles runtime_role
                WHERE runtime_role.rolname = 'valo_app_runtime'
              ), false) AS runtime_can_execute,
              (
                SELECT pg_catalog.pg_get_userbyid(procedure.proowner)
                FROM pg_catalog.pg_proc procedure
                WHERE procedure.oid =
                  'valo_security.purge_expired_authenticated_rate_limit_buckets()'::pg_catalog.regprocedure
              ) AS function_owner,
              (
                SELECT language.lanname = 'plpgsql'
                  AND procedure.prokind = 'f'
                  AND NOT procedure.prosecdef
                  AND NOT procedure.proleakproof
                  AND NOT procedure.proisstrict
                  AND procedure.provolatile = 'v'
                  AND procedure.proparallel = 'u'
                  AND COALESCE(
                    pg_catalog.array_to_string(procedure.proconfig, ','), ''
                  ) = 'search_path=pg_catalog'
                  AND procedure.pronargs = 0
                  AND pg_catalog.pg_get_function_identity_arguments(
                    procedure.oid
                  ) = ''
                  AND pg_catalog.format_type(procedure.prorettype, NULL) = 'bigint'
                  AND pg_catalog.pg_get_function_result(procedure.oid) = 'bigint'
                  AND NOT procedure.proretset
                FROM pg_catalog.pg_proc procedure
                JOIN pg_catalog.pg_language language
                  ON language.oid = procedure.prolang
                WHERE procedure.oid =
                  'valo_security.purge_expired_authenticated_rate_limit_buckets()'::pg_catalog.regprocedure
              ) AS function_contract_valid,
              (
                SELECT procedure.prosrc
                FROM pg_catalog.pg_proc procedure
                WHERE procedure.oid =
                  'valo_security.purge_expired_authenticated_rate_limit_buckets()'::pg_catalog.regprocedure
              ) AS function_source,
              (
                SELECT pg_catalog.pg_get_userbyid(relation.relowner)
                FROM pg_catalog.pg_class relation
                JOIN pg_catalog.pg_namespace namespace
                  ON namespace.oid = relation.relnamespace
                WHERE namespace.nspname = 'public'
                  AND relation.relname = 'authenticated_rate_limit_buckets'
              ) AS table_owner,
              (
                SELECT pg_catalog.pg_get_userbyid(relation.relowner)
                FROM pg_catalog.pg_class relation
                JOIN pg_catalog.pg_namespace namespace
                  ON namespace.oid = relation.relnamespace
                WHERE namespace.nspname = 'valo_security'
                  AND relation.relname = 'authenticated_actor_rate_limit_buckets'
              ) AS actor_table_owner,
              COALESCE((
                SELECT bool_or(
                  pg_catalog.has_table_privilege(
                    runtime_role.oid,
                    relation.oid,
                    privilege.name
                  )
                )
                FROM pg_catalog.pg_roles runtime_role
                CROSS JOIN pg_catalog.pg_class relation
                JOIN pg_catalog.pg_namespace namespace
                  ON namespace.oid = relation.relnamespace
                CROSS JOIN (
                  VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                    ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
                ) AS privilege(name)
                WHERE runtime_role.rolname = 'valo_app_runtime'
                  AND namespace.nspname = 'valo_security'
                  AND relation.relname = 'authenticated_actor_rate_limit_buckets'
              ), false) AS runtime_can_access_actor_table,
              EXISTS (
                SELECT 1
                FROM pg_catalog.pg_class relation
                JOIN pg_catalog.pg_namespace namespace
                  ON namespace.oid = relation.relnamespace
                CROSS JOIN LATERAL pg_catalog.aclexplode(
                  COALESCE(
                    relation.relacl,
                    pg_catalog.acldefault('r', relation.relowner)
                  )
                ) AS table_acl
                WHERE namespace.nspname = 'valo_security'
                  AND relation.relname = 'authenticated_actor_rate_limit_buckets'
                  AND table_acl.grantee = 0
              ) AS public_can_access_actor_table
       FROM pg_catalog.pg_roles role
       WHERE role.rolname = current_user`,
    );
    const proof = identity.rows[0];
    if (
      identity.rowCount !== 1 ||
      proof?.current_user !== expectedOwnerRole ||
      proof?.session_user !== expectedOwnerRole ||
      proof?.function_owner !== expectedOwnerRole ||
      proof?.table_owner !== expectedOwnerRole ||
      proof?.actor_table_owner !== expectedOwnerRole ||
      proof?.function_contract_valid !== true ||
      normalizedSourceSha256(proof?.function_source) !==
        EXPECTED_PURGE_SOURCE_SHA256 ||
      proof?.can_execute !== true ||
      proof?.runtime_can_execute !== false ||
      proof?.runtime_can_access_actor_table !== false ||
      proof?.public_can_access_actor_table !== false ||
      (proof?.rolsuper !== true && proof?.rolbypassrls !== true)
    ) {
      throw new Error("AUTH_RATE_LIMIT_PURGE_IDENTITY_ATTESTATION_FAILED");
    }
    const lock = await client.query(
      "SELECT pg_catalog.pg_try_advisory_lock($1, $2) AS locked",
      [LOCK_NAMESPACE, LOCK_KEY],
    );
    locked = lock.rows[0]?.locked === true;
    if (!locked) throw new Error("AUTH_RATE_LIMIT_PURGE_ALREADY_RUNNING");

    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL search_path = pg_catalog");
      await client.query("SET LOCAL TIME ZONE 'UTC'");
      await client.query("SET LOCAL statement_timeout = '240s'");
      await client.query("SET LOCAL lock_timeout = '10s'");
      const clock = await client.query(
        "SELECT pg_catalog.clock_timestamp() AS cutoff",
      );
      const cutoff = clock.rows[0]?.cutoff;
      if (!(cutoff instanceof Date) || Number.isNaN(cutoff.valueOf())) {
        throw new Error("AUTH_RATE_LIMIT_PURGE_DATABASE_CLOCK_INVALID");
      }
      const purged = await client.query(
        `SELECT valo_security.purge_expired_authenticated_rate_limit_buckets()
           AS purged`,
      );
      const purgedRows = Number(purged.rows[0]?.purged);
      if (
        !Number.isSafeInteger(purgedRows) ||
        purgedRows < 0 ||
        purgedRows > MAX_PURGE_ROWS
      ) {
        throw new Error("AUTH_RATE_LIMIT_PURGE_RESULT_INVALID");
      }
      const backlog = await client.query(
        `SELECT
           EXISTS (
             SELECT 1
             FROM public.authenticated_rate_limit_buckets bucket
             WHERE bucket.expires_at <= $1::timestamptz
             LIMIT 1
           ) OR EXISTS (
             SELECT 1
             FROM valo_security.authenticated_actor_rate_limit_buckets bucket
             WHERE bucket.expires_at <= $1::timestamptz
             LIMIT 1
           ) AS exists`,
        [cutoff],
      );
      if (
        backlog.rowCount !== 1 ||
        typeof backlog.rows[0]?.exists !== "boolean"
      ) {
        throw new Error("AUTH_RATE_LIMIT_PURGE_BACKLOG_PROOF_INVALID");
      }
      await client.query("COMMIT");
      const cycleComplete = backlog.rows[0].exists === false;
      const completedAtUnixSeconds = Math.floor(cutoff.valueOf() / 1_000);
      return {
        cycleComplete,
        event: "valo.authenticated_rate_limit.expiry_purge",
        purgedRows,
        signals: {
          "valo.authenticated_rate_limit.purge_cycle_complete": cycleComplete
            ? 1
            : 0,
          "valo.authenticated_rate_limit.purge_run_success": 1,
          "valo.authenticated_rate_limit.purge_last_success_unixtime_seconds":
            completedAtUnixSeconds,
          ...(cycleComplete
            ? {
                "valo.authenticated_rate_limit.purge_last_full_cycle_unixtime_seconds":
                  completedAtUnixSeconds,
              }
            : {}),
        },
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    if (locked) {
      await client
        .query("SELECT pg_catalog.pg_advisory_unlock($1, $2)", [
          LOCK_NAMESPACE,
          LOCK_KEY,
        ])
        .catch(() => undefined);
    }
    client.release();
    if (ownsPool) await pool.end().catch(() => undefined);
  }
}

async function main() {
  try {
    console.log(JSON.stringify(await runAuthenticatedRateLimitPurge()));
  } catch (error) {
    console.error(
      JSON.stringify({
        error:
          error instanceof Error &&
          /^AUTH_RATE_LIMIT_PURGE_[A-Z_]+$/u.test(error.message)
            ? error.message
            : "AUTH_RATE_LIMIT_PURGE_OPERATION_FAILED",
        event: "valo.authenticated_rate_limit.expiry_purge_failed",
        signals: {
          "valo.authenticated_rate_limit.purge_run_success": 0,
        },
      }),
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await main();
}
