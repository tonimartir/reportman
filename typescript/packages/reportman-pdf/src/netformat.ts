// The .NET number formatting the PDF writer uses, without the culture (the C# engine replaces the
// decimal separator of the culture with a dot, and the formats have no group separators).

/**
 * double.ToString("##0.00") (and "0.00") of .NET Core, with a dot: the value is first written
 * with 15 significant digits, correctly rounded, then those digits are rounded half up to two
 * decimals (a custom format string; this "double rounding" is the .NET behaviour). A negative
 * value keeps its sign even when it rounds to zero, negative zero included ("-0.00").
 */
export function formatFixed2(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return '∞';
  if (value === -Infinity) return '-∞';
  const negative = value < 0 || Object.is(value, -0);
  const abs = Math.abs(value);
  let digits: number[] = [];
  let scale = 0; // abs = 0.d0 d1 d2 ... x 10^scale
  if (abs !== 0) {
    const p = abs.toPrecision(15);
    const e = p.indexOf('e');
    if (e >= 0) {
      const mant = p.slice(0, e).replace('.', '');
      digits = Array.from(mant, (c) => c.charCodeAt(0) - 48);
      scale = parseInt(p.slice(e + 1), 10) + 1;
    } else {
      const dot = p.indexOf('.');
      const intPart = dot >= 0 ? p.slice(0, dot) : p;
      const all = intPart + (dot >= 0 ? p.slice(dot + 1) : '');
      let lead = 0;
      while (lead < all.length && all.charAt(lead) === '0') lead++;
      digits = Array.from(all.slice(lead), (c) => c.charCodeAt(0) - 48);
      scale = intPart.length - lead;
    }
    // Round half up to two decimals
    const keep = scale + 2;
    if (keep < 0) digits = [];
    else if (keep < digits.length) {
      const roundUp = (digits[keep] as number) >= 5;
      digits = digits.slice(0, keep);
      if (roundUp) {
        let i = keep - 1;
        while (i >= 0 && digits[i] === 9) {
          digits[i] = 0;
          i--;
        }
        if (i < 0) {
          digits.unshift(1);
          scale += 1;
        } else digits[i] = (digits[i] as number) + 1;
      }
    }
  }
  const dig = (k: number): number => (k >= 0 && k < digits.length ? (digits[k] as number) : 0);
  let intStr = '';
  for (let k = 0; k < scale; k++) intStr += String(dig(k));
  if (intStr === '') intStr = '0';
  return (negative ? '-' : '') + intStr + '.' + String(dig(scale)) + String(dig(scale + 1));
}

/** int.ToString("X"): upper case hexadecimal, negative numbers as their 32 bit two's complement. */
export function intToHexX(value: number): string {
  return (value >>> 0).toString(16).toUpperCase();
}

/** PDFCanvas.IntToHex: hexadecimal padded with zeros to four digits. */
export function intToHex(value: number): string {
  return intToHexX(value).padStart(4, '0');
}

/** byte.ToString("X2"). */
export function byteToHex2(b: number): string {
  return (b & 0xff).toString(16).toUpperCase().padStart(2, '0');
}
