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
    expect(platformHomeForRole("client_organisation_owner")).toBe("/portal");
    expect(platformHomeForRole("consultancy_partner_analyst_reviewer")).toBe(
      "/partner",
    );
    expect(platformHomeForRole("valo_quality_adviser")).toBe("/");
    expect(platformHomeForRole("restricted_platform_administrator")).toBe(
      "/security",
    );
  });

  it("gives client owners client, evidence, billing and notification surfaces only", () => {
    const items = navigationForRole("client_organisation_owner", disabledFlags);
    expect(items.map((item) => item.href)).toEqual([
      "/portal",
      "/evidence-readiness",
      "/billing",
      "/notifications",
    ]);
    expect(items.find((item) => item.href === "/portal")?.state).toBe(
      "pending_activation",
    );
    expect(items.some((item) => item.href === "/operations")).toBe(false);
    expect(items.some((item) => item.href === "/settings")).toBe(false);
  });

  it("prevents a client role from opening internal operations directly", () => {
    expect(
      getPlatformAccessDecision("client_admin", "operations", enabledFlags),
    ).toMatchObject({
      allowed: false,
      state: "denied",
    });
  });

  it("allows partner reviewers to review evidence but not administer billing", () => {
    const hrefs = navigationForRole(
      "consultancy_partner_analyst_reviewer",
      enabledFlags,
    ).map((item) => item.href);
    expect(hrefs).toContain("/partner");
    expect(hrefs).toContain("/evidence-readiness");
    expect(hrefs).toContain("/notifications");
    expect(hrefs).not.toContain("/billing");
    expect(hrefs).not.toContain("/settings");
  });

  it("preserves legacy reviewer access while hiding administration", () => {
    const hrefs = navigationForRole("reviewer", disabledFlags).map(
      (item) => item.href,
    );
    expect(hrefs).toContain("/");
    expect(hrefs).toContain("/operations");
    expect(hrefs).toContain("/evidence-readiness");
    expect(hrefs).not.toContain("/security");
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
    expect(hrefs).toEqual(["/security"]);
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
    expect(hrefs).toContain("/security");
    expect(hrefs).not.toContain("/settings");
  });

  it("accepts short role strings only as migration aliases", () => {
    expect(platformHomeForRole("client_owner")).toBe("/portal");
    expect(platformHomeForRole("partner_reviewer")).toBe("/partner");
    expect(platformHomeForRole("client_auditor")).toBe("/evidence-readiness");
    expect(
      navigationForRole("client_auditor", enabledFlags).map(
        (item) => item.href,
      ),
    ).toEqual(["/evidence-readiness", "/security"]);
  });
});
