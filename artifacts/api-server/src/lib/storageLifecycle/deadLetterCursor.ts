const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
export const STORAGE_DEAD_LETTER_CURSOR_MAX_LENGTH = 192;

export interface StorageDeadLetterCursor {
  terminalAt: Date;
  id: string;
}

export class StorageDeadLetterCursorError extends Error {
  constructor() {
    super("invalid storage dead-letter cursor");
    this.name = "StorageDeadLetterCursorError";
  }
}

export function encodeStorageDeadLetterCursor(
  cursor: StorageDeadLetterCursor,
): string {
  if (!Number.isFinite(cursor.terminalAt.valueOf()) || !UUID.test(cursor.id)) {
    throw new StorageDeadLetterCursorError();
  }
  const encoded = Buffer.from(
    JSON.stringify({
      terminalAt: cursor.terminalAt.toISOString(),
      id: cursor.id,
    }),
    "utf8",
  ).toString("base64url");
  if (encoded.length > STORAGE_DEAD_LETTER_CURSOR_MAX_LENGTH) {
    throw new StorageDeadLetterCursorError();
  }
  return encoded;
}

export function decodeStorageDeadLetterCursor(
  value: unknown,
): StorageDeadLetterCursor {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > STORAGE_DEAD_LETTER_CURSOR_MAX_LENGTH ||
    !BASE64URL.test(value)
  ) {
    throw new StorageDeadLetterCursorError();
  }
  let decoded: string;
  try {
    const bytes = Buffer.from(value, "base64url");
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (bytes.toString("base64url") !== value) {
      throw new StorageDeadLetterCursorError();
    }
  } catch {
    throw new StorageDeadLetterCursorError();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new StorageDeadLetterCursorError();
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(parsed).sort().join(",") !== "id,terminalAt" ||
    !("id" in parsed) ||
    !("terminalAt" in parsed) ||
    typeof parsed.id !== "string" ||
    typeof parsed.terminalAt !== "string" ||
    !UUID.test(parsed.id)
  ) {
    throw new StorageDeadLetterCursorError();
  }
  const terminalAt = new Date(parsed.terminalAt);
  if (
    !Number.isFinite(terminalAt.valueOf()) ||
    terminalAt.toISOString() !== parsed.terminalAt
  ) {
    throw new StorageDeadLetterCursorError();
  }
  return { terminalAt, id: parsed.id };
}
