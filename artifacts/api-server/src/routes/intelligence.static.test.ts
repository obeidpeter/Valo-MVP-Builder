import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./intelligence.ts", import.meta.url),
  "utf8",
);
const snapshotSource = readFileSync(
  new URL("../lib/intelligence/snapshot.ts", import.meta.url),
  "utf8",
);
const routes = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const openApi = readFileSync(
  new URL("../../../../lib/api-spec/openapi.yaml", import.meta.url),
  "utf8",
);
const reactClient = readFileSync(
  new URL(
    "../../../../lib/api-client-react/src/generated/api.ts",
    import.meta.url,
  ),
  "utf8",
);
const zodClient = readFileSync(
  new URL("../../../../lib/api-zod/src/generated/api.ts", import.meta.url),
  "utf8",
);
const protectedRoutes = readFileSync(
  new URL("../../../valo-workbench/src/protected-routes.tsx", import.meta.url),
  "utf8",
);
const platformAccess = readFileSync(
  new URL(
    "../../../valo-workbench/src/lib/platform-access.ts",
    import.meta.url,
  ),
  "utf8",
);

test("Intelligence Centre is tenant-bound, read-only and model-free", () => {
  assert.match(source, /"\/projects\/:id\/intelligence"/);
  for (const permission of [
    "client:read",
    "project:read",
    "document:read",
    "requirement:read",
    "evidence:read",
    "defect:read",
    "report:read",
    "draft:read",
    "package:read",
  ]) {
    assert.match(source, new RegExp(`"${permission}"`));
  }
  assert.match(
    source,
    /INTELLIGENCE_READ_PERMISSIONS\.map\(\(permission\)\s*=>\s*requirePermissionOrLegacy\(permission\)/,
  );
  assert.match(source, /buildIntelligenceCentreSnapshot/);
  assert.match(source, /productionAiEnabled:\s*false/);
  assert.match(source, /Cache-Control", "private, no-store"/);
  assert.doesNotMatch(source, /executeProjectAi|executeAiGatewayRequest/);
  assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(/);
  assert.doesNotMatch(source, /writeAudit/);
});

test("Intelligence Centre joins citation provenance and scopes opportunity reads to the project tender", () => {
  assert.match(source, /\.from\(requirementCitations\)/);
  assert.match(source, /\.innerJoin\(\s*documentVersions/);
  assert.match(source, /\.innerJoin\(\s*documents/);
  assert.match(source, /\.leftJoin\(\s*users/);
  assert.match(
    source,
    /sourceSnippetHash:\s*requirementCitations\.sourceSnippetHash/,
  );
  assert.match(
    source,
    /verifiedByUserId:\s*requirementCitations\.verifiedByUserId/,
  );
  assert.match(source, /verifiedByName:\s*users\.name/);
  assert.match(source, /verifiedAt:\s*requirementCitations\.verifiedAt/);
  assert.match(source, /eq\(documents\.projectId, projectId\)/);
  assert.match(
    source,
    /\.from\(tenders\)\s*\.where\(eq\(tenders\.reference, project\.tenderRef\)\)/,
  );
  assert.match(source, /sourceDocId:\s*check\.sourceDocId/);
  assert.match(
    source,
    /\.from\(boqChecks\)\.where\(eq\(boqChecks\.projectId, projectId\)\)/,
  );
  assert.match(source, /version:\s*report\.version/);
  assert.match(
    source,
    /\.from\(reports\)[\s\S]*?\.orderBy\(desc\(reports\.version\)\)[\s\S]*?\.limit\(1\)/,
  );
});

test("public Intelligence citations match the closed OpenAPI DTO and keep proof fields internal", () => {
  const contractStart = openApi.indexOf("    IntelligenceCitation:");
  const contractEnd = openApi.indexOf(
    "    AiModelConfigurationStatus:",
    contractStart,
  );
  const contract = openApi.slice(contractStart, contractEnd);
  const dto = snapshotSource.match(
    /export interface IntelligenceCitationSnapshot \{[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(contractStart >= 0 && contractEnd > contractStart);
  assert.match(contract, /additionalProperties:\s*false/);
  assert.match(contract, /required:\s*\[id, sourceName, locator\]/);
  assert.match(contract, /id:\s*\{ type: string \}/);
  assert.match(contract, /sourceName:\s*\{ type: string \}/);
  assert.match(contract, /locator:\s*\{ type: string \}/);
  assert.match(contract, /excerpt:\s*\{ type: string, maxLength: 280 \}/);
  assert.ok(dto);
  assert.doesNotMatch(
    dto,
    /sourceSnippetHash|sourceVersionSha256|verifiedByUserId|verifiedByName|verifiedAt|malwareStatus|quarantineStatus|lifecycleState/,
  );
});

test("preflight recognizes only signed terminal package states", () => {
  assert.match(
    snapshotSource,
    /FINAL_PACKAGE_STATES = new Set\(\["signed"\]\)/,
  );
  assert.match(snapshotSource, /FINAL_PACKAGE_STATES\.has\(item\.status\)/);
});

test("Intelligence Centre is registered only after tenant middleware", () => {
  const databaseBoundary = routes.indexOf("router.use(attachTenantDatabase)");
  const intelligenceRoute = routes.indexOf("router.use(intelligenceRouter)");
  assert.ok(databaseBoundary >= 0);
  assert.ok(intelligenceRoute > databaseBoundary);
});

test("Intelligence Centre OpenAPI, generated clients and protected UI stay connected", () => {
  assert.match(openApi, /^  \/projects\/\{id\}\/intelligence:/m);
  assert.match(openApi, /operationId: getProjectIntelligence/);
  assert.match(openApi, /minItems: 22[\s\S]*maxItems: 22/);
  assert.match(reactClient, /export function useGetProjectIntelligence/);
  assert.match(zodClient, /export const GetProjectIntelligenceResponse/);
  assert.match(protectedRoutes, /path="\/intelligence"/);
  assert.match(
    protectedRoutes,
    /path="\/intelligence"[\s\S]*RequireArea area="pursuit_workbench"/,
  );
  assert.match(platformAccess, /href: "\/intelligence"/);
  assert.match(platformAccess, /label: "Intelligence Centre"/);
});
