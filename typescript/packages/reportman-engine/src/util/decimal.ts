// System.Decimal: a 96-bit unsigned mantissa, a scale (number of decimal places, 0 to 28) and a
// sign, with the arithmetic of .NET's DecCalc (decimal.DecCalc.cs):
//
//  - add / subtract: exact at the larger scale; when the mantissa does not fit in 96 bits the
//    scale is reduced, rounding half to even. The sign of a zero result is the sign of the operand
//    with the smaller scale (1.0m - 1m is -0.0, as in .NET).
//  - multiply: exact at scale s1 + s2, then reduced to scale <= 28 and 96 bits, half to even.
//    A zero product of a mantissa wider than 32 bits is +0 with scale 0, and two 32-bit mantissas
//    with s1 + s2 > 47 give +0 (the ReturnZero paths of VarDecMul).
//  - divide: exact at the natural scale s1 - s2 when the remainder is zero; otherwise the quotient
//    takes as many decimal places as fit (scale <= 28, 96 bits), rounds half to even and drops its
//    trailing zeros (1.0m / 4m is 0.25, 1m / 3m is 0.3333333333333333333333333333).
//  - conversion from double rounds to 15 significant digits (VarDecFromR8) and conversion to
//    double is VarR8FromDec, not a correctly rounded conversion.
//
// bigint is used for the mantissa so every operation is exact before the .NET rounding step.

import { divideByZeroException, NetMessages, overflowException } from './netexception.js';

const MAX_SCALE = 28;
const TWO32 = 1n << 32n;
const TWO64 = 1n << 64n;
const TWO96 = 1n << 96n;
const MASK64 = TWO64 - 1n;

const POW10: bigint[] = [1n];
/** 10^n as a bigint (cached). */
export function pow10n(n: number): bigint {
  while (POW10.length <= n) POW10.push(POW10[POW10.length - 1]! * 10n);
  return POW10[n]!;
}

// s_doublePowers10 of DecCalc: the double literals 1e0 ... 1e80.
const DOUBLE_POWERS10: number[] = [];
for (let i = 0; i <= 80; i++) DOUBLE_POWERS10.push(Number('1e' + i));

/** n / d rounded half to even (n >= 0, d > 0). */
function divRoundHalfEven(n: bigint, d: bigint): bigint {
  const q = n / d;
  const twice = (n - q * d) * 2n;
  if (twice > d || (twice === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function overflow(): never {
  throw overflowException(NetMessages.overflowDecimal);
}

/**
 * The largest scale s <= min(scale, 28) at which the exact value mag / 10^scale fits in 96 bits
 * once rounded half to even (ScaleResult of DecCalc). Overflow when not even scale 0 fits.
 */
function fitToDecimal(mag: bigint, scale: number): { mag: bigint; scale: number } {
  if (scale <= MAX_SCALE && mag < TWO96) return { mag, scale };
  let s = Math.min(scale, MAX_SCALE);
  // Start from an estimate of the digits to drop so that the loop runs few times.
  const excessBits = mag.toString(2).length - 96;
  if (excessBits > 2) {
    // a lower bound of the digits to drop: mag >= 2^(95 + excessBits)
    const minDrop = Math.floor((excessBits - 2) * 0.301);
    if (scale - minDrop < s) s = scale - minDrop;
  }
  for (;;) {
    if (s < 0) overflow();
    const div = pow10n(scale - s);
    if (mag / div >= TWO96) {
      s--;
      continue;
    }
    const m = divRoundHalfEven(mag, div);
    if (m >= TWO96) {
      s--;
      continue;
    }
    return { mag: m, scale: s };
  }
}

export class CsDecimal {
  /** The magnitude of the mantissa, 0 <= mag < 2^96. */
  readonly mag: bigint;
  /** Decimal places, 0 to 28. */
  readonly scale: number;
  /** The sign bit (a decimal can be negative zero, which prints as 0). */
  readonly negative: boolean;

  private constructor(mag: bigint, scale: number, negative: boolean) {
    this.mag = mag;
    this.scale = scale;
    this.negative = negative;
  }

  static readonly zero = new CsDecimal(0n, 0, false);
  static readonly one = new CsDecimal(1n, 0, false);

  /** A decimal from its parts; throws when they are out of the decimal range. */
  static fromParts(mag: bigint, scale: number, negative: boolean): CsDecimal {
    if (mag < 0n) {
      mag = -mag;
      negative = !negative;
    }
    if (mag >= TWO96 || scale < 0 || scale > MAX_SCALE || !Number.isInteger(scale)) overflow();
    return new CsDecimal(mag, scale, negative);
  }

  /** (decimal) of an integer (int, long): scale 0. */
  static fromInteger(value: number | bigint): CsDecimal {
    const b = typeof value === 'bigint' ? value : BigInt(value);
    if (b < 0n) return CsDecimal.fromParts(-b, 0, true);
    return CsDecimal.fromParts(b, 0, false);
  }

  /** (decimal)double, Convert.ToDecimal(double): VarDecFromR8, 15 significant digits. */
  static fromDouble(input: number): CsDecimal {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, input);
    const biasedExp = (view.getUint32(0) >>> 20) & 0x7ff;
    const exp = biasedExp - 1022;
    if (exp < -94) return CsDecimal.zero;
    if (exp > 96) overflow();
    let negative = false;
    if (input < 0) {
      input = -input;
      negative = true;
    }
    let dbl = input;
    let power = 14 - ((exp * 19728) >> 16);
    if (power >= 0) {
      if (power > MAX_SCALE) power = MAX_SCALE;
      dbl *= DOUBLE_POWERS10[power]!;
    } else {
      if (power !== -1 || dbl >= 1e15) dbl /= DOUBLE_POWERS10[-power]!;
      else power = 0;
    }
    if (dbl < 1e14 && power < MAX_SCALE) {
      dbl *= 10;
      power++;
    }
    // Math.Round: half to even
    let r = Math.round(dbl);
    if (r - dbl === 0.5 && r % 2 !== 0) r -= 1;
    let mant = BigInt(r);
    if (mant === 0n) return CsDecimal.zero;
    if (power < 0) {
      return new CsDecimal(mant * pow10n(-power), 0, negative);
    }
    let lmax = power > 14 ? 14 : power;
    if ((mant & 0xffn) === 0n && lmax >= 8) {
      if (mant % 100000000n === 0n) {
        mant /= 100000000n;
        power -= 8;
        lmax -= 8;
      }
    }
    if ((mant & 0xfn) === 0n && lmax >= 4) {
      if (mant % 10000n === 0n) {
        mant /= 10000n;
        power -= 4;
        lmax -= 4;
      }
    }
    if ((mant & 3n) === 0n && lmax >= 2) {
      if (mant % 100n === 0n) {
        mant /= 100n;
        power -= 2;
        lmax -= 2;
      }
    }
    if ((mant & 1n) === 0n && lmax >= 1) {
      if (mant % 10n === 0n) {
        mant /= 10n;
        power--;
      }
    }
    return new CsDecimal(mant, power, negative);
  }

  /** (double)decimal: VarR8FromDec. */
  toDouble(): number {
    const low64 = this.mag & MASK64;
    const high = this.mag >> 64n;
    let dbl = (Number(low64) + Number(high) * 18446744073709551616) / DOUBLE_POWERS10[this.scale]!;
    if (this.negative) dbl = -dbl;
    return dbl;
  }

  get isZero(): boolean {
    return this.mag === 0n;
  }

  /** decimal.Negate (flips the sign, also of zero). */
  negate(): CsDecimal {
    return new CsDecimal(this.mag, this.scale, !this.negative);
  }

  /** Math.Abs(decimal). */
  abs(): CsDecimal {
    return this.negative ? new CsDecimal(this.mag, this.scale, false) : this;
  }

  /** The exact value as numerator / 10^scale with sign: used to compare. */
  private signedMantissaAt(scale: number): bigint {
    const m = this.mag * pow10n(scale - this.scale);
    return this.negative ? -m : m;
  }

  /** decimal.CompareTo: -1, 0 or 1 (zero and negative zero are equal). */
  compareTo(other: CsDecimal): number {
    const s = Math.max(this.scale, other.scale);
    const a = this.signedMantissaAt(s);
    const b = other.signedMantissaAt(s);
    return a < b ? -1 : a > b ? 1 : 0;
  }

  equals(other: CsDecimal): boolean {
    return this.compareTo(other) === 0;
  }

  add(other: CsDecimal): CsDecimal {
    return CsDecimal.addSub(this, other, false);
  }

  sub(other: CsDecimal): CsDecimal {
    return CsDecimal.addSub(this, other, true);
  }

  private static addSub(a: CsDecimal, b: CsDecimal, subtract: boolean): CsDecimal {
    const bNegative = subtract ? !b.negative : b.negative;
    const scale = Math.max(a.scale, b.scale);
    const am = a.mag * pow10n(scale - a.scale);
    const bm = b.mag * pow10n(scale - b.scale);
    // The operand with the smaller scale is the base of DecAddSub: its sign is the starting sign.
    const swapped = b.scale < a.scale;
    if (a.scale !== b.scale && (swapped ? b.mag : a.mag) === 0n) {
      // "Left arg is zero, return right": the other operand as it is (0 - x is -x, x + 0 is x).
      return swapped ? a : new CsDecimal(b.mag, b.scale, bNegative);
    }
    let negative = swapped ? bNegative : a.negative;
    let mag: bigint;
    if (a.negative === bNegative) {
      mag = am + bm;
    } else {
      const base = swapped ? bm : am;
      const other = swapped ? am : bm;
      mag = base - other;
      if (mag < 0n) {
        mag = -mag;
        negative = !negative;
      }
    }
    const fit = fitToDecimal(mag, scale);
    return new CsDecimal(fit.mag, fit.scale, negative);
  }

  mul(other: CsDecimal): CsDecimal {
    const negative = this.negative !== other.negative;
    const scale = this.scale + other.scale;
    const product = this.mag * other.mag;
    if (this.mag < TWO32 && other.mag < TWO32) {
      if (scale > MAX_SCALE) {
        if (scale > MAX_SCALE + 19) return CsDecimal.zero;
        const p = divRoundHalfEven(product, pow10n(scale - MAX_SCALE));
        return new CsDecimal(p, MAX_SCALE, negative);
      }
      return new CsDecimal(product, scale, negative);
    }
    if (product === 0n) return CsDecimal.zero;
    const fit = fitToDecimal(product, scale);
    return new CsDecimal(fit.mag, fit.scale, negative);
  }

  div(other: CsDecimal): CsDecimal {
    if (other.mag === 0n) throw divideByZeroException();
    const negative = this.negative !== other.negative;
    const natural = this.scale - other.scale;
    const num = this.mag;
    const den = other.mag;
    const q0 = num / den;
    if (q0 * den === num) {
      if (natural >= 0) return new CsDecimal(q0, natural, negative);
      const m = q0 * pow10n(-natural);
      if (m >= TWO96) overflow();
      return new CsDecimal(m, 0, negative);
    }
    // Inexact at the natural scale: as many decimal places as fit, then the trailing zeros go.
    // value = num / den * 10^-natural; at scale s the mantissa is num * 10^(s - natural) / den.
    const atScale = (s: number): { n: bigint; d: bigint } =>
      s >= natural ? { n: num * pow10n(s - natural), d: den } : { n: num, d: den * pow10n(natural - s) };
    let s = MAX_SCALE;
    while (s >= 0) {
      const { n, d } = atScale(s);
      if (n / d < TWO96) break;
      s--;
    }
    if (s < 0) overflow();
    let mag: bigint;
    // The remainder may become zero before the maximum scale: the quotient is then exact.
    for (;;) {
      const { n, d } = atScale(s);
      mag = divRoundHalfEven(n, d);
      if (mag >= TWO96) {
        s--;
        if (s < 0) overflow();
        continue;
      }
      break;
    }
    while (s > 0 && mag % 10n === 0n) {
      mag /= 10n;
      s--;
    }
    return new CsDecimal(mag, s, negative);
  }

  /** decimal.Truncate / Math.Truncate(decimal): scale 0, sign kept. */
  truncate(): CsDecimal {
    if (this.scale === 0) return this;
    return new CsDecimal(this.mag / pow10n(this.scale), 0, this.negative);
  }

  /** Math.Round(decimal) / decimal.Round(d, 0): half to even, scale 0, sign kept. */
  round(): CsDecimal {
    if (this.scale === 0) return this;
    return new CsDecimal(divRoundHalfEven(this.mag, pow10n(this.scale)), 0, this.negative);
  }

  /** decimal.ToInt64 (truncates; OverflowException out of range). */
  toInt64(): bigint {
    const t = this.mag / pow10n(this.scale);
    const v = this.negative ? -t : t;
    if (v > 9223372036854775807n || v < -9223372036854775808n) throw overflowException(NetMessages.overflowInt64);
    return v;
  }

  /** decimal.ToInt32 (truncates; OverflowException out of range). */
  toInt32(): number {
    const t = this.mag / pow10n(this.scale);
    const v = this.negative ? -t : t;
    if (v > 2147483647n || v < -2147483648n) throw overflowException(NetMessages.overflowInt32);
    return Number(v);
  }

  /** The decimal digits of the mantissa ("" for zero) and the decimal point position. */
  digits(): { digits: string; pointPos: number } {
    const d = this.mag === 0n ? '' : this.mag.toString();
    return { digits: d, pointPos: d.length - this.scale };
  }

  /** Invariant text with the scale ("1.50", "-0.001", "0.00"): the "G" format of InvariantCulture. */
  toInvariantString(): string {
    let s = this.mag.toString();
    if (this.scale > 0) {
      s = s.padStart(this.scale + 1, '0');
      s = s.slice(0, s.length - this.scale) + '.' + s.slice(s.length - this.scale);
    }
    return this.negative && this.mag !== 0n ? '-' + s : s;
  }

  /** Reads the invariant text of toInvariantString (digits, optional '-', optional '.'). */
  static parseInvariant(text: string): CsDecimal {
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
    if (m === null) throw new Error(`Not an invariant decimal: '${text}'`);
    const frac = m[3] ?? '';
    return CsDecimal.fromParts(BigInt(m[2]! + frac), frac.length, m[1] === '-');
  }
}
