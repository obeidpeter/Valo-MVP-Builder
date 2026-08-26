import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("server-permission action gates", () => {
  it.each([
    [
      "./pages/project-tabs/documents-tab.tsx",
      ["document:upload", "document:delete"],
    ],
    [
      "./pages/project-tabs/requirements-tab.tsx",
      ["requirement:write", "requirement:review"],
    ],
    [
      "./pages/project-tabs/evidence-tab.tsx",
      ["evidence:write", "evidence:approve"],
    ],
    ["./pages/project-tabs/defects-tab.tsx", ["defect:write", "defect:review"]],
    ["./components/client-vault.tsx", ["evidence:write"]],
    [
      "./components/client-capability.tsx",
      ["evidence:write", "evidence:approve"],
    ],
    ["./pages/sbd.tsx", ["requirement:review"]],
    ["./pages/sbd-details.tsx", ["requirement:review"]],
    ["./pages/project-tabs/boq-tab.tsx", ["defect:write"]],
    [
      "./pages/project-tabs/boq-commercial-verification.tsx",
      ["defect:write", "defect:review"],
    ],
    ["./pages/project-tabs/risk-tab.tsx", ["defect:review"]],
    ["./pages/client-details.tsx", ["client:update", "project:create"]],
    [
      "./pages/project-tabs/delivery-studio-tab.tsx",
      ["draft:write", "draft:review", "package:generate", "package:sign_off"],
    ],
    ["./pages/portfolio-intelligence.tsx", ["analytics:read"]],
    [
      "./pages/tender-context-route.tsx",
      ["requirement:write", "intelligence:review"],
    ],
    [
      "./components/intelligence/addendum-impact-centre.tsx",
      ["intelligence:review", "project:update"],
    ],
  ])("gates %s with the API permissions", (path, permissions) => {
    const content = source(path);
    // Older surfaces gate per-permission hooks; the wave-1/3 surfaces derive
    // capability flags from the effective permission set. Either mechanism
    // binds the UI affordance to the server-side permission strings below.
    expect(
      content.includes("useOrganisationPermission") ||
        content.includes("effectivePermissions"),
    ).toBe(true);
    for (const permission of permissions) expect(content).toContain(permission);
  });

  it("loads selected-tenant reviewer choices from membership permission, never legacy role", () => {
    const content = source("./pages/projects.tsx");
    expect(content).toContain('useOrganisationPermission("membership:read")');
    expect(content).toContain(
      "enabled: canCreateProject && canReadMemberships",
    );
    expect(content).not.toContain('me?.role === "admin"');
  });

  it("route-gates organisation settings with membership management", () => {
    const content = source("./lib/platform-access.ts");
    expect(content).toContain('organisation_settings: "membership:manage"');
    expect(content).toMatch(
      /href: "\/organisation-settings"[\s\S]*?requiredPermission: "membership:manage"/,
    );
  });

  it("gates the dashboard area on analytics:read at the area level", () => {
    const content = source("./lib/platform-access.ts");
    // The /app nav item deliberately carries no per-item requiredPermission:
    // navigationForRole already routes every item through the area decision,
    // and this area-level entry is the single authoritative dashboard gate
    // for both the nav link and the route.
    expect(content).toContain('workbench: "analytics:read"');
    expect(content).toMatch(
      /const requiredPermission = AREA_REQUIRED_PERMISSION\[area\];/,
    );
  });

  it("sends the quoted defect version required by optimistic concurrency", () => {
    const content = source("./pages/project-tabs/defects-tab.tsx");
    expect(content).toContain('headers: { "If-Match": `"${defect.version}"` }');
    expect(content).toContain("updateDefectRequest(defect.id");
  });
});
