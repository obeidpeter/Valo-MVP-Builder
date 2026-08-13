import "../test-env";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import {
  authenticatedRateLimitBuckets,
  db,
  organisations,
  withIndependentTenantDatabase,
  withTenantDatabase,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { consumeAuthenticatedRateLimit } from "./authenticatedRateLimit";

let organisationId = "";

before(async () => {
  const stamp = randomUUID();
  const [organisation] = await db
    .insert(organisations)
    .values({
      name: `Authenticated limiter integration ${stamp}`,
      slug: `authenticated-limiter-${stamp}`,
      status: "active",
      type: "client",
    })
    .returning();
  assert.ok(organisation);
  organisationId = organisation.id;
});

after(async () => {
  if (!organisationId) return;
  await db
    .delete(authenticatedRateLimitBuckets)
    .where(eq(authenticatedRateLimitBuckets.organisationId, organisationId));
  await db.delete(organisations).where(eq(organisations.id, organisationId));
});

test("a committed limiter attempt survives rollback of the business transaction", async () => {
  const bucketKeySha256 = createHash("sha256")
    .update(randomUUID(), "utf8")
    .digest("hex");
  const input = {
    bucketKeySha256,
    max: 1,
    organisationId,
    windowSeconds: 300,
  };

  await assert.rejects(
    withTenantDatabase(organisationId, async () => {
      const first = await withIndependentTenantDatabase(organisationId, () =>
        consumeAuthenticatedRateLimit(input),
      );
      assert.equal(first.allowed, true);
      assert.equal(first.remaining, 0);
      throw new Error("ROLL_BACK_AUTHORITATIVE_WORKFLOW");
    }),
    /ROLL_BACK_AUTHORITATIVE_WORKFLOW/u,
  );

  const second = await withIndependentTenantDatabase(organisationId, () =>
    consumeAuthenticatedRateLimit(input),
  );
  assert.equal(second.allowed, false);
  assert.equal(second.remaining, 0);

  const rows = await withTenantDatabase(organisationId, () =>
    db
      .select({ requestCount: authenticatedRateLimitBuckets.requestCount })
      .from(authenticatedRateLimitBuckets)
      .where(
        eq(authenticatedRateLimitBuckets.bucketKeySha256, bucketKeySha256),
      ),
  );
  assert.deepEqual(rows, [{ requestCount: 2 }]);
});
