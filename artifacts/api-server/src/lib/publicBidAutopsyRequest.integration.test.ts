import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, describe, test } from "node:test";
import { pool } from "@workspace/db";
import {
  consumeBidAutopsyRateLimit,
  storeBidAutopsyRequest,
  type NormalizedBidAutopsyRequest,
} from "./publicBidAutopsyRequest";

const insertedIds = new Set<string>();
const rateLimitKeys = new Set<string>();
const request: NormalizedBidAutopsyRequest = {
  contactName: "Ada Okafor",
  companyName: "Northstar Services Ltd",
  businessEmail: "ada@northstar.example",
  businessTelephone: "+234 803 123 4567",
  tenderCategory: "federal_public",
  bidStage: "live",
  tenderDeadline: "2026-08-25",
  preferredContactMethod: "email",
};

after(async () => {
  if (insertedIds.size > 0) {
    await pool.query(
      "DELETE FROM valo_intake.bid_autopsy_requests WHERE id = ANY($1::uuid[])",
      [[...insertedIds]],
    );
  }
  if (rateLimitKeys.size > 0) {
    await pool.query(
      "DELETE FROM valo_intake.bid_autopsy_rate_limits WHERE client_key_hash = ANY($1::text[])",
      [[...rateLimitKeys]],
    );
  }
});

describe("database-backed public Bid Autopsy idempotency", () => {
  test("stores an identical retry exactly once and returns the original receipt", async () => {
    const key = randomUUID();
    const first = await storeBidAutopsyRequest(key, request, 30);
    insertedIds.add(first.requestId);
    const replay = await storeBidAutopsyRequest(key, request, 30);

    assert.equal(first.replayed, false);
    assert.equal(first.payloadMatches, true);
    assert.equal(replay.replayed, true);
    assert.equal(replay.payloadMatches, true);
    assert.equal(replay.requestId, first.requestId);
    assert.equal(
      replay.acceptedAt.toISOString(),
      first.acceptedAt.toISOString(),
    );

    const count = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM valo_intake.bid_autopsy_requests WHERE id=$1::uuid",
      [first.requestId],
    );
    assert.equal(count.rows[0]?.count, "1");
  });

  test("does not overwrite a stored request when the key is reused for another payload", async () => {
    const key = randomUUID();
    const first = await storeBidAutopsyRequest(key, request, 30);
    insertedIds.add(first.requestId);
    const conflict = await storeBidAutopsyRequest(
      key,
      {
        ...request,
        companyName: "Another Company Ltd",
      },
      30,
    );

    assert.equal(conflict.replayed, true);
    assert.equal(conflict.payloadMatches, false);
    assert.equal(conflict.requestId, first.requestId);
    const stored = await pool.query<{ company_name: string }>(
      "SELECT company_name FROM valo_intake.bid_autopsy_requests WHERE id=$1::uuid",
      [first.requestId],
    );
    assert.equal(stored.rows[0]?.company_name, request.companyName);
  });

  test("stores the explicit retention deadline and purges only after it expires", async () => {
    const first = await storeBidAutopsyRequest(randomUUID(), request, 30);
    insertedIds.add(first.requestId);
    const stored = await pool.query<{
      retained_days: string;
    }>(
      `SELECT extract(epoch FROM (retention_until - received_at)) / 86400 AS retained_days
       FROM valo_intake.bid_autopsy_requests WHERE id=$1::uuid`,
      [first.requestId],
    );
    assert.equal(Number(stored.rows[0]?.retained_days), 30);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE valo_intake.bid_autopsy_requests
         SET received_at=clock_timestamp() - interval '2 days',
             retention_until=clock_timestamp() - interval '1 day'
         WHERE id=$1::uuid`,
        [first.requestId],
      );
      const purged = await client.query<{ purged: number }>(
        "SELECT valo_intake.purge_expired_bid_autopsy_requests() AS purged",
      );
      assert.ok(Number(purged.rows[0]?.purged) >= 1);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });
});

describe("database-backed public Bid Autopsy rate limiting", () => {
  test("shares one capped fixed-window bucket", async () => {
    const key = createHash("sha256").update(randomUUID()).digest("hex");
    rateLimitKeys.add(key);
    const first = await consumeBidAutopsyRateLimit(key, 60, 2);
    const second = await consumeBidAutopsyRateLimit(key, 60, 2);
    const limited = await consumeBidAutopsyRateLimit(key, 60, 2);

    assert.deepEqual(
      [first.allowed, second.allowed, limited.allowed],
      [true, true, false],
    );
    assert.deepEqual(
      [first.remaining, second.remaining, limited.remaining],
      [1, 0, 0],
    );
    assert.equal(second.resetAt.toISOString(), first.resetAt.toISOString());
    assert.equal(limited.resetAt.toISOString(), first.resetAt.toISOString());
  });
});
