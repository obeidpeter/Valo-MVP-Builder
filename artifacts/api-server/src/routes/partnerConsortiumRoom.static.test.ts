import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./partnerConsortiumRoom.ts", import.meta.url),
  "utf8",
);
const routeIndex = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const retentionRoute = readFileSync(
  new URL("./retentionCompletion.ts", import.meta.url),
  "utf8",
);
const retentionService = readFileSync(
  new URL("../lib/retentionCompletion/service.ts", import.meta.url),
  "utf8",
);
const retentionActivation = readFileSync(
  new URL("../lib/retentionCompletion/activation.ts", import.meta.url),
  "utf8",
);

test("default consortium router is mounted only inside the tenant resource boundary", () => {
  assert.match(routeIndex, /createDefaultPartnerConsortiumRoomRouter/u);
  const tenantBoundary = routeIndex.indexOf(
    "router.use(enforceTenantResourceBoundary)",
  );
  const roomMount = routeIndex.indexOf(
    "router.use(partnerConsortiumRoomRouter)",
  );
  assert.ok(tenantBoundary >= 0);
  assert.ok(roomMount > tenantBoundary);
});

test("consortium room requires direct or exact relationship-authorised access", () => {
  assert.match(source, /access\.source !== "membership"/u);
  assert.match(source, /access\.source !== "partner"/u);
  assert.match(source, /access\.partnerRelationshipId !== relationshipId/u);
  assert.match(source, /access\.membershipOrganisationId !== organisationId/u);
  assert.match(source, /requirePermission\("project:read"\)/u);
  assert.equal(
    source.match(/requirePermission\("requirement:write"\)/gu)?.length,
    7,
  );
  assert.match(source, /relationshipId\/participants/u);
});

test("consortium route has no external, legal, commercial, or destructive action", () => {
  assert.doesNotMatch(
    source,
    /send-message|send-email|whatsapp|legal-agreement|revenue|settlement|autonomous|router\.delete/iu,
  );
  assert.match(source, /Cache-Control", "private, no-store"/u);
  assert.match(source, /createDefaultPartnerConsortiumRoomRouter/u);
});

test("retention completion leaves consortium envelopes untouched while activation is gated", () => {
  assert.match(retentionRoute, /RETENTION_COMPLETION_NOT_ACTIVATED/u);
  assert.match(retentionRoute, /sideEffectsApplied: false/u);
  assert.match(
    retentionActivation,
    /durable_two_phase_detach_reconcile_certify/u,
  );
  assert.match(
    retentionService,
    /async detach\([\s\S]*?this\.#assertActivated\(\);[\s\S]*?this\.#repository\.detach\(/u,
  );
  assert.doesNotMatch(retentionRoute, /CONSORTIUM_ROOM_TASK_PREFIX/u);
  assert.doesNotMatch(retentionRoute, /consortium_rooms=/u);
});
