#region Copyright
/*
 *  Report Manager:  Database Reporting tool for .Net and Mono
 *
 *     The contents of this file are subject to the MPL License
 *     with optional use of GPL or LGPL licenses.
 *     You may not use this file except in compliance with the
 *     Licenses. You may obtain copies of the Licenses at:
 *     http://reportman.sourceforge.net/license
 *
 *     Software is distributed on an "AS IS" basis,
 *     WITHOUT WARRANTY OF ANY KIND, either
 *     express or implied.  See the License for the specific
 *     language governing rights and limitations.
 *
 *  Copyright (c) 1994 - 2008 Toni Martir (toni@reportman.es)
 *  All Rights Reserved.
*/
#endregion

using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
namespace Reportman.Drawing
{
    /// <summary>
    /// Holds metrics for a single glyph: its advance width, glyph index and source character.
    /// </summary>
    public struct GlyphInfo
    {
        /// <summary>
        /// Advance width of the glyph.
        /// </summary>
        public double Width;
        /// <summary>
        /// Index of the glyph within the font.
        /// </summary>
        public int Glyph;
        /// <summary>
        /// Source character this glyph was produced from.
        /// </summary>
        public char Char;
    }
    /// <summary>
    /// Describes the positioned glyph produced by text shaping, including its index, offsets,
    /// advances, source character/cluster and the font styling (family, size, color, bold/italic) applied to it.
    /// </summary>
    public struct TGlyphPos
    {
        /// <summary>
        /// Index of the glyph within the font.
        /// </summary>
        public int GlyphIndex;
        /// <summary>
        /// Horizontal offset applied to the glyph when positioning it.
        /// </summary>
        public int XOffset;
        /// <summary>
        /// Vertical offset applied to the glyph when positioning it.
        /// </summary>
        public int YOffset;
        /// <summary>
        /// Horizontal advance to the next glyph.
        /// </summary>
        public int XAdvance;
        /// <summary>
        /// Vertical advance to the next glyph.
        /// </summary>
        public int YAdvance;
        /// <summary>
        /// Source character this glyph was produced from.
        /// </summary>
        public char CharCode;
        /// <summary>
        /// Index of the text cluster this glyph belongs to.
        /// </summary>
        public int Cluster;
        /// <summary>
        /// Index of the cluster relative to the current line.
        /// </summary>
        public int LineCluster;
        /// <summary>
        /// Font family name applied to the glyph.
        /// </summary>
        public string FontFamily;
        /// <summary>
        /// Whether the glyph is rendered bold.
        /// </summary>
        public bool Bold;
        /// <summary>
        /// Whether the glyph is rendered italic.
        /// </summary>
        public bool Italic;
        /// <summary>
        /// Whether the glyph is underlined.
        /// </summary>
        public bool Underline;
        /// <summary>
        /// Whether the glyph is struck out.
        /// </summary>
        public bool StrikeOut;
        /// <summary>
        /// Font size applied to the glyph, in points.
        /// </summary>
        public float FontSize;
        /// <summary>
        /// Whether an explicit font size is set for the glyph.
        /// </summary>
        public bool HasFontSize;
        /// <summary>
        /// Text color applied to the glyph, as a packed RGB value.
        /// </summary>
        public int Color;
        /// <summary>
        /// Whether an explicit color is set for the glyph.
        /// </summary>
        public bool HasColor;
    }
    /// <summary>
    /// Describes a font as used by the rendering engine: the base PDF font type, platform-specific
    /// font names, size, color and style flags (bold, italic, underline, strike-out, background).
    /// </summary>
    public class PDFFont
    {
        /// <summary>
        /// Base PDF font type used as the font family.
        /// </summary>
        public PDFFontType Name;
        /// <summary>
        /// Font family name used on Windows.
        /// </summary>
        public string WFontName;
        /// <summary>
        /// Font family name used on Unix/Linux.
        /// </summary>
        public string LFontName;
        /// <summary>
        /// Font size in points.
        /// </summary>
        public int Size;
        /// <summary>
        /// Text color as a packed RGB value.
        /// </summary>
        public int Color;
        /// <summary>
        /// Bit flags describing the font style.
        /// </summary>
        public int Style;
        /// <summary>
        /// Whether the text is rendered italic.
        /// </summary>
        public bool Italic;
        /// <summary>
        /// Whether the text is underlined.
        /// </summary>
        public bool Underline;
        /// <summary>
        /// Whether the text is rendered bold.
        /// </summary>
        public bool Bold;
        /// <summary>
        /// Whether the text is struck out.
        /// </summary>
        public bool StrikeOut;
        /// <summary>
        /// Whether the text background is transparent.
        /// </summary>
        public bool Transparent;
        /// <summary>
        /// Background color as a packed RGB value.
        /// </summary>
        public int BackColor;
        /// <summary>
        /// Initializes a new instance with the default Courier font, size 10 and a white background.
        /// </summary>
        public PDFFont()
        {
            Name = PDFFontType.Courier;
            Size = 10;
            BackColor = 0xFFFFFF;
        }
        /// <summary>
        /// Returns the platform-specific font family name (the Unix name on Unix, otherwise the Windows name).
        /// </summary>
        /// <returns>The font family name for the current platform.</returns>
        public string GetFontFamily()
        {
            if (PlatformID.Unix == System.Environment.OSVersion.Platform)
                return LFontName;
            else
                return WFontName;
        }
        /// <summary>
        /// Returns the platform-specific font family name with spaces removed, suitable as a lookup key.
        /// </summary>
        /// <returns>The font family name for the current platform without spaces.</returns>
        public string GetFontFamilyKey()
        {
            if (PlatformID.Unix == System.Environment.OSVersion.Platform)
                return LFontName.Replace(" ", "");
            else
                return WFontName.Replace(" ", "");
        }
    }
    /// <summary>
    /// Wraps the raw bytes of a TrueType/OpenType font file together with the offset of its table directory.
    /// </summary>
    public class AdvFontData
    {
        /// <summary>
        /// Raw bytes of the font file.
        /// </summary>
        public byte[] Data;
        /// <summary>
        /// Byte offset of the font's table directory within <see cref="Data"/>.
        /// </summary>
        public uint DirectoryOffset;
    }
    /// <summary>
    /// Aggregates all the metrics and tables needed to embed and measure a TrueType/Type1 font in a PDF:
    /// ascent/descent, bounding box, per-glyph widths, kerning, encoding and the PDF object indices for the font.
    /// </summary>
    public class TTFontData
    {
        /// <summary>
        /// Platform-specific logical font handle or descriptor.
        /// </summary>
        public object LogFont;
        /// <summary>
        /// Whether the font is embedded in the output document.
        /// </summary>
        public bool Embedded;
        /// <summary>
        /// Raw font file bytes and table-directory offset.
        /// </summary>
        public AdvFontData FontData;
        /// <summary>
        /// PostScript name of the font.
        /// </summary>
        public string PostcriptName;
        /// <summary>
        /// Character encoding used by the font.
        /// </summary>
        public string Encoding;
        /// <summary>
        /// Core font metrics: ascent, descent, leading, cap height, flags, weight and height.
        /// </summary>
        public int Ascent, Descent, Leading, CapHeight, Flags, FontWeight, Height;
        /// <summary>
        /// Recommended spacing between consecutive lines of text.
        /// </summary>
        public int LineSpacing;
        /// <summary>
        /// Height of the font's em square.
        /// </summary>
        public int EmHeight;
        /// <summary>
        /// Maximum and average glyph advance widths.
        /// </summary>
        public int MaxWidth, AvgWidth;
        /// <summary>
        /// Vertical stem thickness of the font.
        /// </summary>
        public double StemV;
        /// <summary>
        /// Font family name and stretch (width) description.
        /// </summary>
        public string FontFamily, FontStretch;
        /// <summary>
        /// Italic slant angle of the font, in degrees.
        /// </summary>
        public double ItalicAngle;
        /// <summary>
        /// Bounding box that encloses all glyphs in the font.
        /// </summary>
        public Rectangle FontBBox;
        /// <summary>
        /// Face (typeface) name of the font.
        /// </summary>
        public string FaceName;
        /// <summary>
        /// Style name of the font (for example, Regular or Bold).
        /// </summary>
        public string StyleName;
        /// <summary>
        /// Whether the font is a Type 1 (PostScript) font.
        /// </summary>
        public bool Type1;
        /// <summary>
        /// Whether the font provides kerning information.
        /// </summary>
        public bool HaveKerning;
        /// <summary>
        /// Name assigned to the font object in the PDF.
        /// </summary>
        public string ObjectName;
        /// <summary>
        /// Index of the font object in the PDF.
        /// </summary>
        public long ObjectIndex;
        /// <summary>
        /// Index of the parent font object in the PDF.
        /// </summary>
        public long ObjectIndexParent;
        /// <summary>
        /// Index of the font descriptor object in the PDF.
        /// </summary>
        public long DescriptorIndex;
        /// <summary>
        /// Index of the ToUnicode CMap object in the PDF.
        /// </summary>
        public long ToUnicodeIndex;
        /// <summary>
        /// Number of font design units per em.
        /// </summary>
        public double UnitsPerEM;
        /// <summary>
        /// Lowest character code that has been loaded.
        /// </summary>
        public int FirstLoaded;
        /// <summary>
        /// Highest character code that has been loaded.
        /// </summary>
        public int LastLoaded;
        /// <summary>
        /// Whether the font is treated as a Unicode font.
        /// </summary>
        public bool IsUnicode;
        /// <summary>
        /// Maps characters to their glyph indices.
        /// </summary>
        public SortedList<char, int> Glyphs;
        /// <summary>
        /// Maps characters to their advance widths.
        /// </summary>
        public SortedList<char, double> Widths;
        /// <summary>
        /// Maps encoded character pairs to their kerning adjustments.
        /// </summary>
        public SortedList<ulong, int> Kernings;
        /// <summary>
        /// Shared cache of loaded font file data, keyed by font name.
        /// </summary>
        public static SortedList<string, AdvFontData> FontDatas;
        /// <summary>
        /// Caches per-character glyph metrics already measured.
        /// </summary>
        public SortedList<char, GlyphInfo> CacheWidths;
        /// <summary>
        /// Whether the loaded font is bold.
        /// </summary>
        public bool IsBold;
        /// <summary>
        /// Whether the loaded font is italic.
        /// </summary>
        public bool IsItalic;
        /// <summary>
        /// Caches glyph metrics keyed by glyph index.
        /// </summary>
        public SortedList<int, GlyphInfo> glyphsInfo = new SortedList<int, GlyphInfo>();


        /// <summary>
        /// Initializes a new instance with default metrics and empty width, kerning and glyph tables.
        /// </summary>
        public TTFontData()
        {
            Flags = 32;
            FontWeight = 0;
            MaxWidth = 0;
            AvgWidth = 0;
            StemV = 0;
            ItalicAngle = 0;
            FaceName = "";
            StyleName = "";
            CapHeight = 0;
            FirstLoaded = 65536;
            LastLoaded = -1;
            Widths = new SortedList<char, double>();
            Kernings = new SortedList<ulong, int>();
            Glyphs = new SortedList<char, int>();
            UnitsPerEM = 1024;
        }
    }
    /// <summary>
    /// Abstract provider of font metrics and text measurement; implementations supply character/glyph
    /// widths, kerning, text extent and font stream data for a given platform's font subsystem.
    /// </summary>
    public abstract class FontInfoProvider
    {
        /// <summary>
        /// Populates <paramref name="fontData"/> with the metrics of <paramref name="pdfFont"/>
        /// as resolved by the platform font subsystem.
        /// </summary>
        /// <param name="pdfFont">The font whose metrics are requested.</param>
        /// <param name="fontData">The structure filled with the resolved font metrics.</param>
        public abstract void FillFontData(PDFFont pdfFont, TTFontData fontData);
        /// <summary>
        /// Returns the advance width of a character in the given font.
        /// </summary>
        /// <param name="pdfFont">The font used to measure the character.</param>
        /// <param name="fontData">Metrics of the font used to measure the character.</param>
        /// <param name="charCode">The character to measure.</param>
        /// <returns>The advance width of the character.</returns>
        public abstract double GetCharWidth(PDFFont pdfFont, TTFontData fontData,
                 char charCode);
        /// <summary>
        /// Returns the advance width of the glyph with the given index in the font.
        /// </summary>
        /// <param name="pdfFont">The font used to measure the glyph.</param>
        /// <param name="fontData">Metrics of the font used to measure the glyph.</param>
        /// <param name="glyph">The index of the glyph within the font.</param>
        /// <param name="charC">The source character the glyph corresponds to.</param>
        /// <returns>The advance width of the glyph.</returns>
        public abstract double GetGlyphWidth(PDFFont pdfFont, TTFontData fontData, int glyph, char charC);
        /// <summary>
        /// Measures the given text with the specified font and layout options, updating
        /// <paramref name="Rect"/> with the required bounds.
        /// </summary>
        /// <param name="Text">The text to measure.</param>
        /// <param name="Rect">On input, the available area; on output, the bounds required by the text.</param>
        /// <param name="pdfFont">The font used to render the text.</param>
        /// <param name="fontData">Metrics of the font used to render the text.</param>
        /// <param name="wordwrap">Whether text wraps to additional lines when it exceeds the width.</param>
        /// <param name="singleline">Whether the text is constrained to a single line.</param>
        /// <param name="FontSize">The font size, in points, used to measure the text.</param>
        /// <param name="isHtml">Whether the text contains HTML markup that affects layout.</param>
        /// <returns>The per-line layout information for the measured text.</returns>
        public abstract List<LineInfo>  TextExtent(string Text,
           ref Rectangle Rect, PDFFont pdfFont, TTFontData fontData,
            bool wordwrap,bool singleline,double FontSize, bool isHtml = false);

        /// <summary>
        /// Returns the kerning adjustment applied between two adjacent characters in the font.
        /// </summary>
        /// <param name="pdfFont">The font used for kerning.</param>
        /// <param name="fontData">Metrics of the font used for kerning.</param>
        /// <param name="leftChar">The character on the left of the pair.</param>
        /// <param name="rightChar">The character on the right of the pair.</param>
        /// <returns>The kerning adjustment between the two characters.</returns>
        public abstract int GetKerning(PDFFont pdfFont, TTFontData fontData,
                 char leftChar, char rightChar);
        /// <summary>
        /// Returns a stream containing the embeddable font program for the given font.
        /// </summary>
        /// <param name="data">The font whose program is returned.</param>
        /// <returns>A stream with the font program bytes.</returns>
        public abstract MemoryStream GetFontStream(TTFontData data);
    }
}
