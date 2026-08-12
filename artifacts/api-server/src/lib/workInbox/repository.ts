import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import type { CurrentDirectAuthority } from "../directMembershipAuthority";
import {
  WORK_INBOX_MAX_LIMIT,
  WORK_INBOX_NATIVE_CANDIDATE_LIMIT,
  WorkInboxUnavailableError,
  type WorkInboxGroup,
  type WorkInboxItem,
  type WorkInboxKind,
  type WorkInboxSnapshot,
} from "./contracts";

const OPERATIONS_SCHEMA = "valo.operations-suite/v1";
const RETAINER_SCHEMA = "valo.retainer-service-request@v1";
const RETAINER_PREFIX = "[RETAINER-DESK:v1:";
const MAX_ENVELOPE_CODE_UNITS = 524_288;
const MAX_ENVELOPE_BYTES = 2_097_152;
const BUSINESS_TIME_ZONE = "Africa/Lagos" as const;
const PRIORITIES = new Set(["low", "normal", "high", "critical"]);

interface ProjectedRow {
  overflow: boolean;
  id: string;
  organisationId: string;
  projectId: string;
  projectTitle: string;
  rowTitle: string;
  ownerMembershipId: string | null;
  rowDueAt: Date | string | null;
  rowPriority: string;
  rowStatus: string;
  rowVersion: number | string;
  codeUnits: number | string | null;
  bytes: number | string | null;
  schema: string | null;
  recordId: string | null;
  recordOrganisationId: string | null;
  recordProjectId: string | null;
  recordVersion: number | string | null;
  kind: string | null;
  ownerUserId: string | null;
  delegateUserId: string | null;
  recordOwnerMembershipId: string | null;
  title: string | null;
  summary: string | null;
  status: string | null;
  dueAt: string | null;
  startsAt: string | null;
  priority: string | null;
  sla: string | null;
}

function finiteInteger(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new WorkInboxUnavailableError();
  return parsed;
}

function text(value: unknown, max: number): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > max ||
    /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value)
  ) {
    throw new WorkInboxUnavailableError();
  }
  return value;
}

function instant(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new WorkInboxUnavailableError();
  }
  return new Date(value).toISOString();
}

function rowInstant(value: Date | string | null): string | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new WorkInboxUnavailableError();
  return parsed.toISOString();
}

function projectedItem(
  row: ProjectedRow,
  authority: CurrentDirectAuthority,
): WorkInboxItem {
  const codeUnits = finiteInteger(row.codeUnits);
  const bytes = finiteInteger(row.bytes);
  if (
    codeUnits < 1 ||
    codeUnits > MAX_ENVELOPE_CODE_UNITS ||
    bytes < 1 ||
    bytes > MAX_ENVELOPE_BYTES
  ) {
    throw new WorkInboxUnavailableError();
  }
  const version = finiteInteger(row.rowVersion);
  if (
    row.recordId !== row.id ||
    row.recordOrganisationId !== row.organisationId ||
    row.recordProjectId !== row.projectId ||
    finiteInteger(row.recordVersion) !== version ||
    version < 1 ||
    row.status !== row.rowStatus
  ) {
    throw new WorkInboxUnavailableError();
  }
  const isRetainer = row.rowTitle.startsWith(RETAINER_PREFIX);
  const kind = isRetainer ? "retainer_request" : row.kind;
  if (
    (isRetainer && row.schema !== RETAINER_SCHEMA) ||
    (!isRetainer && row.schema !== OPERATIONS_SCHEMA) ||
    (kind !== "work_item" &&
      kind !== "mission" &&
      kind !== "post_award_item" &&
      kind !== "retainer_request")
  ) {
    throw new WorkInboxUnavailableError();
  }
  const typedKind = kind as WorkInboxKind;
  const owner =
    typedKind === "retainer_request"
      ? row.recordOwnerMembershipId
      : typedKind === "mission"
        ? row.delegateUserId
        : row.ownerUserId;
  const assignment =
    typedKind === "retainer_request"
      ? owner === authority.membershipId && row.ownerMembershipId === owner
        ? "owned"
        : null
      : owner === authority.actorUserId
        ? "owned"
        : owner === null && authority.permissions.has("project:update")
          ? "unassigned"
          : null;
  if (!assignment) throw new WorkInboxUnavailableError();
  const dueAt = instant(typedKind === "mission" ? row.startsAt : row.dueAt);
  if (dueAt !== rowInstant(row.rowDueAt)) throw new WorkInboxUnavailableError();
  const priority =
    typedKind === "work_item"
      ? text(row.priority, 16)
      : typedKind === "retainer_request"
        ? row.sla === "priority"
          ? "high"
          : row.sla === "standard"
            ? "normal"
            : ""
        : "normal";
  if (!PRIORITIES.has(priority) || priority !== row.rowPriority) {
    throw new WorkInboxUnavailableError();
  }
  const title = text(
    typedKind === "retainer_request" ? row.summary : row.title,
    1_024,
  );
  const key = createHash("sha256")
    .update("valo.work-inbox-ui-key/v1\0", "utf8")
    .update(row.organisationId, "utf8")
    .update("\0", "utf8")
    .update(row.projectId, "utf8")
    .update("\0", "utf8")
    .update(row.id, "utf8")
    .update("\0", "utf8")
    .update(String(version), "utf8")
    .digest("hex");
  return {
    key,
    assignment,
    kind: typedKind,
    title,
    projectTitle: text(row.projectTitle, 1_024),
    status: text(row.rowStatus, 64),
    dueAt,
    priority: priority as WorkInboxItem["priority"],
    href:
      typedKind === "retainer_request"
        ? "/commercial-retainer"
        : `/pursuit-operations?project=${encodeURIComponent(row.projectId)}`,
  };
}

function watDay(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const valueParts = [read("year"), read("month"), read("day")];
  if (valueParts.some((part) => !part)) throw new WorkInboxUnavailableError();
  return valueParts.join("-");
}

function groupFor(dueAt: string | null, today: string): WorkInboxGroup {
  if (!dueAt) return "unscheduled";
  const day = watDay(new Date(dueAt));
  if (day < today) return "overdue";
  if (day === today) return "today";
  return "upcoming";
}

/**
 * Reads only an authorized `limit + 1` projection. SQL performs capability,
 * assignment, terminal-state and urgency filtering before descriptions are
 * projected; only bounded JSON fields cross the database boundary.
 */
export async function readWorkInbox(
  authority: CurrentDirectAuthority,
  limit: number,
  now = new Date(),
): Promise<WorkInboxSnapshot> {
  if (limit < 1 || limit > WORK_INBOX_MAX_LIMIT) {
    throw new WorkInboxUnavailableError();
  }
  const canUpdate = authority.permissions.has("project:update");
  const canProjectRead = authority.permissions.has("project:read");
  const canReadRetainer =
    authority.permissions.has("billing:read") &&
    authority.permissions.has("entitlement:read");
  const result = await db.execute(sql`
    WITH native_candidates AS MATERIALIZED (
      SELECT task.id
      FROM work_tasks AS task
      JOIN projects AS project
        ON project.id = task.project_id
       AND project.organisation_id = task.organisation_id
      WHERE task.organisation_id = ${authority.organisationId}::uuid
        AND project.status <> 'archived'
        AND (
          (
            (
              left(task.title, length('[OPS:work_item]')) = '[OPS:work_item]'
              OR left(task.title, length('[OPS:mission]')) = '[OPS:mission]'
              OR left(task.title, length('[OPS:post_award_item]')) = '[OPS:post_award_item]'
            )
            AND ${canProjectRead}
            AND task.status NOT IN ('done', 'cancelled', 'completed', 'missed', 'satisfied')
          )
          OR (
            task.title LIKE ${`${RETAINER_PREFIX}%`}
            AND ${canReadRetainer}
            AND project.status NOT IN ('signed_off', 'exported')
            AND task.owner_membership_id = ${authority.membershipId}::uuid
            AND task.status NOT IN ('completed', 'cancelled')
          )
        )
      ORDER BY task.id
      LIMIT ${WORK_INBOX_NATIVE_CANDIDATE_LIMIT + 1}
    ), candidate_guard AS MATERIALIZED (
      SELECT count(*)::integer AS candidate_count FROM native_candidates
    ), preflight AS MATERIALIZED (
      SELECT
        task.*,
        project.tender_title AS project_title,
        project.status AS project_status,
        char_length(task.description) AS code_units,
        octet_length(task.description) AS bytes,
        CASE
          WHEN char_length(task.description) BETWEEN 1 AND ${MAX_ENVELOPE_CODE_UNITS}
           AND octet_length(task.description) BETWEEN 1 AND ${MAX_ENVELOPE_BYTES}
          THEN task.description::jsonb
          ELSE NULL
        END AS envelope
      FROM work_tasks AS task
      JOIN native_candidates AS candidate ON candidate.id = task.id
      JOIN projects AS project
        ON project.id = task.project_id
       AND project.organisation_id = task.organisation_id
      CROSS JOIN candidate_guard
      WHERE candidate_guard.candidate_count <= ${WORK_INBOX_NATIVE_CANDIDATE_LIMIT}
    ), authorized AS (
      SELECT *,
        CASE WHEN title LIKE '[OPS:%' THEN envelope #>> '{record,kind}' ELSE 'retainer_request' END AS projected_kind,
        CASE WHEN title LIKE '[OPS:mission]%' THEN envelope #>> '{record,startsAt}' ELSE envelope #>> '{record,dueAt}' END AS projected_due_at
      FROM preflight
      WHERE
        (code_units > ${MAX_ENVELOPE_CODE_UNITS} OR bytes > ${MAX_ENVELOPE_BYTES})
        OR (
          (
            left(title, length('[OPS:work_item]')) = '[OPS:work_item]'
            OR left(title, length('[OPS:mission]')) = '[OPS:mission]'
            OR left(title, length('[OPS:post_award_item]')) = '[OPS:post_award_item]'
          )
          AND ${canProjectRead}
          AND status NOT IN ('done', 'cancelled', 'completed', 'missed', 'satisfied')
          AND envelope #>> '{record,kind}' IN ('work_item', 'mission', 'post_award_item')
          AND (
            project_status NOT IN ('signed_off', 'exported')
            OR envelope #>> '{record,kind}' = 'post_award_item'
          )
          AND (
            (
              envelope #>> '{record,kind}' = 'mission'
              AND (
                envelope #>> '{record,delegateUserId}' = ${authority.actorUserId}
                OR (${canUpdate} AND envelope #> '{record,delegateUserId}' = 'null'::jsonb)
              )
            )
            OR (
              envelope #>> '{record,kind}' IN ('work_item', 'post_award_item')
              AND (
                envelope #>> '{record,ownerUserId}' = ${authority.actorUserId}
                OR (${canUpdate} AND envelope #> '{record,ownerUserId}' = 'null'::jsonb)
              )
            )
          )
        )
        OR (
          title LIKE ${`${RETAINER_PREFIX}%`}
          AND ${canReadRetainer}
          AND project_status NOT IN ('signed_off', 'exported')
          AND owner_membership_id = ${authority.membershipId}::uuid
          AND status NOT IN ('completed', 'cancelled')
        )
    )
    SELECT
      candidate_guard.candidate_count > ${WORK_INBOX_NATIVE_CANDIDATE_LIMIT} AS overflow,
      id::text AS id,
      organisation_id::text AS "organisationId",
      project_id::text AS "projectId",
      project_title AS "projectTitle",
      title AS "rowTitle",
      owner_membership_id::text AS "ownerMembershipId",
      due_at AS "rowDueAt",
      priority AS "rowPriority",
      status AS "rowStatus",
      version AS "rowVersion",
      code_units AS "codeUnits",
      bytes,
      coalesce(envelope->>'schema', envelope->>'schemaVersion') AS schema,
      envelope #>> '{record,id}' AS "recordId",
      envelope #>> '{record,organisationId}' AS "recordOrganisationId",
      envelope #>> '{record,projectId}' AS "recordProjectId",
      envelope #>> '{record,version}' AS "recordVersion",
      envelope #>> '{record,kind}' AS kind,
      envelope #>> '{record,ownerUserId}' AS "ownerUserId",
      envelope #>> '{record,delegateUserId}' AS "delegateUserId",
      envelope #>> '{record,ownerMembershipId}' AS "recordOwnerMembershipId",
      envelope #>> '{record,title}' AS title,
      envelope #>> '{record,summary}' AS summary,
      envelope #>> '{record,status}' AS status,
      envelope #>> '{record,dueAt}' AS "dueAt",
      envelope #>> '{record,startsAt}' AS "startsAt",
      envelope #>> '{record,priority}' AS priority,
      envelope #>> '{record,sla}' AS sla
    FROM candidate_guard
    LEFT JOIN authorized
      ON candidate_guard.candidate_count <= ${WORK_INBOX_NATIVE_CANDIDATE_LIMIT}
    ORDER BY
      CASE
        WHEN due_at IS NOT NULL AND (due_at AT TIME ZONE 'Africa/Lagos')::date < (${now.toISOString()}::timestamptz AT TIME ZONE 'Africa/Lagos')::date THEN 0
        WHEN due_at IS NOT NULL AND (due_at AT TIME ZONE 'Africa/Lagos')::date = (${now.toISOString()}::timestamptz AT TIME ZONE 'Africa/Lagos')::date THEN 1
        WHEN due_at IS NOT NULL THEN 2
        ELSE 3
      END,
      due_at ASC NULLS LAST,
      CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
      title ASC,
      id ASC
    LIMIT ${limit + 1}
  `);
  const projectedRows = result.rows as unknown as ProjectedRow[];
  if (projectedRows.some((row) => row.overflow)) {
    throw new WorkInboxUnavailableError();
  }
  const authorizedOverfetch = projectedRows
    .filter((row) => row.id !== null)
    .map((row) => projectedItem(row, authority));
  const groups: WorkInboxSnapshot["groups"] = {
    overdue: [],
    today: [],
    upcoming: [],
    unscheduled: [],
  };
  const today = watDay(now);
  for (const item of authorizedOverfetch.slice(0, limit)) {
    groups[groupFor(item.dueAt, today)].push(item);
  }
  return {
    organisationId: authority.organisationId,
    generatedAt: now.toISOString(),
    businessTimeZone: BUSINESS_TIME_ZONE,
    limit,
    truncated: authorizedOverfetch.length > limit,
    restrictedContent: true,
    groups,
  };
}
