// The .NET behaviour the barcode encoders of the C# engine rely on: checked array and string
// indexing (IndexOutOfRangeException), the (int) cast of a double, Int32 wrap-around and the
// System.Drawing.Point arithmetic of the rotations.

import { NetException } from '../../util/netexception.js';
import { convertDoubleToInt32, roundHalfEvenDouble } from '../../util/numberparse.js';

/** IndexOutOfRangeException, as an array or a string indexer raises it. */
export function indexOutOfRange(): NetException {
  return new NetException('IndexOutOfRangeException', 'Index was outside the bounds of the array.');
}

/** int[] read with the .NET bounds check. */
export function geti(array: readonly number[] | Int32Array, index: number): number {
  if (index < 0 || index >= array.length) throw indexOutOfRange();
  return array[index]!;
}

/** int[] write with the .NET bounds check. */
export function seti(array: number[] | Int32Array, index: number, value: number): void {
  if (index < 0 || index >= array.length) throw indexOutOfRange();
  array[index] = value;
}

/** string[index] (a UTF-16 code unit) with the .NET bounds check. */
export function charAt(s: string, index: number): number {
  if (index < 0 || index >= s.length) throw indexOutOfRange();
  return s.charCodeAt(index);
}

/** An Int32 result (unchecked C# arithmetic wraps around). */
export function i32(value: number): number {
  return value | 0;
}

/** C# integer division of two Int32 (truncated toward zero). */
export function idiv(a: number, b: number): number {
  if (b === 0) throw new NetException('DivideByZeroException', 'Attempted to divide by zero.');
  return Math.trunc(a / b) | 0;
}

/** C# integer remainder of two Int32 (the sign of the dividend). */
export function imod(a: number, b: number): number {
  if (b === 0) throw new NetException('DivideByZeroException', 'Attempted to divide by zero.');
  return a % b | 0;
}

/** The (int) cast of a double: truncated, saturated out of range and 0 for NaN (.NET 9 and later). */
export function castInt32(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value >= 2147483647) return 2147483647;
  if (value <= -2147483648) return -2147483648;
  return Math.trunc(value) | 0;
}

/** Math.Round(double), half to even. */
export const mathRound = roundHalfEvenDouble;

/** Convert.ToInt32(double): half to even, OverflowException out of range. */
export const convertToInt32 = convertDoubleToInt32;

/** Convert.ToInt16(double): Convert.ToInt32 (half to even), then the Int16 range check. */
export function convertToInt16(value: number): number {
  const v = convertDoubleToInt32(value);
  if (v < -32768 || v > 32767) throw new NetException('OverflowException', 'Value was either too large or too small for an Int16.');
  return v;
}

/** A System.Drawing.Point (a struct: copied on assignment). */
export interface IntPoint {
  x: number;
  y: number;
}
