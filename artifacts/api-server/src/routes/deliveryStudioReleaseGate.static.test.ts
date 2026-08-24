import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const reportsRoute = readFileSync(
  new URL("./reports.ts", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");

test("release checks only current response versions and reject stale red-team approval", () => {
  const gateStart = reportsRoute.indexOf(
    "async function gatherSupplementalReleaseGates(",
  );
  const gateEnd = reportsRoute.indexOf(
    'router.get(\n  "/projects/:id/reports"',
    gateStart,
  );
  assert.ok(gateStart >= 0 && gateEnd > gateStart);
  const gate = reportsRoute.slice(gateStart, gateEnd);

  assert.match(
    gate,
    /eq\(draftVersions\.versionNumber, drafts\.currentVersionNumber\)/u,
  );
  assert.match(gate, /computeCurrentDeliveryStudioSourceSnapshotHash/u);
  assert.match(
    gate,
    /latestRedTeamRun\.sourceSnapshotHash === currentSourceSnapshotHash/u,
  );
  assert.match(gate, /loadRedTeamApprovalAttestation/u);
  assert.match(gate, /isAttestedRedTeamApproval/u);
  assert.match(gate, /finding\.status !== "resolved"/u);
});

test("report sign-off and package export both re-evaluate the exact delivery source", () => {
  assert.match(
    reportsRoute,
    /gatherSupplementalReleaseGates\(reportOrganisationId, report\.projectId\)/u,
  );
  assert.match(
    reportsRoute,
    /gatherSupplementalReleaseGates\(project\.organisationId, projectId\)/u,
  );
  assert.match(
    reportsRoute,
    /eq\(projects\.version, lockedProject\.version\)/u,
  );
  assert.match(
    reportsRoute,
    /gatherSupplementalReleaseGates\([\s\S]*?report\.projectId,[\s\S]*?tx,[\s\S]*?\)/u,
  );
  assert.match(reportsRoute, /\.for\("update"\)/u);
  assert.match(reportsRoute, /\.for\("share"\)/u);
  assert.match(
    reportsRoute,
    /const currentReadiness = evaluateSubmissionReadiness/u,
  );
  assert.match(reportsRoute, /const currentDefects = await tx/u);
  assert.match(reportsRoute, /const currentBoqChecks = await tx/u);
  assert.match(
    reportsRoute,
    /await commitTenantDatabaseBeforeResponse\(req\)/u,
  );
});
