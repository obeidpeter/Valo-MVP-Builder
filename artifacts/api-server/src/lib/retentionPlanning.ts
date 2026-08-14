import { MS_PER_DAY } from "./expiryTelemetry";
import type { ProjectStatus } from "./projectWorkflow";

/**
 * Engagements whose work has concluded and are therefore eligible to have a
 * retention request auto-opened. In-progress states are deliberately excluded
 * (data must not be scheduled for deletion while the review is still live), and
 * `archived` is excluded because its content has already been purged.
 */
export const RETENTION_ELIGIBLE_STATUSES: ReadonlySet<ProjectStatus> = new Set([
  "signed_off",
  "exported",
]);

export interface RetentionScanProject {
  id: string;
  status: string;
  /** The engagement's relevant date — the anchor the retention clock counts from. */
  relevantDate: Date;
  /** True if a retention request is already open for this project (dedup). */
  hasPendingRequest: boolean;
}

export interface RetentionScanInput {
  projects: RetentionScanProject[];
  /** Configured retention window in days (from the app_config singleton). */
  retentionDefaultDays: number;
  now: Date;
}

export interface RetentionScanCandidate {
  projectId: string;
  /**
   * The moment the retention window elapsed (relevantDate + window). It is in
   * the past for every candidate — the retention action is already due — so it
   * honestly records how overdue the deletion is.
   */
  dueAt: Date;
}

/**
 * Pure retention scan (FR-RET automation): given concluded engagements, the
 * configured retention window and a reference time, decide which projects need
 * a retention request opened. A project is a candidate when it is a concluded
 * engagement, has no request already open, and its retention window has fully
 * elapsed. The clock is inclusive at the boundary (>= window) so a request is
 * opened the moment the window is reached, never a day late.
 */
export function planRetentionScan(
  input: RetentionScanInput,
): RetentionScanCandidate[] {
  if (
    !Number.isFinite(input.retentionDefaultDays) ||
    input.retentionDefaultDays <= 0
  ) {
    return [];
  }
  const windowMs = input.retentionDefaultDays * MS_PER_DAY;
  const nowMs = input.now.getTime();
  return input.projects
    .filter((p) => RETENTION_ELIGIBLE_STATUSES.has(p.status as ProjectStatus))
    .filter((p) => !p.hasPendingRequest)
    .map((p) => ({ project: p, dueAtMs: p.relevantDate.getTime() + windowMs }))
    .filter(({ dueAtMs }) => Number.isFinite(dueAtMs) && dueAtMs <= nowMs)
    .map(({ project, dueAtMs }) => ({
      projectId: project.id,
      dueAt: new Date(dueAtMs),
    }));
}
