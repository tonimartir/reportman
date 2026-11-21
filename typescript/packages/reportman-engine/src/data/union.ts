// Port of the unions of datasets of Reportman.Reporting.DataInfo (BuildUnion and its helpers): a
// dataset of the MyBase connection made of other datasets of the report (DataUnions), as the
// Delphi engine builds it (TRpDataInfoItem.Connect, CombineAddDataset, CombineParallel). The
// DataTables of C# are UnionTable here: columns with their .NET types, rows of stored values.
//
// Texts are ordered and matched as a DataView without case sensitivity orders them in C#:
// CompareInfo.Compare(a, b, IgnoreCase | IgnoreKanaType | IgnoreWidth) under the culture of the
// run. .NET 5+ compares with ICU (on Windows too) and gives IgnoreCase the secondary strength,
// with no custom rules when kana type and width are ignored as well: that is an ICU collator of
// the culture with sensitivity 'accent', what Intl.Collator gives. Known limits: the ICU version
// of Node and the one .NET loads may differ (new characters, CLDR changes of a locale); V8 turns
// on the normalization of its collators and .NET does not, so texts with unusual sequences of
// combining marks (not in FCD form) may compare differently. The in-memory datasets of the Delphi
// engine compare texts with the functions of Windows (NLS), not ICU: around punctuation the
// order of Delphi may differ from the order of C#, which this port follows.

import { collatorFor, toUpperNet } from '../util/chars.js';
import type { CultureInfo } from '../util/culture.js';
import { formatDateTime } from '../util/dateformat.js';
import { RpDateTime } from '../util/datetime.js';
import { CsDecimal } from '../util/decimal.js';
import { tryParseDateTime } from '../util/dateparse.js';
import { argumentException, formatException, NamedException, NetException, NetMessages, overflowException } from '../util/netexception.js';
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
  tryParseInt32,
  tryParseInt64,
} from '../util/numberparse.js';
import { type DataColumn, storedDouble, storeValue, type StoredValue } from './columns.js';
import { duplicateNameException } from './errors.js';
import type { DataColumnType, DataValue } from './host.js';
import { ResultView } from './reportdataset.js';

/** A DataTable of a union: its columns and its rows. */
export interface UnionTable {
  readonly columns: DataColumn[];
  readonly rows: StoredValue[][];
}

/** The cultures and the clock the values of a union are converted and compared with. */
export interface UnionContext {
  /** CultureInfo.CurrentCulture while the union is built (also the Locale of its DataTables). */
  readonly culture: CultureInfo;
  readonly invariant: CultureInfo;
  /** The date of a text with a time only (DateTime.Parse). */
  readonly now: RpDateTime;
}

/** The .NET type of a boxed value (a column type but Object). */
type NetType = Exclude<DataColumnType, 'Object'>;

/** A value of a row as the boxed object C# handles: its .NET type and its value; null is DBNull. */
interface Boxed {
  readonly type: NetType;
  readonly value: Exclude<StoredValue, null>;
}

const NET_NAMES: Record<NetType, string> = {
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
};

const collators = new Map<string, Intl.Collator>();

/** The comparer of texts of a culture: IgnoreCase | IgnoreKanaType | IgnoreWidth (see above). */
export function unionCollator(culture: CultureInfo): Intl.Collator {
  let c = collators.get(culture.name);
  if (c === undefined) {
    c = collatorFor(culture.name, { usage: 'sort', sensitivity: 'accent' });
    collators.set(culture.name, c);
  }
  return c;
}

/** Strings.FromSemiColon: the parts between semicolons, empty ones too ("" gives one part). */
export function fromSemiColon(text: string): string[] {
  return text.split(';');
}

/** Strings.RemoveBlanks. */
export function removeBlanks(list: readonly string[]): string[] {
  return list.filter((s) => s.length > 0);
}

/** DataTable.Clone: the columns, no rows. */
export function cloneTable(table: UnionTable): UnionTable {
  return { columns: table.columns.map((c) => ({ name: c.name, type: c.type, maxLength: -1 })), rows: [] };
}

/**
 * DataColumnCollection.IndexOf: the column with that name, else the only one with that name
 * without regard to case (-1 when there is none, or more than one).
 */
export function indexOfColumn(table: UnionTable, name: string): number {
  if (name.length === 0) return -1;
  const cols = table.columns;
  for (let i = 0; i < cols.length; i++) if (cols[i]!.name === name) return i;
  const upper = toUpperNet(name);
  let found = -1;
  for (let i = 0; i < cols.length; i++) {
    if (toUpperNet(cols[i]!.name) === upper) {
      if (found >= 0) return -1;
      found = i;
    }
  }
  return found;
}

/** DataColumnCollection.Add(name, type): its ordinal; a name already there fails. */
function addColumn(table: UnionTable, name: string, type: DataColumnType): number {
  if (table.columns.some((c) => c.name === name)) throw duplicateNameException(name);
  table.columns.push({ name, type, maxLength: -1 });
  return table.columns.length - 1;
}

/** DataRow[i] of a column index that is not in the table. */
function columnOutOfRange(index: number): NetException {
  return new NetException('IndexOutOfRangeException', `Cannot find column ${index}.`);
}

/** The boxed value of a cell: Object columns keep values of any type, known by their JavaScript type. */
function boxedOf(column: DataColumn, value: StoredValue): Boxed | null {
  if (value === null) return null;
  if (column.type !== 'Object') return { type: column.type, value };
  switch (typeof value) {
    case 'string':
      return { type: 'String', value };
    case 'bigint':
      return { type: 'Int64', value };
    case 'boolean':
      return { type: 'Boolean', value };
    case 'number':
      return { type: Number.isInteger(value) && Math.abs(value) <= 2147483647 ? 'Int32' : 'Double', value };
  }
  if (value instanceof Uint8Array) return { type: 'Binary', value };
  if (value instanceof CsDecimal) return { type: 'Decimal', value };
  return { type: 'DateTime', value };
}

/** row[i] of a table, boxed (a column that is not there fails as DataRow[i]). */
function cell(table: UnionTable, row: readonly StoredValue[], index: number): Boxed | null {
  if (index < 0 || index >= table.columns.length) throw columnOutOfRange(index);
  return boxedOf(table.columns[index]!, row[index] ?? null);
}

function isInteger(t: NetType): boolean {
  return t === 'Int64' || t === 'Int32' || t === 'Int16' || t === 'Byte';
}

function isFloat(t: NetType): boolean {
  return t === 'Double' || t === 'Single';
}

/** IsUnionNumber: the integer types, float, double and decimal (not bool). */
function isNumber(t: NetType): boolean {
  return isInteger(t) || isFloat(t) || t === 'Decimal';
}

/** A value that is not IConvertible (byte[]) given to Convert.ToXxx(object). */
function notConvertible(): NetException {
  return new NetException('InvalidCastException', "Unable to cast object of type 'System.Byte[]' to type 'System.IConvertible'.");
}

function invalidCast(from: NetType, to: string): NetException {
  return new NetException('InvalidCastException', NetMessages.invalidCast(NET_NAMES[from], to));
}

/** Convert.ToString(value, InvariantCulture). */
function invariantText(v: Boxed, ctx: UnionContext): string {
  switch (v.type) {
    case 'String':
      return v.value as string;
    case 'Int64':
    case 'Int32':
    case 'Int16':
    case 'Byte':
      return String(v.value);
    case 'Double':
    case 'Single':
      // A Single prints as the double it is stored as (the engine keeps floats as doubles)
      return formatDouble(v.value as number, '', ctx.invariant.number);
    case 'Decimal':
      return formatDecimal(v.value as CsDecimal, '', ctx.invariant.number);
    case 'Boolean':
      return v.value ? 'True' : 'False';
    case 'DateTime':
      return formatDateTime(v.value as RpDateTime, '', ctx.invariant);
    case 'Binary':
      return 'System.Byte[]';
  }
}

/** IConvertible.ToInt64(InvariantCulture). */
function toInt64(v: Boxed, ctx: UnionContext): bigint {
  switch (v.type) {
    case 'Int64':
      return v.value as bigint;
    case 'Int32':
    case 'Int16':
    case 'Byte':
      return BigInt(v.value as number);
    case 'Double':
    case 'Single':
      return convertDoubleToInt64(v.value as number);
    case 'Decimal':
      return convertDecimalToInt64(v.value as CsDecimal);
    case 'Boolean':
      return v.value ? 1n : 0n;
    case 'String': {
      const r = tryParseInt64(v.value as string, NumberStyles.Integer, ctx.invariant.number);
      if (r === undefined) throw formatException(NetMessages.parseFailed(v.value as string));
      return r;
    }
    case 'DateTime':
      throw invalidCast('DateTime', 'Int64');
    case 'Binary':
      throw notConvertible();
  }
}

/** IConvertible.ToInt32 / ToInt16 / ToByte(InvariantCulture). */
function toSmallInteger(v: Boxed, ctx: UnionContext, to: 'Int32' | 'Int16' | 'Byte'): number {
  let r: number;
  switch (v.type) {
    case 'Int64': {
      const b = v.value as bigint;
      if (b < -2147483648n || b > 2147483647n) throw overflowException(overflowMessage(to));
      r = Number(b);
      break;
    }
    case 'Int32':
    case 'Int16':
    case 'Byte':
      r = v.value as number;
      break;
    case 'Double':
    case 'Single':
      // Convert.ToInt16(double) is ToInt16(ToInt32(value)): out of the Int32 range it fails as Int32
      r = convertDoubleToInt32(v.value as number);
      break;
    case 'Decimal':
      r = convertDecimalToInt32(v.value as CsDecimal);
      break;
    case 'Boolean':
      r = v.value ? 1 : 0;
      break;
    case 'String': {
      const p = tryParseInt32(v.value as string, NumberStyles.Integer, ctx.invariant.number);
      if (p === undefined) throw formatException(NetMessages.parseFailed(v.value as string));
      r = p;
      break;
    }
    case 'DateTime':
      throw invalidCast('DateTime', to);
    case 'Binary':
      throw notConvertible();
  }
  const [min, max] = to === 'Int32' ? [-2147483648, 2147483647] : to === 'Int16' ? [-32768, 32767] : [0, 255];
  if (r < min || r > max) throw overflowException(overflowMessage(to));
  return r;
}

function overflowMessage(to: 'Int32' | 'Int16' | 'Byte'): string {
  if (to === 'Int32') return NetMessages.overflowInt32;
  if (to === 'Byte') return NetMessages.overflowByte;
  return 'Value was either too large or too small for an Int16.';
}

/** IConvertible.ToDouble(InvariantCulture). */
function toDouble(v: Boxed, ctx: UnionContext): number {
  switch (v.type) {
    case 'Int64':
      return Number(v.value as bigint);
    case 'Int32':
    case 'Int16':
    case 'Byte':
    case 'Double':
    case 'Single':
      return v.value as number;
    case 'Decimal':
      return (v.value as CsDecimal).toDouble();
    case 'Boolean':
      return v.value ? 1 : 0;
    case 'String':
      return parseDouble(v.value as string, NumberStyles.Float | NumberStyles.AllowThousands, ctx.invariant.number);
    case 'DateTime':
      throw invalidCast('DateTime', 'Double');
    case 'Binary':
      throw notConvertible();
  }
}

/** IConvertible.ToDecimal(InvariantCulture). */
function toDecimal(v: Boxed, ctx: UnionContext): CsDecimal {
  switch (v.type) {
    case 'Int64':
    case 'Int32':
    case 'Int16':
    case 'Byte':
      return CsDecimal.fromInteger(v.value as number | bigint);
    case 'Double':
      return CsDecimal.fromDouble(v.value as number);
    case 'Single':
      // Convert.ToDecimal(float) keeps the 7 significant digits of a float
      return CsDecimal.fromDouble(Number((v.value as number).toPrecision(7)));
    case 'Decimal':
      return v.value as CsDecimal;
    case 'Boolean':
      return v.value ? CsDecimal.one : CsDecimal.zero;
    case 'String':
      return parseDecimal(v.value as string, NumberStyles.Number, ctx.invariant.number);
    case 'DateTime':
      throw invalidCast('DateTime', 'Decimal');
    case 'Binary':
      throw notConvertible();
  }
}

/**
 * ConvertUnionValue: a value converted to the type of the column it goes to (as a Variant
 * assigned to a field of the Delphi engine is): the value itself when it is of that type,
 * Convert.ToString(value, InvariantCulture) for a text column, otherwise
 * Convert.ChangeType(value, type, InvariantCulture). The value goes into a row of a union, so it
 * is the value the DataTable gives back (a double -0.0 is 0.0).
 */
export function convertUnionValue(v: Boxed | null, type: DataColumnType, ctx: UnionContext): StoredValue {
  const r = changeType(v, type, ctx);
  return (type === 'Double' || type === 'Single') && typeof r === 'number' ? storedDouble(r) : r;
}

function changeType(v: Boxed | null, type: DataColumnType, ctx: UnionContext): StoredValue {
  if (v === null) return null;
  if (type === 'Object' || v.type === type) return v.value;
  if (type === 'String') return invariantText(v, ctx);
  // Convert.ChangeType of a value that is not IConvertible
  if (v.type === 'Binary') throw new NetException('InvalidCastException', 'Object must implement IConvertible.');
  switch (type) {
    case 'Int64':
      return toInt64(v, ctx);
    case 'Int32':
    case 'Int16':
    case 'Byte':
      return toSmallInteger(v, ctx, type);
    case 'Double':
      return toDouble(v, ctx);
    case 'Single':
      return Math.fround(toDouble(v, ctx));
    case 'Decimal':
      return toDecimal(v, ctx);
    case 'Boolean':
      switch (v.type) {
        case 'String': {
          const b = tryParseBoolean(v.value as string);
          if (b === undefined) throw formatException(`String '${v.value as string}' was not recognized as a valid Boolean.`);
          return b;
        }
        case 'Decimal':
          return !(v.value as CsDecimal).isZero;
        case 'Int64':
          return (v.value as bigint) !== 0n;
        case 'DateTime':
          throw invalidCast('DateTime', 'Boolean');
        default:
          return (v.value as number) !== 0;
      }
    case 'DateTime':
      if (v.type === 'String') {
        const d = tryParseDateTime(v.value as string, ctx.invariant, ctx.now);
        if (d === undefined) throw formatException(`String '${v.value as string}' was not recognized as a valid DateTime.`);
        return d;
      }
      throw invalidCast(v.type, 'DateTime');
    case 'Binary':
      throw new NetException(
        'InvalidCastException',
        NetMessages.invalidCast('System.' + NET_NAMES[v.type], 'System.Byte[]'),
      );
  }
}

/**
 * AddUnionValues: the sum of two values of a grouped union (the + of two Variants of the Delphi
 * engine): texts are joined, a date moves by a number of days, numbers are added.
 */
function addUnionValues(a: Boxed, b: Boxed, ctx: UnionContext): Boxed {
  // Convert.ToDouble(object) etc.: a byte[] is not IConvertible
  const plain = (v: Boxed): Boxed => {
    if (v.type === 'Binary') throw notConvertible();
    return v;
  };
  if (a.type === 'String' || b.type === 'String') {
    if (a.type === 'String' && b.type === 'String') return { type: 'String', value: (a.value as string) + (b.value as string) };
    return { type: 'Double', value: toDouble(plain(a), ctx) + toDouble(plain(b), ctx) };
  }
  // Two dates fail: Convert.ToDouble(DateTime) is an invalid cast
  if (a.type === 'DateTime')
    return { type: 'DateTime', value: RpDateTime.fromOADate((a.value as RpDateTime).toOADate() + toDouble(plain(b), ctx)) };
  if (b.type === 'DateTime') return { type: 'DateTime', value: RpDateTime.fromOADate(toDouble(plain(a), ctx) + (b.value as RpDateTime).toOADate()) };
  if (isFloat(a.type) || isFloat(b.type)) return { type: 'Double', value: toDouble(plain(a), ctx) + toDouble(plain(b), ctx) };
  if (a.type === 'Decimal' || b.type === 'Decimal') {
    const sum = toDecimal(plain(a), ctx).add(toDecimal(plain(b), ctx));
    return { type: 'Decimal', value: sum };
  }
  // C# parity: long addition without overflow checking
  return { type: 'Int64', value: BigInt.asIntN(64, toInt64(plain(a), ctx) + toInt64(plain(b), ctx)) };
}

/** double.CompareTo: NaN first. */
function compareDouble(a: number, b: number): number {
  if (a < b) return -1;
  if (a > b) return 1;
  if (a === b) return 0;
  if (Number.isNaN(a)) return Number.isNaN(b) ? 0 : -1;
  return 1;
}

/** string.CompareOrdinal (its sign). */
function compareOrdinal(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a.charCodeAt(i) - b.charCodeAt(i);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

function compareText(collator: Intl.Collator, a: string, b: string): number {
  if (a === b) return 0;
  const r = collator.compare(a, b);
  return r < 0 ? -1 : r > 0 ? 1 : 0;
}

/**
 * CompareUnionValues: the order of two values of an index of a union: nulls first, numbers by
 * value, texts by the culture without regard to case, dates by time, and other values by their
 * invariant text.
 */
function compareUnionValues(a: Boxed | null, b: Boxed | null, ctx: UnionContext): number {
  if (a === null || b === null) return a === null && b === null ? 0 : a === null ? -1 : 1;
  if (isNumber(a.type) && isNumber(b.type)) {
    if (isFloat(a.type) || isFloat(b.type)) return compareDouble(toDouble(a, ctx), toDouble(b, ctx));
    if (a.type !== 'Decimal' && b.type !== 'Decimal') {
      const x = toInt64(a, ctx);
      const y = toInt64(b, ctx);
      return x < y ? -1 : x > y ? 1 : 0;
    }
    return toDecimal(a, ctx).compareTo(toDecimal(b, ctx));
  }
  if (a.type === 'String' && b.type === 'String') return compareText(unionCollator(ctx.culture), a.value as string, b.value as string);
  if (a.type === b.type) {
    // IComparable of the same type (byte[] is not)
    if (a.type === 'DateTime') return (a.value as RpDateTime).compareTo(b.value as RpDateTime);
    if (a.type === 'Boolean') return a.value === b.value ? 0 : a.value ? 1 : -1;
  }
  return compareOrdinal(invariantText(a, ctx), invariantText(b, ctx));
}

function unionValuesEqual(a: Boxed | null, b: Boxed | null, ctx: UnionContext): boolean {
  return compareUnionValues(a, b, ctx) === 0;
}

/**
 * OrderedRows: the rows of a table in the order of an index on some of its columns (the rows with
 * the same values keep their order), the order a TClientDataSet with IndexFieldNames goes through
 * them. firstColumn (-1: none) goes before the others.
 */
function orderedRowsBy(table: UnionTable, firstColumn: number, columns: readonly number[], ctx: UnionContext): StoredValue[][] {
  const rows = [...table.rows];
  if (firstColumn < 0 && columns.length === 0) return rows;
  const keys = firstColumn >= 0 ? [firstColumn, ...columns] : [...columns];
  // Array.prototype.sort is stable: the position breaks the ties, as in C#
  rows.sort((a, b) => {
    for (const key of keys) {
      const r = compareUnionValues(cell(table, a, key), cell(table, b, key), ctx);
      if (r !== 0) return r;
    }
    return 0;
  });
  return rows;
}

/** OrderedRows by the names of the index fields. */
export function orderedRows(table: UnionTable, indexFields: readonly string[], ctx: UnionContext): StoredValue[][] {
  const columns: number[] = [];
  for (const field of indexFields) {
    const column = indexOfColumn(table, field);
    if (column < 0) throw new NamedException("Field '" + field + "' not found in the union", field);
    columns.push(column);
  }
  return orderedRowsBy(table, -1, columns, ctx);
}

/**
 * ExtractUnionFields: the dataset alias of a union entry, "ALIAS" or "ALIAS-FIELD1;FIELD2", and
 * its common fields in upper case (the first '-' ends the alias).
 */
export function extractUnionFields(entry: string): { alias: string; commonFields: string[] } {
  const index = entry.indexOf('-');
  if (index < 0) return { alias: entry, commonFields: [] };
  return { alias: entry.substring(0, index), commonFields: fromSemiColon(entry.substring(index + 1)).map(toUpperNet) };
}

/**
 * CombineAddDataset: adds the rows of a dataset to the result of a union. The result takes the
 * columns of the first one, and the values of each row fill its columns by position. With
 * grouping, a row whose index fields (by position) have the values of a row already there adds
 * its other values to it (numbers are added, texts joined) instead.
 */
export function combineAddDataset(
  client: UnionTable | null,
  data: UnionTable,
  group: boolean,
  indexFields: readonly string[],
  alias: string,
  fewerFieldsText: string,
  ctx: UnionContext,
): UnionTable {
  const result = client ?? cloneTable(data);
  if (data.columns.length > result.columns.length) throw new NamedException(fewerFieldsText + ' - ' + alias, alias);
  let keyColumns: number[] = [];
  if (group) {
    if (indexFields.length === 0) throw new NamedException('A grouped union needs the index fields (MyBaseIndexFields) of ' + alias, alias);
    keyColumns = indexFields.map((field) => {
      const k = indexOfColumn(result, field);
      if (k < 0) throw new NamedException("Field '" + field + "' not found in " + alias, alias);
      return k;
    });
  }
  const columns = result.columns;
  for (const row of data.rows) {
    let target: StoredValue[] | null = null;
    if (group) {
      for (const existing of result.rows) {
        let same = true;
        for (const k of keyColumns) {
          const key = convertUnionValue(cell(data, row, k), columns[k]!.type, ctx);
          if (!unionValuesEqual(cell(result, existing, k), boxedOf(columns[k]!, key), ctx)) {
            same = false;
            break;
          }
        }
        if (same) {
          target = existing;
          break;
        }
      }
    }
    if (target !== null) {
      for (let i = 0; i < data.columns.length; i++) {
        const value = cell(data, row, i);
        if (keyColumns.includes(i) || value === null) continue;
        const current = cell(result, target, i);
        if (current === null) target[i] = convertUnionValue(value, columns[i]!.type, ctx);
        else target[i] = convertUnionValue(addUnionValues(current, value, ctx), columns[i]!.type, ctx);
      }
    } else {
      const newRow = new Array<StoredValue>(columns.length).fill(null);
      for (let i = 0; i < data.columns.length; i++) newRow[i] = convertUnionValue(cell(data, row, i), columns[i]!.type, ctx);
      result.rows.push(newRow);
    }
  }
  return result;
}

/**
 * CombineParallel: a parallel union. The columns of the first dataset, an integer column named as
 * the prefix (0 for the rows only the first one has, 1 for the rows the second one reaches), and
 * the columns of the second one with the prefix but its common fields. With common fields each
 * row of the second dataset fills the first row of the first one with the same values that it
 * has not filled yet, or a new row; the result is ordered by the prefix column and then by the
 * common fields. Without them the rows are paired by position.
 */
export function combineParallel(
  data1: UnionTable,
  rows1: readonly (readonly StoredValue[])[],
  data2: UnionTable,
  prefix: string,
  commonFields: readonly string[],
  originalFields: readonly string[],
  ctx: UnionContext,
): UnionTable {
  const result = cloneTable(data1);
  const prefixColumn = addColumn(result, prefix, 'Int32');
  const targets: number[] = [];
  for (const column of data2.columns) {
    const name = column.name;
    if (!commonFields.includes(toUpperNet(name))) targets.push(addColumn(result, prefix + name, column.type));
    else {
      const target = indexOfColumn(result, name);
      if (target < 0) throw new NamedException("Field '" + name + "' not found in the first dataset of the union", name);
      targets.push(target);
    }
  }
  const keyColumns: number[] = [];
  const keySources: number[] = [];
  for (let k = 0; k < originalFields.length; k++) {
    const column = indexOfColumn(result, originalFields[k]!);
    if (column < 0) throw new NamedException("Field '" + originalFields[k]! + "' not found in the union", originalFields[k]!);
    keyColumns.push(column);
    // BuildUnion has checked that there are as many common fields as original ones
    const common = commonFields[k]!;
    const source = indexOfColumn(data2, common);
    if (source < 0) throw new NamedException("Field '" + common + "' not found in the dataset of the union", common);
    keySources.push(source);
  }
  const width = result.columns.length;
  for (const row of rows1) {
    const newRow = new Array<StoredValue>(width).fill(null);
    for (let i = 0; i < data1.columns.length; i++) newRow[i] = row[i] ?? null;
    newRow[prefixColumn] = 0;
    result.rows.push(newRow);
  }
  let position = 0;
  for (const row of data2.rows) {
    let target: StoredValue[] | null = null;
    if (keyColumns.length > 0) {
      // C# goes through the rows ordered by the prefix column and the keys and takes the first
      // one not filled whose keys are equal: in a stable order that is the first such row of the
      // table, so the rows are not sorted for each one
      for (const candidate of result.rows) {
        if (candidate[prefixColumn] !== 0) continue;
        let same = true;
        for (let k = 0; k < keyColumns.length; k++) {
          const column = result.columns[keyColumns[k]!]!;
          const key = convertUnionValue(cell(data2, row, keySources[k]!), column.type, ctx);
          if (!unionValuesEqual(cell(result, candidate, keyColumns[k]!), boxedOf(column, key), ctx)) {
            same = false;
            break;
          }
        }
        if (same) {
          target = candidate;
          break;
        }
      }
    } else if (position < result.rows.length) target = result.rows[position]!;
    if (target === null) {
      target = new Array<StoredValue>(width).fill(null);
      result.rows.push(target);
    }
    for (let i = 0; i < data2.columns.length; i++)
      target[targets[i]!] = convertUnionValue(cell(data2, row, i), result.columns[targets[i]!]!.type, ctx);
    target[prefixColumn] = 1;
    position++;
  }
  if (keyColumns.length === 0) return result;
  return { columns: result.columns, rows: orderedRowsBy(result, prefixColumn, keyColumns, ctx) };
}

// ---------------------------------------------------------------------------------------------
// The DataView of a union

/** DataTable.Compare of two texts: trailing spaces (and ideographic spaces) do not count. */
function trimEndSpaces(s: string): string {
  let n = s.length;
  while (n > 0 && (s.charCodeAt(n - 1) === 0x20 || s.charCodeAt(n - 1) === 0x3000)) n--;
  return n === s.length ? s : s.substring(0, n);
}

/** The order of two values of a column as the DataView index compares them (DBNull first). */
function viewCompare(column: DataColumn, a: StoredValue, b: StoredValue, ctx: UnionContext): number {
  if (a === null || b === null) return a === null && b === null ? 0 : a === null ? -1 : 1;
  switch (column.type) {
    case 'String':
      return compareText(unionCollator(ctx.culture), trimEndSpaces(a as string), trimEndSpaces(b as string));
    case 'Binary': {
      // ObjectStorage.CompareWithFamilies of two arrays: the length, then element by element
      const x = a as Uint8Array;
      const y = b as Uint8Array;
      if (x.length !== y.length) return x.length < y.length ? -1 : 1;
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
      return 0;
    }
    default:
      return compareUnionValues(boxedOf(column, a), boxedOf(column, b), ctx);
  }
}

/** A column of the sort of a DataView. */
interface SortField {
  readonly column: number;
  readonly descending: boolean;
}

/** DataTable.ParseSortString: the columns of a sort ("A,B DESC"); a name that is not a column fails. */
function parseSortString(table: UnionTable, sort: string): SortField[] {
  const fields: SortField[] = [];
  if (sort.length === 0) return fields;
  for (const part of sort.split(',')) {
    let current = part.trim();
    const upper = current.toUpperCase();
    let descending = false;
    if (current.length >= 5 && upper.endsWith(' ASC')) current = current.substring(0, current.length - 4).trim();
    else if (current.length >= 6 && upper.endsWith(' DESC')) {
      descending = true;
      current = current.substring(0, current.length - 5).trim();
    }
    if (current.startsWith('[')) {
      if (current.endsWith(']')) current = current.substring(1, current.length - 1);
      else throw argumentException(`${part} isn't a valid Sort string entry.`);
    }
    const column = indexOfColumn(table, current);
    if (column < 0) throw new NetException('IndexOutOfRangeException', `Cannot find column ${current}.`);
    fields.push({ column, descending });
  }
  return fields;
}

/**
 * The DataView of a union: the rows of its table sorted by the columns of its sort (the rows with
 * the same values in the order of the table), and FindRows on them.
 */
export class UnionView extends ResultView {
  private readonly sort: readonly SortField[];
  private readonly ctx: UnionContext;

  constructor(table: UnionTable, sort: string, ctx: UnionContext) {
    const fields = parseSortString(table, sort);
    const rows = [...table.rows];
    if (fields.length > 0)
      rows.sort((a, b) => {
        for (const f of fields) {
          const r = viewCompare(table.columns[f.column]!, a[f.column] ?? null, b[f.column] ?? null, ctx);
          if (r !== 0) return f.descending ? -r : r;
        }
        return 0;
      });
    super(table.columns, rows);
    this.sort = fields;
    this.ctx = ctx;
  }

  /**
   * DataView.FindRows: the rows whose sort columns have the values of the key, each value
   * converted to the type of its column first.
   */
  override findRows(key: readonly DataValue[]): readonly (readonly StoredValue[])[] {
    const n = this.sort.length;
    if (n === 0) return super.findRows(key);
    if (key.length === 0 || key.length !== n)
      throw argumentException(`Expecting ${n} value(s) for the key being indexed, but received ${key.length} value(s).`);
    if (this.rows.length === 0) return [];
    const ctx = this.ctx;
    // DataColumn.ConvertValue: the key in the type of its column (the culture of the table)
    const values = this.sort.map((f, i) => storeValue(this.columns[f.column]!, key[i], ctx.culture, ctx.culture));
    // The rows with equal keys are together in the view, in the order of the table
    return this.rows.filter((row) =>
      this.sort.every((f, i) => viewCompare(this.columns[f.column]!, row[f.column] ?? null, values[i]!, ctx) === 0),
    );
  }
}
