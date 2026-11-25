import {
  ChangeObjectOperation,
  ChangeOperationItem,
  OperationType,
  PropertyType,
  UndoCue,
} from "../models/undo-cue.js";
import { csDoubleToString, csRoundToEven, csTrim } from "../../util/cs.js";

/**
 * The undo history a .rep keeps in its BINCUE property: the JSON of the engine's UndoCue, read as
 * C# reads it (Newtonsoft.Json, default settings): property names in any case, enums as numbers or
 * names, ISO dates parsed into dates, and the values of the properties as plain JSON values in
 * which every date-like text is a date (Newtonsoft's DateParseHandling.DateTime), so that it is
 * written back in the form C# writes it.
 */
export function readUndoCueJson(text: string): UndoCue | undefined {
  let json = text;
  if (json.charCodeAt(0) === 0xfeff) json = json.substring(1);
  // Newtonsoft returns null for an empty document.
  if (csTrim(json).length === 0) return undefined;
  // Newtonsoft reads 2.0 as a double, written back as 2.0, and 2 as an integer: the JSON text of
  // each number is kept where the runtime gives it (JSON.parse source text access).
  const raw: unknown = parseReportJson(json);
  if (raw === null) return undefined;
  if (!isObject(raw)) throw new Error("The undo history (BINCUE) is not a JSON object");
  const cue = new UndoCue();
  // C# parity: UndoCue.GroupId has a private setter, Newtonsoft does not restore it (it stays 0).
  readOperationList(member(raw, "undoOperations"), cue.undoOperations);
  readOperationList(member(raw, "redoOperations"), cue.redoOperations);
  return cue;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Newtonsoft matches a property case-insensitively; the last occurrence in the document wins. */
function member(obj: Record<string, unknown>, name: string): unknown {
  const key = memberKey(obj, name);
  return key === undefined ? undefined : obj[key];
}

/** The key member() reads. */
function memberKey(obj: Record<string, unknown>, name: string): string | undefined {
  const lower = name.toLowerCase();
  let result: string | undefined = undefined;
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() === lower) result = key;
  }
  return result;
}

function readOperationList(value: unknown, target: ChangeObjectOperation[]): void {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) throw new Error("The undo history (BINCUE) has a list that is not an array");
  for (const item of value) {
    if (!isObject(item)) throw new Error("The undo history (BINCUE) has an operation that is not an object");
    target.push(readOperation(item));
  }
}

function readOperation(raw: Record<string, unknown>): ChangeObjectOperation {
  // C# builds it with its constructor (operation, groupId), which stamps DateTime.Now.
  const op = new ChangeObjectOperation(
    toEnum(member(raw, "operation"), OperationType, 0) as OperationType,
    toInt(member(raw, "groupId"), 0)
  );
  const componentName = toStringValue(member(raw, "componentName"));
  if (componentName !== undefined) op.componentName = componentName;
  const componentClass = toStringValue(member(raw, "componentClass"));
  if (componentClass !== undefined) op.componentClass = componentClass;
  const parentName = toStringValue(member(raw, "parentName"));
  if (parentName !== undefined) op.parentName = parentName;
  const oldItemIndex = member(raw, "oldItemIndex");
  if (oldItemIndex !== undefined && oldItemIndex !== null) op.oldItemIndex = toInt(oldItemIndex, 0);
  const oldParentName = toStringValue(member(raw, "oldParentName"));
  if (oldParentName !== undefined) op.oldParentName = oldParentName;
  const date = member(raw, "date");
  // An explicit null is a null date in C#; this model keeps the constructor's date instead.
  if (date !== undefined && date !== null) op.date = toDate(date);
  rememberOperationDate(op, date);
  const expanded = member(raw, "expandedProperties");
  if (expanded !== undefined && expanded !== null) op.expandedProperties = toBool(expanded);
  const properties = member(raw, "properties");
  if (properties !== undefined && properties !== null) {
    if (!Array.isArray(properties))
      throw new Error("The undo history (BINCUE) has properties that are not an array");
    for (const p of properties) {
      if (!isObject(p)) throw new Error("The undo history (BINCUE) has a property that is not an object");
      const oldKey = memberKey(p, "oldValue");
      const newKey = memberKey(p, "newValue");
      const item = new ChangeOperationItem(
        toStringValue(member(p, "propertyName")) as string,
        toEnum(member(p, "propertyType"), PropertyType, 0) as PropertyType,
        toObjectValue(member(p, "oldValue")),
        toObjectValue(member(p, "newValue"))
      );
      if (oldKey !== undefined) copyFloatMark(p, oldKey, item, "oldValue");
      if (newKey !== undefined) copyFloatMark(p, newKey, item, "newValue");
      op.properties.push(item);
    }
  }
  return op;
}

/**
 * A string member: Newtonsoft reads it as it is written (no date parsing), a number as its text
 * and a boolean as the C# text of a bool; null stays null.
 */
function toStringValue(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "True" : "False";
  throw new Error("The undo history (BINCUE) has an object where a text was expected");
}

function toInt(v: unknown, fallback: number): number {
  if (v === undefined || v === null) return fallback;
  if (typeof v === "number") return Number.isInteger(v) ? v : csRoundToEven(v);
  if (typeof v === "string") {
    const n = Number(csTrim(v));
    if (csTrim(v).length > 0 && Number.isFinite(n)) return Number.isInteger(n) ? n : csRoundToEven(n);
  }
  if (typeof v === "boolean") return v ? 1 : 0;
  throw new Error("The undo history (BINCUE) has a value that is not an integer: " + String(v));
}

function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const t = csTrim(v).toLowerCase();
    if (t === "true") return true;
    if (t === "false") return false;
  }
  throw new Error("The undo history (BINCUE) has a value that is not a boolean: " + String(v));
}

/** An enum from its number or from its name (Newtonsoft accepts both, the name in any case). */
function toEnum(v: unknown, enumType: Record<string, string | number>, fallback: number): number {
  if (v === undefined || v === null) return fallback;
  if (typeof v === "string") {
    const t = csTrim(v);
    if (/^[+-]?\d+$/.test(t)) return Number(t);
    for (const key of Object.keys(enumType)) {
      if (isNaN(Number(key)) && key.toLowerCase() === t.toLowerCase()) return enumType[key] as number;
    }
    throw new Error("The undo history (BINCUE) has an unknown value: " + v);
  }
  return toInt(v, fallback);
}

/** The date of an operation (C# DateTime?). */
function toDate(v: unknown): Date {
  if (typeof v === "string") {
    const parsed = parseNewtonsoftDate(v);
    if (parsed) return parsed.date;
    const ms = Date.parse(v);
    if (!isNaN(ms)) return new Date(ms);
  }
  throw new Error("The undo history (BINCUE) has an invalid date: " + String(v));
}

/**
 * A property value (C# object): the JSON value as it is, but null is no value (C# omits it when it
 * writes the history again) and date-like texts, at any depth, are written as C# writes a DateTime.
 */
function toObjectValue(v: unknown): unknown {
  if (v === null || v === undefined) return undefined;
  return normalizeJsonValue(v);
}

function normalizeJsonValue(v: unknown): unknown {
  if (typeof v === "string") return normalizeDateText(v);
  if (Array.isArray(v)) {
    const result = v.map((x) => normalizeJsonValue(x));
    for (let i = 0; i < v.length; i++) copyFloatMark(v, String(i), result, String(i));
    return result;
  }
  if (isObject(v)) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(v)) {
      result[key] = normalizeJsonValue(v[key]);
      copyFloatMark(v, key, result, key);
    }
    return result;
  }
  return v;
}

// ---- What the writer needs to write a history as C# does ----

/**
 * The integral numbers of a history read with a decimal point or an exponent (2.0, 1e2): a double
 * for Newtonsoft, written back as 2.0 and 100.0. By the object that holds them (a property of an
 * operation, an array or an object of a value), with the value they had, so a changed value is
 * written as the number it is.
 */
const floatMarks = new WeakMap<object, Map<string, number>>();

function markFloat(holder: object, key: string, value: number): void {
  if (typeof holder !== "object" || holder === null) return;
  let marks = floatMarks.get(holder);
  if (!marks) floatMarks.set(holder, (marks = new Map()));
  marks.set(key, value);
}

/** A JSON.parse reviver that keeps the floats written as integers (2.0, 1e2) where the runtime gives their text. */
function floatMarkingReviver(this: unknown, key: string, value: unknown, context?: { source?: string }): unknown {
  if (typeof value === "number" && Number.isInteger(value) && context?.source !== undefined && /[.eE]/.test(context.source))
    markFloat(this as object, key, value);
  return value;
}

/**
 * JSON.parse of a report's JSON document that keeps, for the .rep writer, which integral numbers
 * were written as doubles (2.0): C# (Newtonsoft) reads them as doubles and writes them back so in
 * the undo history. Only needed for a document written by the C# engine (the designer writes 2);
 * without it such a number of the history is written as 2. Needs JSON.parse source text access
 * (Node 21, current browsers); without it, it is JSON.parse.
 */
export function parseReportJson(text: string): any {
  return JSON.parse(text, floatMarkingReviver as (this: unknown, key: string, value: unknown) => unknown);
}

/** Carries the float mark of a member to its copy (hydrateUndoCue). */
export function copyFloatMark(from: object, fromKey: string, to: object, toKey: string): void {
  const value = floatMarks.get(from)?.get(fromKey);
  if (value !== undefined) markFloat(to, toKey, value);
}

function isMarkedFloat(holder: object | undefined, key: string, value: number): boolean {
  return holder !== undefined && floatMarks.get(holder)?.get(key) === value;
}

/**
 * The text C# writes for the date of an operation, by operation: Newtonsoft keeps the kind of the
 * date it read (UTC "Z", local with the offset of the computer, or without zone), which a Date
 * does not. Kept with the time it had, so a changed date is written as a UTC one.
 */
const operationDates = new WeakMap<ChangeObjectOperation, { time: number; text: string }>();

/**
 * Remembers how C# writes the date of an operation read from a JSON value (its "date" member):
 * the date in the form Newtonsoft gives it back, or null for an explicit null. Called by the
 * reader and by hydrateUndoCue.
 */
export function rememberOperationDate(op: ChangeObjectOperation, raw: unknown): void {
  if (raw === null) {
    operationDates.set(op, { time: op.date.getTime(), text: "null" });
    return;
  }
  if (typeof raw !== "string") return;
  const parsed = parseNewtonsoftDate(raw);
  if (parsed) operationDates.set(op, { time: op.date.getTime(), text: jsonString(formatNewtonsoftDate(parsed)) });
}

/** A Date as Newtonsoft writes a UTC DateTime: the fraction of the second without its trailing zeros. */
function formatUtcDate(date: Date): string {
  return formatNewtonsoftDate({
    date,
    kind: "Utc",
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    ticks: date.getUTCMilliseconds() * 10000,
  });
}

/**
 * A JSON string as Newtonsoft writes it (StringEscapeHandling.Default): the quote, the backslash,
 * the control characters, U+0085, U+2028 and U+2029 escaped (\uXXXX in lowercase hexadecimal but
 * \b \t \n \f \r), any other character as it is.
 */
function jsonString(s: string): string {
  let out = '"';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let escaped: string | undefined;
    if (c < 0x20 || c === 0x22 || c === 0x5c || c === 0x85 || c === 0x2028 || c === 0x2029) {
      switch (c) {
        case 0x09:
          escaped = "\\t";
          break;
        case 0x0a:
          escaped = "\\n";
          break;
        case 0x0d:
          escaped = "\\r";
          break;
        case 0x0c:
          escaped = "\\f";
          break;
        case 0x08:
          escaped = "\\b";
          break;
        case 0x5c:
          escaped = "\\\\";
          break;
        case 0x22:
          escaped = '\\"';
          break;
        default:
          escaped = "\\u" + c.toString(16).padStart(4, "0");
      }
    }
    if (escaped !== undefined) {
      out += s.substring(start, i) + escaped;
      start = i + 1;
    }
  }
  return out + s.substring(start) + '"';
}

/**
 * A number as Newtonsoft writes the value it read from the JSON of the number: an integer (a long)
 * as its digits, a double (a decimal point or an exponent) with ToString("R") and ".0" when that
 * has neither.
 */
function jsonNumber(value: number, isFloat: boolean): string {
  if (!Number.isFinite(value)) return "null";
  const text = JSON.stringify(value);
  if (!isFloat && !/[.eE]/.test(text)) return text;
  const r = csDoubleToString(value);
  return /[.E]/.test(r) || r === "NaN" || r.endsWith("Infinity") ? r : r + ".0";
}

/**
 * A value of a property of an operation (C# object): the JSON value the designer sends
 * (JSON.stringify), as Newtonsoft reads it into an object (date-like texts become dates) and
 * writes it again.
 */
function jsonValue(value: unknown, holder?: object, key?: string): string {
  if (value === undefined || value === null) return "null";
  if (typeof value === "string") return jsonString(normalizeDateText(value));
  if (typeof value === "number") return jsonNumber(value, isMarkedFloat(holder, key ?? "", value));
  if (typeof value === "boolean") return value ? "true" : "false";
  const toJSON = (value as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === "function") return jsonValue((value as { toJSON: () => unknown }).toJSON());
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    const parts: string[] = [];
    value.forEach((x, i) => {
      // JSON.stringify writes a missing or not serializable item as null.
      parts.push(x === undefined || typeof x === "function" || typeof x === "symbol" ? "null" : jsonValue(x, value, String(i)));
    });
    return "[" + parts.join(",") + "]";
  }
  if (typeof value === "object") {
    const parts: string[] = [];
    for (const k of Object.keys(value)) {
      const x = (value as Record<string, unknown>)[k];
      if (x === undefined || typeof x === "function" || typeof x === "symbol") continue;
      parts.push(jsonString(k) + ":" + jsonValue(x, value, k));
    }
    return "{" + parts.join(",") + "}";
  }
  return "null";
}

function jsonInt(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(Math.trunc(value)) : "0";
}

function jsonNullableString(value: unknown): string {
  return value === undefined || value === null ? "null" : jsonString(String(value));
}

function writeOperation(op: ChangeObjectOperation): string {
  let date: string;
  const remembered = operationDates.get(op);
  if (!(op.date instanceof Date) || isNaN(op.date.getTime())) date = op.date === null ? "null" : jsonValue(op.date);
  else if (remembered && remembered.time === op.date.getTime()) date = remembered.text;
  else date = jsonString(formatUtcDate(op.date));
  const properties = (op.properties ?? []).map(
    (p) =>
      '{"PropertyName":' +
      jsonNullableString(p.propertyName) +
      ',"PropertyType":' +
      jsonInt(p.propertyType) +
      ',"OldValue":' +
      jsonValue(p.oldValue, p, "oldValue") +
      ',"NewValue":' +
      jsonValue(p.newValue, p, "newValue") +
      "}"
  );
  return (
    '{"Operation":' +
    jsonInt(op.operation) +
    ',"GroupId":' +
    jsonInt(op.groupId) +
    ',"ComponentName":' +
    jsonNullableString(op.componentName) +
    ',"ComponentClass":' +
    jsonNullableString(op.componentClass) +
    ',"ParentName":' +
    jsonNullableString(op.parentName) +
    ',"OldItemIndex":' +
    (op.oldItemIndex === undefined || op.oldItemIndex === null ? "null" : jsonInt(op.oldItemIndex)) +
    ',"OldParentName":' +
    jsonNullableString(op.oldParentName) +
    ',"Date":' +
    date +
    ',"ExpandedProperties":' +
    (op.expandedProperties === false ? "false" : "true") +
    ',"Properties":[' +
    properties.join(",") +
    "]}"
  );
}

/**
 * The undo history as the C# writer saves it in BINCUE: JsonConvert.SerializeObject(undoCue) with
 * Newtonsoft's default settings (PascalCase names in the order of the C# classes, nulls written,
 * enums as numbers, dates in ISO form as Newtonsoft read them).
 */
export function writeUndoCueJson(cue: UndoCue): string {
  return (
    '{"GroupId":' +
    jsonInt(cue.groupId) +
    ',"UndoOperations":[' +
    (cue.undoOperations ?? []).map(writeOperation).join(",") +
    '],"RedoOperations":[' +
    (cue.redoOperations ?? []).map(writeOperation).join(",") +
    "]}"
  );
}

/** The kinds of a .NET DateTime. */
type DateKind = "Unspecified" | "Utc" | "Local";

interface ParsedDate {
  /** The instant (for Unspecified, the wall-clock time taken as local time). */
  date: Date;
  kind: DateKind;
  /** The wall-clock components of the DateTime (for Local, already converted to local time). */
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** Fraction of the second in 100 ns ticks (0 to 9999999). */
  ticks: number;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function twoDigits(s: string, i: number): number {
  const a = s.charCodeAt(i) - 48;
  const b = s.charCodeAt(i + 1) - 48;
  if (a < 0 || a > 9 || b < 0 || b > 9) return -1;
  return a * 10 + b;
}

/** A Date from wall-clock components taken as local time (years below 100 included). */
function localDate(y: number, mo: number, d: number, h: number, mi: number, s: number, ms: number): Date {
  const result = new Date(2000, 0, 1);
  result.setFullYear(y, mo - 1, d);
  result.setHours(h, mi, s, ms);
  return result;
}

function fromInstant(utcMs: number, ticksRemainder: number): ParsedDate {
  // ToLocalTime: the local wall clock of the instant.
  const instant = new Date(utcMs);
  return {
    date: instant,
    kind: "Local",
    year: instant.getFullYear(),
    month: instant.getMonth() + 1,
    day: instant.getDate(),
    hour: instant.getHours(),
    minute: instant.getMinutes(),
    second: instant.getSeconds(),
    ticks: instant.getMilliseconds() * 10000 + ticksRemainder,
  };
}

/**
 * Newtonsoft's date detection of a JSON text (DateTimeUtils.TryParseDateTime with the default
 * settings): ISO 8601 "yyyy-MM-ddTHH:mm:ss[.fffffff][Z|±HH[:mm]]" of 19 to 40 characters, or the
 * Microsoft form "/Date(ms[±HHmm])/". Returns undefined when Newtonsoft keeps it as a text.
 */
function parseNewtonsoftDate(s: string): ParsedDate | undefined {
  if (s.length >= 9 && s.startsWith("/Date(") && s.endsWith(")/")) {
    const m = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/.exec(s);
    if (!m) return undefined;
    const ms = Number(m[1]);
    if (!Number.isFinite(ms)) return undefined;
    if (m[2] === undefined) {
      const d = new Date(ms);
      return {
        date: d,
        kind: "Utc",
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
        hour: d.getUTCHours(),
        minute: d.getUTCMinutes(),
        second: d.getUTCSeconds(),
        ticks: d.getUTCMilliseconds() * 10000,
      };
    }
    return fromInstant(ms, 0);
  }
  if (s.length < 19 || s.length > 40) return undefined;
  const c0 = s.charCodeAt(0);
  if (c0 < 48 || c0 > 57 || s[10] !== "T") return undefined;
  const y1 = twoDigits(s, 0);
  const y2 = twoDigits(s, 2);
  if (y1 < 0 || y2 < 0 || s[4] !== "-" || s[7] !== "-" || s[13] !== ":" || s[16] !== ":") return undefined;
  const year = y1 * 100 + y2;
  const month = twoDigits(s, 5);
  const day = twoDigits(s, 8);
  const hour = twoDigits(s, 11);
  const minute = twoDigits(s, 14);
  const second = twoDigits(s, 17);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return undefined;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return undefined;
  let i = 19;
  let ticks = 0;
  if (i < s.length && s[i] === ".") {
    i++;
    let digits = 0;
    while (i < s.length && digits < 7) {
      const d = s.charCodeAt(i) - 48;
      if (d < 0 || d > 9) break;
      ticks = ticks * 10 + d;
      digits++;
      i++;
    }
    if (digits === 0) return undefined;
    for (; digits < 7; digits++) ticks *= 10;
  }
  if (i === s.length) {
    return {
      date: localDate(year, month, day, hour, minute, second, Math.floor(ticks / 10000)),
      kind: "Unspecified",
      year,
      month,
      day,
      hour,
      minute,
      second,
      ticks,
    };
  }
  const zone = s[i];
  if ((zone === "Z" || zone === "z") && i + 1 === s.length) {
    const d = new Date(Date.UTC(2000, 0, 1));
    d.setUTCFullYear(year, month - 1, day);
    d.setUTCHours(hour, minute, second, Math.floor(ticks / 10000));
    return { date: d, kind: "Utc", year, month, day, hour, minute, second, ticks };
  }
  if (zone === "+" || zone === "-") {
    const zh = twoDigits(s, i + 1);
    if (zh < 0 || zh > 99) return undefined;
    let j = i + 3;
    let zm = 0;
    if (j < s.length) {
      if (s[j] === ":") j++;
      zm = twoDigits(s, j);
      if (zm < 0) return undefined;
      j += 2;
    }
    if (j !== s.length || zh > 14 || zm > 59) return undefined;
    const offsetMs = (zone === "+" ? 1 : -1) * (zh * 60 + zm) * 60000;
    const wall = new Date(Date.UTC(2000, 0, 1));
    wall.setUTCFullYear(year, month - 1, day);
    wall.setUTCHours(hour, minute, second, Math.floor(ticks / 10000));
    return fromInstant(wall.getTime() - offsetMs, ticks % 10000);
  }
  return undefined;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** How Newtonsoft writes a DateTime (IsoDateFormat, DateTimeZoneHandling.RoundtripKind). */
function formatNewtonsoftDate(d: ParsedDate): string {
  let text =
    pad(d.year, 4) +
    "-" +
    pad(d.month, 2) +
    "-" +
    pad(d.day, 2) +
    "T" +
    pad(d.hour, 2) +
    ":" +
    pad(d.minute, 2) +
    ":" +
    pad(d.second, 2);
  if (d.ticks !== 0) text += "." + pad(d.ticks, 7).replace(/0+$/, "");
  if (d.kind === "Utc") text += "Z";
  else if (d.kind === "Local") {
    const offset = -d.date.getTimezoneOffset();
    const abs = Math.abs(offset);
    text += (offset < 0 ? "-" : "+") + pad(Math.floor(abs / 60), 2) + ":" + pad(abs % 60, 2);
  }
  return text;
}

/** A text as C# gives it back: a date-like text is written as its DateTime, any other unchanged. */
function normalizeDateText(s: string): string {
  const parsed = parseNewtonsoftDate(s);
  return parsed ? formatNewtonsoftDate(parsed) : s;
}
