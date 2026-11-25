// Port of the runtime part of Reportman.Reporting.Param: the value of a report parameter while a
// report is prepared and printed (Value, LastValue, ListValue, the multiple selection, the
// initial expressions, the lookup dataset and the texts of the current language).

import type { Param, Variant as LibVariant } from '@reportman/lib';
import { VariantType as LibVariantType } from '@reportman/lib';
import type { ParamLike } from '../eval/identifiers.js';
import { CsDecimal } from '../util/decimal.js';
import { RpDateTime } from '../util/datetime.js';
import { messageOf, nullReferenceException } from '../util/netexception.js';
import { ParamType, Variant, VariantType } from '../variant/variant.js';
import { ReportException } from '../report/errors.js';
import type { Op } from '../data/op.js';
import type { ReportRuntime } from '../report/report.js';

/** The lines of a list kept as one text (Strings.Fill): split at CR LF, CR or LF; "" is one empty line. */
export function fillStrings(text: string): string[] {
  const result: string[] = [];
  let partial = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      result.push(partial);
      partial = '';
      if (i < text.length - 1 && text.charCodeAt(i + 1) === 10) i++;
    } else if (c === 10) {
      result.push(partial);
      partial = '';
    } else partial += text.charAt(i);
  }
  result.push(partial);
  return result;
}

/** Strings.GetStringByIndex: the line of a language (the first one when it has none). */
export function getStringByIndex(text: string, index: number): string {
  const list = fillStrings(text);
  if (list.length < 1) return '';
  if (index < 0) index = 0;
  return index < list.length ? list[index]! : list[0]!;
}

/** A value of the model (the camelCase JSON Variant) as an engine Variant. */
export function variantFromModel(value: LibVariant | undefined): Variant {
  if (value === undefined || value === null) return Variant.null;
  const v = value.value as unknown;
  if (v === null || v === undefined) return Variant.null;
  switch (value.type) {
    case LibVariantType.Null:
      return Variant.null;
    case LibVariantType.Boolean:
      return Variant.fromBoolean(typeof v === 'string' ? v.toLowerCase() === 'true' : Boolean(v));
    case LibVariantType.Byte:
      return Variant.fromByte(Number(v));
    case LibVariantType.Char:
      return Variant.fromChar(String(v));
    case LibVariantType.Integer:
      return Variant.fromInteger(Number(v));
    case LibVariantType.Long:
      return Variant.fromLong(typeof v === 'bigint' ? v : BigInt(Math.trunc(Number(v))));
    case LibVariantType.Double:
      return Variant.fromDouble(Number(v));
    case LibVariantType.Decimal:
      if (v instanceof CsDecimal) return Variant.fromDecimal(v);
      return Variant.fromDecimal(typeof v === 'number' ? CsDecimal.fromDouble(v) : CsDecimal.parseInvariant(String(v)));
    case LibVariantType.String:
      return Variant.fromString(String(v));
    case LibVariantType.DateTime:
      if (v instanceof Date) return Variant.fromDateTime(RpDateTime.fromJsDate(v));
      if (v instanceof RpDateTime) return Variant.fromDateTime(v);
      return Variant.fromDateTime(RpDateTime.parseIso(String(v)));
    case LibVariantType.Binary:
      if (v instanceof Uint8Array) return Variant.fromBinary(v);
      return Variant.fromJSON({ type: 'Binary', value: String(v) });
  }
  return Variant.fromHost(v);
}

const DATE_1899_12_30 = RpDateTime.create(1899, 12, 30);

/**
 * Param.ParamTypeOf: the parameter type that holds a value, the one an initial expression turns
 * into. A date whose time of day is not zero is a date-time; one on or before 1899-12-30 a time.
 */
export function paramTypeOf(value: Variant): ParamType {
  switch (value.varType) {
    case VariantType.Null:
      return ParamType.Unknown;
    case VariantType.Byte:
    case VariantType.Integer:
    case VariantType.Long:
      return ParamType.Integer;
    case VariantType.Double:
      return ParamType.Double;
    case VariantType.Decimal:
      return ParamType.Currency;
    case VariantType.Boolean:
      return ParamType.Bool;
    case VariantType.String:
    case VariantType.Char:
      return ParamType.String;
    case VariantType.DateTime: {
      const date = value.rawValue as RpDateTime;
      if (date.date.compareTo(DATE_1899_12_30) <= 0) return ParamType.Time;
      return date.tickOfDay !== 0 ? ParamType.DateTime : ParamType.Date;
    }
    default:
      return ParamType.Unknown;
  }
}

/** A report parameter at run time. */
export class ReportParam implements ParamLike {
  readonly model: Param;
  readonly report: ReportRuntime;
  name: string;
  alias: string;
  paramType: ParamType;
  /** Descriptions, Hints and ErrorMessages: one line per report language, kept as one text. */
  descriptions: string;
  hints: string;
  errorMessages: string;
  validation: string;
  search: string;
  visible: boolean;
  isReadOnly: boolean;
  neverVisible: boolean;
  allowNulls: boolean;
  datasets: string[];
  items: string[];
  values: string[];
  selected: string[];
  lookupDataset: string;
  searchParam: string;
  searchDataset: string;
  private fValue: Variant;
  /** The value of the last run: what datasets bind and M.ALIAS reads. */
  lastValue: Variant = Variant.null;
  /** The expression an initial-value parameter had before UpdateInitialValue (null: never evaluated). */
  evaluatedInitialExpression: string | null = null;

  constructor(report: ReportRuntime, model: Param) {
    this.report = report;
    this.model = model;
    this.name = model.name;
    this.alias = model.alias;
    this.paramType = model.paramType as number as ParamType;
    this.descriptions = model.descriptions.join('\n');
    this.hints = model.hints.join('\n');
    this.errorMessages = model.errorMessages.join('\n');
    this.validation = model.validation;
    this.search = model.search;
    this.visible = model.visible;
    this.isReadOnly = model.isReadOnly;
    this.neverVisible = model.neverVisible;
    this.allowNulls = model.allowNulls;
    this.datasets = [...model.datasets];
    this.items = [...model.items];
    this.values = [...model.values];
    this.selected = [...model.selected];
    this.lookupDataset = model.lookupDataset;
    this.searchParam = model.searchParam;
    this.searchDataset = model.searchDataset;
    this.fValue = variantFromModel(model.value);
  }

  /** A parameter that is not in the report file (ConvertToDotNet creates them for SQL parameters). */
  static create(report: ReportRuntime, alias: string): ReportParam {
    const p = new ReportParam(report, {
      className: 'TRPPARAM',
      name: '',
      alias,
      paramType: 0,
      descriptions: [],
      hints: [],
      errorMessages: [],
      validation: '',
      search: '',
      visible: false,
      isReadOnly: false,
      neverVisible: false,
      allowNulls: false,
      datasets: [],
      items: [],
      values: [],
      selected: [],
      lookupDataset: '',
      searchParam: '',
      searchDataset: '',
      value: { type: LibVariantType.Null, value: null },
    } as unknown as Param);
    return p;
  }

  /** Value: the comma joined selection of a multiple selection parameter. */
  get value(): Variant {
    if (this.paramType === ParamType.Multiple) return this.getMultiValue();
    return this.fValue;
  }

  set value(v: Variant) {
    this.fValue = v;
  }

  /** The value as assigned, even for a multiple selection (FValue). */
  get rawValue(): Variant {
    return this.fValue;
  }

  /** Visible and not NeverVisible. */
  get userVisible(): boolean {
    return this.visible && !this.neverVisible;
  }

  private get ctx() {
    return this.report.evaluator.context;
  }

  /** The description in the report language. */
  get description(): string {
    return getStringByIndex(this.descriptions, this.report.language);
  }

  get hint(): string {
    return getStringByIndex(this.hints, this.report.language);
  }

  /** The error message in the report language, else the first one (as description and hint). */
  get errorMessage(): string {
    return getStringByIndex(this.errorMessages, this.report.language);
  }

  /** GetMultiValue: the selected values joined by commas ("" for other types). */
  getMultiValueText(): string {
    let aresult = '';
    if (this.paramType !== ParamType.Multiple) return aresult;
    for (const s of this.selected) {
      if (aresult.length > 0) aresult = aresult + ',' + s;
      else aresult = s;
    }
    return aresult;
  }

  getMultiValue(): Variant {
    return Variant.fromString(this.getMultiValueText());
  }

  /** The implicit string conversion of a Variant (null for non-string values, as C# FString). */
  private implicitString(v: Variant): string | null {
    return v.toImplicitString(this.ctx);
  }

  /**
   * ListValue: the effective value. For a list, the option chosen (its index, or its value) is
   * evaluated with the report's evaluator; a multiple selection gives its selection.
   */
  get listValue(): Variant {
    let aresult: Variant = Variant.null;
    const pt = this.paramType;
    if (!(pt === ParamType.List || pt === ParamType.Multiple || pt === ParamType.SubsExpreList)) aresult = this.value;
    else if (pt === ParamType.Multiple) aresult = this.getMultiValue();
    else {
      let aoption = 0;
      const value = this.value;
      if (value.isInteger()) {
        aoption = value.toInt(this.ctx);
        if (aoption < 0) aoption = 0;
      } else if (value.isString()) {
        aoption = this.values.indexOf(this.implicitString(value) as string);
        if (aoption < 0) aoption = 0;
      }
      if (aoption >= this.values.length) aresult = value;
      else aresult = this.report.evaluator.evaluateText(this.values[aoption]!);
    }
    return aresult;
  }

  /** GetSubExpreValue: the option at the index of the value, or the value itself. */
  getSubExpreValue(): string | null {
    if (this.fValue.isInteger()) {
      const i = this.fValue.toInt(this.ctx);
      if (i < 0 || i >= this.values.length) throw new RangeError('Index was out of range. Must be non-negative and less than the size of the collection.');
      return this.values[i]!;
    }
    return this.implicitString(this.fValue);
  }

  /**
   * UpdateInitialValue: an initial-value parameter evaluates its expression and becomes a
   * parameter of the result's type holding the result. False for any other type.
   */
  updateInitialValue(): boolean {
    if (this.paramType !== ParamType.InitialValue) return false;
    const expression = this.value.isNull ? '' : this.value.toString(this.ctx);
    let result: Variant;
    try {
      result = this.report.evaluator.evaluateText(expression);
    } catch (e) {
      throw new ReportException(messageOf(e) + ' - Parameter:' + this.alias, this.name, 'Value');
    }
    this.evaluatedInitialExpression = expression;
    this.paramType = paramTypeOf(result);
    this.value = result;
    return true;
  }

  /** RestoreInitialValue: back to the initial expression. */
  restoreInitialValue(): void {
    if (this.evaluatedInitialExpression === null) return;
    this.paramType = ParamType.InitialValue;
    this.value = Variant.fromString(this.evaluatedInitialExpression);
    this.evaluatedInitialExpression = null;
  }

  /** SelectAllValues: every value selected. */
  selectAllValues(): void {
    this.selected = [...this.values];
  }

  /**
   * UpdateLookupValues: the items and values from the lookup dataset, its first column the text
   * and its second (when there is one) the value.
   */
  *updateLookupValues(): Op<void> {
    if (this.lookupDataset.length > 0) {
      this.values = [];
      this.items = [];
      const dinfo = this.report.dataInfoByAlias(this.lookupDataset);
      if (dinfo === null) throw nullReferenceException();
      dinfo.disConnect();
      yield* dinfo.connect();
      try {
        const data = dinfo.data;
        let indexvalue = 0;
        if (data.columns.length > 1) indexvalue = 1;
        while (!data.eof) {
          const row = data.currentRow;
          if (row === null) throw nullReferenceException();
          this.items.push(this.report.objectText(row.boxed(0)));
          this.values.push(this.report.objectText(row.boxed(indexvalue)));
          yield* this.report.next(data);
        }
      } finally {
        dinfo.disConnect();
      }
    }
  }
}

