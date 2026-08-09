import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  AUDIT_GENESIS_HASH,
  assessLegacyAuditArchive,
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
    rows.push({ ...payload, hashVersion: 2, prevHash, hash });
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

  test("matches the frozen pre-tenancy v1 canonical payload and hash vector", () => {
    const payload: AuditChainPayload = {
      seq: 1,
      organisationId: "ignored-by-v1",
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
      canonicalAuditPayload(payload, 1),
      '[1,"u",null,null,"e",null,null,"d","2026-01-01T00:00:00.000Z"]',
    );
    assert.equal(
      computeAuditHash(AUDIT_GENESIS_HASH, payload, 1),
      "2ad52b3bd886b5f51b68cf43792bc0fd5ead47dfc85848d9d3fa5c91a69b2483",
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
      hashVersion: 2,
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
    rows[1] = {
      ...forgedPayload,
      hashVersion: 2,
      prevHash: rows[0].hash,
      hash: forgedHash,
    };
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

  test("assesses a byte-preserved v1 archive without claiming mismatches are intact", () => {
    const rows: AuditChainRow[] = [];
    let prevHash = AUDIT_GENESIS_HASH;
    for (let seq = 1; seq <= 5; seq++) {
      const payload: AuditChainPayload = {
        seq,
        organisationId: "56414c4f-0000-5000-8000-000000000025",
        userId: "legacy-user",
        userName: "Legacy Admin",
        projectId: null,
        eventType: `legacy-transition.${seq}`,
        objectType: null,
        objectId: null,
        details: null,
        createdAt: new Date(1700000000000 + seq * 1000).toISOString(),
      };
      const hashVersion = 1;
      const hash = computeAuditHash(prevHash, payload, hashVersion);
      rows.push({ ...payload, hashVersion, prevHash, hash });
      prevHash = hash;
    }

    const head = { seq: 5, hash: rows[4].hash };
    rows[1] = { ...rows[1], userId: null };
    rows[2] = { ...rows[2], userId: null };
    const assessment = assessLegacyAuditArchive(rows, head);
    assert.equal(assessment.status, "known_discontinuity");
    assert.deepEqual(assessment.hashMismatchSequences, [2, 3]);
  });

  test("rejects v1 rows in the active chain even when their legacy hash is valid", () => {
    const rows = buildChain(1);
    rows[0] = {
      ...rows[0],
      hashVersion: 1,
      hash: computeAuditHash(AUDIT_GENESIS_HASH, rows[0], 1),
    };
    const result = verifyAuditChain(rows);
    assert.equal(result.ok, false);
    assert.match(result.error?.reason ?? "", /legacy v1.*archive/);
  });

  test("rejects an unknown hash algorithm version", () => {
    const rows = buildChain(1);
    rows[0] = { ...rows[0], hashVersion: 99 };
    const result = verifyAuditChain(rows);
    assert.equal(result.ok, false);
    assert.match(result.error?.reason ?? "", /unsupported audit hash version/);
  });
});
