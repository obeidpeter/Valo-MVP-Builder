import { describe, expect, it } from "vitest";
import {
  getPlatformAccessDecision,
  navigationForRole,
  platformFeatureFlags,
  platformHomeForRole,
} from "./platform-access";

const disabledFlags = platformFeatureFlags({});
const enabledFlags = platformFeatureFlags({
  VITE_FEATURE_CLIENT_PORTAL: "true",
  VITE_FEATURE_PARTNER_WORKSPACE: "TRUE",
  VITE_FEATURE_BILLING_ENTITLEMENTS: "true",
  VITE_FEATURE_NOTIFICATION_ADAPTERS: "true",
});

describe("v2.5 platform access", () => {
  it("keeps commercial capabilities disabled unless explicitly activated", () => {
    expect(disabledFlags).toEqual({
      clientPortal: false,
      partnerWorkspace: false,
      billingEntitlements: false,
      notificationAdapters: false,
    });
    expect(enabledFlags).toEqual({
      clientPortal: true,
      partnerWorkspace: true,
      billingEntitlements: true,
      notificationAdapters: true,
    });
  });

  it("routes client and partner roles to their own home surfaces", () => {
    expect(
      platformHomeForRole("client_organisation_owner", disabledFlags),
    ).toBe("/projects");
    expect(platformHomeForRole("client_organisation_owner", enabledFlags)).toBe(
      "/portal",
    );
    expect(platformHomeForRole("consultancy_partner_analyst_reviewer")).toBe(
      "/partner",
    );
    expect(platformHomeForRole("valo_quality_adviser")).toBe("/app");
    expect(platformHomeForRole("restricted_platform_administrator")).toBe(
      "/app/security",
    );
  });

  it("gives client owners the pursuit workbench plus their role surfaces", () => {
    const items = navigationForRole("client_organisation_owner", disabledFlags);
    expect(items.map((item) => item.href)).toEqual([
      "/projects",
      "/intelligence",
      "/portal",
      "/sbd",
      "/evidence-readiness",
      "/reports",
      "/clients",
      "/billing",
      "/notifications",
      "/organisation-settings",
    ]);
    expect(items.find((item) => item.href === "/portal")?.state).toBe(
      "pending_activation",
    );
    expect(items.some((item) => item.href === "/operations")).toBe(false);
    expect(items.some((item) => item.href === "/app")).toBe(false);
    expect(items.some((item) => item.href === "/settings")).toBe(false);
  });

  it("allows every canonical client role to open pursuit routes", () => {
    for (const role of [
      "client_organisation_owner",
      "client_administrator",
      "bid_manager",
      "contributor",
      "client_reviewer_approver",
    ] as const) {
      expect(
        getPlatformAccessDecision(role, "pursuit_workbench", enabledFlags),
      ).toMatchObject({ allowed: true, state: "active" });
      expect(
        navigationForRole(role, enabledFlags).map((item) => item.href),
      ).toContain("/projects");
    }
  });

  it("prevents a client role from opening internal operations directly", () => {
    expect(
      getPlatformAccessDecision("client_admin", "operations", enabledFlags),
    ).toMatchObject({
      allowed: false,
      state: "denied",
    });
  });

  it("allows partner reviewers to open selected-tenant pursuits but not administer billing", () => {
    const hrefs = navigationForRole(
      "consultancy_partner_analyst_reviewer",
      enabledFlags,
    ).map((item) => item.href);
    expect(hrefs).toContain("/partner");
    expect(hrefs).toContain("/evidence-readiness");
    expect(hrefs).toContain("/notifications");
    expect(hrefs).not.toContain("/billing");
    expect(hrefs).toContain("/projects");
    expect(hrefs).toContain("/intelligence");
    expect(hrefs).not.toContain("/settings");
    expect(
      getPlatformAccessDecision(
        "consultancy_partner_analyst_reviewer",
        "pursuit_workbench",
        enabledFlags,
      ),
    ).toMatchObject({ allowed: true, state: "active" });
  });

  it("allows a read-only auditor to browse pursuit records without administration", () => {
    const hrefs = navigationForRole("read_only_auditor", enabledFlags).map(
      (item) => item.href,
    );
    expect(hrefs).toContain("/projects");
    expect(hrefs).toContain("/intelligence");
    expect(hrefs).toContain("/reports");
    expect(hrefs).toContain("/app/security");
    expect(hrefs).not.toContain("/organisation-settings");
  });

  it("uses server-projected permissions to narrow partner navigation", () => {
    const permissions = [
      "project:read",
      "client:read",
      "requirement:read",
      "evidence:read",
      "report:read",
    ];
    const hrefs = navigationForRole(
      "consultancy_partner_administrator",
      enabledFlags,
      permissions,
    ).map((item) => item.href);
    expect(hrefs).toEqual([
      "/projects",
      "/sbd",
      "/evidence-readiness",
      "/reports",
      "/clients",
      "/notifications",
    ]);
    expect(
      platformHomeForRole(
        "consultancy_partner_administrator",
        enabledFlags,
        permissions,
      ),
    ).toBe("/projects");
  });

  it("shows the combined intelligence view only with its complete source-read set", () => {
    const basePermissions = [
      "client:read",
      "project:read",
      "document:read",
      "requirement:read",
      "evidence:read",
      "defect:read",
      "report:read",
      "draft:read",
    ];
    expect(
      navigationForRole("client_reviewer", enabledFlags, basePermissions).map(
        (item) => item.href,
      ),
    ).not.toContain("/intelligence");
    expect(
      navigationForRole("client_reviewer", enabledFlags, [
        ...basePermissions,
        "package:read",
      ]).map((item) => item.href),
    ).toContain("/intelligence");
  });

  it("preserves legacy reviewer access while hiding administration", () => {
    const hrefs = navigationForRole("reviewer", disabledFlags).map(
      (item) => item.href,
    );
    expect(hrefs).toContain("/app");
    expect(hrefs).toContain("/operations");
    expect(hrefs).toContain("/evidence-readiness");
    expect(hrefs).not.toContain("/app/security");
    expect(hrefs).not.toContain("/settings");
  });

  it("rejects unknown and unassigned roles fail-closed", () => {
    expect(
      getPlatformAccessDecision("mystery_role", "client_portal", enabledFlags)
        .allowed,
    ).toBe(false);
    expect(
      getPlatformAccessDecision("none", "workbench", enabledFlags).allowed,
    ).toBe(false);
  });

  it("keeps restricted platform administration out of tenant workspaces", () => {
    const hrefs = navigationForRole(
      "restricted_platform_administrator",
      enabledFlags,
    ).map((item) => item.href);
    expect(hrefs).toEqual(["/app/security"]);
    expect(
      getPlatformAccessDecision(
        "restricted_platform_administrator",
        "workbench",
        enabledFlags,
      ).allowed,
    ).toBe(false);
  });

  it("unions multiple active role grants without widening unknown roles", () => {
    const hrefs = navigationForRole(
      ["client_reviewer_approver", "read_only_auditor", "unknown_role"],
      enabledFlags,
    ).map((item) => item.href);
    expect(hrefs).toContain("/portal");
    expect(hrefs).toContain("/evidence-readiness");
    expect(hrefs).toContain("/app/security");
    expect(hrefs).not.toContain("/settings");
  });

  it("accepts short role strings only as migration aliases", () => {
    expect(platformHomeForRole("client_owner", disabledFlags)).toBe(
      "/projects",
    );
    expect(platformHomeForRole("client_owner", enabledFlags)).toBe("/portal");
    expect(platformHomeForRole("partner_reviewer")).toBe("/partner");
    expect(platformHomeForRole("client_auditor")).toBe("/evidence-readiness");
    expect(
      navigationForRole("client_auditor", enabledFlags).map(
        (item) => item.href,
      ),
    ).toEqual([
      "/projects",
      "/intelligence",
      "/sbd",
      "/evidence-readiness",
      "/reports",
      "/clients",
      "/app/security",
    ]);
  });
});
