export const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const ABSOLUTE_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/**
 * A deployment may lower the intake ceiling, but cannot raise it beyond the
 * public API contract without a reviewed code and OpenAPI change.
 */
export function getMaxUploadBytes(
  configured = process.env.VALO_MAX_UPLOAD_BYTES,
): number {
  if (!configured?.trim()) return DEFAULT_MAX_UPLOAD_BYTES;
  const parsed = Number(configured);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("VALO_MAX_UPLOAD_BYTES must be a positive integer");
  }
  return Math.min(parsed, ABSOLUTE_MAX_UPLOAD_BYTES);
}
