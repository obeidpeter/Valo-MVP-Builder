import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ABSOLUTE_MAX_UPLOAD_BYTES,
  DEFAULT_MAX_UPLOAD_BYTES,
  getMaxUploadBytes,
} from "./intakeLimits";

describe("getMaxUploadBytes", () => {
  it("uses a conservative default", () => {
    assert.equal(getMaxUploadBytes(undefined), DEFAULT_MAX_UPLOAD_BYTES);
  });

  it("allows a deployment to lower the limit", () => {
    assert.equal(getMaxUploadBytes("1048576"), 1_048_576);
  });

  it("caps deployment configuration at the reviewed contract limit", () => {
    assert.equal(
      getMaxUploadBytes(String(ABSOLUTE_MAX_UPLOAD_BYTES * 2)),
      ABSOLUTE_MAX_UPLOAD_BYTES,
    );
  });

  for (const configured of ["0", "-1", "1.5", "not-a-number"]) {
    it(`rejects invalid configuration ${configured}`, () => {
      assert.throws(() => getMaxUploadBytes(configured));
    });
  }
});
