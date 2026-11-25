import {
  ChangeObjectOperation,
  DataInfo,
  DriverType,
  OperationType,
  PropertyType,
  Report,
} from "@reportman/lib";
import { ReportDatasetHelper } from "./report-dataset-helper";

/** The inspector type of the unions of a dataset: a text cell with an ellipsis that opens the dialog. */
export const UNIONS_PROPERTY_TYPE = "UNIONS";

/** The engine's string number of the category of the dataset columns in the function list. */
const FIELDS_CATEGORY_KEY = 247;

/** The fields of a dataset as the designer knows them (null when it does not know them). */
export type DatasetFieldsOf = (alias: string) => string[] | null;

function nonEmpty(items: readonly string[] | null | undefined, separator?: string): string[] {
  const result: string[] = [];
  for (const item of items ?? []) {
    const parts = separator === undefined ? [item] : (item ?? "").split(separator);
    for (const part of parts) {
      const trimmed = (part ?? "").trim();
      if (trimmed.length > 0) result.push(trimmed);
    }
  }
  return result;
}

/** The dataset is on a MyBase connection: it runs no SQL, it may join other datasets. */
export function isMyBaseDataset(report: Report | undefined, dataInfo: DataInfo | undefined): boolean {
  if (!report || !dataInfo) return false;
  const alias = (dataInfo.databaseAlias ?? "").toUpperCase();
  for (const dbinfo of report.databaseInfo ?? []) {
    if ((dbinfo.alias ?? "").toUpperCase() === alias) {
      const driver = dbinfo.driver as unknown;
      // The server sends the enum as a number; accept its name too.
      return driver === DriverType.Mybase || (typeof driver === "string" && driver.toUpperCase() === "MYBASE");
    }
  }
  return false;
}

/**
 * The union of a dataset of the MyBase connection: the datasets it joins (dataUnions, "ALIAS" or
 * "ALIAS-FIELD1;FIELD2" with the fields a parallel union matches by, the format of Delphi), and how
 * (parallelUnion, groupUnion, myBaseIndexFields). The C# designer's UnionSettings.
 */
export class UnionSettings {
  public entries: string[] = [];
  public parallel = false;
  public group = false;
  public indexFields = "";

  /** The settings of a dataset. */
  public static of(info: DataInfo): UnionSettings {
    const settings = new UnionSettings();
    settings.entries = nonEmpty(info.dataUnions);
    settings.parallel = !!info.parallelUnion;
    settings.group = !!info.groupUnion;
    settings.indexFields = info.myBaseIndexFields ?? "";
    return settings;
  }

  /** A copy that the dialog can change without touching these ones. */
  public clone(): UnionSettings {
    const copy = new UnionSettings();
    copy.entries = [...this.entries];
    copy.parallel = this.parallel;
    copy.group = this.group;
    copy.indexFields = this.indexFields;
    return copy;
  }

  /** Writes the settings to a dataset (without undo: see applyUnionSettings). */
  public applyTo(info: DataInfo): void {
    info.dataUnions = [...this.entries];
    info.parallelUnion = this.parallel;
    info.groupUnion = this.group;
    info.myBaseIndexFields = this.indexFields.trim();
  }

  /** The text of the unions in the inspector: the entries separated by commas. */
  public static summary(info: DataInfo): string {
    return nonEmpty(info.dataUnions).join(", ");
  }

  /** The entries of a text of the inspector (separated by commas). */
  public static parseSummary(text: string | null | undefined): string[] {
    return nonEmpty([text ?? ""], ",");
  }

  /** The dataset alias of an entry. */
  public static aliasOf(entry: string): string {
    const index = entry.indexOf("-");
    return index < 0 ? entry : entry.substring(0, index);
  }

  /** The common fields of an entry, as written ("" without them). */
  public static fieldsOf(entry: string): string {
    const index = entry.indexOf("-");
    return index < 0 ? "" : entry.substring(index + 1);
  }

  /** An entry from an alias and its common fields. */
  public static entryOf(alias: string, fields: string | null | undefined): string {
    const list = nonEmpty([fields ?? ""], ";");
    return list.length === 0 ? alias : alias + "-" + list.join(";");
  }

  /** The common fields of an entry, in upper case. */
  public static commonFieldsOf(entry: string): string[] {
    return nonEmpty([UnionSettings.fieldsOf(entry)], ";").map((f) => f.toUpperCase());
  }

  /**
   * What the engine would refuse, or null: a grouped union without index fields, a parallel union
   * whose datasets do not name as many common fields as the first one.
   */
  public validate(translate: (key: number) => string): string | null {
    if (this.group && this.indexFields.trim().length === 0) {
      return translate(1084) + ": " + translate(164);
    }
    if (this.parallel && this.entries.length > 1) {
      const first = UnionSettings.commonFieldsOf(this.entries[0]).length;
      if (first > 0) {
        for (let i = 1; i < this.entries.length; i++) {
          if (UnionSettings.commonFieldsOf(this.entries[i]).length !== first) {
            return translate(1444) + ": " + this.entries[i];
          }
        }
      }
    }
    return null;
  }

  /**
   * The columns the union gives (null when the fields of a dataset are not known): those of the first
   * dataset and, in a parallel union, for each other one Qnn_ and its fields with the prefix but the
   * common ones (the engine's DataInfo.CombineParallel).
   */
  public resultColumns(fieldsOf: DatasetFieldsOf): string[] | null {
    const columns: string[] = [];
    for (let i = 0; i < this.entries.length; i++) {
      const fields = fieldsOf(UnionSettings.aliasOf(this.entries[i]));
      if (!fields) return null;
      if (i === 0) {
        columns.push(...fields);
        continue;
      }
      if (!this.parallel) continue;
      const prefix = "Q" + String(i + 1).padStart(2, "0") + "_";
      const common = UnionSettings.commonFieldsOf(this.entries[i]);
      columns.push(prefix);
      for (const field of fields) {
        if (!common.includes(field.toUpperCase())) columns.push(prefix + field);
      }
    }
    return columns;
  }
}

/**
 * The fields of a dataset the designer knows: those the server gave as a dataset, or the columns of
 * the function list ("ALIAS.FIELD", what the expression editor shows). Null when it knows none.
 */
export function knownDatasetFields(helper: ReportDatasetHelper | undefined, alias: string): string[] | null {
  const upper = alias.toUpperCase();
  const dataset = helper?.dataSets?.find((d) => (d.name ?? "").toUpperCase() === upper);
  if (dataset?.columns?.length) return dataset.columns.map((c) => c.name);
  if (!helper?.functions) return null;
  const prefix = upper + ".";
  const fields: string[] = [];
  for (const f of helper.functions) {
    if (f.categoryKey === FIELDS_CATEGORY_KEY && (f.name ?? "").toUpperCase().startsWith(prefix)) {
      fields.push(f.name.substring(prefix.length));
    }
  }
  return fields.length ? fields : null;
}

/**
 * Writes the settings of the dialog to a dataset as one undo step: a single operation with every
 * property that changes (the C# designer's ObjectInspector.ApplyWithUndo). Returns it, or undefined
 * when nothing changes.
 */
export function applyUnionSettings(
  report: Report,
  info: DataInfo,
  settings: UnionSettings
): ChangeObjectOperation | undefined {
  const target = new DataInfo();
  settings.applyTo(target);
  const oldUnions = [...(info.dataUnions ?? [])];
  const changes: { name: string; type: PropertyType; oldValue: any; newValue: any }[] = [];
  if (oldUnions.length !== target.dataUnions.length || oldUnions.some((e, i) => e !== target.dataUnions[i])) {
    changes.push({ name: "dataUnions", type: PropertyType.StringArray, oldValue: oldUnions, newValue: [...target.dataUnions] });
  }
  if (!!info.parallelUnion !== target.parallelUnion) {
    changes.push({ name: "parallelUnion", type: PropertyType.Boolean, oldValue: !!info.parallelUnion, newValue: target.parallelUnion });
  }
  if (!!info.groupUnion !== target.groupUnion) {
    changes.push({ name: "groupUnion", type: PropertyType.Boolean, oldValue: !!info.groupUnion, newValue: target.groupUnion });
  }
  if ((info.myBaseIndexFields ?? "") !== (target.myBaseIndexFields ?? "")) {
    changes.push({ name: "myBaseIndexFields", type: PropertyType.String, oldValue: info.myBaseIndexFields, newValue: target.myBaseIndexFields });
  }
  if (!changes.length) return undefined;
  const op = new ChangeObjectOperation(OperationType.Modify, report.undoCue ? report.undoCue.getGroupId() : 0);
  op.componentClass = info.className;
  op.componentName = info.name;
  for (const change of changes) {
    op.addProperty(change.name, change.type, change.oldValue, change.newValue);
  }
  settings.applyTo(info);
  if (report.undoCue) report.undoCue.addOperation(op, report);
  else report.modified = true;
  return op;
}
