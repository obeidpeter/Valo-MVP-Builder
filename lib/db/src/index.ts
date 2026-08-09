import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const rootDb = drizzle(pool, { schema });
type WorkspaceDatabase = typeof rootDb;

const tenantDatabaseContext = new AsyncLocalStorage<{
  organisationId: string;
  database: WorkspaceDatabase;
}>();

/**
 * Existing route modules import one `db` object. The proxy routes their calls
 * to the request's transaction-scoped database when present, allowing RLS to
 * use SET LOCAL without leaking context through the connection pool.
 */
export const db = new Proxy(rootDb, {
  get(target, property) {
    const active = tenantDatabaseContext.getStore()?.database ?? target;
    const value = Reflect.get(active, property, active) as unknown;
    return typeof value === "function" ? value.bind(active) : value;
  },
}) as WorkspaceDatabase;

const ORGANISATION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Runs one complete tenant request inside a transaction and sets the RLS
 * tenant key transaction-locally. Nested Drizzle transactions become
 * savepoints on the same pooled client; context is cleared automatically when
 * the callback and transaction end.
 */
export async function withTenantDatabase<T>(
  organisationId: string,
  callback: () => Promise<T>,
): Promise<T> {
  if (!ORGANISATION_ID.test(organisationId)) {
    throw new Error("Invalid organisation database context");
  }
  const active = tenantDatabaseContext.getStore();
  if (active) {
    if (active.organisationId !== organisationId) {
      throw new Error("Cross-tenant database context nesting is prohibited");
    }
    return callback();
  }
  return rootDb.transaction(
    async (transaction) => {
      await transaction.execute(
        sql`SELECT valo_security.set_current_organisation_id(${organisationId}::uuid)`,
      );
      return tenantDatabaseContext.run(
        {
          organisationId,
          database: transaction as unknown as WorkspaceDatabase,
        },
        callback,
      );
    },
    { isolationLevel: "read committed" },
  );
}

export function currentTenantDatabaseOrganisation(): string | undefined {
  return tenantDatabaseContext.getStore()?.organisationId;
}

export * from "./schema";
// Query helpers used by the dependency-light operational scripts package.
export { eq } from "drizzle-orm";
