import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ENCRYPTED_FIELD_COMPANION_STATUS,
  isEncryptedFieldDraft,
  isEncryptedFieldDraftExpired,
  isEncryptedFieldDraftForScope,
} from "./encrypted-offline-field";

const draft = {
  schema: "valo.encrypted-field-draft/v1",
  id: "11111111-1111-4111-8111-111111111111",
  organisationId: "22222222-2222-4222-8222-222222222222",
  actorUserId: "33333333-3333-4333-8333-333333333333",
  kind: "site_visit_note",
  projectId: null,
  title: "Attendance receipt observation",
  note: "Draft observation only.",
  checklist: [
    { id: "item-1", label: "Attendance proof collected", completed: false },
  ],
  capturedAt: "2026-08-11T10:00:00.000Z",
  createdAt: "2026-08-11T10:01:00.000Z",
  updatedAt: "2026-08-11T10:01:00.000Z",
  expiresAt: "2026-08-18T10:01:00.000Z",
  version: 1,
  serverSubmitted: false,
  authoritative: false,
} as const;
const source = readFileSync(
  new URL("./encrypted-offline-field.ts", import.meta.url),
  "utf8",
);

describe("encrypted field draft contract", () => {
  it("accepts only bounded draft-only records", () => {
    expect(isEncryptedFieldDraft(draft)).toBe(true);
    expect(isEncryptedFieldDraft({ ...draft, serverSubmitted: true })).toBe(
      false,
    );
    expect(isEncryptedFieldDraft({ ...draft, authoritative: true })).toBe(
      false,
    );
    expect(isEncryptedFieldDraft({ ...draft, note: "x".repeat(4_001) })).toBe(
      false,
    );
  });

  it("keeps protected content and automatic synchronization disabled", () => {
    expect(ENCRYPTED_FIELD_COMPANION_STATUS.keyExtractable).toBe(false);
    expect(
      ENCRYPTED_FIELD_COMPANION_STATUS.serviceWorkerContentCacheAllowed,
    ).toBe(false);
    expect(ENCRYPTED_FIELD_COMPANION_STATUS.tenderCorpusAllowed).toBe(false);
    expect(ENCRYPTED_FIELD_COMPANION_STATUS.approvalAllowed).toBe(false);
    expect(ENCRYPTED_FIELD_COMPANION_STATUS.automaticSyncAllowed).toBe(false);
    expect(ENCRYPTED_FIELD_COMPANION_STATUS.maximumRetentionDays).toBe(7);
  });

  it("binds every draft to one actor and expires it after the bounded TTL", () => {
    expect(
      isEncryptedFieldDraftForScope(
        draft,
        draft.organisationId,
        draft.actorUserId,
      ),
    ).toBe(true);
    expect(
      isEncryptedFieldDraftForScope(
        draft,
        draft.organisationId,
        "44444444-4444-4444-8444-444444444444",
      ),
    ).toBe(false);
    expect(
      isEncryptedFieldDraftExpired(draft, new Date("2026-08-18T10:00:59.000Z")),
    ).toBe(false);
    expect(
      isEncryptedFieldDraftExpired(draft, new Date("2026-08-18T10:01:00.000Z")),
    ).toBe(true);
    expect(source).toMatch(/getOrCreateKey\(database, actorUserId\)/u);
    expect(source).toMatch(/partitionDigest\(organisationId, actorUserId\)/u);
    expect(source).toMatch(
      /filter\(\(draft\) => isEncryptedFieldDraftExpired/u,
    );
    expect(source).toMatch(
      /for \(const id of expiredIds\) store\.delete\(id\)/u,
    );
  });
});
