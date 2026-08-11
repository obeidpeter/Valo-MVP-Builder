import { createHash, randomUUID } from "node:crypto";
import { OPERATIONS_RECORD_KINDS } from "./contracts";
import type {
  CredentialVerificationRecord,
  EvidenceRequestRecord,
  MissionRecord,
  OperationsRecord,
  OperationsRecordBase,
  OperationsRecordKind,
  OperationsMobileQueue,
  OperationsMobileQueueItem,
  OperationsScope,
  OperationsStatusReason,
  OperationsSuiteSnapshot,
  OpportunityIntakeRecord,
  PostAwardItemRecord,
  SubmissionWarRoomRecord,
  VisualQaReportRecord,
  WorkItemRecord,
  WorkObjectLinks,
} from "./contracts";
import { OPERATIONS_SUITE_BOUNDS } from "./bounds";
import { OperationsSuiteError } from "./errors";
import {
  parseAddComment,
  parseAdvanceSubmission,
  parseApprovalDecision,
  parseConfirmDeadline,
  parseCreateCredential,
  parseCreateEvidenceRequest,
  parseCreateMission,
  parseCreateOpportunity,
  parseCreatePostAward,
  parseCreateSubmission,
  parseCreateVisualQa,
  parseCreateWorkItem,
  parseEvidenceDecision,
  parseEvidenceResponse,
  parseExpectedVersionOnly,
  parseUpdateMission,
  parseUpdatePostAward,
  parseUpdateWorkItem,
} from "./parsers";
import type { OperationsSuiteStore } from "./store";
import { requiredId } from "./validation";
import { evaluateVisualPackageQa } from "./visualQa";

export interface OperationsSuiteReferenceGuard {
  assertUser(scope: OperationsScope, userId: string): Promise<void>;
  assertWorkLinks(
    scope: OperationsScope,
    links: WorkObjectLinks,
  ): Promise<void>;
  assertDocument(
    scope: OperationsScope,
    documentId: string,
    expectedSha256?: string,
    acceptedContentTypes?: readonly string[],
  ): Promise<void>;
  assertDocuments(
    scope: OperationsScope,
    documentIds: readonly string[],
  ): Promise<void>;
  assertPackageVersion(
    scope: OperationsScope,
    packageVersionId: string,
    constraints?: {
      packageId?: string;
      manifestSha256?: string;
      expectedManifestSha256?: string;
      requireRenderQaPassed?: boolean;
    },
  ): Promise<void>;
  setPackageRenderQaResult(
    scope: OperationsScope,
    packageVersionId: string,
    constraints: {
      manifestSha256: string;
      expectedManifestSha256: string;
    },
    status: "passed" | "failed",
  ): Promise<void>;
  assertVaultItemSnapshot(
    scope: OperationsScope,
    vaultItemId: string,
    vaultItemVersion: number,
    documentSha256: string,
  ): Promise<void>;
}

export interface OperationsSuiteServiceOptions {
  store: OperationsSuiteStore;
  references: OperationsSuiteReferenceGuard;
  now?: () => Date;
  idFactory?: () => string;
}

function digest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function normalizeDedupePart(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/\s+/gu, " ");
}

function isKind<K extends OperationsRecordKind>(
  record: OperationsRecord,
  kind: K,
): record is Extract<OperationsRecord, { kind: K }> {
  return record.kind === kind;
}

const WORK_STATUS_TRANSITIONS: Readonly<
  Record<WorkItemRecord["status"], readonly WorkItemRecord["status"][]>
> = {
  backlog: ["ready", "cancelled"],
  ready: ["in_progress", "blocked", "cancelled"],
  in_progress: ["blocked", "in_review", "done", "cancelled"],
  blocked: ["ready", "in_progress", "cancelled"],
  in_review: ["in_progress", "blocked", "done", "cancelled"],
  done: [],
  cancelled: [],
};

const POST_AWARD_TRANSITIONS: Readonly<
  Record<
    PostAwardItemRecord["status"],
    readonly PostAwardItemRecord["status"][]
  >
> = {
  open: ["in_progress", "satisfied", "disputed", "cancelled"],
  in_progress: ["satisfied", "disputed", "cancelled"],
  disputed: ["in_progress", "satisfied", "cancelled"],
  satisfied: [],
  cancelled: [],
};

/** Human-entered completion timestamps may be slightly ahead of server time. */
const CREDENTIAL_CHECK_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export class OperationsSuiteService {
  readonly #store: OperationsSuiteStore;
  readonly #references: OperationsSuiteReferenceGuard;
  readonly #now: () => Date;
  readonly #idFactory: () => string;

  constructor(options: OperationsSuiteServiceOptions) {
    this.#store = options.store;
    this.#references = options.references;
    this.#now = options.now ?? (() => new Date());
    this.#idFactory = options.idFactory ?? randomUUID;
  }

  #scope(scope: OperationsScope): OperationsScope {
    return {
      organisationId: requiredId(scope.organisationId, "organisationId"),
      projectId: requiredId(scope.projectId, "projectId"),
      actorUserId: requiredId(scope.actorUserId, "actorUserId"),
    };
  }

  #base<K extends OperationsRecordKind>(
    scope: OperationsScope,
    kind: K,
  ): OperationsRecordBase<K> {
    const timestamp = this.#now().toISOString();
    return {
      id: this.#idFactory(),
      kind,
      organisationId: scope.organisationId,
      projectId: scope.projectId,
      version: 1,
      createdByUserId: scope.actorUserId,
      updatedByUserId: scope.actorUserId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  #touch<T extends OperationsRecord>(scope: OperationsScope, record: T): T {
    return {
      ...record,
      version: record.version + 1,
      updatedByUserId: scope.actorUserId,
      updatedAt: this.#now().toISOString(),
    };
  }

  #appendStatusReason(
    scope: OperationsScope,
    history: readonly OperationsStatusReason[] | undefined,
    fromStatus: string,
    toStatus: string,
    reason: string,
  ): OperationsStatusReason[] {
    const current = history ?? [];
    if (current.length >= OPERATIONS_SUITE_BOUNDS.statusReasonsPerRecord) {
      throw new OperationsSuiteError(
        "capacity_exceeded",
        "The status-reason history limit has been reached.",
      );
    }
    return [
      ...current,
      {
        id: this.#idFactory(),
        fromStatus,
        toStatus,
        reason,
        recordedByUserId: scope.actorUserId,
        recordedAt: this.#now().toISOString(),
      },
    ];
  }

  async #assertLatestCleanPackageQa(
    scope: OperationsScope,
    record: SubmissionWarRoomRecord,
  ): Promise<void> {
    const reports = (await this.#store.list(scope, "visual_qa_report")).filter(
      (candidate): candidate is VisualQaReportRecord =>
        candidate.kind === "visual_qa_report" &&
        candidate.packageVersionId === record.packageVersionId &&
        candidate.expectedManifestSha256 === record.manifestSha256,
    );
    const latest = reports.at(-1);
    if (!latest) {
      throw new OperationsSuiteError(
        "policy_denied",
        "A canonical-manifest visual QA pass is required before release progression.",
      );
    }
    if (
      latest.manifestSha256 !== record.manifestSha256 ||
      latest.result.status === "fail"
    ) {
      throw new OperationsSuiteError(
        "policy_denied",
        "The latest canonical-manifest visual QA report failed.",
      );
    }
    if (
      latest.result.status === "review" ||
      latest.result.findings.length > 0
    ) {
      throw new OperationsSuiteError(
        "policy_denied",
        "Visual QA review findings must be resolved into a clean pass before release progression.",
      );
    }
    if (latest.result.status !== "pass") {
      throw new OperationsSuiteError(
        "policy_denied",
        "A passing visual QA report is required before release progression.",
      );
    }
    await this.#references.assertPackageVersion(
      scope,
      record.packageVersionId,
      {
        packageId: record.packageId,
        manifestSha256: record.manifestSha256,
        requireRenderQaPassed: true,
      },
    );
  }

  async snapshot(
    scopeInput: OperationsScope,
  ): Promise<OperationsSuiteSnapshot> {
    const scope = this.#scope(scopeInput);
    const records = await this.#store.list(scope);
    const counts = Object.fromEntries(
      OPERATIONS_RECORD_KINDS.map((kind) => [
        kind,
        records.filter((record) => record.kind === kind).length,
      ]),
    ) as Record<OperationsRecordKind, number>;
    return {
      organisationId: scope.organisationId,
      projectId: scope.projectId,
      records,
      counts,
    };
  }

  async getRecord(
    scopeInput: OperationsScope,
    recordId: string,
  ): Promise<OperationsRecord> {
    const scope = this.#scope(scopeInput);
    const record = await this.#store.get(
      scope,
      requiredId(recordId, "recordId"),
    );
    if (!record) {
      throw new OperationsSuiteError("not_found", "The record was not found.");
    }
    return record;
  }

  async listMyWork(scopeInput: OperationsScope): Promise<WorkItemRecord[]> {
    const scope = this.#scope(scopeInput);
    const records = await this.#store.list(scope, "work_item");
    return records.filter(
      (record): record is WorkItemRecord =>
        record.kind === "work_item" && record.ownerUserId === scope.actorUserId,
    );
  }

  async mobileQueue(
    scopeInput: OperationsScope,
    readableKinds: readonly OperationsRecordKind[],
  ): Promise<OperationsMobileQueue> {
    const scope = this.#scope(scopeInput);
    const allowed = new Set(readableKinds);
    const items: OperationsMobileQueueItem[] = [];
    const compactLabel = (value: string): string =>
      value.slice(0, OPERATIONS_SUITE_BOUNDS.shortTextCodeUnits);
    const append = (item: OperationsMobileQueueItem): void => {
      if (items.length >= OPERATIONS_SUITE_BOUNDS.mobileQueueItems) {
        throw new OperationsSuiteError(
          "capacity_exceeded",
          "The mobile operations queue exceeds its safe fan-out bound.",
        );
      }
      items.push(item);
    };

    if (allowed.has("work_item")) {
      for (const record of await this.#store.list(scope, "work_item")) {
        if (
          record.kind !== "work_item" ||
          record.ownerUserId !== scope.actorUserId ||
          record.status === "done" ||
          record.status === "cancelled"
        ) {
          continue;
        }
        append({
          id: record.id,
          recordId: record.id,
          subresourceId: null,
          kind: "work_item",
          status: record.status,
          label: compactLabel(record.title),
          dueAt: record.dueAt,
          priority: record.priority,
          action: "continue_work",
          restrictedContent: true,
        });
      }
    }
    if (allowed.has("evidence_request")) {
      for (const record of await this.#store.list(scope, "evidence_request")) {
        if (record.kind !== "evidence_request") continue;
        for (const slot of record.slots) {
          // A rejected response is waiting for replacement, not another review
          // of the same bytes. Replacement clears acceptance and re-enters it.
          if (!slot.response || slot.acceptance !== null) {
            continue;
          }
          append({
            id: `${record.id}:${slot.id}`,
            recordId: record.id,
            subresourceId: slot.id,
            kind: "evidence_request",
            status: "awaiting_decision",
            label: compactLabel(slot.label),
            dueAt: record.dueAt,
            priority: null,
            action: "review_evidence_response",
            restrictedContent: true,
          });
        }
      }
    }
    if (allowed.has("submission_war_room")) {
      for (const record of await this.#store.list(
        scope,
        "submission_war_room",
      )) {
        if (
          record.kind !== "submission_war_room" ||
          record.status !== "dispatched" ||
          record.receiptSha256 !== null
        ) {
          continue;
        }
        append({
          id: record.id,
          recordId: record.id,
          subresourceId: null,
          kind: "submission_war_room",
          status: record.status,
          label: compactLabel(`Package version ${record.packageVersionId}`),
          dueAt: null,
          priority: null,
          action: "record_submission_receipt",
          restrictedContent: true,
        });
      }
    }
    if (allowed.has("mission")) {
      for (const record of await this.#store.list(scope, "mission")) {
        if (
          record.kind !== "mission" ||
          (record.status !== "planned" && record.status !== "attended")
        ) {
          continue;
        }
        append({
          id: record.id,
          recordId: record.id,
          subresourceId: null,
          kind: "mission",
          status: record.status,
          label: compactLabel(record.title),
          dueAt: record.startsAt,
          priority: null,
          action: "prepare_mission",
          restrictedContent: true,
        });
      }
    }

    items.sort(
      (left, right) =>
        (left.dueAt ?? "9999").localeCompare(right.dueAt ?? "9999") ||
        left.kind.localeCompare(right.kind) ||
        left.recordId.localeCompare(right.recordId) ||
        (left.subresourceId ?? "").localeCompare(right.subresourceId ?? ""),
    );
    return {
      restrictedContent: true,
      maxItems: OPERATIONS_SUITE_BOUNDS.mobileQueueItems,
      items,
    };
  }

  async createOpportunity(
    scopeInput: OperationsScope,
    raw: unknown,
  ): Promise<OpportunityIntakeRecord> {
    const scope = this.#scope(scopeInput);
    const input = parseCreateOpportunity(raw);
    const provenanceSha256 = digest({
      type: input.source.type,
      locator: input.source.locator,
      receivedAt: input.source.receivedAt,
      authorisationBasis: input.source.authorisationBasis ?? null,
      contentSha256: input.source.contentSha256 ?? null,
    });
    const dedupeKey = digest({
      issuer: normalizeDedupePart(input.issuer),
      reference: normalizeDedupePart(input.reference),
      lot: normalizeDedupePart(input.lot),
      title: input.reference ? "" : normalizeDedupePart(input.title),
      sourceLocator: normalizeDedupePart(input.source.locator),
    });
    if (await this.#store.findOpportunityByDedupe(scope, dedupeKey)) {
      throw new OperationsSuiteError(
        "conflict",
        "A matching opportunity intake already exists in this project.",
      );
    }
    const record: OpportunityIntakeRecord = {
      ...this.#base(scope, "opportunity_intake"),
      title: input.title,
      issuer: input.issuer,
      reference: input.reference ?? null,
      lot: input.lot ?? null,
      source: {
        type: input.source.type,
        locator: input.source.locator,
        receivedAt: input.source.receivedAt,
        authorisationBasis: input.source.authorisationBasis ?? null,
        contentSha256: input.source.contentSha256 ?? null,
      },
      dedupeKey,
      provenanceSha256,
      deadline: input.deadline ?? null,
      deadlineStatus: "unconfirmed",
      deadlineConfirmedByUserId: null,
      deadlineConfirmedAt: null,
      status: "recorded",
    };
    await this.#store.insert(scope, record);
    return record;
  }

  async confirmOpportunityDeadline(
    scopeInput: OperationsScope,
    recordId: string,
    raw: unknown,
  ): Promise<OpportunityIntakeRecord> {
    const scope = this.#scope(scopeInput);
    const input = parseConfirmDeadline(raw);
    const updated = await this.#store.compareAndSwap(
      scope,
      requiredId(recordId, "recordId"),
      input.expectedVersion,
      (record) => {
        if (!isKind(record, "opportunity_intake")) {
          throw new OperationsSuiteError(
            "not_found",
            "The intake was not found.",
          );
        }
        return this.#touch(scope, {
          ...record,
          deadline: input.deadline,
          deadlineStatus: "human_confirmed",
          deadlineConfirmedByUserId: scope.actorUserId,
          deadlineConfirmedAt: this.#now().toISOString(),
        });
      },
    );
    return updated as OpportunityIntakeRecord;
  }

  async #assertDependencies(
    scope: OperationsScope,
    dependencyIds: readonly string[],
    selfId?: string,
  ): Promise<WorkItemRecord[]> {
    if (selfId && dependencyIds.includes(selfId)) {
      throw new OperationsSuiteError(
        "policy_denied",
        "A work item cannot depend on itself.",
      );
    }
    const all = (await this.#store.list(scope, "work_item")).filter(
      (record): record is WorkItemRecord => record.kind === "work_item",
    );
    const byId = new Map(all.map((record) => [record.id, record]));
    const dependencies = dependencyIds.map((id) => {
      const dependency = byId.get(id);
      if (!dependency) {
        throw new OperationsSuiteError(
          "policy_denied",
          "Every dependency must be a work item in the active project.",
        );
      }
      return dependency;
    });
    if (selfId) {
      const visit = (id: string, seen: Set<string>): boolean => {
        if (id === selfId) return true;
        if (seen.has(id)) return false;
        seen.add(id);
        const item = byId.get(id);
        return item?.dependsOnIds.some((next) => visit(next, seen)) ?? false;
      };
      if (dependencyIds.some((id) => visit(id, new Set()))) {
        throw new OperationsSuiteError(
          "policy_denied",
          "Work item dependencies cannot form a cycle.",
        );
      }
    }
    return dependencies;
  }

  async createWorkItem(
    scopeInput: OperationsScope,
    raw: unknown,
  ): Promise<WorkItemRecord> {
    const scope = this.#scope(scopeInput);
    const input = parseCreateWorkItem(raw);
    const links: WorkObjectLinks = {
      requirementIds: input.links?.requirementIds ?? [],
      evidenceItemIds: input.links?.evidenceItemIds ?? [],
      packageIds: input.links?.packageIds ?? [],
    };
    await Promise.all([
      this.#references.assertWorkLinks(scope, links),
      input.ownerUserId
        ? this.#references.assertUser(scope, input.ownerUserId)
        : Promise.resolve(),
      this.#assertDependencies(scope, input.dependsOnIds ?? []),
    ]);
    const record: WorkItemRecord = {
      ...this.#base(scope, "work_item"),
      title: input.title,
      description: input.description ?? null,
      ownerUserId: input.ownerUserId ?? null,
      dueAt: input.dueAt ?? null,
      priority: input.priority ?? "normal",
      status: "backlog",
      links,
      dependsOnIds: input.dependsOnIds ?? [],
      comments: [],
      approval: {
        status: input.approvalRequired ? "pending" : "not_required",
        decidedByUserId: null,
        decidedAt: null,
        reason: null,
      },
      statusReasonHistory: [],
    };
    await this.#store.insert(scope, record);
    return record;
  }

  async updateWorkItem(
    scopeInput: OperationsScope,
    recordId: string,
    raw: unknown,
  ): Promise<WorkItemRecord> {
    const scope = this.#scope(scopeInput);
    const input = parseUpdateWorkItem(raw);
    const updated = await this.#store.compareAndSwap(
      scope,
      requiredId(recordId, "recordId"),
      input.expectedVersion,
      async (record) => {
        if (!isKind(record, "work_item")) {
          throw new OperationsSuiteError(
            "not_found",
            "The work item was not found.",
          );
        }
        if (record.status === "done" || record.status === "cancelled") {
          throw new OperationsSuiteError(
            "policy_denied",
            "A terminal work item cannot be changed.",
          );
        }
        const substantiveEdit =
          input.title !== undefined ||
          input.description !== undefined ||
          input.ownerUserId !== undefined ||
          input.dueAt !== undefined ||
          input.priority !== undefined ||
          input.links !== undefined ||
          input.dependsOnIds !== undefined;
        if (record.approval.status === "approved" && substantiveEdit) {
          throw new OperationsSuiteError(
            "policy_denied",
            "Approved work content cannot be edited; create a new approval-controlled item.",
          );
        }
        const links: WorkObjectLinks = {
          requirementIds:
            input.links?.requirementIds ?? record.links.requirementIds,
          evidenceItemIds:
            input.links?.evidenceItemIds ?? record.links.evidenceItemIds,
          packageIds: input.links?.packageIds ?? record.links.packageIds,
        };
        const dependencies = await this.#assertDependencies(
          scope,
          input.dependsOnIds ?? record.dependsOnIds,
          record.id,
        );
        await Promise.all([
          this.#references.assertWorkLinks(scope, links),
          input.ownerUserId
            ? this.#references.assertUser(scope, input.ownerUserId)
            : Promise.resolve(),
        ]);
        const nextStatus = input.status ?? record.status;
        if (
          nextStatus !== record.status &&
          !WORK_STATUS_TRANSITIONS[record.status].includes(nextStatus)
        ) {
          throw new OperationsSuiteError(
            "policy_denied",
            `Work cannot transition from ${record.status} to ${nextStatus}.`,
          );
        }
        if (nextStatus === "done") {
          if (dependencies.some((dependency) => dependency.status !== "done")) {
            throw new OperationsSuiteError(
              "policy_denied",
              "All dependencies must be done first.",
            );
          }
          if (
            record.approval.status !== "not_required" &&
            record.approval.status !== "approved"
          ) {
            throw new OperationsSuiteError(
              "policy_denied",
              "Required approval must be granted before completion.",
            );
          }
        }
        if (nextStatus === "cancelled" && !input.reason) {
          throw new OperationsSuiteError(
            "policy_denied",
            "Cancelling work requires a recorded reason.",
          );
        }
        if (input.reason && nextStatus !== "cancelled") {
          throw new OperationsSuiteError(
            "policy_denied",
            "A work-item reason is accepted only for cancellation.",
          );
        }
        return this.#touch(scope, {
          ...record,
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
          ...(input.ownerUserId === undefined
            ? {}
            : { ownerUserId: input.ownerUserId }),
          ...(input.dueAt === undefined ? {} : { dueAt: input.dueAt }),
          ...(input.priority === undefined ? {} : { priority: input.priority }),
          status: nextStatus,
          links,
          dependsOnIds: input.dependsOnIds ?? record.dependsOnIds,
          statusReasonHistory:
            nextStatus === "cancelled"
              ? this.#appendStatusReason(
                  scope,
                  record.statusReasonHistory,
                  record.status,
                  nextStatus,
                  input.reason as string,
                )
              : (record.statusReasonHistory ?? []),
        });
      },
    );
    return updated as WorkItemRecord;
  }

  async addWorkItemComment(
    scopeInput: OperationsScope,
    recordId: string,
    raw: unknown,
  ): Promise<WorkItemRecord> {
    const scope = this.#scope(scopeInput);
    const input = parseAddComment(raw);
    const updated = await this.#store.compareAndSwap(
      scope,
      requiredId(recordId, "recordId"),
      input.expectedVersion,
      (record) => {
        if (!isKind(record, "work_item")) {
          throw new OperationsSuiteError(
            "not_found",
            "The work item was not found.",
          );
        }
        if (
          record.comments.length >= OPERATIONS_SUITE_BOUNDS.commentsPerWorkItem
        ) {
          throw new OperationsSuiteError(
            "capacity_exceeded",
            "The work item comment limit has been reached.",
          );
        }
        return this.#touch(scope, {
          ...record,
          comments: [
            ...record.comments,
            {
              id: this.#idFactory(),
              body: input.body,
              authorUserId: scope.actorUserId,
              createdAt: this.#now().toISOString(),
            },
          ],
        });
      },
    );
    return updated as WorkItemRecord;
  }

  async decideWorkItemApproval(
    scopeInput: OperationsScope,
    recordId: string,
    raw: unknown,
  ): Promise<WorkItemRecord> {
    const scope = this.#scope(scopeInput);
    const input = parseApprovalDecision(raw);
    const updated = await this.#store.compareAndSwap(
      scope,
      requiredId(recordId, "recordId"),
      input.expectedVersion,
      (record) => {
        if (!isKind(record, "work_item")) {
          throw new OperationsSuiteError(
            "not_found",
            "The work item was not found.",
          );
        }
        if (record.approval.status !== "pending") {
          throw new OperationsSuiteError(
            "policy_denied",
            "Only a pending approval can be decided.",
          );
        }
        if (record.createdByUserId === scope.actorUserId) {
          throw new OperationsSuiteError(
            "policy_denied",
            "The work creator cannot decide its approval.",
          );
        }
        return this.#touch(scope, {
          ...record,
          approval: {
            status: input.decision,
            decidedByUserId: scope.actorUserId,
            decidedAt: this.#now().toISOString(),
            reason: input.reason,
          },
        });
      },
    );
    return updated as WorkItemRecord;
  }

  async createEvidenceRequest(
    scopeInput: OperationsScope,
    raw: unknown,
  ): Promise<EvidenceRequestRecord> {
    const scope = this.#scope(scopeInput);
    const input = parseCreateEvidenceRequest(raw);
    const record: EvidenceRequestRecord = {
      ...this.#base(scope, "evidence_request"),
      recipientLabel: input.recipientLabel,
      dueAt: input.dueAt ?? null,
      requestMessage: input.requestMessage,
      deliveryMode: "manual_out_of_band",
      status: "draft",
      sharedByUserId: null,
      sharedAt: null,
      slots: input.slots.map((slot) => ({
        id: this.#idFactory(),
        label: slot.label,
        required: slot.required,
        acceptedContentTypes: slot.acceptedContentTypes ?? [],
        response: null,
        acceptance: null,
        responseHistory: [],
      })),
      receiptSha256: null,
    };
    await this.#store.insert(scope, record);
    return record;
  }

  async markEvidenceRequestShared(
    scopeInput: OperationsScope,
    recordId: string,
    raw: unknown,
  ): Promise<EvidenceRequestRecord> {
    const scope = this.#scope(scopeInput);
    const input = parseExpectedVersionOnly(raw);
    const updated = await this.#store.compareAndSwap(
      scope,
      requiredId(recordId, "recordId"),
      input.expectedVersion,
      (record) => {
        if (!isKind(record, "evidence_request")) {
          throw new OperationsSuiteError(
            "not_found",
            "The request was not found.",
          );
        }
        if (record.status !== "draft") {
          throw new OperationsSuiteError(
            "policy_denied",
            "Only a draft request can be marked as manually shared.",
          );
        }
        return this.#touch(scope, {
          ...record,
          status: "shared_manually",
          sharedByUserId: scope.actorUserId,
          sharedAt: this.#now().toISOString(),
        });
      },
    );
    return updated as EvidenceRequestRecord;
  }

  async recordEvidenceResponse(
    scopeInput: OperationsScope,
    recordId: string,
    raw: unknown,
  ): Promise<EvidenceRequestRecord> {
    const scope = this.#scope(scopeInput);
    const input = parseEvidenceResponse(raw);
    const updated = await this.#store.compareAndSwap(
      scope,
      requiredId(recordId, "recordId"),
      input.expectedVersion,
      async (record) => {
        if (!isKind(record, "evidence_request")) {
          throw new OperationsSuiteError(
            "not_found",
            "The request was not found.",
          );
        }
        if (
          record.status !== "shared_manually" &&
          record.status !== "response_recorded"
        ) {
          throw new OperationsSuiteError(
            "policy_denied",
            "A response can only be recorded after manual sharing.",
          );
        }
        const slot = record.slots.find(({ id }) => id === input.slotId);
        if (!slot) {
          throw new OperationsSuiteError(
            "not_found",
            "The request slot was not found.",
          );
        }
        if (slot.response && slot.acceptance?.decision !== "rejected") {
          throw new OperationsSuiteError(
            "conflict",
            "The request slot already has an active recorded response.",
          );
        }
        const responseHistory = slot.responseHistory ?? [];
        if (
          slot.response &&
          responseHistory.length >=
            OPERATIONS_SUITE_BOUNDS.evidenceResponseHistoryPerSlot
        ) {
          throw new OperationsSuiteError(
            "capacity_exceeded",
            "The request slot response history limit has been reached.",
          );
        }
        await this.#references.assertDocument(
          scope,
          input.documentId,
          input.sha256,
          slot.acceptedContentTypes,
        );
        const recordedAt = this.#now().toISOString();
        return this.#touch(scope, {
          ...record,
          status: "response_recorded",
          slots: record.slots.map((candidate) =>
            candidate.id === input.slotId
              ? {
                  ...candidate,
                  response: {
                    documentId: input.documentId,
                    sha256: input.sha256,
                    attestation: input.attestation,
                    recordedByUserId: scope.actorUserId,
                    recordedAt,
                  },
                  acceptance: null,
                  responseHistory:
                    slot.response && slot.acceptance
                      ? [
                          ...responseHistory,
                          {
                            response: slot.response,
                            acceptance: slot.acceptance,
                          },
                        ]
                      : responseHistory,
                }
              : candidate,
          ),
        });
      },
    );
    return updated as EvidenceRequestRecord;
  }

  async decideEvidenceResponse(
    scopeInput: OperationsScope,
    recordId: string,
    raw: unknown,
  ): Promise<EvidenceRequestRecord> {
    const scope = this.#scope(scopeInput);
    const input = parseEvidenceDecision(raw);
    const updated = await this.#store.compareAndSwap(
      scope,
      requiredId(recordId, "recordId"),
      input.expectedVersion,
      async (record) => {
        if (!isKind(record, "evidence_request")) {
          throw new OperationsSuiteError(
            "not_found",
            "The request was not found.",
          );
        }
        const slot = record.slots.find(({ id }) => id === input.slotId);
        if (!slot?.response) {
          throw new OperationsSuiteError(
            "policy_denied",
            "Only a recorded response can be accepted or rejected.",
          );
        }
        if (slot.acceptance) {
          throw new OperationsSuiteError(
            "policy_denied",
            "A decided response cannot be overwritten; record a replacement after rejection.",
          );
        }
        await this.#references.assertDocument(
          scope,
          slot.response.documentId,
          slot.response.sha256,
          slot.acceptedContentTypes,
        );
        const decidedAt = this.#now().toISOString();
        const slots = record.slots.map((candidate) =>
          candidate.id === input.slotId
            ? {
                ...candidate,
                acceptance: {
                  decision: input.decision,
                  reason: input.reason,
                  decidedByUserId: scope.actorUserId,
                  decidedAt,
                },
              }
            : candidate,
        );
        const accepted =
          slots.some(({ acceptance }) => acceptance?.decision === "accepted") &&
          slots
            .filter(({ required }) => required)
            .every(({ acceptance }) => acceptance?.decision === "accepted");
        return this.#touch(scope, {
          ...record,
          status: accepted ? "accepted" : "response_recorded",
          slots,
          receiptSha256: accepted
            ? digest(
                slots.map(({ id, response, acceptance }) => ({
                  id,
                  responseSha256: response?.sha256 ?? null,
                  acceptance,
                })),
              )
            : null,
        });
      },
    );
    return updated as EvidenceRequestRecord;
  }

  async createSubmissionWarRoom(
    scopeInput: OperationsScope,
    raw: unknown,
  ): Promise<SubmissionWarRoomRecord> {
    const scope = this.#scope(scopeInput);
    const input = parseCreateSubmission(raw);
    await this.#references.assertPackageVersion(scope, input.packageVersionId, {
      packageId: input.packageId,
      manifestSha256: input.manifestSha256,
    });
    const existing = (
      await this.#store.list(scope, "submission_war_room")
    ).find(
      (record) =>
        record.kind === "submission_war_room" &&
        record.packageVersionId === input.packageVersionId &&
        record.status !== "cancelled",
    );
    if (existing) {
      throw new OperationsSuiteError(
        "conflict",
        "An active war room already exists for this package version.",
      );
    }
    const record: SubmissionWarRoomRecord = {
      ...this.#base(scope, "submission_war_room"),
      packageId: input.packageId,
      packageVersionId: input.packageVersionId,
      manifestSha256: input.manifestSha256,
      copyCount: input.copyCount ?? 0,
      sealIdentifiers: input.sealIdentifiers ?? [],
      status: "planning",
      externalActionPolicy: "record_only",
      frozenByUserId: null,
      frozenAt: null,
      dispatchedByUserId: null,
      dispatchedAt: null,
      dispatchMethod: null,
      receiptSha256: null,
      receiptRecordedByUserId: null,
      receiptRecordedAt: null,
      statusReasonHistory: [],
    };
    await this.#store.insert(scope, record);
    return record;
  }

  async advanceSubmissionWarRoom(
    scopeInput: OperationsScope,
    recordId: string,
    raw: unknown,
  ): Promise<SubmissionWarRoomRecord> {
    const scope = this.#scope(scopeInput);
    const input = parseAdvanceSubmission(raw);
    const expectedNext: Readonly<
      Partial<
        Record<
          SubmissionWarRoomRecord["status"],
          SubmissionWarRoomRecord["status"]
        >
      >
    > = {
      planning: "frozen",
      frozen: "copies_prepared",
      copies_prepared: "sealed",
      sealed: "dispatched",
      dispatched: "receipt_recorded",
    };
    const updated = await this.#store.compareAndSwap(
      scope,
      requiredId(recordId, "recordId"),
      input.expectedVersion,
      async (record) => {
        if (!isKind(record, "submission_war_room")) {
          throw new OperationsSuiteError(
            "not_found",
            "The war room was not found.",
          );
        }
        if (["receipt_recorded", "cancelled"].includes(record.status)) {
          throw new OperationsSuiteError(
            "policy_denied",
            "A terminal war room cannot be changed.",
          );
        }
        if (input.toStatus === "cancelled") {
          if (!input.reason) {
            throw new OperationsSuiteError(
              "policy_denied",
              "Cancellation requires a recorded reason.",
            );
          }
          return this.#touch(scope, {
            ...record,
            status: "cancelled",
            statusReasonHistory: this.#appendStatusReason(
              scope,
              record.statusReasonHistory,
              record.status,
              "cancelled",
              input.reason,
            ),
          });
        }
        if (input.reason) {
          throw new OperationsSuiteError(
            "policy_denied",
            "A war-room reason is accepted only for cancellation.",
          );
        }
        if (expectedNext[record.status] !== input.toStatus) {
          throw new OperationsSuiteError(
            "policy_denied",
            "War-room stages must advance exactly once in order.",
          );
        }
        // Cancellation returned above; every remaining transition at freeze or
        // later must still be backed by the latest clean canonical QA.
        if (input.toStatus === "frozen" || record.status !== "planning") {
          await this.#assertLatestCleanPackageQa(scope, record);
        }
        if (
          input.toStatus === "sealed" &&
          record.copyCount > 0 &&
          record.sealIdentifiers.length === 0
        ) {
          throw new OperationsSuiteError(
            "policy_denied",
            "At least one seal identifier is required before sealed status.",
          );
        }
        if (input.toStatus === "dispatched" && !input.dispatchMethod) {
          throw new OperationsSuiteError(
            "policy_denied",
            "Recording a completed human dispatch requires dispatchMethod.",
          );
        }
        if (input.toStatus === "receipt_recorded" && !input.receiptSha256) {
          throw new OperationsSuiteError(
            "policy_denied",
            "Receipt recording requires receiptSha256.",
          );
        }
        const timestamp = this.#now().toISOString();
        return this.#touch(scope, {
          ...record,
          status: input.toStatus,
          ...(input.toStatus === "frozen"
            ? { frozenByUserId: scope.actorUserId, frozenAt: timestamp }
            : {}),
          ...(input.toStatus === "dispatched"
            ? {
                dispatchedByUserId: scope.actorUserId,
                dispatchedAt: timestamp,
                dispatchMethod: input.dispatchMethod ?? null,
              }
            : {}),
          ...(input.toStatus === "receipt_recorded"
            ? {
                receiptSha256: input.receiptSha256 ?? null,
                receiptRecordedByUserId: scope.actorUserId,
                receiptRecordedAt: timestamp,
              }
            : {}),
        });
      },
    );
    return updated as SubmissionWarRoomRecord;
  }

  async createVisualQaReport(
    scopeInput: OperationsScope,
    raw: unknown,
  ): Promise<VisualQaReportRecord> {
    const scope = this.#scope(scopeInput);
    const input = parseCreateVisualQa(raw);
    await this.#references.assertPackageVersion(scope, input.packageVersionId, {
      manifestSha256: input.manifestSha256,
      expectedManifestSha256: input.expectedManifestSha256,
    });
    const result = evaluateVisualPackageQa(input);
    const record: VisualQaReportRecord = {
      ...this.#base(scope, "visual_qa_report"),
      packageVersionId: input.packageVersionId,
      manifestSha256: input.manifestSha256,
      expectedManifestSha256: input.expectedManifestSha256,
      result,
    };
    // The durable store insert and canonical package status update share the
    // request tenant transaction and project-scope advisory lock. Updating the
    // package last means a bounded/conflicting record insert cannot leave a QA
    // status without its operator-entered observations.
    await this.#store.insert(scope, record);
    await this.#references.setPackageRenderQaResult(
      scope,
      input.packageVersionId,
      {
        manifestSha256: input.manifestSha256,
        expectedManifestSha256: input.expectedManifestSha256,
      },
      result.status === "pass" && result.findings.length === 0
        ? "passed"
        : "failed",
    );
    return record;
  }

  async createCredentialVerification(
    scopeInput: OperationsScope,
    raw: unknown,
  ): Promise<CredentialVerificationRecord> {
    const scope = this.#scope(scopeInput);
    const input = parseCreateCredential(raw);
    const checkedAtMs = Date.parse(input.checkedAt);
    if (!Number.isFinite(checkedAtMs)) {
      throw new OperationsSuiteError(
        "invalid_request",
        "checkedAt must be a valid instant.",
      );
    }
    if (checkedAtMs > this.#now().getTime() + CREDENTIAL_CHECK_CLOCK_SKEW_MS) {
      throw new OperationsSuiteError(
        "policy_denied",
        "A completed credential check cannot be recorded in the future.",
      );
    }
    await this.#references.assertVaultItemSnapshot(
      scope,
      input.vaultItemId,
      input.vaultItemVersion,
      input.documentSha256,
    );
    const record: CredentialVerificationRecord = {
      ...this.#base(scope, "credential_verification"),
      vaultItemId: input.vaultItemId,
      vaultItemVersion: input.vaultItemVersion,
      documentSha256: input.documentSha256,
      authorityName: input.authorityName,
      officialSourceLocator: input.officialSourceLocator,
      checkedAt: input.checkedAt,
      checkedByUserId: scope.actorUserId,
      outcome: input.outcome,
      receiptSha256: input.receiptSha256,
      notes: input.notes ?? null,
      verificationMode: "human_recorded",
    };
    await this.#store.insert(scope, record);
    return record;
  }

  async createMission(
    scopeInput: OperationsScope,
    raw: unknown,
  ): Promise<MissionRecord> {
    const scope = this.#scope(scopeInput);
    const input = parseCreateMission(raw);
    if (input.delegateUserId) {
      await this.#references.assertUser(scope, input.delegateUserId);
    }
    const record: MissionRecord = {
      ...this.#base(scope, "mission"),
      missionType: input.missionType,
      title: input.title,
      location: input.location,
      startsAt: input.startsAt,
      attendanceRequired: input.attendanceRequired,
      delegateUserId: input.delegateUserId ?? null,
      delegateAuthorityNote: input.delegateAuthorityNote ?? null,
      checklist: input.checklist.map((item) => ({
        ...item,
        id: this.#idFactory(),
        completedByUserId: null,
        completedAt: null,
      })),
      proofs: [],
      followUpWorkItemIds: [],
      status: "planned",
      statusReasonHistory: [],
    };
    await this.#store.insert(scope, record);
    return record;
  }

  async updateMission(
    scopeInput: OperationsScope,
    recordId: string,
    raw: unknown,
  ): Promise<MissionRecord> {
    const scope = this.#scope(scopeInput);
    const input = parseUpdateMission(raw);
    if (input.followUpWorkItemId) {
      const followUp = await this.#store.get(scope, input.followUpWorkItemId);
      if (!followUp || followUp.kind !== "work_item") {
        throw new OperationsSuiteError(
          "policy_denied",
          "A follow-up must be a work item in the active project.",
        );
      }
    }
    const updated = await this.#store.compareAndSwap(
      scope,
      requiredId(recordId, "recordId"),
      input.expectedVersion,
      async (record) => {
        if (!isKind(record, "mission")) {
          throw new OperationsSuiteError(
            "not_found",
            "The mission was not found.",
          );
        }
        if (["completed", "missed", "cancelled"].includes(record.status)) {
          throw new OperationsSuiteError(
            "policy_denied",
            "A terminal mission cannot be changed.",
          );
        }
        const nextStatus = input.status ?? record.status;
        const statusChanged = nextStatus !== record.status;
        const allowed =
          (record.status === "planned" &&
            ["planned", "attended", "missed", "cancelled"].includes(
              nextStatus,
            )) ||
          (record.status === "attended" &&
            ["attended", "completed", "cancelled"].includes(nextStatus));
        if (!allowed) {
          throw new OperationsSuiteError(
            "policy_denied",
            `Mission cannot transition from ${record.status} to ${nextStatus}.`,
          );
        }
        if (
          statusChanged &&
          ["missed", "cancelled"].includes(nextStatus) &&
          !input.reason
        ) {
          throw new OperationsSuiteError(
            "policy_denied",
            "Missed or cancelled missions require a reason.",
          );
        }
        if (
          input.reason &&
          !(
            statusChanged &&
            (nextStatus === "missed" || nextStatus === "cancelled")
          )
        ) {
          throw new OperationsSuiteError(
            "policy_denied",
            "A mission reason is accepted only for a missed or cancelled transition.",
          );
        }
        const timestamp = this.#now().toISOString();
        const checklist = input.completedChecklistItemId
          ? record.checklist.map((item) =>
              item.id === input.completedChecklistItemId
                ? {
                    ...item,
                    completedByUserId: scope.actorUserId,
                    completedAt: timestamp,
                  }
                : item,
            )
          : record.checklist;
        if (
          input.completedChecklistItemId &&
          !record.checklist.some(
            ({ id }) => id === input.completedChecklistItemId,
          )
        ) {
          throw new OperationsSuiteError(
            "not_found",
            "The checklist item was not found.",
          );
        }
        if (input.proofDocumentId) {
          await this.#references.assertDocument(
            scope,
            input.proofDocumentId,
            input.proofSha256,
          );
        }
        const proofs = input.proofDocumentId
          ? record.proofs.some(
              ({ documentId, sha256 }) =>
                documentId === input.proofDocumentId &&
                sha256 === input.proofSha256,
            )
            ? record.proofs
            : [
                ...record.proofs,
                {
                  documentId: input.proofDocumentId,
                  sha256: input.proofSha256 as string,
                  recordedByUserId: scope.actorUserId,
                  recordedAt: timestamp,
                },
              ]
          : record.proofs;
        if (proofs.length > OPERATIONS_SUITE_BOUNDS.proofItemsPerMission) {
          throw new OperationsSuiteError(
            "capacity_exceeded",
            "The mission proof limit has been reached.",
          );
        }
        if (nextStatus === "completed") {
          if (
            checklist.some(
              ({ required, completedAt }) => required && completedAt === null,
            )
          ) {
            throw new OperationsSuiteError(
              "policy_denied",
              "Required checklist items must be completed first.",
            );
          }
          if (record.attendanceRequired && proofs.length === 0) {
            throw new OperationsSuiteError(
              "policy_denied",
              "Attendance proof is required before completion.",
            );
          }
          // Revalidate every retained proof while the mission CAS lock is
          // held. A document can be quarantined or replaced after it was first
          // recorded; terminal completion must use the current canonical row.
          await Promise.all(
            proofs.map((proof) =>
              this.#references.assertDocument(
                scope,
                proof.documentId,
                proof.sha256,
              ),
            ),
          );
        }
        return this.#touch(scope, {
          ...record,
          status: nextStatus,
          checklist,
          proofs,
          followUpWorkItemIds: input.followUpWorkItemId
            ? [
                ...new Set([
                  ...record.followUpWorkItemIds,
                  input.followUpWorkItemId,
                ]),
              ]
            : record.followUpWorkItemIds,
          statusReasonHistory:
            nextStatus !== record.status &&
            (nextStatus === "missed" || nextStatus === "cancelled")
              ? this.#appendStatusReason(
                  scope,
                  record.statusReasonHistory,
                  record.status,
                  nextStatus,
                  input.reason as string,
                )
              : (record.statusReasonHistory ?? []),
        });
      },
    );
    return updated as MissionRecord;
  }

  async createPostAwardItem(
    scopeInput: OperationsScope,
    raw: unknown,
  ): Promise<PostAwardItemRecord> {
    const scope = this.#scope(scopeInput);
    const input = parseCreatePostAward(raw);
    await Promise.all([
      input.ownerUserId
        ? this.#references.assertUser(scope, input.ownerUserId)
        : Promise.resolve(),
      input.sourceDocumentId
        ? this.#references.assertDocument(scope, input.sourceDocumentId)
        : Promise.resolve(),
      this.#references.assertDocuments(scope, input.evidenceDocumentIds ?? []),
    ]);
    const record: PostAwardItemRecord = {
      ...this.#base(scope, "post_award_item"),
      category: input.category,
      title: input.title,
      description: input.description ?? null,
      dueAt: input.dueAt ?? null,
      ownerUserId: input.ownerUserId ?? null,
      sourceDocumentId: input.sourceDocumentId ?? null,
      evidenceDocumentIds: input.evidenceDocumentIds ?? [],
      valueMinorUnits: input.valueMinorUnits ?? null,
      currency: input.currency ?? null,
      status: "open",
      completionReceiptSha256: null,
      completedByUserId: null,
      completedAt: null,
      statusReasonHistory: [],
    };
    await this.#store.insert(scope, record);
    return record;
  }

  async updatePostAwardItem(
    scopeInput: OperationsScope,
    recordId: string,
    raw: unknown,
  ): Promise<PostAwardItemRecord> {
    const scope = this.#scope(scopeInput);
    const input = parseUpdatePostAward(raw);
    if (input.ownerUserId) {
      await this.#references.assertUser(scope, input.ownerUserId);
    }
    if (input.evidenceDocumentIds) {
      await this.#references.assertDocuments(scope, input.evidenceDocumentIds);
    }
    const updated = await this.#store.compareAndSwap(
      scope,
      requiredId(recordId, "recordId"),
      input.expectedVersion,
      async (record) => {
        if (!isKind(record, "post_award_item")) {
          throw new OperationsSuiteError(
            "not_found",
            "The post-award item was not found.",
          );
        }
        if (record.status === "satisfied" || record.status === "cancelled") {
          throw new OperationsSuiteError(
            "policy_denied",
            "A terminal post-award item cannot be changed.",
          );
        }
        const nextStatus = input.status ?? record.status;
        const statusChanged = nextStatus !== record.status;
        if (
          nextStatus !== record.status &&
          !POST_AWARD_TRANSITIONS[record.status].includes(nextStatus)
        ) {
          throw new OperationsSuiteError(
            "policy_denied",
            `Post-award work cannot transition from ${record.status} to ${nextStatus}.`,
          );
        }
        if (
          statusChanged &&
          ["disputed", "cancelled"].includes(nextStatus) &&
          !input.reason
        ) {
          throw new OperationsSuiteError(
            "policy_denied",
            "Disputed or cancelled work requires a reason.",
          );
        }
        if (
          input.reason &&
          !(
            statusChanged &&
            (nextStatus === "disputed" || nextStatus === "cancelled")
          )
        ) {
          throw new OperationsSuiteError(
            "policy_denied",
            "A post-award reason is accepted only for a disputed or cancelled transition.",
          );
        }
        const evidenceDocumentIds =
          input.evidenceDocumentIds ?? record.evidenceDocumentIds;
        const receipt =
          input.completionReceiptSha256 === undefined
            ? record.completionReceiptSha256
            : input.completionReceiptSha256;
        if (
          nextStatus === "satisfied" &&
          (!receipt || evidenceDocumentIds.length === 0)
        ) {
          throw new OperationsSuiteError(
            "policy_denied",
            "Satisfied work requires evidence and a completion receipt hash.",
          );
        }
        if (nextStatus === "satisfied") {
          // Recheck retained references under the post-award CAS lock. This
          // closes the gap where a once-valid document is quarantined between
          // record creation and the terminal satisfied transition.
          await Promise.all([
            this.#references.assertDocuments(scope, evidenceDocumentIds),
            record.sourceDocumentId
              ? this.#references.assertDocument(scope, record.sourceDocumentId)
              : Promise.resolve(),
          ]);
        }
        const completedAt =
          nextStatus === "satisfied" ? this.#now().toISOString() : null;
        return this.#touch(scope, {
          ...record,
          status: nextStatus,
          ...(input.ownerUserId === undefined
            ? {}
            : { ownerUserId: input.ownerUserId }),
          ...(input.dueAt === undefined ? {} : { dueAt: input.dueAt }),
          evidenceDocumentIds,
          completionReceiptSha256: receipt,
          completedByUserId:
            nextStatus === "satisfied" ? scope.actorUserId : null,
          completedAt,
          statusReasonHistory:
            statusChanged &&
            (nextStatus === "disputed" || nextStatus === "cancelled")
              ? this.#appendStatusReason(
                  scope,
                  record.statusReasonHistory,
                  record.status,
                  nextStatus,
                  input.reason as string,
                )
              : (record.statusReasonHistory ?? []),
        });
      },
    );
    return updated as PostAwardItemRecord;
  }
}
