export type AccessInterval = Readonly<{
  startsAt: Date | null;
  expiresAt: Date | null;
}>;

/**
 * Returns the end of the uninterrupted interval containing `now` across a
 * union of access windows. `null` means access continues indefinitely;
 * `undefined` means no supplied interval is active now.
 */
export function continuousAccessExpiry(
  intervals: readonly AccessInterval[],
  now: Date,
): Date | null | undefined {
  const nowMs = now.getTime();
  const windows = intervals
    .map(({ startsAt, expiresAt }) => ({
      start: startsAt?.getTime() ?? Number.NEGATIVE_INFINITY,
      end: expiresAt?.getTime() ?? Number.POSITIVE_INFINITY,
    }))
    .filter(({ end }) => end > nowMs)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  let coverageEnd = Number.NEGATIVE_INFINITY;
  for (const window of windows) {
    if (window.start <= nowMs && window.end > nowMs) {
      coverageEnd = Math.max(coverageEnd, window.end);
    }
  }
  if (coverageEnd === Number.NEGATIVE_INFINITY) return undefined;
  if (coverageEnd === Number.POSITIVE_INFINITY) return null;

  for (const window of windows) {
    if (window.start > coverageEnd) break;
    coverageEnd = Math.max(coverageEnd, window.end);
    if (coverageEnd === Number.POSITIVE_INFINITY) return null;
  }

  return new Date(coverageEnd);
}
