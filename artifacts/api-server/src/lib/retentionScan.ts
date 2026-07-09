import { and, eq, inArray } from "drizzle-orm";
import { db, projects, retentionRequests } from "@workspace/db";
import {
  planRetentionScan,
  RETENTION_ELIGIBLE_STATUSES,
  type RetentionScanCandidate,
} from "./deterministic";
import { getActiveConfig } from "./appConfig";
import { writeAuditTx } from "./audit";

export interface RetentionScanRunResult {
  /** Concluded engagements considered this run. */
  scanned: number;
  /** Requests actually opened by this run. */
  opened: RetentionScanCandidate[];
  /** Candidates skipped because a pending request already existed (dedup / race). */
  skippedExisting: number;
}

/**
 * Retention automation runner (Task: Retention automation scheduler).
 *
 * Loads the configured retention window and every concluded engagement, asks
 * the pure {@link planRetentionScan} which ones have passed their retention
 * window, then opens a retention request for each — idempotently. The opening
 * is deliberately the only side effect: it does NOT purge anything. A named
 * admin still completes the request through the existing manual flow, which is
 * where the archive gate and deletion certificate live.
 *
 * Idempotency is layered: the pure scan filters out projects that already have
 * a pending request, and the DB-level partial unique index
 * (`retention_requests_one_pending_per_project`) is the last-line guarantee, so
 * a lost race between overlapping runs surfaces as a caught unique violation
 * rather than a duplicate request.
 */
export async function runRetentionScan(
  options: { now?: Date } = {},
): Promise<RetentionScanRunResult> {
  const now = options.now ?? new Date();
  const { retentionDefaultDays } = await getActiveConfig();

  const eligibleStatuses = [...RETENTION_ELIGIBLE_STATUSES];
  const projectRows = await db
    .select({
      id: projects.id,
      status: projects.status,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .where(inArray(projects.status, eligibleStatuses));

  const pending = await db
    .select({ projectId: retentionRequests.projectId })
    .from(retentionRequests)
    .where(eq(retentionRequests.status, "pending"));
  const pendingProjectIds = new Set(pending.map((p) => p.projectId));

  const candidates = planRetentionScan({
    projects: projectRows.map((p) => ({
      id: p.id,
      status: p.status,
      // No dedicated conclusion timestamp exists, so the engagement's creation
      // time is the relevant date the retention clock counts from.
      relevantDate: p.createdAt instanceof Date ? p.createdAt : new Date(p.createdAt),
      hasPendingRequest: pendingProjectIds.has(p.id),
    })),
    retentionDefaultDays,
    now,
  });

  const opened: RetentionScanCandidate[] = [];
  let skippedExisting = 0;

  for (const candidate of candidates) {
    // Re-check inside a transaction and rely on the partial unique index so two
    // overlapping runs can never both insert a pending request for one project.
    try {
      // Open the request and write its audit event in ONE transaction: the
      // audit record IS the point of this run, so if the audit write fails the
      // request insert must roll back too (the next scheduled run retries).
      // read-committed is required by the audit chain's max-seq read.
      const created = await db.transaction(
        async (tx) => {
          const [existing] = await tx
            .select({ id: retentionRequests.id })
            .from(retentionRequests)
            .where(
              and(
                eq(retentionRequests.projectId, candidate.projectId),
                eq(retentionRequests.status, "pending"),
              ),
            );
          if (existing) return null;
          const [row] = await tx
            .insert(retentionRequests)
            .values({
              projectId: candidate.projectId,
              requestedBy: null,
              reason:
                "Auto-opened by the retention scheduler: the configured retention window has elapsed.",
              dueAt: candidate.dueAt,
            })
            .returning();
          await writeAuditTx(tx, {
            user: null,
            projectId: candidate.projectId,
            eventType: "retention.auto_requested",
            objectType: "retention_request",
            objectId: row.id,
            details: `scheduler opened; window elapsed ${candidate.dueAt.toISOString()}`,
          });
          return row;
        },
        { isolationLevel: "read committed" },
      );

      if (!created) {
        skippedExisting += 1;
        continue;
      }

      opened.push(candidate);
    } catch (err) {
      // A unique-violation here means a concurrent run won the race — that is a
      // successful dedup, not a failure.
      if (isUniqueViolation(err)) {
        skippedExisting += 1;
        continue;
      }
      throw err;
    }
  }

  return { scanned: projectRows.length, opened, skippedExisting };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}
