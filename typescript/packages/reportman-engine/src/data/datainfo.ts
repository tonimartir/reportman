// Port of the runtime part of Reportman.Reporting.DataInfo: a dataset of the report, opened
// (Connect) through its report connection with the substitution and the typed parameters of the
// report, re-executed when its master dataset (DataSource) moves to another record.

import { DriverType, type DataInfo } from 'reportman-lib';
import { replaceNet } from '../util/chars.js';
import { NamedException, nullReferenceException } from '../util/netexception.js';
import { ParamType, Variant, VariantType } from '../variant/variant.js';
import type { ReportRuntime } from '../report/report.js';
import { boxedEquals, type StoredValue } from './columns.js';
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
        } else if (this.model.dataUnions.length > 0) {
          throw new NotSupportedYetError('The in-memory unions of datasets (Mybase DataUnions) of ' + this.alias);
        }
        // C# parity: a Mybase dataset without unions opens nothing (no rows, not active).
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

  /** The master moved to another record: execute again when its values changed. */
  private *onDataChange(master: ReportDataset): Op<void> {
    const command = this.command;
    if (command === null) throw nullReferenceException();
    if (this.updateParams(master, command)) {
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
   * of its current record (C# null when it has none); true when one changed (object.Equals).
   */
  private updateParams(master: ReportDataset, command: Command): boolean {
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

