import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  canGenerateReportForProjectStatus,
  isProjectContentImmutable,
  isSystemManagedProjectStatus,
  packageExportDenial,
  reportExportDenial,
  reportSignerDenial,
} from "./reportPolicy";

describe("report and package release policy", () => {
  const signed = {
    id: "r2",
    version: 2,
    status: "signed_off",
    docxPath: "/r2.docx",
  };

  test("only the latest signed report can be exported", () => {
    const stale = {
      id: "r1",
      version: 1,
      status: "signed_off",
      docxPath: "/r1.docx",
    };
    assert.equal(reportExportDenial(signed, signed), null);
    assert.equal(reportExportDenial(stale, signed), "stale_version");
    assert.equal(
      reportExportDenial(
        { ...signed, status: "draft" },
        { ...signed, status: "draft" },
      ),
      "not_signed_off",
    );
  });

  test("package export fails closed on unsigned or stale report state", () => {
    const base = {
      projectStatus: "signed_off",
      physicalArchiveInstruction: "Return originals",
    };
    assert.equal(packageExportDenial({ ...base, latestReport: signed }), null);
    assert.equal(packageExportDenial({ ...base }), "missing_latest_report");
    assert.equal(
      packageExportDenial({
        ...base,
        latestReport: { ...signed, status: "draft" },
      }),
      "latest_report_not_signed_off",
    );
    assert.equal(
      packageExportDenial({
        ...base,
        latestReport: { ...signed, docxPath: null },
      }),
      "missing_signed_artifact",
    );
    assert.equal(
      packageExportDenial({
        ...base,
        physicalArchiveInstruction: "",
        latestReport: signed,
      }),
      "missing_archive_instruction",
    );
    assert.equal(
      packageExportDenial({
        ...base,
        projectStatus: "reporting",
        latestReport: signed,
      }),
      "project_not_signed_off",
    );
  });

  test("signed-off and exported states cannot be set by generic project patch", () => {
    assert.equal(isSystemManagedProjectStatus("signed_off"), true);
    assert.equal(isSystemManagedProjectStatus("exported"), true);
    assert.equal(isSystemManagedProjectStatus("archived"), true);
    assert.equal(isSystemManagedProjectStatus("reporting"), false);
  });

  test("released project content is immutable until a governed reopen", () => {
    assert.equal(isProjectContentImmutable("reporting"), false);
    assert.equal(isProjectContentImmutable("signed_off"), true);
    assert.equal(isProjectContentImmutable("exported"), true);
    assert.equal(isProjectContentImmutable("archived"), true);
  });

  test("report generation is confined to pre-release review states", () => {
    assert.equal(canGenerateReportForProjectStatus("review"), true);
    assert.equal(canGenerateReportForProjectStatus("defects"), true);
    assert.equal(canGenerateReportForProjectStatus("reporting"), true);
    assert.equal(canGenerateReportForProjectStatus("signed_off"), false);
    assert.equal(canGenerateReportForProjectStatus("exported"), false);
    assert.equal(canGenerateReportForProjectStatus("archived"), false);
  });

  test("only the assigned reviewer acting through an active direct grant may sign", () => {
    const valid = {
      assignedReviewerId: "reviewer-1",
      signerId: "reviewer-1",
      accessSource: "membership" as const,
      membershipId: "membership-1",
    };
    assert.equal(reportSignerDenial(valid), null);
    assert.equal(
      reportSignerDenial({ ...valid, signerId: "reviewer-2" }),
      "signer_not_assigned_reviewer",
    );
    assert.equal(
      reportSignerDenial({ ...valid, accessSource: "partner" }),
      "active_direct_grant_required",
    );
    assert.equal(
      reportSignerDenial({ ...valid, membershipId: null }),
      "active_direct_grant_required",
    );
  });
});
