// The values of a DataTable column (System.Data storage), as the C# ReportDataset keeps the rows
// of a reader: each value is converted to the type of its column when the row is filled
// (DataRow[i] = value), with the conversions of IConvertible under the table's locale, and read
// back as the object of that type (Variant.AssignFromObject turns it into a Variant).

import { toUpperNet, trimNet } from '../util/chars.js';
import { CsDecimal } from '../util/decimal.js';
import { RpDateTime, DateTimeKind, TICKS_PER_SECOND } from '../util/datetime.js';
import { formatDateTime } from '../util/dateformat.js';
import { tryParseDateTime } from '../util/dateparse.js';
import type { CultureInfo } from '../util/culture.js';
import { argumentException, formatException, invalidCastException, NetMessages, overflowException } from '../util/netexception.js';
import { formatDecimal, formatDouble } from '../util/numberformat.js';
import {
  convertDecimalToInt32,
  convertDecimalToInt64,
  convertDoubleToInt32,
  convertDoubleToInt64,
  NumberStyles,
  parseDecimal,
  parseDouble,
  tryParseBoolean,
  tryParseInt64,
} from '../util/numberparse.js';
import { Variant } from '../variant/variant.js';
import type { DataColumnType, DataValue, ParameterValueType } from './host.js';

/** A value stored in a column: null is DBNull; otherwise the JavaScript form of its .NET type. */
export type StoredValue = null | string | number | bigint | boolean | Uint8Array | CsDecimal | RpDateTime;

/** A column of a ReportDataset (DataColumn). */
export interface DataColumn {
  /** ColumnName (upper case). */
  readonly name: string;
  readonly type: DataColumnType;
  /** MaxLength of a string column (-1: none). */
  readonly maxLength: number;
}

const NET_TYPE_NAMES: Record<DataColumnType, string> = {
  String: 'String',
  Int64: 'Int64',
  Int32: 'Int32',
  Int16: 'Int16',
  Byte: 'Byte',
  Boolean: 'Boolean',
  Double: 'Double',
  Single: 'Single',
  Decimal: 'Decimal',
  DateTime: 'DateTime',
  Binary: 'Byte[]',
  Object: 'Object',
};

/** The .NET type name of a host value, as GetType().Name gives it. */
function hostTypeName(value: DataValue, columnType: DataColumnType): string {
  if (value === null || value === undefined) return 'DBNull';
  switch (typeof value) {
    case 'string':
      return 'String';
    case 'bigint':
      return 'Int64';
    case 'boolean':
      return 'Boolean';
    case 'number':
      return isIntegerColumn(columnType) && Number.isInteger(value) ? NET_TYPE_NAMES[columnType] : 'Double';
  }
  if (value instanceof Uint8Array) return 'Byte[]';
  if (value instanceof CsDecimal) return 'Decimal';
  return 'DateTime';
}

function isIntegerColumn(type: DataColumnType): boolean {
  return type === 'Int64' || type === 'Int32' || type === 'Int16' || type === 'Byte';
}

/** The text of a value in a cell, as the .NET value prints it (<value> of the store error). */
function hostText(value: DataValue, culture: CultureInfo): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : formatDouble(value, '', culture.number);
  if (value instanceof Uint8Array) return 'System.Byte[]';
  if (value instanceof CsDecimal) return formatDecimal(value, '', culture.number);
  const dt = value instanceof Date ? RpDateTime.fromJsDate(value) : value;
  return formatDateTime(dt, '', culture);
}

/**
 * DataColumn.this[record] = value: ExprException.SetFailed, the error of a value that cannot be
 * stored in the type of its column.
 */
function setFailed(inner: string, value: DataValue, column: DataColumn, culture: CultureInfo): Error {
  return argumentException(
    inner +
      "Couldn't store <" +
      hostText(value, culture) +
      '> in ' +
      column.name +
      ' Column.  Expected type is ' +
      NET_TYPE_NAMES[column.type] +
      '.',
  );
}

function rangeCheck(value: bigint, min: bigint, max: bigint, message: string): bigint {
  if (value < min || value > max) throw overflowException(message);
  return value;
}

/** IConvertible.ToInt64 of a host value. */
function toInt64(value: Exclude<DataValue, null | undefined>, column: DataColumn, locale: CultureInfo): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (Number.isInteger(value) && isIntegerColumn(column.type)) return BigInt(value);
    return convertDoubleToInt64(value);
  }
  if (typeof value === 'boolean') return value ? 1n : 0n;
  if (typeof value === 'string') {
    const r = tryParseInt64(value, NumberStyles.Integer, locale.number);
    if (r === undefined) throw formatException(NetMessages.parseFailed(value));
    return r;
  }
  if (value instanceof CsDecimal) return convertDecimalToInt64(value);
  if (value instanceof Uint8Array)
    throw new Error("Unable to cast object of type 'System.Byte[]' to type 'System.IConvertible'.");
  throw invalidCastException('DateTime', NET_TYPE_NAMES[column.type]);
}

function toDouble(value: Exclude<DataValue, null | undefined>, column: DataColumn, locale: CultureInfo): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') return parseDouble(value, NumberStyles.Float | NumberStyles.AllowThousands, locale.number);
  if (value instanceof CsDecimal) return value.toDouble();
  if (value instanceof Uint8Array)
    throw new Error("Unable to cast object of type 'System.Byte[]' to type 'System.IConvertible'.");
  throw invalidCastException('DateTime', NET_TYPE_NAMES[column.type]);
}

/** value.ToString() of a host value (StringStorage), under the current culture. */
function toStringValue(value: Exclude<DataValue, null | undefined>, column: DataColumn, culture: CultureInfo): string {
  if (typeof value === 'number' && !Number.isInteger(value)) return formatDouble(value, '', culture.number);
  if (typeof value === 'number' && !isIntegerColumn(column.type))
    // C# parity: a Double whose value is integral prints without decimals ("5"), as the integer
    return formatDouble(value, '', culture.number);
  return hostText(value, culture);
}

/**
 * Stores a value in a column (DataRow[column] = value): DBNull for null; otherwise the value
 * converted to the column type (IConvertible.ToXxx under the table locale, value.ToString() for a
 * string column). A value that cannot be converted fails as C# does.
 */
export function storeValue(column: DataColumn, value: DataValue, locale: CultureInfo, culture: CultureInfo): StoredValue {
  if (value === null || value === undefined) return null;
  const v: Exclude<DataValue, null | undefined> = value instanceof Date ? RpDateTime.fromJsDate(value) : value;
  try {
    switch (column.type) {
      case 'Object':
        return v as StoredValue;
      case 'String':
        if (typeof v === 'string') return v;
        return toStringValue(v, column, culture);
      case 'Int64':
        return toInt64(v, column, locale);
      case 'Int32':
        if (typeof v === 'number' && !Number.isInteger(v)) return convertDoubleToInt32(v);
        if (v instanceof CsDecimal) return convertDecimalToInt32(v);
        return Number(rangeCheck(toInt64(v, column, locale), -2147483648n, 2147483647n, NetMessages.overflowInt32));
      case 'Int16': {
        const r = typeof v === 'number' && !Number.isInteger(v) ? BigInt(convertDoubleToInt32(v)) : toInt64(v, column, locale);
        return Number(rangeCheck(r, -32768n, 32767n, 'Value was either too large or too small for an Int16.'));
      }
      case 'Byte': {
        const r = typeof v === 'number' && !Number.isInteger(v) ? BigInt(convertDoubleToInt32(v)) : toInt64(v, column, locale);
        return Number(rangeCheck(r, 0n, 255n, NetMessages.overflowByte));
      }
      case 'Double':
        return toDouble(v, column, locale);
      case 'Single':
        return Math.fround(toDouble(v, column, locale));
      case 'Decimal':
        if (v instanceof CsDecimal) return v;
        if (typeof v === 'bigint') return CsDecimal.fromInteger(v);
        if (typeof v === 'number') return CsDecimal.fromDouble(v);
        if (typeof v === 'boolean') return v ? CsDecimal.one : CsDecimal.zero;
        if (typeof v === 'string') return parseDecimal(v, NumberStyles.Number, locale.number);
        if (v instanceof Uint8Array)
          throw new Error("Unable to cast object of type 'System.Byte[]' to type 'System.IConvertible'.");
        throw invalidCastException('DateTime', 'Decimal');
      case 'Boolean':
        if (typeof v === 'boolean') return v;
        if (typeof v === 'number') return v !== 0;
        if (typeof v === 'bigint') return v !== 0n;
        if (typeof v === 'string') {
          const b = tryParseBoolean(v);
          if (b === undefined) throw formatException(`String '${v}' was not recognized as a valid Boolean.`);
          return b;
        }
        if (v instanceof CsDecimal) return !v.isZero;
        if (v instanceof Uint8Array)
          throw new Error("Unable to cast object of type 'System.Byte[]' to type 'System.IConvertible'.");
        throw invalidCastException('DateTime', 'Boolean');
      case 'DateTime':
        if (v instanceof RpDateTime) return v;
        if (typeof v === 'string') {
          const d = tryParseDateTime(v, locale);
          if (d === undefined)
            throw formatException(`String '${v}' was not recognized as a valid DateTime.`);
          return d;
        }
        if (v instanceof Uint8Array)
          throw new Error("Unable to cast object of type 'System.Byte[]' to type 'System.IConvertible'.");
        throw invalidCastException(hostTypeName(v, column.type), 'DateTime');
      case 'Binary':
        if (v instanceof Uint8Array) return v;
        throw new Error('Type of value has a mismatch with column type');
    }
  } catch (e) {
    throw setFailed(e instanceof Error ? e.message : String(e), value, column, culture);
  }
}

/** Variant.AssignFromObject of a stored value. */
export function storedToVariant(column: DataColumn, value: StoredValue): Variant {
  if (value === null) return Variant.null;
  switch (column.type) {
    case 'Int64':
      return Variant.fromLong(value as bigint);
    case 'Int32':
    case 'Int16':
      return Variant.fromInteger(value as number);
    case 'Byte':
      return Variant.fromByte(value as number);
    case 'Double':
    case 'Single':
      return Variant.fromDouble(value as number);
    case 'Decimal':
      return Variant.fromDecimal(value as CsDecimal);
    case 'Boolean':
      return Variant.fromBoolean(value as boolean);
    case 'String':
      return Variant.fromString(value as string);
    case 'DateTime':
      return Variant.fromDateTime(value as RpDateTime);
    case 'Binary':
      return Variant.fromBinary(value as Uint8Array);
    case 'Object':
      return objectToVariant(value);
  }
}

/** AssignFromObject of a value of an Object column, by its JavaScript type. */
function objectToVariant(value: StoredValue): Variant {
  if (value === null) return Variant.null;
  if (typeof value === 'bigint') return Variant.fromLong(value);
  if (typeof value === 'number') return Number.isInteger(value) && Math.abs(value) <= 2147483647 ? Variant.fromInteger(value) : Variant.fromDouble(value);
  return Variant.fromHost(value);
}

/** The .NET type name of a stored value (for object equality and parameter types). */
export function storedTypeName(column: DataColumn, value: StoredValue): ParameterValueType {
  if (value === null) return 'DBNull';
  switch (column.type) {
    case 'Int64':
      return 'Int64';
    case 'Int32':
    case 'Int16':
      return 'Int32';
    case 'Byte':
      return 'Byte';
    case 'Double':
    case 'Single':
      return 'Double';
    case 'Decimal':
      return 'Decimal';
    case 'Boolean':
      return 'Boolean';
    case 'String':
      return 'String';
    case 'DateTime':
      return 'DateTime';
    case 'Binary':
      return 'Binary';
    case 'Object':
      return hostValueType(value);
  }
}

/** The .NET type of a JavaScript value with no column (Object columns, parameter values). */
export function hostValueType(value: StoredValue | undefined): ParameterValueType {
  if (value === undefined) return 'Null';
  if (value === null) return 'DBNull';
  switch (typeof value) {
    case 'string':
      return 'String';
    case 'bigint':
      return 'Int64';
    case 'boolean':
      return 'Boolean';
    case 'number':
      return Number.isInteger(value) && Math.abs(value) <= 2147483647 ? 'Int32' : 'Double';
  }
  if (value instanceof Uint8Array) return 'Binary';
  if (value instanceof CsDecimal) return 'Decimal';
  return 'DateTime';
}

/**
 * object.Equals of two boxed values: the same .NET type and the same value. Byte arrays are equal
 * only when they are the same array; DBNull equals DBNull; C# null ('Null') equals nothing.
 */
export function boxedEquals(
  aType: ParameterValueType,
  a: StoredValue | undefined,
  bType: ParameterValueType,
  b: StoredValue | undefined,
): boolean {
  if (aType === 'Null' || bType === 'Null') return false;
  if (aType !== bType) return false;
  if (aType === 'DBNull') return true;
  if (a instanceof CsDecimal && b instanceof CsDecimal) return a.equals(b);
  if (a instanceof RpDateTime && b instanceof RpDateTime) return a.ticks === b.ticks;
  if (typeof a === 'number' && typeof b === 'number') return a === b || (Number.isNaN(a) && Number.isNaN(b));
  return a === b;
}

/**
 * ReportDataset.SchemaColumnType: SQLite gives the type of the value in the first row, so a DATE
 * column (ISO text) would be a string; its declared type (DATE, DATETIME or TIMESTAMP) makes it
 * a DateTime, as in the Delphi engine.
 */
export function schemaColumnType(type: DataColumnType, declaredType: string | null | undefined): DataColumnType {
  if ((type === 'String' || type === 'Double' || type === 'Int64') && declaredType !== null && declaredType !== undefined) {
    const declared = toUpperNet(trimNet(declaredType));
    if (declared === 'DATE' || declared === 'DATETIME' || declared === 'TIMESTAMP') return 'DateTime';
  }
  return type;
}

const UNIX_EPOCH_TICKS = 621355968000000000n;

/**
 * ReportDataset.ColumnValue: for a DateTime column, the forms of a SQLite date become a DateTime:
 * ISO 8601 text (DateTime.TryParse with the invariant culture; blank text is DBNull, text that is
 * not a date stays text), a Julian day (Double) and Unix time (Int64, as UTC).
 */
export function columnValue(column: DataColumn, value: DataValue, invariant: CultureInfo, now: RpDateTime): DataValue {
  if (column.type !== 'DateTime' || value === null || value === undefined) return value;
  if (value instanceof RpDateTime || value instanceof Date) return value;
  if (typeof value === 'string') {
    if (trimNet(value).length === 0) return null;
    const date = tryParseDateTime(value, invariant, now);
    if (date !== undefined) return date;
    return value;
  }
  if (typeof value === 'number') return RpDateTime.fromOADate(value - 2415018.5);
  if (typeof value === 'bigint') {
    // DateTimeOffset.FromUnixTimeSeconds(value).UtcDateTime
    if (value < -62135596800n || value > 253402300799n)
      throw new Error("Valid values are between -62135596800 and 253402300799, inclusive. (Parameter 'seconds')");
    return RpDateTime.fromTicks(UNIX_EPOCH_TICKS + value * BigInt(TICKS_PER_SECOND), DateTimeKind.Utc);
  }
  return value;
}
