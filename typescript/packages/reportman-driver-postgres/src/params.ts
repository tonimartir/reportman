// The parameters of a command as Npgsql sends them for the C# engine. C# creates each parameter
// with the DbType of the report parameter (ParameterDbType.For: a date goes as DateTime2, i.e.
// `timestamp`, unless its value is UTC) and the value of the report parameter or of the master
// column; Npgsql sends it with the PostgreSQL type of that DbType, converting the values it can
// (any number to an integer or numeric type, truncating) and refusing the others with an
// InvalidCastException. Every parameter of the command is checked, used in the SQL or not.

import { CsDecimal, DateTimeKind, RpDateTime, type QueryParameter } from '@reportman/engine';
import { argumentException, invalidOperation, overflow, writingNotSupported } from './errors.js';
import { clrTypeOfValue } from './values.js';

/** A parameter as it goes to PostgreSQL: its type OID (0: unknown) and its text or binary value. */
export interface WireParameter {
  oid: number;
  value: string | Buffer | null;
}

/** The PostgreSQL types of the DbTypes (Npgsql's mapping). */
const DBTYPE_PG: Record<string, { oid: number; name: string }> = {
  Boolean: { oid: 16, name: 'boolean' },
  Byte: { oid: 21, name: 'smallint' },
  SByte: { oid: 21, name: 'smallint' },
  Int16: { oid: 21, name: 'smallint' },
  Int32: { oid: 23, name: 'integer' },
  Int64: { oid: 20, name: 'bigint' },
  Single: { oid: 700, name: 'real' },
  Decimal: { oid: 1700, name: 'numeric' },
  Double: { oid: 701, name: 'double precision' },
  DateTime: { oid: 1184, name: 'timestamp with time zone' },
  DateTime2: { oid: 1114, name: 'timestamp without time zone' },
  Date: { oid: 1082, name: 'date' },
  Time: { oid: 1083, name: 'time without time zone' },
  Binary: { oid: 17, name: 'bytea' },
  String: { oid: 25, name: 'text' },
};

/** The .NET type of a parameter value. */
function clrType(p: QueryParameter): string {
  switch (p.valueType) {
    case 'Null':
      return 'null';
    case 'DBNull':
      return 'System.DBNull';
    case 'Boolean':
      return 'System.Boolean';
    case 'Byte':
      return 'System.Byte';
    case 'Char':
      return 'System.Char';
    case 'Int32':
      return 'System.Int32';
    case 'Int64':
      return 'System.Int64';
    case 'Decimal':
      return 'System.Decimal';
    case 'Double':
      return 'System.Double';
    case 'DateTime':
      return (p.value !== null && typeof p.value === 'object' && clrTypeOfValue.get(p.value)) || 'System.DateTime';
    case 'String':
      return 'System.String';
    case 'Binary':
      return 'System.Byte[]';
    case 'Object':
      return 'Reportman.Reporting.Variant';
  }
}

/** The type Npgsql infers from a value when the parameter has no DbType (DbType.Object). */
function inferred(clr: string, value: unknown): string | null {
  switch (clr) {
    case 'System.Boolean':
      return 'Boolean';
    case 'System.Byte':
      return 'Int16';
    case 'System.Int32':
      return 'Int32';
    case 'System.Int64':
      return 'Int64';
    case 'System.Decimal':
      return 'Decimal';
    case 'System.Double':
      return 'Double';
    case 'System.String':
    case 'System.Char':
      return 'String';
    case 'System.DateTime':
      return (value as RpDateTime).kind === DateTimeKind.Utc ? 'DateTime' : 'DateTime2';
    case 'System.DateOnly':
      return 'Date';
    case 'System.TimeOnly':
      return 'Time';
    case 'System.Byte[]':
      return 'Binary';
    default:
      return null;
  }
}

const ARITHMETIC_OVERFLOW = 'Arithmetic operation resulted in an overflow.';
const RANGES: Record<number, [bigint, bigint, string]> = {
  21: [-32768n, 32767n, 'Int16'],
  23: [-2147483648n, 2147483647n, 'Int32'],
  20: [-9223372036854775808n, 9223372036854775807n, 'Int64'],
};

/** T.CreateChecked(value) of an integer type: truncation toward zero, overflow checked. */
function toInteger(oid: number, clr: string, value: unknown): string {
  const [min, max, name] = RANGES[oid]!;
  let n: bigint;
  if (typeof value === 'bigint') n = value;
  else if (value instanceof CsDecimal) {
    const t = value.truncate();
    n = t.negative ? -t.mag : t.mag;
  } else {
    const x = value as number;
    if (!Number.isFinite(x)) throw overflow(ARITHMETIC_OVERFLOW);
    n = BigInt(Math.trunc(x));
  }
  // decimal's explicit conversion has its own message; the other conversions are checked casts
  if (n < min || n > max) throw overflow(clr === 'System.Decimal' ? `Value was either too large or too small for an ${name}.` : ARITHMETIC_OVERFLOW);
  return n.toString();
}

/** decimal.CreateChecked(value): the text of the numeric sent. */
function toNumeric(value: unknown): string {
  if (value instanceof CsDecimal) return value.toInvariantString();
  if (typeof value === 'bigint') return value.toString();
  const x = value as number;
  if (Number.isInteger(x) && Math.abs(x) <= Number.MAX_SAFE_INTEGER) return String(x);
  return CsDecimal.fromDouble(x).toInvariantString();
}

/** The text of a double (round trip; NaN, Infinity and -0 as PostgreSQL reads them). */
function doubleText(x: number): string {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Infinity';
  if (x === -Infinity) return '-Infinity';
  if (Object.is(x, -0)) return '-0';
  return String(x);
}

const PG_EPOCH_TICKS = 630_822_816_000_000_000n;
const MAX_TICKS = 3_155_378_975_999_999_999n;

/** A timestamp in binary: microseconds since 2000-01-01 (MinValue and MaxValue as -infinity and infinity). */
function timestampBinary(micros: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64BE(micros);
  return b;
}

function dateTimeMicros(d: RpDateTime): bigint {
  const ticks = d.ticks;
  if (ticks === 0n) return -(1n << 63n);
  if (ticks === MAX_TICKS) return (1n << 63n) - 1n;
  // C#: (ticks - offset) / 10, truncating toward zero
  return (ticks - PG_EPOCH_TICKS) / 10n;
}

/** Whether Npgsql writes a value of that .NET type to a parameter of that PostgreSQL type. */
function accepts(oid: number, clr: string): boolean {
  switch (oid) {
    case 21:
    case 23:
    case 20:
    case 1700:
      return clr === 'System.Byte' || clr === 'System.Int32' || clr === 'System.Int64' || clr === 'System.Decimal' || clr === 'System.Double';
    case 701:
    case 700:
      return clr === 'System.Double';
    case 16:
      return clr === 'System.Boolean';
    case 25:
      return clr === 'System.String' || clr === 'System.Char' || clr === 'System.Byte[]';
    case 17:
      return clr === 'System.Byte[]';
    case 1114:
      return clr === 'System.DateTime' || clr === 'System.Int64';
    default:
      return true;
  }
}

/** The parameter as Npgsql writes it. */
export function bindParameter(p: QueryParameter): WireParameter {
  const clr = clrType(p);
  // ParameterDbType.For: a date goes as DateTime2 (timestamp) unless its value is a UTC DateTime
  let dbType: string = p.dbType;
  if (dbType === 'DateTime' && !(clr === 'System.DateTime' && (p.value as RpDateTime).kind === DateTimeKind.Utc)) dbType = 'DateTime2';
  if (clr === 'null') {
    throw invalidOperation(
      dbType === 'Object'
        ? `Parameter '${p.name}' must have either its DbType, NpgsqlDbType, DataTypeName or its Value set.`
        : `Parameter '${p.name}' cannot be null, DBNull.Value should be used instead.`,
    );
  }
  if (dbType === 'Object') {
    if (clr === 'System.DBNull') return { oid: 0, value: null };
    const t = inferred(clr, p.value);
    if (t === null) throw writingNotSupported(clr, null);
    dbType = t;
  }
  // A value its type cannot take goes with the type of the value (ParameterDbType.For on Npgsql),
  // as Delphi binds it: an evaluated list or expression parameter typed String by the report gives
  // an integer, and Npgsql refused it. The values it takes keep their type (and conversions)
  if (clr !== 'System.DBNull' && !accepts(DBTYPE_PG[dbType]!.oid, clr)) {
    const t = inferred(clr, p.value);
    if (t !== null) dbType = t;
  }
  const pg = DBTYPE_PG[dbType]!;
  if (clr === 'System.DBNull') return { oid: pg.oid, value: null };
  const refuse = (): never => {
    throw writingNotSupported(clr, pg.name);
  };
  const v = p.value;
  switch (pg.oid) {
    case 21:
    case 23:
    case 20:
      if (clr === 'System.Byte' || clr === 'System.Int32' || clr === 'System.Int64' || clr === 'System.Decimal' || clr === 'System.Double')
        return { oid: pg.oid, value: toInteger(pg.oid, clr, v) };
      return refuse();
    case 1700:
      if (clr === 'System.Byte' || clr === 'System.Int32' || clr === 'System.Int64' || clr === 'System.Decimal' || clr === 'System.Double')
        return { oid: pg.oid, value: toNumeric(v) };
      return refuse();
    case 701:
    case 700:
      if (clr === 'System.Double') return { oid: pg.oid, value: doubleText(v as number) };
      return refuse();
    case 16:
      if (clr === 'System.Boolean') return { oid: pg.oid, value: v ? 't' : 'f' };
      return refuse();
    case 25:
      if (clr === 'System.String' || clr === 'System.Char') return { oid: pg.oid, value: v as string };
      // A byte[] goes as the bytes of the text
      if (clr === 'System.Byte[]') return { oid: pg.oid, value: Buffer.from(v as Uint8Array) };
      return refuse();
    case 17:
      if (clr === 'System.Byte[]') return { oid: pg.oid, value: Buffer.from(v as Uint8Array) };
      return refuse();
    case 1114:
      if (clr === 'System.DateTime') return { oid: pg.oid, value: timestampBinary(dateTimeMicros(v as RpDateTime)) };
      if (clr === 'System.Int64') return { oid: pg.oid, value: timestampBinary(v as bigint) };
      return refuse();
    case 1184:
      if (clr === 'System.DateTime') {
        const d = v as RpDateTime;
        if (d.kind !== DateTimeKind.Utc)
          throw argumentException(
            `Cannot write DateTime with Kind=${DateTimeKind[d.kind]} to PostgreSQL type 'timestamp with time zone', only UTC is supported. ` +
              "Note that it's not possible to mix DateTimes with different Kinds in an array, range, or multirange. (Parameter 'value')",
          );
        return { oid: pg.oid, value: timestampBinary(dateTimeMicros(d)) };
      }
      if (clr === 'System.Int64') return { oid: pg.oid, value: timestampBinary(v as bigint) };
      return refuse();
    case 1082:
    case 1083: {
      // DateOnly / TimeOnly of a master column given to a parameter without DbType
      const d = v as RpDateTime;
      if (pg.oid === 1082 && clr === 'System.DateOnly')
        return { oid: pg.oid, value: `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` };
      if (pg.oid === 1083 && clr === 'System.TimeOnly') {
        const us = (d.ticks % 864_000_000_000n) / 10n;
        return { oid: pg.oid, value: `${us / 3_600_000_000n}:${(us / 60_000_000n) % 60n}:${(us / 1_000_000n) % 60n}.${String(us % 1_000_000n).padStart(6, '0')}` };
      }
      return refuse();
    }
  }
  return refuse();
}
