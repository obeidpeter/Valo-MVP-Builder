export interface VersionedReportState {
  id: string;
  version: number;
  status: string;
  docxPath?: string | null;
}

export type ReportExportDenial = "not_signed_off" | "stale_version";

export function isLatestReportVersion(
  candidate: VersionedReportState,
  latest: VersionedReportState | undefined,
): boolean {
  return Boolean(
    latest &&
    latest.id === candidate.id &&
    latest.version === candidate.version,
  );
}

/** Generating a new draft after release would stale the signed artefact and
 * strand the project in an unrecoverable state. Reopening is a separate,
 * governed workflow; the generator only operates in pre-release review. */
export function canGenerateReportForProjectStatus(status: string): boolean {
  return status === "review" || status === "defects" || status === "reporting";
}

export type ReportSignerDenial =
  | "reviewer_unassigned"
  | "signer_not_assigned_reviewer"
  | "active_direct_grant_required";

export function reportSignerDenial(params: {
  assignedReviewerId?: string | null;
  signerId?: string | null;
  accessSource?: "membership" | "partner" | "break_glass";
  membershipId?: string | null;
}): ReportSignerDenial | null {
  if (!params.assignedReviewerId) return "reviewer_unassigned";
  if (!params.signerId || params.signerId !== params.assignedReviewerId) {
    return "signer_not_assigned_reviewer";
  }
  if (params.accessSource !== "membership" || !params.membershipId) {
    return "active_direct_grant_required";
  }
  return null;
}

/** Only the latest signed report is exportable; an older signature is stale. */
export function reportExportDenial(
  candidate: VersionedReportState,
  latest: VersionedReportState | undefined,
): ReportExportDenial | null {
  if (candidate.status !== "signed_off") return "not_signed_off";
  return isLatestReportVersion(candidate, latest) ? null : "stale_version";
}

export type PackageExportDenial =
  | "project_not_signed_off"
  | "missing_latest_report"
  | "latest_report_not_signed_off"
  | "missing_signed_artifact"
  | "missing_archive_instruction";

export function packageExportDenial(params: {
  projectStatus: string;
  physicalArchiveInstruction?: string | null;
  latestReport?: VersionedReportState;
}): PackageExportDenial | null {
  if (
    params.projectStatus !== "signed_off" &&
    params.projectStatus !== "exported"
  ) {
    return "project_not_signed_off";
  }
  if (!params.latestReport) return "missing_latest_report";
  if (params.latestReport.status !== "signed_off")
    return "latest_report_not_signed_off";
  if (!params.latestReport.docxPath) return "missing_signed_artifact";
  if (!params.physicalArchiveInstruction?.trim())
    return "missing_archive_instruction";
  return null;
}

/** These states are derived by governed sign-off/export routes, never PATCH. */
export function isSystemManagedProjectStatus(status: unknown): boolean {
  return (
    status === "signed_off" || status === "exported" || status === "archived"
  );
}

/** Content inputs become immutable at release; reopening requires a separate
 * governed workflow that creates a new review/version boundary. */
export function isProjectContentImmutable(status: string): boolean {
  return (
    status === "signed_off" || status === "exported" || status === "archived"
  );
}
