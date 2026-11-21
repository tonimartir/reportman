// hydrateReport / serializeReport beyond the C# fixtures, the report service and the texts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ChartItem,
  ParamType,
  ReadReportOperation,
  ReadReportRequest,
  ReportService,
  hydratePrintPosItem,
  hydrateReport,
  readReportXml,
  serializeReport,
  setLanguage,
  stringifyReport,
  translateNum,
} from "reportman-lib";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const kitchenSink = () =>
  readReportXml(new Uint8Array(fs.readFileSync(path.join(packageDir, "test/fixtures/reports/synthetic/kitchen-sink.rep"))));

describe("hydrateReport and serializeReport", () => {
  it("leaves out the runtime members of the report, not the components of the sections", () => {
    const report = kitchenSink();
    report.modified = true;
    const json = serializeReport(report);
    expect(json.components).toBeUndefined();
    expect(json.modified).toBeUndefined();
    expect(json.subReports[0].sections[0].components.length).toBe(report.subReports[0].sections[0].components.length);
    expect(stringifyReport(report, 2)).toContain('\n  "wFontName": "Segoe UI"');
  });

  it("gives back the same document (round trip)", () => {
    const json = serializeReport(kitchenSink());
    const again = serializeReport(hydrateReport(json));
    // hydrateReport gives the history the same instants and renames the repeated "Same"
    const strip = (j: any) => JSON.parse(JSON.stringify(j).replace(/"name":"TRPSHAPE\d+"/g, '"name":"Same"'));
    expect(strip(again)).toEqual(strip(json));
  });

  it("rebuilds the component map of a snapshot and does not change the document given", () => {
    const report = kitchenSink();
    const snapshot = JSON.parse(JSON.stringify(report));
    expect(snapshot.components).toEqual({});
    const frozen = JSON.stringify(snapshot);
    const hydrated = hydrateReport(snapshot);
    expect(hydrated.components).toBeInstanceOf(Map);
    expect(JSON.stringify(snapshot)).toBe(frozen);
    const chart = hydrated.subReports[0].sections[0].components.find((c) => c.className === "TRPCHART");
    expect(chart).toBeInstanceOf(ChartItem);
    expect(hydrated.components.get(chart!.name.toUpperCase())).toBe(chart);
  });

  it("keeps the whole value of date, time and date-time parameters", () => {
    const json = {
      params: [
        { className: "TRPPARAM", name: "D", paramType: ParamType.Date, value: { type: "DateTime", value: "2024-05-06T07:08:09.123" } },
        { className: "TRPPARAM", name: "T", paramType: ParamType.Time, value: { type: "DateTime", value: "1899-12-30T10:30:00" } },
        { className: "TRPPARAM", name: "N", paramType: ParamType.Date, value: { type: "Null", value: null } },
      ],
    };
    const report = hydrateReport(json);
    const d = report.params[0].value!.value as Date;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([
      2024, 4, 6, 7, 8, 9, 123,
    ]);
    const t = report.params[1].value!.value as Date;
    expect([t.getFullYear(), t.getHours(), t.getMinutes()]).toEqual([1899, 10, 30]);
    expect(report.params[2].value).toEqual({ type: "Null", value: null });
    // the input is not changed
    expect(json.params[0].value.value).toBe("2024-05-06T07:08:09.123");
  });

  it("refuses a component of an unknown class, as the engine does", () => {
    expect(() => hydratePrintPosItem({ className: "TRPSECTION" })).toThrow("Cannot create a PrintPosItem: TRPSECTION");
    expect(() => hydrateReport({ subReports: [{ sections: [{ components: [{}] }] }] })).toThrow("<null>");
  });
});

describe("ReportService", () => {
  it("posts with the global fetch and hydrates the report", async () => {
    const calls: { url: string; init: any }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: any) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ report: serializeReport(kitchenSink()) }) };
    }) as any;
    try {
      const request = new ReadReportRequest();
      request.reportName = "x";
      const response = await new ReportService().getReadReportResponse(request, "https://host/api");
      expect(calls[0].url).toBe("https://host/api/ReadReport");
      expect(calls[0].init.method).toBe("POST");
      expect(JSON.parse(calls[0].init.body).operation).toBe(ReadReportOperation.ReadReport);
      expect(response.report!.subReports[0].sections[0].components[0].className).toBe("TRPLABEL");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("passes the HTTP errors to the caller", async () => {
    const service = new ReportService(async () => {
      throw new Error("offline");
    });
    await expect(service.getExecuteReportResponse({}, "u")).rejects.toThrow("offline");
  });
});

describe("designer texts", () => {
  it("loads a language on demand", async () => {
    await setLanguage("en");
    const english = translateNum(264);
    await setLanguage("ca-ES");
    expect(translateNum(264)).not.toBe("RpKey_264");
    await setLanguage("es");
    expect(english).not.toBe("RpKey_264");
  });
});
