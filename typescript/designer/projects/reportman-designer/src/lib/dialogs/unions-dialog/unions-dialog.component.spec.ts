import { ApplicationRef } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from "@angular/material/dialog";
import { MATERIAL_ANIMATIONS } from "@angular/material/core";
import {
  DataInfo,
  DriverType,
  FunctionHelp,
  PropertyType,
  ReadReportOperation,
  ReadReportRequest,
  Report,
  hydrateReport,
} from "@reportman/lib";
import { TranslationService } from "../../services/translator.service";
import { PresentacionService } from "../../shell/presentacion.service";
import { UnionSettings } from "../../models/union-settings";
import { ObjectInspectorComponent, PropertyValue } from "../../object-inspector/object-inspector.component";
import { PeticionUnionsDialog, UnionsDialogComponent } from "./unions-dialog.component";

/** The datasets of year-over-year.rep (SQL on SAMPLES, parallel unions on MEMORY, driver MyBase). */
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

/** The dataset columns as the designer's server lists them (ReadFunctionsColumns). */
const COLUMN_FUNCTIONS: FunctionHelp[] = [
  ["CATEGORY_FIRST", "CATEGORY"],
  ["CATEGORY_FIRST", "ORDERS"],
  ["CATEGORY_FIRST", "SALES"],
  ["CATEGORY_SECOND", "CATEGORY"],
  ["CATEGORY_SECOND", "ORDERS"],
  ["CATEGORY_SECOND", "SALES"],
  ["TOP_FIRST", "PRODUCT"],
  ["TOP_FIRST", "SALES"],
  ["TOP_SECOND", "PRODUCT"],
  ["TOP_SECOND", "SALES"],
].map(([alias, field]) => ({ name: alias + "." + field, category: "Fields", categoryKey: 247 }));

const FIELDS: Record<string, string[]> = {};
for (const f of COLUMN_FUNCTIONS) {
  const [alias, field] = f.name.split(".");
  (FIELDS[alias] ??= []).push(field);
}

function dataset(report: Report, alias: string): DataInfo {
  return report.dataInfo.find((d) => d.alias === alias)!;
}

function configure() {
  TestBed.configureTestingModule({
    providers: [{ provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } }],
  });
}

describe("UnionsDialogComponent", () => {
  let fixture: ComponentFixture<UnionsDialogComponent>;
  let element: HTMLElement;
  let close: ReturnType<typeof vi.fn>;
  let report: Report;

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function open(alias: string, fieldsOf: (alias: string) => string[] | null = (a) => FIELDS[a] ?? null) {
    report = yearOverYear();
    const peticion = new PeticionUnionsDialog();
    peticion.report = report;
    peticion.dataInfo = dataset(report, alias);
    peticion.fieldsOf = fieldsOf;
    close = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: MAT_DIALOG_DATA, useValue: { peticion } },
        { provide: MatDialogRef, useValue: { close } },
      ],
    });
    await TestBed.inject(TranslationService).setLang("en");
    fixture = TestBed.createComponent(UnionsDialogComponent);
    element = fixture.nativeElement as HTMLElement;
    await settle();
    return fixture.componentInstance;
  }

  const options = (selector: string) =>
    Array.from(element.querySelectorAll<HTMLOptionElement>(selector + " option")).map((o) => o.textContent?.trim());
  const columns = () => element.querySelector(".ud-columns")?.textContent?.trim();
  const buttons = (selector: string) => Array.from(element.querySelectorAll<HTMLButtonElement>(selector + " button"));
  const fieldBoxes = () => Array.from(element.querySelectorAll<HTMLInputElement>(".ud-field-list input[type=checkbox]"));
  const fieldsText = () => element.querySelector<HTMLInputElement>(".ud-fields-text")!;

  async function selectOption(selector: string, index: number) {
    const select = element.querySelector<HTMLSelectElement>(selector)!;
    select.selectedIndex = index;
    select.dispatchEvent(new Event("change"));
    await settle();
  }

  async function type(input: HTMLInputElement, text: string) {
    input.value = text;
    input.dispatchEvent(new Event("input"));
    await settle();
  }

  afterEach(() => TestBed.resetTestingModule());

  it("shows the datasets of the report, the union, its common fields and the columns it gives", async () => {
    await open("TOP_PRODUCTS");
    expect(element.querySelector(".ud-title")?.textContent?.trim()).toBe("Unions - TOP_PRODUCTS");
    expect(options("#ud-available")).toEqual(["CATEGORY_FIRST", "CATEGORY_SECOND", "TOP_FIRST", "TOP_SECOND", "BY_CATEGORY"]);
    expect(options("#ud-unions")).toEqual(["TOP_FIRST", "TOP_SECOND"]);
    expect(columns()).toBe("Columns: PRODUCT, SALES, Q02_, Q02_PRODUCT, Q02_SALES");
    // The first entry is selected: the fields of TOP_FIRST, none ticked (paired by position)
    expect(fieldBoxes().map((b) => b.parentElement?.textContent?.trim())).toEqual(["PRODUCT", "SALES"]);
    expect(fieldBoxes().every((b) => !b.checked && !b.disabled)).toBe(true);
    expect(fieldsText().disabled).toBe(false);
    const parallel = element.querySelector<HTMLInputElement>(".ud-parallel input")!;
    expect(parallel.checked).toBe(true);
    expect(element.querySelector(".ud-parallel")?.getAttribute("title")).toBe(
      TestBed.inject(TranslationService).TranslateStr(1441)
    );
    const labels = Array.from(element.querySelectorAll("label.rpd-field-label")).map((l) => l.textContent?.trim());
    expect(labels).toEqual(["Available", "Unions"]);
    expect(buttons(".ud-actions").map((b) => b.textContent?.trim())).toEqual(["OK", "Cancel"]);
  });

  it("refuses common fields named only by the first dataset, and accepts the same number", async () => {
    const dialog = await open("TOP_PRODUCTS");
    // Tick PRODUCT in TOP_FIRST
    fieldBoxes()[0].click();
    await settle();
    expect(options("#ud-unions")).toEqual(["TOP_FIRST-PRODUCT", "TOP_SECOND"]);
    expect(fieldsText().value).toBe("PRODUCT");
    buttons(".ud-actions")[0].click();
    await settle();
    expect(element.querySelector(".ud-problem-text")?.textContent?.trim()).toBe(
      "Common fields that match with the first dataset, semicolon separated: TOP_SECOND"
    );
    expect(close).not.toHaveBeenCalled();
    // Write PRODUCT for TOP_SECOND
    await selectOption("#ud-unions", 1);
    expect(dialog.selectedIndex).toBe(1);
    await type(fieldsText(), "PRODUCT");
    expect(options("#ud-unions")).toEqual(["TOP_FIRST-PRODUCT", "TOP_SECOND-PRODUCT"]);
    expect(fieldBoxes().map((b) => b.checked)).toEqual([true, false]);
    expect(columns()).toBe("Columns: PRODUCT, SALES, Q02_, Q02_SALES");
    expect(element.querySelector(".ud-problem")).toBeNull();
    buttons(".ud-actions")[0].click();
    await settle();
    expect(close).toHaveBeenCalledTimes(1);
    const result = close.mock.calls[0][0] as UnionSettings;
    expect(result.entries).toEqual(["TOP_FIRST-PRODUCT", "TOP_SECOND-PRODUCT"]);
    expect(result.parallel).toBe(true);
    // The dataset is not touched: who opened the dialog applies it
    expect(dataset(report, "TOP_PRODUCTS").dataUnions).toEqual(["TOP_FIRST", "TOP_SECOND"]);
  });

  it("refuses a grouped union without index fields", async () => {
    await open("TOP_PRODUCTS");
    element.querySelector<HTMLInputElement>(".ud-group input")!.click();
    await settle();
    buttons(".ud-actions")[0].click();
    await settle();
    expect(element.querySelector(".ud-problem-text")?.textContent?.trim()).toBe("Union grouping: Index fields");
    await type(element.querySelector<HTMLInputElement>(".ud-index")!, "PRODUCT ");
    buttons(".ud-actions")[0].click();
    await settle();
    const result = close.mock.calls[0][0] as UnionSettings;
    expect(result.group).toBe(true);
    expect(result.indexFields).toBe("PRODUCT");
  });

  it("adds, removes and moves the datasets of the union", async () => {
    const dialog = await open("TOP_PRODUCTS");
    const [add, remove, up, down] = buttons(".ud-moves");
    await selectOption("#ud-available", 0);
    add.click();
    await settle();
    expect(options("#ud-unions")).toEqual(["TOP_FIRST", "TOP_SECOND", "CATEGORY_FIRST"]);
    expect(dialog.selectedIndex).toBe(2);
    expect(down.disabled).toBe(true);
    up.click();
    await settle();
    expect(options("#ud-unions")).toEqual(["TOP_FIRST", "CATEGORY_FIRST", "TOP_SECOND"]);
    expect(dialog.selectedIndex).toBe(1);
    expect(columns()).toBe("Columns: PRODUCT, SALES, Q02_, Q02_CATEGORY, Q02_ORDERS, Q02_SALES, Q03_, Q03_PRODUCT, Q03_SALES");
    remove.click();
    await settle();
    expect(options("#ud-unions")).toEqual(["TOP_FIRST", "TOP_SECOND"]);
    // A double click on an available dataset adds it too
    await selectOption("#ud-available", 4);
    element.querySelector("#ud-available")!.dispatchEvent(new MouseEvent("dblclick"));
    await settle();
    expect(options("#ud-unions")).toEqual(["TOP_FIRST", "TOP_SECOND", "BY_CATEGORY"]);
    buttons(".ud-actions")[1].click();
    expect(close).toHaveBeenCalledWith(undefined);
  });

  it("in a normal union there are no common fields to give", async () => {
    await open("BY_CATEGORY");
    expect(fieldBoxes().map((b) => b.parentElement?.textContent?.trim())).toEqual(["CATEGORY", "ORDERS", "SALES"]);
    expect(fieldBoxes().map((b) => b.checked)).toEqual([true, false, false]);
    element.querySelector<HTMLInputElement>(".ud-parallel input")!.click();
    await settle();
    expect(fieldBoxes().length).toBe(0);
    expect(fieldsText().disabled).toBe(true);
    expect(fieldsText().value).toBe("CATEGORY");
    expect(columns()).toBe("Columns: CATEGORY, ORDERS, SALES");
  });

  it("without the fields of the datasets it still edits the union", async () => {
    await open("TOP_PRODUCTS", () => null);
    expect(fieldBoxes().length).toBe(0);
    expect(columns()).toBe("");
    await type(fieldsText(), "PRODUCT");
    expect(options("#ud-unions")).toEqual(["TOP_FIRST-PRODUCT", "TOP_SECOND"]);
  });
});

describe("The unions in the object inspector", () => {
  let report: Report;
  let selected: DataInfo;
  let inspector: ObjectInspectorComponent;
  let requests: ReadReportRequest[];

  function createInspector() {
    report = yearOverYear();
    requests = [];
    const reportService = {
      // No server: the columns of the datasets as ReadFunctionsColumns gives them
      getReadReportResponse: vi.fn(async (request: ReadReportRequest) => {
        requests.push(request);
        return { functions: COLUMN_FUNCTIONS };
      }),
    };
    const canvasService = {
      getSelectedReportItems: () => [{ item: selected }],
      canvas: { requestRenderAll: () => undefined },
    };
    inspector = new ObjectInspectorComponent(
      canvasService as any,
      TestBed.inject(TranslationService),
      {} as any,
      reportService as any,
      TestBed.inject(PresentacionService),
      {} as any
    );
    inspector.reportEditor = {
      report,
      designPreferences: { MeaureUnit: 0 },
      refreshSubReport: () => undefined,
    } as any;
  }

  function show(alias: string): PropertyValue[] {
    selected = dataset(report, alias);
    inspector.loadObject();
    return properties();
  }
  const properties = () => (inspector as any).properties as PropertyValue[];
  const property = (name: string) => properties().find((p) => p.name === name)!;

  beforeEach(async () => {
    configure();
    await TestBed.inject(TranslationService).setLang("en");
    createInspector();
  });
  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    TestBed.resetTestingModule();
  });

  it("typing the unions in the cell is one undo step with the list", () => {
    show("TOP_PRODUCTS");
    const unions = property("dataUnions");
    expect(unions.label).toBe("Unions");
    expect(unions.value).toBe("TOP_FIRST, TOP_SECOND");
    unions.valueStringTmp = "TOP_FIRST , TOP_SECOND, CATEGORY_FIRST,";
    unions.commitValue();
    const top = dataset(report, "TOP_PRODUCTS");
    expect(top.dataUnions).toEqual(["TOP_FIRST", "TOP_SECOND", "CATEGORY_FIRST"]);
    const op = report.undoCue!.undoOperations.at(-1)!;
    expect(op.properties).toHaveLength(1);
    expect(op.properties[0].propertyName).toBe("dataUnions");
    expect(op.properties[0].propertyType).toBe(PropertyType.StringArray);
    expect(op.properties[0].oldValue).toEqual(["TOP_FIRST", "TOP_SECOND"]);
    expect(op.properties[0].newValue).toEqual(["TOP_FIRST", "TOP_SECOND", "CATEGORY_FIRST"]);
    report.undoCue!.undo(report);
    expect(top.dataUnions).toEqual(["TOP_FIRST", "TOP_SECOND"]);
    report.undoCue!.redo(report);
    expect(top.dataUnions).toEqual(["TOP_FIRST", "TOP_SECOND", "CATEGORY_FIRST"]);
  });

  it("the booleans and the fields of the union are recorded with their own types", () => {
    show("TOP_PRODUCTS");
    property("parallelUnion").valueBool = false;
    property("myBaseIndexFields").valueStringTmp = "PRODUCT";
    property("myBaseIndexFields").commitValue();
    const top = dataset(report, "TOP_PRODUCTS");
    expect(top.parallelUnion).toBe(false);
    expect(top.myBaseIndexFields).toBe("PRODUCT");
    const ops = report.undoCue!.undoOperations;
    expect(ops.map((op) => [op.properties[0].propertyName, op.properties[0].propertyType])).toEqual([
      ["parallelUnion", PropertyType.Boolean],
      ["myBaseIndexFields", PropertyType.String],
    ]);
  });

  it("changing the connection of a dataset changes its rows: the SQL, or the unions", () => {
    show("TOP_FIRST");
    expect(properties().map((p) => p.name)).toContain("sql");
    property("databaseAlias").valueString = "MEMORY";
    expect(dataset(report, "TOP_FIRST").databaseAlias).toBe("MEMORY");
    let names = properties().map((p) => p.name);
    expect(names).not.toContain("sql");
    expect(names).toContain("dataUnions");
    property("databaseAlias").valueString = "SAMPLES";
    names = properties().map((p) => p.name);
    expect(names).toContain("sql");
    expect(names).not.toContain("dataUnions");
  });

  it("the dialog of the ellipsis applies its changes as one undo step", async () => {
    show("TOP_PRODUCTS");
    const operations = report.undoCue!.undoOperations.length;
    const clicking = property("dataUnions").stringPropertyClick();
    // The dialog opens once the columns are read
    const dialogs = TestBed.inject(MatDialog);
    let dialog: UnionsDialogComponent | undefined;
    for (let i = 0; i < 100 && !dialog; i++) {
      await new Promise((r) => setTimeout(r, 10));
      dialog = dialogs.openDialogs.map((d) => d.componentInstance).find((c) => c instanceof UnionsDialogComponent);
    }
    expect(dialog).toBeDefined();
    TestBed.inject(ApplicationRef).tick();
    expect(requests.map((r) => r.operation)).toEqual([ReadReportOperation.ReadFunctionsColumns]);
    expect(dialog!.columnsText).toBe("Columns: PRODUCT, SALES, Q02_, Q02_PRODUCT, Q02_SALES");
    dialog!.selectEntry(0);
    dialog!.setFieldsOfSelected("PRODUCT", true);
    dialog!.selectEntry(1);
    dialog!.setFieldsOfSelected("PRODUCT", true);
    dialog!.addDataset("CATEGORY_FIRST-CATEGORY");
    dialog!.setGroup(true);
    dialog!.setIndexFields("PRODUCT");
    dialog!.confirm();
    await clicking;

    const top = dataset(report, "TOP_PRODUCTS");
    expect(UnionSettings.summary(top)).toBe("TOP_FIRST-PRODUCT, TOP_SECOND-PRODUCT, CATEGORY_FIRST-CATEGORY");
    expect(top.groupUnion).toBe(true);
    expect(top.myBaseIndexFields).toBe("PRODUCT");
    expect(report.undoCue!.undoOperations.length).toBe(operations + 1);
    const op = report.undoCue!.undoOperations.at(-1)!;
    expect(op.properties.map((p) => p.propertyName)).toEqual(["dataUnions", "groupUnion", "myBaseIndexFields"]);
    // The rows are shown again with what the dialog left
    expect(property("dataUnions").value).toBe("TOP_FIRST-PRODUCT, TOP_SECOND-PRODUCT, CATEGORY_FIRST-CATEGORY");
    expect(property("groupUnion").value).toBe(true);

    report.undoCue!.undo(report);
    expect(UnionSettings.summary(top)).toBe("TOP_FIRST, TOP_SECOND");
    expect(top.groupUnion).toBe(false);
    expect(top.myBaseIndexFields ?? "").toBe("");
    expect(report.undoCue!.undoOperations.length).toBe(operations);
  });

  it("cancelling the dialog changes nothing", async () => {
    show("BY_CATEGORY");
    const clicking = property("dataUnions").stringPropertyClick();
    const dialogs = TestBed.inject(MatDialog);
    let dialog: UnionsDialogComponent | undefined;
    for (let i = 0; i < 100 && !dialog; i++) {
      await new Promise((r) => setTimeout(r, 10));
      dialog = dialogs.openDialogs.map((d) => d.componentInstance).find((c) => c instanceof UnionsDialogComponent);
    }
    TestBed.inject(ApplicationRef).tick();
    dialog!.addDataset("TOP_FIRST");
    dialog!.cancel();
    await clicking;
    expect(dataset(report, "BY_CATEGORY").dataUnions).toEqual(["CATEGORY_FIRST-CATEGORY", "CATEGORY_SECOND-CATEGORY"]);
    expect(report.undoCue!.undoOperations.length).toBe(0);
  });
});
