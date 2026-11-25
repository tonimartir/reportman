import { DataInfo, DriverType, PropertyType, Report, ReportItem, hydrateReport } from "@reportman/lib";
import { TranslationService } from "../services/translator.service";
import { DesignerInterfaceDataInfo } from "./designer-interface-datainfo";
import { ReportDatasetHelper } from "./report-dataset-helper";
import {
  UNIONS_PROPERTY_TYPE,
  UnionSettings,
  applyUnionSettings,
  isMyBaseDataset,
  knownDatasetFields,
} from "./union-settings";

/**
 * The datasets of year-over-year.rep as the designer's server sends them: four SQL datasets on
 * SAMPLES and two parallel unions on MEMORY (driver MyBase), BY_CATEGORY matched by CATEGORY and
 * TOP_PRODUCTS by position.
 */
function yearOverYear(): Report {
  const sqlDataset = (n: number, alias: string) => ({
    className: "TRPDATAINFOITEM",
    name: "TRPDATAINFOITEM" + n,
    alias,
    databaseAlias: "SAMPLES",
    sql: "SELECT ...",
    dataUnions: [],
    parallelUnion: false,
    groupUnion: false,
    openOnStart: true,
  });
  return hydrateReport({
    databaseInfo: [
      { className: "TRPDATABASEINFOITEM", name: "TRPDATABASEINFOITEM1", alias: "SAMPLES", driver: DriverType.DotNet2 },
      { className: "TRPDATABASEINFOITEM", name: "TRPDATABASEINFOITEM2", alias: "MEMORY", driver: DriverType.Mybase },
    ],
    dataInfo: [
      sqlDataset(1, "CATEGORY_FIRST"),
      sqlDataset(2, "CATEGORY_SECOND"),
      sqlDataset(3, "TOP_FIRST"),
      sqlDataset(4, "TOP_SECOND"),
      {
        className: "TRPDATAINFOITEM",
        name: "TRPDATAINFOITEM5",
        alias: "BY_CATEGORY",
        databaseAlias: "MEMORY",
        sql: "",
        dataUnions: ["CATEGORY_FIRST-CATEGORY", "CATEGORY_SECOND-CATEGORY"],
        parallelUnion: true,
        groupUnion: false,
        myBaseIndexFields: "",
        myBaseMasterFields: "",
      },
      {
        className: "TRPDATAINFOITEM",
        name: "TRPDATAINFOITEM6",
        alias: "TOP_PRODUCTS",
        databaseAlias: "MEMORY",
        sql: "",
        dataUnions: ["TOP_FIRST", "TOP_SECOND"],
        parallelUnion: true,
        groupUnion: false,
      },
    ],
    subReports: [],
    params: [],
  });
}

const FIELDS: Record<string, string[]> = {
  CATEGORY_FIRST: ["CATEGORY", "ORDERS", "SALES"],
  CATEGORY_SECOND: ["CATEGORY", "ORDERS", "SALES"],
  TOP_FIRST: ["PRODUCT", "SALES"],
  TOP_SECOND: ["PRODUCT", "SALES"],
};
const fieldsOf = (alias: string) => FIELDS[alias.toUpperCase()] ?? null;

function dataset(report: Report, alias: string): DataInfo {
  return report.dataInfo.find((d) => d.alias === alias)!;
}

function rows(report: Report, info: DataInfo, translator: TranslationService) {
  const items = new Map<number, ReportItem>([[0, info]]);
  const inter = new DesignerInterfaceDataInfo(report, items, { refreshSubReport: () => undefined }, translator);
  const names: string[] = [];
  const labels: string[] = [];
  const types: string[] = [];
  const values: any[] = [];
  inter.GetProperties(names, labels, types, values, [], []);
  return { inter, names, labels, types, values, value: (name: string) => values[names.indexOf(name)] };
}

describe("UnionSettings", () => {
  const translator = new TranslationService();
  const tr = (key: number) => translator.TranslateStr(key);
  beforeAll(async () => {
    await translator.setLang("en");
  });

  it("reads the entries of a dataset, joins them for the inspector and parses them back", () => {
    const report = yearOverYear();
    const byCategory = dataset(report, "BY_CATEGORY");
    expect(UnionSettings.summary(byCategory)).toBe("CATEGORY_FIRST-CATEGORY, CATEGORY_SECOND-CATEGORY");
    expect(UnionSettings.parseSummary("CATEGORY_FIRST-CATEGORY , CATEGORY_SECOND-CATEGORY,")).toEqual([
      "CATEGORY_FIRST-CATEGORY",
      "CATEGORY_SECOND-CATEGORY",
    ]);
    expect(UnionSettings.parseSummary("  ")).toEqual([]);
    expect(UnionSettings.parseSummary(undefined)).toEqual([]);
    const settings = UnionSettings.of(byCategory);
    expect(settings.entries).toEqual(["CATEGORY_FIRST-CATEGORY", "CATEGORY_SECOND-CATEGORY"]);
    expect(settings.parallel).toBe(true);
    expect(settings.group).toBe(false);
    expect(settings.indexFields).toBe("");
  });

  it("keeps the format of Delphi for an entry: ALIAS-FIELD1;FIELD2", () => {
    expect(UnionSettings.aliasOf("TOP_FIRST")).toBe("TOP_FIRST");
    expect(UnionSettings.aliasOf("CATEGORY_FIRST-CATEGORY;YEAR")).toBe("CATEGORY_FIRST");
    expect(UnionSettings.fieldsOf("TOP_FIRST")).toBe("");
    expect(UnionSettings.fieldsOf("CATEGORY_FIRST-CATEGORY;YEAR")).toBe("CATEGORY;YEAR");
    expect(UnionSettings.entryOf("TOP_FIRST", "")).toBe("TOP_FIRST");
    expect(UnionSettings.entryOf("TOP_FIRST", " PRODUCT ; ;SALES;")).toBe("TOP_FIRST-PRODUCT;SALES");
    expect(UnionSettings.commonFieldsOf("TOP_FIRST-product;Sales")).toEqual(["PRODUCT", "SALES"]);
  });

  it("refuses what the engine would", () => {
    const settings = new UnionSettings();
    settings.entries = ["TOP_FIRST", "TOP_SECOND"];
    expect(settings.validate(tr)).toBeNull();
    settings.group = true;
    expect(settings.validate(tr)).toBe("Union grouping: Index fields");
    settings.indexFields = "PRODUCT";
    expect(settings.validate(tr)).toBeNull();
    settings.group = false;
    settings.parallel = true;
    settings.entries = ["TOP_FIRST-PRODUCT", "TOP_SECOND"];
    expect(settings.validate(tr)).toBe(tr(1444) + ": TOP_SECOND");
    settings.entries = ["TOP_FIRST-PRODUCT", "TOP_SECOND-PRODUCT;SALES"];
    expect(settings.validate(tr)).toBe(tr(1444) + ": TOP_SECOND-PRODUCT;SALES");
    settings.entries = ["TOP_FIRST-PRODUCT", "TOP_SECOND-PRODUCT"];
    expect(settings.validate(tr)).toBeNull();
    // Without common fields in the first one the rows are paired by position: nothing to match
    settings.entries = ["TOP_FIRST", "TOP_SECOND-PRODUCT"];
    expect(settings.validate(tr)).toBeNull();
    // A normal union does not match fields
    settings.parallel = false;
    settings.entries = ["TOP_FIRST-PRODUCT", "TOP_SECOND"];
    expect(settings.validate(tr)).toBeNull();
  });

  it("gives the columns of the union as the engine builds them", () => {
    const report = yearOverYear();
    const top = UnionSettings.of(dataset(report, "TOP_PRODUCTS"));
    expect(top.resultColumns(fieldsOf)).toEqual(["PRODUCT", "SALES", "Q02_", "Q02_PRODUCT", "Q02_SALES"]);
    const byCategory = UnionSettings.of(dataset(report, "BY_CATEGORY"));
    expect(byCategory.resultColumns(fieldsOf)).toEqual(["CATEGORY", "ORDERS", "SALES", "Q02_", "Q02_ORDERS", "Q02_SALES"]);
    // A third dataset gets its own prefix
    byCategory.entries.push("TOP_FIRST-PRODUCT");
    expect(byCategory.resultColumns(fieldsOf)?.slice(6)).toEqual(["Q03_", "Q03_SALES"]);
    // A normal union gives the columns of the first dataset
    top.parallel = false;
    expect(top.resultColumns(fieldsOf)).toEqual(["PRODUCT", "SALES"]);
    // Unknown when the fields of a dataset are not known
    top.entries.push("NOT_OPENED");
    expect(top.resultColumns(fieldsOf)).toBeNull();
    expect(new UnionSettings().resultColumns(fieldsOf)).toEqual([]);
  });

  it("finds the fields of a dataset in what the server gave", () => {
    const helper = new ReportDatasetHelper();
    expect(knownDatasetFields(helper, "TOP_FIRST")).toBeNull();
    helper.functions = [
      { name: "TOP_FIRST.PRODUCT", category: "Fields", categoryKey: 247 },
      { name: "TOP_FIRST.SALES", category: "Fields", categoryKey: 247 },
      { name: "TOP_FIRST_OLD.PRODUCT", category: "Fields", categoryKey: 247 },
      { name: "TOP_FIRST.UPPER", category: "Functions", categoryKey: 248 },
    ];
    expect(knownDatasetFields(helper, "top_first")).toEqual(["PRODUCT", "SALES"]);
    expect(knownDatasetFields(helper, "TOP_SECOND")).toBeNull();
    helper.dataSets = [{ name: "TOP_SECOND", columns: [{ name: "PRODUCT", dbType: "String" }, { name: "TOTAL", dbType: "Decimal" }] }];
    expect(knownDatasetFields(helper, "TOP_SECOND")).toEqual(["PRODUCT", "TOTAL"]);
  });

  it("knows a dataset of the MyBase connection, by number or by name of the driver", () => {
    const report = yearOverYear();
    expect(isMyBaseDataset(report, dataset(report, "BY_CATEGORY"))).toBe(true);
    expect(isMyBaseDataset(report, dataset(report, "TOP_FIRST"))).toBe(false);
    (report.databaseInfo[1] as any).driver = "Mybase";
    expect(isMyBaseDataset(report, dataset(report, "BY_CATEGORY"))).toBe(true);
    const orphan = new DataInfo();
    orphan.databaseAlias = "NOWHERE";
    expect(isMyBaseDataset(report, orphan)).toBe(false);
  });
});

describe("The inspector rows of a dataset", () => {
  const translator = new TranslationService();
  beforeAll(async () => {
    await translator.setLang("en");
  });

  it("a MyBase dataset shows its unions instead of the SQL", () => {
    const report = yearOverYear();
    const { inter, names, labels, types, value } = rows(report, dataset(report, "BY_CATEGORY"), translator);
    expect(inter.isMyBase).toBe(true);
    expect(names).not.toContain("sql");
    expect(names).toEqual([
      "alias",
      "databaseAlias",
      "dataSource",
      "dataUnions",
      "parallelUnion",
      "groupUnion",
      "myBaseIndexFields",
      "myBaseMasterFields",
    ]);
    expect(labels.slice(3)).toEqual(["Unions", "Parallel union", "Union grouping", "Index fields", "Master fields"]);
    expect(types[3]).toBe(UNIONS_PROPERTY_TYPE);
    expect(types[4]).toBe(translator.TranslateStr(568));
    expect(types[6]).toBe(translator.TranslateStr(557));
    expect(value("dataUnions")).toBe("CATEGORY_FIRST-CATEGORY, CATEGORY_SECOND-CATEGORY");
    expect(value("parallelUnion")).toBe(true);
    expect(value("groupUnion")).toBe(false);
    expect(inter.GetProperty("dataUnions")).toBe("CATEGORY_FIRST-CATEGORY, CATEGORY_SECOND-CATEGORY");
  });

  it("a SQL dataset has its SQL and no unions", () => {
    const report = yearOverYear();
    const { names } = rows(report, dataset(report, "CATEGORY_FIRST"), translator);
    expect(names).toEqual(["alias", "databaseAlias", "dataSource", "sql"]);
  });

  it("the rows follow the connection of the dataset", () => {
    const report = yearOverYear();
    const info = dataset(report, "TOP_FIRST");
    info.databaseAlias = "MEMORY";
    expect(rows(report, info, translator).names).toContain("dataUnions");
    info.databaseAlias = "SAMPLES";
    expect(rows(report, info, translator).names).toContain("sql");
  });

  it("typing in the cells sets the dataset", () => {
    const report = yearOverYear();
    const info = dataset(report, "BY_CATEGORY");
    const { inter } = rows(report, info, translator);
    const before = info.dataUnions;
    inter.SetProperty("dataUnions", "CATEGORY_FIRST-CATEGORY , CATEGORY_SECOND-CATEGORY,TOP_FIRST,");
    expect(info.dataUnions).toEqual(["CATEGORY_FIRST-CATEGORY", "CATEGORY_SECOND-CATEGORY", "TOP_FIRST"]);
    // A new list: the undo history may hold the old one
    expect(info.dataUnions).not.toBe(before);
    expect(before).toEqual(["CATEGORY_FIRST-CATEGORY", "CATEGORY_SECOND-CATEGORY"]);
    inter.SetProperty("parallelUnion", false);
    inter.SetProperty("groupUnion", true);
    inter.SetProperty("myBaseIndexFields", " CATEGORY ");
    inter.SetProperty("myBaseMasterFields", " CATEGORY;YEAR ");
    expect(info.parallelUnion).toBe(false);
    expect(info.groupUnion).toBe(true);
    expect(info.myBaseIndexFields).toBe("CATEGORY");
    expect(info.myBaseMasterFields).toBe("CATEGORY;YEAR");
  });
});

describe("applyUnionSettings", () => {
  it("writes the changes of the dialog as one undo step, and they are undone together", () => {
    const report = yearOverYear();
    const top = dataset(report, "TOP_PRODUCTS");
    const settings = UnionSettings.of(top);
    settings.entries = ["TOP_FIRST-PRODUCT", "TOP_SECOND-PRODUCT", "CATEGORY_FIRST"];
    settings.group = true;
    settings.indexFields = " PRODUCT ";
    const operations = report.undoCue!.undoOperations.length;
    const op = applyUnionSettings(report, top, settings);
    expect(op).toBeDefined();
    expect(report.undoCue!.undoOperations.length).toBe(operations + 1);
    expect(op!.properties.map((p) => p.propertyName)).toEqual(["dataUnions", "groupUnion", "myBaseIndexFields"]);
    expect(op!.properties[0].propertyType).toBe(PropertyType.StringArray);
    expect(UnionSettings.summary(top)).toBe("TOP_FIRST-PRODUCT, TOP_SECOND-PRODUCT, CATEGORY_FIRST");
    expect(top.groupUnion).toBe(true);
    expect(top.myBaseIndexFields).toBe("PRODUCT");
    expect(report.modified).toBe(true);

    // The dialog's settings are not the dataset's: changing them later does not change the history
    settings.entries.push("TOP_SECOND");
    expect(op!.properties[0].newValue).toEqual(["TOP_FIRST-PRODUCT", "TOP_SECOND-PRODUCT", "CATEGORY_FIRST"]);

    report.undoCue!.undo(report);
    expect(UnionSettings.summary(top)).toBe("TOP_FIRST, TOP_SECOND");
    expect(top.parallelUnion).toBe(true);
    expect(top.groupUnion).toBe(false);
    expect(top.myBaseIndexFields ?? "").toBe("");
    expect(report.undoCue!.undoOperations.length).toBe(operations);

    report.undoCue!.redo(report);
    expect(UnionSettings.summary(top)).toBe("TOP_FIRST-PRODUCT, TOP_SECOND-PRODUCT, CATEGORY_FIRST");
    expect(top.groupUnion).toBe(true);
  });

  it("records nothing when nothing changes", () => {
    const report = yearOverYear();
    const top = dataset(report, "TOP_PRODUCTS");
    expect(applyUnionSettings(report, top, UnionSettings.of(top))).toBeUndefined();
    expect(report.undoCue!.undoOperations.length).toBe(0);
  });
});
