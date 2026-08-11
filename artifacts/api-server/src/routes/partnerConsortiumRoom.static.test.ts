import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./partnerConsortiumRoom.ts", import.meta.url),
  "utf8",
);
const routeIndex = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const retentionRoute = readFileSync(
  new URL("./operations.ts", import.meta.url),
  "utf8",
);
const retentionIntegration = readFileSync(
  new URL("./operations.retention.integration.test.ts", import.meta.url),
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

test("governed retention purges and certifies consortium room envelopes", () => {
  assert.match(
    retentionRoute,
    /CONSORTIUM_ROOM_TASK_PREFIX = "\[CONSORTIUM-ROOM:v1:"/u,
  );
  assert.match(
    retentionRoute,
    /like\(workTasks\.title, `\$\{CONSORTIUM_ROOM_TASK_PREFIX\}%`\)/u,
  );
  assert.match(retentionRoute, /consortium_rooms=\$\{purgedConsortiumRooms\}/u);
  assert.match(retentionIntegration, /valo\.partner-consortium-room\/v1/u);
  assert.match(retentionIntegration, /consortium_rooms=1/u);
});
