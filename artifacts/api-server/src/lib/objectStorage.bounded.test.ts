import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectStreamWithLimit, ObjectTooLargeError } from "./objectStorage";

async function* chunks(...values: string[]) {
  for (const value of values) yield Buffer.from(value);
}

describe("collectStreamWithLimit", () => {
  it("returns an object at the exact byte limit", async () => {
    assert.deepEqual(
      await collectStreamWithLimit(chunks("abc", "def"), 6),
      Buffer.from("abcdef"),
    );
  });

  it("rejects as soon as the stream crosses the limit", async () => {
    await assert.rejects(
      () => collectStreamWithLimit(chunks("abc", "def"), 5),
      ObjectTooLargeError,
    );
  });
});
