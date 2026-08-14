/**
 * Shared parsers for authoritative database clock reads. The
 * `SELECT pg_catalog.clock_timestamp() AS now` SQL deliberately stays inline
 * in each consuming module (static tests pin the SQL text there); only the
 * row-value parsing is shared.
 *
 * Two deliberate families that must NOT be merged:
 *  - `parseInstantPreserving` keeps a driver-provided `Date` instance intact
 *    (full sub-second precision);
 *  - `parseInstantViaString` round-trips through `String()`, which silently
 *    drops sub-second precision for `Date` inputs. Its call sites rely on
 *    today's behaviour; unifying on the preserving family would be a
 *    behaviour change, not a refactor.
 *
 * Both return `null` when the value cannot be parsed; each call site maps
 * `null` onto its module's own error type.
 */
export function parseInstantPreserving(value: unknown): Date | null {
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function parseInstantViaString(value: unknown): Date | null {
  const parsed = new Date(String(value ?? ""));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}
