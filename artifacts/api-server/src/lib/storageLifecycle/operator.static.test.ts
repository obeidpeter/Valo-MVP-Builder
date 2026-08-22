import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repository = readFileSync(
  new URL("./repository.ts", import.meta.url),
  "utf8",
);
const operations = readFileSync(
  new URL("../../routes/operations.ts", import.meta.url),
  "utf8",
);
const openapi = readFileSync(
  new URL("../../../../../lib/api-spec/openapi.yaml", import.meta.url),
  "utf8",
);

test("dead-letter replay is bounded, CAS protected and audited", () => {
  assert.match(repository, /maximumDeadLetterReplays/u);
  assert.match(repository, /storageReplayCount: event\.replayCount \+ 1/u);
  assert.match(repository, /storageCycleAttempts: 0/u);
  assert.match(
    repository,
    /eq\(notificationEvents\.version, event\.version\)/u,
  );
  assert.match(repository, /storage\.deletion_dead_letter_replayed/u);
  assert.match(
    operations,
    /parseExpectedVersion\(req\.header\("if-match"\)\)/u,
  );
  assert.match(operations, /requirePermissionOrLegacy\("retention:manage"\)/u);
  assert.match(operations, /createBoundedJsonBody\(2_048, "operations"\)/u);
  assert.match(
    operations,
    /dead-letters\/:id\/\$\{action\}`,[\s\S]*storageLifecycleOperatorBody/u,
  );
  assert.match(operations, /sendStorageLifecycleUnavailable\(res\)/u);
  assert.match(
    openapi,
    /\/storage-lifecycle\/dead-letters:[\s\S]*?"503": \{ \$ref: "#\/components\/responses\/StorageLifecycleUnavailable" \}/u,
  );
  for (const action of ["replay", "resolve"]) {
    const route = openapi.slice(
      openapi.indexOf(`/storage-lifecycle/dead-letters/{id}/${action}:`),
    );
    assert.match(
      route,
      /"503": \{ \$ref: "#\/components\/responses\/StorageLifecycleUnavailable" \}/u,
    );
  }
});

test("dead-letter listing uses a strict opaque stable continuation cursor", () => {
  const decoder = readFileSync(
    new URL("./deadLetterCursor.ts", import.meta.url),
    "utf8",
  );
  const list = repository.slice(
    repository.indexOf("listStorageDeletionDeadLetters"),
    repository.indexOf("function operatorReason"),
  );
  assert.match(decoder, /typeof value !== "string" \|\|\s*value\.length < 1/u);
  assert.match(list, /decodeStorageDeadLetterCursor\(cursor\)/u);
  assert.match(
    list,
    /cursor === undefined \? null : decodeStorageDeadLetterCursor\(cursor\)/u,
  );
  assert.match(
    list,
    /gt\(notificationEvents\.storageTerminalAt, after\.terminalAt\)[\s\S]*eq\(notificationEvents\.storageTerminalAt, after\.terminalAt\)[\s\S]*gt\(notificationEvents\.id, after\.id\)/u,
  );
  assert.match(
    list,
    /orderBy\([\s\S]*asc\(notificationEvents\.storageTerminalAt\)[\s\S]*asc\(notificationEvents\.id\)/u,
  );
  assert.match(list, /nextCursor:/u);
  assert.match(openapi, /name: cursor[\s\S]*maxLength: 192/u);
  assert.match(
    openapi,
    /StorageDeletionDeadLetterPage:[\s\S]*required: \[items, limit, truncated, nextCursor\]/u,
  );
  const deadLetter = openapi.slice(
    openapi.indexOf("    StorageDeletionDeadLetter:"),
    openapi.indexOf("    StorageDeletionDeadLetterPage:"),
  );
  assert.match(deadLetter, /project_retention/u);
  assert.match(deadLetter, /retention_completion/u);
});

test("resolution never claims deletion and unresolved locators are retained indefinitely", () => {
  assert.match(repository, /disposition: "accepted_unresolved"/u);
  assert.match(repository, /objectDeletionConfirmed: false/u);
  const purge = repository.slice(
    repository.indexOf("purgeRetainedStorageDeletionTerminals"),
  );
  assert.match(purge, /"completed",\s*"cancelled"/u);
  assert.doesNotMatch(purge, /inArray\([^)]*"dead_letter"/u);
  assert.doesNotMatch(purge, /inArray\([^)]*"resolved"/u);
  assert.match(purge, /storage\.deletion_terminal_rows_purged/u);
  assert.match(purge, /manifestSha256/u);
});
