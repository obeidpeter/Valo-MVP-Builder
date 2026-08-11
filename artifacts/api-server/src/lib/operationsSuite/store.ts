import { OPERATIONS_SUITE_BOUNDS } from "./bounds";
import type {
  OperationsRecord,
  OperationsRecordKind,
  OperationsScope,
  OpportunityIntakeRecord,
} from "./contracts";
import { OperationsSuiteError } from "./errors";
import { cloneValue } from "./validation";

export interface OperationsSuiteStore {
  list(
    scope: OperationsScope,
    kind?: OperationsRecordKind,
  ): Promise<OperationsRecord[]>;
  get(scope: OperationsScope, id: string): Promise<OperationsRecord | null>;
  findOpportunityByDedupe(
    scope: OperationsScope,
    dedupeKey: string,
  ): Promise<OpportunityIntakeRecord | null>;
  insert(scope: OperationsScope, record: OperationsRecord): Promise<void>;
  compareAndSwap(
    scope: OperationsScope,
    id: string,
    expectedVersion: number,
    mutate: (
      current: OperationsRecord,
    ) => OperationsRecord | Promise<OperationsRecord>,
  ): Promise<OperationsRecord>;
}

function projectPrefix(scope: OperationsScope): string {
  return `${scope.organisationId}\u0000${scope.projectId}\u0000`;
}

function recordKey(scope: OperationsScope, id: string): string {
  return `${projectPrefix(scope)}${id}`;
}

/**
 * Development/test adapter only. Production must inject a durable store that
 * performs the same tenant/project predicates and compare-and-swap in one
 * transaction. The router factory intentionally has no global singleton.
 */
export class InMemoryOperationsSuiteStore implements OperationsSuiteStore {
  readonly #records = new Map<string, OperationsRecord>();
  readonly #insertionOrder = new Map<string, number>();
  readonly #scopeLocks = new Map<string, Promise<void>>();
  #nextInsertionOrder = 0;

  async #withScopeLock<T>(
    scope: OperationsScope,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = projectPrefix(scope);
    const previous = this.#scopeLocks.get(key) ?? Promise.resolve();
    let release = (): void => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#scopeLocks.set(key, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#scopeLocks.get(key) === current) this.#scopeLocks.delete(key);
    }
  }

  async list(
    scope: OperationsScope,
    kind?: OperationsRecordKind,
  ): Promise<OperationsRecord[]> {
    const prefix = projectPrefix(scope);
    return [...this.#records.entries()]
      .filter(
        ([key, record]) =>
          key.startsWith(prefix) && (!kind || record.kind === kind),
      )
      .sort(
        ([leftKey], [rightKey]) =>
          (this.#insertionOrder.get(leftKey) ?? Number.MAX_SAFE_INTEGER) -
          (this.#insertionOrder.get(rightKey) ?? Number.MAX_SAFE_INTEGER),
      )
      .map(([, record]) => cloneValue(record));
  }

  async get(
    scope: OperationsScope,
    id: string,
  ): Promise<OperationsRecord | null> {
    const record = this.#records.get(recordKey(scope, id));
    return record ? cloneValue(record) : null;
  }

  async findOpportunityByDedupe(
    scope: OperationsScope,
    dedupeKey: string,
  ): Promise<OpportunityIntakeRecord | null> {
    const records = await this.list(scope, "opportunity_intake");
    const match = records.find(
      (record): record is OpportunityIntakeRecord =>
        record.kind === "opportunity_intake" && record.dedupeKey === dedupeKey,
    );
    return match ?? null;
  }

  async insert(
    scope: OperationsScope,
    record: OperationsRecord,
  ): Promise<void> {
    if (
      record.organisationId !== scope.organisationId ||
      record.projectId !== scope.projectId
    ) {
      throw new OperationsSuiteError(
        "scope_denied",
        "The record does not belong to the active project scope.",
      );
    }
    await this.#withScopeLock(scope, async () => {
      const key = recordKey(scope, record.id);
      if (this.#records.has(key)) {
        throw new OperationsSuiteError(
          "conflict",
          "The record already exists.",
        );
      }
      const projectRecords = await this.list(scope);
      if (projectRecords.length >= OPERATIONS_SUITE_BOUNDS.recordsPerProject) {
        throw new OperationsSuiteError(
          "capacity_exceeded",
          "The project operations record limit has been reached.",
        );
      }
      if (
        record.kind === "opportunity_intake" &&
        projectRecords.some(
          (candidate) =>
            candidate.kind === "opportunity_intake" &&
            candidate.dedupeKey === record.dedupeKey,
        )
      ) {
        throw new OperationsSuiteError(
          "conflict",
          "The opportunity source is already recorded for this pursuit.",
        );
      }
      if (
        record.kind === "submission_war_room" &&
        record.status !== "cancelled" &&
        projectRecords.some(
          (candidate) =>
            candidate.kind === "submission_war_room" &&
            candidate.packageVersionId === record.packageVersionId &&
            candidate.status !== "cancelled",
        )
      ) {
        throw new OperationsSuiteError(
          "conflict",
          "An active war room already exists for this package version.",
        );
      }
      if (
        projectRecords.filter((candidate) => candidate.kind === record.kind)
          .length >= OPERATIONS_SUITE_BOUNDS.recordsPerKind
      ) {
        throw new OperationsSuiteError(
          "capacity_exceeded",
          `The ${record.kind} record limit has been reached.`,
        );
      }
      this.#records.set(key, cloneValue(record));
      this.#nextInsertionOrder += 1;
      this.#insertionOrder.set(key, this.#nextInsertionOrder);
    });
  }

  async compareAndSwap(
    scope: OperationsScope,
    id: string,
    expectedVersion: number,
    mutate: (
      current: OperationsRecord,
    ) => OperationsRecord | Promise<OperationsRecord>,
  ): Promise<OperationsRecord> {
    return this.#withScopeLock(scope, async () => {
      const key = recordKey(scope, id);
      const current = this.#records.get(key);
      if (!current) {
        throw new OperationsSuiteError(
          "not_found",
          "The record was not found.",
        );
      }
      if (current.version !== expectedVersion) {
        throw new OperationsSuiteError(
          "stale_version",
          "The record changed; reload before retrying.",
        );
      }
      const next = await mutate(cloneValue(current));
      if (
        next.id !== current.id ||
        next.kind !== current.kind ||
        next.organisationId !== scope.organisationId ||
        next.projectId !== scope.projectId ||
        next.version !== current.version + 1
      ) {
        throw new OperationsSuiteError(
          "policy_denied",
          "The mutation violated record identity or version invariants.",
        );
      }
      this.#records.set(key, cloneValue(next));
      return cloneValue(next);
    });
  }
}
