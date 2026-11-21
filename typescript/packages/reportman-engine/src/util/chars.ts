// Character classification and string helpers with the semantics of .NET (System.Char and
// System.String), which the expression parser and the built-in functions rely on.

import { argumentException, argumentOutOfRangeException, NetException } from './netexception.js';

const WHITE_SPACE = /[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/;
const LETTER = /\p{L}/u;
const DIGIT = /\p{Nd}/u;

/** Char.IsWhiteSpace for one UTF-16 code unit. */
export function isWhiteSpace(c: string): boolean {
  return c.length === 1 && WHITE_SPACE.test(c);
}

/** Char.IsLetter for one UTF-16 code unit (a lone surrogate is not a letter). */
export function isLetter(c: string): boolean {
  return c.length === 1 && LETTER.test(c);
}

/** Char.IsDigit (Unicode decimal digit, category Nd) for one UTF-16 code unit. */
export function isDigit(c: string): boolean {
  return c.length === 1 && DIGIT.test(c);
}

/** Char.IsLetterOrDigit for one UTF-16 code unit. */
export function isLetterOrDigit(c: string): boolean {
  return isLetter(c) || isDigit(c);
}

/** char.IsAsciiDigit. */
export function isAsciiDigit(c: string): boolean {
  return c.length === 1 && c >= '0' && c <= '9';
}

// Simple (1:1) uppercase mappings that differ from both the character itself and its full
// mapping: the Greek letters with ypogegrammeni map to their titlecase forms.
function simpleUpperException(cp: number): number | undefined {
  if ((cp >= 0x1f80 && cp <= 0x1f87) || (cp >= 0x1f90 && cp <= 0x1f97) || (cp >= 0x1fa0 && cp <= 0x1fa7)) return cp + 8;
  if (cp === 0x1fb3) return 0x1fbc;
  if (cp === 0x1fc3) return 0x1fcc;
  if (cp === 0x1ff3) return 0x1ffc;
  return undefined;
}

/**
 * String.ToUpper of the cultures the engine runs with: the simple (one to one) Unicode case
 * mapping of each code point, so "\u00df" stays "\u00df" (JavaScript's toUpperCase gives "SS").
 */
export function toUpperNet(s: string): string {
  let r = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    const ex = simpleUpperException(cp);
    if (ex !== undefined) {
      r += String.fromCodePoint(ex);
      continue;
    }
    const u = ch.toUpperCase();
    r += singleCodePoint(u) ? u : ch;
  }
  return r;
}

function singleCodePoint(s: string): boolean {
  const cp = s.codePointAt(0);
  return cp !== undefined && s.length === (cp > 0xffff ? 2 : 1);
}

/** String.ToLower with the simple case mapping ("\u0130" is "i", not "i\u0307"). */
export function toLowerNet(s: string): string {
  let r = '';
  for (const ch of s) {
    if (ch === '\u0130') {
      r += 'i';
      continue;
    }
    const l = ch.toLowerCase();
    r += singleCodePoint(l) ? l : ch;
  }
  return r;
}

/** Char.ToUpper of one code unit. */
export function charToUpperNet(c: string): string {
  return toUpperNet(c);
}

/** String.Trim(): removes the Char.IsWhiteSpace characters of both ends. */
export function trimNet(s: string): string {
  let start = 0;
  let end = s.length - 1;
  while (start <= end && isWhiteSpace(s[start]!)) start++;
  while (end >= start && isWhiteSpace(s[end]!)) end--;
  return s.substring(start, end + 1);
}

/** String.Substring(startIndex, length) with the .NET argument checks and messages. */
export function substringNet(s: string, startIndex: number, length: number): string {
  if (startIndex < 0) {
    throw argumentOutOfRangeException(
      `startIndex ('${startIndex}') must be a non-negative value. (Parameter 'startIndex')\r\nActual value was ${startIndex}.`,
    );
  }
  if (startIndex > s.length) {
    throw argumentOutOfRangeException("startIndex cannot be larger than length of string. (Parameter 'startIndex')");
  }
  if (length < 0) {
    throw argumentOutOfRangeException(
      `length ('${length}') must be a non-negative value. (Parameter 'length')\r\nActual value was ${length}.`,
    );
  }
  if (startIndex > s.length - length) {
    throw argumentOutOfRangeException("Index and length must refer to a location within the string. (Parameter 'length')");
  }
  return s.substring(startIndex, startIndex + length);
}

/** String.Replace(oldValue, newValue): ordinal, every occurrence; an empty oldValue throws. */
export function replaceNet(s: string, oldValue: string, newValue: string): string {
  if (oldValue.length === 0) throw argumentException("The value cannot be an empty string. (Parameter 'oldValue')");
  return s.split(oldValue).join(newValue);
}

// Code points the ICU root collation ignores completely: controls other than the white space
// controls, the soft hyphen and the zero width / bidi formatting characters.
const IGNORABLE = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/;
// Code points that extend the previous grapheme: a match can neither start nor end before them.
const EXTEND = /[\p{M}\u200c\u200d]/u;

function isIgnorable(c: string): boolean {
  return IGNORABLE.test(c);
}

function isBoundary(s: string, i: number): boolean {
  if (i <= 0 || i >= s.length) return true;
  const prev = s.charCodeAt(i - 1);
  const cur = s.charCodeAt(i);
  // (CR LF is no unit: the C# engine finds "\n" inside "\r\n", as Delphi's Pos)
  if (prev >= 0xd800 && prev <= 0xdbff && cur >= 0xdc00 && cur <= 0xdfff) return false;
  return !EXTEND.test(String.fromCodePoint(s.codePointAt(i)!));
}

/**
 * String.IndexOf(string) with the current culture, as .NET 5+ does it with ICU: a match starts and
 * ends on a grapheme boundary (so "e" is not found inside "e" + U+0301; "\n" is found inside "\r\n"),
 * and the characters the collation ignores (NUL and other controls, the soft hyphen, zero width
 * characters) are skipped, so an ignorable-only value is found at 0. Case and accents count.
 * Canonical equivalence (a precomposed "\u00e9" against "e" + U+0301) is not applied.
 */
export function indexOfCulture(source: string, value: string): number {
  let pattern = '';
  for (const c of value) if (!isIgnorable(c)) pattern += c;
  if (pattern.length === 0) return 0;
  for (let i = 0; i < source.length; i++) {
    if (isIgnorable(source[i]!) || !isBoundary(source, i)) continue;
    let j = i;
    let k = 0;
    while (k < pattern.length && j < source.length) {
      const c = source[j]!;
      if (k > 0 && isIgnorable(c)) {
        j++;
        continue;
      }
      if (c !== pattern[k]) break;
      j++;
      k++;
    }
    if (k === pattern.length && isBoundary(source, j)) return i;
  }
  return -1;
}

/** Throws the ArgumentNullException of a null string argument. */
export function argumentNull(paramName: string): NetException {
  return new NetException('ArgumentNullException', `Value cannot be null. (Parameter '${paramName}')`);
}

const collators = new Map<string, Intl.Collator>();

/**
 * String.CompareTo / string.Compare with the current culture: the ICU collation of the culture
 * (tertiary strength: case and accents count after the letters), as .NET 5+ compares with ICU.
 * The invariant culture ("") uses the root collation.
 */
export function compareCulture(a: string, b: string, cultureName: string): number {
  if (a === b) return 0;
  let c = collators.get(cultureName);
  if (c === undefined) {
    c = collatorFor(cultureName, { usage: 'sort', sensitivity: 'variant' });
    collators.set(cultureName, c);
  }
  const r = c.compare(a, b);
  return r < 0 ? -1 : r > 0 ? 1 : 0;
}

/** An ICU collator for a culture name ("" or an unknown tag: the root collation). */
export function collatorFor(cultureName: string, options: Intl.CollatorOptions): Intl.Collator {
  try {
    return new Intl.Collator(cultureName === '' ? 'und' : cultureName, options);
  } catch {
    return new Intl.Collator('und', options);
  }
}
