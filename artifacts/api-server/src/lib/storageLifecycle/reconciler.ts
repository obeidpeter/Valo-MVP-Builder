import { db, organisations, withTenantDatabase } from "@workspace/db";
import { asc, gt } from "drizzle-orm";
import { ObjectStorageService } from "../objectStorage";
import {
  listPendingStorageDeletionIntents,
  purgeRetainedStorageDeletionTerminals,
  reconcileStorageDeletionIntent,
  sweepExpiredClientUploadLeases,
  type ExpiredClientUploadLeaseSweep,
  type StorageDeletionReconciliation,
  type StorageDeletionIntentBatch,
  type StorageDeletionObjectStore,
} from "./repository";

const ORGANISATION_PAGE = 10;
const PER_TENANT_BATCH = 5;
const RUN_BUDGET_MS = 8 * 60_000;

export const STORAGE_DELETION_RECONCILER_STATUS = Object.freeze({
  durableQueueImplemented: true,
  boundedTenantFairScanImplemented: true,
  expiredUploadLeaseSweepImplemented: true,
  completedLeaseLateRewriteSweepImplemented: true,
  providerInFlightPutMaximumVerified: false,
  exactLateRewriteClosureImplemented: false,
  scheduledEntrypointImplemented: true,
  platformScheduleDeclaredInRepository: true,
  durableRotationCursorImplemented: true,
  singleRunLeaseImplemented: true,
  globalRunBudgetImplemented: true,
  terminalQueueRetentionImplemented: true,
  auditedDeadLetterReplayImplemented: true,
  externalMessagingPerformed: false,
  activation:
    "requires-provider-cap-platform-schedule-terminal-retention-and-audited-replay" as const,
});

export interface StorageDeletionReconciliationRunResult {
  organisationsScanned: number;
  uploadLeasesConsidered: number;
  uploadLeasesExpired: number;
  completedLeaseCleanupQueued: number;
  rejectedLeaseCleanupQueued: number;
  quarantinedLeaseCleanupQueued: number;
  unconfirmedLeaseCleanupQueued: number;
  uploadLeasePagesRemaining: number;
  intentsConsidered: number;
  completed: number;
  cancelled: number;
  replayed: number;
  retryWait: number;
  deadLetter: number;
  terminalRowsConsidered: number;
  terminalRowsPurged: number;
  terminalRetentionPagesRemaining: number;
  tenantPagesRemaining: number;
  tenantFailures: number;
  intentFailures: number;
  oldestPendingAgeSeconds: number;
  runBudgetExhausted: boolean;
  organisationPageTruncated: boolean;
  cycleComplete: boolean;
  nextOrganisationCursor: string | null;
}

export interface StorageDeletionReconcilerDependencies {
  listOrganisationIds(
    afterOrganisationId: string | null,
    limit: number,
  ): Promise<readonly string[]>;
  listIntents(
    organisationId: string,
    limit: number,
  ): Promise<StorageDeletionIntentBatch>;
  sweepExpiredLeases(
    organisationId: string,
    limit: number,
  ): Promise<ExpiredClientUploadLeaseSweep>;
  purgeRetainedTerminals(
    organisationId: string,
    limit: number,
  ): Promise<{
    considered: number;
    purged: number;
    truncated: boolean;
    manifestSha256: string | null;
  }>;
  reconcile(input: {
    organisationId: string;
    eventId: string;
    expectedVersion: number;
    objectStore: StorageDeletionObjectStore;
  }): Promise<StorageDeletionReconciliation>;
  objectStore: StorageDeletionObjectStore;
  now(): Date;
  monotonicNow(): number;
}

async function listOrganisationIds(
  afterOrganisationId: string | null,
  limit: number,
): Promise<readonly string[]> {
  const rows = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(
      afterOrganisationId
        ? gt(organisations.id, afterOrganisationId)
        : undefined,
    )
    .orderBy(asc(organisations.id))
    .limit(limit);
  return rows.map(({ id }) => id);
}

const DEFAULT_DEPENDENCIES: StorageDeletionReconcilerDependencies = {
  listOrganisationIds,
  listIntents: (organisationId, limit) =>
    withTenantDatabase(organisationId, () =>
      listPendingStorageDeletionIntents(organisationId, limit),
    ),
  sweepExpiredLeases: (organisationId, limit) =>
    withTenantDatabase(organisationId, () =>
      sweepExpiredClientUploadLeases(organisationId, limit),
    ),
  purgeRetainedTerminals: (organisationId, limit) =>
    withTenantDatabase(organisationId, () =>
      purgeRetainedStorageDeletionTerminals(organisationId, limit),
    ),
  reconcile: (input) =>
    withTenantDatabase(input.organisationId, () =>
      reconcileStorageDeletionIntent({
        ...input,
        actor: null,
      }),
    ),
  objectStore: new ObjectStorageService(),
  now: () => new Date(),
  monotonicNow: () => performance.now(),
};

function countOutcome(
  result: StorageDeletionReconciliationRunResult,
  outcome: StorageDeletionReconciliation["outcome"],
): void {
  if (outcome === "completed") result.completed += 1;
  else if (outcome === "cancelled") result.cancelled += 1;
  else if (outcome === "replayed") result.replayed += 1;
  else if (outcome === "retry_wait") result.retryWait += 1;
  else result.deadLetter += 1;
}

/**
 * Process one globally bounded, rotating tenant page. The caller persists the
 * returned cursor under a single-run advisory lease; no cross-tenant data
 * transaction exists.
 */
export async function runStorageDeletionReconciliation(
  dependencies: StorageDeletionReconcilerDependencies = DEFAULT_DEPENDENCIES,
  options: { afterOrganisationId?: string | null } = {},
): Promise<StorageDeletionReconciliationRunResult> {
  const afterOrganisationId = options.afterOrganisationId ?? null;
  if (
    afterOrganisationId !== null &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      afterOrganisationId,
    )
  ) {
    throw new Error("Storage reconciler cursor is invalid");
  }
  const startedAt = dependencies.monotonicNow();
  const result: StorageDeletionReconciliationRunResult = {
    organisationsScanned: 0,
    uploadLeasesConsidered: 0,
    uploadLeasesExpired: 0,
    completedLeaseCleanupQueued: 0,
    rejectedLeaseCleanupQueued: 0,
    quarantinedLeaseCleanupQueued: 0,
    unconfirmedLeaseCleanupQueued: 0,
    uploadLeasePagesRemaining: 0,
    intentsConsidered: 0,
    completed: 0,
    cancelled: 0,
    replayed: 0,
    retryWait: 0,
    deadLetter: 0,
    terminalRowsConsidered: 0,
    terminalRowsPurged: 0,
    terminalRetentionPagesRemaining: 0,
    tenantPagesRemaining: 0,
    tenantFailures: 0,
    intentFailures: 0,
    oldestPendingAgeSeconds: 0,
    runBudgetExhausted: false,
    organisationPageTruncated: false,
    cycleComplete: false,
    nextOrganisationCursor: afterOrganisationId,
  };
  const discovered = await dependencies.listOrganisationIds(
    afterOrganisationId,
    ORGANISATION_PAGE + 1,
  );
  if (
    discovered.length > ORGANISATION_PAGE + 1 ||
    discovered.some(
      (id, index) =>
        (index > 0 && id <= discovered[index - 1]!) ||
        (afterOrganisationId !== null && id <= afterOrganisationId),
    )
  ) {
    throw new Error("Storage reconciler organisation page is invalid");
  }
  const organisationIds = discovered.slice(0, ORGANISATION_PAGE);
  let fullyProcessed = 0;

  for (const organisationId of organisationIds) {
    if (dependencies.monotonicNow() - startedAt >= RUN_BUDGET_MS) {
      result.runBudgetExhausted = true;
      break;
    }
    result.organisationsScanned += 1;
    try {
      const leaseSweep = await dependencies.sweepExpiredLeases(
        organisationId,
        PER_TENANT_BATCH,
      );
      if (
        leaseSweep.considered > PER_TENANT_BATCH ||
        leaseSweep.expired +
          leaseSweep.completedCleanupQueued +
          leaseSweep.rejectedCleanupQueued +
          leaseSweep.quarantinedCleanupQueued +
          leaseSweep.cleanupUnconfirmedPostExpiryQueued !==
          leaseSweep.considered
      ) {
        throw new Error("Invalid upload lease sweep result");
      }
      result.uploadLeasesConsidered += leaseSweep.considered;
      result.uploadLeasesExpired += leaseSweep.expired;
      result.completedLeaseCleanupQueued += leaseSweep.completedCleanupQueued;
      result.rejectedLeaseCleanupQueued += leaseSweep.rejectedCleanupQueued;
      result.quarantinedLeaseCleanupQueued +=
        leaseSweep.quarantinedCleanupQueued;
      result.unconfirmedLeaseCleanupQueued +=
        leaseSweep.cleanupUnconfirmedPostExpiryQueued;
      if (leaseSweep.truncated) result.uploadLeasePagesRemaining += 1;
      const terminalPurge = await dependencies.purgeRetainedTerminals(
        organisationId,
        PER_TENANT_BATCH,
      );
      if (
        terminalPurge.considered > PER_TENANT_BATCH ||
        terminalPurge.purged !== terminalPurge.considered ||
        terminalPurge.purged > 0 !== (terminalPurge.manifestSha256 !== null)
      ) {
        throw new Error("Invalid terminal storage retention result");
      }
      result.terminalRowsConsidered += terminalPurge.considered;
      result.terminalRowsPurged += terminalPurge.purged;
      if (terminalPurge.truncated) {
        result.terminalRetentionPagesRemaining += 1;
      }
    } catch {
      result.tenantFailures += 1;
      continue;
    }
    let batch: StorageDeletionIntentBatch;
    try {
      batch = await dependencies.listIntents(organisationId, PER_TENANT_BATCH);
    } catch {
      result.tenantFailures += 1;
      continue;
    }
    if (batch.limit !== PER_TENANT_BATCH || batch.items.length > batch.limit) {
      result.tenantFailures += 1;
      continue;
    }
    if (batch.truncated) result.tenantPagesRemaining += 1;
    for (const intent of batch.items) {
      if (dependencies.monotonicNow() - startedAt >= RUN_BUDGET_MS) {
        result.runBudgetExhausted = true;
        result.tenantPagesRemaining += 1;
        break;
      }
      result.intentsConsidered += 1;
      const now = dependencies.now();
      result.oldestPendingAgeSeconds = Math.max(
        result.oldestPendingAgeSeconds,
        Math.max(
          0,
          Math.floor(
            (now.getTime() - new Date(intent.envelope.requestedAt).getTime()) /
              1_000,
          ),
        ),
      );
      try {
        const outcome = await dependencies.reconcile({
          organisationId,
          eventId: intent.id,
          expectedVersion: intent.version,
          objectStore: dependencies.objectStore,
        });
        countOutcome(result, outcome.outcome);
      } catch {
        result.intentFailures += 1;
      }
    }
    fullyProcessed += 1;
    result.nextOrganisationCursor = organisationId;
  }
  const pageHasMore = discovered.length > ORGANISATION_PAGE;
  const stoppedEarly = fullyProcessed < organisationIds.length;
  result.organisationPageTruncated = pageHasMore || stoppedEarly;
  result.cycleComplete = !result.organisationPageTruncated;
  if (result.cycleComplete) result.nextOrganisationCursor = null;
  return result;
}
