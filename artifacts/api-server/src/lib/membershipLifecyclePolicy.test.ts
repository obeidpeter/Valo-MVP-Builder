import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  activeRolesForMembershipAt,
  canManageMembershipTarget,
  evaluateMembershipGrantAuthority,
  evaluateMembershipLifecycleAuthority,
  type MembershipAuthorityDecision,
  type MembershipAuthorityDenial,
  type MembershipLifecycleSnapshot,
  type RoleGrantLifecycleSnapshot,
} from "./membershipLifecyclePolicy";

const NOW = new Date("2026-08-09T12:00:00.000Z");

function membership(
  id: string,
  overrides: Partial<MembershipLifecycleSnapshot> = {},
): MembershipLifecycleSnapshot {
  return { id, status: "active", ...overrides };
}

function grant(
  membershipId: string,
  role: string,
  overrides: Partial<RoleGrantLifecycleSnapshot> = {},
): RoleGrantLifecycleSnapshot {
  return { membershipId, role, ...overrides };
}

function expectDenied(
  decision: MembershipAuthorityDecision,
  denial: MembershipAuthorityDenial,
): void {
  assert.equal(decision.allowed, false);
  if (decision.allowed) assert.fail("expected membership policy denial");
  assert.equal(decision.denial, denial);
}

describe("membership management hierarchy", () => {
  test("uses only active actor grants as live authority", () => {
    const memberships = [membership("actor")];
    const grants = [
      grant("actor", "client_organisation_owner", {
        expiresAt: "2026-08-09T12:00:00.000Z",
      }),
    ];
    assert.deepEqual(
      activeRolesForMembershipAt(memberships[0], grants, NOW),
      [],
    );
    expectDenied(
      evaluateMembershipGrantAuthority({
        actorMembershipId: "actor",
        requestedRole: "contributor",
        memberships,
        grants,
        now: NOW,
      }),
      "actor_authority_changed",
    );
  });

  test("binds the locked actor membership back to the authenticated user", () => {
    const memberships = [membership("actor", { userId: "different-user" })];
    const grants = [grant("actor", "client_organisation_owner")];
    expectDenied(
      evaluateMembershipGrantAuthority({
        actorMembershipId: "actor",
        actorUserId: "authenticated-user",
        requestedRole: "contributor",
        memberships,
        grants,
        now: NOW,
      }),
      "actor_authority_changed",
    );
  });

  test("an administrator cannot reactivate a target that retains an owner grant", () => {
    const memberships = [
      membership("actor"),
      membership("target", { status: "suspended" }),
    ];
    const grants = [
      grant("actor", "client_administrator"),
      grant("target", "client_organisation_owner"),
    ];
    expectDenied(
      evaluateMembershipGrantAuthority({
        actorMembershipId: "actor",
        targetMembershipId: "target",
        requestedRole: "contributor",
        memberships,
        grants,
        now: NOW,
      }),
      "target_above_management_ceiling",
    );
  });

  test("scheduled and unknown live grants fail closed while expired grants do not", () => {
    const actorRoles = ["client_administrator"] as const;
    assert.equal(
      canManageMembershipTarget(
        actorRoles,
        "target",
        [
          grant("target", "client_organisation_owner", {
            startsAt: "2026-08-10T12:00:00.000Z",
          }),
        ],
        NOW,
      ),
      false,
    );
    assert.equal(
      canManageMembershipTarget(
        actorRoles,
        "target",
        [grant("target", "future_unknown_role")],
        NOW,
      ),
      false,
    );
    assert.equal(
      canManageMembershipTarget(
        actorRoles,
        "target",
        [
          grant("target", "client_organisation_owner", {
            expiresAt: "not-a-date",
          }),
        ],
        NOW,
      ),
      false,
    );
    assert.equal(
      canManageMembershipTarget(
        actorRoles,
        "target",
        [
          grant("target", "client_organisation_owner", {
            expiresAt: "2026-08-09T11:59:59.000Z",
          }),
        ],
        NOW,
      ),
      true,
    );
  });

  test("self-grants and self-suspension or expiry changes are denied", () => {
    const memberships = [membership("actor")];
    const grants = [grant("actor", "client_organisation_owner")];
    expectDenied(
      evaluateMembershipGrantAuthority({
        actorMembershipId: "actor",
        targetMembershipId: "actor",
        requestedRole: "bid_manager",
        memberships,
        grants,
        now: NOW,
      }),
      "unsafe_self_grant",
    );
    expectDenied(
      evaluateMembershipLifecycleAuthority({
        actorMembershipId: "actor",
        targetMembershipId: "actor",
        memberships,
        grants,
        nextStatus: "suspended",
        changesAccessExpiry: false,
        nextAccessExpiresAt: null,
        now: NOW,
      }),
      "unsafe_self_lifecycle_change",
    );
    expectDenied(
      evaluateMembershipLifecycleAuthority({
        actorMembershipId: "actor",
        targetMembershipId: "actor",
        memberships,
        grants,
        changesAccessExpiry: true,
        nextAccessExpiresAt: new Date("2026-08-10T12:00:00.000Z"),
        now: NOW,
      }),
      "unsafe_self_lifecycle_change",
    );
  });

  test("a finite expiry cannot strand the organisation after the actor expires", () => {
    const memberships = [
      membership("actor", {
        accessExpiresAt: "2026-08-10T12:00:00.000Z",
      }),
      membership("target"),
    ];
    const grants = [
      grant("actor", "client_organisation_owner"),
      grant("target", "client_organisation_owner"),
    ];
    const decision = evaluateMembershipLifecycleAuthority({
      actorMembershipId: "actor",
      targetMembershipId: "target",
      memberships,
      grants,
      changesAccessExpiry: true,
      nextAccessExpiresAt: new Date("2026-08-11T12:00:00.000Z"),
      now: NOW,
    });
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.equal(decision.denial, "last_active_owner");
  });

  test("the same future checkpoint preserves a non-client administrator", () => {
    const memberships = [
      membership("actor", {
        accessExpiresAt: "2026-08-10T12:00:00.000Z",
      }),
      membership("target"),
    ];
    const grants = [
      grant("actor", "consultancy_partner_administrator"),
      grant("target", "consultancy_partner_administrator"),
    ];
    expectDenied(
      evaluateMembershipLifecycleAuthority({
        actorMembershipId: "actor",
        targetMembershipId: "target",
        memberships,
        grants,
        changesAccessExpiry: true,
        nextAccessExpiresAt: new Date("2026-08-11T12:00:00.000Z"),
        now: NOW,
      }),
      "last_active_administrator",
    );
  });

  test("reactivation evaluates the proposed owner window, not the suspended state", () => {
    const memberships = [
      membership("actor", {
        accessExpiresAt: "2026-08-10T12:00:00.000Z",
      }),
      membership("target", { status: "suspended" }),
    ];
    const grants = [
      grant("actor", "client_organisation_owner"),
      grant("target", "client_organisation_owner"),
    ];
    expectDenied(
      evaluateMembershipLifecycleAuthority({
        actorMembershipId: "actor",
        targetMembershipId: "target",
        memberships,
        grants,
        nextStatus: "active",
        changesAccessExpiry: true,
        nextAccessExpiresAt: new Date("2026-08-11T12:00:00.000Z"),
        now: NOW,
      }),
      "last_active_owner",
    );
  });

  test("reactivation also checks a retained administrative role expiry", () => {
    const memberships = [
      membership("actor", {
        accessExpiresAt: "2026-08-10T12:00:00.000Z",
      }),
      membership("target", { status: "suspended" }),
    ];
    const grants = [
      grant("actor", "consultancy_partner_administrator"),
      grant("target", "consultancy_partner_administrator", {
        expiresAt: "2026-08-11T12:00:00.000Z",
      }),
    ];
    expectDenied(
      evaluateMembershipLifecycleAuthority({
        actorMembershipId: "actor",
        targetMembershipId: "target",
        memberships,
        grants,
        nextStatus: "active",
        changesAccessExpiry: true,
        nextAccessExpiresAt: null,
        now: NOW,
      }),
      "last_active_administrator",
    );
  });

  test("denies reactivation when a matching scheduled owner grant leaves an authority gap", () => {
    const memberships = [
      membership("actor", {
        accessExpiresAt: "2026-08-10T12:00:00.000Z",
      }),
      membership("target", { status: "suspended" }),
    ];
    const grants = [
      grant("actor", "client_organisation_owner"),
      grant("target", "client_organisation_owner", {
        startsAt: "2026-08-11T12:00:00.000Z",
      }),
    ];
    expectDenied(
      evaluateMembershipLifecycleAuthority({
        actorMembershipId: "actor",
        targetMembershipId: "target",
        memberships,
        grants,
        nextStatus: "active",
        changesAccessStart: true,
        nextAccessStartsAt: null,
        changesAccessExpiry: true,
        nextAccessExpiresAt: null,
        checksProposedAuthorityLoss: false,
        now: NOW,
      }),
      "last_active_owner",
    );
  });

  test("allows a reactivation with a gap-free exact authority handoff", () => {
    const memberships = [
      membership("actor", {
        accessExpiresAt: "2026-08-10T12:00:00.000Z",
      }),
      membership("target", { status: "suspended" }),
    ];
    const grants = [
      grant("actor", "client_organisation_owner"),
      grant("target", "client_organisation_owner", {
        startsAt: "2026-08-10T12:00:00.000Z",
      }),
    ];
    assert.equal(
      evaluateMembershipLifecycleAuthority({
        actorMembershipId: "actor",
        targetMembershipId: "target",
        memberships,
        grants,
        nextStatus: "active",
        changesAccessStart: true,
        nextAccessStartsAt: null,
        changesAccessExpiry: true,
        nextAccessExpiresAt: null,
        now: NOW,
      }).allowed,
      true,
    );
  });

  test("denies suspension that would create a gap at another owner's future expiry", () => {
    const memberships = [
      membership("actor", {
        accessExpiresAt: "2026-08-10T12:00:00.000Z",
      }),
      membership("target"),
    ];
    const grants = [
      grant("actor", "client_organisation_owner"),
      grant("target", "client_organisation_owner"),
    ];
    expectDenied(
      evaluateMembershipLifecycleAuthority({
        actorMembershipId: "actor",
        targetMembershipId: "target",
        memberships,
        grants,
        nextStatus: "suspended",
        changesAccessExpiry: false,
        nextAccessExpiresAt: null,
        now: NOW,
      }),
      "last_active_owner",
    );
  });

  test("an access-expired membership is treated as reactivated even when status remains active", () => {
    const memberships = [
      membership("actor", {
        accessExpiresAt: "2026-08-10T12:00:00.000Z",
      }),
      membership("target", {
        accessExpiresAt: "2026-08-09T11:00:00.000Z",
      }),
    ];
    const grants = [
      grant("actor", "client_organisation_owner"),
      grant("target", "client_organisation_owner"),
    ];
    expectDenied(
      evaluateMembershipLifecycleAuthority({
        actorMembershipId: "actor",
        targetMembershipId: "target",
        memberships,
        grants,
        nextStatus: "active",
        changesAccessExpiry: true,
        nextAccessExpiresAt: new Date("2026-08-11T12:00:00.000Z"),
        now: NOW,
      }),
      "last_active_owner",
    );
  });

  test("a proposed new owner grant participates in the future-loss check", () => {
    const memberships = [
      membership("actor", {
        userId: "actor-user",
        accessExpiresAt: "2026-08-10T12:00:00.000Z",
      }),
      membership("pending-target", { status: "suspended" }),
    ];
    const grants = [
      grant("actor", "client_organisation_owner"),
      grant("pending-target", "client_organisation_owner", {
        expiresAt: "2026-08-11T12:00:00.000Z",
      }),
    ];
    expectDenied(
      evaluateMembershipLifecycleAuthority({
        actorMembershipId: "actor",
        actorUserId: "actor-user",
        targetMembershipId: "pending-target",
        memberships,
        grants,
        nextStatus: "active",
        changesAccessStart: true,
        nextAccessStartsAt: null,
        changesAccessExpiry: true,
        nextAccessExpiresAt: null,
        checksProposedAuthorityLoss: true,
        now: NOW,
      }),
      "last_active_owner",
    );
  });

  test("a new admin role on an existing suspended member is also checked", () => {
    const memberships = [
      membership("actor", {
        accessExpiresAt: "2026-08-10T12:00:00.000Z",
      }),
      membership("target", { status: "suspended" }),
    ];
    const grants = [
      grant("actor", "consultancy_partner_administrator"),
      grant("target", "read_only_auditor"),
      grant("target", "consultancy_partner_administrator", {
        expiresAt: "2026-08-11T12:00:00.000Z",
      }),
    ];
    expectDenied(
      evaluateMembershipLifecycleAuthority({
        actorMembershipId: "actor",
        targetMembershipId: "target",
        memberships,
        grants,
        nextStatus: "active",
        changesAccessStart: true,
        nextAccessStartsAt: null,
        changesAccessExpiry: true,
        nextAccessExpiresAt: null,
        checksProposedAuthorityLoss: true,
        now: NOW,
      }),
      "last_active_administrator",
    );
  });

  test("a future active owner and administrator preserves both invariants", () => {
    const memberships = [
      membership("actor", {
        accessExpiresAt: "2026-08-12T12:00:00.000Z",
      }),
      membership("target"),
      membership("successor", {
        accessStartsAt: "2026-08-10T12:00:00.000Z",
      }),
    ];
    const grants = [
      grant("actor", "client_organisation_owner"),
      grant("target", "client_organisation_owner"),
      grant("successor", "client_organisation_owner"),
    ];
    assert.equal(
      evaluateMembershipLifecycleAuthority({
        actorMembershipId: "actor",
        targetMembershipId: "target",
        memberships,
        grants,
        changesAccessExpiry: true,
        nextAccessExpiresAt: new Date("2026-08-11T12:00:00.000Z"),
        now: NOW,
      }).allowed,
      true,
    );
  });

  test("extending an existing expiry is not treated as a new downgrade", () => {
    const memberships = [
      membership("actor", {
        accessExpiresAt: "2026-08-10T12:00:00.000Z",
      }),
      membership("target", {
        accessExpiresAt: "2026-08-10T12:00:00.000Z",
      }),
    ];
    const grants = [
      grant("actor", "client_organisation_owner"),
      grant("target", "client_organisation_owner"),
    ];
    assert.equal(
      evaluateMembershipLifecycleAuthority({
        actorMembershipId: "actor",
        targetMembershipId: "target",
        memberships,
        grants,
        changesAccessExpiry: true,
        nextAccessExpiresAt: new Date("2026-08-11T12:00:00.000Z"),
        now: NOW,
      }).allowed,
      true,
    );
  });
});
