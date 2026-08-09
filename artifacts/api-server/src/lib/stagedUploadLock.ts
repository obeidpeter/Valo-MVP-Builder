import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// A separate hash domain avoids accidental overlap with project-scoped locks.
const STAGED_UPLOAD_LOCK_DOMAIN = 29_052;

/**
 * Serialize registration and discard for one staged object. Tenant API
 * requests already run inside a request-long PostgreSQL transaction, so this
 * transaction-scoped advisory lock remains held through the response commit.
 * Every path that either references or deletes a staged object must acquire
 * this exact lock before its final existence/reference check.
 */
export async function lockStagedUploadObject(
  objectPath: string,
): Promise<void> {
  await db.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${objectPath}, ${STAGED_UPLOAD_LOCK_DOMAIN}))`,
  );
}
