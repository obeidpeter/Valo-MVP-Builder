import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { OperationsScope, WorkObjectLinks } from "./contracts";
import { OperationsSuiteError } from "./errors";
import {
  FIELD_DRAFT_PROMOTION_SCHEMA,
  fieldDraftPromotionRequestSha256,
  parseFieldDraftPromotionRequest,
} from "./fieldDraftPromotion";
import {
  OperationsSuiteService,
  type OperationsSuiteReferenceGuard,
} from "./service";
import { InMemoryOperationsSuiteStore } from "./store";

const ORGANISATION_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_ACTOR_ID = "44444444-4444-4444-8444-444444444444";
const DRAFT_ID = "55555555-5555-4555-8555-555555555555";
const IDEMPOTENCY_KEY = "66666666-6666-4666-8666-666666666666";

const scope: OperationsScope = {
  organisationId: ORGANISATION_ID,
  projectId: PROJECT_ID,
  actorUserId: ACTOR_ID,
};

class References implements OperationsSuiteReferenceGuard {
  async assertUser(): Promise<void> {}
  async assertWorkLinks(
    _scope: OperationsScope,
    _links: WorkObjectLinks,
  ): Promise<void> {}
  async assertDocument(): Promise<void> {}
  async assertDocuments(): Promise<void> {}
  async assertPackageVersion(): Promise<void> {}
  async setPackageRenderQaResult(): Promise<void> {}
  async assertVaultItemSnapshot(): Promise<void> {}
}

function harness() {
  let sequence = 0;
  const store = new InMemoryOperationsSuiteStore();
  const service = new OperationsSuiteService({
    store,
    references: new References(),
    now: () => new Date("2026-08-13T09:00:00.000Z"),
    idFactory: () => `record-${++sequence}`,
  });
  return { service, store };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    schema: FIELD_DRAFT_PROMOTION_SCHEMA,
    draft: {
      id: DRAFT_ID,
      version: 3,
      organisationId: ORGANISATION_ID,
      actorUserId: ACTOR_ID,
      projectId: PROJECT_ID,
      kind: "site_visit_note",
      updatedAt: "2026-08-13T08:55:00.000Z",
    },
    expectedTargetVersion: 1,
    selectedFields: ["title", "note", "checklist"],
    values: {
      title: "Reviewed site attendance",
      note: "Named operator reviewed this observation after reconnecting.",
      checklist: [
        { id: "arrival", label: "Arrival logged", completed: true },
        {
          id: "attendance",
          label: "Attendance proof requested",
          completed: false,
        },
      ],
    },
    ...overrides,
  };
}

function hasCode(code: OperationsSuiteError["code"]) {
  return (error: unknown) =>
    error instanceof OperationsSuiteError && error.code === code;
}

test("parses one exact, bounded, actor/project-bound promotion command", () => {
  const parsed = parseFieldDraftPromotionRequest(request());
  assert.equal(parsed.draft.actorUserId, ACTOR_ID);
  assert.deepEqual(parsed.selectedFields, ["title", "note", "checklist"]);
  assert.equal(parsed.values.checklist?.length, 2);
  assert.match(
    fieldDraftPromotionRequestSha256(parsed, "record-1", IDEMPOTENCY_KEY),
    /^[a-f0-9]{64}$/u,
  );
  assert.throws(
    () =>
      parseFieldDraftPromotionRequest(
        request({ selectedFields: ["note", "title"] }),
      ),
    hasCode("invalid_request"),
  );
  assert.throws(
    () =>
      parseFieldDraftPromotionRequest(
        request({
          selectedFields: ["title"],
          values: { title: "Reviewed", note: "Unselected value" },
        }),
      ),
    hasCode("invalid_request"),
  );
});

test("promotes selected fields under CAS and returns a content-free receipt", async () => {
  const { service } = harness();
  const target = await service.createWorkItem(scope, {
    title: "Original work item",
    description: "Original description",
  });
  let authorityChecks = 0;
  const receipt = await service.promoteFieldDraftToWorkItem(
    scope,
    target.id,
    request(),
    IDEMPOTENCY_KEY,
    async (checkedScope) => {
      authorityChecks += 1;
      assert.deepEqual(checkedScope, scope);
    },
  );
  assert.equal(authorityChecks, 2);
  assert.equal(receipt.targetVersion, 2);
  assert.equal(receipt.replayed, false);
  assert.equal(receipt.authoritativeEvidenceCreated, false);
  assert.equal(receipt.localDraftDeleted, false);
  assert.match(receipt.receiptSha256, /^[a-f0-9]{64}$/u);
  assert.equal("title" in receipt, false);
  assert.equal("note" in receipt, false);
  assert.equal("checklist" in receipt, false);

  const updated = await service.getRecord(scope, target.id);
  assert.equal(updated?.kind, "work_item");
  if (!updated || updated.kind !== "work_item") return;
  assert.equal(updated.title, "Reviewed site attendance");
  assert.equal(
    updated.description,
    "Named operator reviewed this observation after reconnecting.",
  );
  assert.deepEqual(
    updated.comments.map(({ body }) => body),
    [
      "[Field draft checklist] Completed: Arrival logged",
      "[Field draft checklist] Open: Attendance proof requested",
    ],
  );
});

test("replays only the same verified receipt and rejects key reuse", async () => {
  const { service } = harness();
  const target = await service.createWorkItem(scope, { title: "Original" });
  const check = async () => undefined;
  const first = await service.promoteFieldDraftToWorkItem(
    scope,
    target.id,
    request(),
    IDEMPOTENCY_KEY,
    check,
  );
  const replay = await service.promoteFieldDraftToWorkItem(
    scope,
    target.id,
    request(),
    IDEMPOTENCY_KEY,
    check,
  );
  assert.equal(replay.replayed, true);
  assert.equal(replay.receiptSha256, first.receiptSha256);
  assert.equal(replay.targetVersion, first.targetVersion);

  await assert.rejects(
    service.promoteFieldDraftToWorkItem(
      scope,
      target.id,
      request({ values: { title: "Different", note: "", checklist: [] } }),
      IDEMPOTENCY_KEY,
      check,
    ),
    hasCode("conflict"),
  );
});

test("rejects a fresh key for an already promoted draft revision without mutation", async () => {
  const { service } = harness();
  const target = await service.createWorkItem(scope, { title: "Original" });
  await service.promoteFieldDraftToWorkItem(
    scope,
    target.id,
    request(),
    IDEMPOTENCY_KEY,
    async () => undefined,
  );
  const before = await service.getRecord(scope, target.id);
  assert.equal(before.kind, "work_item");
  if (before.kind !== "work_item") return;
  const beforeBodies = before.comments.map(({ body }) => body);

  await assert.rejects(
    service.promoteFieldDraftToWorkItem(
      scope,
      target.id,
      request({ expectedTargetVersion: before.version }),
      "99999999-9999-4999-8999-999999999999",
      async () => undefined,
    ),
    hasCode("conflict"),
  );
  const after = await service.getRecord(scope, target.id);
  assert.equal(after.version, before.version);
  assert.equal(after.kind, "work_item");
  if (after.kind !== "work_item") return;
  assert.deepEqual(
    after.comments.map(({ body }) => body),
    beforeBodies,
  );
});

test("concurrent identical submissions settle as one commit and one replay", async () => {
  const { service } = harness();
  const target = await service.createWorkItem(scope, { title: "Original" });
  const [left, right] = await Promise.all([
    service.promoteFieldDraftToWorkItem(
      scope,
      target.id,
      request(),
      IDEMPOTENCY_KEY,
      async () => undefined,
    ),
    service.promoteFieldDraftToWorkItem(
      scope,
      target.id,
      request(),
      IDEMPOTENCY_KEY,
      async () => undefined,
    ),
  ]);
  assert.deepEqual([left.replayed, right.replayed].sort(), [false, true]);
  assert.equal(left.receiptSha256, right.receiptSha256);
});

test("rechecks authority under the target CAS lock before mutation", async () => {
  const { service } = harness();
  const target = await service.createWorkItem(scope, { title: "Original" });
  let checks = 0;
  await assert.rejects(
    service.promoteFieldDraftToWorkItem(
      scope,
      target.id,
      request(),
      IDEMPOTENCY_KEY,
      async () => {
        checks += 1;
        if (checks === 2) {
          throw new OperationsSuiteError(
            "scope_denied",
            "Authority changed before write.",
          );
        }
      },
    ),
    hasCode("scope_denied"),
  );
  const unchanged = await service.getRecord(scope, target.id);
  assert.equal(unchanged?.version, 1);
  assert.equal(unchanged?.kind === "work_item" && unchanged.title, "Original");
});

test("fails closed on draft scope drift, stale targets and terminal targets", async () => {
  const { service } = harness();
  let target = await service.createWorkItem(scope, { title: "Original" });
  await assert.rejects(
    service.promoteFieldDraftToWorkItem(
      scope,
      target.id,
      request({
        draft: { ...request().draft, actorUserId: OTHER_ACTOR_ID },
      }),
      IDEMPOTENCY_KEY,
      async () => undefined,
    ),
    hasCode("scope_denied"),
  );
  await assert.rejects(
    service.promoteFieldDraftToWorkItem(
      scope,
      target.id,
      request({ expectedTargetVersion: 2 }),
      IDEMPOTENCY_KEY,
      async () => undefined,
    ),
    hasCode("stale_version"),
  );

  target = await service.updateWorkItem(scope, target.id, {
    expectedVersion: target.version,
    status: "cancelled",
    reason: "This target is no longer compatible.",
  });
  await assert.rejects(
    service.promoteFieldDraftToWorkItem(
      scope,
      target.id,
      request({ expectedTargetVersion: target.version }),
      "77777777-7777-4777-8777-777777777777",
      async () => undefined,
    ),
    hasCode("policy_denied"),
  );
});

test("does not disclose a replay after current authority is withdrawn", async () => {
  const { service } = harness();
  const target = await service.createWorkItem(scope, { title: "Original" });
  await service.promoteFieldDraftToWorkItem(
    scope,
    target.id,
    request(),
    IDEMPOTENCY_KEY,
    async () => undefined,
  );
  await assert.rejects(
    service.promoteFieldDraftToWorkItem(
      scope,
      target.id,
      request(),
      IDEMPOTENCY_KEY,
      async () => {
        throw new OperationsSuiteError(
          "scope_denied",
          "Current authority is absent.",
        );
      },
    ),
    hasCode("scope_denied"),
  );
});

test("enforces the bounded content-free receipt history", async () => {
  const { service } = harness();
  const target = await service.createWorkItem(scope, { title: "Original" });
  const identifier = (prefix: number, index: number) =>
    `${String(prefix).repeat(8)}-${String(prefix).repeat(4)}-4${String(prefix).repeat(3)}-8${String(prefix).repeat(3)}-${String(index).padStart(12, "0")}`;
  for (let index = 1; index <= 25; index += 1) {
    await service.promoteFieldDraftToWorkItem(
      scope,
      target.id,
      request({
        draft: {
          ...request().draft,
          id: identifier(7, index),
          version: 1,
        },
        expectedTargetVersion: index,
        selectedFields: ["title"],
        values: { title: `Reviewed title ${index}` },
      }),
      identifier(8, index),
      async () => undefined,
    );
  }
  await assert.rejects(
    service.promoteFieldDraftToWorkItem(
      scope,
      target.id,
      request({
        draft: {
          ...request().draft,
          id: identifier(7, 26),
          version: 1,
        },
        expectedTargetVersion: 26,
        selectedFields: ["title"],
        values: { title: "One receipt too many" },
      }),
      identifier(8, 26),
      async () => undefined,
    ),
    hasCode("capacity_exceeded"),
  );
});

test("wires the endpoint through fresh project and direct update authority", () => {
  const route = readFileSync(
    resolve(import.meta.dirname, "../../routes/operationsSuite.ts"),
    "utf8",
  );
  const endpoint = route.slice(
    route.indexOf(
      '"/projects/:id/operations-suite/work-items/:recordId/field-draft-promotions"',
    ),
    route.indexOf(
      '"/projects/:id/operations-suite/work-items/:recordId/approval"',
    ),
  );
  assert.match(endpoint, /requirePermissionOrLegacy\("project:update"\)/u);
  assert.match(
    endpoint,
    /dependencies\.projectGuard\.assertProject\(promotionScope\)/u,
  );
  assert.match(endpoint, /resolveAuthority\(/u);
  assert.match(endpoint, /authority\.permissions\.has\("project:update"\)/u);
  assert.doesNotMatch(
    endpoint,
    /console\.(?:log|info|debug)|req\.body.*audit/u,
  );
});
