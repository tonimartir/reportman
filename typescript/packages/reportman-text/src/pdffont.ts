import { PDFFontType } from 'reportman-metafile';

/**
 * The font of a canvas (PDFFont, FontInfoProvider.cs): the PDF font type, the family names,
 * the size, the colors and the style.
 */
export class PDFFont {
  /** PDF font type. */
  name: PDFFontType = PDFFontType.Courier;
  /** Family name on Windows (null in a new C# instance). */
  wFontName: string | null = null;
  /** Family name on Linux (null in a new C# instance). */
  lFontName: string | null = null;
  /** Size in points (an int in C#). */
  size = 10;
  color = 0;
  /** Style flags. */
  style = 0;
  italic = false;
  underline = false;
  bold = false;
  strikeOut = false;
  transparent = false;
  backColor = 0xffffff;
  /**
   * C# parity: C# picks the Linux family name when it runs on Unix and the Windows one
   * elsewhere; set this to take the Linux name.
   */
  unixFamilyNames = false;

  /** The family name of the platform. */
  getFontFamily(): string {
    const family = this.unixFamilyNames ? this.lFontName : this.wFontName;
    if (family === null) throw new TypeError('The font has no family name');
    return family;
  }

  /** The family name of the platform without spaces, a lookup key. */
  getFontFamilyKey(): string {
    return this.getFontFamily().replaceAll(' ', '');
  }
}
