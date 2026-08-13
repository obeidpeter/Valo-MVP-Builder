/**
 * Parse an environment-supplied positive integer with a fallback. The name is
 * only used in the thrown message, so call sites keep their exact wording.
 */
export function positiveInteger(
  name: string,
  raw: string | undefined,
  fallback: number,
): number {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
