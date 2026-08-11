const DATABASE_NAME = "valo-encrypted-field-v1";
const DATABASE_VERSION = 2;
const KEY_STORE = "device_keys";
const DRAFT_STORE = "encrypted_drafts";
const PARTITION_INDEX = "partition_digest";
const ACTOR_INDEX = "actor_key_id";
const KEY_ID_PREFIX = "valo-field-aes-gcm-v1:";
const SCHEMA = "valo.encrypted-field-draft/v1" as const;
const SHA256 = /^[a-f0-9]{64}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const ENCRYPTED_FIELD_COMPANION_STATUS = Object.freeze({
  encryptedAtRest: true,
  keyExtractable: false,
  serviceWorkerContentCacheAllowed: false,
  tenderCorpusAllowed: false,
  approvalAllowed: false,
  fileOrPhotoCaptureAllowed: false,
  automaticSyncAllowed: false,
  maximumRetentionDays: 7,
  serverAuthority: "none" as const,
});

export const ENCRYPTED_FIELD_BOUNDS = Object.freeze({
  draftsPerOrganisation: 25,
  titleCodeUnits: 160,
  noteCodeUnits: 4_000,
  checklistItems: 20,
  checklistLabelCodeUnits: 160,
  plaintextBytes: 32_000,
  draftTtlDays: 7,
});

export type EncryptedFieldDraftKind =
  | "site_visit_note"
  | "delivery_receipt_note"
  | "checklist_progress";

export interface EncryptedFieldChecklistItem {
  id: string;
  label: string;
  completed: boolean;
}

export interface EncryptedFieldDraft {
  schema: typeof SCHEMA;
  id: string;
  organisationId: string;
  actorUserId: string;
  kind: EncryptedFieldDraftKind;
  projectId: string | null;
  title: string;
  note: string;
  checklist: EncryptedFieldChecklistItem[];
  capturedAt: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  version: number;
  serverSubmitted: false;
  authoritative: false;
}

export interface EncryptedFieldDraftInput {
  id?: string;
  expectedVersion?: number;
  organisationId: string;
  actorUserId: string;
  kind: EncryptedFieldDraftKind;
  projectId: string | null;
  title: string;
  note: string;
  checklist: EncryptedFieldChecklistItem[];
  capturedAt: string;
}

interface StoredKey {
  id: string;
  key: CryptoKey;
}

interface StoredCiphertext {
  id: string;
  partitionDigest: string;
  actorKeyId: string;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
  updatedAt: string;
}

function isStoredCiphertext(value: unknown): value is StoredCiphertext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    Object.keys(row).length === 6 &&
    typeof row.id === "string" &&
    UUID.test(row.id) &&
    typeof row.partitionDigest === "string" &&
    SHA256.test(row.partitionDigest) &&
    typeof row.actorKeyId === "string" &&
    row.actorKeyId.startsWith(KEY_ID_PREFIX) &&
    UUID.test(row.actorKeyId.slice(KEY_ID_PREFIX.length)) &&
    row.iv instanceof ArrayBuffer &&
    row.iv.byteLength === 12 &&
    row.ciphertext instanceof ArrayBuffer &&
    row.ciphertext.byteLength >= 16 &&
    row.ciphertext.byteLength <= ENCRYPTED_FIELD_BOUNDS.plaintextBytes + 16 &&
    iso(row.updatedAt)
  );
}

export class EncryptedFieldCompanionError extends Error {
  readonly name = "EncryptedFieldCompanionError";
  constructor(
    readonly code:
      | "unavailable"
      | "invalid_input"
      | "capacity_exceeded"
      | "conflict"
      | "integrity_failed",
  ) {
    super("Encrypted field companion operation failed");
  }
}

const fail = (code: EncryptedFieldCompanionError["code"]): never => {
  throw new EncryptedFieldCompanionError(code);
};

const text = (
  value: unknown,
  max: number,
  allowEmpty = false,
): value is string =>
  typeof value === "string" &&
  value === value.trim() &&
  (allowEmpty || value.length > 0) &&
  value.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);

const iso = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value) &&
  Number.isFinite(Date.parse(value));

const kinds = new Set<EncryptedFieldDraftKind>([
  "site_visit_note",
  "delivery_receipt_note",
  "checklist_progress",
]);

function validChecklist(
  value: unknown,
): value is EncryptedFieldChecklistItem[] {
  if (
    !Array.isArray(value) ||
    value.length > ENCRYPTED_FIELD_BOUNDS.checklistItems
  )
    return false;
  const ids = new Set<string>();
  return value.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const row = item as Record<string, unknown>;
    if (
      Object.keys(row).length !== 3 ||
      typeof row.id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(row.id) ||
      ids.has(row.id) ||
      !text(row.label, ENCRYPTED_FIELD_BOUNDS.checklistLabelCodeUnits) ||
      typeof row.completed !== "boolean"
    )
      return false;
    ids.add(row.id);
    return true;
  });
}

export function isEncryptedFieldDraft(
  value: unknown,
): value is EncryptedFieldDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    Object.keys(row).length === 16 &&
    row.schema === SCHEMA &&
    typeof row.id === "string" &&
    UUID.test(row.id) &&
    typeof row.organisationId === "string" &&
    UUID.test(row.organisationId) &&
    typeof row.actorUserId === "string" &&
    UUID.test(row.actorUserId) &&
    typeof row.kind === "string" &&
    kinds.has(row.kind as EncryptedFieldDraftKind) &&
    (row.projectId === null ||
      (typeof row.projectId === "string" && UUID.test(row.projectId))) &&
    text(row.title, ENCRYPTED_FIELD_BOUNDS.titleCodeUnits) &&
    text(row.note, ENCRYPTED_FIELD_BOUNDS.noteCodeUnits, true) &&
    validChecklist(row.checklist) &&
    iso(row.capturedAt) &&
    iso(row.createdAt) &&
    iso(row.updatedAt) &&
    iso(row.expiresAt) &&
    typeof row.version === "number" &&
    Number.isSafeInteger(row.version) &&
    row.version >= 1 &&
    row.serverSubmitted === false &&
    row.authoritative === false
  );
}

export function isEncryptedFieldDraftForScope(
  value: unknown,
  organisationId: string,
  actorUserId: string,
): value is EncryptedFieldDraft {
  return (
    UUID.test(organisationId) &&
    UUID.test(actorUserId) &&
    isEncryptedFieldDraft(value) &&
    value.organisationId === organisationId &&
    value.actorUserId === actorUserId
  );
}

export function isEncryptedFieldDraftExpired(
  value: unknown,
  now = new Date(),
): boolean {
  return (
    !Number.isFinite(now.getTime()) ||
    !isEncryptedFieldDraft(value) ||
    Date.parse(value.expiresAt) <= now.getTime()
  );
}

function validateInput(value: EncryptedFieldDraftInput): void {
  if (
    !UUID.test(value.organisationId) ||
    !UUID.test(value.actorUserId) ||
    !kinds.has(value.kind) ||
    !(value.projectId === null || UUID.test(value.projectId)) ||
    !text(value.title, ENCRYPTED_FIELD_BOUNDS.titleCodeUnits) ||
    !text(value.note, ENCRYPTED_FIELD_BOUNDS.noteCodeUnits, true) ||
    !validChecklist(value.checklist) ||
    !iso(value.capturedAt) ||
    !(value.id === undefined || UUID.test(value.id)) ||
    !(
      value.expectedVersion === undefined ||
      (Number.isSafeInteger(value.expectedVersion) &&
        value.expectedVersion! >= 1)
    )
  )
    fail("invalid_input");
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new EncryptedFieldCompanionError("unavailable"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(new EncryptedFieldCompanionError("unavailable"));
    transaction.onerror = () =>
      reject(new EncryptedFieldCompanionError("unavailable"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB || !globalThis.crypto?.subtle)
    return Promise.reject(new EncryptedFieldCompanionError("unavailable"));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      if (!database.objectStoreNames.contains(KEY_STORE)) {
        database.createObjectStore(KEY_STORE, { keyPath: "id" });
      } else if (event.oldVersion > 0 && event.oldVersion < 2) {
        request.transaction?.objectStore(KEY_STORE).clear();
      }
      if (!database.objectStoreNames.contains(DRAFT_STORE)) {
        const drafts = database.createObjectStore(DRAFT_STORE, {
          keyPath: "id",
        });
        drafts.createIndex(PARTITION_INDEX, "partitionDigest", {
          unique: false,
        });
        drafts.createIndex(ACTOR_INDEX, "actorKeyId", { unique: false });
      } else {
        const drafts = request.transaction?.objectStore(DRAFT_STORE);
        if (event.oldVersion > 0 && event.oldVersion < 2) drafts?.clear();
        if (drafts && !drafts.indexNames.contains(ACTOR_INDEX)) {
          drafts.createIndex(ACTOR_INDEX, "actorKeyId", { unique: false });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new EncryptedFieldCompanionError("unavailable"));
    request.onblocked = () =>
      reject(new EncryptedFieldCompanionError("unavailable"));
  });
}

function actorKeyId(actorUserId: string): string {
  if (!UUID.test(actorUserId)) fail("invalid_input");
  return `${KEY_ID_PREFIX}${actorUserId}`;
}

async function getOrCreateKey(
  database: IDBDatabase,
  actorUserId: string,
): Promise<CryptoKey> {
  const keyId = actorKeyId(actorUserId);
  const read = database.transaction(KEY_STORE, "readonly");
  const readDone = transactionDone(read);
  const existing = (await requestResult(
    read.objectStore(KEY_STORE).get(keyId),
  )) as StoredKey | undefined;
  await readDone;
  if (typeof CryptoKey !== "undefined" && existing?.key instanceof CryptoKey) {
    if (
      existing.key.extractable ||
      !existing.key.usages.includes("encrypt") ||
      !existing.key.usages.includes("decrypt")
    )
      fail("integrity_failed");
    return existing.key;
  }
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const write = database.transaction(KEY_STORE, "readwrite");
  const writeDone = transactionDone(write);
  try {
    write.objectStore(KEY_STORE).add({ id: keyId, key } satisfies StoredKey);
    await writeDone;
    return key;
  } catch {
    const retry = database.transaction(KEY_STORE, "readonly");
    const retryDone = transactionDone(retry);
    const raced = (await requestResult(
      retry.objectStore(KEY_STORE).get(keyId),
    )) as StoredKey | undefined;
    await retryDone;
    const racedKey = raced?.key;
    if (
      !racedKey ||
      racedKey.extractable ||
      !racedKey.usages.includes("encrypt") ||
      !racedKey.usages.includes("decrypt")
    )
      fail("integrity_failed");
    return racedKey as CryptoKey;
  }
}

async function partitionDigest(
  organisationId: string,
  actorUserId: string,
): Promise<string> {
  if (!UUID.test(organisationId) || !UUID.test(actorUserId))
    fail("invalid_input");
  const bytes = new TextEncoder().encode(
    `${SCHEMA}:${organisationId}:${actorUserId}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function additionalData(
  id: string,
  partition: string,
): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(`${SCHEMA}:${id}:${partition}`);
  const copy = new Uint8Array(new ArrayBuffer(encoded.byteLength));
  copy.set(encoded);
  return copy;
}

async function encryptDraft(
  key: CryptoKey,
  partition: string,
  actorUserId: string,
  draft: EncryptedFieldDraft,
): Promise<StoredCiphertext> {
  const encoded = new TextEncoder().encode(JSON.stringify(draft));
  if (encoded.byteLength > ENCRYPTED_FIELD_BOUNDS.plaintextBytes)
    fail("invalid_input");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: additionalData(draft.id, partition),
      tagLength: 128,
    },
    key,
    encoded,
  );
  return {
    id: draft.id,
    partitionDigest: partition,
    actorKeyId: actorKeyId(actorUserId),
    iv: iv.buffer,
    ciphertext,
    updatedAt: draft.updatedAt,
  };
}

async function decryptDraft(
  key: CryptoKey,
  stored: StoredCiphertext,
): Promise<EncryptedFieldDraft> {
  if (!isStoredCiphertext(stored)) fail("integrity_failed");
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: stored.iv,
        additionalData: additionalData(stored.id, stored.partitionDigest),
        tagLength: 128,
      },
      key,
      stored.ciphertext,
    );
    if (plaintext.byteLength > ENCRYPTED_FIELD_BOUNDS.plaintextBytes)
      fail("integrity_failed");
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
    );
    if (
      !isEncryptedFieldDraft(value) ||
      value.id !== stored.id ||
      actorKeyId(value.actorUserId) !== stored.actorKeyId ||
      value.updatedAt !== stored.updatedAt
    )
      fail("integrity_failed");
    return value as EncryptedFieldDraft;
  } catch (error) {
    if (error instanceof EncryptedFieldCompanionError) throw error;
    return fail("integrity_failed");
  }
}

async function withDatabase<T>(
  operation: (database: IDBDatabase) => Promise<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await operation(database);
  } finally {
    database.close();
  }
}

async function withExclusiveDeviceLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  if (!globalThis.navigator?.locks) fail("unavailable");
  return navigator.locks.request(
    "valo-encrypted-field-store-v1",
    { mode: "exclusive" },
    operation,
  );
}

async function purgeExpiredPartition(
  database: IDBDatabase,
  key: CryptoKey,
  partition: string,
  organisationId: string,
  actorUserId: string,
  now: Date,
): Promise<EncryptedFieldDraft[]> {
  if (!Number.isFinite(now.getTime())) fail("invalid_input");
  const transaction = database.transaction(DRAFT_STORE, "readonly");
  const done = transactionDone(transaction);
  const rows = (await requestResult(
    transaction
      .objectStore(DRAFT_STORE)
      .index(PARTITION_INDEX)
      .getAll(partition, 101),
  )) as StoredCiphertext[];
  await done;
  if (rows.length > 100) fail("capacity_exceeded");
  const drafts = await Promise.all(rows.map((row) => decryptDraft(key, row)));
  if (
    drafts.some(
      (draft) =>
        !isEncryptedFieldDraftForScope(draft, organisationId, actorUserId),
    )
  ) {
    fail("integrity_failed");
  }
  const expiredIds = drafts
    .filter((draft) => isEncryptedFieldDraftExpired(draft, now))
    .map((draft) => draft.id);
  if (expiredIds.length > 0) {
    const write = database.transaction(DRAFT_STORE, "readwrite");
    const writeDone = transactionDone(write);
    const store = write.objectStore(DRAFT_STORE);
    for (const id of expiredIds) store.delete(id);
    await writeDone;
  }
  const active = drafts.filter(
    (draft) => !isEncryptedFieldDraftExpired(draft, now),
  );
  if (active.length > ENCRYPTED_FIELD_BOUNDS.draftsPerOrganisation)
    fail("capacity_exceeded");
  return active;
}

export async function listEncryptedFieldDrafts(
  organisationId: string,
  actorUserId: string,
  now = new Date(),
): Promise<EncryptedFieldDraft[]> {
  if (!UUID.test(organisationId) || !UUID.test(actorUserId))
    fail("invalid_input");
  return withExclusiveDeviceLock(() =>
    withDatabase(async (database) => {
      const [key, partition] = await Promise.all([
        getOrCreateKey(database, actorUserId),
        partitionDigest(organisationId, actorUserId),
      ]);
      const drafts = await purgeExpiredPartition(
        database,
        key,
        partition,
        organisationId,
        actorUserId,
        now,
      );
      return drafts.sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      );
    }),
  );
}

export async function saveEncryptedFieldDraft(
  input: EncryptedFieldDraftInput,
  now = new Date(),
): Promise<EncryptedFieldDraft> {
  validateInput(input);
  if (!Number.isFinite(now.getTime())) fail("invalid_input");
  return withExclusiveDeviceLock(() =>
    withDatabase(async (database) => {
      const [key, partition] = await Promise.all([
        getOrCreateKey(database, input.actorUserId),
        partitionDigest(input.organisationId, input.actorUserId),
      ]);
      const activeDrafts = await purgeExpiredPartition(
        database,
        key,
        partition,
        input.organisationId,
        input.actorUserId,
        now,
      );
      const id = input.id ?? crypto.randomUUID();
      const read = database.transaction(DRAFT_STORE, "readonly");
      const readDone = transactionDone(read);
      const store = read.objectStore(DRAFT_STORE);
      const stored = (await requestResult(store.get(id))) as
        | StoredCiphertext
        | undefined;
      await readDone;
      const previous = stored ? await decryptDraft(key, stored) : null;
      if (
        previous &&
        !isEncryptedFieldDraftForScope(
          previous,
          input.organisationId,
          input.actorUserId,
        )
      )
        fail("conflict");
      if (previous && input.expectedVersion !== previous.version)
        fail("conflict");
      if (!previous && input.expectedVersion !== undefined) fail("conflict");
      if (
        !previous &&
        activeDrafts.length >= ENCRYPTED_FIELD_BOUNDS.draftsPerOrganisation
      )
        fail("capacity_exceeded");
      const timestamp = now.toISOString();
      const expiresAt =
        previous?.expiresAt ??
        new Date(
          now.getTime() +
            ENCRYPTED_FIELD_BOUNDS.draftTtlDays * 24 * 60 * 60 * 1_000,
        ).toISOString();
      const draft: EncryptedFieldDraft = {
        schema: SCHEMA,
        id,
        organisationId: input.organisationId,
        actorUserId: input.actorUserId,
        kind: input.kind,
        projectId: input.projectId,
        title: input.title,
        note: input.note,
        checklist: input.checklist,
        capturedAt: input.capturedAt,
        createdAt: previous?.createdAt ?? timestamp,
        updatedAt: timestamp,
        expiresAt,
        version: (previous?.version ?? 0) + 1,
        serverSubmitted: false,
        authoritative: false,
      };
      const encrypted = await encryptDraft(
        key,
        partition,
        input.actorUserId,
        draft,
      );
      const write = database.transaction(DRAFT_STORE, "readwrite");
      const writeDone = transactionDone(write);
      write.objectStore(DRAFT_STORE).put(encrypted);
      await writeDone;
      return draft;
    }),
  );
}

export async function deleteEncryptedFieldDraft(
  organisationId: string,
  actorUserId: string,
  id: string,
  expectedVersion: number,
): Promise<void> {
  if (
    !UUID.test(organisationId) ||
    !UUID.test(actorUserId) ||
    !UUID.test(id) ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 1
  )
    fail("invalid_input");
  await withExclusiveDeviceLock(() =>
    withDatabase(async (database) => {
      const key = await getOrCreateKey(database, actorUserId);
      const read = database.transaction(DRAFT_STORE, "readonly");
      const readDone = transactionDone(read);
      const stored = (await requestResult(
        read.objectStore(DRAFT_STORE).get(id),
      )) as StoredCiphertext | undefined;
      await readDone;
      const current = stored;
      if (!current) fail("conflict");
      const draft = await decryptDraft(key, current as StoredCiphertext);
      if (
        !isEncryptedFieldDraftForScope(draft, organisationId, actorUserId) ||
        draft.version !== expectedVersion
      )
        fail("conflict");
      const write = database.transaction(DRAFT_STORE, "readwrite");
      const writeDone = transactionDone(write);
      write.objectStore(DRAFT_STORE).delete(id);
      await writeDone;
    }),
  );
}

export async function wipeEncryptedFieldCompanion(
  actorUserId: string,
): Promise<void> {
  if (!UUID.test(actorUserId)) fail("invalid_input");
  await withExclusiveDeviceLock(() =>
    withDatabase(async (database) => {
      const transaction = database.transaction(
        [DRAFT_STORE, KEY_STORE],
        "readwrite",
      );
      const done = transactionDone(transaction);
      const actorId = actorKeyId(actorUserId);
      const cursorRequest = transaction
        .objectStore(DRAFT_STORE)
        .index(ACTOR_INDEX)
        .openCursor(IDBKeyRange.only(actorId));
      await new Promise<void>((resolve, reject) => {
        cursorRequest.onerror = () =>
          reject(new EncryptedFieldCompanionError("unavailable"));
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) {
            resolve();
            return;
          }
          cursor.delete();
          cursor.continue();
        };
      });
      transaction.objectStore(KEY_STORE).delete(actorId);
      await done;
    }),
  );
}
