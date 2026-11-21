// The body of api/agent/execute as HttpAgentExecutor serializes it: JsonSerializer.Serialize(new {
// hubDatabaseId, sql, parameters }) with camelCase names, each parameter a DbParameterInfo (Name, Value,
// DbType: the System.Data.DbType number) whose Value is the boxed .NET value the engine assigned to the
// IDbDataParameter (DataInfo: the alias of the report parameter and Variant.AsObject of its value; a
// master record's value for a detail; GETVALUEFROMSQL: "@" + the alias and the Variant itself).

import {
  CsDecimal,
  CultureInfo,
  DateTimeKind,
  formatDouble,
  NetException,
  RpDateTime,
  toBase64String,
  type DataValue,
  type ParameterDbType,
  type QueryParameter,
} from 'reportman-engine';
import { jsonString } from './json.js';

/** System.Data.DbType numbers. */
export const DB_TYPE_NUMBERS: Readonly<Record<ParameterDbType, number>> = {
  Binary: 1,
  Byte: 2,
  Boolean: 3,
  DateTime: 6,
  Decimal: 7,
  Double: 8,
  Int32: 11,
  Int64: 12,
  Object: 13,
  SByte: 14,
  String: 16,
};

/** The ArgumentException of System.Text.Json for NaN and the infinities. */
export function nonFiniteNumberException(): NetException {
  return new NetException(
    'ArgumentException',
    ".NET number values such as positive and negative infinity cannot be written as valid JSON. To make it work when using 'JsonSerializer', consider specifying 'JsonNumberHandling.AllowNamedFloatingPointLiterals' (see https://learn.microsoft.com/dotnet/api/system.text.json.serialization.jsonnumberhandling).",
  );
}

/** A double as Utf8JsonWriter writes it: its shortest round-trip text ("1E-05", "1.2345678901234568E+20"). */
export function jsonDouble(value: number): string {
  if (!Number.isFinite(value)) throw nonFiniteNumberException();
  return formatDouble(value, '', CultureInfo.invariant.number);
}

function pad(n: number, width: number): string {
  return n.toString().padStart(width, '0');
}

/** The offset (minutes) of the host time zone at a local wall time (TimeZoneInfo.Local.GetUtcOffset). */
function localOffsetAt(d: RpDateTime): number {
  const js = new Date(2000, 0, 1, d.hour, d.minute, d.second);
  js.setFullYear(d.year, d.month - 1, d.day);
  return -js.getTimezoneOffset();
}

/**
 * A DateTime as System.Text.Json writes it: "yyyy-MM-ddTHH:mm:ss", the fraction without its trailing zeros
 * (none when it is zero), "Z" for a UTC value and the offset of the host time zone for a local one.
 */
export function jsonDateTime(d: RpDateTime): string {
  let s = `${pad(d.year, 4)}-${pad(d.month, 2)}-${pad(d.day, 2)}T${pad(d.hour, 2)}:${pad(d.minute, 2)}:${pad(d.second, 2)}`;
  const fraction = d.ticksOfSecond;
  if (fraction > 0) s += '.' + pad(fraction, 7).replace(/0+$/, '');
  if (d.kind === DateTimeKind.Utc) s += 'Z';
  else if (d.kind === DateTimeKind.Local) {
    const offset = localOffsetAt(d);
    const a = Math.abs(offset);
    s += (offset < 0 ? '-' : '+') + pad(Math.floor(a / 60), 2) + ':' + pad(a % 60, 2);
  }
  return '"' + s + '"';
}

/** The JSON of a value by its JavaScript form. */
function jsonOfValue(value: DataValue): string {
  if (value === undefined) return 'null';
  if (value === null) return '{}';
  if (typeof value === 'string') return jsonString(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isInteger(value) && Math.abs(value) <= 2147483647 ? String(value) : jsonDouble(value);
  if (value instanceof Uint8Array) return jsonString(toBase64String(value));
  if (value instanceof CsDecimal) return value.toInvariantString();
  if (value instanceof RpDateTime) return jsonDateTime(value);
  return jsonDateTime(RpDateTime.fromJsDate(value, DateTimeKind.Local));
}

/** The VariantType name of the Variant GETVALUEFROMSQL passes, by its DbType (Variant.GetDbType). */
const VARIANT_TYPES: Readonly<Record<ParameterDbType, string>> = {
  Object: 'Null',
  Boolean: 'Boolean',
  Byte: 'Byte',
  SByte: 'Char',
  Int32: 'Integer',
  Int64: 'Long',
  Decimal: 'Decimal',
  Double: 'Double',
  DateTime: 'DateTime',
  Binary: 'Binary',
  String: 'String',
};

/** The JSON of the value of a parameter, by its .NET type: C# null is null, DBNull an empty object. */
export function jsonParameterValue(p: QueryParameter): string {
  const v = p.value;
  switch (p.valueType) {
    case 'Null':
      return 'null';
    case 'DBNull':
      return '{}';
    case 'Boolean':
      return v ? 'true' : 'false';
    case 'Byte':
    case 'Int32':
    case 'Int64':
      return typeof v === 'bigint' ? v.toString() : typeof v === 'number' ? String(Math.trunc(v)) : jsonOfValue(v);
    case 'Char':
    case 'String':
      return jsonString(typeof v === 'string' ? v : String(v ?? ''));
    case 'Decimal':
      return v instanceof CsDecimal ? v.toInvariantString() : jsonOfValue(v);
    case 'Double':
      return typeof v === 'number' ? jsonDouble(v) : jsonOfValue(v);
    case 'DateTime':
      if (v instanceof RpDateTime) return jsonDateTime(v);
      return jsonOfValue(v);
    case 'Binary':
      return v instanceof Uint8Array ? jsonString(toBase64String(v)) : jsonOfValue(v);
    case 'Object':
      // The Variant itself (GETVALUEFROMSQL), as VariantSystemTextJsonConverter writes it: its VariantType
      // and its AsObject (DBNull for Null; null for Binary, whose AsObject gives no bytes)
      return `{"Type":"${VARIANT_TYPES[p.dbType]}","Value":${p.dbType === 'Binary' ? 'null' : jsonOfValue(v)}}`;
  }
}

/** The body of api/agent/execute. */
export function executeBody(hubDatabaseId: bigint, sql: string, parameters: readonly QueryParameter[]): string {
  const ps = parameters.map(
    (p) => `{"name":${jsonString(p.name)},"value":${jsonParameterValue(p)},"dbType":${DB_TYPE_NUMBERS[p.dbType] ?? 13}}`,
  );
  return `{"hubDatabaseId":${hubDatabaseId.toString()},"sql":${jsonString(sql)},"parameters":[${ps.join(',')}]}`;
}

/** The body of the catalog and test requests: {hubDatabaseId} or {hubDatabaseId, tableName}. */
export function databaseBody(hubDatabaseId: bigint, tableName?: string | null): string {
  if (tableName === undefined || tableName === null) return `{"hubDatabaseId":${hubDatabaseId.toString()}}`;
  return `{"hubDatabaseId":${hubDatabaseId.toString()},"tableName":${jsonString(tableName)}}`;
}
