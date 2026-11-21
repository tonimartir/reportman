/**
 * Errors with the class name of the .NET exception the C# engine raises in the same situation, so
 * a caller (and the parity tests) can tell a FormatException from an OverflowException the way the
 * C# engine reports them (`e.GetType().Name`).
 */
export class NetException extends Error {
  /** The simple name of the .NET exception class, e.g. "FormatException". */
  readonly netType: string;

  constructor(netType: string, message: string) {
    super(message);
    this.netType = netType;
    this.name = netType;
  }
}

/** Reportman.Drawing.UnNamedException: an engine error without an element name. */
export class UnNamedException extends NetException {
  constructor(message: string) {
    super('UnNamedException', message);
  }
}

/** Reportman.Drawing.NamedException: an engine error about a named element. */
export class NamedException extends NetException {
  readonly elementName: string;

  constructor(message: string, name: string) {
    super('NamedException', message);
    this.elementName = name;
  }
}

/** The messages of the .NET runtime (en-US resources of .NET 10) the engine can surface. */
export const NetMessages = {
  formatInvalidString: 'Input string was not in a correct format.',
  badFormatSpecifier: 'Format specifier was invalid.',
  overflowDecimal: 'Value was either too large or too small for a Decimal.',
  overflowInt32: 'Value was either too large or too small for an Int32.',
  overflowInt64: 'Value was either too large or too small for an Int64.',
  overflowByte: 'Value was either too large or too small for an unsigned byte.',
  arithmeticOverflow: 'Arithmetic operation resulted in an overflow.',
  divideByZero: 'Attempted to divide by zero.',
  nullReference: 'Object reference not set to an instance of an object.',
  oleAutDateInvalid: 'Not a legal OleAut date.',
  oleAutDateScale: 'OleAut date did not convert to a DateTime correctly.',
  badBase64:
    'The input is not a valid Base-64 string as it contains a non-base 64 character, more than two padding characters, or an illegal character among the padding characters.',
  formatBadQuote: (quote: string) => `Cannot find a matching quote character for the character '${quote}'.`,
  parseFailed: (text: string) => `The input string '${text}' was not in a correct format.`,
  invalidCast: (from: string, to: string) => `Invalid cast from '${from}' to '${to}'.`,
  formatIndexOutOfRange: 'Index (zero based) must be greater than or equal to zero and less than the size of the argument list.',
  formatInvalidStringAt: (offset: number, reason: string) =>
    `Input string was not in a correct format. Failure to parse near offset ${offset}. ${reason}`,
  formatUnexpectedClosingBrace: 'Unexpected closing brace without a corresponding opening brace.',
  formatExpectedAsciiDigit: 'Expected an ASCII digit.',
  formatUnclosedFormatItem: 'Format item ends prematurely.',
  addValueOutOfRange: "Value to add was out of range. (Parameter 'value')",
  dateArithmetic: "The added or subtracted value results in an un-representable DateTime. (Parameter 'value')",
  stringZeroLength: "String cannot be of zero length. (Parameter 'oldValue')",
  sequenceNoElements: 'Sequence contains no elements',
  duplicateKey: (key: string) => `An item with the same key has already been added. Key: ${key}`,
} as const;

export function formatException(message: string = NetMessages.formatInvalidString): NetException {
  return new NetException('FormatException', message);
}

export function overflowException(message: string): NetException {
  return new NetException('OverflowException', message);
}

export function divideByZeroException(): NetException {
  return new NetException('DivideByZeroException', NetMessages.divideByZero);
}

export function nullReferenceException(): NetException {
  return new NetException('NullReferenceException', NetMessages.nullReference);
}

export function argumentException(message: string): NetException {
  return new NetException('ArgumentException', message);
}

export function argumentOutOfRangeException(message: string): NetException {
  return new NetException('ArgumentOutOfRangeException', message);
}

export function invalidCastException(from: string, to: string): NetException {
  return new NetException('InvalidCastException', NetMessages.invalidCast(from, to));
}

/** The .NET class name of any error: the netType of a NetException, else the JS error name. */
export function netTypeOf(e: unknown): string {
  if (e instanceof NetException) return e.netType;
  if (e instanceof RangeError) return 'OverflowException';
  if (e instanceof Error) return e.name;
  return 'Exception';
}

/** The message of any thrown value. */
export function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
