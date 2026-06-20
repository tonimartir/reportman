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
        public double Width;
        public int Glyph;
        public char Char;
    }
    /// <summary>
    /// Describes the positioned glyph produced by text shaping, including its index, offsets,
    /// advances, source character/cluster and the font styling (family, size, color, bold/italic) applied to it.
    /// </summary>
    public struct TGlyphPos
    {
        public int GlyphIndex;
        public int XOffset;
        public int YOffset;
        public int XAdvance;
        public int YAdvance;
        public char CharCode;
        public int Cluster;
        public int LineCluster;
        public string FontFamily;
        public bool Bold;
        public bool Italic;
        public bool Underline;
        public bool StrikeOut;
        public float FontSize;
        public bool HasFontSize;
        public int Color;
        public bool HasColor;
    }
    /// <summary>
    /// Describes a font as used by the rendering engine: the base PDF font type, platform-specific
    /// font names, size, color and style flags (bold, italic, underline, strike-out, background).
    /// </summary>
    public class PDFFont
    {
        public PDFFontType Name;
        public string WFontName;
        public string LFontName;
        public int Size;
        public int Color;
        public int Style;
        public bool Italic;
        public bool Underline;
        public bool Bold;
        public bool StrikeOut;
        public bool Transparent;
        public int BackColor;
        public PDFFont()
        {
            Name = PDFFontType.Courier;
            Size = 10;
            BackColor = 0xFFFFFF;
        }
        public string GetFontFamily()
        {
            if (PlatformID.Unix == System.Environment.OSVersion.Platform)
                return LFontName;
            else
                return WFontName;
        }
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
        public byte[] Data;
        public uint DirectoryOffset;
    }
    /// <summary>
    /// Aggregates all the metrics and tables needed to embed and measure a TrueType/Type1 font in a PDF:
    /// ascent/descent, bounding box, per-glyph widths, kerning, encoding and the PDF object indices for the font.
    /// </summary>
    public class TTFontData
    {
        public object LogFont;
        public bool Embedded;
        public AdvFontData FontData;
        public string PostcriptName;
        public string Encoding;
        public int Ascent, Descent, Leading, CapHeight, Flags, FontWeight, Height;
        public int LineSpacing;
        public int EmHeight;
        public int MaxWidth, AvgWidth;
        public double StemV;
        public string FontFamily, FontStretch;
        public double ItalicAngle;
        public Rectangle FontBBox;
        public string FaceName;
        public string StyleName;
        public bool Type1;
        public bool HaveKerning;
        public string ObjectName;
        public long ObjectIndex;
        public long ObjectIndexParent;
        public long DescriptorIndex;
        public long ToUnicodeIndex;
        public double UnitsPerEM;
        public int FirstLoaded;
        public int LastLoaded;
        public bool IsUnicode;
        public SortedList<char, int> Glyphs;
        public SortedList<char, double> Widths;
        public SortedList<ulong, int> Kernings;
        public static SortedList<string, AdvFontData> FontDatas;
        public SortedList<char, GlyphInfo> CacheWidths;
        public bool IsBold;
        public bool IsItalic;
        public SortedList<int, GlyphInfo> glyphsInfo = new SortedList<int, GlyphInfo>();


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
        public abstract void FillFontData(PDFFont pdfFont, TTFontData fontData);
        public abstract double GetCharWidth(PDFFont pdfFont, TTFontData fontData,
                 char charCode);
        public abstract double GetGlyphWidth(PDFFont pdfFont, TTFontData fontData, int glyph, char charC);
        public abstract List<LineInfo>  TextExtent(string Text,
           ref Rectangle Rect, PDFFont pdfFont, TTFontData fontData,
            bool wordwrap,bool singleline,double FontSize, bool isHtml = false);
  
        public abstract int GetKerning(PDFFont pdfFont, TTFontData fontData,
                 char leftChar, char rightChar);
        public abstract MemoryStream GetFontStream(TTFontData data);
    }
}
