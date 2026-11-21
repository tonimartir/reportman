// Ports of IdenField and DatasetAlias.FindField: how an expression reaches the fields of the
// report datasets (ALIAS.FIELD or a bare FIELD). The data layer implements FieldTable; MemoryTable
// is a small in-memory one.

import { toUpperNet } from '../util/chars.js';
import { UnNamedException } from '../util/netexception.js';
import { Translator } from '../util/translator.js';
import { Variant } from '../variant/variant.js';
import { EvalIdentifier } from './identifiers.js';

/** The rows of a dataset as the evaluator reads them (the role of a DataTable). */
export interface FieldTable {
  /** DataTable.Columns.IndexOf: the index of the column (case-insensitive), or -1. */
  indexOfColumn(name: string): number;
  /**
   * The value of the column in a row, as a host value (see Variant.fromHost) or a Variant. A
   * dataset without a current row returns null (Null), as a ReportDataset does.
   */
  getValue(row: number, column: string): unknown;
}

/** One dataset alias: its name, its rows and the current row. */
export interface AliasEntry {
  alias: string;
  data: FieldTable | null;
  currentRow: number;
}

/** What the evaluator needs to resolve field names (DatasetAlias in C#). */
export interface FieldResolver {
  /**
   * DatasetAlias.FindField: with an empty dataset name, the field in any alias (duplicated when
   * two aliases have it); otherwise the field of that alias. Names arrive in upper case.
   */
  findField(fieldName: string, datasetName: string): { iden: EvalIdentifier | null; duplicated: boolean };
}

/** IdenField: the value of a field in the current row of a dataset. */
export class IdenField extends EvalIdentifier {
  field: string | null = null;
  data: FieldTable | null = null;
  currentRow = 0;
  translator: Translator = Translator.english;

  constructor() {
    super(null);
  }

  protected setValue(_value: Variant): void {
    throw new UnNamedException(this.translator.translateStr(365));
  }

  protected getValue(): Variant {
    if (this.data !== null && this.field !== null) return Variant.fromHost(this.data.getValue(this.currentRow, this.field));
    return Variant.null;
  }
}

/** DatasetAlias: the list of aliases and the shared IdenField that FindField returns. */
export class DatasetAlias implements FieldResolver {
  readonly list: AliasEntry[] = [];
  private readonly iden = new IdenField();

  /** Adds an alias (the name is stored in upper case, as the report engine does). */
  add(alias: string, data: FieldTable | null, currentRow = 0): AliasEntry {
    const entry: AliasEntry = { alias: toUpperNet(alias), data, currentRow };
    this.list.push(entry);
    return entry;
  }

  findField(fieldname: string, datasetname: string): { iden: EvalIdentifier | null; duplicated: boolean } {
    let duplicated = false;
    let adata: FieldTable | null = null;
    let acolumn: string | null = null;
    let acurrentrow = 0;
    if (datasetname.length === 0) {
      for (const item of this.list) {
        const table = item.data;
        if (table !== null) {
          if (table.indexOfColumn(fieldname) >= 0) {
            if (acolumn !== null) {
              duplicated = true;
              break;
            }
            acolumn = fieldname;
            adata = table;
            acurrentrow = item.currentRow;
          }
        }
      }
    } else {
      for (const item of this.list) {
        if (item.alias === datasetname) {
          const table = item.data;
          if (table !== null && table.indexOfColumn(fieldname) >= 0) {
            adata = table;
            acolumn = fieldname;
            acurrentrow = item.currentRow;
            break;
          }
        }
      }
    }
    if (acolumn !== null) {
      this.iden.field = acolumn;
      this.iden.data = adata;
      this.iden.currentRow = acurrentrow;
      return { iden: this.iden, duplicated };
    }
    return { iden: null, duplicated };
  }
}

/** An in-memory FieldTable: column names and rows of host values. */
export class MemoryTable implements FieldTable {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];

  constructor(columns: readonly string[], rows: readonly (readonly unknown[])[]) {
    this.columns = columns;
    this.rows = rows;
  }

  indexOfColumn(name: string): number {
    const exact = this.columns.indexOf(name);
    if (exact >= 0) return exact;
    const upper = toUpperNet(name);
    return this.columns.findIndex((c) => toUpperNet(c) === upper);
  }

  getValue(row: number, column: string): unknown {
    if (row < 0 || row >= this.rows.length) return null;
    const index = this.indexOfColumn(column);
    if (index < 0) return null;
    return this.rows[row]![index];
  }
}
