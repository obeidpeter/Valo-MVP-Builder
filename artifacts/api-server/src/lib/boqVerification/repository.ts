import { and, desc, eq, sql } from "drizzle-orm";
import {
  boqExceptions,
  boqRuns,
  db,
  documents,
  projects,
  users,
  withTenantDatabase,
} from "@workspace/db";
import { writeAuditTx } from "../audit";
import { verifyCommercialBoq } from "../boqVerifier";
import {
  BOQ_VERIFICATION_BOUNDS,
  BOQ_VERIFIER_VERSION,
  BoqVerificationProjectAccessError,
  BoqVerificationRepositoryUnavailableError,
  NG_COMMERCIAL_BOQ_RULE_PACK,
  type BoqExceptionRecord,
  type BoqExceptionResolutionDraft,
  type BoqExceptionResolutionOutcome,
  type BoqRunDetail,
  type BoqRunDraft,
  type BoqRunOutcome,
  type BoqRunRecord,
  type BoqVerificationRepository,
  type BoqVerificationScope,
  type BoqVerificationSnapshot,
} from "./contracts";
import {
  BOQ_VERIFICATION_AUTHORITY_NOTE,
  buildWorkbookManifest,
  canonicalJson,
  summariseResultStatus,
} from "./service";

import { UUID_PATTERN } from "../identifierPatterns";

type BoqTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function assertUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new BoqVerificationRepositoryUnavailableError(`Invalid ${label}`);
  }
}

async function assertProject(
  tx: BoqTx,
  scope: Pick<BoqVerificationScope, "organisationId" | "projectId">,
): Promise<string> {
  const [project] = await tx
    .select({ status: projects.status })
    .from(projects)
    .where(
      and(
        eq(projects.id, scope.projectId),
        eq(projects.organisationId, scope.organisationId),
      ),
    )
    .limit(1);
  if (!project) throw new BoqVerificationProjectAccessError("not_found");
  if (project.status === "archived") {
    throw new BoqVerificationProjectAccessError("archived");
  }
  return project.status;
}

async function loadActor(tx: BoqTx, actorUserId: string | null) {
  if (!actorUserId || !UUID_PATTERN.test(actorUserId)) return null;
  const [actor] = await tx
    .select()
    .from(users)
    .where(eq(users.id, actorUserId))
    .limit(1);
  return actor ?? null;
}

async function lockProject(
  tx: BoqTx,
  scope: BoqVerificationScope,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(${scope.projectId}, 0))`,
  );
}

/**
 * A run may only bind to the current, cleared version of a governed document
 * that belongs to this exact tenant and project. Quarantined or superseded
 * versions fail closed as a document conflict.
 */
async function resolveCurrentDocumentVersion(
  tx: BoqTx,
  scope: Pick<BoqVerificationScope, "organisationId" | "projectId">,
  documentId: string,
): Promise<{ versionId: string; sha256: string } | null> {
  const [document] = await tx
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.organisationId, scope.organisationId),
        eq(documents.projectId, scope.projectId),
      ),
    )
    .limit(1);
  if (!document) return null;
  const versionResult = await tx.execute(sql`
    SELECT current_version.id::text AS "versionId",
           current_version.sha256 AS sha256
    FROM document_versions AS current_version
    WHERE current_version.organisation_id = ${scope.organisationId}::uuid
      AND current_version.document_id = ${documentId}::uuid
      AND current_version.malware_status = 'clean'
      AND current_version.quarantine_status = 'cleared'
      AND NOT EXISTS (
        SELECT 1
        FROM document_versions AS later_version
        WHERE later_version.organisation_id = current_version.organisation_id
          AND later_version.document_id = current_version.document_id
          AND later_version.version_number > current_version.version_number
      )
    LIMIT 1
  `);
  const row = versionResult.rows[0] as
    | { versionId: string; sha256: string }
    | undefined;
  return row ?? null;
}

interface RunRow {
  id: string;
  organisationId: string;
  projectId: string;
  documentVersionId: string;
  rulePackId: string;
  verifierVersion: string;
  workbookManifest: string;
  status: string;
  exceptionCount: number;
  startedByUserId: string | null;
  startedAt: Date;
  completedAt: Date | null;
  version: number;
}

function toRunRecord(row: RunRow): BoqRunRecord {
  let computedLotTotalsMinor: Record<string, string> = {};
  let passed = row.status === "passed";
  try {
    const manifest = JSON.parse(row.workbookManifest) as {
      computedLotTotalsMinor?: Record<string, string>;
    };
    if (
      manifest.computedLotTotalsMinor &&
      typeof manifest.computedLotTotalsMinor === "object"
    ) {
      computedLotTotalsMinor = manifest.computedLotTotalsMinor;
    }
  } catch {
    computedLotTotalsMinor = {};
    passed = false;
  }
  return {
    id: row.id,
    organisationId: row.organisationId,
    projectId: row.projectId,
    documentVersionId: row.documentVersionId,
    rulePackId: row.rulePackId,
    verifierVersion: row.verifierVersion,
    workbookManifest: row.workbookManifest,
    status: row.status,
    exceptionCount: row.exceptionCount,
    passed,
    computedLotTotalsMinor,
    startedByUserId: row.startedByUserId,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    version: row.version,
  };
}

interface ExceptionRow {
  id: string;
  boqRunId: string;
  lotReference: string | null;
  cellReference: string | null;
  exceptionCode: string;
  severity: string;
  expectedMinor: bigint | null;
  actualMinor: bigint | null;
  currency: string | null;
  finding: string;
  status: string;
  resolutionReason: string | null;
  resolvedByUserId: string | null;
  resolvedAt: Date | null;
  version: number;
}

function toExceptionRecord(row: ExceptionRow): BoqExceptionRecord {
  return {
    id: row.id,
    boqRunId: row.boqRunId,
    lotReference: row.lotReference,
    cellReference: row.cellReference,
    exceptionCode: row.exceptionCode as BoqExceptionRecord["exceptionCode"],
    severity: row.severity as BoqExceptionRecord["severity"],
    expectedMinor: row.expectedMinor == null ? null : String(row.expectedMinor),
    actualMinor: row.actualMinor == null ? null : String(row.actualMinor),
    currency: row.currency,
    finding: row.finding,
    status: row.status as BoqExceptionRecord["status"],
    resolutionReason: row.resolutionReason,
    resolvedByUserId: row.resolvedByUserId,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    version: row.version,
  };
}

const runColumns = {
  id: boqRuns.id,
  organisationId: boqRuns.organisationId,
  projectId: boqRuns.projectId,
  documentVersionId: boqRuns.documentVersionId,
  rulePackId: boqRuns.rulePackId,
  verifierVersion: boqRuns.verifierVersion,
  workbookManifest: boqRuns.workbookManifest,
  status: boqRuns.status,
  exceptionCount: boqRuns.exceptionCount,
  startedByUserId: boqRuns.startedByUserId,
  startedAt: boqRuns.startedAt,
  completedAt: boqRuns.completedAt,
  version: boqRuns.version,
};

const exceptionColumns = {
  id: boqExceptions.id,
  boqRunId: boqExceptions.boqRunId,
  lotReference: boqExceptions.lotReference,
  cellReference: boqExceptions.cellReference,
  exceptionCode: boqExceptions.exceptionCode,
  severity: boqExceptions.severity,
  expectedMinor: boqExceptions.expectedMinor,
  actualMinor: boqExceptions.actualMinor,
  currency: boqExceptions.currency,
  finding: boqExceptions.finding,
  status: boqExceptions.status,
  resolutionReason: boqExceptions.resolutionReason,
  resolvedByUserId: boqExceptions.resolvedByUserId,
  resolvedAt: boqExceptions.resolvedAt,
  version: boqExceptions.version,
};

export class PostgresBoqVerificationRepository implements BoqVerificationRepository {
  async readSnapshot(
    scope: BoqVerificationScope,
    now: Date,
  ): Promise<BoqVerificationSnapshot> {
    assertUuid(scope.organisationId, "organisation scope");
    assertUuid(scope.projectId, "project scope");
    return withTenantDatabase(scope.organisationId, () =>
      db.transaction(async (tx) => {
        const projectStatus = await assertProject(tx, scope);
        const rows = await tx
          .select(runColumns)
          .from(boqRuns)
          .where(
            and(
              eq(boqRuns.organisationId, scope.organisationId),
              eq(boqRuns.projectId, scope.projectId),
            ),
          )
          .orderBy(desc(boqRuns.startedAt), desc(boqRuns.id))
          .limit(BOQ_VERIFICATION_BOUNDS.runsListedPerProject);
        const [openCount] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(boqExceptions)
          .innerJoin(boqRuns, eq(boqExceptions.boqRunId, boqRuns.id))
          .where(
            and(
              eq(boqRuns.organisationId, scope.organisationId),
              eq(boqRuns.projectId, scope.projectId),
              eq(boqExceptions.status, "open"),
            ),
          );
        return {
          organisationId: scope.organisationId,
          projectId: scope.projectId,
          projectStatus,
          rulePackId: NG_COMMERCIAL_BOQ_RULE_PACK.rulePackId,
          verifierVersion: BOQ_VERIFIER_VERSION,
          runs: rows.map(toRunRecord),
          openExceptionCount: openCount?.count ?? 0,
          generatedAt: now.toISOString(),
          authorityNote: BOQ_VERIFICATION_AUTHORITY_NOTE,
        };
      }),
    );
  }

  async createRun(
    scope: BoqVerificationScope,
    draft: BoqRunDraft,
    now: Date,
  ): Promise<BoqRunOutcome> {
    assertUuid(scope.organisationId, "organisation scope");
    assertUuid(scope.projectId, "project scope");
    assertUuid(draft.documentId, "document");
    return withTenantDatabase(scope.organisationId, () =>
      db.transaction(async (tx) => {
        await lockProject(tx, scope);
        await assertProject(tx, scope);
        const sourceVersion = await resolveCurrentDocumentVersion(
          tx,
          scope,
          draft.documentId,
        );
        if (!sourceVersion) return { outcome: "document_conflict" as const };

        const result = verifyCommercialBoq({
          lines: [...draft.lines],
          lots: [...draft.lots],
          policy: NG_COMMERCIAL_BOQ_RULE_PACK,
        });
        if (
          result.exceptions.length > BOQ_VERIFICATION_BOUNDS.exceptionsPerRun
        ) {
          return { outcome: "capacity_exceeded" as const };
        }
        const manifest = JSON.parse(
          buildWorkbookManifest({
            documentId: draft.documentId,
            documentVersionId: sourceVersion.versionId,
            documentSha256: sourceVersion.sha256,
            draft,
          }),
        ) as Record<string, unknown>;
        // The computed lot totals ride in the manifest so the run row remains
        // self-describing without a schema change.
        const workbookManifest = canonicalJson({
          ...manifest,
          computedLotTotalsMinor: result.computedLotTotalsMinor,
        });

        const [runRow] = await tx
          .insert(boqRuns)
          .values({
            organisationId: scope.organisationId,
            projectId: scope.projectId,
            documentVersionId: sourceVersion.versionId,
            rulePackId: result.policyVersion,
            verifierVersion: BOQ_VERIFIER_VERSION,
            workbookManifest,
            status: summariseResultStatus(result),
            exceptionCount: result.exceptions.length,
            startedByUserId: scope.actorUserId,
            startedAt: now,
            completedAt: now,
          })
          .returning(runColumns);
        if (!runRow) throw new BoqVerificationRepositoryUnavailableError();

        let exceptionRows: ExceptionRow[] = [];
        if (result.exceptions.length > 0) {
          exceptionRows = await tx
            .insert(boqExceptions)
            .values(
              result.exceptions.map((exception) => ({
                organisationId: scope.organisationId,
                boqRunId: runRow.id,
                lotReference: exception.lotId,
                cellReference: exception.lineId ?? null,
                exceptionCode: exception.code,
                severity: exception.severity,
                expectedMinor:
                  exception.expectedMinor == null
                    ? null
                    : BigInt(exception.expectedMinor),
                actualMinor:
                  exception.actualMinor == null
                    ? null
                    : BigInt(exception.actualMinor),
                currency:
                  draft.lots.find((lot) => lot.lotId === exception.lotId)
                    ?.currency ?? null,
                finding: exception.message,
              })),
            )
            .returning(exceptionColumns);
        }

        await writeAuditTx(tx, {
          user: await loadActor(tx, scope.actorUserId),
          organisationId: scope.organisationId,
          projectId: scope.projectId,
          eventType: "boq_verification.run_completed",
          objectType: "boq_run",
          objectId: runRow.id,
          details: canonicalJson({
            schema: "valo.boq-verification-audit/v1",
            rulePackId: result.policyVersion,
            verifierVersion: BOQ_VERIFIER_VERSION,
            documentVersionId: sourceVersion.versionId,
            status: summariseResultStatus(result),
            exceptionCount: result.exceptions.length,
          }),
        });

        return {
          outcome: "created" as const,
          run: toRunRecord(runRow),
          exceptions: exceptionRows.map(toExceptionRecord),
        };
      }),
    );
  }

  async readRun(
    scope: BoqVerificationScope,
    runId: string,
  ): Promise<BoqRunDetail | null> {
    assertUuid(scope.organisationId, "organisation scope");
    assertUuid(scope.projectId, "project scope");
    if (!UUID_PATTERN.test(runId)) return null;
    return withTenantDatabase(scope.organisationId, () =>
      db.transaction(async (tx) => {
        await assertProject(tx, scope);
        const [runRow] = await tx
          .select(runColumns)
          .from(boqRuns)
          .where(
            and(
              eq(boqRuns.id, runId),
              eq(boqRuns.organisationId, scope.organisationId),
              eq(boqRuns.projectId, scope.projectId),
            ),
          )
          .limit(1);
        if (!runRow) return null;
        const exceptionRows = await tx
          .select(exceptionColumns)
          .from(boqExceptions)
          .where(
            and(
              eq(boqExceptions.boqRunId, runRow.id),
              eq(boqExceptions.organisationId, scope.organisationId),
            ),
          )
          .orderBy(boqExceptions.createdAt, boqExceptions.id)
          .limit(BOQ_VERIFICATION_BOUNDS.exceptionsPerRun);
        return {
          run: toRunRecord(runRow),
          exceptions: exceptionRows.map(toExceptionRecord),
          authorityNote: BOQ_VERIFICATION_AUTHORITY_NOTE,
        };
      }),
    );
  }

  async resolveException(
    scope: BoqVerificationScope,
    exceptionId: string,
    expectedVersion: number,
    draft: BoqExceptionResolutionDraft,
    now: Date,
  ): Promise<BoqExceptionResolutionOutcome> {
    assertUuid(scope.organisationId, "organisation scope");
    assertUuid(scope.projectId, "project scope");
    if (!UUID_PATTERN.test(exceptionId)) {
      return { outcome: "not_found" as const };
    }
    return withTenantDatabase(scope.organisationId, () =>
      db.transaction(async (tx) => {
        await lockProject(tx, scope);
        await assertProject(tx, scope);
        const [current] = await tx
          .select({
            id: boqExceptions.id,
            status: boqExceptions.status,
            version: boqExceptions.version,
            projectId: boqRuns.projectId,
          })
          .from(boqExceptions)
          .innerJoin(boqRuns, eq(boqExceptions.boqRunId, boqRuns.id))
          .where(
            and(
              eq(boqExceptions.id, exceptionId),
              eq(boqExceptions.organisationId, scope.organisationId),
              eq(boqRuns.projectId, scope.projectId),
            ),
          )
          .limit(1);
        if (!current) return { outcome: "not_found" as const };
        if (current.status !== "open") {
          return { outcome: "state_conflict" as const };
        }
        if (current.version !== expectedVersion) {
          return { outcome: "version_conflict" as const };
        }
        // The conditional predicate repeats status and version so a
        // concurrent resolution loses deterministically instead of silently
        // double-writing.
        const [updated] = await tx
          .update(boqExceptions)
          .set({
            status: draft.status,
            resolutionReason: draft.reason,
            resolvedByUserId: scope.actorUserId,
            resolvedAt: now,
            version: expectedVersion + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(boqExceptions.id, exceptionId),
              eq(boqExceptions.organisationId, scope.organisationId),
              eq(boqExceptions.status, "open"),
              eq(boqExceptions.version, expectedVersion),
            ),
          )
          .returning(exceptionColumns);
        if (!updated) return { outcome: "version_conflict" as const };
        await writeAuditTx(tx, {
          user: await loadActor(tx, scope.actorUserId),
          organisationId: scope.organisationId,
          projectId: scope.projectId,
          eventType: "boq_verification.exception_resolved",
          objectType: "boq_exception",
          objectId: exceptionId,
          details: canonicalJson({
            schema: "valo.boq-verification-audit/v1",
            status: draft.status,
            reason: draft.reason,
          }),
        });
        return {
          outcome: "updated" as const,
          exception: toExceptionRecord(updated),
        };
      }),
    );
  }
}

export const postgresBoqVerificationRepository =
  new PostgresBoqVerificationRepository();
