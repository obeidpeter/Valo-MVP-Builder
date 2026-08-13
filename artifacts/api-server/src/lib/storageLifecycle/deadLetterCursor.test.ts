import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeStorageDeadLetterCursor,
  encodeStorageDeadLetterCursor,
  STORAGE_DEAD_LETTER_CURSOR_MAX_LENGTH,
  StorageDeadLetterCursorError,
} from "./deadLetterCursor";

const terminalAt = new Date("2026-08-13T12:34:56.789Z");
const id = "56414c4f-0000-5000-8000-000000000123";

test("dead-letter cursor is opaque, canonical and round-trips exact ordering", () => {
  const encoded = encodeStorageDeadLetterCursor({ terminalAt, id });
  assert.ok(encoded.length <= STORAGE_DEAD_LETTER_CURSOR_MAX_LENGTH);
  assert.doesNotMatch(encoded, /2026|56414c4f/u);
  assert.deepEqual(decodeStorageDeadLetterCursor(encoded), { terminalAt, id });
  assert.equal(
    encodeStorageDeadLetterCursor(decodeStorageDeadLetterCursor(encoded)),
    encoded,
  );
});

test("dead-letter cursor rejects noncanonical, extra-field and invalid anchors", () => {
  const encodeRaw = (value: unknown) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  for (const invalid of [
    null,
    1,
    [encodeRaw({ terminalAt: terminalAt.toISOString(), id })],
    { cursor: encodeRaw({ terminalAt: terminalAt.toISOString(), id }) },
    "",
    "=padding",
    "a".repeat(STORAGE_DEAD_LETTER_CURSOR_MAX_LENGTH + 1),
    encodeRaw({ terminalAt: terminalAt.toISOString(), id, extra: true }),
    encodeRaw({ terminalAt: "2026-08-13", id }),
    encodeRaw({ terminalAt: terminalAt.toISOString(), id: "not-a-uuid" }),
    Buffer.from([0xff]).toString("base64url"),
  ]) {
    assert.throws(
      () => decodeStorageDeadLetterCursor(invalid),
      StorageDeadLetterCursorError,
    );
  }
});
