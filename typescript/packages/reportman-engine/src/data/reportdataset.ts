// Port of Reportman.Reporting.ReportDataset: the rows of a dataset as the report navigates them.
//
// With a reader (the rows of a query) it keeps a two record buffer, so the engine can go back one
// record (a group change is detected on the next record, and the group footer prints the values of
// the previous one) but not two. With a view (rows given whole: a DataViewOverride, or the table an
// HTTP agent returns) it moves by index. The C# class is a DataTable; here it keeps its columns and
// at most two rows, and answers the evaluator as a FieldTable.

import type { FieldTable } from '../eval/fields.js';
import { toUpperNet } from '../util/chars.js';
import type { CultureInfo } from '../util/culture.js';
import type { RpDateTime } from '../util/datetime.js';
import { duplicateNameException } from './errors.js';
import { argumentException, NetException, nullReferenceException } from '../util/netexception.js';
import { Variant } from '../variant/variant.js';
import {
  columnValue,
  type DataColumn,
  schemaColumnType,
  storedToVariant,
  storedTypeName,
  storeValue,
  type StoredValue,
} from './columns.js';
import type { DataValue, ParameterValueType, QueryResult } from './host.js';
import type { Op } from './op.js';

/** IDataReader over a materialised result: Read moves to the next row. */
export class ResultReader {
  readonly result: QueryResult;
  private pos = -1;

  constructor(result: QueryResult) {
    this.result = result;
  }

  get fieldCount(): number {
    return this.result.columns.length;
  }

  read(): boolean {
    if (this.pos < this.result.rows.length) this.pos++;
    return this.pos < this.result.rows.length;
  }

  /** reader[i] of the current row. */
  value(i: number): DataValue {
    const row = this.result.rows[this.pos];
    if (row === undefined) throw new Error('No data exists for the row/column.');
    if (i < 0 || i >= this.result.columns.length) throw new RangeError('Index was outside the bounds of the array.');
    return row[i];
  }
}

/** A DataView over rows given whole, already converted to the types of their columns. */
export class ResultView {
  readonly columns: readonly DataColumn[];
  readonly rows: readonly (readonly StoredValue[])[];

  constructor(columns: readonly DataColumn[], rows: readonly (readonly StoredValue[])[]) {
    this.columns = columns;
    this.rows = rows;
  }

  get count(): number {
    return this.rows.length;
  }

  /**
   * The view of a host result, as the DataTable the host filled: the columns keep their names
   * and types, the values are stored in those types.
   */
  static fromResult(result: QueryResult, locale: CultureInfo, culture: CultureInfo): ResultView {
    const columns: DataColumn[] = [];
    for (const col of result.columns) {
      if (columns.some((c) => toUpperNet(c.name) === toUpperNet(col.name))) throw duplicateNameException(col.name);
      columns.push({ name: col.name, type: col.type, maxLength: -1 });
    }
    const rows = result.rows.map((row) => columns.map((c, i) => storeValue(c, row[i], locale, culture)));
    return new ResultView(columns, rows);
  }

  /**
   * DataView.FindRows: the rows whose sort columns have the values of the key. A view without
   * sort finds nothing (the C# ArgumentException); the view of a union has one (UnionView).
   */
  findRows(_key: readonly DataValue[]): readonly (readonly StoredValue[])[] {
    throw argumentException('Find finds a row based on a Sort order, and no Sort order is specified.');
  }
}

/** A row of the dataset (DataRow): its values by column index. */
export class DatasetRow {
  readonly values: StoredValue[];
  private readonly dataset: ReportDataset;

  constructor(dataset: ReportDataset, values: StoredValue[]) {
    this.dataset = dataset;
    this.values = values;
  }

  private index(name: string): number {
    const i = this.dataset.indexOfColumn(name);
    if (i < 0) throw new Error(`Column '${name}' does not belong to table .`);
    return i;
  }

  /** row[name] as a Variant (Variant.AssignFromObject of the value). */
  variant(name: string | number): Variant {
    const i = typeof name === 'number' ? name : this.index(name);
    return storedToVariant(this.dataset.columns[i]!, this.values[i] ?? null);
  }

  /** row[name] as the boxed .NET value: its type and value. */
  boxed(name: string | number): { type: ParameterValueType; value: StoredValue } {
    const i = typeof name === 'number' ? name : this.index(name);
    const value = this.values[i] ?? null;
    return { type: storedTypeName(this.dataset.columns[i]!, value), value };
  }
}

/** DataChange: a listener of the record changes of a dataset (it may re-execute a detail). */
export type DataChangeListener = (data: ReportDataset) => Op<void>;

export class ReportDataset implements FieldTable {
  private fEof = false;
  private fInternalEof = false;
  private fLastFetched = 0;
  private fBuffer = 0;
  private fCurrent = 0;
  private fCurrentReader: ResultReader | null = null;
  private fCurrentView: ResultView | null = null;
  /** The rows of the view the filter found (CurrentRowSet; null: every row of the view). */
  private currentRowSet: readonly (readonly StoredValue[])[] | null = null;
  private fViewFilter: readonly DataValue[] | null = null;
  /** The rows of the two record buffer (reader mode). */
  private readonly rows: DatasetRow[] = [];
  private fColumns: DataColumn[] = [];
  /** ColumnSizes: the size of each column the reader gives one for. */
  readonly columnSizes = new Map<string, number>();
  /** When false a new reader keeps the columns (the same SQL executed again). */
  updateColumns = false;
  /** OnDataChange (C# +=: a listener added twice is called twice). */
  readonly onDataChange: DataChangeListener[] = [];
  /** DataTable.Locale: the culture strings are parsed with when they are stored. */
  private readonly locale: CultureInfo;
  /** The culture values print with (value.ToString() of a string column). */
  private readonly culture: () => CultureInfo;
  private readonly invariant: CultureInfo;
  private readonly now: () => RpDateTime;

  constructor(locale: CultureInfo, culture: () => CultureInfo, invariant: CultureInfo, now: () => RpDateTime) {
    this.locale = locale;
    this.culture = culture;
    this.invariant = invariant;
    this.now = now;
  }

  get columns(): readonly DataColumn[] {
    return this.fColumns;
  }

  /** DataTable.Columns.IndexOf: case-insensitive. */
  indexOfColumn(name: string): number {
    const cols = this.fColumns;
    for (let i = 0; i < cols.length; i++) if (cols[i]!.name === name) return i;
    const upper = toUpperNet(name);
    for (let i = 0; i < cols.length; i++) if (toUpperNet(cols[i]!.name) === upper) return i;
    return -1;
  }

  /** IdenField.GetValue: the value of a column in the current row (Null without rows). */
  getValue(_row: number, column: string): unknown {
    if (this.currentRowCount > 0) {
      const row = this.currentRow;
      if (row !== null) return row.variant(column);
    }
    return Variant.null;
  }

  /** The number of records loaded (reader: the rows of the buffer; view: its rows). */
  get currentRowCount(): number {
    if (this.fCurrentReader !== null) return this.rows.length;
    if (this.fCurrentView !== null) return this.currentRowSet !== null ? this.currentRowSet.length : this.fCurrentView.count;
    return 0;
  }

  /** A reader or a view is assigned. */
  get active(): boolean {
    return this.fCurrentReader !== null || this.fCurrentView !== null;
  }

  /** The rows the view gives: the ones the filter found, or all of them. */
  private viewRows(): readonly (readonly StoredValue[])[] {
    return this.currentRowSet ?? this.fCurrentView!.rows;
  }

  private viewRow(index: number): DatasetRow {
    const values = this.viewRows()[index];
    if (values === undefined)
      throw new NetException(
        'IndexOutOfRangeException',
        // The DataRowView[] of the filter, or the DataView
        this.currentRowSet !== null ? 'Index was outside the bounds of the array.' : `There is no row at position ${index}.`,
      );
    return new DatasetRow(this, values as StoredValue[]);
  }

  /** The current row; null when there is none. */
  get currentRow(): DatasetRow | null {
    if (this.fCurrentView !== null) {
      const count = this.viewRows().length;
      if (this.fCurrent < count) return this.viewRow(this.fCurrent);
      if (count > 0) return this.viewRow(count - 1);
      return null;
    }
    if (this.rows.length > this.fCurrent) return this.rows[this.fCurrent] ?? null;
    return null;
  }

  /** The row of the buffer that is not the current one. */
  get otherRow(): DatasetRow | null {
    if (this.fCurrentView !== null) {
      if (this.fCurrent > 0) return this.viewRow(this.fCurrent - 1);
      return this.viewRow(0);
    }
    if (this.rows.length < 2) return this.rows[this.fCurrent] ?? null;
    return this.rows[this.fBuffer] ?? null;
  }

  get currentReader(): ResultReader | null {
    return this.fCurrentReader;
  }

  /** Assigning a reader loads its first record. */
  set currentReader(value: ResultReader | null) {
    if (this.fCurrentReader !== value) {
      this.fCurrentReader = value;
      this.doUpdateData();
    }
  }

  get currentView(): ResultView | null {
    return this.fCurrentView;
  }

  set currentView(value: ResultView | null) {
    if (this.fCurrentView !== value) {
      this.fCurrentView = value;
      this.doUpdateData();
    }
  }

  /** ViewFilter: the values of the sort columns of the view the rows must have (null: all the rows). */
  get viewFilter(): readonly DataValue[] | null {
    return this.fViewFilter;
  }

  set viewFilter(value: readonly DataValue[] | null) {
    this.fViewFilter = value;
    this.updateViewRows();
  }

  private updateViewRows(): void {
    this.currentRowSet = null;
    if (this.fViewFilter !== null) {
      if (this.fCurrentView === null) throw nullReferenceException();
      this.currentRowSet = this.fCurrentView.findRows(this.fViewFilter);
      this.fCurrent = 0;
      this.fEof = this.currentRowSet.length === 0;
      this.fInternalEof = this.fEof;
    }
  }

  /** No more records, or no data assigned. */
  get eof(): boolean {
    if (this.fCurrentReader === null && this.fCurrentView === null) return true;
    return this.fInternalEof;
  }

  private fill(row: DatasetRow, reader: ResultReader): void {
    const now = this.now();
    const culture = this.culture();
    for (let i = 0; i < this.fColumns.length; i++) {
      const col = this.fColumns[i]!;
      row.values[i] = storeValue(col, columnValue(col, reader.value(i), this.invariant, now), this.locale, culture);
    }
  }

  private newRow(): DatasetRow {
    return new DatasetRow(this, new Array<StoredValue>(this.fColumns.length).fill(null));
  }

  private doUpdateData(): void {
    if (this.updateColumns) this.fColumns = [];
    this.columnSizes.clear();
    this.rows.length = 0;
    this.fEof = false;
    this.fInternalEof = false;
    if (this.fCurrentReader === null && this.fCurrentView === null) {
      this.fEof = true;
      this.fInternalEof = true;
      return;
    }
    if (this.fColumns.length === 0) {
      if (this.fCurrentReader !== null) {
        const columns: DataColumn[] = [];
        this.fCurrentReader.result.columns.forEach((info, i) => {
          let acolname = toUpperNet(info.name);
          if (info.size !== null && info.size !== undefined) {
            if (this.columnSizes.has(acolname)) throw new Error('Repeated column: ' + acolname);
            this.columnSizes.set(acolname, info.size);
          }
          if (acolname.length < 1) acolname = 'Column' + String(i);
          if (columns.some((c) => toUpperNet(c.name) === toUpperNet(acolname))) throw duplicateNameException(acolname);
          const type = schemaColumnType(info.type, info.declaredType);
          // MaxLength of a string column: the size given (ADO.NET providers always give one, -1 when
          // unknown; a host that gives none is taken as -1)
          const maxLength = type === 'String' && info.size !== null && info.size !== undefined ? info.size : -1;
          columns.push({ name: acolname, type, maxLength });
        });
        this.fColumns = columns;
      } else {
        this.fColumns = this.fCurrentView!.columns.map((c) => ({ name: c.name, type: c.type, maxLength: -1 }));
      }
    }
    this.fCurrent = 0;
    this.fBuffer = -1;
    this.fLastFetched = 0;
    if (this.fCurrentReader !== null && this.fCurrentView === null) {
      if (this.fCurrentReader.read()) {
        const arow = this.newRow();
        this.rows.push(arow);
        this.fill(arow, this.fCurrentReader);
      } else {
        this.fEof = true;
        this.fInternalEof = true;
      }
      this.fViewFilter = null;
      this.updateViewRows();
    } else if (this.fCurrentView!.count === 0) {
      this.fEof = true;
      this.fInternalEof = true;
    }
  }

  /** Back to the first record (views only). */
  first(): void {
    if (this.fCurrentView === null) throw new Error('First only supported memeory');
    this.fCurrent = 0;
    this.fEof = this.viewRows().length === 0;
    this.fInternalEof = this.fEof;
  }

  private *dataChanged(): Op<void> {
    // C# parity: the delegate list is the one at the time of the call
    for (const listener of [...this.onDataChange]) yield* listener(this);
  }

  /** Moves to the next record; after Prior only the current row changes. */
  *next(): Op<boolean> {
    if (this.fCurrentView !== null) {
      if (this.fCurrent < this.viewRows().length - 1) {
        this.fCurrent++;
        yield* this.dataChanged();
        return true;
      }
      this.fInternalEof = true;
      this.fEof = true;
      return false;
    }
    const reader = this.fCurrentReader;
    if (reader === null) return false;
    if (this.fLastFetched !== this.fCurrent) {
      this.fCurrent = this.fLastFetched;
      this.fInternalEof = this.fEof;
      yield* this.dataChanged();
      return true;
    }
    if (this.fEof) return false;
    this.fEof = !reader.read();
    if (this.fEof) {
      this.fInternalEof = true;
      return false;
    }
    let arow: DatasetRow;
    if (this.rows.length < 2) {
      this.fLastFetched = this.rows.length;
      this.fBuffer = this.fCurrent;
      this.fCurrent = this.fLastFetched;
      arow = this.newRow();
      this.rows.push(arow);
    } else {
      arow = this.rows[this.fBuffer]!;
      this.fLastFetched = this.fBuffer;
      this.fBuffer = this.fCurrent;
      this.fCurrent = this.fLastFetched;
    }
    this.fill(arow, reader);
    yield* this.dataChanged();
    return true;
  }

  /** Moves to the previous record (only one back). */
  *prior(): Op<boolean> {
    if (this.fCurrentView !== null) {
      if (this.fCurrent === 0) return false;
      this.fCurrent--;
      yield* this.dataChanged();
      return true;
    }
    if (this.fCurrentReader === null) return false;
    if (this.rows.length < 2) return false;
    if (this.fLastFetched === this.fCurrent) this.fCurrent = this.fBuffer;
    else this.fCurrent = this.fLastFetched;
    yield* this.dataChanged();
    return true;
  }
}
