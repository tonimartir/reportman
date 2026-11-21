// What tedious is taught so that a connection of this driver talks to SQL Server as SqlClient does.
// Each change applies only to the connections of this driver and leaves tedious as it is for any
// other code of the process:
//
// - the LOGIN7 packet sets fODBC, as SqlClient does: the server then gives the session the ODBC
//   defaults (ANSI_NULLS, ANSI_PADDING, ANSI_WARNINGS, ANSI_NULL_DFLT_ON, CONCAT_NULL_YIELDS_NULL and
//   QUOTED_IDENTIFIER on, ARITHABORT off, TEXTSIZE -1) instead of tedious' SET batch;
// - the values of the types tedious reads with a loss (decimal, numeric, money, the dates and times,
//   sql_variant) reach the driver as their bytes, decoded in values.ts exactly as SqlClient does;
// - a parameter is written with the TYPE_INFO and value bytes params.ts built, and a parameter
//   without value (C# null) goes with the DEFAULT status flag, as SqlClient sends it.

import { createRequire } from 'node:module';
import path from 'node:path';
import tedious from 'tedious';

const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve('tedious'));

/** The options of a tedious connection of this driver carry this mark. */
export const RAW_VALUES = Symbol.for('reportman-driver-mssql.rawValues');

/** The bytes of a value as they came in the row (its length prefix included). */
export class RawValue {
  readonly bytes: Buffer;
  constructor(bytes: Buffer) {
    this.bytes = bytes;
  }
}

/** The TDS types whose values are read as bytes (tedious reads them with a loss). */
const RAW_TYPES = new Set([
  'Money',
  'SmallMoney',
  'MoneyN',
  'Decimal',
  'Numeric',
  'DecimalN',
  'NumericN',
  'DateTime',
  'SmallDateTime',
  'DateTimeN',
  'Date',
  'Time',
  'DateTime2',
  'DateTimeOffset',
  'Variant',
]);

interface ResultLike {
  value: unknown;
  offset: number;
}
type ReadValue = (buf: Buffer, offset: number, metadata: { type: { name: string } }, options: Record<symbol, unknown>) => ResultLike;

interface ParameterHeaderTarget {
  writeParameterHeader(this: unknown, buffer: WritableBuffer, parameter: { name?: string; output?: boolean; type: unknown; data: { value: unknown } }): void;
}

/** The part of tedious' WritableTrackingBuffer the driver writes with. */
export interface WritableBuffer {
  writeUInt8(value: number): void;
  writeBVarchar(value: string, encoding: string): void;
  writeBuffer(value: Buffer): void;
}

let patched = false;

function patchTedious(): void {
  if (patched) return;
  patched = true;
  const valueParser = require(path.join(root, 'value-parser.js')) as { readValue: ReadValue };
  const readValue = valueParser.readValue;
  valueParser.readValue = function (buf, offset, metadata, options) {
    const result = readValue(buf, offset, metadata, options);
    if (options[RAW_VALUES] === true && result.value !== null && RAW_TYPES.has(metadata.type.name)) {
      result.value = new RawValue(Buffer.from(buf.subarray(offset, result.offset)));
    }
    return result;
  };
  const rpc = require(path.join(root, 'rpcrequest-payload.js')) as { default?: { prototype: ParameterHeaderTarget }; prototype?: ParameterHeaderTarget };
  const proto = (rpc.prototype ?? rpc.default!.prototype) as ParameterHeaderTarget;
  const writeParameterHeader = proto.writeParameterHeader;
  proto.writeParameterHeader = function (buffer, parameter) {
    if (parameter.type !== RAW_PARAMETER) return writeParameterHeader.call(this, buffer, parameter);
    const value = parameter.data.value as RawParameterValue;
    buffer.writeBVarchar(parameter.name ? '@' + parameter.name : '', 'ucs2');
    // RPC_PARAM_DEFAULT for a value SqlClient has none for (C# null)
    buffer.writeUInt8(value.isDefault ? 0x02 : 0);
  };
}

/** A parameter as params.ts built it: its TYPE_INFO and its value, as bytes. */
export interface RawParameterValue {
  readonly typeInfo: Buffer;
  readonly value: Buffer;
  readonly isDefault: boolean;
}

/** The tedious data type of the parameters of this driver: it writes the bytes it is given. */
export const RAW_PARAMETER = {
  id: 0,
  type: 'RMRAW',
  name: 'ReportmanRaw',
  declaration(): string {
    throw new Error('The declaration of a parameter of the SQL Server driver is built by the driver');
  },
  validate(value: unknown): unknown {
    return value;
  },
  resolve(parameter: { value: unknown }): { value: unknown } {
    return { value: parameter.value };
  },
  writeTypeInfo(buffer: WritableBuffer, data: { value: RawParameterValue }): void {
    buffer.writeBuffer(data.value.typeInfo);
  },
  writeValue(buffer: WritableBuffer, data: { value: RawParameterValue }): void {
    buffer.writeBuffer(data.value.value);
  },
};

interface Login7Prototype {
  buildOptionFlags2(this: unknown): number;
}

const ODBC_ON = 0x02;

/** A tedious connection that logs in as SqlClient does (fODBC) and reads the values as bytes. */
export function createConnection(config: tedious.ConnectionConfiguration, language: string): tedious.Connection {
  patchTedious();
  const login7 = require(path.join(root, 'login7-payload.js')) as { default?: { prototype: Login7Prototype }; prototype?: Login7Prototype };
  const loginProto = (login7.prototype ?? login7.default!.prototype) as Login7Prototype;
  class ReportmanConnection extends tedious.Connection {
    override sendLogin7Packet(): void {
      const buildOptionFlags2 = loginProto.buildOptionFlags2;
      loginProto.buildOptionFlags2 = function () {
        return buildOptionFlags2.call(this) | ODBC_ON;
      };
      try {
        (tedious.Connection.prototype as unknown as { sendLogin7Packet(this: unknown): void }).sendLogin7Packet.call(this);
      } finally {
        loginProto.buildOptionFlags2 = buildOptionFlags2;
      }
    }

    // SqlClient sends nothing after the login: no batch of SET statements, not even an empty one
    override async performLoggedInSendingInitialSql(): Promise<void> {}
  }
  const connection = new ReportmanConnection(config);
  // The session keeps the ODBC defaults the server gives: tedious sends no SET batch (its options
  // are cleared after the configuration is validated, where null is not accepted for all of them)
  const options = (connection as unknown as { config: { options: Record<string | symbol, unknown> } }).config.options;
  for (const k of [
    'enableAnsiNull',
    'enableAnsiNullDefault',
    'enableAnsiPadding',
    'enableAnsiWarnings',
    'enableArithAbort',
    'enableConcatNullYieldsNull',
    'enableCursorCloseOnCommit',
    'enableImplicitTransactions',
    'enableNumericRoundabort',
    'enableQuotedIdentifier',
    'abortTransactionOnError',
    'datefirst',
    'dateFormat',
    'textsize',
    'connectionIsolationLevel',
  ]) {
    options[k] = null;
  }
  // the default language of the login unless Current Language names one
  options.language = language.length > 0 ? language : null;
  options[RAW_VALUES] = true;
  return connection;
}
