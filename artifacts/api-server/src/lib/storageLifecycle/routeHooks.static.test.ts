import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const documents = await readFile(
  new URL("../../routes/documents.ts", import.meta.url),
  "utf8",
);
const vault = await readFile(
  new URL("../../routes/vault.ts", import.meta.url),
  "utf8",
);

test("document row deletion queues cleanup instead of deleting storage inline", () => {
  const path = documents.lastIndexOf('"/documents/:id"');
  const start = documents.lastIndexOf("router.delete(", path);
  assert.notEqual(start, -1);
  const body = documents.slice(
    start,
    documents.indexOf("export default", start),
  );
  assert.match(body, /enqueueStorageDeletionIntent/u);
  assert.match(body, /aggregateType: "document"/u);
  assert.match(body, /reason: "record_deleted"/u);
  assert.match(body, /storagePathReferenceKinds/u);
  assert.doesNotMatch(body, /objectStorage\.deleteObjectEntity/u);
});

test("vault replacement and deletion durably queue the prior object path", () => {
  assert.ok(
    (vault.match(/enqueueStorageDeletionIntent\(\{/gu) ?? []).length >= 2,
  );
  assert.match(vault, /reason: "reference_replaced"/u);
  assert.match(vault, /reason: "record_deleted"/u);
  assert.match(vault, /objectPath: lockedExisting\.objectPath/u);
  assert.match(vault, /objectPath: deleted\.objectPath/u);
});
