import assert from "node:assert/strict";
import test from "node:test";
import { RequestUploadUrlBody } from "@workspace/api-zod";
import { ABSOLUTE_MAX_UPLOAD_BYTES } from "./intakeLimits";

const valid = {
  name: "tender.pdf",
  size: 1024,
  contentType: "application/pdf",
};

test("upload contract accepts a bounded request", () => {
  assert.equal(RequestUploadUrlBody.safeParse(valid).success, true);
});

test("upload contract rejects a declared object above the hard ceiling", () => {
  assert.equal(
    RequestUploadUrlBody.safeParse({
      ...valid,
      size: ABSOLUTE_MAX_UPLOAD_BYTES + 1,
    }).success,
    false,
  );
});

test("upload contract bounds untrusted metadata fields", () => {
  assert.equal(
    RequestUploadUrlBody.safeParse({ ...valid, name: "x".repeat(256) }).success,
    false,
  );
  assert.equal(
    RequestUploadUrlBody.safeParse({
      ...valid,
      contentType: "x".repeat(256),
    }).success,
    false,
  );
});
