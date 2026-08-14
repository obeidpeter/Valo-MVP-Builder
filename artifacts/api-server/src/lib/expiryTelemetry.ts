// ---------------------------------------------------------------------------
// Certificate expiry telemetry (FR-VLT-02)
// ---------------------------------------------------------------------------

/**
 * Expiry bands for vault artefacts, from most to least urgent. Thresholds
 * follow the TRD's alert ladder (T-3 / T-14 / T-30):
 *  - expired:  the expiry date has passed
 *  - critical: expires today or within 3 days
 *  - warning:  expires within 14 days
 *  - upcoming: expires within 30 days, or within the artefact's own
 *              renewal-lead window when that is longer (some certificates
 *              take months to renew)
 *  - ok:       comfortably in date
 *  - unknown:  no parseable expiry date on record
 */
export type ExpiryBand =
  | "expired"
  | "critical"
  | "warning"
  | "upcoming"
  | "ok"
  | "unknown";

export interface ExpiryTelemetry {
  band: ExpiryBand;
  /** Whole days until expiry (negative = days since expiry); null if unknown. */
  daysToExpiry: number | null;
}

/** Shared day length used by the expiry and retention day arithmetic. */
export const MS_PER_DAY = 86_400_000;

/** Truncate a timestamp to a whole UTC day index. */
const utcDay = (ms: number): number => Math.floor(ms / MS_PER_DAY);

/**
 * Deterministic expiry telemetry for a vault artefact. Pure: the reference
 * date is a parameter, so the same inputs always produce the same band.
 * Dates are compared on whole UTC days — an artefact expiring "today" is
 * critical, not expired.
 */
export function computeExpiry(
  expiryDate: string | null | undefined,
  today: Date | string,
  renewalLeadDays?: number | null,
): ExpiryTelemetry {
  const expiryMs = expiryDate ? Date.parse(expiryDate) : NaN;
  const todayMs =
    typeof today === "string" ? Date.parse(today) : today.getTime();
  if (Number.isNaN(expiryMs) || Number.isNaN(todayMs)) {
    return { band: "unknown", daysToExpiry: null };
  }

  const days = utcDay(expiryMs) - utcDay(todayMs);
  const upcomingWindow = Math.max(30, renewalLeadDays ?? 0);

  let band: ExpiryBand;
  if (days < 0) band = "expired";
  else if (days <= 3) band = "critical";
  else if (days <= 14) band = "warning";
  else if (days <= upcomingWindow) band = "upcoming";
  else band = "ok";

  return { band, daysToExpiry: days };
}
