import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseExpectedVersion } from "../lib/permissions";

describe("optimistic concurrency token parsing", () => {
  test("accepts strong and weak integer ETags", () => {
    assert.equal(parseExpectedVersion("3"), 3);
    assert.equal(parseExpectedVersion('"4"'), 4);
    assert.equal(parseExpectedVersion('W/"5"'), 5);
  });

  test("fails closed on missing, zero, negative and non-integer versions", () => {
    assert.equal(parseExpectedVersion(undefined), null);
    assert.equal(parseExpectedVersion("0"), null);
    assert.equal(parseExpectedVersion("-1"), null);
    assert.equal(parseExpectedVersion("1.5"), null);
    assert.equal(parseExpectedVersion("anything"), null);
  });
});
