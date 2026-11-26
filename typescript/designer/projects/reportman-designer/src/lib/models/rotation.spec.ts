import { BarcodeItem, BarcodeType, LabelItem, Report, ReportItem } from "@reportman/lib";
import { TranslationService } from "../services/translator.service";
import { DesignerInterfaceBarcode } from "./designer-interface-barcode";
import { DesignerInterfaceText } from "./designer-interface-text";

/**
 * The properties the inspector shows converted: the rotation of a text in degrees (the report keeps
 * tenths of a degree), the rotation of a barcode as 0, 90, 180 or 270 (tenths too) and its ECC
 * level with Auto first (the report's -1).
 */
describe("the converted properties of texts and barcodes", () => {
  const translator = new TranslationService();
  const inspector = { refreshSubReport: () => undefined };
  const one = (item: ReportItem) => new Map<number, ReportItem>([[0, item]]);

  it("keeps the rotation of a text in tenths of a degree, and shows it in degrees", () => {
    const label = new LabelItem();
    label.className = "TRPLABEL";
    const inter = new DesignerInterfaceText(new Report(), one(label), inspector, translator);
    inter.SetProperty("fontRotation", 45);
    expect(label.fontRotation).toBe(450);
    expect(inter.GetProperty("fontRotation")).toBe(45);
    inter.SetProperty("fontRotation", -22.5);
    expect(label.fontRotation).toBe(-225);
    expect(inter.GetProperty("fontRotation")).toBe(-22.5);
    inter.SetProperty("fontRotation", "90");
    expect(label.fontRotation).toBe(900);
  });

  it("keeps the rotation of a barcode in tenths of a degree", () => {
    const barcode = new BarcodeItem();
    barcode.className = "TRPBARCODE";
    const inter = new DesignerInterfaceBarcode(new Report(), one(barcode), inspector, translator);
    for (const [index, tenths] of [[1, 900], [2, 1800], [3, 2700], [0, 0]]) {
      inter.SetProperty("rotation", index);
      expect(barcode.rotation).toBe(tenths);
      expect(inter.GetProperty("rotation")).toBe(index);
    }
  });

  it("keeps the ECC level of a barcode as the report does: Auto is -1", () => {
    const barcode = new BarcodeItem();
    barcode.className = "TRPBARCODE";
    barcode.barType = BarcodeType.CodeQR;
    const inter = new DesignerInterfaceBarcode(new Report(), one(barcode), inspector, translator);
    // The list: Auto, Level 0, Level 1...
    inter.SetProperty("eccLevel", 0);
    expect(barcode.eccLevel).toBe(-1);
    expect(inter.GetProperty("eccLevel")).toBe(0);
    inter.SetProperty("eccLevel", 1);
    expect(barcode.eccLevel).toBe(0);
    inter.SetProperty("eccLevel", 4);
    expect(barcode.eccLevel).toBe(3);
    expect(inter.GetProperty("eccLevel")).toBe(4);
  });
});
