import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalProjectDeadline,
  hasServerManagedProjectCreateField,
  isUuid,
} from "./projectMutationPolicy";

describe("project mutation policy", () => {
  test("canonicalizes explicit RFC 3339 instants to UTC", () => {
    assert.equal(
      canonicalProjectDeadline("2026-08-13T09:30:00+01:00"),
      "2026-08-13T08:30:00.000Z",
    );
    assert.equal(
      canonicalProjectDeadline("2028-02-29T23:59:59.123456789Z"),
      "2028-02-29T23:59:59.123Z",
    );
  });

  test("rejects naive, malformed and normalized-away deadlines", () => {
    for (const deadline of [
      "2026-08-13",
      "2026-08-13T09:30",
      "2026-08-13T09:30:00",
      "2026-02-29T09:30:00Z",
      "2026-13-01T09:30:00Z",
      "2026-08-13T24:00:00Z",
      "2026-08-13T09:30:60Z",
      "not-a-date",
    ]) {
      assert.equal(canonicalProjectDeadline(deadline), null, deadline);
    }
  });

  test("detects every server-managed creation field", () => {
    for (const field of [
      "paymentStatus",
      "conflictStatus",
      "conflictDecision",
      "conflictRationale",
    ]) {
      assert.equal(hasServerManagedProjectCreateField({ [field]: null }), true);
    }
    assert.equal(
      hasServerManagedProjectCreateField({ tenderTitle: "Tender" }),
      false,
    );
  });

  test("accepts only canonical UUID shapes at the route boundary", () => {
    assert.equal(isUuid("4ad28de7-d8d1-4e91-9181-4adc8ecbed48"), true);
    assert.equal(isUuid("cross-tenant-reviewer"), false);
  });
});
