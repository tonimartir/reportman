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
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;


namespace Reportman.Drawing
{
    /// <summary>
    /// Line information when measuring pdf texts
    /// </summary>
    public struct LineInfo
    {
        /// <summary>
        /// Index in the source text where this line starts.
        /// </summary>
        public int Position;
        /// <summary>
        /// Number of characters that belong to this line.
        /// </summary>
        public int Size;
        /// <summary>
        /// Width of the line in resolution units.
        /// </summary>
        public int Width;
        /// <summary>
        /// Height of the line (line spacing) in resolution units.
        /// </summary>
        public int Height;
        /// <summary>
        /// Vertical offset of the line top relative to the text block, in resolution units.
        /// </summary>
        public int TopPos;
        /// <summary>
        /// Print step (characters-per-inch) used to measure this line.
        /// </summary>
        public PrintStepType Step;
        /// <summary>
        /// True when this is the last line of a paragraph, disabling justification.
        /// </summary>
        public bool LastLine;
        /// <summary>
        /// Height of the line as a floating-point value.
        /// </summary>
        public double LineHeight;
        /// <summary>
        /// Shaped glyph positions for the line, or null when only line metrics were computed.
        /// </summary>
        public List<TGlyphPos> Glyphs;
        /// <summary>
        /// Text content of the line.
        /// </summary>
        public string Text;
    }
    struct PageInfo
    {
        public int PageWidth;
        public int PageHeight;
    }
    class PageInfos
    {
        PageInfo[] FObjects;
        const int FIRST_ALLOCATION_OBJECTS = 50;
        int FCount;
        public PageInfos()
        {
            FCount = 0;
            FObjects = new PageInfo[FIRST_ALLOCATION_OBJECTS];
        }
        public void Clear()
        {
            FCount = 0;
        }
        private void CheckRange(int index)
        {
            if ((index < 0) || (index >= FCount))
                throw new Exception("Index out of range on PageInfos collection");
        }
        public PageInfo this[int index]
        {
            get { CheckRange(index); return FObjects[index]; }
            set { CheckRange(index); FObjects[index] = value; }
        }
        public int Count { get { return FCount; } }
        public void Add(PageInfo obj)
        {
            if (FCount > (FObjects.Length - 2))
            {
                PageInfo[] nobjects = new PageInfo[FCount];
                System.Array.Copy(FObjects, 0, nobjects, 0, FCount);
                FObjects = new PageInfo[FObjects.Length * 2];
                System.Array.Copy(nobjects, 0, FObjects, 0, FCount);
            }
            FObjects[FCount] = obj;
            FCount++;
        }
    }
    /// <summary>
    /// Growable list of in-memory streams that spills to temporary files once the
    /// total buffered size exceeds a threshold, keeping memory use bounded.
    /// </summary>
    public class MemStreams : IDisposable
    {
        const long MAX_MEM_SIZE = 100000000;
        MemoryStream[] FItems;
        long TotalSize = 0;
        SortedList<int, string> FTempFiles = new();
        SortedList<int, long> FFileSizes = new();
        const int FIRST_ALLOCATION_OBJECTS = 50;
        int FCount;
        /// <summary>
        /// Initializes an empty stream list with an initial capacity.
        /// </summary>
        public MemStreams()
        {
            FCount = 0;
            FItems = new MemoryStream[FIRST_ALLOCATION_OBJECTS];
        }
        /// <summary>
        /// Removes all streams, deleting any temporary spill files and resetting the buffered size.
        /// </summary>
        public void Clear()
        {
            for (int i = 0; i < FCount; i++)
            {
                RemoveTempFile(i);
                FItems[i] = null;
            }
            FCount = 0;
            TotalSize = 0;
        }
        private void CheckRange(int index)
        {
            if ((index < 0) || (index >= FCount))
                throw new Exception("Index out of range on PrintItems collection");
        }
        private void RemoveTempFile(int idx)
        {
            if (FTempFiles.IndexOfKey(idx) >= 0)
            {
                if (File.Exists(FTempFiles[idx]))
                    File.Delete(FTempFiles[idx]);
                FTempFiles.Remove(idx);
            }
        }
        /// <summary>
        /// Gets or sets the stream at the given index, reloading it from a temporary file when it has been spilled to disk.
        /// </summary>
        public MemoryStream this[int index]
        {
            get
            {
                CheckRange(index);
                MemoryStream mstream = FItems[index];
                if (FTempFiles.IndexOfKey(index) >= 0)
                {
                    mstream = Reportman.Drawing.StreamUtil.FileToMemoryStream(FTempFiles[index]);
                }
                return mstream;
            }
            set
            {
                CheckRange(index);
                FItems[index] = value;
                RemoveTempFile(index);
                TotalSize = TotalSize - FFileSizes[index];
                TotalSize = TotalSize - value.Length;
            }
        }
        /// <summary>
        /// Gets the number of streams in the list.
        /// </summary>
        public int Count { get { return FCount; } }
        /// <summary>
        /// Appends a stream, spilling it to a temporary file when the total buffered size exceeds the memory threshold.
        /// </summary>
        public void Add(MemoryStream obj)
        {
            TotalSize = TotalSize + obj.Length;
            if (FCount > (FItems.Length - 2))
            {
                MemoryStream[] nobjects = new MemoryStream[FCount];
                System.Array.Copy(FItems, 0, nobjects, 0, FCount);
                FItems = new MemoryStream[FItems.Length * 2];
                System.Array.Copy(nobjects, 0, FItems, 0, FCount);
            }
            FItems[FCount] = obj;
            FFileSizes.Add(FCount, obj.Length);
            TotalSize = TotalSize + obj.Length;
            if (TotalSize > MAX_MEM_SIZE)
            {
                string tmpfilename = System.IO.Path.GetTempFileName();
                Reportman.Drawing.StreamUtil.MemoryStreamToFile(obj, tmpfilename);
                FItems[Count] = null;
                FTempFiles.Add(FCount, tmpfilename);
            }
            FCount++;
        }
        /// <summary>
        /// Deletes all temporary spill files created by the list.
        /// </summary>
        public void Dispose()
        {
            while (FTempFiles.Count > 0)
                RemoveTempFile(FTempFiles.Keys[0]);
        }
    }
    /// <summary>
    /// Low-level PDF drawing surface that emits PDF content-stream operators for lines,
    /// shapes, and (shaped or plain) text, handling fonts, colors, and unit conversion.
    /// </summary>
    public class PDFCanvas
    {
        /// <summary>
        /// Initializes the canvas with the font metrics and bitmap encoding providers it will use while drawing.
        /// </summary>
        /// <param name="fontInfoProvider">Provider of font metrics and glyph data.</param>
        /// <param name="bitmapInfoProvider">Provider that encodes images into PDF-compatible bitmap streams.</param>
        public PDFCanvas(FontInfoProvider fontInfoProvider, IBitmapInfoProvider bitmapInfoProvider)
        {
            FInfoProvider = fontInfoProvider;
            FBitmapInfoProvider = bitmapInfoProvider;
            OldPenColor = -1;
            OldBrushColor = -1;
            Resolution = Twips.TWIPS_PER_INCH;
            FFontData = new SortedList();
            FFont = new PDFFont();
            FResolution = Twips.TWIPS_PER_INCH;
            Lines = new List<LineInfo>();
        }
        /// <summary>
        /// PDF content-stream marker that terminates a stream object.
        /// </summary>
        public static string ENDSTREAM = "" + (char)10 + "endstream";
        /// <summary>
        /// Backing field for the font metrics provider.
        /// </summary>
        public FontInfoProvider FInfoProvider;
        /// <summary>
        /// Gets the font metrics and glyph provider used while drawing text.
        /// </summary>
        public FontInfoProvider InfoProvider
        {
            get { return FInfoProvider; }
        }
        /// <summary>
        /// Backing field for the bitmap encoding provider.
        /// </summary>
        public IBitmapInfoProvider FBitmapInfoProvider;
        /// <summary>
        /// Gets the provider that encodes images into PDF-compatible bitmap streams.
        /// </summary>
        public IBitmapInfoProvider BitmapInfoProvider
        {
            get { return FBitmapInfoProvider; }
        }
        /// <summary>
        /// PDF conformance level (for example PDF 1.4 or PDF/A-3) that governs the generated output.
        /// </summary>
        public PDFConformanceType PDFConformance;
        private PDFFont FFont;
        /// <summary>
        /// The PDF document this canvas writes its content stream into.
        /// </summary>
        public PDFFile File;
        private int FResolution;
        private List<LineInfo> Lines;
        private SortedList FFontData;
        /// <summary>
        /// Device resolution in twips per inch used to convert layout units to PDF points.
        /// </summary>
        public int Resolution;
        /// <summary>
        /// When true, TextExtent always routes to the complex shaper (InfoProvider.TextExtent —
        /// DirectWrite on Windows, HarfBuzz on Linux) and populates LineInfo.Glyphs with glyph
        /// indices and advances. Default false preserves the historical fast path (TextExtentSimple)
        /// that only computes line widths without glyph data. Callers that need per-glyph data
        /// (e.g. glyph-indexed ExtTextOutW rendering) must set this to true before measuring.
        /// </summary>
        public bool ForceComplexShaping = false;
        /// <summary>
        /// Gets the per-line measurement results produced by the most recent simple text-extent pass.
        /// </summary>
        public List<LineInfo> LineInfo
        {
            get
            {
                return Lines;
            }
        }
        /// <summary>
        /// Gets the current font used for text output.
        /// </summary>
        public PDFFont Font { get { return FFont; } }
        /// <summary>
        /// Current pen (line) color as a packed RGB value.
        /// </summary>
        public int PenColor;
        /// <summary>
        /// Current pen dash style (0 solid, 1 dash, 2 dot, 3 dash-dot, 4 dash-dot-dot, 5 clear).
        /// </summary>
        public int PenStyle;
        /// <summary>
        /// Current pen width in resolution units.
        /// </summary>
        public int PenWidth;
        /// <summary>
        /// Current brush (fill) color as a packed RGB value.
        /// </summary>
        public int BrushColor;
        /// <summary>
        /// Current brush style (for example 1 for clear/none and 2 for solid).
        /// </summary>
        public int BrushStyle;

        /// <summary>
        /// Last brush color written to the content stream, used to avoid redundant color operators.
        /// </summary>
        public int OldBrushColor;
        /// <summary>
        /// Last pen color written to the content stream, used to avoid redundant color operators.
        /// </summary>
        public int OldPenColor;
        /// <summary>
        /// Pen color saved by <see cref="SaveGraph"/> and restored by <see cref="RestoreGraph"/>.
        /// </summary>
        public int SavedPenColor;
        /// <summary>
        /// Brush color saved by <see cref="SaveGraph"/> and restored by <see cref="RestoreGraph"/>.
        /// </summary>
        public int SavedBrushColor;


        /// <summary>
        /// Gets the cache of TrueType font data keyed by font family and style.
        /// </summary>
        public SortedList FontData
        {
            get { return FFontData; }
        }

        private bool translatedy;
        /// <summary>
        /// Converts a horizontal layout coordinate to a PDF-point string using the current resolution.
        /// </summary>
        /// <param name="Value">Horizontal coordinate in resolution units.</param>
        /// <returns>The coordinate formatted as PDF points with a dot decimal separator.</returns>
        public string UnitsToTextX(double Value)
        {
            double nvalue = ((double)(Value) / FResolution) * PDFFile.CONS_PDFRES;
            string aresult = nvalue.ToString("##0.00");
#if REPMAN_COMPACT
			string decseparator=CultureInfo.CurrentUICulture.NumberFormat.NumberDecimalSeparator;
#else
            string decseparator = Thread.CurrentThread.CurrentCulture.NumberFormat.NumberDecimalSeparator;
#endif
            return aresult.Replace(decseparator, ".");
        }
        /// <summary>
        /// Converts a vertical layout coordinate to a PDF-point string, flipping the Y axis to the PDF bottom-left origin.
        /// </summary>
        /// <param name="Value">Vertical coordinate in resolution units.</param>
        /// <returns>The coordinate formatted as PDF points with a dot decimal separator.</returns>
        public string UnitsToTextY(double Value)
        {
            double nvalue;
            if (translatedy)
                nvalue = ((double)(-Value) / FResolution) * PDFFile.CONS_PDFRES;
            else
                nvalue = ((double)(File.PageHeight - Value) / FResolution) * PDFFile.CONS_PDFRES;
            string aresult = nvalue.ToString("##0.00");
#if REPMAN_COMPACT
			string decseparator = CultureInfo.CurrentUICulture.NumberFormat.NumberDecimalSeparator;
#else
            string decseparator = Thread.CurrentThread.CurrentCulture.NumberFormat.NumberDecimalSeparator;
#endif
            return aresult.Replace(decseparator, ".");
        }
        string UnitsToTextText(int Value, int FSize)
        {
            double nvalue;
            if (translatedy)
                nvalue = (((double)(-Value) / FResolution) * PDFFile.CONS_PDFRES) - FSize;
            else
                nvalue = (((double)(File.PageHeight - Value) / FResolution) * PDFFile.CONS_PDFRES) - FSize;
            string aresult = nvalue.ToString("##0.00");
#if REPMAN_COMPACT
			string decseparator=CultureInfo.CurrentUICulture.NumberFormat.NumberDecimalSeparator;
#else
            string decseparator = Thread.CurrentThread.CurrentCulture.NumberFormat.NumberDecimalSeparator;
#endif
            return aresult.Replace(decseparator, ".");
        }
        /// <summary>
        /// Formats a number with two decimals and a dot decimal separator for use in PDF operators.
        /// </summary>
        /// <param name="Value">The value to format.</param>
        /// <returns>The value formatted with a dot decimal separator.</returns>
        public static string NumberToText(double Value)
        {
            string aresult = Value.ToString("##0.00");
#if REPMAN_COMPACT
			string decseparator=CultureInfo.CurrentUICulture.NumberFormat.NumberDecimalSeparator;
#else
            string decseparator = Thread.CurrentThread.CurrentCulture.NumberFormat.NumberDecimalSeparator;
#endif
            return aresult.Replace(decseparator, ".");
        }
        string RGBToFloats(int acolor)
        {
#if REPMAN_COMPACT
			string decseparator=CultureInfo.CurrentUICulture.NumberFormat.NumberDecimalSeparator;
#else
            string decseparator = Thread.CurrentThread.CurrentCulture.NumberFormat.NumberDecimalSeparator;
#endif
            string aresult;
            byte r, g, b;
            r = (byte)acolor;
            aresult = ((double)r / 256).ToString("0.00");
            g = (byte)(acolor >> 8);
            aresult = aresult + " " + ((double)g / 256).ToString("0.00");
            b = (byte)(acolor >> 16);
            aresult = aresult + " " + ((double)b / 256).ToString("0.00");
            return aresult.Replace(decseparator, ".");
        }
        private void SWriteLine(Stream nstream, string value)
        {
            StreamUtil.SWriteLine(nstream, value, PDFConformance == PDFConformanceType.PDF_1_4);
        }
        /// <summary>
        /// Returns the end-of-line sequence appropriate for the current PDF conformance level.
        /// </summary>
        /// <returns>The end-of-line character sequence.</returns>
        public string EOL()
        {
            return PDFConformance == PDFConformanceType.PDF_1_4 ? "" + (char)10 + (char)13 : "" + (char)10;
        }
        private void SetDash()
        {
            switch (PenStyle)
            {
                // Dash
                case 1:
                    SWriteLine(File.STempStream, "[16 8] 0 d");
                    break;
                // Dot
                case 2:
                    SWriteLine(File.STempStream, "[1] 0 d");
                    break;
                // Dash Dot
                case 3:
                    SWriteLine(File.STempStream, "[8 7 2 7] 0 d");
                    break;
                // Dash Dot Dot
                case 4:
                    SWriteLine(File.STempStream, "[8 4 2 4 2 4] 0 d");
                    break;
                // Clear
                case 5:
                    break;
                default:
                    SWriteLine(File.STempStream, "[] 0 d");
                    break;
            }
        }
        /// <summary>
        /// Draws a straight line between two points using the current pen color, width and dash style.
        /// </summary>
        /// <param name="x1">Start X coordinate in resolution units.</param>
        /// <param name="y1">Start Y coordinate in resolution units.</param>
        /// <param name="x2">End X coordinate in resolution units.</param>
        /// <param name="y2">End Y coordinate in resolution units.</param>
        public void Line(int x1, int y1, int x2, int y2)
        {
            if (PenStyle == 5)
                return;
            SetDash();
            int LineWidth = 1;
            if (PenWidth > 0)
                LineWidth = PenWidth;
            SWriteLine(File.STempStream, UnitsToTextX(LineWidth) + " w");

            WritePenColor(PenColor);
            WriteBrushColor(PenColor);
            SWriteLine(File.STempStream, UnitsToTextX(x1) + ' ' + UnitsToTextY(y1) + " m");
            SWriteLine(File.STempStream, UnitsToTextX(x2) + ' ' + UnitsToTextY(y2) + " l");
            // S-Solid,  D-Dashed, B-Beveled, I-Inset, U-Underline
            SWriteLine(File.STempStream, "S");

        }
        /// <summary>
        /// Emits a stroke-color operator, skipping it when optimization is on and the color is unchanged.
        /// </summary>
        /// <param name="NewColor">Packed RGB pen color to set.</param>
        public void WritePenColor(int NewColor)
        {
            bool dowrite = true;
            if (File.Optimized)
            {
                dowrite = (OldPenColor != NewColor);
            }
            if (dowrite)
            {
                SWriteLine(File.STempStream, RGBToFloats(NewColor) + " RG");
                OldPenColor = NewColor;
            }
        }
        /// <summary>
        /// Emits a fill-color operator, skipping it when optimization is on and the color is unchanged.
        /// </summary>
        /// <param name="NewColor">Packed RGB brush color to set.</param>
        public void WriteBrushColor(int NewColor)
        {
            bool dowrite = true;
            if (File.Optimized)
            {
                dowrite = OldBrushColor != NewColor;
            }
            if (dowrite)
            {
                SWriteLine(File.STempStream, RGBToFloats(NewColor) + " rg");
                OldBrushColor = NewColor;
            }
        }
        /// <summary>
        /// Returns the embedded/linked TrueType font data for the current font, or null when the font
        /// does not require embedding; throws for PDF/A-3 when no font provider is available.
        /// </summary>
        /// <returns>The font data, or null when no embedded font data applies.</returns>
        public TTFontData GetTTFontData()
        {
            if (PDFConformance == PDFConformanceType.PDF_1_4)
            {
                if (!((FFont.Name == PDFFontType.Linked) || (FFont.Name == PDFFontType.Embedded)))
                    return null;
            }
            if (InfoProvider == null)
            {
                if (PDFConformance == PDFConformanceType.PDF_A_3)
                    throw new Exception("No info provider for fonts, pdf conformance A3 requires embedded fonts");
                return null;
            }
            return UpdateFonts();
        }
        /// <summary>
        /// Ensures the current font's TrueType data is present in the font cache, creating and filling it on first use.
        /// </summary>
        /// <returns>The cached font data for the current font, or null when the font does not require embedding.</returns>
        public TTFontData UpdateFonts()
        {
            string searchname;
            TTFontData adata;

            if (PDFConformance != PDFConformanceType.PDF_A_3)
            {
                if (!((FFont.Name == PDFFontType.Linked) || (FFont.Name == PDFFontType.Embedded)))
                    return null;
            }
            if (InfoProvider == null)
                return null;
            searchname = FFont.GetFontFamilyKey() + FFont.Style.ToString("00000");
            adata = FFontData[searchname] as TTFontData;
            if (adata == null)
            {
                adata = new TTFontData();
                adata.Embedded = false;
                adata.ObjectName = FFont.GetFontFamilyKey() + FFont.Style.ToString();
                FFontData.Add(searchname, adata);
                adata.Embedded = (FFont.Name == PDFFontType.Embedded) || (PDFConformance == PDFConformanceType.PDF_A_3);
                if (adata.Embedded)
                {
                    adata.IsUnicode = true;
                }
                InfoProvider.FillFontData(FFont, adata);
            }
            return adata;
        }
        /// <summary>
        /// Draws an ellipse inscribed in the given bounding box using four Bezier curves, honoring the current pen and brush.
        /// </summary>
        /// <param name="X1">Left edge of the bounding box in resolution units.</param>
        /// <param name="Y1">Top edge of the bounding box in resolution units.</param>
        /// <param name="X2">Right edge of the bounding box in resolution units.</param>
        /// <param name="Y2">Bottom edge of the bounding box in resolution units.</param>
        public void Ellipse(int X1, int Y1, int X2, int Y2)
        {
            int LineWidth;
            double W, H;
            string opfill;
            if ((PenStyle == 5) && (BrushStyle == 2))
                return;
            SetDash();
            W = X2 - X1;
            H = Y2 - Y1;
            LineWidth = 1;
            if (PenWidth > 0)
                LineWidth = PenWidth;
            SWriteLine(File.STempStream, UnitsToTextX(LineWidth) + " w");
            WritePenColor(PenColor);
            WriteBrushColor(BrushColor);

            // Draws a ellipse in 4 pass
            SWriteLine(File.STempStream, UnitsToTextX(X1) + " " +
                UnitsToTextY(Y1 + ((int)(H / 2))) + " m");
            SWriteLine(File.STempStream,
                UnitsToTextX(X1) + " " + UnitsToTextY(Y1 + ((int)(H / 2)) - (int)Math.Round((double)H / 2 * 11 / 20)) + " " +
                UnitsToTextX(X1 + ((int)(W / 2)) - (int)Math.Round((double)W / 2 * 11 / 20)) + " " + UnitsToTextY(Y1) + " " +
                UnitsToTextX(X1 + ((int)(W / 2))) + " " + UnitsToTextY(Y1) + " c");
            SWriteLine(File.STempStream,
                UnitsToTextX(X1 + ((int)(W / 2)) + (int)Math.Round((double)W / 2 * 11 / 20)) + ' ' + UnitsToTextY(Y1) + " " +
                UnitsToTextX(X1 + (int)W) + " " + UnitsToTextY(Y1 + ((int)(H / 2)) - (int)Math.Round((double)H / 2 * 11 / 20)) + " " +
                UnitsToTextX(X1 + (int)W) + " " + UnitsToTextY(Y1 + ((int)(H / 2))) + " c");
            SWriteLine(File.STempStream,
                UnitsToTextX(X1 + (int)W) + " " + UnitsToTextY(Y1 + ((int)(H / 2)) + (int)Math.Round((double)H / 2 * 11 / 20)) + " " +
                UnitsToTextX(X1 + ((int)(W / 2)) + (int)Math.Round((double)W / 2 * 11 / 20)) + " " + UnitsToTextY(Y1 + (int)H) + " " +
                UnitsToTextX(X1 + ((int)(W / 2))) + " " + UnitsToTextY(Y1 + (int)H) + " c");
            SWriteLine(File.STempStream,
                UnitsToTextX(X1 + ((int)(W / 2)) - (int)Math.Round((double)W / 2 * 11 / 20)) + " " + UnitsToTextY(Y1 + (int)H) + " " +
                UnitsToTextX(X1) + " " + UnitsToTextY(Y1 + ((int)(H / 2)) + (int)Math.Round((double)H / 2 * 11 / 20)) + " " +
                UnitsToTextX(X1) + " " + UnitsToTextY(Y1 + ((int)(H / 2))) + " c");

            opfill = "B";
            if (PenStyle == 5)
                opfill = "f";
            // Bsclear
            if (BrushStyle == 1)
                SWriteLine(File.STempStream, "S");
            else
                // BsSolid
                SWriteLine(File.STempStream, opfill);
        }
        /// <summary>
        /// Draws a rectangle with rounded corners, honoring the current pen and brush.
        /// </summary>
        /// <param name="x1">Left edge in resolution units.</param>
        /// <param name="y1">Top edge in resolution units.</param>
        /// <param name="x2">Right edge in resolution units.</param>
        /// <param name="y2">Bottom edge in resolution units.</param>
        /// <param name="radius">Corner radius in resolution units.</param>
        public void RoundedRectangle(int x1, int y1, int x2, int y2, int radius)
        {
            int LineWidth;
            string opfill;
            if ((PenStyle == 5) && (BrushStyle == 2))
                return;
            SetDash();
            LineWidth = 1;
            if (PenWidth > 0)
                LineWidth = PenWidth;
            SWriteLine(File.STempStream, UnitsToTextX(LineWidth) + " w");

            WritePenColor(PenColor);
            WriteBrushColor(BrushColor);

            SWriteLine(File.STempStream, UnitsToTextX(x1) + " " + UnitsToTextY(y2 - radius) + " m");
            SWriteLine(File.STempStream, UnitsToTextX(x1) + " " + UnitsToTextY(y1 + radius) + " l");
            SWriteLine(File.STempStream, UnitsToTextX(x1) + " " + UnitsToTextY(y1) +
                " " + UnitsToTextX(x1 + radius) + " " + UnitsToTextY(y1) + " v");



            SWriteLine(File.STempStream, UnitsToTextX(x2 - radius) + " " + UnitsToTextY(y1) + " l");
            SWriteLine(File.STempStream, UnitsToTextX(x2) + " " + UnitsToTextY(y1) +
                " " + UnitsToTextX(x2) + " " + UnitsToTextY(y1 + radius) + " v");


            SWriteLine(File.STempStream, UnitsToTextX(x2) + " " + UnitsToTextY(y2 - radius) + " l");
            SWriteLine(File.STempStream, UnitsToTextX(x2) + " " + UnitsToTextY(y2) +
                " " + UnitsToTextX(x2 - radius) + " " + UnitsToTextY(y2) + " v");

            SWriteLine(File.STempStream, UnitsToTextX(x1 + radius) + " " + UnitsToTextY(y2) + " l");
            SWriteLine(File.STempStream, UnitsToTextX(x1) + " " + UnitsToTextY(y2) +
                " " + UnitsToTextX(x1) + " " + UnitsToTextY(y2 - radius) + " v");


            opfill = "B";
            if (PenStyle == 5)
                opfill = "f";
            // Bsclear
            if (BrushStyle == 1)
                SWriteLine(File.STempStream, "S");
            else
                // BsSolid
                SWriteLine(File.STempStream, opfill);
        }
        /// <summary>
        /// Draws a rectangle, honoring the current pen and brush.
        /// </summary>
        /// <param name="x1">Left edge in resolution units.</param>
        /// <param name="y1">Top edge in resolution units.</param>
        /// <param name="x2">Right edge in resolution units.</param>
        /// <param name="y2">Bottom edge in resolution units.</param>
        public void Rectangle(int x1, int y1, int x2, int y2)
        {
            int LineWidth;
            string opfill;
            if ((PenStyle == 5) && (BrushStyle == 2))
                return;
            SetDash();
            LineWidth = 1;
            if (PenWidth > 0)
                LineWidth = PenWidth;
            SWriteLine(File.STempStream, UnitsToTextX(LineWidth) + " w");

            WritePenColor(PenColor);
            WriteBrushColor(BrushColor);

            SWriteLine(File.STempStream, UnitsToTextX(x1) + " " + UnitsToTextY(y1) +
                " " + UnitsToTextX(x2 - x1) + " " + UnitsToTextX(-(y2 - y1)) + " re");
            opfill = "B";
            if (PenStyle == 5)
                opfill = "f";
            // Bsclear
            if (BrushStyle == 1)
                SWriteLine(File.STempStream, "S");
            else
                // BsSolid
                SWriteLine(File.STempStream, opfill);
        }
        /// <summary>
        /// Pushes the current graphics state (q operator) and remembers the current pen and brush colors.
        /// </summary>
        public void SaveGraph()
        {
            SWriteLine(File.STempStream, "q");
            SavedPenColor = OldPenColor;
            SavedBrushColor = OldBrushColor;
        }
        /// <summary>
        /// Pops the graphics state (Q operator) and restores the pen and brush colors saved by <see cref="SaveGraph"/>.
        /// </summary>
        public void RestoreGraph()
        {
            SWriteLine(File.STempStream, "Q");
            translatedy = false;
            OldPenColor = SavedPenColor;
            OldBrushColor = SavedBrushColor;
        }
        /// <summary>
        /// Returns the input string with its character order reversed.
        /// </summary>
        /// <param name="astring">The string to reverse.</param>
        /// <returns>The reversed string.</returns>
        public static string DoReverseString(string astring)
        {
            string aresult = "";
            for (int i = 0; i < astring.Length; i++)
                aresult = astring[i] + aresult;
            return aresult;
        }
        /// <summary>
        /// Maps a font to the internal PDF font resource name: the family key plus style for embedded/linked
        /// fonts, or the standard Type1 base-14 font index for the built-in fonts.
        /// </summary>
        /// <param name="Type1Font">The PDF font type being resolved.</param>
        /// <param name="oblique">Whether the italic/oblique variant is requested.</param>
        /// <param name="bold">Whether the bold variant is requested.</param>
        /// <param name="WFontName">Windows font family key, used for embedded and linked fonts.</param>
        /// <param name="FontStyle">Numeric style flags used for embedded and linked fonts.</param>
        /// <param name="PDFConformance">Active PDF conformance level.</param>
        /// <returns>The PDF font resource name suffix.</returns>
        public static string Type1FontTopdfFontName(PDFFontType Type1Font, bool oblique,
            bool bold, string WFontName, int FontStyle, PDFConformanceType PDFConformance)
        {
            int avalue;
            string searchname;
            string aresult;
            if ((Type1Font == PDFFontType.Linked) ||
                    (Type1Font == PDFFontType.Embedded) || PDFConformance == PDFConformanceType.PDF_A_3)
            {
                searchname = WFontName + FontStyle.ToString();
                aresult = searchname;
            }
            else
            {
                avalue = 0;
                switch (Type1Font)
                {
                    case PDFFontType.Helvetica:
                        avalue = 0;
                        break;
                    case PDFFontType.Courier:
                        avalue = 4;
                        break;
                    case PDFFontType.TimesRoman:
                        avalue = 8;
                        break;
                    case PDFFontType.Symbol:
                        avalue = 12;
                        break;
                    case PDFFontType.ZafDingbats:
                        avalue = 13;
                        break;
                }
                if ((Type1Font == PDFFontType.Helvetica) ||
                    (Type1Font == PDFFontType.Courier) ||
                    (Type1Font == PDFFontType.TimesRoman))
                {
                    if (bold)
                        avalue = avalue + 1;
                    if (oblique)
                        avalue = avalue + 2;
                }
                aresult = (avalue + 1).ToString();
            }
            return aresult;
        }

        /// <summary>
        /// Writes a single line of text at the given position, choosing plain or per-glyph (shaped) output
        /// and drawing underline/strikeout decorations as needed.
        /// </summary>
        /// <param name="X">Horizontal baseline start in resolution units.</param>
        /// <param name="Y">Vertical baseline position in resolution units.</param>
        /// <param name="Text">The text to render.</param>
        /// <param name="LineWidth">Width of the line, used to size element-level underline and strikeout.</param>
        /// <param name="Rotation">Rotation in tenths of a degree; zero for horizontal text.</param>
        /// <param name="RightToLeft">Whether the text is right-to-left, forcing shaped output.</param>
        /// <param name="lInfo">Measurement data for the line, including shaped glyphs when available.</param>
        /// <param name="isHtml">Whether the text carries per-glyph HTML styling.</param>
        public void TextOut(int X, int Y, string Text, int LineWidth,
         int Rotation, bool RightToLeft, LineInfo lInfo, bool isHtml = false)
        {
            double rotrad, fsize;
            string rotstring;
            int PosLine, PosLineX1, PosLineY1, PosLineX2, PosLineY2;
            string astring;
            TTFontData adata;
            //bool havekerning;
            int leading, linespacing;

            //bool havekerning = false;
            adata = GetTTFontData();
            if (adata != null)
            {
                //if (adata.HaveKerning)
                //    havekerning = true;
                linespacing = adata.Ascent - adata.Descent + adata.Leading;
                leading = adata.Leading;
            }
            else
            {
                GetStdLineSpacing(out linespacing, out leading);
            }
            leading = (int)Math.Round((((double)leading) / 100000.0) * FResolution * FFont.Size * 1.25);
            linespacing = (int)Math.Round((((double)linespacing) / 100000.0) * FResolution * FFont.Size * 1.25);
            Y = Y + leading;

            // Per-glyph (shaped) output: mandatory for RTL/HTML/FreeType, opt-in for plain
            // text through ForceComplexShaping so the PDF and the glyph-indexed GDI redraw
            // (ExtTextOutW) place every glyph at the same advance. The opt-in route requires
            // shaped glyph data in lInfo, which TextExtent provides when the flag is active.
            bool shapedOutput = RightToLeft || isHtml || this.InfoProvider.GetType().Name == "FontInfoFt"
                || (ForceComplexShaping && lInfo.Glyphs != null && lInfo.Glyphs.Count > 0);

            File.CheckPrinting();
            if (Rotation != 0)
            {
                SaveGraph();
            }
            try
            {
                WritePenColor(FFont.Color);
                WriteBrushColor(FFont.Color);

                SWriteLine(File.STempStream, "BT");
                SWriteLine(File.STempStream, "/F" +
                 Type1FontTopdfFontName(FFont.Name, FFont.Italic, FFont.Bold, FFont.GetFontFamilyKey(), FFont.Style, PDFConformance) + " " +
                    FFont.Size.ToString() + " Tf");
                if (shapedOutput)
                {
                    SWriteLine(File.STempStream, "/Span << /ActualText " +
                     PDFFile.EncodePDFText(isHtml && lInfo.Text != null ? lInfo.Text : Text) + " >> BDC");
                }
                // Rotates
                if (Rotation != 0)
                {
                    rotstring = "1 0 0 1 " +
                        UnitsToTextX(X) + " " +
                        UnitsToTextText(Y, FFont.Size);
                    SWriteLine(File.STempStream, rotstring + " cm");
                    rotrad = (double)Rotation / 10 * (2 * Math.PI / 360);
                    rotstring = NumberToText(Math.Cos(rotrad)) + " " +
                        NumberToText(Math.Sin(rotrad)) + " " +
                        NumberToText(-Math.Sin(rotrad)) + " " +
                        NumberToText(Math.Cos(rotrad)) + " 0 0";
                    SWriteLine(File.STempStream, rotstring + " cm");
                }
                else
                    SWriteLine(File.STempStream, UnitsToTextX(X) + " " + UnitsToTextText(Y, FFont.Size) + " Td");
                astring = Text;
                if (shapedOutput)
                {
                    astring = PDFCompatibleTextShaping(lInfo.Text, adata, Font, RightToLeft, X, Y, Font.Size, lInfo);
                    SWriteLine(File.STempStream, astring);
                }
                else
                {
                    SWriteLine(File.STempStream, PDFCompatibleText(astring, adata, FFont) + " Tj");
                }
                if (shapedOutput)
                {
                    SWriteLine(File.STempStream, "EMC");
                }
                SWriteLine(File.STempStream, "ET");
            }
            finally
            {
                if (Rotation != 0)
                {
                    RestoreGraph();
                }
            }
            // Underline and strikeout
            // Per-glyph decorators for HTML text (grouped segments)
            if (isHtml && lInfo.Glyphs != null && lInfo.Glyphs.Count > 0)
            {
                double decCursor = 0.0;
                bool inUnderline = false;
                bool inStrikeOut = false;
                double ulStartX = 0;
                double soStartX = 0;
                float ulFontSize = FFont.Size;
                float soFontSize = FFont.Size;
                // Per-glyph text is rendered via Tm at UnitsToTextY(Y), but the element-level
                // underline constants (CONS_UNDERLINEPOS=1.1) were calibrated for Td which uses
                // UnitsToTextText(Y,FSize) = UnitsToTextY(Y) - FSize. The text appears FSize higher,
                // so we need to subtract the font size offset from Y for correct positioning.
                int fontSizeOffset = (int)Math.Round((double)FFont.Size / PDFFile.CONS_PDFRES * FResolution);

                for (int i = 0; i <= lInfo.Glyphs.Count; i++)
                {
                    bool isLast = (i == lInfo.Glyphs.Count);
                    bool gUnderline = false;
                    bool gStrikeOut = false;
                    float gFontSize = FFont.Size;

                    if (!isLast)
                    {
                        TGlyphPos g = lInfo.Glyphs[i];
                        gUnderline = g.Underline;
                        gStrikeOut = g.StrikeOut;
                        gFontSize = g.HasFontSize ? g.FontSize : FFont.Size;
                    }

                    // Underline segment tracking
                    if (gUnderline && !inUnderline)
                    {
                        inUnderline = true;
                        ulStartX = X + decCursor;
                        ulFontSize = gFontSize;
                    }
                    else if ((!gUnderline || isLast) && inUnderline)
                    {
                        double ulEndX = X + decCursor;
                        if (gUnderline && isLast)
                            ulEndX = X + decCursor + lInfo.Glyphs[i - 1].XAdvance;
                        PenStyle = 0;
                        PenWidth = (int)Math.Round(((double)ulFontSize / PDFFile.CONS_PDFRES * FResolution) * PDFFile.CONS_UNDERLINEWIDTH);
                        PenColor = FFont.Color;
                        PosLine = (int)Math.Round(PDFFile.CONS_UNDERLINEPOS * ((double)ulFontSize / PDFFile.CONS_PDFRES * FResolution));
                        Line((int)ulStartX, Y - fontSizeOffset + PosLine, (int)ulEndX, Y - fontSizeOffset + PosLine);
                        inUnderline = gUnderline;
                        if (gUnderline)
                        {
                            ulStartX = X + decCursor;
                            ulFontSize = gFontSize;
                        }
                    }

                    // StrikeOut segment tracking
                    if (gStrikeOut && !inStrikeOut)
                    {
                        inStrikeOut = true;
                        soStartX = X + decCursor;
                        soFontSize = gFontSize;
                    }
                    else if ((!gStrikeOut || isLast) && inStrikeOut)
                    {
                        double soEndX = X + decCursor;
                        if (gStrikeOut && isLast)
                            soEndX = X + decCursor + lInfo.Glyphs[i - 1].XAdvance;
                        PenStyle = 0;
                        PenWidth = (int)Math.Round(((double)soFontSize / PDFFile.CONS_PDFRES * FResolution) * PDFFile.CONS_UNDERLINEWIDTH);
                        PenColor = FFont.Color;
                        PosLine = (int)Math.Round(PDFFile.CONS_STRIKEOUTPOS * ((double)soFontSize / PDFFile.CONS_PDFRES * FResolution));
                        Line((int)soStartX, Y - fontSizeOffset + PosLine, (int)soEndX, Y - fontSizeOffset + PosLine);
                        inStrikeOut = gStrikeOut;
                        if (gStrikeOut)
                        {
                            soStartX = X + decCursor;
                            soFontSize = gFontSize;
                        }
                    }

                    if (!isLast)
                        decCursor += lInfo.Glyphs[i].XAdvance;
                }
            }
            // Element-level underline (non-HTML or full-element underline)
            else if (FFont.Underline)
            {
                PenStyle = 0;
                PenWidth = (int)Math.Round(((double)FFont.Size / PDFFile.CONS_PDFRES * FResolution) * PDFFile.CONS_UNDERLINEWIDTH);
                PenColor = FFont.Color;
                if (Rotation == 0)
                {
                    PosLine = (int)Math.Round(PDFFile.CONS_UNDERLINEPOS * ((double)FFont.Size / PDFFile.CONS_PDFRES * FResolution));
                    int nliney = Y + PosLine;
                    // Shaped output positions text via Tm at UnitsToTextY(Y) while the underline
                    // constants were calibrated for Td (UnitsToTextY(Y) - FSize): compensate the
                    // font size offset, same correction the HTML decorators apply.
                    if (shapedOutput)
                        nliney = nliney - (int)Math.Round((double)FFont.Size / PDFFile.CONS_PDFRES * FResolution);
                    Line(X, nliney, X + LineWidth, nliney);
                }
                else
                {
                    Y = Y + (int)Math.Round(PDFFile.CONS_UNDERLINEPOS * ((double)FFont.Size / PDFFile.CONS_PDFRES * FResolution));
                    rotrad = (double)Rotation / 10 * (2 * Math.PI / 360);
                    fsize = (double)PDFFile.CONS_UNDERLINEPOS * FFont.Size / PDFFile.CONS_PDFRES * FResolution - (double)FFont.Size / PDFFile.CONS_PDFRES * FResolution;
                    PosLineX1 = (int)-Math.Round(fsize * Math.Cos(rotrad));
                    PosLineY1 = (int)-Math.Round(fsize * Math.Sin(rotrad));
                    PosLineX2 = (int)Math.Round(LineWidth * Math.Cos(rotrad));
                    PosLineY2 = (int)-Math.Round(LineWidth * Math.Sin(rotrad));
                    Line(X + PosLineX1, Y + PosLineY1, X + PosLineX2, Y + PosLineY2);
                    Y = Y - (int)Math.Round(PDFFile.CONS_UNDERLINEPOS * ((double)FFont.Size / PDFFile.CONS_PDFRES * FResolution));
                }
            }
            // Element-level strikeout (non-HTML or full-element strikeout)
            else if (FFont.StrikeOut)
            {
                PenStyle = 0;
                PenWidth = (int)Math.Round(((double)FFont.Size / PDFFile.CONS_PDFRES * FResolution) * PDFFile.CONS_UNDERLINEWIDTH);
                PenColor = FFont.Color;
                if (Rotation == 0)
                {
                    PosLine = (int)Math.Round(PDFFile.CONS_STRIKEOUTPOS * ((double)FFont.Size / PDFFile.CONS_PDFRES * FResolution));
                    int nliney = Y + PosLine;
                    // Same Tm/Td baseline compensation as the underline above.
                    if (shapedOutput)
                        nliney = nliney - (int)Math.Round((double)FFont.Size / PDFFile.CONS_PDFRES * FResolution);
                    Line(X, nliney, X + LineWidth, nliney);
                }
                else
                {
                    Y = Y + (int)Math.Round(PDFFile.CONS_UNDERLINEPOS * ((double)FFont.Size / PDFFile.CONS_PDFRES * FResolution));
                    rotrad = (double)Rotation / 10 * (2 * Math.PI / 360);
                    fsize = PDFFile.CONS_UNDERLINEPOS * (double)FFont.Size / PDFFile.CONS_PDFRES * FResolution - (double)FFont.Size / PDFFile.CONS_PDFRES * FResolution;
                    PosLineX1 = -(int)Math.Round(fsize * Math.Cos(rotrad));
                    PosLineY1 = (int)-Math.Round(fsize * Math.Sin(rotrad));
                    PosLineX2 = (int)Math.Round(LineWidth * Math.Cos(rotrad));
                    PosLineY2 = (int)-Math.Round(LineWidth * Math.Sin(rotrad));
                    fsize = (1 - PDFFile.CONS_STRIKEOUTPOS) * (double)FFont.Size / PDFFile.CONS_PDFRES * FResolution;
                    PosLineX1 = X + PosLineX1;
                    PosLineY1 = Y + PosLineY1;
                    PosLineX2 = X + PosLineX2;
                    PosLineY2 = Y + PosLineY2;
                    PosLineX1 = PosLineX1 - (int)Math.Round(fsize * Math.Sin(rotrad));
                    PosLineY1 = PosLineY1 - (int)Math.Round(fsize * Math.Cos(rotrad));
                    PosLineX2 = PosLineX2 - (int)Math.Round(fsize * Math.Sin(rotrad));
                    PosLineY2 = PosLineY2 - (int)Math.Round(fsize * Math.Cos(rotrad));
                    Line(PosLineX1, PosLineY1, PosLineX2, PosLineY2);
                }
            }
        }
        /// <summary>
        /// Returns the four-digit hexadecimal code of a character.
        /// </summary>
        /// <param name="achar">The character to encode.</param>
        /// <returns>The character code as a four-digit uppercase hexadecimal string.</returns>
        public static string WideCharToHex(char achar)
        {
            return IntToHex((int)achar); ;
        }
        /// <summary>
        /// Formats an integer as a four-digit, zero-padded uppercase hexadecimal string.
        /// </summary>
        /// <param name="nvalue">The value to format.</param>
        /// <returns>The value as a four-digit uppercase hexadecimal string.</returns>
        public static string IntToHex(int nvalue)
        {
            StringBuilder nresult = new(nvalue.ToString("X"));
            while (nresult.Length < 4)
                nresult.Insert(0, "0");
            return nresult.ToString();
        }
        /// <summary>
        /// Builds a PDF TJ text array for the string, inserting kerning adjustments between glyphs and
        /// producing either hexadecimal glyph codes (Unicode fonts) or escaped literal text.
        /// </summary>
        /// <param name="astring">The text to encode.</param>
        /// <param name="adata">Font data providing glyph indices and Unicode flag.</param>
        /// <param name="pdffont">The PDF font being used.</param>
        /// <returns>The PDF text array operand including kerning values.</returns>
        public string PDFCompatibleTextWithKerning(string astring, TTFontData adata, PDFFont pdffont)
        {
            int i;
            int kerningvalue;
            string aresult;

            if (astring.Length < 1)
                return "[]";
            if (adata.IsUnicode)
            {
                aresult = "[<";
                for (i = 0; i < astring.Length; i++)
                {
                    aresult = aresult + IntToHex(adata.CacheWidths[astring[i]].Glyph);
                    if (i < (astring.Length - 1))
                    {
                        kerningvalue = InfoProvider.GetKerning(FFont, adata, astring[i], astring[i + 1]);
                        if (kerningvalue != 0)
                        {
                            aresult = aresult + "> " + kerningvalue.ToString() + " <";
                        }
                    }
                }
                aresult = aresult + ">]";
            }
            else
            {
                aresult = "[(";
                for (i = 0; i < astring.Length; i++)
                {
                    switch (astring[i])
                    {
                        case '(':
                        case ')':
                        case '\\':
                            aresult = aresult + "\\" + astring[i];
                            break;
                        default:
                            // Euro symbol exception
                            if (astring[i] == (char)8364)
                                aresult = aresult + (char)128;
                            else
                                aresult = aresult + astring[i];
                            break;
                    }
                    if (i < (astring.Length - 1))
                    {
                        kerningvalue = InfoProvider.GetKerning(FFont, adata, astring[i], astring[i + 1]);
                        if (kerningvalue != 0)
                        {
                            aresult = aresult + ") " + kerningvalue.ToString() + " (";
                        }
                    }
                }
                aresult = aresult + ")";
            }
            return aresult;
        }
        /// <summary>
        /// Emits per-glyph PDF text operators from shaped glyph data, positioning each glyph with its own
        /// text matrix and switching font and color as inline styling changes, then restoring the original font.
        /// </summary>
        /// <param name="astring">The source text (used for context; glyphs drive the actual output).</param>
        /// <param name="adata">Font data for the current font.</param>
        /// <param name="pdffont">The PDF font being used.</param>
        /// <param name="RightToLeft">Whether the text is right-to-left.</param>
        /// <param name="posX">Baseline X origin in resolution units.</param>
        /// <param name="posY">Baseline Y origin in resolution units.</param>
        /// <param name="FontSize">Base font size in points.</param>
        /// <param name="lInfo">Line measurement data containing the shaped glyphs to emit.</param>
        /// <returns>The PDF content-stream fragment that draws the shaped glyphs.</returns>
        public string PDFCompatibleTextShaping(
            string astring,
            TTFontData adata,
            PDFFont pdffont,
            bool RightToLeft,
            double posX,
            double posY,
            int FontSize,
            LineInfo lInfo)
        {
            string eol = EOL();
            string result = string.Empty;
            double cursor = 0.0;

            string actualFontFamily = Font.GetFontFamily();
            string originalFontFamily = Font.GetFontFamily();
            bool actualBold = Font.Bold;
            bool originalBold = Font.Bold;
            bool actualItalic = Font.Italic;
            bool originalItalic = Font.Italic;
            float actualFontSize = FontSize;
            float originalFontSize = FontSize;
            int actualColor = Font.Color;
            int originalColor = Font.Color;

            for (int i = 0; i < lInfo.Glyphs.Count; i++)
            {
                TGlyphPos g = lInfo.Glyphs[i];

                // Glyph ID en hexadecimal
                string gidHex = IntToHex(g.GlyphIndex);

                string newFontFamily = string.IsNullOrEmpty(g.FontFamily) ? originalFontFamily : g.FontFamily;
                bool newBold = g.Bold;
                bool newItalic = g.Italic;
                float newFontSize = g.HasFontSize ? g.FontSize : originalFontSize;

                if (actualFontFamily != newFontFamily || actualBold != newBold || actualItalic != newItalic || actualFontSize != newFontSize)
                {
                    Font.WFontName = newFontFamily;
                    Font.LFontName = newFontFamily;
                    Font.Bold = newBold;
                    Font.Italic = newItalic;
                    Font.Style = (newBold ? 1 : 0) + (newItalic ? 2 : 0) + (Font.Underline ? 4 : 0) + (Font.StrikeOut ? 8 : 0);
                    Font.Size = (int)newFontSize;

                    UpdateFonts();
                    adata = GetTTFontData();

                    result += "/F" +
                        Type1FontTopdfFontName(Font.Name, Font.Italic, Font.Bold, Font.GetFontFamilyKey(), Font.Style, File.PDFConformance) + " " +
                        Font.Size.ToString(System.Globalization.CultureInfo.InvariantCulture) + " Tf" + eol;

                    actualFontFamily = newFontFamily;
                    actualBold = newBold;
                    actualItalic = newItalic;
                    actualFontSize = newFontSize;
                }

                // Color change via rg operator (valid inside BT/ET)
                int newColor = g.HasColor ? g.Color : originalColor;
                if (newColor != actualColor)
                {
                    result += RGBToFloats(newColor) + " rg" + eol;
                    actualColor = newColor;
                }

                // Llamadas auxiliares para compatibilidad
                InfoProvider.GetCharWidth(pdffont, adata, g.CharCode);
                InfoProvider.GetGlyphWidth(pdffont, adata, g.GlyphIndex, g.CharCode);

                // Calcular posiciones PDF
                double absY = posY - g.YOffset;
                double absX = posX + cursor + g.XOffset;

                // Emitir instrucción PDF: Tm + Tj
                result += string.Format(
                    System.Globalization.CultureInfo.InvariantCulture,
                    "1 0 0 1 {0} {1} Tm <{2}> Tj" + eol,
                    UnitsToTextX(absX),
                    UnitsToTextY(absY),
                    gidHex
                );

                // Avanzar cursor
                cursor += g.XAdvance;
            }

            // Restaurar font original si se cambió
            if (actualFontFamily != originalFontFamily || actualBold != originalBold || actualItalic != originalItalic || actualFontSize != originalFontSize)
            {
                Font.WFontName = originalFontFamily;
                Font.LFontName = originalFontFamily;
                Font.Bold = originalBold;
                Font.Italic = originalItalic;
                Font.Style = (originalBold ? 1 : 0) + (originalItalic ? 2 : 0) + (Font.Underline ? 4 : 0) + (Font.StrikeOut ? 8 : 0);
                Font.Size = (int)originalFontSize;
                UpdateFonts();
                adata = GetTTFontData();
            }
            // Restore original color if changed
            if (actualColor != originalColor)
            {
                result += RGBToFloats(originalColor) + " rg" + eol;
            }

            return result;
        }
        /// <summary>
        /// Encodes a string as a PDF text operand: a hexadecimal glyph string for Unicode fonts, or an
        /// escaped literal string for single-byte fonts.
        /// </summary>
        /// <param name="astring">The text to encode.</param>
        /// <param name="adata">Font data providing glyph indices and the Unicode flag; may be null.</param>
        /// <param name="pdffont">The PDF font being used.</param>
        /// <returns>The PDF text operand for the string.</returns>
        public static string PDFCompatibleText(string astring, TTFontData adata, PDFFont pdffont)
        {
            int i;
            bool isunicode = false;
            string aresult;

            if (adata != null)
                isunicode = adata.IsUnicode;
            if (isunicode)
            {
                aresult = "<";
                for (i = 0; i < astring.Length; i++)
                {
                    char key = astring[i];
                    if (adata.CacheWidths.IndexOfKey(key) >= 0)
                        aresult = aresult + IntToHex(adata.CacheWidths[astring[i]].Glyph);
                }
                aresult = aresult + ">";
            }
            else
            {
                aresult = "(";
                for (i = 0; i < astring.Length; i++)
                {
                    switch (astring[i])
                    {
                        case '(':
                        case ')':
                        case '\\':
                            aresult = aresult + "\\" + astring[i];
                            break;
                        default:
                            // Euro symbol exception
                            if (astring[i] == (char)8364)
                                aresult = aresult + (char)128;
                            else
                                aresult = aresult + astring[i];
                            break;
                    }
                }
                aresult = aresult + ")";
            }
            return aresult;
        }
        void GetStdLineSpacing(out int linespacing, out int leading)
        {
            switch (FFont.Name)
            {
                case PDFFontType.Helvetica:
                    linespacing = 1270;
                    leading = 150;
                    break;
                case PDFFontType.Courier:
                    linespacing = 1265;
                    leading = 133;
                    break;
                case PDFFontType.TimesRoman:
                    linespacing = 1257;
                    leading = 150;
                    break;
                case PDFFontType.Symbol:
                    linespacing = 1450;
                    leading = 255;
                    break;
                case PDFFontType.ZafDingbats:
                    linespacing = 1200;
                    leading = 150;
                    break;
                default:
                    linespacing = 1270;
                    leading = 200;
                    break;
            }
        }
        bool IsSeparator(char c)
        {
            return ((c == (char)10) || (c == (char)13) || (c == ' '));
        }
        bool IsSpecial(char c)
        {
            return ((c == (char)10) || (c == (char)13) || (c == (char)0));
        }
        bool IsSeparatorSign(char c)
        {
            return ((c == '-') || (c == ' '));
        }
        const int Default_Font_Width = 600;
        static int[] Helvetica_Widths = new int[] {
                                                                                                     278,278,355,556,556,889,667,191,333,333,389,584,278,333,
                                                                                                     278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,
                                                                                                     584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,
                                                                                                     722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,
                                                                                                     469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,
                                                                                                     556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,
                                                                                                     584,0,556,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,
                                                                                                     611,0,0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,
                                                                                                     500,667,0,333,556,556,556,556,260,556,333,737,370,556,584,0,
                                                                                                     737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,
                                                                                                     834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,
                                                                                                     278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,
                                                                                                     667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,
                                                                                                     278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,
                                                                                                     556,500};

        static int[] Helvetica_Bold_Widths = new int[] {
                                                                                                                278,333,474,556,556,889,722,238,333,333,389,584,278,333,
                                                                                                                278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,
                                                                                                                584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,
                                                                                                                722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,
                                                                                                                584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,
                                                                                                                611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,
                                                                                                                584,0,556,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,
                                                                                                                611,0,0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,
                                                                                                                500,667,0,333,556,556,556,556,280,556,333,737,370,556,584,0,
                                                                                                                737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,
                                                                                                                834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,
                                                                                                                278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,
                                                                                                                667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,
                                                                                                                278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,
                                                                                                                611,556};
        static int[] Helvetica_Italic_Widths = new int[] {
                                                                                                                    278,278,355,556,556,889,667,191,333,333,389,584,278,333,
                                                                                                                    278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,
                                                                                                                    584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,
                                                                                                                    722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,
                                                                                                                    469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,
                                                                                                                    556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,
                                                                                                                    584,0,556,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,
                                                                                                                    611,0,0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,
                                                                                                                    500,667,0,333,556,556,556,556,260,556,333,737,370,556,584,0,
                                                                                                                    737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,
                                                                                                                    834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,
                                                                                                                    278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,
                                                                                                                    667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,
                                                                                                                    278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,
                                                                                                                    556,500};

        static int[] Helvetica_BoldItalic_Widths = new int[] {
                                                                                                                             278,333,474,556,556,889,722,238,333,333,389,584,278,333,
                                                                                                                             278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,
                                                                                                                             584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,
                                                                                                                             722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,
                                                                                                                             584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,
                                                                                                                             611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,
                                                                                                                             584,0,556,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,
                                                                                                                             611,0,0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,
                                                                                                                             500,667,0,333,556,556,556,556,280,556,333,737,370,556,584,0,
                                                                                                                             737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,
                                                                                                                             834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,
                                                                                                                             278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,
                                                                                                                             667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,
                                                                                                                             278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,
                                                                                                                             611,556};

        static int[] Times_Roman_Widths = new int[] {
                                                                                                         250,333,408,500,500,833,778,180,333,333,500,564,250,333,
                                                                                                         250,278,500,500,500,500,500,500,500,500,500,500,278,278,564,564,
                                                                                                         564,444,921,722,667,667,722,611,556,722,722,333,389,722,611,889,
                                                                                                         722,722,556,722,667,556,611,722,722,944,722,722,611,333,278,333,
                                                                                                         469,500,333,444,500,444,500,444,333,500,500,278,278,500,278,778,
                                                                                                         500,500,500,500,333,389,278,500,500,722,500,500,444,480,200,480,
                                                                                                         541,0,500,0,333,500,444,1000,500,500,333,1000,556,333,889,0,
                                                                                                         611,0,0,333,333,444,444,350,500,1000,333,980,389,333,722,0,
                                                                                                         444,722,0,333,500,500,500,500,200,500,333,760,276,500,564,0,
                                                                                                         760,333,400,564,300,300,333,500,453,250,333,300,310,500,750,750,
                                                                                                         750,444,722,722,722,722,722,722,889,667,611,611,611,611,333,333,
                                                                                                         333,333,722,722,722,722,722,722,722,564,722,722,722,722,722,722,
                                                                                                         556,500,444,444,444,444,444,444,667,444,444,444,444,444,278,278,
                                                                                                         278,278,500,500,500,500,500,500,500,564,500,500,500,500,500,500,
                                                                                                         500,500};
        static int[] Times_Roman_Italic_Widths = new int[] {
                                                                                                                    250,333,420,500,500,833,778,214,333,333,500,675,250,333,
                                                                                                                    250,278,500,500,500,500,500,500,500,500,500,500,333,333,675,675,
                                                                                                                    675,500,920,611,611,667,722,611,611,722,722,333,444,667,556,833,
                                                                                                                    667,722,611,722,611,500,556,722,611,833,611,556,556,389,278,389,
                                                                                                                    422,500,333,500,500,444,500,444,278,500,500,278,278,444,278,722,
                                                                                                                    500,500,500,500,389,389,278,500,444,667,444,444,389,400,275,400,
                                                                                                                    541,0,500,0,333,500,556,889,500,500,333,1000,500,333,944,0,
                                                                                                                    556,0,0,333,333,556,556,350,500,889,333,980,389,333,667,0,
                                                                                                                    389,556,0,389,500,500,500,500,275,500,333,760,276,500,675,0,
                                                                                                                    760,333,400,675,300,300,333,500,523,250,333,300,310,500,750,750,
                                                                                                                    750,500,611,611,611,611,611,611,889,667,611,611,611,611,333,333,
                                                                                                                    333,333,722,667,722,722,722,722,722,675,722,722,722,722,722,556,
                                                                                                                    611,500,500,500,500,500,500,500,667,444,444,444,444,444,278,278,
                                                                                                                    278,278,500,500,500,500,500,500,500,675,500,500,500,500,500,444,
                                                                                                                    500,444};
        static int[] Times_Roman_Bold_Widths = new int[] {
                                                                                                                    250,333,555,500,500,1000,833,278,333,333,500,570,250,333,
                                                                                                                    250,278,500,500,500,500,500,500,500,500,500,500,333,333,570,570,
                                                                                                                    570,500,930,722,667,722,722,667,611,778,778,389,500,778,667,944,
                                                                                                                    722,778,611,778,722,556,667,722,722,1000,722,722,667,333,278,333,
                                                                                                                    581,500,333,500,556,444,556,444,333,500,556,278,333,556,278,833,
                                                                                                                    556,500,556,556,444,389,333,556,500,722,500,500,444,394,220,394,
                                                                                                                    520,0,500,0,333,500,500,1000,500,500,333,1000,556,333,1000,0,
                                                                                                                    667,0,0,333,333,500,500,350,500,1000,333,1000,389,333,722,0,
                                                                                                                    444,722,0,333,500,500,500,500,220,500,333,747,300,500,570,0,
                                                                                                                    747,333,400,570,300,300,333,556,540,250,333,300,330,500,750,750,
                                                                                                                    750,500,722,722,722,722,722,722,1000,722,667,667,667,667,389,389,
                                                                                                                    389,389,722,722,778,778,778,778,778,570,778,722,722,722,722,722,
                                                                                                                    611,556,500,500,500,500,500,500,722,444,444,444,444,444,278,278,
                                                                                                                    278,278,500,556,500,500,500,500,500,570,500,556,556,556,556,500,
                                                                                                                    556,500};
        static int[] Times_Roman_BoldItalic_Widths = new int[] {
                                                                                                                                250,389,555,500,500,833,778,278,333,333,500,570,250,333,
                                                                                                                                250,278,500,500,500,500,500,500,500,500,500,500,333,333,570,570,
                                                                                                                                570,500,832,667,667,667,722,667,667,722,778,389,500,667,611,889,
                                                                                                                                722,722,611,722,667,556,611,722,667,889,667,611,611,333,278,333,
                                                                                                                                570,500,333,500,500,444,500,444,333,500,556,278,278,500,278,778,
                                                                                                                                556,500,500,500,389,389,278,556,444,667,500,444,389,348,220,348,
                                                                                                                                570,0,500,0,333,500,500,1000,500,500,333,1000,556,333,944,0,
                                                                                                                                611,0,0,333,333,500,500,350,500,1000,333,1000,389,333,722,0,
                                                                                                                                389,611,0,389,500,500,500,500,220,500,333,747,266,500,606,0,
                                                                                                                                747,333,400,570,300,300,333,576,500,250,333,300,300,500,750,750,
                                                                                                                                750,500,667,667,667,667,667,667,944,667,667,667,667,667,389,389,
                                                                                                                                389,389,722,722,722,722,722,722,722,570,722,722,722,722,722,611,
                                                                                                                                611,500,500,500,500,500,500,500,722,444,444,444,444,444,278,278,
                                                                                                                                278,278,500,556,500,500,500,500,500,570,500,556,556,556,556,444,
                                                                                                                                500,444};

        double CalcCharWidth(char charcode, TTFontData fontdata)
        {
            byte intvalue;
            int defaultwidth;
            int[] aarray;
            aarray = null;
            defaultwidth = Default_Font_Width;
            bool isdefault = true;
            if (IsSpecial(charcode))
            {
                return 0.0;
            }
            if (FFont.Name == PDFFontType.Linked || FFont.Name == PDFFontType.Embedded || PDFConformance == PDFConformanceType.PDF_A_3)
            {
                // Ask for font size
                double x = InfoProvider.GetCharWidth(Font, fontdata, charcode);
                return (x * FFont.Size / 1000);
            }
            switch (FFont.Name)
            {
                case PDFFontType.Helvetica:
                    isdefault = false;
                    aarray = Helvetica_Widths;
                    if (FFont.Bold)
                    {
                        if (FFont.Italic)
                            aarray = Helvetica_BoldItalic_Widths;
                        else
                            aarray = Helvetica_Bold_Widths;
                    }
                    else
                    {
                        if (FFont.Italic)
                            aarray = Helvetica_Italic_Widths;
                        else
                            aarray = Helvetica_Widths;
                    }
                    break;
                case PDFFontType.TimesRoman:
                    isdefault = false;
                    aarray = Times_Roman_Widths;
                    if (FFont.Bold)
                    {
                        if (FFont.Italic)
                            aarray = Times_Roman_BoldItalic_Widths;
                        else
                            aarray = Times_Roman_Bold_Widths;
                    }
                    else
                    {
                        if (FFont.Italic)
                            aarray = Times_Roman_Italic_Widths;
                        else
                            aarray = Times_Roman_Widths;
                    }
                    break;
            }
            intvalue = (byte)charcode;
            if (isdefault || (intvalue < 32))
                return defaultwidth * FFont.Size / 1000;
            double aresult = aarray[intvalue - 32];
            aresult = aresult * FFont.Size / 1000;
            return aresult;
        }
        const int AlignmentFlags_SingleLine = 64;
        const int AlignmentFlags_AlignHCenter = 4;
        const int AlignmentFlags_AlignHJustify = 1024;
        const int AlignmentFlags_AlignTop = 8;
        const int AlignmentFlags_AlignBottom = 16;
        const int AlignmentFlags_AlignVCenter = 32;
        const int AlignmentFlags_AlignLeft = 1;
        const int AlignmentFlags_AlignRight = 2;
        /// <summary>
        /// Applies a translation to the coordinate system (cm operator) and switches Y conversion to translated mode.
        /// </summary>
        /// <param name="X">Horizontal translation in resolution units.</param>
        /// <param name="Y">Vertical translation in resolution units.</param>
        public void Translate(int X, int Y)
        {
            string transstring = "1 0 0 1 " +
                UnitsToTextX(X) + " " +
                UnitsToTextY(Y);
            translatedy = true;

            SWriteLine(File.STempStream, transstring + " cm");
        }
        /// <summary>
        /// Applies a rotation to the coordinate system (cm operator).
        /// </summary>
        /// <param name="radiants">Rotation angle in radians.</param>
        public void Rotate(double radiants)
        {
            string rotstring = NumberToText(Math.Cos(radiants)) + " " +
                NumberToText(Math.Sin(radiants)) + " " +
                NumberToText(-Math.Sin(radiants)) + " " +
                NumberToText(Math.Cos(radiants)) + " 0 0";
            SWriteLine(File.STempStream, rotstring + " cm");
        }
        /// <summary>
        /// Lays out and draws text within a rectangle, handling word wrap, horizontal and vertical alignment,
        /// justification, optional clipping, rotation, right-to-left, and HTML styling.
        /// </summary>
        /// <param name="arect">Bounding rectangle in resolution units.</param>
        /// <param name="Text">The text to draw.</param>
        /// <param name="Alignment">Bit flags controlling single-line, horizontal and vertical alignment, and justification.</param>
        /// <param name="Clipping">Whether output is clipped to the rectangle.</param>
        /// <param name="wordbreak">Whether text wraps on word boundaries.</param>
        /// <param name="Rotation">Rotation in tenths of a degree; zero for horizontal text.</param>
        /// <param name="RightToLeft">Whether the text is right-to-left.</param>
        /// <param name="isHtml">Whether the text carries per-glyph HTML styling.</param>
        public void TextRect(Rectangle arect, string Text, int Alignment, bool Clipping,
            bool wordbreak, int Rotation, bool RightToLeft, bool isHtml = false)
        {
            // Replace cr/lf for only cfs
            //Text = Text.Replace("" + (char)13 + (char)10, "" + (char)10);
            // Kill tabs replace with spaces
            Text = Text.Replace("\t", " ");
            // Remove chars and tabs
            Rectangle recsize;
            int i, index;
            int posx, posy;
            double currpos, alinedif;
            bool singleline;
            string astring;
            int alinesize;
            Strings lwords;
            Integers lwidths;
            Rectangle arec;
            string aword;
            bool isunicode = false;
            if (RightToLeft)
            {
                Font.Name = PDFFontType.Embedded;
                Text = Reportman.Drawing.StringUtil.NormalizeToNFC(Text);
            }
            TTFontData adata = GetTTFontData();
            if (!(adata == null))
            {
                isunicode = adata.IsUnicode;
            }

            if (!isunicode)
                Text = UnicodeToWin1252(Text);

            File.CheckPrinting();

            // Rotated text keeps the legacy pipeline on both PDF and GDI (the GDI exact-metrics
            // path excludes rotation), so forced shaping is suspended here to keep both outputs
            // aligned. RTL/HTML rotated text is unaffected: it shapes regardless of this flag.
            bool suspendedForceShaping = false;
            if ((Rotation != 0) && ForceComplexShaping)
            {
                ForceComplexShaping = false;
                suspendedForceShaping = true;
            }

            if (Clipping || (Rotation != 0))
            {
                SaveGraph();
            }
            try
            {
                if (Clipping)
                {
                    // Clipping rectangle
                    SWriteLine(File.STempStream, UnitsToTextX(arect.Left) + " " + UnitsToTextY(arect.Top) +
                        " " + UnitsToTextX(arect.Width) + " " + UnitsToTextX(-(arect.Height)) + " re");
                    SWriteLine(File.STempStream, "h"); // ClosePath
                    SWriteLine(File.STempStream, "W"); // Clip
                    SWriteLine(File.STempStream, "n"); // NewPath
                }
                if (Rotation != 0)
                {
                    int X = arect.Left;
                    int Y = arect.Top;
                    Translate(X, Y);
                    double rotrad = (double)Rotation / 10 * (2 * Math.PI / 360);
                    Rotate(rotrad);
                    arect = new Rectangle(0, 0, arect.Width, arect.Height);
                }
                singleline = (Alignment & AlignmentFlags_SingleLine) > 0;
                if (singleline)
                    wordbreak = false;
                // Calculates text extent and apply alignment
                recsize = arect;
                var linfo = TextExtent(Text, ref recsize, wordbreak, singleline, true, RightToLeft, isHtml);
                // Align bottom or center
                posy = arect.Top;
                if ((Alignment & AlignmentFlags_AlignBottom) > 0)
                {
                    posy = arect.Top + arect.Height - recsize.Height;
                }
                if ((Alignment & AlignmentFlags_AlignVCenter) > 0)
                {
                    posy = arect.Top + (int)((arect.Height - recsize.Height) / 2);
                }
                var Lines = linfo;
                for (i = 0; i < Lines.Count; i++)
                {
                    posx = arect.Left;
                    // Aligns horz.
                    if ((Alignment & AlignmentFlags_AlignRight) > 0)
                    {
                        // recsize.right contains the width of the full text
                        posx = arect.Left + arect.Width - Lines[i].Width;
                    }
                    // Aligns horz.
                    if ((Alignment & AlignmentFlags_AlignHCenter) > 0)
                    {
                        posx = arect.Left + (int)(((arect.Width) - Lines[i].Width) / 2);
                    }
                    astring = Text.Substring(Lines[i].Position, Lines[i].Size);
                    bool dojustify = ((Alignment & AlignmentFlags_AlignHJustify) > 0) && (!Lines[i].LastLine) && !isHtml;
                    if (dojustify)
                    {
                        // Calculate the sizes of the words, then
                        // share space between words
                        lwords = new Strings();
                        aword = "";
                        index = 0;
                        while (index < astring.Length)
                        {
                            if (astring[index] != ' ')
                            {
                                aword = aword + astring[index];
                            }
                            else
                            {
                                if (aword.Length > 0)
                                {
                                    lwords.Add(aword);
                                }
                                aword = "";
                            }
                            index++;
                        }
                        if (aword.Length > 0)
                        {
                            lwords.Add(aword);
                        }
                        // Calculate all words size
                        alinesize = 0;
                        lwidths = new Integers();
                        // Keep each word's own shaped LineInfo: when TextOut emits per-glyph
                        // output it must receive the glyphs of the word being drawn, not the
                        // glyphs of the whole line.
                        List<LineInfo> lwordinfos = new();
                        for (index = 0; index < lwords.Count; index++)
                        {
                            arec = arect;
                            var winfos = TextExtent(lwords[index], ref arec, false, true, false, RightToLeft, isHtml);
                            if (winfos.Count > 0)
                                lwordinfos.Add(winfos[0]);
                            else
                                lwordinfos.Add(Lines[i]);
                            int nwidth;
                            if (RightToLeft)
                                nwidth = -(arec.Width);
                            else
                                nwidth = arec.Width;
                            lwidths.Add(nwidth);
                            alinesize = alinesize + nwidth;
                        }
                        alinedif = arect.Width - alinesize;
                        if (alinedif > 0)
                        {
                            if (lwords.Count > 1)
                                alinedif = alinedif / (lwords.Count - 1);
                            if (RightToLeft)
                            {
                                currpos = arect.Width;
                                alinedif = -alinedif;
                            }
                            else
                                currpos = posx;
                            if ((!Font.Transparent) && (lwords.Count > 0))
                            {
                                int PreviousBrushColor = BrushColor;
                                int PreviousBrushStyle = BrushStyle;
                                int PreviousPenStyle = PenStyle;
                                int PreviousPenColor = PenColor;
                                BrushColor = Font.BackColor;
                                PenColor = Font.BackColor;
                                PenStyle = 5;
                                BrushStyle = 0;
                                Rectangle(Convert.ToInt32(currpos), posy + Lines[i].TopPos, Convert.ToInt32(currpos) + Lines[i].Width, posy + Lines[i].TopPos + Lines[i].Height);
                                PenColor = PreviousPenColor;
                                PenStyle = PreviousPenStyle;
                                BrushColor = PreviousBrushColor;
                                BrushStyle = PreviousBrushStyle;
                            }
                            for (index = 0; index < lwords.Count; index++)
                            {
                                TextOut(Convert.ToInt32(currpos), posy + Lines[i].TopPos, lwords[index], Lines[i].Width, 0, RightToLeft, lwordinfos[index], isHtml);
                                currpos = currpos + lwidths[index] + alinedif;
                            }
                        }
                        else
                        {
                            // No space to share (overflowing line): fall back to drawing the
                            // line unjustified instead of dropping it, matching the GDI driver.
                            dojustify = false;
                        }
                    }
                    if (!dojustify)
                    {
                        if (!Font.Transparent)
                        {
                            int PreviousBrushColor = BrushColor;
                            int PreviousBrushStyle = BrushStyle;
                            int PreviousPenStyle = PenStyle;
                            int PreviousPenColor = PenColor;
                            BrushColor = Font.BackColor;
                            PenColor = Font.BackColor;
                            PenStyle = 5;
                            BrushStyle = 0;
                            Rectangle(posx, posy + Lines[i].TopPos, posx + Lines[i].Width, posy + Lines[i].TopPos + Lines[i].Height);
                            PenColor = PreviousPenColor;
                            PenStyle = PreviousPenStyle;
                            BrushColor = PreviousBrushColor;
                            BrushStyle = PreviousBrushStyle;
                        }

                        TextOut(posx, posy + Lines[i].TopPos, astring, Lines[i].Width, 0, RightToLeft, Lines[i], isHtml);
                    }
                }
            }
            finally
            {
                if (Clipping || (Rotation != 0))
                {
                    RestoreGraph();
                }
                if (suspendedForceShaping)
                {
                    ForceComplexShaping = true;
                }
            }
        }
        /// <summary>
        /// Draws an image inside a rectangle, decoding JPEG/bitmap/GIF sources, optionally tiling and clipping,
        /// and registering the image (and any soft mask) as a reusable PDF XObject.
        /// </summary>
        /// <param name="rec">Destination rectangle in resolution units.</param>
        /// <param name="abitmap">Source image stream.</param>
        /// <param name="dpires">Source image resolution in DPI, or zero to stretch to the rectangle.</param>
        /// <param name="tile">Whether the image is tiled to fill the rectangle.</param>
        /// <param name="clip">Whether output is clipped to the rectangle.</param>
        /// <param name="internal_imageindex">Caller-supplied key used to reuse an already-embedded image, or negative for a new image.</param>
        public void DrawImage(Rectangle rec, MemoryStream abitmap, int dpires,
            bool tile, bool clip, long internal_imageindex)
        {
            MemoryStream astream;
            int imagesize;
            int bitmapwidth, bitmapheight;
            MemoryStream fimagestream;

            int aheight, awidth;
            Rectangle arect;
            bool isjpeg;
            bool indexed = false;
            int bitsperpixel = 8;
            int imageindex;
            int numcolors = 0;
            string palette = "";
            string mask = "";
            bool newstream = true;
            MemoryStream imageMaskStream;
            arect = rec;
            File.CheckPrinting();
            if (File.CalculateOnly)
            {
                fimagestream = null;
                imageMaskStream = null;
            }
            else
            {
                fimagestream = new MemoryStream();
                imageMaskStream = new MemoryStream();
            }
            try
            {
                abitmap.Seek(0, System.IO.SeekOrigin.Begin);
                bool isgif = false;
                isjpeg = BitmapUtil.GetJPegInfo(abitmap, out bitmapwidth, out bitmapheight);
                if (isjpeg)
                {
                    // Read image dimensions
                    //				fimagestream.SetSize(abitmap.size);
                    if (!File.CalculateOnly)
                    {
                        abitmap.Seek(0, System.IO.SeekOrigin.Begin);
                        abitmap.WriteTo(fimagestream);
                        fimagestream.Seek(0, System.IO.SeekOrigin.Begin);
                        imagesize = (int)fimagestream.Length;
                    }
                    else
                        imagesize = 0;
                }
                else
                {
                    bool isBitmap = BitmapUtil.GetBitmapInfo(abitmap, out bitmapwidth, out bitmapheight,
                        out imagesize, fimagestream, out indexed, out bitsperpixel, out numcolors, out palette, out isgif, out mask, imageMaskStream);
                    if ((isgif) || (!isBitmap))
                    {
                        // Png /gif etc not supported so trye save image as Bitmap
                        try
                        {
                            abitmap.Seek(0, SeekOrigin.Begin);
                            var newimage = BitmapInfoProvider.EncodeImageStreamAsBitmapStream(abitmap);
                            if (imageMaskStream != null)
                            {
                                imageMaskStream = new MemoryStream();
                            }
                            newimage.Seek(0, SeekOrigin.Begin);
                            BitmapUtil.GetBitmapInfo(newimage, out bitmapwidth, out bitmapheight,
                                out imagesize, fimagestream, out indexed, out bitsperpixel, out numcolors, out palette, out isgif, out mask, imageMaskStream);
                            abitmap.Seek(0, SeekOrigin.Begin);
                            fimagestream.Seek(0, SeekOrigin.Begin);
                        }
                        catch
                        {

                        }
                    }
                }
                if (imageMaskStream != null)
                {
                    if (imageMaskStream.Length == 0)
                    {
                        imageMaskStream.Dispose();
                        imageMaskStream = null;
                    }
                }
                if (dpires != 0)
                {
                    var arec = new Rectangle(rec.Left, rec.Top, rec.Width, rec.Height);
                    rec = new Rectangle(rec.Left, rec.Top,
                        (int)Math.Round((double)bitmapwidth / dpires * FResolution),
                        (int)Math.Round((double)bitmapheight / dpires * FResolution));
                    if (rec.Width < arec.Width)
                        rec = new Rectangle(rec.Left + (arec.Width - rec.Width) / 2, rec.Top,
                            rec.Width, rec.Height);
                    if (rec.Height < arec.Height)
                        rec = new Rectangle(rec.Left, rec.Top + (arec.Height - rec.Height) / 2,
                            rec.Width, rec.Height);
                    arect = rec;
                }
                if (internal_imageindex >= 0)
                {
                    if (File.ImageIndexes.IndexOfKey(internal_imageindex.ToString()) >= 0)
                    {
                        imageindex = (int)File.ImageIndexes[internal_imageindex.ToString()];
                        newstream = false;
                    }
                    else
                    {
                        File.ImageCount = File.ImageCount + 1;
                        imageindex = File.ImageCount;
                        File.ImageIndexes.Add(internal_imageindex.ToString(), imageindex);
                    }
                }

                /* Cambio no fusionado mediante combinación del proyecto 'Reportman.Drawing (net48)'
                Antes:
                                if (imageMaskStream != null)
                                {
                                    if (imageMaskStream.Length == 0)
                                    {
                                        imageMaskStream.Dispose();
                                        imageMaskStream = null;
                                    }
                                }
                                if (dpires != 0)
                                {
                                    var arec = new Rectangle(rec.Left, rec.Top, rec.Width, rec.Height);
                                    rec = new Rectangle(rec.Left, rec.Top,
                                        (int)Math.Round((double)bitmapwidth / dpires * FResolution),
                                        (int)Math.Round((double)bitmapheight / dpires * FResolution));
                                    if (rec.Width < arec.Width)
                                        rec = new Rectangle(rec.Left + (arec.Width - rec.Width) / 2, rec.Top,
                                            rec.Width, rec.Height);
                                    if (rec.Height < arec.Height)
                                        rec = new Rectangle(rec.Left, rec.Top + (arec.Height - rec.Height) / 2,
                                            rec.Width, rec.Height);
                                    arect = rec;
                                }
                                if (internal_imageindex >= 0)
                                {
                                    if (File.ImageIndexes.IndexOfKey(internal_imageindex.ToString()) >= 0)
                                    {
                                        imageindex = (int)File.ImageIndexes[internal_imageindex.ToString()];
                                        newstream = false;
                                    }
                                    else
                                    {
                                        File.ImageCount = File.ImageCount + 1;
                                        imageindex = File.ImageCount;
                                        File.ImageIndexes.Add(internal_imageindex.ToString(), imageindex);
                                    }
                                }
                                else
                                {
                                    File.ImageCount = File.ImageCount + 1;
                                    imageindex = File.ImageCount;
                                }
                                SWriteLine(File.STempStream, "q");
                                if (clip)
                                {
                                    // Clipping rectangle
                                    SWriteLine(File.STempStream, UnitsToTextX(arect.Left) + " " + UnitsToTextY(arect.Top) +
                                        ' ' + UnitsToTextX(arect.Width - arect.Left) + ' ' + UnitsToTextX(-(arect.Height - arect.Top)) + " re");
                                    SWriteLine(File.STempStream, "h"); // ClosePath
                                    SWriteLine(File.STempStream, "W"); // Clip
                                    SWriteLine(File.STempStream, "n"); // NewPath
                                }
                                awidth = rec.Width;
                                aheight = rec.Height;
                                if (awidth <= 0)
                                    tile = false;
                                if (aheight <= 0)
                                    tile = false;
                                do
                                {
                                    rec = new Rectangle(arect.Left, rec.Top, awidth, aheight);
                                    do
                                    {
                                        /*if (newstream && (imageMaskStream != null))
                                        {
                Después:
                                if (imageMaskStream != null)
                                {
                                    if (imageMaskStream.Length == 0)
                                    {
                                        imageMaskStream.Dispose();
                                        imageMaskStream = null;
                                    }
                                }
                                if (dpires != 0)
                                {
                                    var arec = new Rectangle(rec.Left, rec.Top, rec.Width, rec.Height);
                                    rec = new Rectangle(rec.Left, rec.Top,
                                        (int)Math.Round((double)bitmapwidth / dpires * FResolution),
                                        (int)Math.Round((double)bitmapheight / dpires * FResolution));
                                    if (rec.Width < arec.Width)
                                        rec = new Rectangle(rec.Left + (arec.Width - rec.Width) / 2, rec.Top,
                                            rec.Width, rec.Height);
                                    if (rec.Height < arec.Height)
                                        rec = new Rectangle(rec.Left, rec.Top + (arec.Height - rec.Height) / 2,
                                            rec.Width, rec.Height);
                                    arect = rec;
                                }
                                if (internal_imageindex >= 0)
                                {
                                    if (File.ImageIndexes.IndexOfKey(internal_imageindex.ToString()) >= 0)
                                    {
                                        imageindex = (int)File.ImageIndexes[internal_imageindex.ToString()];
                                        newstream = false;
                                    }
                                    else
                                    {
                                        File.ImageCount = File.ImageCount + 1;
                                        imageindex = File.ImageCount;
                                        File.ImageIndexes.Add(internal_imageindex.ToString(), imageindex);
                                    }
                                }
                                else
                                {
                                    File.ImageCount = File.ImageCount + 1;
                                    imageindex = File.ImageCount;
                                }
                                SWriteLine(File.STempStream, "q");
                                if (clip)
                                {
                                    // Clipping rectangle
                                    SWriteLine(File.STempStream, UnitsToTextX(arect.Left) + " " + UnitsToTextY(arect.Top) +
                                        ' ' + UnitsToTextX(arect.Width - arect.Left) + ' ' + UnitsToTextX(-(arect.Height - arect.Top)) + " re");
                                    SWriteLine(File.STempStream, "h"); // ClosePath
                                    SWriteLine(File.STempStream, "W"); // Clip
                                    SWriteLine(File.STempStream, "n"); // NewPath
                                }
                                awidth = rec.Width;
                                aheight = rec.Height;
                                if (awidth <= 0)
                                    tile = false;
                                if (aheight <= 0)
                                    tile = false;
                                do
                                {
                                    rec = new Rectangle(arect.Left, rec.Top, awidth, aheight);
                                    do
                                    {
                                        /*if (newstream && (imageMaskStream != null))
                                        {
                */
                else
                {
                    File.ImageCount = File.ImageCount + 1;
                    imageindex = File.ImageCount;
                }
                SWriteLine(File.STempStream, "q");
                if (clip)
                {
                    // Clipping rectangle
                    SWriteLine(File.STempStream, UnitsToTextX(arect.Left) + " " + UnitsToTextY(arect.Top) +
                        ' ' + UnitsToTextX(arect.Width - arect.Left) + ' ' + UnitsToTextX(-(arect.Height - arect.Top)) + " re");
                    SWriteLine(File.STempStream, "h"); // ClosePath
                    SWriteLine(File.STempStream, "W"); // Clip
                    SWriteLine(File.STempStream, "n"); // NewPath
                }
                awidth = rec.Width;
                aheight = rec.Height;
                if (awidth <= 0)
                    tile = false;
                if (aheight <= 0)
                    tile = false;
                do
                {
                    rec = new Rectangle(arect.Left, rec.Top, awidth, aheight);
                    do
                    {
                        /*if (newstream && (imageMaskStream != null))
                        {
							SWriteLine(File.STempStream, "AIS false");
						}*/
                        SWriteLine(File.STempStream, "q");
                        // Translate
                        SWriteLine(File.STempStream, "1 0 0 1 "
                            + UnitsToTextX(rec.Left) +
                            " " + UnitsToTextY(rec.Top + rec.Height) + " cm");
                        // Scale
                        SWriteLine(File.STempStream, UnitsToTextX(rec.Width) +
                            " 0 0  " + UnitsToTextX(rec.Height) + " 0 0 cm");
                        SWriteLine(File.STempStream, "/Im" + imageindex.ToString() + " Do");
                        SWriteLine(File.STempStream, "Q");
                        if (!tile)
                            break;
                        rec = new Rectangle(rec.Left + awidth, rec.Top, rec.Left + awidth, rec.Height);
                    } while (rec.Width <= arect.Width + awidth);
                    if (!tile)
                        break;
                    rec = new Rectangle(rec.Left, rec.Top + aheight, rec.Width, rec.Top + aheight);
                } while (rec.Height <= arect.Height + aheight);
                if (newstream)
                {
                    System.IO.MemoryStream maskStream = null;
                    string imageName = "Im" + File.ImageCount.ToString();
                    if (!File.CalculateOnly)
                    {
                        string imageMaskName = "";
                        if (imageMaskStream != null)
                        {
                            File.ImageCount = File.ImageCount + 1;
                            imageMaskName = "Im" + File.ImageCount.ToString();

                            // Saves the bitmap to temp bitmaps
                            maskStream = new MemoryStream();
                            SWriteLine(maskStream, "<< /Type /XObject");
                            SWriteLine(maskStream, "/Subtype /Image");
                            SWriteLine(maskStream, "/Width " + bitmapwidth.ToString());
                            SWriteLine(maskStream, "/Height " + bitmapheight.ToString());
                            SWriteLine(maskStream, "/ColorSpace /DeviceGray");
                            SWriteLine(maskStream, "/BitsPerComponent 8");
                            imageMaskName = "Im" + File.ImageCount.ToString();
                            SWriteLine(maskStream, "/Name /" + imageMaskName);

#if REPMAN_ZLIB
                            long lengthPositionMask = 0;
                            if (File.Compressed)
                            {
                                byte[] bytesLength = ASCIIEncoding.ASCII.GetBytes("/Length ");
                                maskStream.Write(bytesLength, 0, bytesLength.Length);
                                lengthPositionMask = maskStream.Position;
                                SWriteLine(maskStream, "             ");
                                SWriteLine(maskStream, "/Length1 " + imageMaskStream.Length.ToString());
                                SWriteLine(maskStream, "/Filter [/FlateDecode]");
                            }
                            else
                                SWriteLine(maskStream, "/Length " + imageMaskStream.Length.ToString());
#endif

                            SWriteLine(maskStream, ">>");
                            SWriteLine(maskStream, "stream");
                            imageMaskStream.Seek(0, System.IO.SeekOrigin.Begin);
#if REPMAN_ZLIB
                            if (File.Compressed)
                            {
                                // StreamUtil.CompressStream(fimagestream, astream, false);		
                                CancellationTokenSource cancelSource = new();
                                var ntask = StreamUtil.CompressStreamTask(imageMaskStream, maskStream, false, true, cancelSource);
                                ntask.ConfigureAwait(false);
                                File.CompressionTasks.Add(new CompressionTask(ntask, cancelSource, maskStream, lengthPositionMask));
                            }
                            else
#endif
                                imageMaskStream.WriteTo(maskStream);

                        }
                        // Saves the bitmap to temp bitmaps
                        astream = new MemoryStream();
                        SWriteLine(astream, "<< /Type /XObject");
                        SWriteLine(astream, "/Subtype /Image");
                        SWriteLine(astream, "/Width " + bitmapwidth.ToString());
                        SWriteLine(astream, "/Height " + bitmapheight.ToString());
                        if (indexed)
                        {
                            SWriteLine(astream, "/ColorSpace");
                            SWriteLine(astream, "[/Indexed");
                            SWriteLine(astream, "/DeviceRGB " + numcolors.ToString());
                            SWriteLine(astream, palette);
                            SWriteLine(astream, "]");
                            SWriteLine(astream, "/BitsPerComponent " + bitsperpixel.ToString());
                            if (mask.Length > 0)
                            {
                                SWriteLine(astream, "/Mask " + mask);

                            }
                        }
                        else
                        {
                            SWriteLine(astream, "/ColorSpace /DeviceRGB");
                            SWriteLine(astream, "/BitsPerComponent 8");
                        }
                        SWriteLine(astream, "/Name /" + imageName);
                        if (maskStream != null)
                        {
                            // SWriteLine(astream, "/SMask " + " 26 0 R");
                            byte[] maskBuf = ASCIIEncoding.ASCII.GetBytes("/SMask ");
                            astream.Write(maskBuf, 0, maskBuf.Length);
                            long imageMaskPosition = astream.Position;
                            File.Masks.Add(File.ImageCount - 1, new StreamPosition(astream, imageMaskPosition));
                            SWriteLine(astream, "               0 R");
                        }
                        long lengthPosition = 0;
                        if (isjpeg)
                        {
                            SWriteLine(astream, "/Length " + fimagestream.Length.ToString());
                            SWriteLine(astream, "/Filter [/DCTDecode]");
                        }
                        else
                            if (isgif)
                            {
                                SWriteLine(astream, "/Length " + fimagestream.Length.ToString());
                                SWriteLine(astream, "/Filter [/LZWDecode]");
                            }
                            else
                            {
#if REPMAN_ZLIB
                                if (File.Compressed)
                                {
                                    byte[] bytesLength = ASCIIEncoding.ASCII.GetBytes("/Length ");
                                    astream.Write(bytesLength, 0, bytesLength.Length);
                                    lengthPosition = astream.Position;
                                    SWriteLine(astream, "             ");
                                    SWriteLine(astream, "/Length1 " + fimagestream.Length.ToString());
                                    SWriteLine(astream, "/Filter [/FlateDecode]");
                                }
                                else
#endif
                                    SWriteLine(astream, "/Length " + fimagestream.Length.ToString());
                            }
                        SWriteLine(astream, ">>");
                        SWriteLine(astream, "stream");
                        fimagestream.Seek(0, System.IO.SeekOrigin.Begin);
#if REPMAN_ZLIB
                        if ((File.Compressed) && (!isjpeg) && (!isgif))
                        {
                            // StreamUtil.CompressStream(fimagestream, astream, false);		
                            CancellationTokenSource cancelSource = new();
                            var ntask = StreamUtil.CompressStreamTask(fimagestream, astream, false, true, cancelSource);
                            ntask.ConfigureAwait(false);
                            File.CompressionTasks.Add(new CompressionTask(ntask, cancelSource, astream, lengthPosition));
                        }
                        else
#endif
                            fimagestream.WriteTo(astream);
                        File.BitmapStreams.Add(astream);
                        if (maskStream != null)
                            File.BitmapStreams.Add(maskStream);
                    }
                }
            }
            finally
            {
            }
        }
        /// <summary>
        /// Measures text within a rectangle and returns per-line information, routing to the complex shaper
        /// (for RTL, HTML, FreeType, or when forced) or to the fast simple pass otherwise.
        /// </summary>
        /// <param name="Text">The text to measure.</param>
        /// <param name="rect">On input the layout rectangle; on output the measured extent.</param>
        /// <param name="wordbreak">Whether text wraps on word boundaries.</param>
        /// <param name="singleline">Whether the text is treated as a single line.</param>
        /// <param name="dolineinfo">Whether to populate the per-line information list.</param>
        /// <param name="RightToLeft">Whether the text is right-to-left.</param>
        /// <param name="isHtml">Whether the text carries HTML styling.</param>
        /// <returns>The list of measured lines.</returns>
        public List<LineInfo> TextExtent(string Text, ref Rectangle rect, bool wordbreak, bool singleline, bool dolineinfo, bool RightToLeft, bool isHtml = false)
        {
            List<LineInfo> result;
            bool useShaper = RightToLeft || isHtml || this.InfoProvider.GetType().Name == "FontInfoFt";
            if (useShaper || ForceComplexShaping)
            {
                if (useShaper)
                {
                    Font.Name = PDFFontType.Embedded;
                }
                // else (ForceComplexShaping path): preserve Font.Name as the caller set it
                // (typically PDFFontType.Linked). GetTTFontData accepts Linked or Embedded.
                var data = GetTTFontData();
                result = this.InfoProvider.TextExtent(Text, ref rect, Font, data, wordbreak, singleline, Font.Size, isHtml);
            }
            else
            {
                TextExtentSimple(Text, ref rect, wordbreak, singleline, dolineinfo);
                result = new List<LineInfo>();
                foreach (var ainfo in Lines)
                {
                    result.Add(ainfo);
                }
            }
            return result;
        }

        /// <summary>
        /// Fast text measurement using built-in font width tables, computing line breaks and per-line metrics
        /// without glyph shaping and updating the rectangle with the measured extent.
        /// </summary>
        /// <param name="Text">The text to measure.</param>
        /// <param name="rect">On input the layout rectangle; on output the measured extent.</param>
        /// <param name="wordbreak">Whether text wraps on word boundaries.</param>
        /// <param name="singleline">Whether the text is treated as a single line.</param>
        /// <param name="dolineinfo">Whether to populate the per-line information list.</param>
        public void TextExtentSimple(string Text, ref Rectangle rect, bool wordbreak, bool singleline, bool dolineinfo)
        {
            if (singleline)
            {
                wordbreak = false;
                Text = Text.Replace("\r\n", " ").Replace("\n", " ").Replace("\r", "");
            }
            // Calculate leading and line spacing
            //bool havekerning = false;
            TTFontData adata = GetTTFontData();
            //double kerningamount;
            int linespacing;
            int leading;
            if (adata != null)
            {
                //if (adata.HaveKerning)
                //	havekerning = true;
                linespacing = adata.Ascent - adata.Descent + adata.Leading;
                leading = adata.Leading;
            }
            else
            {
                GetStdLineSpacing(out linespacing, out leading);
            }
            leading = (int)Math.Round((((double)leading) / 100000.0) * FResolution * FFont.Size * 1.25);
            linespacing = (int)Math.Round((((double)linespacing) / 100000.0) * FResolution * FFont.Size * 1.25);


            StringBuilder currentline = new();
            double currentwidth = 0;
            double maxwidth = 0;
            double newsize = 0;
            int linebreakpos = 0;
            bool wasspace = false;
            int infocount = 0;
            double lastsize = 0;
            double lastsizewithoutspace = 0;
            int lastindexwithoutspace = 0;
            int currenttoppos = 0;
            double recwidth = (double)(rect.Width) / FResolution * PDFFile.CONS_PDFRES;
            if (dolineinfo)
                Lines.Clear();
            // Replace cr/lf for only cfs
            //string astring = Text.Replace(""+(char)13+(char)10,""+(char)10);
            // Kill tabs replace with spaces
            string astring = Text;
            astring = astring.Replace("\t", " ");
            int i = 0;
            int startposition = 0;
            LineInfo linfo = new();
            while (i < astring.Length)
            {
                // Skip cr chars
                //                if (astring[i] == (char)13)
                //{
                //i++;
                //if (i >= astring.Length)
                //break;
                //}
                // Check for LF
                if ((astring[i] == (char)10))
                {
                    // Add the line
                    int cutindex = i;
                    if (wasspace)
                    {
                        cutindex = lastindexwithoutspace + 1;
                        currentwidth = lastsizewithoutspace;
                    }
                    linfo.LastLine = true;
                    linfo.Position = startposition;
                    linfo.Step = PrintStepType.cpi10;
                    linfo.Size = cutindex - startposition;
                    if (i > 0)
                        if (astring[i - 1] == (char)13)
                            linfo.Size = linfo.Size - 1;
                    if (linfo.Size < 0)
                        linfo.Size = 0;
                    linfo.Width = (int)Math.Round((currentwidth * FResolution / PDFFile.CONS_PDFRES));
                    if (currentwidth > maxwidth)
                        maxwidth = currentwidth;
                    linfo.TopPos = currenttoppos - leading;
                    linfo.Height = linespacing;
                    currenttoppos = currenttoppos + linespacing;
                    if (dolineinfo)
                        Lines.Add(linfo);
                    infocount++;
                    currentwidth = 0;
                    startposition = i + 1;
                }
                else
                {
                    newsize = CalcCharWidth(astring[i], adata);
                    // Check Kerning pairs to reduce new size
                    /*if (havekerning)
					{
						if (i < (astring.Length - 1))
						{
							
                            // Kerning is not supported by GDI+ so disable it (PDF and GDI+)
                            kerningamount = InfoProvider.GetKerning(Font, adata, astring[i], astring[i + 1]);
                            newsize = newsize - (kerningamount * (double)FFont.Size / 1000);
                            
						}
					}*/
                    // If the character fits inside the line
                    if ((currentwidth + newsize <= recwidth) || (!wordbreak))
                    {
                        if (astring[i] == ' ')
                        {
                            if (!wasspace)
                            {
                                wasspace = true;
                                lastsizewithoutspace = currentwidth;
                                if (i > startposition)
                                {
                                    lastindexwithoutspace = i - 1;
                                    linebreakpos = i - 1;
                                    lastsize = currentwidth;
                                }
                                else
                                    lastindexwithoutspace = 0;
                            }
                        }
                        else
                        {
                            wasspace = false;
                            if (IsSeparatorSign(astring[i]))
                            {
                                linebreakpos = i;
                                lastsize = currentwidth + newsize;
                            }
                        }
                        currentwidth = currentwidth + newsize;
                    }
                    // When the character does not fit
                    else
                    {
                        if (wordbreak)
                        {
                            // Add the line
                            if ((currentwidth == 0) && (startposition == i))
                                i++;
                            int cutindex = i;
                            if (linebreakpos > 0)
                            {
                                cutindex = linebreakpos + 1;
                                i = linebreakpos;
                                currentwidth = lastsize;
                            }
                            else
                                i--;
                            if (wasspace)
                            {
                                cutindex = lastindexwithoutspace + 1;
                                currentwidth = lastsizewithoutspace;
                            }
                            linfo.LastLine = false;
                            linfo.Position = startposition;
                            linfo.Step = PrintStepType.cpi10;
                            linfo.Size = cutindex - startposition;
                            if (linfo.Size < 0)
                                linfo.Size = 0;
                            linfo.Width = (int)Math.Round((currentwidth * FResolution / PDFFile.CONS_PDFRES));
                            if (currentwidth > maxwidth)
                                maxwidth = currentwidth;
                            linfo.TopPos = currenttoppos - leading;
                            linfo.Height = linespacing;
                            currenttoppos = currenttoppos + linespacing;
                            if (dolineinfo)
                                Lines.Add(linfo);
                            infocount++;
                            currentwidth = 0;
                            linebreakpos = 0;
                            startposition = i + 1;
                            // Skip spaces
                            while (startposition < astring.Length - 1)
                            {
                                if (astring[startposition] == ' ')
                                {
                                    startposition++;
                                    i = startposition - 1;
                                }
                                else
                                    break;
                            }
                        }
                    }
                }
                i++;
            }
            // Check for LF
            if (startposition < astring.Length)
            {
                // Add the line
                int cutindex = i;
                if (wasspace)
                {
                    cutindex = lastindexwithoutspace + 1;
                    currentwidth = lastsizewithoutspace;
                }
                linfo.LastLine = true;
                linfo.Position = startposition;
                linfo.Step = PrintStepType.cpi10;
                linfo.Size = cutindex - startposition;
                if (linfo.Size < 0)
                    linfo.Size = 0;
                linfo.Width = (int)Math.Round((currentwidth * FResolution / PDFFile.CONS_PDFRES));
                if (currentwidth > maxwidth)
                    maxwidth = currentwidth;
                linfo.TopPos = currenttoppos - leading;
                linfo.Height = linespacing;
                currenttoppos = currenttoppos + linespacing;
                if (dolineinfo)
                    Lines.Add(linfo);
                infocount++;
            }
            int totalheight = 0;
            if (infocount > 0)
                totalheight = infocount * linespacing + leading;
            Rectangle arec = new(rect.Left, rect.Top,
                                           (int)Math.Round((maxwidth * FResolution / PDFFile.CONS_PDFRES)),
                                           totalheight);
            rect = arec;
        }

        /*		public void TextExtent(string Text, ref Rectangle rect, bool wordbreak, bool singleline, bool dolineinfo)
				{
					string astring;
					double asize;
					Rectangle arec;
					int position, i;
					LineInfo info = new LineInfo();
					int offset = 0;

					double maxwidth, newsize, recwidth;
					int linebreakpos;
					bool nextline;
					double alastsize;
					bool lockspace;
					bool createsnewline;
					bool havekerning;
					TTFontData adata;
					int kerningamount;
					int linespacing;
					int leading;
					// Text extent for the simple strings, wide strings not supported
					havekerning = false;
					adata = GetTTFontData();
					if (adata != null)
					{
						if (adata.HaveKerning)
							havekerning = true;
						linespacing = adata.Ascent - adata.Descent + adata.Leading;
						leading = adata.Leading;
					}
					else
					{
						GetStdLineSpacing(out linespacing, out leading);
					}
					leading = (int)Math.Round((((double)leading) / 100000.0) * FResolution * FFont.Size * 1.25);
					linespacing = (int)Math.Round((((double)linespacing) / 100000.0) * FResolution * FFont.Size * 1.25);

					createsnewline = false;
					astring = Text;
					arec = new Rectangle(0, 0, rect.Width, 0);
					asize = 0;
					if (dolineinfo)
						Lines.Clear();

					position = 0;
					linebreakpos = 0;
					maxwidth = 0;
					recwidth = (double)(rect.Width - rect.Left) / FResolution * PDFFile.CONS_PDFRES;
					nextline = false;
					i = 0;
					alastsize = 0;
					lockspace = false;
					bool incomplete;
					while (i < astring.Length)
					{
						incomplete = false;
						newsize = CalcCharWidth(astring[i], adata);
						if (havekerning)
						{
							if (i < (astring.Length - 1))
							{
								kerningamount = InfoProvider.GetKerning(Font, adata, astring[i], astring[i + 1]);
								newsize = newsize - (kerningamount * (double)FFont.Size / 1000);
							}
						}
						if (!IsSeparator(astring[i]))
							lockspace = false;
						if (wordbreak)
						{
							if (asize + newsize > recwidth)
							{
								if (linebreakpos > 0)
								{
									i = linebreakpos;
									nextline = true;
									asize = alastsize;
									linebreakpos = 0;
								}
								else
								{
									nextline = true;
									incomplete = true;
									linebreakpos = 0;
								}
							}
							else
							{
								if (IsSign(astring[i]))
								{
									linebreakpos = i;
									if (astring[i] == ' ')
									{
										if (!lockspace)
										{
											alastsize = asize;
											lockspace = true;

										}
										asize=asize+newsize;
									}
									else
									{
										asize = asize + newsize;
										alastsize = asize;
									}
								}
								else
									asize = asize + newsize;
							}
						}
						else
							asize = asize + newsize;
						if ((!singleline) && (i<astring.Length))
						{
							if (astring[i] == (char)10)
							{
								nextline = true;
								offset = 1;
								createsnewline = true;
							}
							else
							if (astring[i] == (char)13)
							{
								if (i<(astring.Length-1))
								{
									if (astring[i+1] == (char)10)
									{
										nextline = true;
										offset = 2;
										i++;
										createsnewline = true;
									}
								}
							}
						}
						if (asize > maxwidth)
							maxwidth = asize;
						if (nextline)
						{
							nextline = false;
							info.Position = position;
							info.Size = i - position - offset;
							info.Width = (int)Math.Round((asize) / PDFFile.CONS_PDFRES * FResolution);
							//   info.height:=Round((Font.Size)/CONS_PDFRES*FResolution);
							info.Height = linespacing;
							info.TopPos = arec.Height - leading;
							info.LastLine = createsnewline;
							info.Step = PrintStepType.cpi10;
							arec = new Rectangle(arec.Left, arec.Top, arec.Width, arec.Height + info.Height);
							asize = 0;
							if (incomplete)
								i--;
							position = i + 1;
							if (dolineinfo)
								Lines.Add(info);
							createsnewline = false;
							// Skip only one blank char
							if (!incomplete)
								if (i < astring.Length - 1)
									if (astring[i + 1] == ' ')
									{
										i++;
										position = i + 1;
									}
						}
						i++;
					}
					arec = new Rectangle(arec.Left, arec.Top,
						(int)Math.Round((maxwidth + 1) / PDFFile.CONS_PDFRES * FResolution), arec.Height);
					if (position <= astring.Length - 1)
					{
						info.Position = position;
						info.Size = astring.Length - position - offset;
						info.Width = (int)Math.Round((asize + 1) / PDFFile.CONS_PDFRES * FResolution);
						info.Height = linespacing;
						info.TopPos = arec.Height - leading;
						info.Step = PrintStepType.cpi10;
						arec = new Rectangle(arec.Left, arec.Top, arec.Width, arec.Height + info.Height);
						info.LastLine = true;
						if (dolineinfo)
							Lines.Add(info);
					}
					arec = new Rectangle(arec.Left, arec.Top, arec.Width, arec.Height + leading);
					rect = arec;
				}
		 */
        static PDFCanvas()
        {
#if NETCOREAPP
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
#endif
        }
        static string UnicodeToWin1252(string source)
        {

            Encoder enc = Encoding.GetEncoding(1252).GetEncoder();
            Byte[] pbytes = new byte[source.Length * 2];
            int bytesused;

            //enc.Convert(source.ToCharArray(),0,source.Length,pbytes,0,source.Length,true,out charsused,out bytesused,out completed);

            bytesused = enc.GetBytes(source.ToCharArray(), 0, source.Length, pbytes, 0, true);

            StringBuilder st = new();
            char c;
            for (int i = 0; i < bytesused; i++)
            {
                c = (char)pbytes[i];
                st.Append(c);
            }
            return st.ToString();
        }
    }
    /// <summary>
    /// Builds a complete PDF document: manages object/cross-reference tables, pages,
    /// embedded fonts, metadata, annotations, stream compression, and final assembly.
    /// </summary>
    public class PDFFile : IDisposable
    {
        /// <summary>
        /// Describes a single PDF annotation (typically a link), recording its target
        /// content stream, page, position, size, and annotation dictionary text.
        /// </summary>
        public class PDFAnnotation
        {
            /// <summary>
            /// PDF object number assigned to this annotation when it is written.
            /// </summary>
            public long StreamNumber;
            /// <summary>
            /// Horizontal position of the annotation in resolution units.
            /// </summary>
            public int PosX;
            /// <summary>
            /// Vertical position of the annotation in resolution units.
            /// </summary>
            public int PosY;
            /// <summary>
            /// Width of the annotation rectangle in resolution units.
            /// </summary>
            public int Width;
            /// <summary>
            /// Height of the annotation rectangle in resolution units.
            /// </summary>
            public int Height;
            /// <summary>
            /// Annotation payload; a "URL:" prefix marks a link, otherwise plain text content.
            /// </summary>
            public string Annotation;
            /// <summary>
            /// One-based page number the annotation belongs to.
            /// </summary>
            public int Page;
        }

        private const string LINE_FEED = "\r\n";
        private long FResourceNum, FCatalogNum;
        private long FOutlinesNum;
        private int FCurrentSetPageObject;
        private long FXMPMetadataObject;
        private long FOutputIntentObject;
        private long FColorSpaceObject;
        private DateTime FInternalFDocCreationDate = System.DateTime.Now;
        private long PageObjNum;
        private Strings FPages;
        private MemoryStream FSTempStream;
        private MemoryStream FTempStream;
        private Stream FMainPDF;
        /// <summary>
        /// Output file path; when empty the document is built in memory instead of on disk.
        /// </summary>
        public string FileName = "";
        private PDFCanvas FCanvas;
        private bool FPrinting;
        private int FFontCount;
        private long FObjectCount;
        private PageInfos FPageInfos;
        private int FResolution;
        private Longs FObjectOffsets;
        /// <summary>
        /// Maps caller-supplied image keys to the PDF image index used to reuse already-embedded images.
        /// </summary>
        public SortedList ImageIndexes;
        /// <summary>
        /// Running byte offset of the last written object, used to build the cross-reference table.
        /// </summary>
        public long FObjectOffset;
        /// <summary>
        /// When true, redundant color operators are suppressed to reduce output size.
        /// </summary>
        public bool Optimized;
        private int FPage;
        private long FParentNum;
        private Strings FFontList;
        private MemStreams FBitmapStreams;
        /// <summary>
        /// Pending asynchronous stream-compression tasks whose results are patched back on completion.
        /// </summary>
        public List<CompressionTask> CompressionTasks;
        /// <summary>
        /// Number of PDF points per inch (72).
        /// </summary>
        public const int POINTS_PER_INCH = 72;
        /// <summary>
        /// When true, content and image streams are written using Flate compression.
        /// </summary>
        public bool Compressed;
        /// <summary>
        /// When true, compression favors smaller output over speed.
        /// </summary>
        public bool OptimizeSize = true;
        /// <summary>
        /// Number of images embedded so far in the document.
        /// </summary>
        public int ImageCount;
        /// <summary>
        /// PDF coordinate resolution in points per inch.
        /// </summary>
        public const int CONS_PDFRES = POINTS_PER_INCH;
        /// <summary>
        /// Vertical position factor for the underline, relative to the font size.
        /// </summary>
        public const double CONS_UNDERLINEPOS = 1.1;
        /// <summary>
        /// Vertical position factor for the strikeout, relative to the font size.
        /// </summary>
        public const double CONS_STRIKEOUTPOS = 0.7;
        /// <summary>
        /// Underline and strikeout stroke width factor, relative to the font size.
        /// </summary>
        public const double CONS_UNDERLINEWIDTH = 0.1;
        private const string CONS_UNICODEPREDIX = "";
        /// <summary>
        /// Gets the stream that receives the final assembled PDF output.
        /// </summary>
        public Stream MainPDF { get { return FMainPDF; } }
        /// <summary>
        /// Height of the current page in resolution units.
        /// </summary>
        public int PageHeight;
        /// <summary>
        /// Width of the current page in resolution units.
        /// </summary>
        public int PageWidth;
        /// <summary>
        /// Gets the collection of embedded image (and mask) streams awaiting output.
        /// </summary>
        public MemStreams BitmapStreams { get { return FBitmapStreams; } }
        /// <summary>
        /// Document information dictionary metadata: title, author, creator, keywords, subject and producer.
        /// </summary>
        public string DocTitle, DocAuthor, DocCreator, DocKeywords, DocSubject, DocProducer;
        /// <summary>
        /// XMP metadata packet content used for PDF/A output.
        /// </summary>
        public string DocXMPContent;
        /// <summary>
        /// Document creation date in PDF date format.
        /// </summary>
        public string DocCreationDate;
        /// <summary>
        /// Document modification date in PDF date format.
        /// </summary>
        public string DocModificationDate;

        /// <summary>
        /// The pdf is not generated but all size calculations are done
        /// </summary>
        public bool CalculateOnly;
        /// <summary>
        /// Maps an image index to the output-stream position where its soft-mask object reference is patched in.
        /// </summary>
        public SortedList<int, StreamPosition> Masks = new();
        PDFConformanceType FPDFConformance;

        /// <summary>
        /// Gets or sets the PDF conformance level, propagating the change to the underlying canvas.
        /// </summary>
        public PDFConformanceType PDFConformance
        {
            get
            {
                return FPDFConformance;
            }
            set
            {
                FPDFConformance = value;
                FCanvas.PDFConformance = value;
            }

        }
        /// <summary>
        /// Files to embed in the document (used for PDF/A-3 attachments).
        /// </summary>
        public List<EmbeddedFile> EmbeddedFiles = new();
        private SortedList<int, List<PDFAnnotation>> PageAnnotations = new();
        /// <summary>
        /// Releases the output, temporary and bitmap streams and cancels any pending compression tasks.
        /// </summary>
        virtual public void Dispose()
        {
#if REPMAN_DOTNET1
#else
            if (FMainPDF != null)
            {
#if REPMAN_COMPACT
#else
                FMainPDF.Dispose();
#endif
                FMainPDF = null;
            }
            if (FTempStream != null)
            {
#if REPMAN_COMPACT
#else
                FTempStream.Dispose();
#endif
                FTempStream = null;
            }
            if (FSTempStream != null)
            {
#if REPMAN_COMPACT
#else
                FSTempStream.Dispose();
#endif
                FSTempStream = null;
            }
            FBitmapStreams.Dispose();
            foreach (var task in CompressionTasks)
            {
                task.CancelTask();
            }
            CompressionTasks.Clear();
#endif
        }
        /// <summary>
        /// Initializes a PDF document with its font and bitmap providers, default metadata, page size and buffers.
        /// </summary>
        /// <param name="infoProvider">Provider of font metrics and glyph data.</param>
        /// <param name="bitmapInfoProvider">Provider that encodes images into PDF-compatible bitmap streams.</param>
        public PDFFile(FontInfoProvider infoProvider, IBitmapInfoProvider bitmapInfoProvider)
        {
            Optimized = false;
            DocTitle = "Report Manager Document";
            DocAuthor = "Report Manager engine";
            DocCreator = DocAuthor;
            DocKeywords = "";
            DocSubject = "";
            DocProducer = DocAuthor;
            FResolution = Twips.TWIPS_PER_INCH;
            FPageInfos = new PageInfos();
            ImageIndexes = new SortedList();
            FPages = new Strings();
            FCanvas = new PDFCanvas(infoProvider, bitmapInfoProvider);
            FCanvas.File = this;
            FCanvas.Resolution = FResolution;
            PageWidth = 12048;
            PageHeight = 17039;
            FMainPDF = null;
            FTempStream = new MemoryStream();
            FSTempStream = new MemoryStream();
            FBitmapStreams = new MemStreams();
            CompressionTasks = new List<CompressionTask>();
            FObjectOffsets = new Longs();
            FFontList = new Strings();
            FOutlinesNum = 0;
        }
        /// <summary>
        /// Adds an annotation (link or note) at the given position on the current page.
        /// </summary>
        /// <param name="posx">Horizontal position in resolution units.</param>
        /// <param name="posy">Vertical position in resolution units.</param>
        /// <param name="width">Annotation width in resolution units.</param>
        /// <param name="height">Annotation height in resolution units.</param>
        /// <param name="annotation">Annotation payload; a "URL:" prefix marks a link, otherwise plain text.</param>
        public void NewAnnotation(int posx, int posy, int width, int height, string annotation)
        {
            var ann = new PDFAnnotation();
            ann.PosX = posx;
            ann.PosY = posy;
            ann.Width = width;
            ann.Height = height;
            ann.Page = FPage;
            ann.Annotation = annotation;
            if (!PageAnnotations.ContainsKey(FPage))
            {
                PageAnnotations.Add(FPage, new List<PDFAnnotation>());
            }
            PageAnnotations[FPage].Add(ann);
        }

        /// <summary>
        /// Throws when the document is not currently between <see cref="BeginDoc"/> and <see cref="EndDoc"/>.
        /// </summary>
        public void CheckPrinting()
        {
            if (!FPrinting)
                throw new Exception("Not printing (PDFFile.CheckPrinting)");
        }
        /// <summary>
        /// Gets or sets the device resolution in twips per inch, propagating the value to the canvas.
        /// </summary>
        public int Resolution
        {
            get { return FResolution; }
            set { FResolution = value; FCanvas.Resolution = value; }
        }
        /// <summary>
        /// Gets a value indicating whether the document is currently being generated.
        /// </summary>
        public bool Printing
        {
            get { return FPrinting; }
        }
        /// <summary>
        /// Gets the temporary stream that accumulates the current page's content-stream operators.
        /// </summary>
        public MemoryStream STempStream
        {
            get { return FSTempStream; }
        }
        /// <summary>
        /// Gets the drawing canvas that emits content-stream operators into this document.
        /// </summary>
        public PDFCanvas Canvas
        {
            get { return FCanvas; }
        }
        void AddToOffset(long offset)
        {
            FObjectOffset = FObjectOffset + offset;
            FObjectOffsets.Add(FObjectOffset);
        }
        private void SWriteLine(Stream nstream, string value)
        {
            StreamUtil.SWriteLine(nstream, value, PDFConformance == PDFConformanceType.PDF_1_4);
        }
        void CreateFont(string subtype, string basefont, string encoding)
        {
            FFontCount = FFontCount + 1;
            FObjectCount = FObjectCount + 1;
            FFontList.Add(FObjectCount.ToString());
            FTempStream.SetLength(0);
            SWriteLine(FTempStream, FObjectCount.ToString() + " 0 obj");
            SWriteLine(FTempStream, "<< /Type /Font");
            SWriteLine(FTempStream, "/Subtype /" + subtype);
            SWriteLine(FTempStream, "/Name /F" + FFontCount.ToString());
            SWriteLine(FTempStream, "/BaseFont /" + basefont);
            SWriteLine(FTempStream, "/Encoding /" + encoding);
            SWriteLine(FTempStream, ">>");
            SWriteLine(FTempStream, "endobj");
            AddToOffset(FTempStream.Length);
            FTempStream.Seek(0, SeekOrigin.Begin);
            FTempStream.WriteTo(FMainPDF);
        }
        void SetOutLine()
        {
            FObjectCount = FObjectCount + 1;
            FOutlinesNum = FObjectCount;
            FTempStream.SetLength(0);
            SWriteLine(FTempStream, FObjectCount.ToString() + " 0 obj");
            SWriteLine(FTempStream, "<< /Type /Outlines");
            SWriteLine(FTempStream, "/Count 0");
            SWriteLine(FTempStream, ">>");
            SWriteLine(FTempStream, "endobj");
            AddToOffset(FTempStream.Length);
            FTempStream.Seek(0, SeekOrigin.Begin);
            FTempStream.WriteTo(FMainPDF);
        }
        void SetPages()
        {
            int i;
            FObjectCount = FObjectCount + 1;
            FParentNum = FObjectCount;
            FTempStream.SetLength(0);
            SWriteLine(FTempStream, FObjectCount.ToString() + " 0 obj");
            SWriteLine(FTempStream, "<< /Type /Pages");
            SWriteLine(FTempStream, "/Kids [");

            for (i = 1; i <= FPage; i++)
            {
                SWriteLine(FTempStream, (FObjectCount + i + 1 + ImageCount).ToString() + " 0 R");
                FPages.Add(PageObjNum.ToString());
                PageObjNum = PageObjNum + 2;
            }
            SWriteLine(FTempStream, "]");
            SWriteLine(FTempStream, "/Count " + FPage.ToString());
            SWriteLine(FTempStream, ">>");
            SWriteLine(FTempStream, "endobj");
            AddToOffset(FTempStream.Length);
            FTempStream.Seek(0, SeekOrigin.Begin);
            FTempStream.WriteTo(FMainPDF);
        }
        void SetFontType()
        {
            int i;
            TTFontData adata;
            int index, acount;
            string awidths;

            if (PDFConformance == PDFConformanceType.PDF_1_4)
            {
                CreateFont("Type1", "Helvetica", "WinAnsiEncoding");
                CreateFont("Type1", "Helvetica-Bold", "WinAnsiEncoding");
                CreateFont("Type1", "Helvetica-Oblique", "WinAnsiEncoding");
                CreateFont("Type1", "Helvetica-BoldOblique", "WinAnsiEncoding");
                CreateFont("Type1", "Courier", "WinAnsiEncoding");
                CreateFont("Type1", "Courier-Bold", "WinAnsiEncoding");
                CreateFont("Type1", "Courier-Oblique", "WinAnsiEncoding");
                CreateFont("Type1", "Courier-BoldOblique", "WinAnsiEncoding");
                CreateFont("Type1", "Times-Roman", "WinAnsiEncoding");
                CreateFont("Type1", "Times-Bold", "WinAnsiEncoding");
                CreateFont("Type1", "Times-Italic", "WinAnsiEncoding");
                CreateFont("Type1", "Times-BoldItalic", "WinAnsiEncoding");
                CreateFont("Type1", "Symbol", "WinAnsiEncoding");
                CreateFont("Type1", "ZapfDingbats", "WinAnsiEncoding");
            }
            // Writes font files
            for (i = 0; i < FCanvas.FontData.Count; i++)
            {
                adata = (TTFontData)Canvas.FontData.GetByIndex(i);
                if (adata.Embedded)
                {
                    // Writes font resource data
                    FObjectCount = FObjectCount + 1;
                    FTempStream.SetLength(0);
                    SWriteLine(FTempStream, FObjectCount.ToString() + " 0 obj");
                    MemoryStream fontcontent = Canvas.InfoProvider.GetFontStream(adata);

                    System.IO.MemoryStream fontcontentstream = new();


                    if (PDFConformance == PDFConformanceType.PDF_A_3)
                    {
                        SWriteLine(FTempStream, "<< /Type /FontFile2");
                    }
                    else
                    {
                        SWriteLine(FTempStream, "<<");
                    }
                    fontcontent.Seek(0, SeekOrigin.Begin);
                    WriteStream(fontcontent, FTempStream);
                    adata.ObjectIndex = FObjectCount;
                    fontcontent.Seek(0, System.IO.SeekOrigin.Begin);
                    SWriteLine(FTempStream, "endobj");
                    AddToOffset(FTempStream.Length);
                    FTempStream.Seek(0, SeekOrigin.Begin);
                    FTempStream.WriteTo(FMainPDF);
                }
                else
                {
                    adata.ObjectIndex = 0;
                }
                // Writes font descriptor
                FObjectCount = FObjectCount + 1;
                FTempStream.SetLength(0);
                SWriteLine(FTempStream, FObjectCount.ToString() + " 0 obj");
                adata.DescriptorIndex = FObjectCount;
                SWriteLine(FTempStream, "<< /Type /FontDescriptor");
                if (adata.IsUnicode)
                {
                    SWriteLine(FTempStream, "/FontName /" + adata.PostcriptName);
                    SWriteLine(FTempStream, "/FontFamily(" + adata.FontFamily + ")");
                }
                else
                    SWriteLine(FTempStream, "/FontName /" + adata.PostcriptName);
                SWriteLine(FTempStream, "/Flags " + adata.Flags.ToString());
                SWriteLine(FTempStream, "/FontBBox [" +
                    adata.FontBBox.Left.ToString() + " " +
                    adata.FontBBox.Height.ToString() + " " +
                    adata.FontBBox.Width.ToString() + " " +
                    adata.FontBBox.Top.ToString() + "]");
                SWriteLine(FTempStream, "/ItalicAngle " + ((int)Math.Round(adata.ItalicAngle)).ToString());
                SWriteLine(FTempStream, "/Ascent " + adata.Ascent.ToString());
                SWriteLine(FTempStream, "/Descent " + adata.Descent.ToString());
                SWriteLine(FTempStream, "/Leading " + adata.Leading.ToString());
                SWriteLine(FTempStream, "/CapHeight " + adata.CapHeight.ToString());
                SWriteLine(FTempStream, "/StemV " + ((int)Math.Round(adata.StemV)).ToString());
                if (adata.AvgWidth != 0)
                    SWriteLine(FTempStream, "/AvgWidth " + adata.AvgWidth.ToString());
                SWriteLine(FTempStream, "/MaxWidth " + adata.MaxWidth.ToString());
                SWriteLine(FTempStream, "/FontStretch /Normal");
                if (adata.FontWeight > 0)
                    SWriteLine(FTempStream, "/FontWeight " + adata.FontWeight.ToString());
                if (adata.Embedded)
                {
                    if (adata.Type1)
                        SWriteLine(FTempStream, "/FontFile " +
                            adata.ObjectIndex.ToString() + " 0 R");
                    else
                        SWriteLine(FTempStream, "/FontFile2 " +
                            adata.ObjectIndex.ToString() + " 0 R");
                }
                SWriteLine(FTempStream, ">>");
                SWriteLine(FTempStream, "endobj");
                AddToOffset(FTempStream.Length);
                FTempStream.Seek(0, SeekOrigin.Begin);
                FTempStream.WriteTo(FMainPDF);

                // To unicode stream
                if (adata.IsUnicode)
                {
                    // First Build the string
                    StringBuilder cmaphead = new("/CIDInit /ProcSet findresource begin" + LINE_FEED +
                        "12 dict begin " + LINE_FEED +
                        "begincmap" + LINE_FEED +
                        "/CIDSystemInfo" + LINE_FEED +
                        "<< /Registry (TTX+0)" + LINE_FEED +
                        "/Ordering (T42UV)" + LINE_FEED +
                        "/Supplement 0" + LINE_FEED +
                        ">> def" + LINE_FEED +
                        "/CMapName /TTX+0 def" + LINE_FEED +
                        "/CMapType 2 def" + LINE_FEED +
                        "1 begincodespacerange" + LINE_FEED +
                        "<0000><FFFF>" + LINE_FEED +
                        "endcodespacerange" + LINE_FEED);
                    int currentindex = 0;
                    int nsize = 0;
                    while (currentindex < adata.CacheWidths.Count)
                    {
                        nsize = adata.CacheWidths.Count - currentindex;
                        if (nsize <= 0)
                            break;
                        if (nsize > 100)
                            nsize = 100;
                        cmaphead.Append(nsize.ToString() +
                            " beginbfchar" + LINE_FEED);
                        for (int idx = 0; idx < nsize; idx++)
                        {
                            char nkey = adata.CacheWidths.Keys[currentindex + idx];
                            int nvalue = adata.CacheWidths[nkey].Glyph;

                            string fromTo = "<" + PDFCanvas.IntToHex(nvalue) + "> ";
                            cmaphead.Append(fromTo + " <" + PDFCanvas.IntToHex((int)nkey) + ">" + LINE_FEED);
                        }
                        cmaphead.Append("endbfchar" + LINE_FEED);
                        currentindex = currentindex + nsize;
                    }
                    /*
										int currentindex = adata.FirstLoaded;
										int nextindex = adata.FirstLoaded;
										while (currentindex<=adata.LastLoaded)
										{
											index = currentindex;
											int aunicodecount = 0;
											while (index<=adata.LastLoaded)
											{
												nextindex = index;
												if (adata.Glyphs.IndexOfKey((char)index)>=0)
												{
													aunicodecount++;
													if (aunicodecount>=2)
														break;
												}
												index++;
											}
											if (aunicodecount>0)
											{
												cmaphead.Append(aunicodecount.ToString()+
													" beginbfchar"+LINE_FEED);
												for (index=currentindex;index<=nextindex;index++)
												{
													if (adata.Glyphs.IndexOfKey((char)index)>=0)
													{
														string fromTo = "<"+ PDFCanvas.IntToHex((int)adata.Glyphs[(char)index])+"> ";
														cmaphead.Append(fromTo+" <"+PDFCanvas.IntToHex((int)index)+">"+LINE_FEED);
													}
												}
												cmaphead.Append("endbfchar" +LINE_FEED);
											}
											currentindex = nextindex+1;
										}*/
                    cmaphead.Append("endcmap" + LINE_FEED +
                        "CMapName currentdict /CMap defineresource pop" + LINE_FEED +
                        "end end" + LINE_FEED);
                    FObjectCount = FObjectCount + 1;
                    adata.ToUnicodeIndex = FObjectCount;
                    FTempStream.SetLength(0);
                    SWriteLine(FTempStream, FObjectCount.ToString() + " 0 obj");
                    using (MemoryStream FCMapStream = new())
                    {
                        StreamUtil.WriteStringToStream(cmaphead.ToString(), FCMapStream, Encoding.ASCII);
                        FCMapStream.Seek(0, SeekOrigin.Begin);
                        SWriteLine(FTempStream, "<< ");
                        WriteStream(FCMapStream, FTempStream);
                    }
                    SWriteLine(FTempStream, "endobj");
                    AddToOffset(FTempStream.Length);
                    FTempStream.Seek(0, SeekOrigin.Begin);
                    FTempStream.WriteTo(FMainPDF);
                }
            }
            // Creates the fonts of the font list
            for (i = 0; i < Canvas.FontData.Count; i++)
            {
                adata = (TTFontData)Canvas.FontData.GetByIndex(i);
                if (adata.IsUnicode)
                {
                    FObjectCount = FObjectCount + 1;
                    FTempStream.SetLength(0);
                    adata.ObjectIndexParent = FObjectCount;
                    SWriteLine(FTempStream, FObjectCount.ToString() + " 0 obj");
                    SWriteLine(FTempStream, "<< /Type /Font");
                    SWriteLine(FTempStream, "/Subtype /Type0");
                    SWriteLine(FTempStream, "/Name /F" + adata.ObjectName);
                    SWriteLine(FTempStream, "/BaseFont /" + CONS_UNICODEPREDIX + adata.PostcriptName);
                    SWriteLine(FTempStream, "/Encoding /Identity-H");
                    SWriteLine(FTempStream, "/DescendantFonts [ " + (FObjectCount + 1).ToString() + " 0 R ]");
                    SWriteLine(FTempStream, "/ToUnicode " +
                                adata.ToUnicodeIndex.ToString() + " 0 R");

                    SWriteLine(FTempStream, ">>");
                    SWriteLine(FTempStream, "endobj");
                    AddToOffset(FTempStream.Length);
                    FTempStream.Seek(0, SeekOrigin.Begin);
                    FTempStream.WriteTo(FMainPDF);

                    FObjectCount = FObjectCount + 1;
                    FTempStream.SetLength(0);
                    SWriteLine(FTempStream, FObjectCount.ToString() + " 0 obj");
                    SWriteLine(FTempStream, "<< /Type /Font");
                    if (adata.Type1)
                        SWriteLine(FTempStream, "/Subtype /CIDFontType1");
                    else
                        SWriteLine(FTempStream, "/Subtype /CIDFontType2");
                    SWriteLine(FTempStream, "/BaseFont /" + CONS_UNICODEPREDIX + adata.PostcriptName);
                    SWriteLine(FTempStream, "/FontDescriptor " +
                        adata.DescriptorIndex.ToString() + " 0 R");
                    SWriteLine(FTempStream, "/FontFamily(" + adata.FontFamily + ")");
                    SWriteLine(FTempStream, "/CIDSystemInfo<</Ordering(Identity)/Registry(Adobe)/Supplement 0>>");
                    SWriteLine(FTempStream, "/DW 1000");
                    SWriteLine(FTempStream, "/W [");
                    awidths = "";
                    /*					index = adata.FirstLoaded;
										acount = 0;
										do
										{
											if (adata.Glyphs.IndexOfKey((char)index) >= 0)
											{
												awidths = awidths + adata.Glyphs[(char)index].ToString() + "[" + adata.Widths[(char)index].ToString() + "] ";
												acount = acount + 1;
												if ((acount % 8) == 7)
													awidths = awidths + LINE_FEED;
											}
											index++;
										}
										while (index <= adata.LastLoaded);
					 */
                    index = 0;
                    acount = 0;
                    while (index < adata.CacheWidths.Count)
                    {
                        char nkey = adata.CacheWidths.Keys[index];
                        int nvalue = adata.CacheWidths[nkey].Glyph;
                        double nwidth = adata.CacheWidths[nkey].Width;
                        awidths = awidths + nvalue.ToString() + "[" + nwidth.ToString("#0.0", NumberFormatInfo.InvariantInfo) + "] ";
                        acount++;
                        if ((acount % 8) == 7)
                            awidths = awidths + LINE_FEED;

                        index++;
                    }
                    SWriteLine(FTempStream, awidths);
                    SWriteLine(FTempStream, "]");
                    SWriteLine(FTempStream, "/CIDToGIDMap /Identity");

                    SWriteLine(FTempStream, ">>");
                    SWriteLine(FTempStream, "endobj");
                    AddToOffset(FTempStream.Length);
                    FTempStream.Seek(0, SeekOrigin.Begin);
                    FTempStream.WriteTo(FMainPDF);
                }
                else
                {
                    FObjectCount = FObjectCount + 1;
                    FTempStream.SetLength(0);
                    adata.ObjectIndexParent = FObjectCount;
                    SWriteLine(FTempStream, FObjectCount.ToString() + " 0 obj");
                    SWriteLine(FTempStream, "<< /Type /Font");
                    if (adata.Type1)
                        SWriteLine(FTempStream, "/Subtype /Type1");
                    else
                        SWriteLine(FTempStream, "/Subtype /TrueType");
                    SWriteLine(FTempStream, "/Name /F" + adata.ObjectName);
                    SWriteLine(FTempStream, "/BaseFont /" + adata.PostcriptName);
                    SWriteLine(FTempStream, "/FirstChar " + adata.FirstLoaded.ToString());
                    SWriteLine(FTempStream, "/LastChar " + adata.LastLoaded.ToString());
                    awidths = "[";
                    if (adata.LastLoaded > 0)
                    {
                        index = adata.FirstLoaded;
                        do
                        {
                            if (adata.Widths.IndexOfKey((char)index) >= 0)
                                awidths = awidths + adata.Widths[(char)index].ToString("#.0", NumberFormatInfo.InvariantInfo) + " ";
                            else
                                awidths = awidths + "0 ";
                            index++;
                            if ((index % 8) == 7)
                                awidths = awidths + LINE_FEED;
                        }
                        while (index <= adata.LastLoaded);
                        awidths = awidths + "]";
                        SWriteLine(FTempStream, "/Widths " + awidths);
                    }
                    SWriteLine(FTempStream, "/FontDescriptor " +
                        adata.DescriptorIndex.ToString() + " 0 R");
                    if (PDFConformance == PDFConformanceType.PDF_A_3)
                    {
                        SWriteLine(FTempStream, "/Encoding /Identity-H");
                    }
                    else
                    {
                        SWriteLine(FTempStream, "/Encoding /" + adata.Encoding);
                    }
                    SWriteLine(FTempStream, ">>");
                    SWriteLine(FTempStream, "endobj");
                    AddToOffset(FTempStream.Length);
                    FTempStream.Seek(0, SeekOrigin.Begin);
                    FTempStream.WriteTo(FMainPDF);
                }
            }
        }
        void StartStream()
        {
            // Starting of the stream
            FObjectCount = FObjectCount + 1;
            FTempStream.SetLength(0);

            if (PDFConformance == PDFConformanceType.PDF_A_3)
                PageObjNum = FObjectCount;
            else
                PageObjNum = FObjectCount;



            SWriteLine(FTempStream, FObjectCount.ToString() + " 0 obj");
            SWriteLine(FTempStream, "<< /Length " + (FObjectCount + 1).ToString() + " 0 R");
#if REPMAN_ZLIB
            if (Compressed)
                SWriteLine(FTempStream, "/Filter [/FlateDecode]");
#endif
            SWriteLine(FTempStream, " >>");
            SWriteLine(FTempStream, "stream");
            FSTempStream.SetLength(0);
        }
        void EndStream()
        {
            FSTempStream.Seek(0, System.IO.SeekOrigin.Begin);
            long StreamSize = FSTempStream.Length;
            long CurrentSize = FTempStream.Length;
#if REPMAN_ZLIB
            if (Compressed)
            {
                StreamUtil.CompressStream(FSTempStream, FTempStream, OptimizeSize);
                StreamSize = FTempStream.Length - CurrentSize;
            }
            else
#endif
                FSTempStream.WriteTo(FTempStream);

            FSTempStream.SetLength(0);
            SWriteLine(FTempStream, PDFCanvas.ENDSTREAM);
            SWriteLine(FTempStream, "endobj");
            AddToOffset(FTempStream.Length);
            FTempStream.Seek(0, SeekOrigin.Begin);
            FTempStream.WriteTo(FMainPDF);

            FObjectCount++;
            FTempStream.SetLength(0);
            SWriteLine(FTempStream, FObjectCount.ToString() + " 0 obj");
            SWriteLine(FTempStream, StreamSize.ToString());
            SWriteLine(FTempStream, "endobj");
            AddToOffset(FTempStream.Length);
            FTempStream.Seek(0, SeekOrigin.Begin);
            FTempStream.WriteTo(FMainPDF);
        }
        /// <summary>
        /// Encodes a string as a PDF string literal: an escaped parenthesized literal for pure ASCII text,
        /// or a UTF-16BE hexadecimal string with BOM otherwise.
        /// </summary>
        /// <param name="text">The text to encode; null is treated as empty.</param>
        /// <returns>The PDF string literal.</returns>
        public static string EncodePDFText(string text)
        {
            // Verificar si todos los caracteres son ASCII
            bool isASCII = true;
            if (text == null)
                text = "";
            foreach (char c in text)
            {
                if (c > 127)
                {
                    isASCII = false;
                    break;
                }
            }

            // Si todos los caracteres son ASCII, usar formato de cadena normal con paréntesis
            if (isASCII)
            {
                StringBuilder result = new("(");
                foreach (char c in text)
                {
                    // Escapar caracteres especiales
                    switch (c)
                    {
                        case '(':
                        case ')':
                        case '\\':
                            result.Append('\\').Append(c);
                            break;
                        default:
                            result.Append(c);
                            break;
                    }
                }
                result.Append(')');
                return result.ToString();
            }
            else
            {
                // Convertir a UTF-16BE
                byte[] utf16BEBytes = Encoding.BigEndianUnicode.GetBytes(text);

                // Crear el resultado en formato hexadecimal PDF: Comienza con el BOM UTF-16BE 0xFEFF
                StringBuilder hexString = new("<FEFF");

                // Convertir cada byte a su representación hexadecimal
                foreach (byte b in utf16BEBytes)
                {
                    // Formatear cada byte como hexadecimal de dos dígitos
                    hexString.Append(b.ToString("X2"));
                }

                // Cerrar la cadena en formato hexadecimal PDF
                hexString.Append('>');
                return hexString.ToString();
            }
        }
        /// <summary>
        /// Starts document generation: opens the output stream, writes the PDF header and initializes page state.
        /// </summary>
        public void BeginDoc()
        {
            if (FileName.Length == 0)
            {
                FMainPDF = new MemoryStream();
            }
            else
            {
                FMainPDF = new FileStream(FileName, FileMode.Create, FileAccess.ReadWrite);
            }

            const string PDF_HEADER_1_4 = "%PDF-1.4";
            const string PDF_HEADER_A3 = "%PDF-1.7";
            PageInfo aobj;

            FPageInfos.Clear();
            ImageIndexes.Clear();

            aobj = new PageInfo();
            aobj.PageWidth = PageWidth;
            aobj.PageHeight = PageHeight;
            FPageInfos.Add(aobj);

            FBitmapStreams.Clear();
            FPrinting = true;
            FMainPDF.SetLength(0);
            FObjectOffsets.Clear();
            FObjectCount = 0;
            FObjectOffset = 0;
            FPages.Clear();
            FFontList.Clear();
            FFontCount = 0;
            FCurrentSetPageObject = 0;
            ImageCount = 0;
            FPage = 1;
            FCanvas.PDFConformance = PDFConformance;
            // Writes the header
            if (PDFConformance == PDFConformanceType.PDF_1_4)
            {
                SWriteLine(FMainPDF, PDF_HEADER_1_4);
                AddToOffset(PDF_HEADER_1_4.Length);
            }
            else
            {
                SWriteLine(FMainPDF, PDF_HEADER_A3);
                byte[] checkArray = { 37, 228, 252, 246, 223, 13, 10 };
                FMainPDF.Write(checkArray, 0, 7);
                AddToOffset(7 + PDF_HEADER_A3.Length);
            }
            // Writes Doc info
            FObjectCount = FObjectCount + 1;
            FTempStream.SetLength(0);
            SWriteLine(FTempStream, FObjectCount.ToString() + " 0 obj");
            SWriteLine(FTempStream, "<<");
            SWriteLine(FTempStream, "/Producer " + EncodePDFText(DocProducer));
            SWriteLine(FTempStream, "/Author " + EncodePDFText(DocAuthor));
            if ((DocCreationDate == null) || (DocCreationDate.Length == 0))
            {
                SWriteLine(FTempStream, "/CreationDate (D:" + DateUtil.DateToISO8601(FInternalFDocCreationDate, false) + ")");
            }
            else
            {
                SWriteLine(FTempStream, "/CreationDate (D:" + DocCreationDate + ")");
            }
            if (PDFConformance != PDFConformanceType.PDF_A_3)
                SWriteLine(FTempStream, "/Creator " + EncodePDFText(DocCreator));
            if ((DocKeywords != null) && (DocKeywords.Length > 0))
                SWriteLine(FTempStream, "/Keywords " + EncodePDFText(DocKeywords));
            SWriteLine(FTempStream, "/Subject " + EncodePDFText(DocSubject));
            SWriteLine(FTempStream, "/Title " + EncodePDFText(DocTitle));
            if ((DocModificationDate == null) || (DocModificationDate.Length == 0))
            {
                // SWriteLine(FTempStream,'/ModDate (D:'+  DateToISO8601(FInternalFDocCreationDate)+')');
            }
            else
            {
                // SWriteLine(FTempStream,'/ModDate (D:'+  FDocModificationDate+')');
            }
            if (PDFConformance == PDFConformanceType.PDF_A_3)
            {
                SWriteLine(FTempStream, "/GTS_PDFXVersion (PDF/A-3B)");
            }
            SWriteLine(FTempStream, ">>");
            SWriteLine(FTempStream, "endobj");
            AddToOffset(FTempStream.Length);
            FTempStream.Seek(0, SeekOrigin.Begin);
            FTempStream.WriteTo(FMainPDF);

            if (PDFConformance == PDFConformanceType.PDF_A_3)
            {
                SetXMPMetadata();
                SetColorSpace();
            }
            StartStream();
        }
        private void SetXMPMetadata()
        {
            using (var xmpStream = new MemoryStream())
            {
                try
                {
                    // Escribir las líneas iniciales de XMP Metadata
                    SWriteLine(xmpStream, "<?xpacket begin=\"\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>");
                    SWriteLine(xmpStream, "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\">");
                    SWriteLine(xmpStream, "<rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\"");
                    SWriteLine(xmpStream, "    xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\"");
                    SWriteLine(xmpStream, "    xmlns:pdf=\"http://ns.adobe.com/pdf/1.3/\"");
                    SWriteLine(xmpStream, "    xmlns:dc=\"http://purl.org/dc/elements/1.1/\"");
                    SWriteLine(xmpStream, "    xmlns:xmpMM=\"http://ns.adobe.com/xap/1.0/mm/\"");
                    SWriteLine(xmpStream, "    xmlns:pdfaid=\"http://www.aiim.org/pdfa/ns/id/\">");
                    SWriteLine(xmpStream, "  <rdf:Description rdf:about=\"\">");

                    // Autor
                    SWriteLine(xmpStream, "    <dc:creator>");
                    SWriteLine(xmpStream, "      <rdf:Seq>");
                    SWriteLine(xmpStream, "        <rdf:li>" + StringUtil.EscapeXML(DocAuthor) + "</rdf:li>");
                    SWriteLine(xmpStream, "      </rdf:Seq>");
                    SWriteLine(xmpStream, "    </dc:creator>");

                    // Título
                    SWriteLine(xmpStream, "    <dc:title>");
                    SWriteLine(xmpStream, "      <rdf:Alt>");
                    SWriteLine(xmpStream, "        <rdf:li xml:lang=\"x-default\">" + StringUtil.EscapeXML(DocTitle) + "</rdf:li>");
                    SWriteLine(xmpStream, "      </rdf:Alt>");
                    SWriteLine(xmpStream, "    </dc:title>");

                    // Palabras clave
                    if (!string.IsNullOrEmpty(DocKeywords))
                    {
                        SWriteLine(xmpStream, "    <dc:subject>");
                        SWriteLine(xmpStream, "      <rdf:Bag>");
                        var keywords = DocKeywords.Split(',');
                        foreach (var keyword in keywords)
                        {
                            SWriteLine(xmpStream, "        <rdf:li>" + StringUtil.EscapeXML(keyword.Trim()) + "</rdf:li>");
                        }
                        SWriteLine(xmpStream, "      </rdf:Bag>");
                        SWriteLine(xmpStream, "    </dc:subject>");
                    }

                    // Descripción
                    SWriteLine(xmpStream, "    <dc:description>");
                    SWriteLine(xmpStream, "      <rdf:Alt>");
                    SWriteLine(xmpStream, "        <rdf:li xml:lang=\"x-default\">" + StringUtil.EscapeXML(DocSubject) + "</rdf:li>");
                    SWriteLine(xmpStream, "      </rdf:Alt>");
                    SWriteLine(xmpStream, "    </dc:description>");

                    // Fecha de creación
                    if (string.IsNullOrEmpty(DocCreationDate))
                    {
                        SWriteLine(xmpStream, "    <xmp:CreateDate>" + DateUtil.DateToISO8601(FInternalFDocCreationDate, false) + "</xmp:CreateDate>");
                    }
                    else
                    {
                        SWriteLine(xmpStream, "    <xmp:CreateDate>" + StringUtil.EscapeXML(DocCreationDate) + "</xmp:CreateDate>");
                    }

                    // Productor
                    if (!string.IsNullOrEmpty(DocProducer))
                    {
                        SWriteLine(xmpStream, "    <xmp:CreatorTool>" + StringUtil.EscapeXML(DocProducer) + "</xmp:CreatorTool>");
                    }

                    // Otros metadatos
                    SWriteLine(xmpStream, "    <pdfaid:part>3</pdfaid:part>");
                    SWriteLine(xmpStream, "    <pdfaid:conformance>B</pdfaid:conformance>");

                    // Contenido XMP adicional
                    if (!string.IsNullOrEmpty(DocXMPContent))
                    {
                        SWriteLine(xmpStream, DocXMPContent);
                    }

                    // Cerrar la descripción RDF
                    SWriteLine(xmpStream, "  </rdf:Description>");
                    SWriteLine(xmpStream, "</rdf:RDF>");
                    SWriteLine(xmpStream, "</x:xmpmeta>");
                    SWriteLine(xmpStream, "<?xpacket end=\"w\"?>");

                    xmpStream.Seek(0, SeekOrigin.Begin);

                    // Crear el objeto PDF de metadatos
                    FObjectCount++;
                    FXMPMetadataObject = FObjectCount;
                    FTempStream.SetLength(0);
                    SWriteLine(FTempStream, $"{FObjectCount} 0 obj");
                    SWriteLine(FTempStream, "<< /Type /Metadata");
                    SWriteLine(FTempStream, "   /Subtype /XML");
                    SWriteLine(FTempStream, "   /Length " + (xmpStream.Length - 1));
                    SWriteLine(FTempStream, ">>");
                    SWriteLine(FTempStream, "stream");

                    StreamUtil.WriteTo(xmpStream, FTempStream);

                    SWriteLine(FTempStream, "endstream");
                    SWriteLine(FTempStream, "endobj");

                    AddToOffset((int)FTempStream.Length);
                    FTempStream.Seek(0, SeekOrigin.Begin);
                    StreamUtil.WriteTo(FTempStream, FMainPDF);
                }
                finally
                {
                    xmpStream.Close();
                }
            }
        }
        private void WriteStream(Stream stream, Stream dest)
        {
#if REPMAN_ZLIB
            if (Compressed)
            {
                MemoryStream fmem = new();
                try
                {
                    StreamUtil.CompressStream(stream, fmem);
                    SWriteLine(dest, " /Length " + fmem.Length.ToString() + " /Length1 " +
                      stream.Length.ToString());
                    SWriteLine(dest, "/Filter [/FlateDecode]");
                    SWriteLine(dest, ">>");
                    SWriteLine(dest, "stream");
                    fmem.Seek(0, SeekOrigin.Begin);
                    StreamUtil.WriteTo(fmem, dest);
                }
                finally
                {
                    fmem.Dispose();
                }
            }
            else
#endif
            {
                SWriteLine(dest, " /Length " + stream.Length.ToString());
                SWriteLine(dest, ">>");
                SWriteLine(dest, "stream");
                stream.Seek(0, SeekOrigin.Begin);
                StreamUtil.WriteTo(stream, dest);
            }
            SWriteLine(dest, "");
            SWriteLine(dest, "endstream");
        }

        private void SetColorSpace()
        {
            long ColorProfileObject;
            Stream ResICCProfile = Translator.FindAssemblyResource("Reportman.Drawing.Resources.sRGB.icm");
            ResICCProfile.Seek(0, SeekOrigin.Begin);
            MemoryStream ICCProfile = StreamUtil.StreamToMemoryStream(ResICCProfile);
            try
            {
                FObjectCount++;
                ColorProfileObject = FObjectCount;
                FTempStream.SetLength(0);
                SWriteLine(FTempStream, FObjectCount.ToString() + " 0 obj");
                ICCProfile.Seek(0, SeekOrigin.Begin);
                SWriteLine(FTempStream, "<< /N 3 /Alternate /DeviceRGB ");
                WriteStream(ICCProfile, FTempStream);
                SWriteLine(FTempStream, "endobj");
                AddToOffset(FTempStream.Length);
                FTempStream.Seek(0, SeekOrigin.Begin);
                StreamUtil.WriteTo(FTempStream, FMainPDF);
            }
            finally
            {
                ICCProfile.Dispose();
            }

            // Output Intent
            FObjectCount++;
            FOutputIntentObject = FObjectCount;
            FTempStream.SetLength(0);
            SWriteLine(FTempStream, FObjectCount.ToString() + " 0 obj");
            SWriteLine(FTempStream, "<< /Type /OutputIntent");
            SWriteLine(FTempStream, "  /S /GTS_PDFA1");
            SWriteLine(FTempStream, "  /OutputConditionIdentifier (sRGB IEC61966-2.1) ");
            SWriteLine(FTempStream, "  /Info (sRGB IEC61966-2.1) ");
            SWriteLine(FTempStream, "  /DestOutputProfile " + ColorProfileObject.ToString() + " 0 R");
            SWriteLine(FTempStream, ">>");
            SWriteLine(FTempStream, "endobj");
            AddToOffset(FTempStream.Length);
            FTempStream.Seek(0, SeekOrigin.Begin);
            StreamUtil.WriteTo(FTempStream, FMainPDF);

            // Color Space
            FObjectCount++;
            FColorSpaceObject = FObjectCount;
            FTempStream.SetLength(0);
            SWriteLine(FTempStream, FObjectCount.ToString() + " 0 obj");
            SWriteLine(FTempStream, "<<  /Type /ColorSpace");
            SWriteLine(FTempStream, "    /ColorSpace [/ICCBased " + ColorProfileObject.ToString() + " 0 R] >>");
            SWriteLine(FTempStream, "endobj");
            AddToOffset(FTempStream.Length);
            FTempStream.Seek(0, SeekOrigin.Begin);
            StreamUtil.WriteTo(FTempStream, FMainPDF);
        }
        private void WriteEmbeddedFiles()
        {
            long ResourceStream;
            foreach (var efile in EmbeddedFiles)
            {
                FObjectCount++;
                ResourceStream = FObjectCount;
                FTempStream.SetLength(0);
                SWriteLine(FTempStream, FObjectCount.ToString() + " 0 obj");
                SWriteLine(FTempStream, "<< /Type /EmbeddedFile ");
                if ((efile.MimeType != null) && (efile.MimeType.Length > 0))
                {
                    SWriteLine(FTempStream, "   /Subtype /" + efile.MimeType.Replace("/", "#2F"));
                    SWriteLine(FTempStream, "   /MimeType " + EncodePDFText(efile.MimeType));
                }
                if (efile.ModificationDate.Length > 0)
                {
                    SWriteLine(FTempStream, "   /Params <<");
                    SWriteLine(FTempStream, "   /ModDate (D:" + (efile.ModificationDate) + ")");
                    SWriteLine(FTempStream, "   >>");
                }
                efile.Stream.Seek(0, SeekOrigin.Begin);
                WriteStream(efile.Stream, FTempStream);
                SWriteLine(FTempStream, "endobj");
                AddToOffset(FTempStream.Length);
                FTempStream.Seek(0, SeekOrigin.Begin);
                StreamUtil.WriteTo(FTempStream, FMainPDF);

                FObjectCount++;
                efile.ResourceNumber = FObjectCount;
                FTempStream.SetLength(0);
                SWriteLine(FTempStream, FObjectCount.ToString() + " 0 obj");
                SWriteLine(FTempStream, "<< /Type /Filespec ");
                SWriteLine(FTempStream, "   /F " + EncodePDFText(efile.FileName));

                SWriteLine(FTempStream, "   /Desc " + EncodePDFText(efile.Description));
                SWriteLine(FTempStream, "   /UF " + EncodePDFText(efile.FileName));
                SWriteLine(FTempStream, "   /EF << /F " + ResourceStream.ToString() + " 0 R >>");

                SWriteLine(FTempStream, "   /AFRelationship /" + efile.AFRelationShipToString());
                SWriteLine(FTempStream, "/Params <<");
                SWriteLine(FTempStream, "  /Size " + efile.Stream.Length.ToString());
                if ((efile.MimeType != null) && (efile.MimeType.Length > 0))
                {
                    SWriteLine(FTempStream, "  /MIMEType " + EncodePDFText(efile.MimeType));
                }
                if ((efile.CreationDate != null) && (efile.CreationDate.Length > 0))
                {
                    SWriteLine(FTempStream, "  /CreationDate (D:" + efile.CreationDate + ")");
                }
                if ((efile.ModificationDate != null) && (efile.ModificationDate.Length > 0))
                {
                    SWriteLine(FTempStream, "  /ModificationDate (D:" + efile.ModificationDate + ")");
                }

                SWriteLine(FTempStream, "  >>");
                SWriteLine(FTempStream, ">>");
                SWriteLine(FTempStream, "endobj");
                AddToOffset(FTempStream.Length);
                FTempStream.Seek(0, SeekOrigin.Begin);
                StreamUtil.WriteTo(FTempStream, FMainPDF);
            }
        }

        /// <summary>
        /// Finalizes the current page's content stream and begins a new page with the given size.
        /// </summary>
        /// <param name="NPageWidth">Width of the new page in resolution units.</param>
        /// <param name="NPageHeight">Height of the new page in resolution units.</param>
        public void NewPage(int NPageWidth, int NPageHeight)
        {
            PageInfo aobj;

            CheckPrinting();

            PageWidth = NPageWidth;
            PageHeight = NPageHeight;
            aobj = new PageInfo();
            aobj.PageWidth = NPageWidth;
            aobj.PageHeight = NPageHeight;
            FPageInfos.Add(aobj);

            FPage = FPage + 1;

            FSTempStream.Seek(0, System.IO.SeekOrigin.Begin);
            long StreamSize = FSTempStream.Length;
            long CurrentSize = FTempStream.Length;
#if REPMAN_ZLIB
            if (Compressed)
            {
                StreamUtil.CompressStream(FSTempStream, FTempStream, OptimizeSize);
                StreamSize = FTempStream.Length - CurrentSize;
            }
            else
#endif
                FSTempStream.WriteTo(FTempStream);

            FSTempStream.SetLength(0);
            SWriteLine(FTempStream, PDFCanvas.ENDSTREAM);
            SWriteLine(FTempStream, "endobj");
            AddToOffset(FTempStream.Length);
            FTempStream.Seek(0, SeekOrigin.Begin);
            FTempStream.WriteTo(FMainPDF);
            FObjectCount = FObjectCount + 1;
            FTempStream.SetLength(0);
            SWriteLine(FTempStream, FObjectCount.ToString() + " 0 obj");
            SWriteLine(FTempStream, StreamSize.ToString());
            SWriteLine(FTempStream, "endobj");
            AddToOffset(FTempStream.Length);
            FTempStream.Seek(0, SeekOrigin.Begin);
            FTempStream.WriteTo(FMainPDF);

            FObjectCount = FObjectCount + 1;
            FTempStream.SetLength(0);
            SWriteLine(FTempStream, (FObjectCount).ToString() + " 0 obj");
            SWriteLine(FTempStream, "<< /Length " + (FObjectCount + 1).ToString() + " 0 R");
#if REPMAN_ZLIB
            if (Compressed)
                SWriteLine(FTempStream, "/Filter [/FlateDecode]");
#endif
            SWriteLine(FTempStream, " >>");
            SWriteLine(FTempStream, "stream");
        }
        void SetArray()
        {
            int i;
            TTFontData adata;
            FObjectCount = FObjectCount + 1;
            FResourceNum = FObjectCount;
            FTempStream.SetLength(0);
            SWriteLine(FTempStream, FObjectCount.ToString() + " 0 obj");
            if (PDFConformance == PDFConformanceType.PDF_A_3)
                SWriteLine(FTempStream, "<< /ProcSet [/PDF]");
            else
                SWriteLine(FTempStream, "<< /ProcSet [ /PDF /Text /ImageC]");
            if (ImageCount > 0)
            {
                SWriteLine(FTempStream, "/XObject << ");
                for (i = 1; i <= ImageCount; i++)
                {
                    if (!Masks.ContainsKey(i - 1))
                    {
                        SWriteLine(FTempStream, "/Im" + i.ToString() + " " + (FObjectCount + i).ToString() + " 0 R");
                    }
                }
                SWriteLine(FTempStream, ">>");
            }
            SWriteLine(FTempStream, "/Font << ");

            for (i = 1; i <= FFontCount; i++)
                SWriteLine(FTempStream, "/F" + i.ToString() + " " + FFontList[i - 1] + " 0 R ");
            for (i = 0; i < Canvas.FontData.Count; i++)
            {
                adata = (TTFontData)Canvas.FontData.GetByIndex(i);
                SWriteLine(FTempStream, "/F" + adata.ObjectName +
                    " " + adata.ObjectIndexParent.ToString() + " 0 R ");
            }
            SWriteLine(FTempStream, ">>");


            if (PDFConformance == PDFConformanceType.PDF_A_3)
            {
                SWriteLine(FTempStream, "/ColorSpace << ");
                SWriteLine(FTempStream, "     /CS1 " + FColorSpaceObject.ToString() + " 0 R");
                SWriteLine(FTempStream, "  >>");
            }


            SWriteLine(FTempStream, ">>");
            SWriteLine(FTempStream, "endobj");
            AddToOffset(FTempStream.Length);
            FTempStream.Seek(0, SeekOrigin.Begin);
            FTempStream.WriteTo(FMainPDF);
        }
        private void WaitCompressionTasks()
        {
            if (CompressionTasks.Count == 0)
                return;
            List<System.Threading.Tasks.Task> tasks = new();
            foreach (var comp in CompressionTasks)
            {
                tasks.Add(comp.Task);
                comp.Task.ConfigureAwait(false);
            }
            System.Threading.Tasks.Task.WaitAll(tasks.ToArray());
            foreach (var comp in CompressionTasks)
            {
                if (comp.Task.Exception != null)
                {
                    throw new Exception("Error compressing image: " + comp.Task.Exception.Message);
                }
                string stringLength = comp.Task.Result.CompressedBytes.ToString();
                byte[] bytesLength = ASCIIEncoding.ASCII.GetBytes(stringLength.ToString());
                comp.PositionStream.Seek(comp.StreamPosition, SeekOrigin.Begin);
                comp.PositionStream.Write(bytesLength, 0, bytesLength.Length);
                comp.PositionStream.Seek(0, SeekOrigin.Begin);
            }
        }
        /// <summary>
        /// Completes the document: writes fonts, annotations, pages, images, catalog and cross-reference table,
        /// then flushes and closes the output.
        /// </summary>
        public void EndDoc()
        {
            int i;
            CheckPrinting();
            FPrinting = false;
            // Writes the trailing zone
            EndStream();
            SetOutLine();
            SetFontType();
            AddAnnotations();
            SetPages();
            SetArray();
            // Wait for tasks
            WaitCompressionTasks();
            for (i = 1; i <= ImageCount; i++)
            {
                WriteBitmap(i);
            }
            for (i = 1; i <= FPage; i++)
            {
                SetPageObject(i);
            }
            WriteEmbeddedFiles();
            SetCatalog();
            SetXref();
            SWriteLine(FMainPDF, "%%EOF");

            // Save to disk if filename assigned
            if (FMainPDF is FileStream)
            {
                ((System.IO.FileStream)FMainPDF).Close();
                FMainPDF = null;
            }
            else
                FMainPDF.Seek(0, System.IO.SeekOrigin.Begin);
            FBitmapStreams.Clear();
        }
        void SetCatalog()
        {
            FObjectCount = FObjectCount + 1;
            FCatalogNum = FObjectCount;
            FTempStream.SetLength(0);
            SWriteLine(FTempStream, FObjectCount.ToString() + " 0 obj");
            SWriteLine(FTempStream, "<< /Type /Catalog");
            SWriteLine(FTempStream, "/Pages " + FParentNum.ToString() + " 0 R");
            SWriteLine(FTempStream, "/Outlines " + FOutlinesNum.ToString() + " 0 R");

            if (PDFConformance == PDFConformanceType.PDF_A_3)
            {
                SWriteLine(FTempStream, "/Metadata " + FXMPMetadataObject.ToString() + " 0 R");
                SWriteLine(FTempStream, "/OutputIntents [" + FOutputIntentObject.ToString() + " 0 R]");
                if (EmbeddedFiles.Count > 0)
                {
                    string files = "[";
                    string resources = "[";
                    foreach (var efile in EmbeddedFiles)
                    {
                        files = files + EncodePDFText(efile.FileName) + " " + efile.ResourceNumber.ToString()
                            + " 0 R";
                        resources = resources + " " + efile.ResourceNumber.ToString() + " 0 R";
                    }
                    files = files + "]";
                    resources = resources + "]";
                    SWriteLine(FTempStream, "/Names <<");
                    SWriteLine(FTempStream, "  /EmbeddedFiles << /Names " + files + " >>");
                    SWriteLine(FTempStream, ">>");
                    // /AF << /Names [ (pdfa_validation1.xml) 18 0 R (cajass.png) 20 0 R] >>
                    //    SWriteLine(FTempStream,'/AF << /Names '+ files + ' >> ');
                    SWriteLine(FTempStream, "/AF " + resources);
                }
            }


            SWriteLine(FTempStream, ">>");
            SWriteLine(FTempStream, "endobj");
            AddToOffset(FTempStream.Length);
            FTempStream.Seek(0, SeekOrigin.Begin);
            FTempStream.WriteTo(FMainPDF);
        }
        string GetOffsetNumber(string offset)
        {
            long x, y;
            x = offset.Length;
            string aresult = "";
            for (y = 1; y <= 10 - x; y++)
                aresult = aresult + "0";
            aresult = aresult + offset;
            return aresult;
        }
        void SetXref()
        {
            int i;
            FObjectCount = FObjectCount + 1;
            FTempStream.SetLength(0);
            SWriteLine(FTempStream, "xref");
            SWriteLine(FTempStream, "0 " + FObjectCount.ToString());
            SWriteLine(FTempStream, "0000000000 65535 f");

            for (i = 0; i <= FObjectCount - 2; i++)
                SWriteLine(FTempStream, GetOffsetNumber(FObjectOffsets[i].ToString()) + " 00000 n");

            SWriteLine(FTempStream, "trailer");
            SWriteLine(FTempStream, "<< /Size " + FObjectCount.ToString());
            SWriteLine(FTempStream, "/Root " + FCatalogNum.ToString() + " 0 R");
            SWriteLine(FTempStream, "/Info 1 0 R");
            if (PDFConformance == PDFConformanceType.PDF_A_3)
            {
                string guidString = Guid.NewGuid().ToString();
                guidString = guidString.Replace("-", "");
                SWriteLine(FTempStream, "/ID [<" + guidString + "> <1234567890abcdef1234567890abcdef>]");
            }
            SWriteLine(FTempStream, ">>");
            SWriteLine(FTempStream, "startxref");
            SWriteLine(FTempStream, FMainPDF.Length.ToString());
            FTempStream.Seek(0, SeekOrigin.Begin);
            FTempStream.WriteTo(FMainPDF);
        }
        void AddAnnotations()
        {
            foreach (var annPage in PageAnnotations.Keys)
            {
                foreach (var annotation in PageAnnotations[annPage])
                {
                    FTempStream.SetLength(0);
                    FObjectCount = FObjectCount + 1;

                    annotation.StreamNumber = FObjectCount;
                    SWriteLine(FTempStream, FObjectCount.ToString() + " 0 obj");
                    SWriteLine(FTempStream, "<< /Type /Annot");
                    string anot = annotation.Annotation;
                    if (anot.Length > 4 && anot.Substring(0, 4).ToUpper() == "URL:")
                    {
                        SWriteLine(FTempStream, "   /Subtype /Link");
                        anot = anot.Substring(4, anot.Length - 4);
                        string coords = Canvas.UnitsToTextX(annotation.PosX) + " " + Canvas.UnitsToTextY(annotation.PosY + annotation.Height) +
                          " " + Canvas.UnitsToTextX(annotation.PosX + annotation.Width)
                          + " " + Canvas.UnitsToTextY(annotation.PosY);
                        SWriteLine(FTempStream, "   /Rect [" + coords + "]");
                        SWriteLine(FTempStream, "   /A << /Type /Action");
                        SWriteLine(FTempStream, "        /S /URI");
                        SWriteLine(FTempStream, "        /URI " + EncodePDFText(anot));
                        SWriteLine(FTempStream, "   >>");
                    }
                    else
                    {
                        SWriteLine(FTempStream, "   /Subtype /Text");
                        string coords = Canvas.UnitsToTextX(annotation.PosX) + " " + Canvas.UnitsToTextY(annotation.PosY + annotation.Height) +
                          " " + Canvas.UnitsToTextX(annotation.PosX + annotation.Width)
                          + " " + Canvas.UnitsToTextY(annotation.PosY);
                        SWriteLine(FTempStream, "   /Rect [" + coords + "]");
                        SWriteLine(FTempStream, "   /Contents " + EncodePDFText(anot));
                        SWriteLine(FTempStream, "   /Open false");
                        SWriteLine(FTempStream, "   /C [1 1 0]");
                    }
                    SWriteLine(FTempStream, ">>");
                    AddToOffset(FTempStream.Length);
                    FTempStream.WriteTo(FMainPDF);
                }
            }

        }
        void SetPageObject(int index)
        {
            PageInfo aobj;

            aobj = FPageInfos[index - 1];


            StringBuilder annotationsString = new();
            if (PageAnnotations.ContainsKey(index))
            {
                foreach (var annotation in PageAnnotations[index])
                {
                    if (annotationsString.Length == 0)
                    {
                        annotationsString.Append("[");
                    }
                    else
                    {
                        annotationsString.Append(" ");
                    }

                    annotationsString.Append(annotation.StreamNumber.ToString() + " 0 R");
                }
            }
            FObjectCount = FObjectCount + 1;
            FTempStream.SetLength(0);
            SWriteLine(FTempStream, FObjectCount.ToString() + " 0 obj");
            SWriteLine(FTempStream, "<< /Type /Page");
            SWriteLine(FTempStream, "/Parent " + FParentNum.ToString() + " 0 R");
            SWriteLine(FTempStream, "/MediaBox [ 0 0 " +
                FCanvas.UnitsToTextX(aobj.PageWidth) + " " + FCanvas.UnitsToTextX(aobj.PageHeight) + "]");
            SWriteLine(FTempStream, "/Contents " + FPages[FCurrentSetPageObject] + " 0 R");
            SWriteLine(FTempStream, "/Resources " + FResourceNum.ToString() + " 0 R");
            if (annotationsString.Length > 0)
            {
                annotationsString.Append("]");
                SWriteLine(FTempStream, "/Annots " + annotationsString.ToString());
            }
            SWriteLine(FTempStream, ">>");
            SWriteLine(FTempStream, "endobj");
            AddToOffset(FTempStream.Length);
            FTempStream.Seek(0, SeekOrigin.Begin);
            FTempStream.WriteTo(FMainPDF);
            FCurrentSetPageObject = FCurrentSetPageObject + 1;
        }

        void WriteBitmap(int index)
        {
            if (!CalculateOnly)
            {
                FObjectCount = FObjectCount + 1;
                FTempStream.SetLength(0);
                string resIndex = FObjectCount.ToString();
                SWriteLine(FTempStream, resIndex + " 0 obj");
                if (Masks.ContainsKey(index))
                {
                    string resIndex2 = (FObjectCount + 1).ToString();
                    byte[] bytesIndex = ASCIIEncoding.ASCII.GetBytes(resIndex2);
                    var streamPos = Masks[index];
                    streamPos.Stream.Seek(streamPos.Position, SeekOrigin.Begin);
                    streamPos.Stream.Write(bytesIndex, 0, bytesIndex.Length);
                    streamPos.Stream.Seek(0, SeekOrigin.Begin);
                }
                FBitmapStreams[index - 1].WriteTo(FTempStream);
                SWriteLine(FTempStream, PDFCanvas.ENDSTREAM);
                SWriteLine(FTempStream, "endobj");
                AddToOffset(FTempStream.Length);
                FTempStream.Seek(0, SeekOrigin.Begin);
                FTempStream.WriteTo(FMainPDF);
            }
        }
    }
    /// <summary>
    /// Pairs a stream with a byte offset, used to remember where a value must later be
    /// patched back into the PDF output.
    /// </summary>
    public class StreamPosition
    {
        /// <summary>
        /// The stream that holds the value to be patched.
        /// </summary>
        public Stream Stream;
        /// <summary>
        /// Byte offset within the stream where the value must be written.
        /// </summary>
        public long Position;
        /// <summary>
        /// Initializes a stream/position pair.
        /// </summary>
        /// <param name="astream">The target stream.</param>
        /// <param name="aposition">The byte offset within the stream.</param>
        public StreamPosition(System.IO.Stream astream, long aposition)
        {
            Stream = astream;
            Position = aposition;
        }
    }
    /// <summary>
    /// Tracks an asynchronous stream-compression operation, holding its task, cancellation
    /// source, and the output stream position where the compressed result will be written.
    /// </summary>
    public class CompressionTask
    {
        /// <summary>
        /// Initializes a compression task with its worker task, cancellation source and output patch position.
        /// </summary>
        /// <param name="nTask">The running compression task producing the compressed byte count.</param>
        /// <param name="nCancelSource">Cancellation source used to abort the task.</param>
        /// <param name="nPositionStream">Output stream whose length placeholder will be patched.</param>
        /// <param name="nStreamPosition">Byte offset in the output stream where the compressed length is written.</param>
        public CompressionTask(System.Threading.Tasks.Task<TaskCompressResult> nTask, CancellationTokenSource nCancelSource, Stream nPositionStream, long nStreamPosition)
        {
            Task = nTask;
            CancelSource = nCancelSource;
            PositionStream = nPositionStream;
            StreamPosition = nStreamPosition;
        }
        /// <summary>
        /// The running task that compresses the stream and reports the compressed byte count.
        /// </summary>
        public System.Threading.Tasks.Task<TaskCompressResult> Task;
        /// <summary>
        /// Cancellation source used to abort the compression task.
        /// </summary>
        public CancellationTokenSource CancelSource;
        /// <summary>
        /// Output stream whose length placeholder is patched with the compressed size.
        /// </summary>
        public Stream PositionStream;
        /// <summary>
        /// Byte offset in the output stream where the compressed length value is written.
        /// </summary>
        public long StreamPosition;
        /// <summary>
        /// Requests cancellation of the compression task if it is still running.
        /// </summary>
        public void CancelTask()
        {
            if (CancelSource != null)
            {
                CancelSource.Cancel();
            }
        }
    }
}
