// The few System.Decimal operations PrintOutText computes with: the number of lines of a page
// (twips to inches times the lines per inch) and the n/216 line spacing. They are decimal and not
// double in C#, and the difference shows exactly where it matters, at the halves: 16200 twips at
// 6 lpi is 67.5 lines, exact in decimal (68 lines with the banker's rounding of Math.Round), while
// 1.0m / 9.6m * 216 is 22.500000000000000000000000007 and rounds to 23, not to the even 22.

/** A decimal: mantissa (96 bits at most) and scale (0 to 28 decimal places). */
export interface Dec {
  m: bigint;
  s: number;
}

const MAX_MANTISSA = (1n << 96n) - 1n;
const MAX_SCALE = 28;

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

/** An integer as a decimal. */
export function dec(n: number): Dec {
  return { m: BigInt(n), s: 0 };
}

/** a / b rounded half to even, for non-negative operands. */
function roundDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r2 = (a % b) * 2n;
  return r2 > b || (r2 === b && (q & 1n) === 1n) ? q + 1n : q;
}

/**
 * Decimal division (VarDecDiv): the quotient with as many decimal places as fit in the 96 bit
 * mantissa (28 at most), or fewer when it is exact, rounded half to even.
 */
export function decDivide(a: Dec, b: Dec): Dec {
  if (b.m === 0n) throw new RangeError('Attempted to divide by zero.');
  const negative = a.m < 0n !== b.m < 0n;
  let num = a.m < 0n ? -a.m : a.m;
  const den = b.m < 0n ? -b.m : b.m;
  let scale = a.s - b.s;
  if (scale < 0) {
    num *= pow10(-scale);
    scale = 0;
  }
  let q = num / den;
  let r = num % den;
  if (q > MAX_MANTISSA) throw new RangeError('Value was either too large or too small for a Decimal.');
  while (r !== 0n && scale < MAX_SCALE) {
    const q2 = q * 10n + (r * 10n) / den;
    if (q2 > MAX_MANTISSA) break;
    q = q2;
    r = (r * 10n) % den;
    scale++;
  }
  const r2 = r * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) q++;
  if (q > MAX_MANTISSA) {
    q = roundDiv(q, 10n);
    scale--;
  }
  return { m: negative ? -q : q, s: scale };
}

/**
 * Decimal multiplication (VarDecMul): the exact product, with the decimal places that do not fit
 * in 96 bits (or past 28) dropped in one rounding, half to even.
 */
export function decMultiply(a: Dec, b: Dec): Dec {
  let m = a.m * b.m;
  const negative = m < 0n;
  if (negative) m = -m;
  let s = a.s + b.s;
  let drop = Math.max(0, s - MAX_SCALE);
  while (drop <= s && (drop > 0 ? roundDiv(m, pow10(drop)) : m) > MAX_MANTISSA) drop++;
  if (drop > s) throw new RangeError('Value was either too large or too small for a Decimal.');
  if (drop > 0) {
    m = roundDiv(m, pow10(drop));
    s -= drop;
  }
  return { m: negative ? -m : m, s };
}

/** Math.Round(decimal): the nearest integer, ties to even. */
export function decRound(a: Dec): bigint {
  const negative = a.m < 0n;
  const r = roundDiv(negative ? -a.m : a.m, pow10(a.s));
  return negative ? -r : r;
}

/** (int)decimal and (byte)decimal: checked, an integer out of the range throws as in .NET. */
export function decToInteger(value: bigint, min: number, max: number, typeName: string): number {
  if (value < BigInt(min) || value > BigInt(max))
    throw new RangeError('Value was either too large or too small for ' + typeName + '.');
  return Number(value);
}
