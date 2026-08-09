import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  BREAK_GLASS_ELIGIBLE_PERMISSIONS,
  PARTNER_DERIVED_PERMISSIONS,
  ORGANISATION_ROLES,
  PERMISSIONS,
  canGrantRole,
  canAccessResourceOrganisation,
  hasPermission,
  isActiveAccessWindow,
  isRoleAllowedForOrganisation,
  partnerDerivedPermissionsForRoles,
  permissionsForRoles,
} from "./permissions";

describe("role and permission policy", () => {
  test("defines every role required by the v2.5 permission matrix", () => {
    assert.deepEqual(ORGANISATION_ROLES, [
      "client_organisation_owner",
      "client_administrator",
      "bid_manager",
      "contributor",
      "client_reviewer_approver",
      "valo_operations_administrator",
      "restricted_platform_administrator",
      "consultancy_partner_administrator",
      "consultancy_partner_analyst_reviewer",
      "read_only_auditor",
      "valo_analyst",
      "valo_quality_adviser",
    ]);
  });

  test("contributors can supply evidence but cannot approve or release it", () => {
    assert.equal(hasPermission(["contributor"], "evidence:write"), true);
    assert.equal(hasPermission(["contributor"], "evidence:approve"), false);
    assert.equal(hasPermission(["contributor"], "report:sign_off"), false);
    assert.equal(hasPermission(["contributor"], "report:export"), false);
    assert.equal(hasPermission(["contributor"], "draft:write"), true);
    assert.equal(hasPermission(["contributor"], "draft:review"), false);
    assert.equal(hasPermission(["contributor"], "package:sign_off"), false);
    assert.equal(hasPermission(["contributor"], "package:export"), false);
  });

  test("reviewers can approve work but cannot administer memberships", () => {
    assert.equal(
      hasPermission(["client_reviewer_approver"], "evidence:approve"),
      true,
    );
    assert.equal(
      hasPermission(["client_reviewer_approver"], "report:sign_off"),
      true,
    );
    assert.equal(
      hasPermission(["client_reviewer_approver"], "membership:manage"),
      false,
    );
    assert.equal(
      hasPermission(["client_reviewer_approver"], "draft:review"),
      true,
    );
    assert.equal(
      hasPermission(["client_reviewer_approver"], "package:sign_off"),
      true,
    );
    assert.equal(
      hasPermission(["client_reviewer_approver"], "billing:read"),
      false,
    );
    assert.equal(
      hasPermission(["client_reviewer_approver"], "order:create"),
      false,
    );
  });

  test("restricted platform admins cannot read tenant work", () => {
    const permissions = permissionsForRoles([
      "restricted_platform_administrator",
    ]);
    assert.equal(permissions.has("feature_flag:manage"), true);
    assert.equal(permissions.has("break_glass:approve"), true);
    assert.equal(permissions.has("project:read"), false);
    assert.equal(permissions.has("document:read"), false);
    assert.equal(permissions.has("draft:read"), false);
    assert.equal(permissions.has("package:read"), false);
    assert.equal(permissions.has("billing:read"), false);
  });

  test("v2.5 domain permissions preserve operations and quality separation", () => {
    assert.equal(
      hasPermission(["valo_operations_administrator"], "processing_job:retry"),
      true,
    );
    assert.equal(
      hasPermission(["valo_operations_administrator"], "package:sign_off"),
      false,
    );
    assert.equal(
      hasPermission(["valo_operations_administrator"], "evaluation:manage"),
      false,
    );
    assert.equal(
      hasPermission(["valo_operations_administrator"], "rule_pack:manage"),
      false,
    );

    assert.equal(
      hasPermission(["valo_quality_adviser"], "package:sign_off"),
      true,
    );
    assert.equal(
      hasPermission(["valo_quality_adviser"], "evaluation:manage"),
      true,
    );
    assert.equal(
      hasPermission(["valo_quality_adviser"], "rule_pack:manage"),
      true,
    );
    assert.equal(
      hasPermission(["valo_quality_adviser"], "processing_job:retry"),
      false,
    );
    assert.equal(
      hasPermission(["valo_quality_adviser"], "billing:read"),
      false,
    );

    assert.equal(hasPermission(["valo_analyst"], "package:generate"), true);
    assert.equal(hasPermission(["valo_analyst"], "package:sign_off"), false);
    assert.equal(hasPermission(["valo_analyst"], "package:export"), false);
  });

  test("owners can access commercial and privacy controls", () => {
    assert.equal(
      hasPermission(["client_organisation_owner"], "billing:read"),
      true,
    );
    assert.equal(
      hasPermission(["client_organisation_owner"], "order:create"),
      true,
    );
    assert.equal(
      hasPermission(["client_organisation_owner"], "entitlement:read"),
      true,
    );
    assert.equal(
      hasPermission(["client_organisation_owner"], "privacy:manage"),
      true,
    );
  });

  test("declares every persisted v2.5 domain permission", () => {
    const expected = [
      "draft:read",
      "draft:write",
      "draft:review",
      "package:read",
      "package:generate",
      "package:sign_off",
      "package:export",
      "billing:read",
      "order:create",
      "entitlement:read",
      "privacy:read",
      "privacy:manage",
      "processing_job:read",
      "processing_job:retry",
      "evaluation:read",
      "evaluation:manage",
      "rule_pack:read",
      "rule_pack:manage",
      "partner_report:read",
    ];
    for (const permission of expected)
      assert.equal(PERMISSIONS.includes(permission as never), true);
  });

  test("auditors are strictly read-only and quality advisers can sign off", () => {
    assert.equal(hasPermission(["read_only_auditor"], "audit:read"), true);
    assert.equal(
      hasPermission(["read_only_auditor"], "document:upload"),
      false,
    );
    assert.equal(hasPermission(["read_only_auditor"], "project:update"), false);
    assert.equal(
      hasPermission(["valo_quality_adviser"], "report:sign_off"),
      true,
    );
    assert.equal(
      hasPermission(["valo_quality_adviser"], "membership:manage"),
      false,
    );
  });

  test("every vault viewer also has document source download permission", () => {
    for (const role of ORGANISATION_ROLES) {
      const permissions = permissionsForRoles([role]);
      if (permissions.has("evidence:read")) {
        assert.equal(
          permissions.has("document:read"),
          true,
          `${role} can view vault evidence without document:read`,
        );
      }
    }
    assert.equal(PARTNER_DERIVED_PERMISSIONS.has("evidence:read"), true);
    assert.equal(PARTNER_DERIVED_PERMISSIONS.has("document:read"), true);
    assert.equal(BREAK_GLASS_ELIGIBLE_PERMISSIONS.has("evidence:read"), true);
    assert.equal(BREAK_GLASS_ELIGIBLE_PERMISSIONS.has("document:read"), true);
  });

  test("roles cannot be granted to an incompatible organisation type", () => {
    assert.equal(isRoleAllowedForOrganisation("bid_manager", "client"), true);
    assert.equal(
      isRoleAllowedForOrganisation(
        "consultancy_partner_administrator",
        "client",
      ),
      false,
    );
    assert.equal(
      isRoleAllowedForOrganisation(
        "consultancy_partner_administrator",
        "consultancy_partner",
      ),
      true,
    );
    assert.equal(
      isRoleAllowedForOrganisation("restricted_platform_administrator", "valo"),
      true,
    );
  });

  test("delegated administrators cannot grant above their own authority", () => {
    assert.equal(canGrantRole(["client_administrator"], "bid_manager"), true);
    assert.equal(
      canGrantRole(["client_administrator"], "client_organisation_owner"),
      false,
    );
    assert.equal(
      canGrantRole(
        ["valo_operations_administrator"],
        "restricted_platform_administrator",
      ),
      false,
    );
    assert.equal(
      canGrantRole(
        ["consultancy_partner_administrator"],
        "consultancy_partner_analyst_reviewer",
      ),
      true,
    );
  });
});

describe("tenant and temporary-access policy", () => {
  test("cross-tenant and unscoped resources fail closed", () => {
    assert.equal(canAccessResourceOrganisation("org-a", "org-a"), true);
    assert.equal(canAccessResourceOrganisation("org-a", "org-b"), false);
    assert.equal(canAccessResourceOrganisation("org-a", null), false);
    assert.equal(canAccessResourceOrganisation(null, "org-a"), false);
  });

  test("access expiry is exclusive and future access does not activate early", () => {
    const now = new Date("2026-08-08T12:00:00.000Z");
    assert.equal(
      isActiveAccessWindow(
        {
          status: "active",
          startsAt: "2026-08-08T11:00:00.000Z",
          expiresAt: "2026-08-08T13:00:00.000Z",
        },
        now,
      ),
      true,
    );
    assert.equal(
      isActiveAccessWindow(
        { status: "active", startsAt: "2026-08-08T13:00:00.000Z" },
        now,
      ),
      false,
    );
    assert.equal(
      isActiveAccessWindow(
        { status: "active", expiresAt: "2026-08-08T12:00:00.000Z" },
        now,
      ),
      false,
    );
    assert.equal(isActiveAccessWindow({ status: "revoked" }, now), false);
  });

  test("break-glass permissions are read-only", () => {
    assert.equal(BREAK_GLASS_ELIGIBLE_PERMISSIONS.has("document:read"), true);
    assert.equal(
      BREAK_GLASS_ELIGIBLE_PERMISSIONS.has("document:upload"),
      false,
    );
    assert.equal(
      BREAK_GLASS_ELIGIBLE_PERMISSIONS.has("report:sign_off"),
      false,
    );
    assert.equal(
      BREAK_GLASS_ELIGIBLE_PERMISSIONS.has("feature_flag:manage"),
      false,
    );
    assert.equal(BREAK_GLASS_ELIGIBLE_PERMISSIONS.has("package:read"), true);
    assert.equal(BREAK_GLASS_ELIGIBLE_PERMISSIONS.has("billing:read"), false);
    assert.equal(BREAK_GLASS_ELIGIBLE_PERMISSIONS.has("privacy:manage"), false);
  });

  test("partner-derived access is contribute-only and cannot release or administer a client", () => {
    for (const allowed of [
      "project:read",
      "document:upload",
      "requirement:write",
      "evidence:write",
      "defect:write",
      "draft:write",
    ] as const) {
      assert.equal(PARTNER_DERIVED_PERMISSIONS.has(allowed), true);
    }
    for (const forbidden of [
      "project:update",
      "project:delete",
      "document:delete",
      "requirement:review",
      "evidence:approve",
      "defect:review",
      "report:sign_off",
      "report:export",
      "package:sign_off",
      "package:export",
      "membership:manage",
      "audit:read",
      "billing:read",
      "order:create",
      "privacy:read",
      "privacy:manage",
    ] as const) {
      assert.equal(PARTNER_DERIVED_PERMISSIONS.has(forbidden), false);
    }

    const auditorProjection = partnerDerivedPermissionsForRoles([
      "read_only_auditor",
    ]);
    assert.equal(auditorProjection.has("document:read"), true);
    assert.equal(auditorProjection.has("document:upload"), false);
    assert.equal(auditorProjection.has("draft:write"), false);
    assert.equal(auditorProjection.has("report:sign_off"), false);
  });
});
