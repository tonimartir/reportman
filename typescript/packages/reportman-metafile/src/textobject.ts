import { PDFFontType, PrintStepType } from './enums.js';
import type { MetaObjectText } from './metaobject.js';
import type { MetaPage } from './metapage.js';

/**
 * A block of text with its font and format (TextObjectStruct): what the engine measures through
 * the layout device. A C# struct: copy it (`{ ...obj }`) before changing a field of a shared one.
 */
export interface TextObjectStruct {
  text: string;
  /** Font family name on Linux. */
  lFontName: string;
  /** Font family name on Windows. */
  wFontName: string;
  fontSize: number;
  /** Rotation in tenths of a degree. */
  fontRotation: number;
  /** Style flags: 1 bold, 2 italic, 4 underline, 8 strikeout. */
  fontStyle: number;
  fontColor: number;
  type1Font: PDFFontType;
  cutText: boolean;
  /** Alignment flags (AlignmentFlags). */
  alignment: number;
  wordWrap: boolean;
  rightToLeft: boolean;
  printStep: PrintStepType;
  isHtml: boolean;
}

/**
 * A new TextObjectStruct. The defaults are those of a C# `new TextObjectStruct()` except the
 * strings, which are empty instead of null.
 */
export function newTextObjectStruct(init?: Partial<TextObjectStruct>): TextObjectStruct {
  return {
    text: '',
    lFontName: '',
    wFontName: '',
    fontSize: 0,
    fontRotation: 0,
    fontStyle: 0,
    fontColor: 0,
    type1Font: PDFFontType.Helvetica,
    cutText: false,
    alignment: 0,
    wordWrap: false,
    rightToLeft: false,
    printStep: PrintStepType.BySize,
    isHtml: false,
    ...init,
  };
}

/** The TextObjectStruct of a text object of a page (TextObjectStruct.FromMetaObjectText). */
export function textObjectFromMetaObjectText(page: MetaPage, obj: MetaObjectText): TextObjectStruct {
  return {
    text: page.getText(obj),
    lFontName: page.getLFontNameText(obj),
    wFontName: page.getWFontNameText(obj),
    wordWrap: obj.wordWrap,
    type1Font: obj.type1Font,
    rightToLeft: obj.rightToLeft,
    fontColor: obj.fontColor,
    fontRotation: obj.fontRotation,
    fontStyle: obj.fontStyle,
    printStep: obj.printStep,
    cutText: obj.cutText,
    fontSize: obj.fontSize,
    alignment: obj.alignment,
    isHtml: obj.isHtml,
  };
}

/**
 * A line of a measured text (LineInfo, from PDFCanvas.cs): where it starts in the text, how many
 * characters it has and its size, in the resolution units of the device (twips).
 */
export interface LineInfo {
  /** Index in the text where the line starts. */
  position: number;
  /** Number of characters of the line. */
  size: number;
  width: number;
  /** Height of the line (line spacing). */
  height: number;
  /** Top of the line relative to the text block. */
  topPos: number;
  /** Print step used to measure the line. */
  step: PrintStepType;
  /** True for the last line of a paragraph (no justification). */
  lastLine: boolean;
  /** Height as a double (only the shaped measurement fills it). */
  lineHeight: number;
  /**
   * Shaped glyph positions (TGlyphPos in C#), null when only the line metrics are known. The
   * standard 14 fonts measurement never fills it: shaping is not ported yet.
   */
  glyphs: readonly unknown[] | null;
  /** Text of the line (only the shaped measurement fills it). */
  text: string | null;
}

/** A new, empty LineInfo (the default of the C# struct). */
export function newLineInfo(): LineInfo {
  return {
    position: 0,
    size: 0,
    width: 0,
    height: 0,
    topPos: 0,
    step: PrintStepType.BySize,
    lastLine: false,
    lineHeight: 0,
    glyphs: null,
    text: null,
  };
}
