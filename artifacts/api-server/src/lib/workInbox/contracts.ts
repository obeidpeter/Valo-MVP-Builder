export const WORK_INBOX_DEFAULT_LIMIT = 50;
export const WORK_INBOX_MAX_LIMIT = 100;
/** Maximum native candidates inspected; overflow fails closed with 503. */
export const WORK_INBOX_NATIVE_CANDIDATE_LIMIT = 5_000;

export type WorkInboxKind =
  | "work_item"
  | "mission"
  | "post_award_item"
  | "retainer_request";
export type WorkInboxGroup = "overdue" | "today" | "upcoming" | "unscheduled";

export interface WorkInboxItem {
  /** Non-reversible, tenant-bound UI identity; never a persisted row ID. */
  key: string;
  assignment: "owned" | "unassigned";
  kind: WorkInboxKind;
  title: string;
  projectTitle: string;
  status: string;
  dueAt: string | null;
  priority: "low" | "normal" | "high" | "critical" | null;
  href: string;
}

export interface WorkInboxSnapshot {
  organisationId: string;
  generatedAt: string;
  businessTimeZone: "Africa/Lagos";
  limit: number;
  truncated: boolean;
  restrictedContent: true;
  groups: Record<WorkInboxGroup, WorkInboxItem[]>;
}

export class WorkInboxUnavailableError extends Error {
  constructor() {
    super("The work inbox is unavailable");
    this.name = "WorkInboxUnavailableError";
  }
}
