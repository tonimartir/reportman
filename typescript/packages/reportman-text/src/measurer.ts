import { AlignmentFlags, PDFFontType } from '@reportman/metafile';
import type { LineInfo, Point, TextExtentLines, TextObjectStruct } from '@reportman/metafile';
import { TextCanvas } from './textcanvas.js';

/**
 * Text measurement with the standard 14 PDF fonts, as the PDF device of the C# engine measures
 * while a report is laid out (the TextExtent, TextExtentLineInfo and WordExtent methods of
 * PrintOutPDFBase with the canvas of PrintOutPDFStandard). Extents in twips.
 *
 * It measures on a TextCanvas, its own or the canvas of a PDF document (a getter, because the
 * PDF device creates a new document, and canvas, for each print).
 */
export class StandardTextMeasurer {
  private readonly getCanvas: () => TextCanvas;
  private readonly beforeMeasure: (() => void) | undefined;

  /**
   * @param canvas The canvas to measure on, or a function that returns it; a new TextCanvas when
   * omitted.
   * @param beforeMeasure Called before each measurement (the PDF device syncs the forced
   * shaping of the printer fonts Recalculate mode there, SyncForceShaping in C#).
   */
  constructor(canvas?: TextCanvas | (() => TextCanvas), beforeMeasure?: () => void) {
    if (canvas === undefined) {
      const own = new TextCanvas();
      this.getCanvas = () => own;
    } else if (typeof canvas === 'function') this.getCanvas = canvas;
    else this.getCanvas = () => canvas;
    this.beforeMeasure = beforeMeasure;
  }

  /** The canvas the measurements use. */
  get canvas(): TextCanvas {
    return this.getCanvas();
  }

  /** The lines of the last measurement that asked for them (PrintOutPDFBase.LineInfo). */
  get lineInfo(): LineInfo[] {
    return this.getCanvas().lineInfo;
  }

  private setFont(aobj: TextObjectStruct): TextObjectStruct {
    const canvas = this.getCanvas();
    const obj = { ...aobj };
    // Right to left is always measured shaped; normalized like the PDF drawing path does
    if (obj.rightToLeft && obj.text !== null) obj.text = obj.text === '' ? '' : obj.text.normalize('NFC');
    // The forced shaper needs a TrueType font: standard fonts are promoted to Linked
    if (canvas.forceComplexShaping && obj.type1Font !== PDFFontType.Embedded) obj.type1Font = PDFFontType.Linked;
    canvas.font.name = obj.type1Font;
    canvas.font.wFontName = obj.wFontName;
    canvas.font.lFontName = obj.lFontName;
    canvas.font.size = obj.fontSize;
    canvas.font.bold = (obj.fontStyle & 1) > 0;
    canvas.font.italic = (obj.fontStyle & 2) > 0;
    return obj;
  }

  /**
   * The extent of a text (PrintOutPDFBase.TextExtent): its width wraps the text when WordWrap is
   * set; with CutText the height is limited to the height of the extent. A rotated text gives the
   * extent back unchanged.
   */
  textExtent(aobj: TextObjectStruct, extent: Point): Point {
    if (aobj.fontRotation !== 0) return { ...extent };
    this.beforeMeasure?.();
    const maxextent = { ...extent };
    const singleline = (aobj.alignment & AlignmentFlags.SingleLine) > 0;
    const obj = this.setFont(aobj);
    const r = this.getCanvas().textExtent(
      obj.text,
      { left: 0, top: 0, width: extent.x, height: 0 },
      obj.wordWrap,
      singleline,
      false,
      obj.rightToLeft,
      obj.isHtml,
    );
    const result = { x: r.rect.width, y: r.rect.height };
    if (obj.cutText) {
      if (maxextent.y < result.y) result.y = maxextent.y;
    }
    return result;
  }

  /**
   * The extent of a text and its lines (PrintOutPDFBase.TextExtentLineInfo, both overloads: the
   * lines are also left in lineInfo). Unlike textExtent, a rotated text is measured.
   */
  textExtentLineInfo(aobj: TextObjectStruct, extent: Point): TextExtentLines & { lines: LineInfo[] } {
    const maxextent = { ...extent };
    this.beforeMeasure?.();
    const singleline = (aobj.alignment & AlignmentFlags.SingleLine) > 0;
    const obj = this.setFont(aobj);
    const r = this.getCanvas().textExtent(
      obj.text,
      { left: 0, top: 0, width: extent.x, height: 0 },
      obj.wordWrap,
      singleline,
      true,
      obj.rightToLeft,
      obj.isHtml,
    );
    const result = { x: r.rect.width, y: r.rect.height };
    if (obj.cutText) {
      if (maxextent.y < result.y) result.y = maxextent.y;
    }
    return { lines: r.lines, extent: result };
  }

  /** The extent of a word with the current font of the canvas (PrintOutPDFBase.WordExtent). */
  wordExtent(text: string, extent: Point): Point {
    const r = this.getCanvas().textExtent(text, { left: 0, top: 0, width: extent.x, height: extent.y }, false, true, false, false);
    return { x: r.rect.width, y: r.rect.height };
  }

  /** The extent of a word and its lines with the current font (PrintOutPDFBase.WordExtentLineInfo). */
  wordExtentLineInfo(text: string, extent: Point, rightToLeft = false): TextExtentLines & { lines: LineInfo[] } {
    const r = this.getCanvas().textExtent(
      text,
      { left: 0, top: 0, width: extent.x, height: extent.y },
      false,
      true,
      true,
      rightToLeft,
    );
    return { lines: r.lines, extent: { x: r.rect.width, y: r.rect.height } };
  }
}
