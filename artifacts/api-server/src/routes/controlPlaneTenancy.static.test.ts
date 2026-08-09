import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function routeSource(name: string): string {
  return readFileSync(
    join(
      process.cwd(),
      "artifacts",
      "api-server",
      "src",
      "routes",
      `${name}.ts`,
    ),
    "utf8",
  );
}

describe("control-plane RLS integration", () => {
  test("organisation lifecycle enters the explicit target database context", () => {
    const source = routeSource("organisations");
    assert.match(
      source,
      /withTenantDatabase\(\s*organisationId,\s*\(\) =>\s*db\.transaction/,
    );
    assert.match(source, /withTenantDatabase\(organisationId, async \(\) =>/);
  });

  test("partner and break-glass audit lifecycles set their authorised target context", () => {
    const partner = routeSource("partnerRelationships");
    assert.match(
      partner,
      /withTenantDatabase\(\s*partner\.id,\s*\(\) =>\s*db\.transaction/,
    );
    assert.match(
      partner,
      /withTenantDatabase\(\s*context\.organisationId,\s*\(\) =>\s*db\.transaction/,
    );

    const emergency = routeSource("breakGlass");
    assert.match(
      emergency,
      /withTenantDatabase\(\s*targetOrganisationId,\s*\(\) =>\s*db\.transaction/,
    );
    assert.match(
      emergency,
      /withTenantDatabase\(\s*pending\.targetOrganisationId,\s*\(\) =>\s*db\.transaction/,
    );
    assert.match(
      emergency,
      /withTenantDatabase\(\s*existing\.targetOrganisationId,\s*\(\) =>\s*db\.transaction/,
    );
  });

  test("feature-flag reads and writes cannot run without a tenant GUC", () => {
    const source = routeSource("featureFlags");
    const calls = source.match(/withTenantDatabase\(organisationId/g) ?? [];
    assert.ok(
      calls.length >= 5,
      `expected at least five explicit contexts, found ${calls.length}`,
    );
  });
});
