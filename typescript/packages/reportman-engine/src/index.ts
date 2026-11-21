// reportman-engine: the expression language of Report Manager (a port of the C# engine's
// Variant, VariantCoercion, EvalParser, Evaluator and built-in functions), with the .NET number
// and date formatting and parsing it relies on.

export { Variant, VariantType, ParamType, variantTypeName } from './variant/variant.js';
export type { VariantJson, HostTypeHint } from './variant/variant.js';
export { coercion } from './variant/coercion.js';
export { createContext, systemNow } from './variant/context.js';
export type { VariantContext, ContextOptions } from './variant/context.js';

export { Evaluator, defaultHost } from './eval/evaluator.js';
export type { EvalHost, EvaluatorOptions, DataNeededEventArgs, Ref } from './eval/evaluator.js';
export { EvalParser, TokenType } from './eval/parser.js';
export { EvalException } from './eval/exception.js';
export {
  EvalIdentifier,
  EvalIdentifiers,
  IdenConstant,
  IdenTrue,
  IdenFalse,
  IdenNull,
  IdenVariable,
  IdenVariableParam,
  IdenFunction,
  IdenCallbackFunction,
} from './eval/identifiers.js';
export type { ParamLike } from './eval/identifiers.js';
export { IdenField, DatasetAlias, MemoryTable } from './eval/fields.js';
export type { FieldTable, AliasEntry, FieldResolver } from './eval/fields.js';
export { getMonthName } from './eval/functions.js';

export { CsDecimal } from './util/decimal.js';
export { RpDateTime, DateTimeKind, isLeapYear, daysInMonth } from './util/datetime.js';
export { CultureInfo } from './util/culture.js';
export type { CultureData, NumberFormatData, DateTimeFormatData } from './util/culture.js';
export { Translator, parseTranslationBytes } from './util/translator.js';
export type { MessageLanguage } from './util/translator.js';
export { formatDouble, formatDecimal, formatInteger } from './util/numberformat.js';
export {
  NumberStyles,
  parseDouble,
  tryParseDouble,
  parseDecimal,
  tryParseDecimal,
  parseInt32,
  tryParseInt32,
  tryParseInt64,
  tryParseBoolean,
} from './util/numberparse.js';
export { formatDateTime, dateFormatMask, utcTimeZone } from './util/dateformat.js';
export type { LocalTimeZone } from './util/dateformat.js';
export { parseDateTime, tryParseDateTime } from './util/dateparse.js';
export { compositeFormat } from './util/compositeformat.js';
export { fromBase64String, toBase64String } from './util/base64.js';
export {
  isNumeric,
  truncateDecimal,
  standardDeviation,
  formatCurrAdv,
  formatStringDecimals,
  frac,
  trunc,
  roundDecimalUp,
  compareValue,
  numberToText,
  decimalToSqlLiteral,
  doubleToSqlLiteral,
} from './util/doubleutil.js';
export { NetException, UnNamedException, NamedException, netTypeOf } from './util/netexception.js';

// The report engine: data host contract, datasets, parameters and the layout of a report.
export type {
  DataHost,
  DataConnection,
  ConnectionRequest,
  DatasetRequest,
  QueryCommand,
  QueryParameter,
  QueryResult,
  DataColumnInfo,
  DataColumnType,
  DataValue,
  ParameterDbType,
  ParameterValueType,
  IsolationLevelName,
  NamedPlaceholder,
} from './data/host.js';
export { noDataHost, rewriteNamedParameters } from './data/host.js';
export type { Op, MaybePromise } from './data/op.js';
export { runAsync, runSync, SynchronousDataRequiredError } from './data/op.js';
export { NotSupportedYetError } from './data/errors.js';
export { ReportDataset, ResultReader, ResultView, DatasetRow } from './data/reportdataset.js';
export type { DataColumn, StoredValue } from './data/columns.js';
export { ReportDataInfo } from './data/datainfo.js';
export { ReportDatabase } from './data/databaseinfo.js';
export { ReportParam, paramTypeOf, variantFromModel } from './params/param.js';
export {
  ParameterException,
  ParameterProblem,
  parameterDescriptionsToJson,
  jsonString,
} from './params/parameters.js';
export type { ParameterDescription, ParameterOption, ParameterInput, ParameterJsonValue } from './params/parameters.js';
export { ReportException, NoDataToPrintException } from './report/errors.js';
export { ReportRuntime, MAX_PAGENUM } from './report/report.js';
export type { ReportProgress, ReportRuntimeOptions } from './report/report.js';
export { prepareReport, ReportRun } from './report/run.js';
export type { PrepareReportOptions, ParametersOptions } from './report/run.js';
export { convertToDotNet } from './report/convert.js';
