import { and, eq, isNull, or } from "drizzle-orm";
import {
  currentTenantDatabaseOrganisation,
  db,
  featureFlags,
  withTenantDatabase,
} from "@workspace/db";

/** Tenant override wins over the global default; absence is always disabled. */
export async function isTenantFeatureEnabled(
  organisationId: string,
  key: string,
): Promise<boolean> {
  const lookup = async (): Promise<boolean> => {
    const rows = await db
      .select()
      .from(featureFlags)
      .where(
        and(
          eq(featureFlags.key, key),
          or(
            isNull(featureFlags.organisationId),
            eq(featureFlags.organisationId, organisationId),
          ),
        ),
      );
    const tenant = rows.find((row) => row.organisationId === organisationId);
    const global = rows.find((row) => row.organisationId === null);
    return tenant?.enabled ?? global?.enabled ?? false;
  };

  // Partner context resolution happens before the request-wide RLS
  // transaction. Give that one lookup its own short, transaction-local scope;
  // inside an existing same-tenant request this simply reuses the context.
  return currentTenantDatabaseOrganisation() === organisationId
    ? lookup()
    : withTenantDatabase(organisationId, lookup);
}

export function explicitTenantFlagValue(
  rows: ReadonlyArray<{ organisationId: string | null; enabled: boolean }>,
  organisationId: string,
): boolean {
  return (
    rows.find((row) => row.organisationId === organisationId)?.enabled === true
  );
}

/**
 * Sensitive production controls must never inherit a global default. Missing,
 * duplicate or global-only configuration is disabled for this tenant.
 */
export async function isExplicitTenantFeatureEnabled(
  organisationId: string,
  key: string,
): Promise<boolean> {
  const lookup = async (): Promise<boolean> => {
    const rows = await db
      .select({
        organisationId: featureFlags.organisationId,
        enabled: featureFlags.enabled,
      })
      .from(featureFlags)
      .where(
        and(
          eq(featureFlags.key, key),
          eq(featureFlags.organisationId, organisationId),
        ),
      );
    return rows.length === 1 && explicitTenantFlagValue(rows, organisationId);
  };

  return currentTenantDatabaseOrganisation() === organisationId
    ? lookup()
    : withTenantDatabase(organisationId, lookup);
}
