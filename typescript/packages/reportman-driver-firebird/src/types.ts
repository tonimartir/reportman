// The Firebird types as FirebirdClient sees them: the wire SQL types of a described column or
// parameter, the DbDataType FirebirdClient derives from them (TypeHelper.GetDbDataTypeFromSqlType),
// its .NET type (GetTypeFromDbDataType), its ColumnSize (DbField.GetSize) and the character sets it
// knows (Charset).

import { TextDecoder } from 'node:util';

/** The SQL type codes of the wire protocol (IscCodes.SQL_*), without the nullable bit. */
export const SqlType = {
  TEXT: 452,
  VARYING: 448,
  SHORT: 500,
  LONG: 496,
  FLOAT: 482,
  DOUBLE: 480,
  D_FLOAT: 530,
  TIMESTAMP: 510,
  BLOB: 520,
  ARRAY: 540,
  QUAD: 550,
  TYPE_TIME: 560,
  TYPE_DATE: 570,
  INT64: 580,
  TIMESTAMP_TZ_EX: 32748,
  TIME_TZ_EX: 32750,
  INT128: 32752,
  TIMESTAMP_TZ: 32754,
  TIME_TZ: 32756,
  DEC16: 32760,
  DEC34: 32762,
  BOOLEAN: 32764,
  NULL: 32766,
} as const;

/** FirebirdClient's DbDataType (the enum values name it in "Invalid data type: N."). */
export const DbDataType = {
  Array: 0,
  BigInt: 1,
  Binary: 2,
  Boolean: 3,
  Char: 4,
  Date: 5,
  Decimal: 6,
  Double: 7,
  Float: 8,
  Guid: 9,
  Integer: 10,
  Numeric: 11,
  SmallInt: 12,
  Text: 13,
  Time: 14,
  TimeStamp: 15,
  VarChar: 16,
  TimeStampTZ: 17,
  TimeStampTZEx: 18,
  TimeTZ: 19,
  TimeTZEx: 20,
  Dec16: 21,
  Dec34: 22,
  Int128: 23,
  Null: 24,
} as const;
export type DbDataType = (typeof DbDataType)[keyof typeof DbDataType];

/** A character set of FirebirdClient (Charset): its id, name, bytes per character and decoding. */
export interface Charset {
  readonly id: number;
  readonly name: string;
  readonly bytesPerCharacter: number;
  /** The WHATWG encoding label of its .NET encoding; 'octets', 'none', 'ascii' and 'latin1' are special. */
  readonly encoding: string;
}

const CHARSETS: readonly Charset[] = [
  { id: 0, name: 'NONE', bytesPerCharacter: 1, encoding: 'none' },
  { id: 1, name: 'OCTETS', bytesPerCharacter: 1, encoding: 'octets' },
  { id: 2, name: 'ASCII', bytesPerCharacter: 1, encoding: 'ascii' },
  { id: 3, name: 'UNICODE_FSS', bytesPerCharacter: 3, encoding: 'utf-8' },
  { id: 4, name: 'UTF8', bytesPerCharacter: 4, encoding: 'utf-8' },
  { id: 5, name: 'SJIS_0208', bytesPerCharacter: 2, encoding: 'shift_jis' },
  { id: 6, name: 'EUCJ_0208', bytesPerCharacter: 2, encoding: 'euc-jp' },
  { id: 7, name: 'ISO2022-JP', bytesPerCharacter: 2, encoding: 'iso-2022-jp' },
  { id: 10, name: 'DOS437', bytesPerCharacter: 1, encoding: 'ibm437' },
  { id: 11, name: 'DOS850', bytesPerCharacter: 1, encoding: 'ibm850' },
  { id: 12, name: 'DOS865', bytesPerCharacter: 1, encoding: 'ibm865' },
  { id: 13, name: 'DOS860', bytesPerCharacter: 1, encoding: 'ibm860' },
  { id: 14, name: 'DOS863', bytesPerCharacter: 1, encoding: 'ibm863' },
  { id: 21, name: 'ISO8859_1', bytesPerCharacter: 1, encoding: 'latin1' },
  { id: 22, name: 'ISO8859_2', bytesPerCharacter: 1, encoding: 'iso-8859-2' },
  { id: 44, name: 'KSC_5601', bytesPerCharacter: 2, encoding: 'euc-kr' },
  { id: 47, name: 'DOS861', bytesPerCharacter: 1, encoding: 'ibm861' },
  { id: 51, name: 'WIN1250', bytesPerCharacter: 1, encoding: 'windows-1250' },
  { id: 52, name: 'WIN1251', bytesPerCharacter: 1, encoding: 'windows-1251' },
  { id: 53, name: 'WIN1252', bytesPerCharacter: 1, encoding: 'windows-1252' },
  { id: 54, name: 'WIN1253', bytesPerCharacter: 1, encoding: 'windows-1253' },
  { id: 55, name: 'WIN1254', bytesPerCharacter: 1, encoding: 'windows-1254' },
  { id: 56, name: 'BIG_5', bytesPerCharacter: 2, encoding: 'big5' },
  { id: 57, name: 'GB_2312', bytesPerCharacter: 2, encoding: 'gbk' },
  { id: 58, name: 'WIN1255', bytesPerCharacter: 1, encoding: 'windows-1255' },
  { id: 59, name: 'WIN1256', bytesPerCharacter: 1, encoding: 'windows-1256' },
  { id: 60, name: 'WIN1257', bytesPerCharacter: 1, encoding: 'windows-1257' },
  { id: 63, name: 'KOI8R', bytesPerCharacter: 2, encoding: 'koi8-r' },
  { id: 64, name: 'KOI8U', bytesPerCharacter: 2, encoding: 'koi8-u' },
  { id: 65, name: 'TIS620', bytesPerCharacter: 1, encoding: 'windows-874' },
];

const BY_ID = new Map(CHARSETS.map((c) => [c.id, c]));
const BY_NAME = new Map(CHARSETS.map((c) => [c.name.toUpperCase(), c]));

export const NONE_CHARSET = BY_ID.get(0)!;

/** Charset.TryGetById, NONE (Charset.DefaultCharset) for an unknown id. */
export function charsetById(id: number): Charset {
  return BY_ID.get(id) ?? NONE_CHARSET;
}

/** Charset.TryGetByName. */
export function charsetByName(name: string): Charset | undefined {
  return BY_NAME.get(name.toUpperCase());
}

const decoders = new Map<string, TextDecoder>();

/** Charset.GetString: the text of bytes in a character set. */
export function decodeText(bytes: Uint8Array, charset: Charset): string {
  switch (charset.encoding) {
    case 'latin1':
      return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
    case 'ascii': {
      // ASCIIEncoding: a byte above 127 is '?'
      let s = '';
      for (const b of bytes) s += b < 128 ? String.fromCharCode(b) : '?';
      return s;
    }
    case 'octets':
      return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
    case 'none':
      // Encoding2.Default: Encoding.Default (UTF-8) on .NET without the code pages provider
      return utf8(bytes);
    default: {
      let d = decoders.get(charset.encoding);
      if (d === undefined) {
        try {
          d = new TextDecoder(charset.encoding);
        } catch {
          d = new TextDecoder('utf-8');
        }
        decoders.set(charset.encoding, d);
      }
      return d.decode(bytes);
    }
  }
}

const UTF8 = new TextDecoder('utf-8');

function utf8(bytes: Uint8Array): string {
  return UTF8.decode(bytes);
}

/** A described column or parameter: what op_prepare tells of it. */
export interface FieldDescription {
  /** The SQL type, without the nullable bit. */
  readonly sqlType: number;
  readonly subType: number;
  readonly scale: number;
  /** The length in bytes the server described. */
  readonly length: number;
}

/** DbField.Charset: the character set in the low byte of the sub type of a character field. */
export function fieldCharset(field: FieldDescription): Charset {
  return charsetById(field.subType & 0xff);
}

function isCharacterType(sqlType: number, subType: number): boolean {
  return sqlType === SqlType.TEXT || sqlType === SqlType.VARYING || (sqlType === SqlType.BLOB && subType === 1);
}

/** DbField.DbDataType (TypeHelper.GetDbDataTypeFromSqlType). */
export function dbDataType(field: FieldDescription): DbDataType {
  const { sqlType, subType, scale } = field;
  const charset = isCharacterType(sqlType, subType) ? fieldCharset(field) : undefined;
  // Special case for Guid handling
  if ((sqlType === SqlType.TEXT || sqlType === SqlType.VARYING) && field.length === 16 && charset?.id === 1)
    return DbDataType.Guid;
  const scaled = (integer: DbDataType): DbDataType =>
    subType === 2 ? DbDataType.Decimal : subType === 1 ? DbDataType.Numeric : scale < 0 ? DbDataType.Decimal : integer;
  switch (sqlType) {
    case SqlType.TEXT:
      return DbDataType.Char;
    case SqlType.VARYING:
      return DbDataType.VarChar;
    case SqlType.SHORT:
      return scaled(DbDataType.SmallInt);
    case SqlType.LONG:
      return scaled(DbDataType.Integer);
    case SqlType.QUAD:
    case SqlType.INT64:
      return scaled(DbDataType.BigInt);
    case SqlType.FLOAT:
      return DbDataType.Float;
    case SqlType.DOUBLE:
    case SqlType.D_FLOAT:
      return scaled(DbDataType.Double);
    case SqlType.BLOB:
      return subType === 1 ? DbDataType.Text : DbDataType.Binary;
    case SqlType.TIMESTAMP:
      return DbDataType.TimeStamp;
    case SqlType.TYPE_TIME:
      return DbDataType.Time;
    case SqlType.TYPE_DATE:
      return DbDataType.Date;
    case SqlType.ARRAY:
      return DbDataType.Array;
    case SqlType.NULL:
      return DbDataType.Null;
    case SqlType.BOOLEAN:
      return DbDataType.Boolean;
    case SqlType.TIMESTAMP_TZ:
      return DbDataType.TimeStampTZ;
    case SqlType.TIMESTAMP_TZ_EX:
      return DbDataType.TimeStampTZEx;
    case SqlType.TIME_TZ:
      return DbDataType.TimeTZ;
    case SqlType.TIME_TZ_EX:
      return DbDataType.TimeTZEx;
    case SqlType.DEC16:
      return DbDataType.Dec16;
    case SqlType.DEC34:
      return DbDataType.Dec34;
    case SqlType.INT128:
      return scaled(DbDataType.Int128);
    default:
      throw invalidDataType(sqlType);
  }
}

/** TypeHelper.InvalidDataType. */
export function invalidDataType(type: number): Error {
  const e = new Error('Invalid data type: ' + String(type) + '.');
  e.name = 'ArgumentException';
  (e as Error & { netType: string }).netType = 'ArgumentException';
  return e;
}

/** DbField.CharCount: the length in characters of a character field. */
export function charCount(field: FieldDescription): number {
  return Math.trunc(field.length / fieldCharset(field).bytesPerCharacter);
}

/** DbField.GetSize: ColumnSize of the schema table. */
export function columnSize(field: FieldDescription, type: DbDataType): number {
  if (type === DbDataType.Binary || type === DbDataType.Text) return 2147483647;
  if (type === DbDataType.Char || type === DbDataType.VarChar) return charCount(field);
  return field.length;
}

/** The .NET type name of a DbDataType (GetTypeFromDbDataType), as golden-cs prints DataType. */
export function netTypeName(type: DbDataType): string {
  switch (type) {
    case DbDataType.Array:
      return 'Array';
    case DbDataType.Binary:
      return 'Byte[]';
    case DbDataType.Text:
    case DbDataType.Char:
    case DbDataType.VarChar:
      return 'String';
    case DbDataType.Guid:
      return 'Guid';
    case DbDataType.SmallInt:
      return 'Int16';
    case DbDataType.Integer:
      return 'Int32';
    case DbDataType.BigInt:
      return 'Int64';
    case DbDataType.Float:
      return 'Single';
    case DbDataType.Double:
      return 'Double';
    case DbDataType.Numeric:
    case DbDataType.Decimal:
      return 'Decimal';
    case DbDataType.Date:
    case DbDataType.TimeStamp:
      return 'DateTime';
    case DbDataType.Time:
      return 'TimeSpan';
    case DbDataType.Boolean:
      return 'Boolean';
    case DbDataType.TimeStampTZ:
    case DbDataType.TimeStampTZEx:
      return 'FbZonedDateTime';
    case DbDataType.TimeTZ:
    case DbDataType.TimeTZEx:
      return 'FbZonedTime';
    case DbDataType.Dec16:
    case DbDataType.Dec34:
      return 'FbDecFloat';
    case DbDataType.Int128:
      return 'BigInteger';
    default:
      throw invalidDataType(type);
  }
}
