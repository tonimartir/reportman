// The parameters of a command as MySqlConnector sends them without Prepare: each placeholder is
// replaced in the text of the command by the SQL literal of its value (MySqlParameter.AppendSqlString),
// so the server sees the same statement from both engines.

import {
  CsDecimal,
  CultureInfo,
  DateTimeKind,
  formatDateTime,
  formatDecimal,
  formatDouble,
  NetException,
  type QueryParameter,
  RpDateTime,
} from 'reportman-engine';
import type { DateTimeKindName } from './connectionstring.js';
import { MySqlException } from './errors.js';
import { FinalParseStates, normalizeParameterName, ordinalIgnoreCaseKey, parseSql } from './sql.js';

/** What the binding needs of the connection. */
export interface BindOptions {
  readonly noBackslashEscapes: boolean;
  readonly allowUserVariables: boolean;
  readonly dateTimeKind: DateTimeKindName;
  /** CultureInfo.CurrentCulture of the C# engine (the text of a Variant in an error). */
  readonly culture: CultureInfo;
}

/** A piece of the statement: text (sent as UTF-8) or raw bytes (a binary literal). */
export type SqlChunk = string | Uint8Array;

const INVARIANT = CultureInfo.invariant;

/** WriteString: a quoted string, its NUL, quote and backslash escaped. */
export function quoteString(value: string, noBackslashEscapes: boolean): string {
  let out = "'";
  for (let i = 0; i < value.length; i++) {
    const c = value.charAt(i);
    if (c === '\\') out += noBackslashEscapes ? '\\' : '\\\\';
    else if (c === "'") out += "''";
    else if (c === '\0') out += noBackslashEscapes ? '\0' : '\\0';
    else out += c;
  }
  return out + "'";
}

/** A char value: '\0', '\'' and '\\' escaped as WriteString does. */
function quoteChar(c: string, noBackslashEscapes: boolean): string {
  if (c === '\0' && !noBackslashEscapes) return "'\\0'";
  if (c === "'") return "''''";
  if (c === '\\' && !noBackslashEscapes) return "'\\\\'";
  return "'" + c + "'";
}

/** _binary'...': NUL as \0, quote and backslash doubled (no escapes but the quote with NoBackslashEscapes). */
export function binaryLiteral(bytes: Uint8Array, noBackslashEscapes: boolean): Uint8Array {
  let length = bytes.length + 9;
  for (const b of bytes) if (b === 0x27 || ((b === 0x00 || b === 0x5c) && !noBackslashEscapes)) length++;
  const out = new Uint8Array(length);
  const prefix = "_binary'";
  for (let i = 0; i < prefix.length; i++) out[i] = prefix.charCodeAt(i);
  let k = prefix.length;
  for (const b of bytes) {
    if (b === 0x00 && !noBackslashEscapes) {
      out[k++] = 0x5c;
      out[k++] = 0x30;
    } else {
      if (b === 0x27 || (b === 0x5c && !noBackslashEscapes)) out[k++] = b;
      out[k++] = b;
    }
  }
  out[k++] = 0x27;
  return out;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/** timestamp('yyyy-MM-dd HH:mm:ss.ffffff'): the microseconds, truncated. */
export function timestampLiteral(d: RpDateTime): string {
  return (
    "timestamp('" +
    pad(d.year, 4) +
    '-' +
    pad(d.month, 2) +
    '-' +
    pad(d.day, 2) +
    ' ' +
    pad(d.hour, 2) +
    ':' +
    pad(d.minute, 2) +
    ':' +
    pad(d.second, 2) +
    '.' +
    pad(Math.floor(d.ticksOfSecond / 10), 6) +
    "')"
  );
}

/** Variant.ToString() of the C# engine, under the current culture. */
function variantText(p: QueryParameter, culture: CultureInfo): string {
  const v = p.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return p.dbType === 'Double' ? formatDouble(v, '', culture.number) : String(v);
  if (typeof v === 'string') return v;
  if (v instanceof CsDecimal) return formatDecimal(v, '', culture.number);
  if (v instanceof RpDateTime) return formatDateTime(v, '', culture);
  return '';
}

/** MySqlParameter.AppendSqlString of a parameter of the engine. */
export function parameterLiteral(p: QueryParameter, options: BindOptions): SqlChunk {
  const nbe = options.noBackslashEscapes;
  switch (p.valueType) {
    case 'Null':
    case 'DBNull':
      return 'NULL';
    case 'String':
      return quoteString(p.value as string, nbe);
    case 'Char':
      return quoteChar(p.value as string, nbe);
    case 'Byte':
    case 'Int32':
      return String(p.value as number);
    case 'Int64':
      return (p.value as bigint).toString();
    case 'Decimal':
      return (p.value as CsDecimal).toInvariantString();
    case 'Double':
      return formatDouble(p.value as number, 'R', INVARIANT.number);
    case 'Boolean':
      return p.value ? 'true' : 'false';
    case 'Binary':
      return binaryLiteral(p.value as Uint8Array, nbe);
    case 'DateTime': {
      const d = p.value instanceof Date ? RpDateTime.fromJsDate(p.value) : (p.value as RpDateTime);
      if (options.dateTimeKind === 'Utc' && d.kind === DateTimeKind.Local) {
        throw new MySqlException(`DateTime.Kind must not be Local when DateTimeKind setting is Utc (parameter name: ${p.name})`);
      }
      if (options.dateTimeKind === 'Local' && d.kind === DateTimeKind.Utc) {
        throw new MySqlException(`DateTime.Kind must not be Utc when DateTimeKind setting is Local (parameter name: ${p.name})`);
      }
      return timestampLiteral(d);
    }
    case 'Object':
      // The Variant itself (GETVALUEFROMSQL): no branch of AppendSqlString takes it; an integer
      // MySqlDbType unboxes it, anything else is not supported
      if (p.dbType === 'Int32' || p.dbType === 'Int64') {
        throw new NetException(
          'InvalidCastException',
          `Unable to cast object of type 'Reportman.Reporting.Variant' to type 'System.${p.dbType}'.`,
        );
      }
      throw new NetException(
        'NotSupportedException',
        `Parameter type Variant is not supported; see https://mysqlconnector.net/param-type. Value: ${variantText(p, options.culture)}`,
      );
  }
}

/** The parameters of a command by normalized name (MySqlParameterCollection), in order. */
export class ParameterCollection {
  readonly items: readonly QueryParameter[];
  private readonly byName = new Map<string, number>();

  constructor(parameters: readonly QueryParameter[]) {
    this.items = parameters;
    parameters.forEach((p, i) => {
      const normalized = normalizeParameterName(p.name);
      if (normalized.length > 0) {
        const key = ordinalIgnoreCaseKey(normalized);
        if (this.byName.has(key)) throw new MySqlException(`Parameter '${p.name}' has already been defined.`);
        this.byName.set(key, i);
      }
    });
  }

  /** NormalizedIndexOf. */
  indexOf(name: string): number {
    return this.byName.get(ordinalIgnoreCaseKey(normalizeParameterName(name))) ?? -1;
  }
}

/**
 * StatementPreparer.ParseAndBindParameters: the command text with the literal of each parameter in
 * place of its placeholder. A string when every piece is text; the bytes of the statement when a
 * binary literal holds bytes that UTF-8 text cannot carry.
 */
export function bindParameters(sql: string, parameters: ParameterCollection, options: BindOptions): string | Uint8Array {
  const chunks: SqlChunk[] = [];
  let lastIndex = 0;
  let positional = 0;
  const append = (index: number, textIndex: number, textLength: number): void => {
    chunks.push(sql.substring(lastIndex, textIndex));
    const count = parameters.items.length;
    if (index >= count) {
      throw new MySqlException(`Parameter index ${index} is invalid when only ${count} parameter${count === 1 ? ' is' : 's are'} defined.`);
    }
    chunks.push(parameterLiteral(parameters.items[index]!, options));
    lastIndex = textIndex + textLength;
  };
  const states = parseSql(sql, options.noBackslashEscapes, (name) => parameters.indexOf(name) >= 0, {
    namedParameter(index, length) {
      const text = sql.substring(index, index + length);
      const name = text.charAt(0) === ':' ? text.substring(1) : text;
      const parameterIndex = parameters.indexOf(name);
      if (parameterIndex === -1) {
        if (!options.allowUserVariables) {
          throw new MySqlException(
            `Parameter '${text}' must be defined. To use this as a variable, set 'Allow User Variables=true' in the connection string.`,
          );
        }
        return;
      }
      append(parameterIndex, index, length);
    },
    positionalParameter(index) {
      append(positional, index, 1);
      positional++;
    },
  });
  chunks.push(sql.substring(lastIndex));
  if ((states & FinalParseStates.NeedsNewline) !== 0) chunks.push('\n');
  if (chunks.every((c) => typeof c === 'string' || c.every((b) => b < 0x80))) {
    const ascii = new TextDecoder();
    return chunks.map((c) => (typeof c === 'string' ? c : ascii.decode(c))).join('');
  }
  const encoder = new TextEncoder();
  const parts = chunks.map((c) => (typeof c === 'string' ? encoder.encode(c) : c));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let k = 0;
  for (const part of parts) {
    out.set(part, k);
    k += part.length;
  }
  return out;
}
