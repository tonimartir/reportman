// DECFLOAT(16) and DECFLOAT(34) as FirebirdClient reads them (DecimalCodec, DenselyPackedDecimalCodec):
// IEEE 754 decimal64 and decimal128 in the densely packed decimal encoding, big endian on the wire,
// decoded to an FbDecFloat (sign, coefficient, exponent), and the text FbDecFloat.ToString gives,
// which is what the C# engine prints for such a column ("12345E-2", "-0", "inf", "nan"...).
//
// node-firebird decodes these values as binary integer decimals (BID), which is not the encoding
// Firebird uses, so the driver reads the raw bytes and decodes them here.

export interface DecFloat {
  readonly kind: 'finite' | 'infinity' | 'nan' | 'snan';
  readonly negative: boolean;
  /** The signed coefficient (zero for the special values). */
  readonly coefficient: bigint;
  readonly exponent: number;
}

interface Format {
  readonly byteLength: number;
  readonly coefficientDigits: number;
  readonly coefficientContinuationBits: number;
  readonly exponentContinuationBits: number;
  readonly exponentBias: number;
}

function format(bits: number, digits: number): Format {
  const coefficientContinuationBits = (10 * (digits - 1)) / 3;
  const exponentContinuationBits = bits - 1 - 5 - coefficientContinuationBits;
  const eLimit = 3 * (1 << exponentContinuationBits) - 1;
  const eMin = -Math.trunc(eLimit / 2);
  return {
    byteLength: bits / 8,
    coefficientDigits: digits,
    coefficientContinuationBits,
    exponentContinuationBits,
    exponentBias: -eMin + digits - 1,
  };
}

const DEC16 = format(64, 16);
const DEC34 = format(128, 34);

/** The three digits of a 10 bit densely packed decimal group (IEEE 754-2008, 3.5.2). */
function dpdDigits(g: number): number {
  const b = (i: number): number => (g >> i) & 1;
  if (b(3) === 0) return ((g >> 7) & 7) * 100 + ((g >> 4) & 7) * 10 + (g & 7);
  const b96 = (b(9) << 1) | b(8);
  switch ((g >> 1) & 3) {
    case 0:
      return ((g >> 7) & 7) * 100 + ((g >> 4) & 7) * 10 + (8 + b(0));
    case 1:
      return ((g >> 7) & 7) * 100 + (8 + b(4)) * 10 + ((b(6) << 2) | (b(5) << 1) | b(0));
    case 2:
      return (8 + b(7)) * 100 + ((g >> 4) & 7) * 10 + ((b96 << 1) | b(0));
    default:
      switch ((g >> 5) & 3) {
        case 0:
          return (8 + b(7)) * 100 + (8 + b(4)) * 10 + ((b96 << 1) | b(0));
        case 1:
          return (8 + b(7)) * 100 + ((b96 << 1) | b(4)) * 10 + (8 + b(0));
        case 2:
          return ((g >> 7) & 7) * 100 + (8 + b(4)) * 10 + (8 + b(0));
        default:
          return (8 + b(7)) * 100 + (8 + b(4)) * 10 + (8 + b(0));
      }
  }
}

function parse(bytes: Uint8Array, f: Format): DecFloat {
  if (bytes.length !== f.byteLength) throw new Error('A DECFLOAT value must be ' + String(f.byteLength) + ' bytes.');
  const first = bytes[0]!;
  const negative = first >> 7 === 1;
  switch (first & 0b0_11111_10) {
    case 0b0_11110_00:
    case 0b0_11110_10:
      return { kind: 'infinity', negative, coefficient: 0n, exponent: 0 };
    case 0b0_11111_00:
      return { kind: 'nan', negative, coefficient: 0n, exponent: 0 };
    case 0b0_11111_10:
      return { kind: 'snan', negative, coefficient: 0n, exponent: 0 };
  }
  let exponentMsb: number;
  let firstDigit: number;
  if ((first & 0b0_11000_00) !== 0b0_11000_00) {
    exponentMsb = ((first >>> 3) & 0b01100) | (first & 0b011);
    firstDigit = (first >>> 2) & 0b0111;
  } else {
    exponentMsb = ((first >>> 1) & 0b01100) | (first & 0b011);
    firstDigit = 0b01000 | ((first >>> 2) & 0b01);
  }
  let all = 0n;
  for (const b of bytes) all = (all << 8n) | BigInt(b);
  // The exponent: its 2 high bits in the combination field, the continuation bits after it
  const remaining = f.exponentContinuationBits - 2;
  const continuation = Number((all >> BigInt(f.coefficientContinuationBits)) & ((1n << BigInt(remaining)) - 1n));
  const exponent = ((exponentMsb << remaining) | continuation) - f.exponentBias;
  // The coefficient: the first digit, then groups of three digits, the most significant first
  const groups = f.coefficientContinuationBits / 10;
  let coefficient = BigInt(firstDigit);
  for (let i = groups - 1; i >= 0; i--) {
    const g = Number((all >> BigInt(i * 10)) & 0x3ffn);
    coefficient = coefficient * 1000n + BigInt(dpdDigits(g));
  }
  return { kind: 'finite', negative, coefficient: negative ? -coefficient : coefficient, exponent };
}

/** TypeDecoder.DecodeDec16 of the 8 bytes of the wire. */
export function decodeDec16(bytes: Uint8Array): DecFloat {
  return parse(bytes, DEC16);
}

/** TypeDecoder.DecodeDec34 of the 16 bytes of the wire. */
export function decodeDec34(bytes: Uint8Array): DecFloat {
  return parse(bytes, DEC34);
}

/** FbDecFloat.ToString (BigInteger and int print with "-" in every culture the engine knows). */
export function decFloatText(d: DecFloat): string {
  switch (d.kind) {
    case 'infinity':
      return d.negative ? '-inf' : 'inf';
    case 'nan':
      return d.negative ? '-nan' : 'nan';
    case 'snan':
      return d.negative ? '-snan' : 'snan';
  }
  if (d.negative && d.coefficient === 0n) return '-0';
  return d.coefficient.toString() + 'E' + String(d.exponent);
}
