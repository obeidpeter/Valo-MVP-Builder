import type pg from "pg";

type RuntimeEnvironment = Record<string, string | undefined>;

export function isProductionRuntime(environment: RuntimeEnvironment): boolean {
  if (
    environment.REPLIT_DEPLOYMENT === "1" &&
    environment.NODE_ENV !== "production"
  ) {
    throw new Error(
      "Replit deployments require NODE_ENV=production before database startup",
    );
  }
  return (
    environment.NODE_ENV === "production" ||
    environment.REPLIT_DEPLOYMENT === "1"
  );
}

export function selectDatabaseConnectionString(
  environment: RuntimeEnvironment,
): string {
  const ownerUrl = environment.DATABASE_URL?.trim();
  if (!isProductionRuntime(environment)) {
    if (!ownerUrl) throw new Error("DATABASE_URL must be set");
    return ownerUrl;
  }

  const runtimeUrl = environment.VALO_RUNTIME_DATABASE_URL?.trim();
  if (!runtimeUrl) {
    throw new Error(
      "VALO_RUNTIME_DATABASE_URL is required in production; DATABASE_URL is migration-owner only",
    );
  }
  if (ownerUrl && runtimeUrl === ownerUrl) {
    throw new Error(
      "VALO_RUNTIME_DATABASE_URL must not reuse the migration-owner DATABASE_URL",
    );
  }
  if (!ownerUrl) {
    throw new Error(
      "DATABASE_URL is required in production for runtime-target attestation",
    );
  }
  let ownerTarget: URL;
  let runtimeTarget: URL;
  try {
    ownerTarget = new URL(ownerUrl);
    runtimeTarget = new URL(runtimeUrl);
  } catch {
    throw new Error("production database URL is malformed");
  }
  if (
    !["postgres:", "postgresql:"].includes(ownerTarget.protocol) ||
    !["postgres:", "postgresql:"].includes(runtimeTarget.protocol)
  ) {
    throw new Error("production database URL must use the PostgreSQL protocol");
  }
  if (ownerTarget.hash || runtimeTarget.hash) {
    throw new Error("production database URL must not contain a fragment");
  }
  for (const candidate of [ownerTarget, runtimeTarget]) {
    for (const key of ["user", "username", "password"]) {
      if (candidate.searchParams.has(key)) {
        throw new Error(
          "production database credentials must be carried only in URL userinfo",
        );
      }
    }
  }
  ownerTarget.username = "";
  ownerTarget.password = "";
  runtimeTarget.username = "";
  runtimeTarget.password = "";
  if (ownerTarget.href !== runtimeTarget.href) {
    throw new Error(
      "VALO_RUNTIME_DATABASE_URL must preserve the managed target and TLS parameters",
    );
  }
  return runtimeUrl;
}

/** Fail before listen if the production pool can bypass tenant enforcement. */
export async function assertProductionRuntimeDatabaseSafety(
  pool: pg.Pool,
  environment: RuntimeEnvironment,
): Promise<void> {
  if (!isProductionRuntime(environment)) return;

  const client = await pool.connect();
  try {
    const result = await client.query<{
      role_name: string;
      session_role_name: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcanlogin: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
      rolreplication: boolean;
      inherited_memberships: string;
      owned_public_relations: string;
      forced_rls_tables: string;
      policies: string;
      can_mutate_active_audit: boolean;
      can_insert_active_audit: boolean;
      can_insert_audit_ordinal: boolean;
      can_select_active_audit: boolean;
      can_select_legacy_events: boolean;
      can_select_legacy_assessment: boolean;
      can_mutate_legacy_events: boolean;
      can_mutate_legacy_assessment: boolean;
      can_create_public_objects: boolean;
      can_set_audit_ordinal: boolean;
    }>(`
      SELECT
        current_user AS role_name,
        session_user AS session_role_name,
        role.rolsuper,
        role.rolbypassrls,
        role.rolcanlogin,
        role.rolcreaterole,
        role.rolcreatedb,
        role.rolreplication,
        (SELECT count(*)::text FROM pg_catalog.pg_auth_members membership
         WHERE membership.member=role.oid) AS inherited_memberships,
        (SELECT count(*)::text FROM pg_catalog.pg_class owned
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid=owned.relnamespace
         WHERE namespace.nspname='public' AND owned.relowner=role.oid)
          AS owned_public_relations,
        (SELECT count(*)::text
         FROM pg_catalog.pg_class relation
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
         WHERE namespace.nspname='public' AND relation.relrowsecurity
           AND relation.relforcerowsecurity) AS forced_rls_tables,
        (SELECT count(*)::text FROM pg_catalog.pg_policies WHERE schemaname='public') AS policies,
        (pg_catalog.has_table_privilege(current_user, 'public.audit_events', 'UPDATE')
          OR pg_catalog.has_table_privilege(current_user, 'public.audit_events', 'DELETE'))
          AS can_mutate_active_audit,
        NOT EXISTS (
          SELECT 1
          FROM pg_catalog.unnest(ARRAY[
            'id','organisation_id','user_id','user_name','project_id','event_type',
            'object_type','object_id','details','seq','prev_hash','hash',
            'hash_version','created_at'
          ]) AS required_columns(column_name)
          WHERE NOT pg_catalog.has_column_privilege(
            current_user, 'public.audit_events', column_name, 'INSERT'
          )
        ) AS can_insert_active_audit,
        pg_catalog.has_column_privilege(
          current_user, 'public.audit_events', 'row_no', 'INSERT'
        ) AS can_insert_audit_ordinal,
        pg_catalog.has_table_privilege(current_user, 'public.audit_events', 'SELECT')
          AS can_select_active_audit,
        pg_catalog.has_table_privilege(current_user, 'public.legacy_audit_events', 'SELECT')
          AS can_select_legacy_events,
        pg_catalog.has_table_privilege(current_user, 'public.legacy_audit_integrity_assessments', 'SELECT')
          AS can_select_legacy_assessment,
        (pg_catalog.has_table_privilege(current_user, 'public.legacy_audit_events', 'INSERT')
          OR pg_catalog.has_table_privilege(current_user, 'public.legacy_audit_events', 'UPDATE')
          OR pg_catalog.has_table_privilege(current_user, 'public.legacy_audit_events', 'DELETE'))
          AS can_mutate_legacy_events,
        (pg_catalog.has_table_privilege(current_user, 'public.legacy_audit_integrity_assessments', 'INSERT')
          OR pg_catalog.has_table_privilege(current_user, 'public.legacy_audit_integrity_assessments', 'UPDATE')
          OR pg_catalog.has_table_privilege(current_user, 'public.legacy_audit_integrity_assessments', 'DELETE'))
          AS can_mutate_legacy_assessment,
        pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE')
          AS can_create_public_objects,
        pg_catalog.has_sequence_privilege(
          current_user, 'public.audit_events_row_no_seq', 'UPDATE'
        ) AS can_set_audit_ordinal
      FROM pg_catalog.pg_roles role
      WHERE role.rolname=current_user
    `);
    const proof = result.rows[0];
    if (
      !proof ||
      proof.role_name !== "valo_app_runtime" ||
      proof.session_role_name !== "valo_app_runtime"
    ) {
      throw new Error(
        "production database must authenticate as valo_app_runtime",
      );
    }
    if (
      proof.rolsuper ||
      proof.rolbypassrls ||
      !proof.rolcanlogin ||
      proof.rolcreaterole ||
      proof.rolcreatedb ||
      proof.rolreplication ||
      Number(proof.inherited_memberships) !== 0 ||
      Number(proof.owned_public_relations) !== 0
    ) {
      throw new Error(
        "production database role must be NOSUPERUSER NOBYPASSRLS",
      );
    }
    if (
      Number(proof.forced_rls_tables) !== 85 ||
      Number(proof.policies) !== 104
    ) {
      throw new Error(
        "production database RLS catalog is not the v2.5 boundary (85/104)",
      );
    }
    if (
      !proof.can_insert_active_audit ||
      proof.can_insert_audit_ordinal ||
      !proof.can_select_active_audit ||
      !proof.can_select_legacy_events ||
      !proof.can_select_legacy_assessment ||
      proof.can_mutate_active_audit ||
      proof.can_mutate_legacy_events ||
      proof.can_mutate_legacy_assessment ||
      proof.can_create_public_objects ||
      proof.can_set_audit_ordinal
    ) {
      throw new Error(
        "production runtime has forbidden audit mutation privileges",
      );
    }
  } finally {
    client.release();
  }
}
