import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./reconciledCommunications.ts", import.meta.url),
  "utf8",
);

test("communications routes require direct membership and least-privilege permissions", () => {
  assert.match(source, /access\?\.source !== "membership"/u);
  assert.match(source, /access\.membershipOrganisationId !== organisationId/u);
  assert.match(source, /requirePermissionOrLegacy\("project:read"\)/u);
  assert.equal(
    source.match(/requirePermissionOrLegacy\("project:update"\)/gu)?.length,
    4,
  );
  assert.match(source, /communications\/references/u);
  assert.match(source, /loadDbCommunicationReferences/u);
  assert.match(source, /Cache-Control", "private, no-store"/u);
});

test("safe factory is durable but external-provider disconnected", () => {
  assert.match(source, /createDisconnectedReconciledCommunicationsRouter/u);
  const safeFactory = source.slice(
    source.indexOf("export function createDisconnected"),
    source.indexOf("export function createConnected"),
  );
  assert.doesNotMatch(safeFactory, /providers:|receiptVerifier:/u);
  assert.doesNotMatch(
    source,
    /recipientEmail|phoneNumber|messageBody|rawBody/u,
  );
});
