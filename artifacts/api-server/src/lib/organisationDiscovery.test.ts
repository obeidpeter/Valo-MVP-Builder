import assert from "node:assert/strict";
import test from "node:test";
import {
  discoverableOrganisationRoleAccess,
  type DiscoveryRoleGrant,
} from "./organisationDiscovery";

const now = new Date("2026-08-10T12:00:00.000Z");
const grant = (
  overrides: Partial<DiscoveryRoleGrant> = {},
): DiscoveryRoleGrant => ({
  membershipId: "membership-1",
  role: "contributor",
  startsAt: null,
  expiresAt: null,
  revokedAt: null,
  ...overrides,
});

test("does not discover an active membership whose grants are expired or revoked", () => {
  assert.equal(
    discoverableOrganisationRoleAccess(
      "membership-1",
      "client",
      [
        grant({ expiresAt: new Date("2026-08-10T11:59:59.000Z") }),
        grant({ revokedAt: new Date("2026-08-09T00:00:00.000Z") }),
      ],
      now,
    ),
    null,
  );
});

test("returns current roles and the uninterrupted last-role expiry", () => {
  const access = discoverableOrganisationRoleAccess(
    "membership-1",
    "client",
    [
      grant({ expiresAt: new Date("2026-08-11T00:00:00.000Z") }),
      grant({
        role: "client_reviewer_approver",
        startsAt: new Date("2026-08-10T20:00:00.000Z"),
        expiresAt: new Date("2026-08-12T00:00:00.000Z"),
      }),
    ],
    now,
  );

  assert.deepEqual(access, {
    roles: ["contributor"],
    roleAccessExpiresAt: new Date("2026-08-12T00:00:00.000Z"),
  });
});
