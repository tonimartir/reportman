import { PrintPosItem } from "./print-pos-item.js";

/** C# BarcodeItem: the defaults are the ones of its constructor. */
export class BarcodeItem extends PrintPosItem {
  public expression = "'5449000000996'";
  public modul = 10;
  public ratio = 2;
  public barType = BarcodeType.CodeEAN13;
  public checksum = false;
  public transparent = false;
  public displayFormat = "";
  public rotation = 0;
  public bColor = 0x000000;
  // C# parity: the engine sets GraphicUtils.IntegerFromColor(Color.White), which in its .NET build
  // (System.Drawing) is the negated index of the known color White, -168, not 0xFFFFFF.
  public backColor = -168;
  public numColumns = 0;
  public numRows = 0;
  // -1 is Auto, the default of the engines (Delphi and .NET); 0 to 8 are Level 0 to Level 8
  public eccLevel = -1;
  public truncated = false;
  constructor() {
    super();
    this.className = "TRPBARCODE";
    this.width = 500;
    this.height = 500;
  }
}

export enum BarcodeType {
  Code_2_5_interleaved,
  Code_2_5_industrial,
  Code_2_5_matrix,
  Code39,
  Code39Extended,
  Code128A,
  Code128B,
  Code128C,
  Code128,
  Code93,
  Code93Extended,
  CodeMSI,
  CodePostNet,
  CodeCodabar,
  CodeEAN8,
  CodeEAN13,
  CodePDF417,
  CodeQR,
}
