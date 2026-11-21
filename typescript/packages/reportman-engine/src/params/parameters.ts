// Port of Reportman.Designer.Server.ReportParameters: the parameters of a report for a form that
// is not Report Manager's. Step one describes them (the default of an initial expression already
// evaluated, the options of a lookup dataset already read); step two applies the posted values the
// way the engine expects them and runs the report's own validations. What the form should not have
// sent is refused: a value for a parameter the user does not see or may not change, a list value
// that is not one of its options, and, for whoever only runs reports, a new value for a parameter
// whose value goes into the SQL as text or is evaluated as an expression.

import { CsDecimal } from '../util/decimal.js';
import { CultureInfo } from '../util/culture.js';
import { RpDateTime } from '../util/datetime.js';
import { formatDateTime } from '../util/dateformat.js';
import { formatDecimal, formatDouble } from '../util/numberformat.js';
import { NumberStyles, tryParseBoolean, tryParseDecimal, tryParseInt64 } from '../util/numberparse.js';
import { ParamType, Variant, VariantType } from '../variant/variant.js';
import { type Op } from '../data/op.js';
import type { ReportRuntime } from '../report/report.js';
import type { ReportParam } from './param.js';

/** One option of a list or multiple-selection parameter: what is shown and what is assigned. */
export interface ParameterOption {
  text: string;
  value: string;
}

/** A default value as the form reads it: null, a string, a number (bigint beyond 2^53) or a boolean. */
export type ParameterJsonValue = null | string | number | bigint | boolean;

/**
 * A parameter as a form outside Report Manager shows it (ParameterDescription): only the
 * parameters the user sees (Visible and not NeverVisible), in the report's order.
 */
export interface ParameterDescription {
  /** The parameter's alias: the name it has in the SQL and in expressions, and the key to post back. */
  name: string;
  /** The engine's ParamType number. */
  type: number;
  typeName: string;
  description: string;
  hint: string;
  /** The message to show when its validation fails. */
  errorMessage: string;
  /**
   * The default: dates as ISO text (yyyy-MM-dd, HH:mm:ss or yyyy-MM-ddTHH:mm:ss, by type); a list,
   * the value of its option. A currency value is a number here and keeps its scale in valueJson.
   */
  value: ParameterJsonValue;
  /** The value as .NET writes it in JSON ("12.50" for a currency 12.50). */
  valueJson: string;
  allowNulls: boolean;
  readOnly: boolean;
  /** Its value goes into the SQL as text or is evaluated as an expression. */
  freeText: boolean;
  /** Whether the caller may change it: not read-only, and not free text unless they design. */
  editable: boolean;
  /** The options of a list or multiple-selection parameter, a lookup dataset's rows already in. */
  options: ParameterOption[];
  /** The selected values of a multiple-selection parameter (all of them when the report keeps none). */
  selected: string[];
  /** It has a search dataset (Report Manager's button). Not offered yet: shown for information. */
  hasSearch: boolean;
}

/** Why a posted parameter value was refused. */
export enum ParameterProblem {
  /** No visible parameter has that name. */
  Unknown,
  /** Read-only, or free text for a caller who does not design. */
  NotEditable,
  /** Empty and the parameter does not allow it. */
  Required,
  /** The value is not of the parameter's type. */
  WrongType,
  /** The value is not one of the list's options. */
  NotAnOption,
  /** The report's own validation said no: the message is the report's. */
  Validation,
}

/** A posted parameter value was refused. The message is in English (or the report's, for a validation). */
export class ParameterException extends Error {
  readonly parameter: string;
  readonly problem: ParameterProblem;

  constructor(parameter: string, problem: ParameterProblem, message: string) {
    super(message);
    this.name = 'ParameterException';
    this.parameter = parameter;
    this.problem = problem;
  }
}

/**
 * A posted value (a JSON value): null, a string, a number (a bigint for integers beyond 2^53), a
 * boolean, or an array of them for a multiple selection.
 */
export type ParameterInput = null | undefined | string | number | bigint | boolean | readonly ParameterInput[];

function isFreeText(type: ParamType): boolean {
  return type === ParamType.Subst || type === ParamType.SubstExpre || type === ParamType.ExpreA || type === ParamType.ExpreB;
}

function hasOptions(type: ParamType): boolean {
  return type === ParamType.List || type === ParamType.SubsExpreList || type === ParamType.Multiple;
}

const INVARIANT = CultureInfo.invariant;

/** The options from the lookup dataset, and «all» for a multiple selection that keeps none. */
function* prepareOptions(p: ReportParam): Op<void> {
  if (!hasOptions(p.paramType)) return;
  if (p.lookupDataset.length > 0) yield* p.updateLookupValues();
  if (p.paramType === ParamType.Multiple && p.selected.length === 0) p.selectAllValues();
}

/** ToJsonValue: a parameter's value as the form reads it, and as .NET writes it in JSON. */
function toJsonValue(value: Variant, type: ParamType, rp: ReportRuntime): { value: ParameterJsonValue; json: string } {
  const ctx = rp.evaluator.context;
  if (value.isNull) return { value: null, json: 'null' };
  switch (value.varType) {
    case VariantType.Boolean: {
      const b = value.toBool(ctx);
      return { value: b, json: b ? 'true' : 'false' };
    }
    case VariantType.Integer:
    case VariantType.Long:
    case VariantType.Byte: {
      const l = value.toLong(ctx);
      const safe = l >= -9007199254740991n && l <= 9007199254740991n;
      return { value: safe ? Number(l) : l, json: l.toString() };
    }
    case VariantType.Double: {
      const d = value.toDouble(ctx);
      return { value: d, json: jsonDouble(d) };
    }
    case VariantType.Decimal: {
      const d = value.toDecimal(ctx);
      return { value: d.toDouble(), json: formatDecimal(d, 'G', INVARIANT.number) };
    }
    case VariantType.DateTime: {
      const date = value.rawValue as RpDateTime;
      const text =
        type === ParamType.Time
          ? formatDateTime(date, 'HH:mm:ss', INVARIANT)
          : type === ParamType.DateTime
            ? formatDateTime(date, 'yyyy-MM-ddTHH:mm:ss', INVARIANT)
            : formatDateTime(date, 'yyyy-MM-dd', INVARIANT);
      return { value: text, json: jsonString(text) };
    }
    default: {
      const s = value.toString(ctx);
      return { value: s, json: jsonString(s) };
    }
  }
}

/** A double as System.Text.Json writes it (shortest round trip; NaN and infinities fail). */
function jsonDouble(d: number): string {
  if (!Number.isFinite(d)) throw new Error('.NET number values such as positive and negative infinity cannot be written as valid JSON.');
  return formatDouble(d, 'R', INVARIANT.number);
}

/** A string as System.Text.Json writes it with its default encoder (JavaScriptEncoder.Default). */
export function jsonString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    switch (c) {
      case 0x08:
        out += '\\b';
        continue;
      case 0x09:
        out += '\\t';
        continue;
      case 0x0a:
        out += '\\n';
        continue;
      case 0x0c:
        out += '\\f';
        continue;
      case 0x0d:
        out += '\\r';
        continue;
      case 0x5c:
        out += '\\\\';
        continue;
    }
    const escape =
      c < 0x20 ||
      c > 0x7e ||
      c === 0x22 || // "
      c === 0x26 || // &
      c === 0x27 || // '
      c === 0x2b || // +
      c === 0x3c || // <
      c === 0x3e || // >
      c === 0x60; // `
    if (escape) out += '\\u' + c.toString(16).toUpperCase().padStart(4, '0');
    else out += s.charAt(i);
  }
  return out + '"';
}

/** Describe: the parameters the user sees, with their defaults and options. */
export function* describeParameters(rp: ReportRuntime, canEditFreeText: boolean): Op<ParameterDescription[]> {
  rp.updateInitialValues();
  const result: ParameterDescription[] = [];
  for (const p of rp.params) {
    if (!p.userVisible) continue;
    yield* prepareOptions(p);
    const freeText = isFreeText(p.paramType);
    let v: { value: ParameterJsonValue; json: string };
    const ctx = rp.evaluator.context;
    if (p.paramType === ParamType.Multiple) v = { value: null, json: 'null' };
    else if (
      (p.paramType === ParamType.List || p.paramType === ParamType.SubsExpreList) &&
      p.value.isInteger() &&
      p.value.toInt(ctx) >= 0 &&
      p.value.toInt(ctx) < p.values.length
    ) {
      const text = p.values[p.value.toInt(ctx)]!;
      v = { value: text, json: jsonString(text) };
    } else v = toJsonValue(p.value, p.paramType, rp);
    const options: ParameterOption[] = [];
    if (hasOptions(p.paramType)) {
      const n = Math.min(p.items.length, p.values.length);
      for (let i = 0; i < n; i++) options.push({ text: p.items[i]!, value: p.values[i]! });
    }
    result.push({
      name: p.alias,
      type: p.paramType,
      typeName: ParamType[p.paramType]!,
      description: p.description,
      hint: p.hint,
      errorMessage: p.errorMessage,
      value: v.value,
      valueJson: v.json,
      allowNulls: p.allowNulls,
      readOnly: p.isReadOnly,
      freeText,
      editable: !p.isReadOnly && (!freeText || canEditFreeText),
      options,
      selected: p.paramType === ParamType.Multiple ? [...p.selected] : [],
      hasSearch: p.searchDataset.length > 0,
    });
  }
  return result;
}

/** The JSON of a description as ASP.NET Core writes it (System.Text.Json, JsonSerializerDefaults.Web). */
export function parameterDescriptionsToJson(list: readonly ParameterDescription[]): string {
  const items = list.map((d) => {
    const fields = [
      '"name":' + jsonString(d.name),
      '"type":' + String(d.type),
      '"typeName":' + jsonString(d.typeName),
      '"description":' + jsonString(d.description),
      '"hint":' + jsonString(d.hint),
      '"errorMessage":' + jsonString(d.errorMessage),
      '"value":' + d.valueJson,
      '"allowNulls":' + String(d.allowNulls),
      '"readOnly":' + String(d.readOnly),
      '"freeText":' + String(d.freeText),
      '"editable":' + String(d.editable),
      '"options":[' + d.options.map((o) => '{"text":' + jsonString(o.text) + ',"value":' + jsonString(o.value) + '}').join(',') + ']',
      '"selected":[' + d.selected.map(jsonString).join(',') + ']',
      '"hasSearch":' + String(d.hasSearch),
    ];
    return '{' + fields.join(',') + '}';
  });
  return '[' + items.join(',') + ']';
}

function wrongType(p: ReportParam, expected: string): ParameterException {
  return new ParameterException(p.alias, ParameterProblem.WrongType, 'The parameter ' + p.alias + ' needs ' + expected + '.');
}

/** JsonElement.GetRawText of a value that is not a string. */
function rawText(value: ParameterInput): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  return JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
}

/** JsonElement.TryGetInt64 of a number. */
function numberToInt64(value: number | bigint): bigint | undefined {
  if (typeof value === 'bigint') return value >= -9223372036854775808n && value <= 9223372036854775807n ? value : undefined;
  if (!Number.isInteger(value)) return undefined;
  return BigInt(value);
}

/** decimal of a JSON number or of a string (NumberStyles.Number, invariant). */
function tryDecimal(value: ParameterInput): CsDecimal | undefined {
  if (typeof value === 'bigint') return CsDecimal.parseInvariant(value.toString());
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    return CsDecimal.parseInvariant(plainNumber(value));
  }
  if (typeof value === 'string') return tryParseDecimal(value, NumberStyles.Number, INVARIANT.number);
  return undefined;
}

/** The digits of a JavaScript number without exponent (the JSON text it was read from). */
function plainNumber(n: number): string {
  const s = String(n);
  if (!/e/i.test(s)) return s;
  return n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 100 });
}

interface ExactParts {
  year?: number;
  month?: number;
  day?: number;
  hour?: number;
  minute?: number;
  second?: number;
}

/** DateTime.TryParseExact with fixed numeric formats (yyyy, MM, dd, HH, mm, ss and literals). */
function tryParseExact(text: string, format: string): ExactParts | undefined {
  const parts: ExactParts = {};
  let i = 0;
  let f = 0;
  while (f < format.length) {
    const spec = format.substring(f, f + 4) === 'yyyy' ? 'yyyy' : format.substring(f, f + 2);
    let key: keyof ExactParts | null = null;
    let len = 0;
    switch (spec) {
      case 'yyyy':
        key = 'year';
        len = 4;
        break;
      case 'MM':
        key = 'month';
        len = 2;
        break;
      case 'dd':
        key = 'day';
        len = 2;
        break;
      case 'HH':
        key = 'hour';
        len = 2;
        break;
      case 'mm':
        key = 'minute';
        len = 2;
        break;
      case 'ss':
        key = 'second';
        len = 2;
        break;
    }
    if (key !== null) {
      const digits = text.substring(i, i + len);
      if (digits.length !== len || !/^\d+$/.test(digits)) return undefined;
      parts[key] = parseInt(digits, 10);
      i += len;
      f += len;
    } else {
      if (text.charAt(i) !== format.charAt(f)) return undefined;
      i++;
      f++;
    }
  }
  if (i !== text.length) return undefined;
  if (parts.month !== undefined && (parts.month < 1 || parts.month > 12)) return undefined;
  if (parts.hour !== undefined && parts.hour > 23) return undefined;
  if (parts.minute !== undefined && parts.minute > 59) return undefined;
  if (parts.second !== undefined && parts.second > 59) return undefined;
  if (parts.year !== undefined && parts.year < 1) return undefined;
  if (parts.day !== undefined && parts.year !== undefined && parts.month !== undefined) {
    const dim = new Date(Date.UTC(2000, parts.month, 0)).getUTCDate();
    const leap = parts.year % 4 === 0 && (parts.year % 100 !== 0 || parts.year % 400 === 0);
    const days = parts.month === 2 ? (leap ? 29 : 28) : dim;
    if (parts.day < 1 || parts.day > days) return undefined;
  }
  return parts;
}

/** TryDate: the first format that parses the string; a time only takes today's date, as .NET. */
function tryDate(value: ParameterInput, formats: readonly string[], rp: ReportRuntime): RpDateTime | undefined {
  if (typeof value !== 'string') return undefined;
  for (const format of formats) {
    const p = tryParseExact(value, format);
    if (p !== undefined) {
      const today = rp.evaluator.host.now();
      return RpDateTime.create(
        p.year ?? today.year,
        p.month ?? today.month,
        p.day ?? today.day,
        p.hour ?? 0,
        p.minute ?? 0,
        p.second ?? 0,
      );
    }
  }
  return undefined;
}

const DATE_1899_12_30 = RpDateTime.create(1899, 12, 30);

function assign(p: ReportParam, value: ParameterInput, rp: ReportRuntime): void {
  if (value === null || value === undefined || (typeof value === 'string' && value.length === 0 && p.paramType !== ParamType.String)) {
    if (!p.allowNulls) throw new ParameterException(p.alias, ParameterProblem.Required, 'The parameter ' + p.alias + ' cannot be empty.');
    if (p.paramType === ParamType.Multiple) p.selected = [];
    else p.value = Variant.null;
    return;
  }
  switch (p.paramType) {
    case ParamType.Multiple: {
      if (!Array.isArray(value)) throw wrongType(p, 'a list of values');
      const chosen: string[] = [];
      for (const item of value as readonly ParameterInput[]) {
        const text = typeof item === 'string' ? item : rawText(item);
        if (p.values.indexOf(text) < 0)
          throw new ParameterException(p.alias, ParameterProblem.NotAnOption, '«' + text + '» is not one of the options of ' + p.alias + '.');
        if (!chosen.includes(text)) chosen.push(text);
      }
      if (chosen.length === 0 && !p.allowNulls)
        throw new ParameterException(p.alias, ParameterProblem.Required, 'Choose at least one option of ' + p.alias + '.');
      p.selected = chosen;
      return;
    }
    case ParamType.List:
    case ParamType.SubsExpreList: {
      const text = typeof value === 'string' ? value : rawText(value);
      if (p.values.indexOf(text) < 0)
        throw new ParameterException(p.alias, ParameterProblem.NotAnOption, '«' + text + '» is not one of the options of ' + p.alias + '.');
      p.value = Variant.fromString(text);
      return;
    }
    case ParamType.Integer: {
      if (typeof value === 'number' || typeof value === 'bigint') {
        const l = numberToInt64(value);
        if (l !== undefined) {
          p.value = Variant.fromLong(l);
          return;
        }
      }
      if (typeof value === 'string') {
        const l = tryParseInt64(value, NumberStyles.Integer, INVARIANT.number);
        if (l !== undefined) {
          p.value = Variant.fromLong(l);
          return;
        }
      }
      throw wrongType(p, 'a whole number');
    }
    case ParamType.Double: {
      const d = tryDecimal(value);
      if (d !== undefined) {
        p.value = Variant.fromDouble(d.toDouble());
        return;
      }
      throw wrongType(p, 'a number');
    }
    case ParamType.Currency: {
      const d = tryDecimal(value);
      if (d !== undefined) {
        p.value = Variant.fromDecimal(d);
        return;
      }
      throw wrongType(p, 'an amount');
    }
    case ParamType.Bool:
      if (typeof value === 'boolean') {
        p.value = Variant.fromBoolean(value);
        return;
      }
      if (typeof value === 'string') {
        const b = tryParseBoolean(value);
        if (b !== undefined) {
          p.value = Variant.fromBoolean(b);
          return;
        }
      }
      throw wrongType(p, 'true or false');
    case ParamType.Date: {
      const date = tryDate(value, ['yyyy-MM-dd'], rp);
      if (date !== undefined) {
        p.value = Variant.fromDateTime(date.date);
        return;
      }
      throw wrongType(p, 'a date (yyyy-MM-dd)');
    }
    case ParamType.Time: {
      const date = tryDate(value, ['HH:mm:ss', 'HH:mm'], rp);
      if (date !== undefined) {
        p.value = Variant.fromDateTime(DATE_1899_12_30.addTicks(BigInt(date.tickOfDay)));
        return;
      }
      throw wrongType(p, 'a time (HH:mm)');
    }
    case ParamType.DateTime: {
      const date = tryDate(value, ['yyyy-MM-ddTHH:mm:ss', 'yyyy-MM-ddTHH:mm', 'yyyy-MM-dd HH:mm:ss', 'yyyy-MM-dd HH:mm', 'yyyy-MM-dd'], rp);
      if (date !== undefined) {
        p.value = Variant.fromDateTime(date);
        return;
      }
      throw wrongType(p, 'a date and time (yyyy-MM-ddTHH:mm)');
    }
    default:
      // String, Unknown and the free-text types: the text as written.
      p.value = Variant.fromString(typeof value === 'string' ? value : rawText(value));
      return;
  }
}

/**
 * Apply: assigns the posted values (by alias, any case) and runs the report's validations.
 * Parameters not posted keep their defaults. Throws ParameterException at the first value refused
 * or validation failed.
 */
export function* applyParameters(
  rp: ReportRuntime,
  values: Readonly<Record<string, ParameterInput>> | null | undefined,
  canEditFreeText: boolean,
): Op<void> {
  rp.updateInitialValues();
  const visible = new Map<string, ReportParam>();
  for (const p of rp.params) {
    if (!p.userVisible) continue;
    visible.set(p.alias.toUpperCase(), p);
    yield* prepareOptions(p);
  }
  for (const [name, value] of Object.entries(values ?? {})) {
    const p = visible.get(name.toUpperCase());
    if (p === undefined)
      throw new ParameterException(name, ParameterProblem.Unknown, 'The report has no parameter ' + name + ' to fill in.');
    if (p.isReadOnly || (isFreeText(p.paramType) && !canEditFreeText))
      throw new ParameterException(p.alias, ParameterProblem.NotEditable, 'The parameter ' + p.alias + ' cannot be changed.');
    assign(p, value, rp);
  }
  const failed = rp.checkParameters();
  if (failed.length > 0) {
    const p = rp.paramByAlias(failed);
    const message = p?.errorMessage;
    throw new ParameterException(
      failed,
      ParameterProblem.Validation,
      message === undefined || message.trim().length === 0 ? 'The value of ' + failed + ' is not valid.' : message,
    );
  }
}

/**
 * ApplyDefaults: the values a parameters form would start from (an initial expression evaluated,
 * a lookup read, «all» in a multiple selection that keeps none), asking nobody anything.
 */
export function* applyDefaults(rp: ReportRuntime): Op<void> {
  rp.updateInitialValues();
  for (const p of rp.params) {
    if (p.userVisible) yield* prepareOptions(p);
    if (p.paramType !== ParamType.ExpreB) p.lastValue = p.listValue;
  }
}
