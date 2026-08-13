import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  notExists,
} from "drizzle-orm";
import {
  db,
  organisations,
  projects,
  retentionRequests,
  withTenantDatabase,
} from "@workspace/db";
import {
  planRetentionScan,
  RETENTION_ELIGIBLE_STATUSES,
  type RetentionScanCandidate,
} from "./deterministic";
import { getActiveConfig } from "./appConfig";
import { writeAuditTx } from "./audit";

const ORGANISATION_PAGE = 10;
const PER_TENANT_PROJECT_PAGE = 100;

export interface RetentionScanRunResult {
  organisationsScanned: number;
  scanned: number;
  opened: RetentionScanCandidate[];
  skippedExisting: number;
  missingConclusionAnchors: number;
  missingConclusionAnchorPagesRemaining: number;
  tenantPagesRemaining: number;
  tenantFailures: number;
  organisationPageTruncated: boolean;
  cycleComplete: boolean;
  nextOrganisationCursor: string | null;
}

export interface RetentionScanOptions {
  now: Date;
  organisationId?: string;
  afterOrganisationId?: string | null;
}

/**
 * One bounded, rotating retention scan. Only `projects.concluded_at` starts the
 * clock: legacy rows without an evidenced conclusion remain visible through a
 * blocker signal and are never scheduled from a fabricated fallback date.
 */
export async function runRetentionScan(
  options: RetentionScanOptions,
): Promise<RetentionScanRunResult> {
  const now = options.now;
  if (!Number.isFinite(now.valueOf())) throw new Error("Invalid scan time");
  if (options.organisationId && options.afterOrganisationId) {
    throw new Error("A direct tenant scan cannot also supply a cursor");
  }
  const { retentionDefaultDays } = await getActiveConfig();
  if (
    !Number.isSafeInteger(retentionDefaultDays) ||
    retentionDefaultDays < 1 ||
    retentionDefaultDays > 36_500
  ) {
    throw new Error("Retention window is invalid");
  }
  const afterOrganisationId = options.afterOrganisationId ?? null;
  const discovered = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(
      options.organisationId
        ? eq(organisations.id, options.organisationId)
        : afterOrganisationId
          ? gt(organisations.id, afterOrganisationId)
          : undefined,
    )
    .orderBy(asc(organisations.id))
    .limit(options.organisationId ? 1 : ORGANISATION_PAGE + 1);
  const organisationPage = discovered.slice(
    0,
    options.organisationId ? 1 : ORGANISATION_PAGE,
  );
  const result: RetentionScanRunResult = {
    organisationsScanned: 0,
    scanned: 0,
    opened: [],
    skippedExisting: 0,
    missingConclusionAnchors: 0,
    missingConclusionAnchorPagesRemaining: 0,
    tenantPagesRemaining: 0,
    tenantFailures: 0,
    organisationPageTruncated:
      !options.organisationId && discovered.length > ORGANISATION_PAGE,
    cycleComplete: false,
    nextOrganisationCursor: afterOrganisationId,
  };
  const eligibleStatuses = [...RETENTION_ELIGIBLE_STATUSES];
  const cutoff = new Date(
    now.valueOf() - retentionDefaultDays * 24 * 60 * 60 * 1_000,
  );

  for (const organisation of organisationPage) {
    result.organisationsScanned += 1;
    try {
      const tenantResult = await withTenantDatabase(
        organisation.id,
        async () => {
          const missingConclusionRows = await db
            .select({ id: projects.id })
            .from(projects)
            .where(
              and(
                inArray(projects.status, eligibleStatuses),
                isNull(projects.concludedAt),
              ),
            )
            .orderBy(asc(projects.id))
            .limit(PER_TENANT_PROJECT_PAGE + 1);
          const candidateRows = await db
            .select({
              id: projects.id,
              status: projects.status,
              concludedAt: projects.concludedAt,
            })
            .from(projects)
            .where(
              and(
                inArray(projects.status, eligibleStatuses),
                isNotNull(projects.concludedAt),
                lte(projects.concludedAt, cutoff),
                notExists(
                  db
                    .select({ id: retentionRequests.id })
                    .from(retentionRequests)
                    .where(
                      and(
                        eq(retentionRequests.projectId, projects.id),
                        eq(retentionRequests.status, "pending"),
                      ),
                    ),
                ),
              ),
            )
            .orderBy(asc(projects.concludedAt), asc(projects.id))
            .limit(PER_TENANT_PROJECT_PAGE + 1);
          const page = candidateRows.slice(0, PER_TENANT_PROJECT_PAGE);
          const candidates = planRetentionScan({
            projects: page.map((project) => ({
              id: project.id,
              status: project.status,
              relevantDate: project.concludedAt!,
              hasPendingRequest: false,
            })),
            retentionDefaultDays,
            now,
          });
          const opened: RetentionScanCandidate[] = [];
          let skippedExisting = 0;
          for (const candidate of candidates) {
            try {
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
                      organisationId: organisation.id,
                      projectId: candidate.projectId,
                      requestedBy: null,
                      reason:
                        "Auto-opened by the retention scheduler: the configured window after the evidenced conclusion elapsed.",
                      dueAt: candidate.dueAt,
                    })
                    .returning();
                  await writeAuditTx(tx, {
                    user: null,
                    organisationId: organisation.id,
                    projectId: candidate.projectId,
                    eventType: "retention.auto_requested",
                    objectType: "retention_request",
                    objectId: row.id,
                    details: JSON.stringify({
                      conclusionAnchor: "projects.concluded_at",
                      windowElapsedAt: candidate.dueAt.toISOString(),
                    }),
                    createdAt: now,
                  });
                  return row;
                },
                { isolationLevel: "read committed" },
              );
              if (!created) skippedExisting += 1;
              else opened.push(candidate);
            } catch (error) {
              if (isUniqueViolation(error)) skippedExisting += 1;
              else throw error;
            }
          }
          return {
            scanned: page.length,
            opened,
            skippedExisting,
            missingConclusionAnchors: Math.min(
              missingConclusionRows.length,
              PER_TENANT_PROJECT_PAGE,
            ),
            missingConclusionAnchorsTruncated:
              missingConclusionRows.length > PER_TENANT_PROJECT_PAGE,
            truncated: candidateRows.length > PER_TENANT_PROJECT_PAGE,
          };
        },
      );
      result.scanned += tenantResult.scanned;
      result.opened.push(...tenantResult.opened);
      result.skippedExisting += tenantResult.skippedExisting;
      result.missingConclusionAnchors += tenantResult.missingConclusionAnchors;
      if (tenantResult.missingConclusionAnchorsTruncated) {
        result.missingConclusionAnchorPagesRemaining += 1;
      }
      if (tenantResult.truncated) result.tenantPagesRemaining += 1;
      result.nextOrganisationCursor = organisation.id;
    } catch {
      result.tenantFailures += 1;
      // Advance through the bounded page so one broken tenant cannot starve
      // every later tenant. The cursor wraps to null at cycle end, revisiting
      // failures on the next cycle.
      result.nextOrganisationCursor = organisation.id;
      continue;
    }
  }
  if (options.organisationId) {
    result.cycleComplete =
      result.tenantFailures === 0 &&
      result.tenantPagesRemaining === 0 &&
      result.missingConclusionAnchorPagesRemaining === 0;
    result.nextOrganisationCursor = null;
  } else {
    result.cycleComplete =
      !result.organisationPageTruncated &&
      result.organisationsScanned === organisationPage.length;
    if (result.cycleComplete) result.nextOrganisationCursor = null;
  }
  return result;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
