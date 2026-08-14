/**
 * Shared BigInt scaled-decimal money kernel (FR-BOQ-01): no binary floating
 * point in money paths. Amounts are held as all significant digits in a
 * BigInt plus a decimal scale, and every division rounds half away from
 * zero. `boqArithmetic.ts` (JSON-number BOQ checks) and `boqVerifier.ts`
 * (string-decimal commercial verification) both delegate here through thin
 * wrappers with their historical signatures.
 */

export interface Decimal {
  /** All significant digits as an integer (sign included). */
  digits: bigint;
  /** Number of decimal places `digits` is scaled by. */
  scale: number;
}

const DECIMAL_STRING = /^(-?)(\d+)(?:\.(\d+))?$/;

const NUMBER_DECIMAL = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/** Parse a plain decimal string ("12.50"); no exponent form. */
export function parseDecimalString(value: string): Decimal | null {
  const match = DECIMAL_STRING.exec(value.trim());
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  const digits = BigInt(`${whole}${fraction}`);
  return { digits: sign === "-" ? -digits : digits, scale: fraction.length };
}

/** Parse a finite JS number's decimal string form exactly. */
export function parseNumberDecimal(value: number): Decimal | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const m = NUMBER_DECIMAL.exec(String(value));
  if (!m) return null;
  const [, sign, intPart, fracPart = "", expPart] = m;
  let digits = BigInt(intPart + fracPart);
  let scale = fracPart.length;
  const exp = expPart ? Number(expPart) : 0;
  if (exp > 0) {
    if (exp >= scale) {
      digits *= 10n ** BigInt(exp - scale);
      scale = 0;
    } else {
      scale -= exp;
    }
  } else if (exp < 0) {
    scale += -exp;
  }
  return { digits: sign === "-" ? -digits : digits, scale };
}

/** Integer division rounding half away from zero. */
export function divideRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("A positive denominator is required");
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n >= denominator) return quotient + 1n;
  if (remainder * 2n <= -denominator) return quotient - 1n;
  return quotient;
}

/**
 * Rescale to `scale` decimal places, rounding half away from zero via
 * `divideRound`. The pre-consolidation copies phrased the rounding test two
 * ways — `remainder * 2n >= denominator` here versus comparing against
 * `half = divisor / 2n` — which agree because every divisor is `10n ** k`
 * with `k >= 1`, i.e. always even, so the halved divisor is exact.
 */
export function rescale(value: Decimal, scale: number): bigint {
  if (value.scale === scale) return value.digits;
  if (value.scale < scale)
    return value.digits * 10n ** BigInt(scale - value.scale);
  return divideRound(value.digits, 10n ** BigInt(value.scale - scale));
}

export const absBig = (value: bigint): bigint => (value < 0n ? -value : value);
