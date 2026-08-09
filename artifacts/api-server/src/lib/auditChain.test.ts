import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  AUDIT_GENESIS_HASH,
  canonicalAuditPayload,
  computeAuditHash,
  verifyAuditChain,
  type AuditChainPayload,
  type AuditChainRow,
} from "./auditChain";

/** Build a valid chain of n events, the way `writeAudit` does. */
function buildChain(n: number): AuditChainRow[] {
  const rows: AuditChainRow[] = [];
  let prevHash = AUDIT_GENESIS_HASH;
  for (let seq = 1; seq <= n; seq++) {
    const payload: AuditChainPayload = {
      seq,
      organisationId: "org-1",
      userId: seq % 2 === 0 ? "u-2" : "u-1",
      userName: "Reviewer",
      projectId: "p-1",
      eventType: `event.${seq}`,
      objectType: "report",
      objectId: `obj-${seq}`,
      details: seq === 2 ? null : `details ${seq}`,
      createdAt: new Date(1700000000000 + seq * 1000).toISOString(),
    };
    const hash = computeAuditHash(prevHash, payload);
    rows.push({ ...payload, prevHash, hash });
    prevHash = hash;
  }
  return rows;
}

describe("auditChain - canonical payload", () => {
  test("is a fixed-order JSON array, immune to object key order", () => {
    const payload: AuditChainPayload = {
      seq: 1,
      organisationId: "org-1",
      userId: "u",
      userName: null,
      projectId: null,
      eventType: "e",
      objectType: null,
      objectId: null,
      details: "d",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    assert.equal(
      canonicalAuditPayload(payload),
      '[1,"org-1","u",null,null,"e",null,null,"d","2026-01-01T00:00:00.000Z"]',
    );
  });

  test("JSON encoding defeats delimiter injection between fields", () => {
    // Craft two payloads whose fields would collide under naive "|" joining.
    const a: AuditChainPayload = {
      seq: 1,
      organisationId: "org-1",
      userId: null,
      userName: null,
      projectId: null,
      eventType: 'x","y',
      objectType: null,
      objectId: null,
      details: null,
      createdAt: "t",
    };
    const b: AuditChainPayload = {
      seq: 1,
      organisationId: "org-1",
      userId: null,
      userName: null,
      projectId: null,
      eventType: "x",
      objectType: '"y',
      objectId: null,
      details: null,
      createdAt: "t",
    };
    assert.notEqual(
      computeAuditHash(AUDIT_GENESIS_HASH, a),
      computeAuditHash(AUDIT_GENESIS_HASH, b),
    );
  });
});

describe("auditChain - verifyAuditChain", () => {
  test("an empty chain is intact", () => {
    const r = verifyAuditChain([]);
    assert.equal(r.ok, true);
    assert.equal(r.checked, 0);
  });

  test("a well-formed chain verifies end to end", () => {
    const r = verifyAuditChain(buildChain(25));
    assert.equal(r.ok, true);
    assert.equal(r.checked, 25);
  });

  test("verification is order-independent (rows may arrive unsorted)", () => {
    const rows = buildChain(10);
    rows.reverse();
    assert.equal(verifyAuditChain(rows).ok, true);
  });

  test("altering any field of a historical event breaks the chain at that event", () => {
    const rows = buildChain(5);
    rows[2] = { ...rows[2], details: "rewritten after the fact" };
    const r = verifyAuditChain(rows);
    assert.equal(r.ok, false);
    assert.equal(r.error?.seq, 3);
    assert.match(r.error?.reason ?? "", /altered/);
  });

  test("altering the timestamp is detected", () => {
    const rows = buildChain(3);
    rows[1] = { ...rows[1], createdAt: new Date(1800000000000).toISOString() };
    assert.equal(verifyAuditChain(rows).ok, false);
  });

  test("deleting an event is detected as a sequence gap", () => {
    const rows = buildChain(5).filter((r) => r.seq !== 3);
    const r = verifyAuditChain(rows);
    assert.equal(r.ok, false);
    assert.equal(r.error?.seq, 4);
    assert.match(r.error?.reason ?? "", /sequence gap/);
  });

  test("tail truncation is NOT detected by the chain alone (requires a head anchor)", () => {
    // Deleting the newest event(s) leaves a clean shorter prefix. Assert that
    // documented limitation so nobody assumes tail-truncation is caught
    // without an externally recorded head anchor.
    const rows = buildChain(5).slice(0, 4);
    assert.equal(verifyAuditChain(rows).ok, true);
  });

  test("tail truncation IS detected against a recorded head anchor", () => {
    const full = buildChain(5);
    const head = { seq: 5, hash: full[4].hash };
    // Intact chain passes against its own head.
    assert.equal(verifyAuditChain(full, head).ok, true);
    // Truncated chain fails against the recorded head.
    const truncated = full.slice(0, 4);
    const r = verifyAuditChain(truncated, head);
    assert.equal(r.ok, false);
    assert.equal(r.error?.seq, 5);
    assert.match(r.error?.reason ?? "", /truncated/);
  });

  test("a rebuilt chain with a different event at the anchored seq is detected", () => {
    // Attacker deletes the tail and lets the writer re-heal with new events:
    // seq matches the anchor but the hash differs.
    const full = buildChain(5);
    const head = { seq: 5, hash: full[4].hash };
    const rehealed = [...full.slice(0, 4)];
    const forgedPayload: AuditChainPayload = {
      seq: 5,
      organisationId: "org-1",
      userId: null,
      userName: null,
      projectId: null,
      eventType: "benign.event",
      objectType: null,
      objectId: null,
      details: null,
      createdAt: new Date(1700000099000).toISOString(),
    };
    const forgedHash = computeAuditHash(rehealed[3].hash, forgedPayload);
    rehealed.push({
      ...forgedPayload,
      prevHash: rehealed[3].hash,
      hash: forgedHash,
    });
    const r = verifyAuditChain(rehealed, head);
    assert.equal(r.ok, false);
    assert.match(r.error?.reason ?? "", /head hash mismatch/);
  });

  test("chain grown beyond the anchor still verifies against the older anchor", () => {
    const full = buildChain(7);
    const olderHead = { seq: 5, hash: full[4].hash };
    assert.equal(verifyAuditChain(full, olderHead).ok, true);
  });

  test("re-linking a forged event without recomputing successors is detected", () => {
    const rows = buildChain(4);
    // Forge event 2 completely (valid hash for its own payload) but leave
    // event 3 pointing at the original hash.
    const forgedPayload: AuditChainPayload = { ...rows[1], details: "forged" };
    const forgedHash = computeAuditHash(rows[0].hash, forgedPayload);
    rows[1] = { ...forgedPayload, prevHash: rows[0].hash, hash: forgedHash };
    const r = verifyAuditChain(rows);
    assert.equal(r.ok, false);
    assert.equal(r.error?.seq, 3);
    assert.match(r.error?.reason ?? "", /broken link/);
  });

  test("a chain not starting at seq 1 is rejected", () => {
    const rows = buildChain(3).slice(1);
    const r = verifyAuditChain(rows);
    assert.equal(r.ok, false);
    assert.equal(r.error?.seq, 2);
  });

  test("a first event not linked to genesis is rejected", () => {
    const rows = buildChain(1);
    rows[0] = { ...rows[0], prevHash: "f".repeat(64) };
    const r = verifyAuditChain(rows);
    assert.equal(r.ok, false);
    assert.match(r.error?.reason ?? "", /broken link/);
  });
});
