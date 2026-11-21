// Numeric helpers with the semantics of the C# engine.

/**
 * Math.Round(double) of .NET: round to the nearest integer, ties to even (banker's rounding).
 * JavaScript's Math.round sends ties up, which differs for x.5 values.
 */
export function roundHalfEven(x: number): number {
  if (!Number.isFinite(x)) return x;
  const f = Math.floor(x);
  const d = x - f; // exact for every double
  let r: number;
  if (d > 0.5) r = f + 1;
  else if (d < 0.5) r = f;
  else r = f % 2 === 0 ? f : f + 1;
  // Math.Round keeps the sign of a negative value that rounds to zero
  return r === 0 && x < 0 ? -0 : r;
}

/** A C# (int) cast of a double: truncation toward zero, wrapped to 32 bits. */
export function toInt32(x: number): number {
  return Math.trunc(x) | 0;
}

/** C# integer division of two ints: truncation toward zero. */
export function intDiv(a: number, b: number): number {
  if (b === 0) throw new RangeError('Attempted to divide by zero.');
  return Math.trunc(a / b) | 0;
}

/** Convert.ToInt32(double): rounding to the nearest integer, ties to even. */
export function convertToInt32(x: number): number {
  return roundHalfEven(x) | 0;
}

/** Characters of a UTF-16 code unit array as a string (chunked, safe for long texts). */
export function codeUnitsToString(units: ArrayLike<number>, start: number, count: number): string {
  let result = '';
  const CHUNK = 8192;
  for (let i = 0; i < count; i += CHUNK) {
    const n = Math.min(CHUNK, count - i);
    const part = new Array<number>(n);
    for (let k = 0; k < n; k++) part[k] = units[start + i + k] as number;
    result += String.fromCharCode(...part);
  }
  return result;
}
