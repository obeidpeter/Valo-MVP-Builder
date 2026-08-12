export type WorkInboxGroup = "overdue" | "today" | "upcoming" | "unscheduled";

export interface WorkInboxItem {
  key: string;
  assignment: "owned" | "unassigned";
  kind: "work_item" | "mission" | "post_award_item" | "retainer_request";
  title: string;
  projectTitle: string;
  status: string;
  dueAt: string | null;
  priority: "low" | "normal" | "high" | "critical" | null;
  href: string;
}

export interface WorkInboxSnapshot {
  generatedAt: string;
  limit: number;
  truncated: boolean;
  groups: Record<WorkInboxGroup, WorkInboxItem[]>;
}

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const GROUPS = ["overdue", "today", "upcoming", "unscheduled"] as const;
const KINDS = new Set([
  "work_item",
  "mission",
  "post_award_item",
  "retainer_request",
]);
const PRIORITIES = new Set(["low", "normal", "high", "critical"]);

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Work inbox is unavailable");
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error("Work inbox contract is unavailable");
  }
}

function text(value: unknown, max: number): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > max ||
    /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value)
  ) {
    throw new Error("Work inbox content is unavailable");
  }
  return value;
}

function safeHref(value: unknown): string {
  const href = text(value, 256);
  if (href === "/commercial-retainer") return href;
  const parsed = new URL(href, "https://valo.invalid");
  const projectId = parsed.searchParams.get("project");
  if (
    parsed.origin !== "https://valo.invalid" ||
    parsed.pathname !== "/pursuit-operations" ||
    parsed.searchParams.size !== 1 ||
    !projectId ||
    !UUID_PATTERN.test(projectId)
  ) {
    throw new Error("Work inbox link is unavailable");
  }
  return href;
}

function item(value: unknown): WorkInboxItem {
  const row = object(value);
  exact(row, [
    "key",
    "assignment",
    "kind",
    "title",
    "projectTitle",
    "status",
    "dueAt",
    "priority",
    "href",
  ]);
  const key = text(row.key, 64);
  const kind = text(row.kind, 32);
  const priority = row.priority === null ? null : text(row.priority, 16);
  if (
    !HASH_PATTERN.test(key) ||
    (row.assignment !== "owned" && row.assignment !== "unassigned") ||
    !KINDS.has(kind) ||
    (priority !== null && !PRIORITIES.has(priority)) ||
    (row.dueAt !== null &&
      (typeof row.dueAt !== "string" ||
        !Number.isFinite(Date.parse(row.dueAt))))
  ) {
    throw new Error("Work inbox item is unavailable");
  }
  return {
    key,
    assignment: row.assignment,
    kind: kind as WorkInboxItem["kind"],
    title: text(row.title, 1_024),
    projectTitle: text(row.projectTitle, 1_024),
    status: text(row.status, 64),
    dueAt: row.dueAt,
    priority: priority as WorkInboxItem["priority"],
    href: safeHref(row.href),
  };
}

export function adaptWorkInbox(
  value: unknown,
  organisationId: string,
): WorkInboxSnapshot {
  const payload = object(value);
  exact(payload, [
    "organisationId",
    "generatedAt",
    "businessTimeZone",
    "limit",
    "truncated",
    "restrictedContent",
    "groups",
  ]);
  if (
    payload.organisationId !== organisationId ||
    payload.businessTimeZone !== "Africa/Lagos" ||
    payload.restrictedContent !== true ||
    typeof payload.limit !== "number" ||
    !Number.isSafeInteger(payload.limit) ||
    payload.limit < 1 ||
    payload.limit > 100 ||
    typeof payload.truncated !== "boolean" ||
    typeof payload.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(payload.generatedAt))
  ) {
    throw new Error("Work inbox scope is unavailable");
  }
  const rawGroups = object(payload.groups);
  exact(rawGroups, GROUPS);
  const keys = new Set<string>();
  let count = 0;
  const groups = Object.fromEntries(
    GROUPS.map((group) => {
      const rows = rawGroups[group];
      if (!Array.isArray(rows)) throw new Error("Work inbox group unavailable");
      const items = rows.map(item);
      for (const entry of items) {
        if (keys.has(entry.key))
          throw new Error("Work inbox identity collision");
        keys.add(entry.key);
      }
      count += items.length;
      return [group, items];
    }),
  ) as Record<WorkInboxGroup, WorkInboxItem[]>;
  if (count > payload.limit) throw new Error("Work inbox bound exceeded");
  return {
    generatedAt: new Date(payload.generatedAt).toISOString(),
    limit: payload.limit,
    truncated: payload.truncated,
    groups,
  };
}
