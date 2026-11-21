import {
  PDFFontType,
  FontStyle,
  PrintStepType,
  TextAlignType,
  TextAlignVerticalType,
} from "./types.js";
import { PrintPosItem } from "./print-pos-item.js";

/**
 * Bidirectional (right to left) mode of the text in one report language, kept in
 * PrintItemText.bidiModes as "BidiNo", "BidiPartial" or "BidiFull" (the Delphi TRpBidiMode).
 */
export enum BidiModeType {
  /** Left to right text */
  No,
  /** Right to left text, the horizontal alignment keeps its meaning */
  Partial,
  /** Right to left text with the horizontal alignment mirrored */
  Full,
}

/** C# PrintItemText: the defaults are the ones of its constructor. */
export class PrintItemText extends PrintPosItem {
  public wFontName = "Arial";
  public lFontName = "Helvetica";
  public type1Font = PDFFontType.Helvetica;
  public fontSize = 10;
  public fontRotation = 0;
  public fontStyle = FontStyle.None;
  public fontColor = 0x000000;
  public backColor = 0xffffff;
  public transparent = true;
  public cutText = false;
  public alignment = TextAlignType.Left;
  /**
   * Right to left text in the current report language. In the engine it is derived from
   * bidiModes (true when the mode of the current language is Partial or Full) and bidiModes is
   * restored after it, so a change must go through PrintItemText.setBidiMode to survive.
   */
  public rightToLeft = false;
  public isHtml = false;
  public vAlignment = TextAlignVerticalType.Top;
  public wordWrap = false;
  public singleLine = false;
  public wordBreak = false;
  public interLine = 0;
  public multiPage = false;
  public printStep = PrintStepType.BySize;
  /**
   * The bidirectional mode of the text in every report language, one item per language with
   * "BidiNo", "BidiPartial" or "BidiFull": item 0 is the default language and item n + 1 the
   * language n. Declared after rightToLeft, as the engine orders it last in its JSON.
   */
  public bidiModes: string[] = [];

  /** The index of a report language in bidiModes, as the engine computes it: language + 1, 0 out of range. */
  public static bidiLanguageIndex(language: number): number {
    let langindex = language + 1;
    if (langindex < 0 || langindex > 256) langindex = 0;
    return langindex;
  }
  public static bidiModeToString(mode: BidiModeType): string {
    switch (mode) {
      case BidiModeType.Partial:
        return "BidiPartial";
      case BidiModeType.Full:
        return "BidiFull";
      default:
        return "BidiNo";
    }
  }
  /** The mode of the text in a report language (C# PrintItemText.BidiMode getter). */
  public static getBidiMode(item: PrintItemText, language: number): BidiModeType {
    const langindex = PrintItemText.bidiLanguageIndex(language);
    if (item.bidiModes.length > langindex) {
      if (item.bidiModes[langindex] === PrintItemText.bidiModeToString(BidiModeType.Partial))
        return BidiModeType.Partial;
      if (item.bidiModes[langindex] === PrintItemText.bidiModeToString(BidiModeType.Full))
        return BidiModeType.Full;
    }
    return BidiModeType.No;
  }
  /**
   * Sets the mode of the text in the report's current language (C# PrintItemText.BidiMode setter)
   * and keeps rightToLeft, which the engine derives from it, in step.
   */
  public static setBidiMode(item: PrintItemText, language: number, mode: BidiModeType): void {
    const langindex = PrintItemText.bidiLanguageIndex(language);
    while (item.bidiModes.length <= langindex)
      item.bidiModes.push(PrintItemText.bidiModeToString(BidiModeType.No));
    item.bidiModes[langindex] = PrintItemText.bidiModeToString(mode);
    item.rightToLeft = mode !== BidiModeType.No;
  }
}
