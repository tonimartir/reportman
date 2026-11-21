// The undo history of the datasets of a report with a union (contacts.rep), as the web designer edits it:
// each property of an added dataset under its own name, and a removed one given back whole.
import { describe, expect, it } from "vitest";
import { hydrateReport, DataInfo, DriverType, OperationType, PropertyType } from "@reportman/lib";

/**
 * The datasets of contacts.rep as the designer's server sends them: two SQL datasets on SAMPLES and
 * DIRECTORY, their union, on MEMORY (driver MyBase).
 */
function contactsReport() {
  return hydrateReport({
    databaseInfo: [
      { className: "TRPDATABASEINFOITEM", name: "TRPDATABASEINFOITEM1", alias: "SAMPLES", driver: DriverType.DotNet2 },
      { className: "TRPDATABASEINFOITEM", name: "TRPDATABASEINFOITEM2", alias: "MEMORY", driver: DriverType.Mybase },
    ],
    dataInfo: [
      {
        className: "TRPDATAINFOITEM",
        name: "TRPDATAINFOITEM1",
        alias: "CUSTOMER_CONTACTS",
        databaseAlias: "SAMPLES",
        sql: "SELECT NAME, PHONE FROM CUSTOMERS",
        dataUnions: [],
        openOnStart: true,
      },
      {
        className: "TRPDATAINFOITEM",
        name: "TRPDATAINFOITEM2",
        alias: "EMPLOYEE_CONTACTS",
        databaseAlias: "SAMPLES",
        sql: "SELECT NAME, PHONE FROM EMPLOYEES",
        dataUnions: [],
        openOnStart: true,
      },
      {
        className: "TRPDATAINFOITEM",
        name: "TRPDATAINFOITEM3",
        alias: "DIRECTORY",
        databaseAlias: "MEMORY",
        sql: "",
        dataUnions: ["CUSTOMER_CONTACTS", "EMPLOYEE_CONTACTS"],
        myBaseIndexFields: "NAME",
        groupUnion: false,
        parallelUnion: false,
        openOnStart: true,
      },
    ],
    subReports: [],
    params: [],
  });
}

describe("Report.addDataInfoProperties", () => {
  it("records the connection and the SQL of an added dataset under their own names", () => {
    const report = contactsReport();
    const info = new DataInfo();
    info.name = "TRPDATAINFOITEM9";
    info.alias = "NEW_ONE";
    info.databaseAlias = "SAMPLES";
    info.sql = "SELECT 1 FROM RDB$DATABASE";
    info.dataUnions = ["CUSTOMER_CONTACTS"];
    info.openOnStart = false;
    report.addDataInfo(info, report.undoCue!.getGroupId());
    const op = report.undoCue!.undoOperations.at(-1)!;
    expect(op.operation).toBe(OperationType.Add);
    const byName = new Map(op.properties.map((p) => [p.propertyName, p]));
    expect(byName.get("databaseAlias")?.propertyType).toBe(PropertyType.String);
    expect(byName.get("databaseAlias")?.newValue).toBe("SAMPLES");
    expect(byName.get("sql")?.propertyType).toBe(PropertyType.String);
    expect(byName.get("sql")?.newValue).toBe("SELECT 1 FROM RDB$DATABASE");
    expect(byName.get("openOnStart")?.propertyType).toBe(PropertyType.Boolean);
    expect(byName.get("openOnStart")?.newValue).toBe(false);
    expect(byName.get("dataUnions")?.propertyType).toBe(PropertyType.StringArray);
    expect(byName.get("dataUnions")?.newValue).toEqual(["CUSTOMER_CONTACTS"]);
    // One entry per property: none of them is written twice
    expect(op.properties.filter((p) => p.propertyName === "dataUnions").length).toBe(1);
    expect(op.properties.filter((p) => p.propertyName === "openOnStart").length).toBe(1);
    // The history keeps its own copy of the unions
    info.dataUnions.push("EMPLOYEE_CONTACTS");
    expect(byName.get("dataUnions")?.newValue).toEqual(["CUSTOMER_CONTACTS"]);
  });

  it("undoing the removal of a dataset gives it back its connection, its SQL and its unions", () => {
    const report = contactsReport();
    const customers = report.dataInfo[0];
    report.deleteItem(customers, report.undoCue!.getGroupId());
    expect(report.dataInfo.map((d) => d.alias)).toEqual(["EMPLOYEE_CONTACTS", "DIRECTORY"]);
    report.undoCue!.undo(report);
    const restored = report.dataInfo[0];
    expect(restored.alias).toBe("CUSTOMER_CONTACTS");
    expect(restored.databaseAlias).toBe("SAMPLES");
    expect(restored.sql).toBe("SELECT NAME, PHONE FROM CUSTOMERS");
    expect(restored.openOnStart).toBe(true);

    const directory = report.dataInfo[2];
    report.deleteItem(directory, report.undoCue!.getGroupId());
    report.undoCue!.undo(report);
    const union = report.dataInfo[2];
    expect(union.alias).toBe("DIRECTORY");
    expect(union.databaseAlias).toBe("MEMORY");
    expect(union.dataUnions).toEqual(["CUSTOMER_CONTACTS", "EMPLOYEE_CONTACTS"]);
    expect(union.myBaseIndexFields).toBe("NAME");
  });
});
