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
    ["./pages/project-tabs/boq-tab.tsx", ["defect:write", "defect:review"]],
    ["./pages/project-tabs/risk-tab.tsx", ["defect:review"]],
    ["./pages/client-details.tsx", ["client:update", "project:create"]],
  ])("gates %s with the API permissions", (path, permissions) => {
    const content = source(path);
    expect(content).toContain("useOrganisationPermission");
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

  it("sends the quoted defect version required by optimistic concurrency", () => {
    const content = source("./pages/project-tabs/defects-tab.tsx");
    expect(content).toContain('headers: { "If-Match": `"${defect.version}"` }');
    expect(content).toContain("updateDefectRequest(defect.id");
  });
});
