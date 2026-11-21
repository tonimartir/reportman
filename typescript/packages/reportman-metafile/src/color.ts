// Colors and font styles as the metafile stores them (GraphicUtils.cs): a color is an integer
// $00BBGGRR (red in the low byte), a font style is a set of flags.

/** The red, green and blue bytes of a color integer ($00BBGGRR), as (byte) casts in C#. */
export function colorToRgb(color: number): { r: number; g: number; b: number } {
  return { r: color & 0xff, g: (color >> 8) & 0xff, b: (color >> 16) & 0xff };
}

/** The color integer ($00BBGGRR) of red, green and blue bytes (IntegerFromColorA). */
export function rgbToColor(r: number, g: number, b: number): number {
  return (r & 0xff) + ((g & 0xff) << 8) + ((b & 0xff) << 16);
}

/** Font style flag: bold. */
export const FONT_STYLE_BOLD = 1;
/** Font style flag: italic. */
export const FONT_STYLE_ITALIC = 2;
/** Font style flag: underline. */
export const FONT_STYLE_UNDERLINE = 4;
/** Font style flag: strikeout. */
export const FONT_STYLE_STRIKEOUT = 8;

/** The font style includes bold. */
export function fontStyleIsBold(fontStyle: number): boolean {
  return (fontStyle & FONT_STYLE_BOLD) > 0;
}

/** The font style includes italic. */
export function fontStyleIsItalic(fontStyle: number): boolean {
  return (fontStyle & FONT_STYLE_ITALIC) > 0;
}

/** The font style includes underline. */
export function fontStyleIsUnderline(fontStyle: number): boolean {
  return (fontStyle & FONT_STYLE_UNDERLINE) > 0;
}

/** The font style includes strikeout. */
export function fontStyleIsStrikeOut(fontStyle: number): boolean {
  return (fontStyle & FONT_STYLE_STRIKEOUT) > 0;
}
