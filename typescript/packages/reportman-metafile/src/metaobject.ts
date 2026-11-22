// The metafile objects (MetaObject*.cs). Fixed size records in the C# engine; here plain data
// classes with the same public fields. The binary record layout (RECORD_SIZE, FillFromBuf,
// SaveToStream) belongs to the .rpmf format, in rpmf.ts.

import {
  ImageDrawStyleType,
  MetaBarcodeEcc,
  MetaBarcodeSymbology,
  MetaObjectType,
  PDFFontType,
  PrintStepType,
  ShapeType,
  TextAlignType,
  TextAlignVerticalType,
} from './enums.js';
import { AlignmentFlags } from './alignment.js';

/** Base class of the objects of a page. Positions and sizes in twips. */
export abstract class MetaObject {
  /** Unique identifier used by the search functions of the metafile. */
  id = 0;
  top = 0;
  left = 0;
  width = 0;
  height = 0;
  /** Annotation position in the string pool of the page (1 based, 0 = none). */
  annotationP = 0;
  /** Annotation length. */
  annotationS = 0;
  /** Type of object. */
  metaType: MetaObjectType = MetaObjectType.Text;

  /** The alignment flag of a horizontal alignment (GetIntHorizAlignment). */
  static getIntHorizAlignment(alignment: TextAlignType): number {
    let result = 0;
    if (alignment === TextAlignType.Right) result = AlignmentFlags.AlignRight;
    else if (alignment === TextAlignType.Center) result = AlignmentFlags.AlignHCenter;
    else if (alignment === TextAlignType.Justify) result = AlignmentFlags.AlignHJustify;
    return result;
  }

  /** The alignment flag of a vertical alignment (GetIntVertAlignment). */
  static getIntVertAlignment(valignment: TextAlignVerticalType): number {
    let result = 0;
    if (valignment === TextAlignVerticalType.Center) result = AlignmentFlags.AlignVCenter;
    else if (valignment === TextAlignVerticalType.Bottom) result = AlignmentFlags.AlignBottom;
    return result;
  }

  /** A new, empty object of a type (MetaObject.CreateFromBuf without the buffer). */
  static create(metaType: MetaObjectType): MetaObject {
    switch (metaType) {
      case MetaObjectType.Text:
        return new MetaObjectText();
      case MetaObjectType.Draw:
        return new MetaObjectDraw();
      case MetaObjectType.Image:
        return new MetaObjectImage();
      case MetaObjectType.Polygon:
        return new MetaObjectPolygon();
      case MetaObjectType.Export:
        return new MetaObjectExport();
      case MetaObjectType.Barcode:
        return new MetaObjectBarcode();
      default:
        // The message of the C# engine (Spanish in the original)
        throw new Error('Unknown meta object type: ' + String(metaType));
    }
  }
}

/** A text: the strings are positions and lengths in the string pool of the page. */
export class MetaObjectText extends MetaObject {
  textP = 0;
  textS = 0;
  lFontNameP = 0;
  lFontNameS = 0;
  wFontNameP = 0;
  wFontNameS = 0;
  /** Font size in points. */
  fontSize = 0;
  /** Font rotation in tenths of a degree. */
  fontRotation = 0;
  /** Font style flags: 1 bold, 2 italic, 4 underline, 8 strikeout. */
  fontStyle = 0;
  type1Font: PDFFontType = PDFFontType.Helvetica;
  fontColor = 0;
  backColor = 0;
  transparent = false;
  cutText = false;
  /** Alignment flags (AlignmentFlags), horizontal and vertical. */
  alignment = 0;
  wordWrap = false;
  rightToLeft = false;
  printStep: PrintStepType = PrintStepType.BySize;
  isHtml = false;
  // C# parity: a new MetaObjectText keeps MetaType = Text (0, the default of the enum).
}

/** A shape: rectangle, ellipse, lines... */
export class MetaObjectDraw extends MetaObject {
  drawStyle: ShapeType = ShapeType.Rectangle;
  /** Brush style (BrushType). */
  brushStyle = 0;
  brushColor = 0;
  /** Pen style (PenType): Dash=1, Dot=2, DashDot=3, DashDotDot=4, Clear=5. */
  penStyle = 0;
  /** Pen width in twips. */
  penWidth = 0;
  penColor = 0;
  constructor() {
    super();
    // C# parity: the C# constructor leaves MetaType = Text; DrawShape and the engine set Draw.
  }
}

/** An image: its bytes are in the stream of the page, or in the shared stream of the metafile. */
export class MetaObjectImage extends MetaObject {
  copyMode = 0;
  drawImageStyle: ImageDrawStyleType = ImageDrawStyleType.Crop;
  dpiRes = 0;
  previewOnly = false;
  streamPos = 0;
  streamSize = 0;
  sharedImage = false;
}

/** A polygon (not implemented by the C# engine, for future use). */
export class MetaObjectPolygon extends MetaObject {
  polyBrushStyle = 0;
  polyBrushColor = 0;
  polyPenStyle = 0;
  polyPenWidth = 0;
  polyPenColor = 0;
  polyPointCount = 0;
  polyStreamPos = 0;
  polyStreamSize = 0;
}

/** Export information of a text, for custom export formats. */
export class MetaObjectExport extends MetaObject {
  textExpP = 0;
  textExpS = 0;
  line = 0;
  position = 0;
  size = 0;
  doNewLine = false;
}

/** A barcode kept as data, for devices that draw it natively. */
export class MetaObjectBarcode extends MetaObject {
  textP = 0;
  textS = 0;
  symbology: MetaBarcodeSymbology = MetaBarcodeSymbology.Unknown;
  ecc: MetaBarcodeEcc = MetaBarcodeEcc.L;
  modules = 0;
  rows = 0;
  columns = 0;
  flags = 0;
}
