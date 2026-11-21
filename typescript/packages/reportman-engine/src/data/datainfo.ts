// Port of the runtime part of Reportman.Reporting.DataInfo: a dataset of the report, opened
// (Connect) through its report connection with the substitution and the typed parameters of the
// report, re-executed when its master dataset (DataSource) moves to another record. A dataset of
// a MyBase connection is made of other datasets of the report (DataUnions, see union.ts) and
// follows its master by a filter on its index fields (MyBaseMasterFields).

import { DriverType, type DataInfo } from 'reportman-lib';
import { replaceNet, toUpperNet } from '../util/chars.js';
import { argumentOutOfRangeException, NamedException, nullReferenceException } from '../util/netexception.js';
import { ParamType, Variant, VariantType } from '../variant/variant.js';
import type { ReportRuntime } from '../report/report.js';
import { boxedEquals, type StoredValue } from './columns.js';
import {
  combineAddDataset,
  combineParallel,
  extractUnionFields,
  fromSemiColon,
  orderedRows,
  removeBlanks,
  type UnionContext,
  type UnionTable,
  UnionView,
} from './union.js';
import { NotSupportedYetError } from './errors.js';
import type { DataValue, ParameterDbType, ParameterValueType, QueryCommand, QueryParameter, QueryResult } from './host.js';
import { type Op, wait } from './op.js';
import { ReportDataset, ResultReader, ResultView } from './reportdataset.js';
import type { ReportDatabase } from './databaseinfo.js';

/** Variant.GetDbType. */
export function variantDbType(v: Variant): ParameterDbType {
  switch (v.varType) {
    case VariantType.Null:
      return 'Object';
    case VariantType.Boolean:
      return 'Boolean';
    case VariantType.Byte:
      return 'Byte';
    case VariantType.Char:
      return 'SByte';
    case VariantType.Integer:
      return 'Int32';
    case VariantType.Long:
      return 'Int64';
    case VariantType.Decimal:
      return 'Decimal';
    case VariantType.Double:
      return 'Double';
    case VariantType.DateTime:
      return 'DateTime';
    case VariantType.Binary:
      return 'Binary';
    case VariantType.String:
      return 'String';
  }
}

/** Variant.AsObject as a parameter value: its .NET type and value (DBNull for Null). */
export function variantParameterValue(v: Variant): { value: DataValue; valueType: ParameterValueType } {
  switch (v.varType) {
    case VariantType.Null:
      return { value: null, valueType: 'DBNull' };
    case VariantType.Boolean:
      return { value: v.asObject() as boolean, valueType: 'Boolean' };
    case VariantType.Byte:
      return { value: v.asObject() as number, valueType: 'Byte' };
    case VariantType.Char:
      return { value: v.asObject() as string, valueType: 'Char' };
    case VariantType.Integer:
      return { value: v.asObject() as number, valueType: 'Int32' };
    case VariantType.Long:
      return { value: v.asObject() as bigint, valueType: 'Int64' };
    case VariantType.Decimal:
      return { value: v.asObject() as DataValue, valueType: 'Decimal' };
    case VariantType.Double:
      return { value: v.asObject() as number, valueType: 'Double' };
    case VariantType.DateTime:
      return { value: v.asObject() as DataValue, valueType: 'DateTime' };
    case VariantType.Binary:
      return { value: v.asObject() as Uint8Array, valueType: 'Binary' };
    case VariantType.String:
      return { value: v.asObject() as string, valueType: 'String' };
  }
}

/** A parameter of a command whose value a master dataset may change (IDbDataParameter). */
interface CommandParameter {
  name: string;
  value: StoredValue | undefined;
  valueType: ParameterValueType;
  dbType: ParameterDbType;
}

/** An IDbCommand: the SQL and its parameters. */
interface Command {
  sql: string;
  parameters: CommandParameter[];
}

/** A value of the master of a MyBase dataset (the boxed object C# compares with Equals). */
interface MasterValue {
  type: ParameterValueType;
  value: StoredValue;
}

const DBNULL: MasterValue = { type: 'DBNull', value: null };

/** A dataset at run time. */
export class ReportDataInfo {
  readonly model: DataInfo;
  readonly report: ReportRuntime;
  alias: string;
  databaseAlias: string;
  sql: string;
  dataSource: string;
  openOnStart: boolean;
  /** The SQL that replaces the dataset's own for this run (REOPEN; "" for none). */
  sqlOverride = '';
  /** The rows. */
  readonly data: ReportDataset;
  /** The reader of the last execution (null when closed or when the rows came as a view). */
  dataReader: ResultReader | null = null;
  private command: Command | null = null;
  private connecting = false;
  private oldSQLUsed = '';
  /** The master fields of a MyBase dataset (MyBaseMasterFields, upper case; null until it opens). */
  private masterfieldslist: string[] | null = null;
  /** Their values in the current record of the master (the ViewFilter). */
  private mastervalues: MasterValue[] = [];
  private readonly listener = (master: ReportDataset): Op<void> => this.onDataChange(master);

  constructor(report: ReportRuntime, model: DataInfo) {
    this.report = report;
    this.model = model;
    this.alias = model.alias;
    this.databaseAlias = model.databaseAlias;
    this.sql = model.sql;
    this.dataSource = model.dataSource;
    this.openOnStart = model.openOnStart;
    this.data = report.newDataset();
  }

  get name(): string {
    return this.model.name;
  }

  /** GetDbItem: the report connection of the dataset. */
  getDbItem(): ReportDatabase {
    for (const db of this.report.databases) if (db.alias === this.databaseAlias) return db;
    throw new NamedException('Database alias not found: ' + this.databaseAlias, this.databaseAlias);
  }

  /** GoFirstMem: back to the first record of a view. */
  goFirstMem(): void {
    if (this.data.currentView === null) return;
    this.data.first();
  }

  private ctx() {
    return this.report.evaluator.context;
  }

  /** Connect: opens the dataset (and its master first) and reads the first record. */
  *connect(): Op<void> {
    if (this.connecting) throw new NamedException('Circular datalinks not allowed:' + this.alias, this.alias);
    if (this.data.currentReader !== null || this.data.currentView !== null) return;
    this.connecting = true;
    try {
      const dbitem = this.getDbItem();
      yield* dbitem.connect();
      this.dataReader = null;
      this.data.currentReader = null;
      this.data.currentView = null;
      this.data.updateColumns = true;
      const aparams = this.report.params;
      let mastersource: ReportDataInfo | null = null;
      // Open first the master source
      if (this.dataSource.length > 0) {
        const index = this.report.dataInfoIndexOf(this.dataSource);
        if (index < 0)
          throw new NamedException('Master source not found: ' + this.dataSource + ' in ' + this.alias, this.dataSource);
        mastersource = this.report.dataInfos[index]!;
        this.report.updateParamsBeforeOpen(index, true);
        yield* mastersource.connect();
      }
      const host = this.report.host;
      const override: QueryResult | undefined =
        host.datasetRows === undefined ? undefined : yield* wait(host.datasetRows({ dataset: this.model, alias: this.alias }));
      if (dbitem.driver === DriverType.Mybase || override !== undefined) {
        if (override !== undefined) {
          if (mastersource !== null)
            // C# parity: C# fails here with a NullReferenceException (the view has no command to
            // take the master's values); a host that gives the rows filters them itself.
            throw new NotSupportedYetError(
              'A dataset given by the host (DataViewOverride) with a master dataset (DataSource ' + this.dataSource + ')',
            );
          this.data.currentView = ResultView.fromResult(override, this.report.locale, this.report.culture);
        } else {
          const masterfieldslist = removeBlanks(fromSemiColon(toUpperNet(this.model.myBaseMasterFields)));
          this.masterfieldslist = masterfieldslist;
          this.mastervalues = masterfieldslist.map(() => DBNULL);
          // C# parity: a Mybase dataset without unions opens nothing (no rows, not active).
          if (this.model.dataUnions.length > 0) {
            const ctx = this.unionContext();
            let inttable = yield* this.buildUnion(ctx);
            const lsorting = fromSemiColon(this.model.myBaseIndexFields);
            const nmaster = fromSemiColon(this.model.myBaseMasterFields);
            // The view is sorted by the first index fields, as many as the master fields (one when
            // there are none: "" is one field), the columns FindRows looks the master values up in
            const lnew: string[] = [];
            for (let ix = 0; ix < nmaster.length; ix++) {
              if (ix >= lsorting.length)
                throw argumentOutOfRangeException(
                  "Index was out of range. Must be non-negative and less than the size of the collection. (Parameter 'index')",
                );
              lnew.push(lsorting[ix]!);
            }
            const sortingstring = lnew.join(',');
            // The order of the index fields (IndexFieldNames of the Delphi engine), also the order
            // of the master/detail filter
            if (this.model.myBaseIndexFields.length > 0) {
              const nsort = removeBlanks(fromSemiColon(this.model.myBaseIndexFields));
              inttable = { columns: inttable.columns, rows: orderedRows(inttable, nsort, ctx) };
            }
            this.data.currentView = new UnionView(inttable, sortingstring, ctx);
            if (mastersource !== null) {
              this.updateParams(mastersource.data, this.command);
              this.data.viewFilter = this.masterFilter();
              mastersource.data.onDataChange.push(this.listener);
            }
          }
        }
      } else {
        let sqlsentence = this.sqlOverride.length !== 0 ? this.sqlOverride : this.sql;
        // Assign parameters, string substitution only
        for (const aparam of aparams) {
          switch (aparam.paramType) {
            case ParamType.Subst:
            case ParamType.Multiple:
              if (aparam.datasets.indexOf(this.alias) >= 0)
                sqlsentence = replaceNet(sqlsentence, aparam.search, aparam.value.toImplicitString(this.ctx()) ?? '');
              break;
            case ParamType.SubstExpre:
            case ParamType.SubsExpreList:
              if (aparam.datasets.indexOf(this.alias) >= 0) {
                const nvalue = aparam.lastValue.toString(this.ctx());
                sqlsentence = replaceNet(sqlsentence, aparam.search, nvalue);
              }
              break;
          }
        }
        const command: Command = { sql: sqlsentence, parameters: [] };
        this.command = command;
        this.oldSQLUsed = sqlsentence;
        // Assign parameters
        for (const aparam of aparams) {
          if (aparam.datasets.indexOf(this.alias) >= 0) {
            const pt = aparam.paramType;
            if (pt !== ParamType.Subst && pt !== ParamType.Multiple && pt !== ParamType.SubsExpreList && pt !== ParamType.SubstExpre) {
              const pvalue = variantParameterValue(aparam.lastValue);
              command.parameters.push({
                name: aparam.alias,
                value: pvalue.value as StoredValue,
                valueType: pvalue.valueType,
                dbType: variantDbType(aparam.value),
              });
            }
          }
        }
        if (mastersource !== null) {
          this.updateParams(mastersource.data, command);
          mastersource.data.onDataChange.push(this.listener);
        }
        yield* this.execute(dbitem, command);
      }
    } finally {
      this.connecting = false;
    }
  }

  /** The cultures and the clock of a union: CurrentCulture now (the Locale of its tables too). */
  private unionContext(): UnionContext {
    return { culture: this.report.culture, invariant: this.report.invariant, now: this.ctx().now() };
  }

  /**
   * BuildUnion: the rows of a dataset of the MyBase connection made of other datasets of the
   * report (DataUnions), as TRpDataInfoItem.Connect of the Delphi engine builds them. Each
   * dataset is opened (one already open is read from its current row) and its rows are added to
   * the result. The first dataset gives the columns. Without ParallelUnion the rows of the others
   * follow by position; with GroupUnion a row with the values of the index fields
   * (MyBaseIndexFields) of one already there is added to it. With ParallelUnion the columns of
   * each other dataset are added to the rows of the result (combineParallel).
   */
  private *buildUnion(ctx: UnionContext): Op<UnionTable> {
    const model = this.model;
    const indexFields = removeBlanks(fromSemiColon(model.myBaseIndexFields));
    const translator = this.report.translator;
    let client: UnionTable | null = null;
    let originalFields: string[] = [];
    for (let i = 0; i < model.dataUnions.length; i++) {
      const entry = model.dataUnions[i]!;
      const { alias: sourceAlias, commonFields } = extractUnionFields(entry);
      const index = this.report.dataInfoIndexOf(sourceAlias);
      if (index < 0) throw new NamedException(translator.translateStr(959) + ' - ' + this.alias + ' - ' + entry, this.alias);
      const source = this.report.dataInfos[index]!;
      if (source.data.currentReader === null && source.data.currentView === null) this.report.updateParamsBeforeOpen(index, true);
      yield* source.connect();
      const data = yield* readUnionSource(source.data);
      if (i === 0 || !model.parallelUnion) {
        client = combineAddDataset(client, data, model.groupUnion, indexFields, this.alias, translator.translateStr(960), ctx);
        originalFields = commonFields;
        // An in-memory dataset (another union) goes back to its first row, as CombineAddDataset of the
        // Delphi engine leaves it: a subreport on it prints it whole
        if (source.data.currentView !== null) source.goFirstMem();
      } else {
        if (originalFields.length > 0 && commonFields.length !== originalFields.length)
          throw new NamedException(
            'The common fields of the union ' +
              entry +
              ' in ' +
              this.alias +
              ' must be as many as those of the first dataset: ' +
              originalFields.join(';'),
            this.alias,
          );
        const first: UnionTable = client!;
        const combined = combineParallel(
          first,
          orderedRows(first, indexFields, ctx),
          data,
          'Q' + String(i + 1).padStart(2, '0') + '_',
          commonFields,
          originalFields,
          ctx,
        );
        client = combineAddDataset(null, combined, model.groupUnion, indexFields, this.alias, translator.translateStr(960), ctx);
      }
    }
    return client!;
  }

  /** The values of the master fields as the filter of the view (DBNull is null). */
  private masterFilter(): StoredValue[] {
    return this.mastervalues.map((v) => v.value);
  }

  private *execute(dbitem: ReportDatabase, command: Command): Op<void> {
    const connection = dbitem.connection;
    if (connection === null) throw nullReferenceException();
    const queryCommand: QueryCommand = {
      sql: command.sql,
      parameters: command.parameters.map(
        (p): QueryParameter => ({ name: p.name, value: p.value, valueType: p.valueType, dbType: p.dbType }),
      ),
      dataset: this.alias,
    };
    const result = yield* wait(connection.query(queryCommand));
    if (dbitem.tableResults) {
      this.data.currentView = ResultView.fromResult(result, this.report.locale, this.report.culture);
    } else {
      const areader = new ResultReader(result);
      this.dataReader = areader;
      this.data.currentReader = areader;
    }
  }

  /** The master moved to another record: execute again (or filter again) when its values changed. */
  private *onDataChange(master: ReportDataset): Op<void> {
    if (this.updateParams(master, this.command)) {
      if (this.data.currentView !== null && this.masterfieldslist !== null) {
        this.data.viewFilter = this.masterFilter();
        return;
      }
      const command = this.command!;
      if (this.dataReader !== null) this.dataReader = null;
      const dbitem = this.getDbItem();
      if (dbitem.tableResults) yield* this.execute(dbitem, command);
      else {
        this.data.updateColumns = this.oldSQLUsed !== command.sql;
        yield* this.execute(dbitem, command);
      }
    }
  }

  /**
   * UpdateParams: the parameters of the command named as columns of the master take the values
   * of its current record (C# null when it has none); true when one changed (object.Equals). For
   * a MyBase dataset, the values of its master fields (DBNull when the master has no record).
   */
  private updateParams(master: ReportDataset, command: Command | null): boolean {
    const masterfieldslist = this.masterfieldslist;
    if (this.data.currentView !== null && masterfieldslist !== null) {
      let nresult = false;
      masterfieldslist.forEach((field, idx) => {
        let nvalue = DBNULL;
        if (!master.eof) {
          const row = master.currentRow;
          if (row === null) throw nullReferenceException();
          nvalue = row.boxed(field);
        }
        const old = this.mastervalues[idx]!;
        if (!boxedEquals(nvalue.type, nvalue.value, old.type, old.value)) {
          nresult = true;
          this.mastervalues[idx] = nvalue;
        }
      });
      return nresult;
    }
    if (command === null) throw nullReferenceException();
    let aresult = false;
    for (const param of command.parameters) {
      let paramname = param.name;
      if (paramname.length > 0) {
        if (paramname.charAt(0) === '@') paramname = paramname.substring(1);
        const index = master.columns.length === 0 ? -1 : master.indexOfColumn(paramname);
        if (index >= 0) {
          if (master.eof) {
            if (param.valueType !== 'Null') aresult = true;
            param.value = undefined;
            param.valueType = 'Null';
          } else {
            const row = master.currentRow;
            if (row === null) throw nullReferenceException();
            const cell = row.boxed(paramname);
            if (!boxedEquals(cell.type, cell.value, param.valueType, param.value)) {
              aresult = true;
              param.value = cell.value;
              param.valueType = cell.type;
            }
          }
        }
      }
    }
    return aresult;
  }

  /** DisConnect: closes the dataset and frees its reader. */
  disConnect(): void {
    if (this.dataReader !== null) {
      this.command = null;
      this.dataReader = null;
      this.data.currentReader = null;
    }
    if (this.data.currentView !== null) this.data.currentView = null;
    if (this.data.currentReader !== null) this.data.currentReader = null;
  }

  /** DisConnectMem: frees the view. */
  disConnectMem(): void {
    if (this.data.currentView !== null) this.data.currentView = null;
  }
}

/** ReadUnionSource: the rows of a dataset from its current row to its last one, with its columns. */
function* readUnionSource(data: ReportDataset): Op<UnionTable> {
  const table: UnionTable = { columns: data.columns.map((c) => ({ name: c.name, type: c.type, maxLength: -1 })), rows: [] };
  while (!data.eof) {
    const row = data.currentRow;
    if (row === null) break;
    table.rows.push([...row.values]);
    yield* data.next();
  }
  return table;
}
