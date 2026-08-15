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
 *     language  rights and limitations.
 *
 *  Copyright (c) 1994 - 2008 Toni Martir (toni@reportman.es)
 *  All Rights Reserved.
*/
#endregion

using System;
using System.IO;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;
using FreeTypeSharp;
using System.Text;
using System.Diagnostics;
using Icu;
using HarfBuzzSharp;

namespace Reportman.Drawing
{
    /// <summary>
    /// Holds the FreeType face handle and cached metrics (family, style, ascent/descent, bounding box,
    /// kerning and other attributes) for a single font file, and lazily opens the FreeType face on demand.
    /// </summary>
    unsafe public class  LogFontFt
    {
        /// <summary>True when the font is fixed-pitch (monospaced).</summary>
        public bool fixedpitch;
        /// <summary>PostScript name of the font (family name with spaces removed).</summary>
        public string postcriptname;
        /// <summary>Font family name as reported by FreeType.</summary>
        public string familyname;
        /// <summary>Font style name (for example "Bold" or "Italic").</summary>
        public string stylename;
        /// <summary>True when the font carries the italic style flag.</summary>
        public bool italic;
        /// <summary>True when the font carries the bold style flag.</summary>
        public bool bold;
        /// <summary>Full path of the font file on disk.</summary>
        public string filename;
        /// <summary>Ascent metric scaled to 1000 units per em.</summary>
        public int ascent;
        /// <summary>Descent metric scaled to 1000 units per em (negative below the baseline).</summary>
        public int descent;
        /// <summary>Line height metric scaled to 1000 units per em.</summary>
        public int height;
        /// <summary>Font weight value.</summary>
        public int weight;
        /// <summary>Maximum glyph advance width scaled to 1000 units per em.</summary>
        public int MaxWidth;
        /// <summary>Average character width scaled to 1000 units per em.</summary>
        public int avCharWidth;
        /// <summary>Cap height scaled to 1000 units per em.</summary>
        public int Capheight;
        /// <summary>Italic angle of the font in degrees.</summary>
        public double ItalicAngle;
        /// <summary>Leading (line gap) scaled to 1000 units per em.</summary>
        public int leading;
        /// <summary>Font bounding box scaled to 1000 units per em.</summary>
        public Rectangle BBox;
        /// <summary>True once the full metric information for the font has been loaded.</summary>
        public bool fullinfo;
        /// <summary>Vertical stem width used for PDF font descriptors.</summary>
        public double StemV;
        /// <summary>Native FreeType face handle, valid after <see cref="OpenFont"/> has run.</summary>
        public FT_FaceRec_* ftface;
        /// <summary>True once the FreeType face has been opened.</summary>
        public bool faceinit;
        /// <summary>True when the font provides kerning information.</summary>
        public bool havekerning;
        /// <summary>True when the font is a Type 1 (non-SFNT) font.</summary>
        public bool type1;
        /// <summary>Multiplier applied to raw glyph widths.</summary>
        public double widthmult = 1;
        /// <summary>Conversion factor from font design units to 1000 units per em (1000 / unitsPerEM).</summary>
        public double convfactor = 1;
        /// <summary>Multiplier applied to raw height values.</summary>
        public double heightmult = 1;
        /// <summary>Unique key that identifies this font by family, bold and italic flags.</summary>
        public string keyname;
        /// <summary>Native FreeType library handle used to open the face.</summary>
        public FT_LibraryRec_* ftlibrary;
        /// <summary>Path of the associated kerning/AFM file, or an empty string when none.</summary>
        public string kerningfile;
        /// <summary>Shared cache of opened FreeType faces, keyed by font file and face index.</summary>
        public static SortedList<string,IntPtr> FontFaces = new SortedList<string,IntPtr>();
        /// <summary>Index of the face within the font file.</summary>
        public int iface;
        /// <summary>True when the font has scalable outlines; a bitmap-only face has nothing to embed in a PDF.</summary>
        public bool scalable;
        /// <summary>Index of the face to open inside the font file, as fontconfig reports it.</summary>
        public int faceIndex;
        /// <summary>Initializes a new instance with an empty kerning file and a zero face index.</summary>
        public LogFontFt()
        {
            kerningfile = "";
            iface = 0;
            faceIndex = 0;
        }
        /// <summary>Releases resources held by the font. Currently a no-op because faces are shared and cached.</summary>
        public void Dispose()
        {
        }
        /// <summary>Lazily opens the FreeType face for this font, reusing a cached face when available and attaching the AFM kerning file for Type 1 fonts.</summary>
        public void OpenFont()
        {
            if (faceinit)
                return;
            Monitor.Enter(FontInfoFt.flag);
            try
            {
                if (faceinit)
                    return;
                // The cache is keyed by file and face index, not by family name. With fontconfig
                // resolving every request on its own, two different files can perfectly well come
                // back with the same family, bold and italic combination, and the loser used to
                // end up marked as opened with no face behind it.
                string facekey = filename + "|" + faceIndex.ToString(CultureInfo.InvariantCulture);
                if (FontFaces.IndexOfKey(facekey) >= 0)
                {
                    ftface = (FT_FaceRec_*)FontFaces[facekey];
                    iface = ftface->face_index.ToInt32();
                    faceinit = true;
                    return;
                }
                FT_FaceRec_* aface;
                IntPtr namebuffer = Marshal.StringToHGlobalAnsi(filename);
                try
                {
                    FontInfoFt.CheckFreeType(
                            FT.FT_New_Face(ftlibrary, (byte*)namebuffer, (IntPtr)faceIndex, &aface)
                        );
                }
                finally
                {
                    Marshal.FreeHGlobal(namebuffer);
                }
                iface = aface->face_index.ToInt32();
                ftface = aface;
                faceinit = true;
                if (type1)
                {
                    kerningfile = System.IO.Path.ChangeExtension(filename, ".afm");
                    if (File.Exists(kerningfile))
                    {
                        IntPtr kerningbuffer = Marshal.StringToHGlobalAnsi(kerningfile);
                        try
                        {
                            FontInfoFt.CheckFreeType(FT.FT_Attach_File(aface, (byte*)kerningbuffer));
                        }
                        finally
                        {
                            Marshal.FreeHGlobal(kerningbuffer);
                        }
                    }
                }
                // Don't need scale, but this is a scale that returns
                // exact widht for pdf if you divide the result
                // of Get_Char_Width by 64
                // A bitmap-only face rejects a char size in points, so it is not asked for one.
                if (scalable)
                    FontInfoFt.CheckFreeType(FT.FT_Set_Char_Size(aface, (IntPtr)0, (IntPtr)(64*100),96,96));
                FontFaces.Add(facekey, (IntPtr)aface);
            }
            finally
            {
                Monitor.Exit(FontInfoFt.flag);
            }
        }
    }
 
    /// <summary>
    /// Cross-platform <see cref="FontInfoProvider"/> built on FreeType, HarfBuzz and ICU that enumerates
    /// system fonts, supplies font metrics, glyph and kerning widths, subsetted font streams and performs
    /// BiDi/script-aware text layout (including HTML) for the PDF and rendering pipeline.
    /// </summary>
    public unsafe class FontInfoFt:FontInfoProvider,IDisposable
    {
        LogFontFt  currentfont;
        /// <summary>Shared monitor object used to serialize access to the FreeType library and font caches.</summary>
        public static object flag = 12345;
        static bool libraryinitialized;
        static SortedList<string,LogFontFt> fontlist = new SortedList<string,LogFontFt>();
        static SortedList<string, MemoryStream> FontStreams = new SortedList<string, MemoryStream>();
        static Strings fontpaths = new Strings();
        static SortedList<string,string> fontfiles = new SortedList<string,string>();
        static LogFontFt defaultfont;
        static LogFontFt defaultfontb;
        static LogFontFt defaultfontit;
        static LogFontFt defaultfontbit;
        static FT_LibraryRec_* FreeTypeLib;
        static SortedList<string, SortedList<char, GlyphInfo>> WidthsCache = new SortedList<string, SortedList<char, GlyphInfo>>();
        // Fonts already described, keyed by file and face index. This is what the fontconfig path
        // feeds from: it hands back a path, not a family, and the same file must not be read twice.
        static SortedList<string, LogFontFt> logfontsbyfile = new SortedList<string, LogFontFt>();
        /// <summary>
        /// Extra directories to scan for fonts, for platforms that keep no font database to ask.
        /// Android is the reason this exists: it carries no fontconfig, so the application declares
        /// here where its bundled fonts live. It has to be filled before the first report is printed,
        /// because the scan happens once.
        /// </summary>
        public static Strings ExtraFontDirectories = new Strings();
        static string BytePtrToString(byte* ptr)
        {
            int length = 0;

            // Buscar el terminador nulo '\0'
            while (ptr[length] != 0)
                length++;

            // Convertir a string con codificación UTF-8
            return Encoding.UTF8.GetString(ptr, length);
        }
        /// <summary>Throws an <see cref="Exception"/> describing the FreeType error when <paramref name="nerror"/> is non-zero; otherwise returns silently.</summary>
        /// <param name="nerror">The status code returned by a FreeType call.</param>
        public static void CheckFreeType(FT_Error nerror)
        {
            if (nerror == 0)
                return;
            var error = FT.FT_Error_String(nerror);
            if (error != null)
            {
                throw new Exception("Freetype function call error "
                    + nerror.ToString() + BytePtrToString(error));
            }
            else
                throw new Exception("Freetype function call error: "+nerror.ToString());
        }
        /// <summary>Encodes a string as a null-terminated UTF-8 byte sequence and returns a pointer to it for passing to native FreeType calls.</summary>
        /// <param name="str">The string to encode.</param>
        /// <returns>A pointer to the null-terminated UTF-8 bytes.</returns>
        public static byte* StringToBytePtr(string str)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(str + "\0"); // Agregar terminador nulo
            fixed (byte* ptr = bytes)
            {
                return ptr; // Retornar el puntero a los bytes
            }
        }

        private struct OS2Metrics
        {
            public bool Found;
            public short sTypoAscender;
            public short sTypoDescender;
            public short sTypoLineGap;
            public ushort usWinAscent;
            public ushort usWinDescent;
            public ushort fsSelection;
            public bool UseTypoMetrics => (fsSelection & 0x0080) != 0; // bit 7
        }

        /// <summary>
        /// Reads OS/2 table metrics from raw TTF/OTF binary data.
        /// Returns sTypo* and usWin* metrics, plus fsSelection to determine USE_TYPO_METRICS flag.
        /// </summary>
        private static OS2Metrics ReadOS2Metrics(byte[] fontData)
        {
            var result = new OS2Metrics();
            if (fontData == null || fontData.Length < 12) return result;

            // Read number of tables from the TrueType/OpenType header
            int numTables = (fontData[4] << 8) | fontData[5];
            // Each table record is 16 bytes, starting at offset 12
            for (int i = 0; i < numTables; i++)
            {
                int recordOffset = 12 + i * 16;
                if (recordOffset + 16 > fontData.Length) break;

                // Table tag is 4 bytes ASCII
                string tag = Encoding.ASCII.GetString(fontData, recordOffset, 4);
                if (tag == "OS/2")
                {
                    uint tableOffset = (uint)((fontData[recordOffset + 8] << 24) | (fontData[recordOffset + 9] << 16) |
                                              (fontData[recordOffset + 10] << 8) | fontData[recordOffset + 11]);

                    if (tableOffset + 78 > fontData.Length) return result;

                    int off = (int)tableOffset;
                    // fsSelection at offset 62
                    result.fsSelection = (ushort)((fontData[off + 62] << 8) | fontData[off + 63]);
                    // sTypoAscender at offset 68
                    result.sTypoAscender = (short)((fontData[off + 68] << 8) | fontData[off + 69]);
                    // sTypoDescender at offset 70
                    result.sTypoDescender = (short)((fontData[off + 70] << 8) | fontData[off + 71]);
                    // sTypoLineGap at offset 72
                    result.sTypoLineGap = (short)((fontData[off + 72] << 8) | fontData[off + 73]);
                    // usWinAscent at offset 74
                    result.usWinAscent = (ushort)((fontData[off + 74] << 8) | fontData[off + 75]);
                    // usWinDescent at offset 76
                    result.usWinDescent = (ushort)((fontData[off + 76] << 8) | fontData[off + 77]);
                    result.Found = true;
                    return result;
                }
            }
            return result;
        }

        private static void InitLibrary()
        {
            Monitor.Enter(flag);
            try
            {
                if (libraryinitialized)
                    return;
                fixed (FT_LibraryRec_** FreeTypeLibPointer = &FreeTypeLib)
                {
                    CheckFreeType(FT.FT_Init_FreeType(FreeTypeLibPointer));
                }
                libraryinitialized = true;
                // FONTCONFIG FIRST, DIRECTORIES ONLY IF THERE IS NONE. The same order the Delphi
                // engine follows (rpinfoprovft.pas InitLibrary): where the system keeps a font
                // database, there is nothing to enumerate. Every request is resolved on demand and,
                // more to the point, through the substitution rules, which is what turns a report
                // asking for Arial into Liberation Sans instead of into whatever font happened to
                // be first in a directory listing.
                if ((System.Environment.OSVersion.Platform == PlatformID.Unix)
                    || (System.Environment.OSVersion.Platform == PlatformID.MacOSX))
                    FontConfig.Init();
                if (FontConfig.Available)
                    return;
                
                Strings npaths = GetFontDirectories();
                foreach (string ndir in npaths)
                {
                    if (!Directory.Exists(ndir))
                        continue;
                    string[] nfiles = StreamUtil.GetFiles(ndir,"*.TTF|*.ttf|*.pf*",SearchOption.AllDirectories);
                    foreach (string nfile in nfiles)
                    {
                        LogFontFt aobj;
                        try
                        {
                            aobj = FillLogFont(nfile, 0);
                        }
                        catch (Exception)
                        {
                            // A file FreeType cannot parse is no reason to leave the process with
                            // no fonts at all: it is skipped and the scan carries on.
                            continue;
                        }
                        // Non scalable fonts are not supported, there are no outlines to embed
                        if (aobj != null && aobj.scalable)
                        {
                            // Default font configuration, LUXI SANS is default
                            if ((!aobj.italic) && (!aobj.bold))
                            {
                                if (defaultfont == null)
                                    defaultfont = aobj;
                                else
                                {
                                    if (aobj.familyname.ToUpper() == "LUXI SANS")
                                    {
                                        defaultfont = aobj;
                                    }
                                    else
                                        if (aobj.familyname.ToUpper() == "DEJAVU SANS")
                                        {
                                            defaultfont = aobj;
                                        }
                                }
                            }
                            else
                                if ((!aobj.italic) && (aobj.bold))
                                {
                                    if (defaultfontb == null)
                                        defaultfontb = aobj;
                                    else
                                    {
                                        if (aobj.familyname.ToUpper() == "LUXI SANS")
                                        {
                                            defaultfontb = aobj;
                                        }
                                    }
                                }
                                else
                                    if ((aobj.italic) && (!aobj.bold))
                                    {
                                        if (defaultfontit == null)
                                            defaultfontit = aobj;
                                        else
                                        {
                                            if (aobj.familyname.ToUpper() == "LUXI SANS")
                                            {
                                                defaultfontit = aobj;
                                            }
                                        }
                                    }
                                    else
                                    {
                                        if (defaultfontbit == null)
                                            defaultfontbit = aobj;
                                        else
                                        {
                                            if (aobj.familyname.ToUpper() == "LUXI SANS")
                                            {
                                                defaultfontbit = aobj;
                                            }
                                        }
                                    }

                            if (fontlist.IndexOfKey(aobj.keyname) < 0)
                                fontlist.Add(aobj.keyname, aobj);
                        }
                        if (fontfiles.IndexOfKey(nfile) < 0)
                            fontfiles.Add(nfile, nfile);
                    }
                }
            }
            finally
            {
                Monitor.Exit(flag);
            }
            if (defaultfont == null)
            {
                if (fontlist.Count == 0)
                {
                    throw new Exception("No fonts detected");
                }
                defaultfont = fontlist[fontlist.Keys[0]];
                System.Console.WriteLine("Default font set to: " + defaultfont.familyname);
            }
        }
        /// <summary>
        /// Opens one face of a font file, reads everything the engine needs to know about it and
        /// closes it again. This is the only place where a font file becomes a <see cref="LogFontFt"/>,
        /// no matter whether it turned up in a directory scan or came back from fontconfig; the
        /// Delphi engine keeps the same function under the same name (rpinfoprovft.pas).
        /// </summary>
        /// <param name="filename">Full path of the font file.</param>
        /// <param name="nfaceindex">Index of the face inside the file.</param>
        /// <returns>The described font.</returns>
        static LogFontFt FillLogFont(string filename, int nfaceindex)
        {
            FT_FaceRec_* aface;
            IntPtr namebuffer = Marshal.StringToHGlobalAnsi(filename);
            try
            {
                CheckFreeType(FT.FT_New_Face(FreeTypeLib, (byte*)namebuffer, (IntPtr)nfaceindex, &aface));
            }
            finally
            {
                Marshal.FreeHGlobal(namebuffer);
            }
            try
            {
                LogFontFt aobj = new LogFontFt();
                aobj.ftlibrary = FreeTypeLib;
                aobj.fullinfo = false;
                aobj.filename = filename;
                aobj.faceIndex = nfaceindex;
                aobj.scalable = (aface->face_flags.ToInt32() & (int)FT_FACE_FLAG.FT_FACE_FLAG_SCALABLE) != 0;
                aobj.type1 = (aface->face_flags.ToInt32() & (int)FT_FACE_FLAG.FT_FACE_FLAG_SFNT) == 0;
                // units_per_EM is zero on a bitmap-only face, and dividing by it would poison every
                // metric that comes after.
                if (aface->units_per_EM == 0)
                    aobj.convfactor = 1;
                else
                    aobj.convfactor = 1000.0 / aface->units_per_EM;
                aobj.widthmult = 1;
                aobj.heightmult = 1;
                string family_name = aface->family_name == null ? "" : BytePtrToString(aface->family_name);
                aobj.postcriptname = family_name.Replace(" ", "");
                aobj.familyname = family_name;
                aobj.fixedpitch = (aface->face_flags.ToInt32() & (int)FT_FACE_FLAG.FT_FACE_FLAG_FIXED_WIDTH) != 0;
                aobj.havekerning = (aface->face_flags.ToInt32() & (int)FT_FACE_FLAG.FT_FACE_FLAG_KERNING) != 0;
                // BBox calcultions are incorrect, it is left unset on purpose
                aobj.ascent = System.Convert.ToInt32(Math.Round(aobj.convfactor * (double)aface->ascender));
                aobj.descent = System.Convert.ToInt32(Math.Round(aobj.convfactor * (double)aface->descender));
                aobj.height = System.Convert.ToInt32(Math.Round(aobj.convfactor * (double)aface->height));
                aobj.leading = System.Convert.ToInt32(Math.Round(aobj.convfactor * (double)aface->height) - (aobj.ascent - aobj.descent));
                aobj.MaxWidth = System.Convert.ToInt32(Math.Round(aobj.convfactor * (double)aface->max_advance_width));
                aobj.Capheight = System.Convert.ToInt32(Math.Round(aobj.convfactor * (double)aface->ascender));
                aobj.stylename = aface->style_name == null ? "" : BytePtrToString(aface->style_name);
                aobj.bold = (aface->style_flags.ToInt32() & (int)FT_STYLE_FLAG.FT_STYLE_FLAG_BOLD) != 0;
                aobj.italic = (aface->style_flags.ToInt32() & (int)FT_STYLE_FLAG.FT_STYLE_FLAG_ITALIC) != 0;
                // The same reading of the name the Delphi engine does: a good number of files carry
                // the style in the name and nowhere else.
                if (!aobj.bold)
                    aobj.bold = (aobj.stylename.ToUpper().IndexOf("BOLD") >= 0)
                        || (aobj.postcriptname.ToUpper().IndexOf("BOLD") >= 0)
                        || (aobj.filename.ToUpper().IndexOf("BOLD") >= 0);
                if (!aobj.italic)
                    aobj.italic = (aobj.stylename.ToUpper().IndexOf("ITALIC") >= 0)
                        || (aobj.stylename.ToUpper().IndexOf("OBLIQUE") >= 0)
                        || (aobj.postcriptname.ToUpper().IndexOf("ITALIC") >= 0)
                        || (aobj.postcriptname.ToUpper().IndexOf("OBLIQUE") >= 0)
                        || (aobj.filename.ToUpper().IndexOf("ITALIC") >= 0)
                        || (aobj.filename.ToUpper().IndexOf("OBLIQUE") >= 0);
                aobj.keyname = (family_name + "____"
                    + (aobj.bold ? "B1" : "B0")
                    + (aobj.italic ? "I1" : "I0")).ToUpper();
                return aobj;
            }
            finally
            {
                CheckFreeType(FT.FT_Done_Face(aface));
            }
        }
        /// <summary>
        /// Returns the described font for a file and face index, reading the file only the first time.
        /// </summary>
        /// <param name="filename">Full path of the font file.</param>
        /// <param name="nfaceindex">Index of the face inside the file.</param>
        /// <returns>The described font.</returns>
        static LogFontFt GetOrAddLogFont(string filename, int nfaceindex)
        {
            string nkey = filename + "|" + nfaceindex.ToString(CultureInfo.InvariantCulture);
            Monitor.Enter(flag);
            try
            {
                if (logfontsbyfile.IndexOfKey(nkey) >= 0)
                    return logfontsbyfile[nkey];
                LogFontFt nfont = FillLogFont(filename, nfaceindex);
                logfontsbyfile.Add(nkey, nfont);
                return nfont;
            }
            finally
            {
                Monitor.Exit(flag);
            }
        }
        private void SelectFont(PDFFont pdfFont)
        {
            SelectFont(pdfFont, "", false);
        }
        /// <summary>
        /// Picks the font for a request. When fontconfig answered, it decides; otherwise the
        /// enumerated list is searched by family and style, exactly as before.
        /// </summary>
        /// <param name="pdfFont">The logical font whose family, bold and italic attributes drive the choice.</param>
        /// <param name="content">Text the font has to be able to draw, empty when coverage does not matter.</param>
        /// <param name="ignoreFamily">True to ask for any font that covers the text, whatever the family.</param>
        private void SelectFont(PDFFont pdfFont, string content, bool ignoreFamily)
        {
            if (FontConfig.Available)
            {
                SelectFontFontConfig(pdfFont, content, ignoreFamily);
                return;
            }
            string fontname = "";
            if ((System.Environment.OSVersion.Platform == PlatformID.Unix) || (System.Environment.OSVersion.Platform == PlatformID.MacOSX))
            {
                fontname = pdfFont.LFontName.ToUpper();
            }
            else
            {
                fontname = pdfFont.WFontName.ToUpper();
            }
            string familyname = fontname;
            string suffix = "";
            bool isbold = (pdfFont.Style & 1) > 0;
            bool isitalic = (pdfFont.Style & 2) > 0;
            if (isbold)
                suffix = "____B1";
            else
                suffix = "____B0";
            if (isitalic)
                suffix = suffix + "I1";
            else
                suffix = suffix + "I0";
            fontname = fontname+suffix;
            if (fontlist.IndexOfKey(fontname) >= 0)
            {
                currentfont = fontlist[fontname];
                return;
            }
            // Search similar font
            string familyonly = "";
            
            foreach (string fname in fontlist.Keys)
            {
                int idx = fname.IndexOf(familyname);
                if (idx >= 0)
                {
                    familyonly = fname;
                    idx = fname.IndexOf(suffix);
                    if (idx >= 0)
                    {
                        currentfont = fontlist[fname];
                        return;
                    }
                }
            }
            if (familyonly.Length>0)
            {
                currentfont = fontlist[familyonly];
                return;
            }
            if (isbold && isitalic)
            {
                currentfont = defaultfontbit;
            }
            else
                if (isbold && (!isitalic))
                {
                    currentfont = defaultfontb;
                }
                else
                    if ((!isbold) && (isitalic))
                        currentfont = defaultfontit;
                    else
                    {
                        currentfont = defaultfont;
                    }
            fontlist.Add(fontname, currentfont);
        }
        /// <summary>
        /// Asks fontconfig for the font, and asks a second time without a family when the answer is
        /// no good: nothing matched, the file is not one this engine can embed, or what came back
        /// has no outlines at all. Mirrors SelectFontFontConfig in rpinfoprovft.pas.
        /// </summary>
        private void SelectFontFontConfig(PDFFont pdfFont, string content, bool ignoreFamily)
        {
            bool matched = SelectFontFontConfigInt(pdfFont, content, ignoreFamily);
            if (ignoreFamily)
                return;
            if ((!matched) || (currentfont == null) || (!currentfont.scalable))
                SelectFontFontConfigInt(pdfFont, content, true);
        }
        /// <summary>Returns true when fontconfig answered with a font this engine can use, in which case it is now the current one.</summary>
        private bool SelectFontFontConfigInt(PDFFont pdfFont, string content, bool ignoreFamily)
        {
            string familyname = pdfFont.LFontName;
            if (familyname == null)
                familyname = "";
            // Helvetica is not a font that exists on a Unix box, it is a name a report carries from
            // its PostScript past. The Delphi engine sends it to Cantarell and so does this one.
            if (familyname == "Helvetica")
                familyname = "Cantarell";
            if (ignoreFamily)
                familyname = "";
            // Bold and italic are read from the flags and not from the Style bits, the way the
            // Delphi engine reads them (rpinfoprovft.pas:1701). PDFFont keeps both and nothing
            // guarantees they agree: the font built on the fly for the missing-glyph fallback sets
            // the flags and leaves Style at zero, and reading Style there would ask fontconfig for
            // a regular face while the text being measured is bold.
            string nfile;
            int nfaceindex;
            if (!FontConfig.Match(familyname, pdfFont.Bold, pdfFont.Italic, content, out nfile, out nfaceindex))
                return false;
            if (!SePuedeIncrustar(nfile, nfaceindex))
                return false;
            currentfont = GetOrAddLogFont(nfile, nfaceindex);
            return true;
        }
        /// <summary>
        /// Says whether this engine can actually print with a font file. Fontconfig knows every font
        /// on the machine; this engine knows plain TrueType and Type 1, which is what the directory
        /// scan has always looked for ("*.TTF|*.ttf|*.pf*"). An OpenType with CFF outlines or a
        /// collection would be measured with FreeType and then handed to a TrueType subsetter that
        /// cannot read it, so it is turned down here and the caller asks again.
        /// </summary>
        private static bool SePuedeIncrustar(string nfile, int nfaceindex)
        {
            // A face index other than zero means a collection, and only FreeType would honour it:
            // HarfBuzz shapes face 0 and the subsetter reads the first table directory.
            if (nfaceindex != 0)
                return false;
            string next = Path.GetExtension(nfile);
            if (string.IsNullOrEmpty(next))
                return false;
            next = next.ToLower();
            return (next == ".ttf") || next.StartsWith(".pf");
        }
		/// <summary>Selects the font matching <paramref name="pdfFont"/> and populates <paramref name="data"/> with its metrics, embedded font stream and glyph-width cache, applying OS/2 table overrides to match GDI/DirectWrite line spacing.</summary>
		/// <param name="pdfFont">The logical font whose family, bold and italic attributes drive font selection.</param>
		/// <param name="data">The metric container to fill.</param>
		public override void FillFontData(PDFFont pdfFont, TTFontData data)
        {
            FillFontData(pdfFont, data, "");
        }
        /// <summary>Same as <see cref="FillFontData(PDFFont,TTFontData)"/>, but stating which text the font has to be able to draw, so the choice can fall back to a font that covers the script at hand.</summary>
        /// <param name="pdfFont">The logical font whose family, bold and italic attributes drive font selection.</param>
        /// <param name="data">The metric container to fill.</param>
        /// <param name="content">The text the font has to cover, empty when coverage does not matter.</param>
        public void FillFontData(PDFFont pdfFont, TTFontData data, string content)
        {
            InitLibrary();



            SelectFont(pdfFont, content, false);
            if (currentfont == null)
                throw new Exception("No font available for " + pdfFont.GetFontFamily());

            data.IsUnicode = true;
            if (!currentfont.type1)
            {
                Monitor.Enter(flag);
                try
                {
                    if (data.FontData == null)
                    {
                        //if (FontStreams.IndexOfKey(currentfont.keyname) >= 0)
                        //{
                        //    data.FontData = new AdvFontData();
                        //    data.FontData.Data = FontStreams[currentfont.keyname].ToArray();
                        //}
                        MemoryStream nstream = StreamUtil.FileToMemoryStream(currentfont.filename);
                        data.FontData = new AdvFontData();
                        data.FontData.Data = nstream.ToArray();
                        if(!FontStreams.ContainsKey(currentfont.keyname))
                            FontStreams.Add(currentfont.keyname, nstream);
                    }
                }
                finally
                {
                    Monitor.Exit(flag);
                }
            }
            data.PostcriptName = currentfont.postcriptname;
            data.FontFamily = currentfont.familyname;
            data.FaceName = currentfont.familyname;
            data.Ascent = currentfont.ascent;
            data.Descent = currentfont.descent;
            data.Leading = currentfont.leading;
            data.Height = currentfont.height > 0 ? currentfont.height : currentfont.ascent - currentfont.descent + currentfont.leading;

            // Override with OS/2 table metrics to match DirectWrite/GDI
            if (data.FontData != null && data.FontData.Data != null)
            {
                var os2 = ReadOS2Metrics(data.FontData.Data);
                if (os2.Found)
                {
                    // Use same scaling as InitLibrary: value * convfactor (where convfactor = 1000/unitsPerEM)
                    double cf = currentfont.convfactor;

                    // DirectWrite checks fsSelection bit 7 (USE_TYPO_METRICS):
                    //   When set: uses sTypoAscender/sTypoDescender/sTypoLineGap for everything
                    //   When not set: Ascent/Descent from usWinAscent/usWinDescent,
                    //                  but Height from hhea (= ascender-descender+lineGap), matching GDI's GetLineSpacing

                    if (os2.UseTypoMetrics)
                    {
                        // USE_TYPO_METRICS: use sTypo* values directly
                        int dwAscent = os2.sTypoAscender;
                        int dwDescent = -os2.sTypoDescender; // sTypoDescender is negative
                        int dwLineGap = os2.sTypoLineGap;

                        data.Ascent = (int)Math.Round(cf * dwAscent);
                        data.Descent = -(int)Math.Round(cf * dwDescent);
                        data.Height = (int)Math.Round(cf * (dwAscent + dwDescent + dwLineGap));
                        data.Leading = data.Height - data.Ascent + data.Descent;
                    }
                    else
                    {
                        // Non-USE_TYPO_METRICS: 
                        //   Ascent/Descent from OS/2 usWinAscent/usWinDescent (matches GDI GetCellAscent/GetCellDescent)
                        //   Height from hhea table (matches GDI GetLineSpacing), keep original FreeType value
                        data.Ascent = (int)Math.Round(cf * os2.usWinAscent);
                        data.Descent = -(int)Math.Round(cf * os2.usWinDescent);
                        // data.Height stays as currentfont.height (hhea-based, already set above)
                        data.Leading = data.Height - data.Ascent + data.Descent;
                    }
                    Console.WriteLine($"[FT-FillFontData-OS2] Font={currentfont.familyname}, UseTypo={os2.UseTypoMetrics}, Ascent={data.Ascent}, Descent={data.Descent}, Height={data.Height}, Leading={data.Leading}");
                }
                else
                {
                    Console.WriteLine($"[FT-FillFontData-hhea] Font={currentfont.familyname}, Ascent={data.Ascent}, Descent={data.Descent}, Height={data.Height}, Leading={data.Leading}");
                }
            }
            data.CapHeight = currentfont.Capheight;
            data.Encoding = "WinAnsiEncoding";
            data.FontWeight = 0;
            data.MaxWidth = currentfont.MaxWidth;
            data.AvgWidth = currentfont.avCharWidth;
            data.HaveKerning = currentfont.havekerning;
            data.StemV = 0;
            data.FontStretch = "/Normal";
            data.FontBBox = currentfont.BBox;
            data.LogFont = currentfont;
            if (currentfont.italic)
                data.ItalicAngle = -15;
            else
                data.ItalicAngle = 0;
            data.StyleName = currentfont.stylename;
            data.Flags = 32;
            if (currentfont.fixedpitch)
                data.Flags = data.Flags + 1;
            if (pdfFont.Bold)
                data.PostcriptName = data.PostcriptName + ",Bold";
            if (pdfFont.Italic)
            {
                if (pdfFont.Bold)
                    data.PostcriptName = data.PostcriptName + "Italic";
                else
                    data.PostcriptName = data.PostcriptName + ",Italic";
            }
            data.Type1 = currentfont.type1;
            // Assign widths list
            Monitor.Enter(WidthsCache);
            try
            {
                WidthsCache.Clear();
                
                if (WidthsCache.IndexOfKey(data.PostcriptName) < 0)
                {
                    SortedList<char, GlyphInfo> nlist = new SortedList<char, GlyphInfo>();
                    WidthsCache.Add(data.PostcriptName, nlist);
                    data.CacheWidths = nlist;
                }
                else
                    data.CacheWidths = WidthsCache[data.PostcriptName];
            }
            finally
            {
                Monitor.Exit(WidthsCache);
            }

        }
        /// <summary>Returns the advance width of <paramref name="charCode"/> scaled to 1000 units per em, caching the result on <paramref name="data"/>.</summary>
        /// <param name="pdfFont">The logical font the character belongs to.</param>
        /// <param name="data">The metric container that caches glyph widths.</param>
        /// <param name="charCode">The character to measure.</param>
        /// <returns>The advance width of the character.</returns>
        public override double GetCharWidth(PDFFont pdfFont, TTFontData data,
				 char charCode)
        {
            int glyphindex; ;
            double newwidth;
            if (data.CacheWidths.IndexOfKey(charCode) >= 0)
            {
                GlyphInfo ninfo = data.CacheWidths[charCode];
                newwidth = ninfo.Width;
                glyphindex = ninfo.Glyph;
            }
            else
            {
                InitLibrary();

                int aint = (int)charCode;
                if (data.Widths.IndexOfKey(charCode) >= 0)
                {
                    return data.Widths[charCode];
                }
                LogFontFt cfont = (LogFontFt)data.LogFont;
                cfont.OpenFont();
                data.UnitsPerEM = cfont.ftface->units_per_EM;

                double awidth = 0;
                Monitor.Enter(flag);
                try
                {
                    if (data.Widths.IndexOfKey(charCode) >= 0)
                    {
                        newwidth = data.Widths[charCode];
                    }
                    else
                    {
                        // uint glyphIndex = cfont.ftface.GetCharIndex(charCode);
                        uint charcodeUint = (uint)charCode;
                        var charcodePointer = &charcodeUint;
                        uint glyphIndex = FT.FT_Get_Char_Index(cfont.ftface, (UIntPtr)charcodeUint);
                        //cfont.ftface.LoadGlyph(glyphIndex, LoadFlags.NoScale, LoadTarget.Normal);
                        CheckFreeType(FT.FT_Load_Glyph(cfont.ftface, glyphIndex, FT_LOAD.FT_LOAD_NO_SCALE));

                        //if (0 == FT.FT_Load_Char(cfont.iface, (uint)charCode, (int)FT.FT_LOAD_NO_SCALE))
                        //cfont.ftface.LoadChar((uint)charCode, SharpFont.LoadFlags.NoScale, SharpFont.LoadTarget.Normal);
                        {
                            //FT_FaceRec aface = (FT_FaceRec)Marshal.PtrToStructure(cfont.iface, typeof(FT_FaceRec));
                            //FT_GlyphSlotRec aglyph = (FT_GlyphSlotRec)Marshal.PtrToStructure(aface.glyph, typeof(FT_GlyphSlotRec));
                            //SharpFont.GlyphSlot aglyph = cfont.ftface.Glyph;
                            var aglyph = cfont.ftface->glyph;


                            //ushort width1 = (ushort)(aglyph.LinearHorizontalAdvance.Value >> 16);
                            //ushort width2 = (ushort)(aglyph.LinearHorizontalAdvance.Value & 0x0000FFFF);
                            //double dwidth = width1 + width2 / (double)65535;

                            // double scalex = cfont.ftface.Size.Metrics.ScaleX / 1000;
                            // double dwidth = aglyph.Metrics.Width.Value;
                            // dwidth = dwidth / scalex;
                            // awidth = cfont.widthmult * dwidth;
                            // Obtener el avance horizontal en unidades internas (design units)



                            // long advanceWidth = aglyph.Metrics.HorizontalAdvance.Value; // Unidades internas
                            long advanceWidth = aglyph->metrics.horiAdvance.ToInt64(); // Unidades internas

                            // UnitsPerEM de la fuente
                            // long unitsPerEM = cfont.ftface.UnitsPerEM;
                            long unitsPerEM = cfont.ftface->units_per_EM;



                            // Opcional: Escalar el ancho a píxeles
                            double scaleFactor = 1000.0 / unitsPerEM; // Asume 1000 como base
                            double scaledWidth = advanceWidth * scaleFactor;
                            awidth = scaledWidth;
                        }
                        newwidth = awidth;
                        data.Widths[charCode] = awidth;
                        //data.Glyphs[charCode] = System.Convert.ToInt32(FT.FT_Get_Char_Index(cfont.iface, charCode));

                        data.Glyphs[charCode] = Convert.ToInt32(glyphIndex);
                        if (data.FirstLoaded > aint)
                            data.FirstLoaded = aint;
                        if (data.LastLoaded < aint)
                            data.LastLoaded = aint;
                        GlyphInfo ninfo = new GlyphInfo();
                        ninfo.Glyph = Convert.ToInt32(glyphIndex);
                        ninfo.Width = newwidth;
                        if (data.CacheWidths.IndexOfKey(charCode) < 0)
                        {
                            data.CacheWidths.Add(charCode, ninfo);
                        }

                    }
                }
                finally
                {
                    Monitor.Exit(flag);
                }
            }

            return newwidth;
        }
        /// <summary>Returns the kerning adjustment between two adjacent characters scaled to 1000 units per em, or 0 when the font has no kerning, caching the result on <paramref name="data"/>.</summary>
        /// <param name="pdfFont">The logical font the characters belong to.</param>
        /// <param name="data">The metric container that caches kerning pairs.</param>
        /// <param name="leftChar">The left character of the pair.</param>
        /// <param name="rightChar">The right character of the pair.</param>
        /// <returns>The kerning adjustment for the pair.</returns>
        public override int GetKerning(PDFFont pdfFont, TTFontData data,
				 char leftChar, char rightChar)
        {
            LogFontFt cfont = (LogFontFt)data.LogFont;
            if (!cfont.havekerning)
                return 0;
            int nresult = 0;
            //string nkerning = ""+leftChar+rightChar;
            ulong nkerning = (ulong)((int)leftChar << 32) + (ulong)rightChar;

            if (data.Kernings.IndexOfKey(nkerning) >= 0)
            {
                return data.Kernings[nkerning];
            }
            cfont.OpenFont();
            Monitor.Enter(flag);
            try
            {
                if (data.Kernings.IndexOfKey(nkerning) >= 0)
                {
                    nresult = data.Kernings[nkerning];
                }
                //uint w1 = FT.FT_Get_Char_Index(cfont.iface,(uint)leftChar);
                // uint w1 = cfont.ftface.GetCharIndex((uint)leftChar);
                uint lchar = (uint)leftChar;
                var lcharPtr = &lchar;
                uint w1 = FT.FT_Get_Char_Index(cfont.ftface,(UIntPtr)lcharPtr);
                if (w1 > 0)
                {
                    uint rchar = (uint)rightChar;
                    var lrchar = &rightChar;
                    //uint w2 = FT.FT_Get_Char_Index(cfont.iface, (uint)rightChar);
                    uint w2 = FT.FT_Get_Char_Index(cfont.ftface,(UIntPtr)rightChar);
                    if (w2 > 0)
                    {
                        FT_Vector_ akerning;
                        FT_Vector_* kerningPointer = &akerning;
                        
                        CheckFreeType(FT.FT_Get_Kerning(cfont.ftface,w1,w2,FT_Kerning_Mode_.FT_KERNING_UNSCALED, kerningPointer));
                        // SharpFont.FTVector26Dot6 akerning = cfont.ftface.GetKerning(w1, w2, SharpFont.KerningMode.Unscaled);
                        nresult = System.Convert.ToInt32(Math.Round(cfont.widthmult*-akerning.x.ToInt32()));
                    }
                    else
                        data.Kernings.Add(nkerning, 0);
                }
                else
                    data.Kernings.Add(nkerning, 0);
            }
            finally
            {
                Monitor.Exit(flag);
            }
            return nresult;
        }
        /// <summary>Builds a subsetted TrueType font stream containing only the glyphs used in <paramref name="data"/>.</summary>
        /// <param name="data">The metric container holding the used glyphs and the source font bytes.</param>
        /// <returns>A memory stream with the subsetted font.</returns>
        public override MemoryStream GetFontStream(TTFontData data)
        {
            Dictionary<int, int[]> glyps = new Dictionary<int, int[]>();
            foreach (char xchar in data.Glyphs.Keys)
            {
                int gl = (int)data.Glyphs[xchar];
                double width = data.Widths[xchar];
                if (!glyps.ContainsKey(gl))
                    glyps[gl] = new int[] { gl, (int)Math.Round(width), (int)xchar };
            }
            TrueTypeFontSubSet subset = new TrueTypeFontSubSet(data.PostcriptName, data.FontData.Data,
                glyps, 0);
            byte[] nresult = subset.Execute();
            return new MemoryStream(nresult);
        }

        /// <summary>Initializes a new provider, initializing the FreeType library and enumerating the system fonts.</summary>
        public FontInfoFt()
        {
            InitLibrary();
        }
        /// <summary>Releases resources held by the provider. Currently a no-op because FreeType faces are shared and cached statically.</summary>
        public void Dispose()
        {

        }
        /// <summary>Returns the path of the Windows system FONTS directory ending with a directory separator.</summary>
        /// <returns>The system fonts directory path.</returns>
        static public string GetFontPath()
        {
            string systemPath = Environment.GetFolderPath(Environment.SpecialFolder.System);
            string result = Path.GetDirectoryName(systemPath)
                + Path.DirectorySeparatorChar 
                + "FONTS"
                + Path.DirectorySeparatorChar;
                return result;
        }


        /// <summary>
        /// Returns the directories to scan for fonts on this platform. This is the road taken when
        /// there is no fontconfig to ask -Windows, Android, a stripped container-, so it never
        /// throws: a machine with no font database still gets a list of the usual places, and the
        /// application can add its own through <see cref="ExtraFontDirectories"/>.
        /// </summary>
        /// <returns>The font directories to enumerate, without repetitions.</returns>
        public static Strings GetFontDirectories()
        {
            Strings dirs = new Strings();
            Strings afile = null;
            // What the application brought with it comes first: on Android that is the only place
            // where a font with the right metrics is going to be.
            foreach (string nextra in ExtraFontDirectories)
                dirs.Add(nextra);
            switch (System.Environment.OSVersion.Platform)
            {
                case PlatformID.MacOSX:
                    dirs.Add("/Library/Fonts");
                    dirs.Add("~/Library/Fonts");
                    dirs.Add("/System/Library/Fonts");
                    break;
                case PlatformID.Unix:
                    if (File.Exists("/etc/fonts/fonts.conf"))
                    {
                        afile = new Strings();
                        try
                        {
                            afile.LoadFromFile("/etc/fonts/fonts.conf");
                        }
                        catch (Exception)
                        {
                            afile = null;
                        }
                    }
                    if (afile == null)
                    {
                        // No fontconfig configuration to read the directories from. The Delphi engine
                        // falls back to a fixed list and so does this one, plus the two places
                        // Android keeps its fonts in. Missing directories are dropped by the scan.
                        AddFontDirectory(dirs, "/usr/share/fonts");
                        AddFontDirectory(dirs, "/usr/local/share/fonts");
                        AddFontDirectory(dirs, "/system/fonts");
                        AddFontDirectory(dirs, "/system/font");
                        AddFontDirectory(dirs, "/data/fonts");
                        string nhome = System.Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                        if (!string.IsNullOrEmpty(nhome))
                        {
                            AddFontDirectory(dirs, Path.Combine(nhome, ".fonts"));
                            AddFontDirectory(dirs, Path.Combine(nhome, ".local", "share", "fonts"));
                        }
                        break;
                    }
                    string nstring = afile.ToSemiColon();
         int index = nstring.IndexOf("<dir");
         if (index >= 0)
            nstring = nstring.Substring(index + 4, nstring.Length  - (index + 4));
         index = nstring.IndexOf(">");
         if (index >= 0)
            nstring = nstring.Substring(index + 1, nstring.Length - (index + 1));
         index = nstring.IndexOf("</dir");
         while (index >= 0)
         {
            string ndir = nstring.Substring(0,index);
            dirs.Add(ndir);
            nstring = nstring.Substring(index+4,nstring.Length-(index+4));
            
            index = nstring.IndexOf("<dir");
            if (index >= 0)
               nstring = nstring.Substring(index + 4, nstring.Length - (index + 4));
            index = nstring.IndexOf(">");
            if (index >= 0)
               nstring = nstring.Substring(index + 1, nstring.Length - (index + 1));
            index = nstring.IndexOf("</dir");
         }
                    // fonts.conf was read but there is no fontconfig to interpret it, so the usual
                    // places go in as well; the repeated ones are dropped below.
                    AddFontDirectory(dirs, "/usr/share/fonts");
                    AddFontDirectory(dirs, "/usr/local/share/fonts");
                    break;
                default:
                    dirs.Add(GetFontPath());
                    // Also add user-local fonts directory (Windows 10+)
                    string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                    if (!string.IsNullOrEmpty(localAppData))
                    {
                        string userFonts = Path.Combine(localAppData, "Microsoft", "Windows", "Fonts");
                        if (Directory.Exists(userFonts))
                            dirs.Add(userFonts);
                    }
                    break;
            }
            Strings nresult = new Strings();
            foreach (string ndir in dirs)
            {
                if (string.IsNullOrEmpty(ndir))
                    continue;
                if (nresult.IndexOf(ndir) < 0)
                    nresult.Add(ndir);
            }
            return nresult;
        }
        // Adds a directory to the list unless it is already there. Whether it exists is checked by
        // the scan, which has to do it anyway.
        private static void AddFontDirectory(Strings dirs, string ndir)
        {
            if (string.IsNullOrEmpty(ndir))
                return;
            if (dirs.IndexOf(ndir) < 0)
                dirs.Add(ndir);
        }

        /// <summary>Returns the advance width of a specific glyph index scaled to 1000 units per em, mapping newly discovered ligature or contextual glyphs to a Private Use Area character so they are subsetted.</summary>
        /// <param name="pdfFont">The logical font the glyph belongs to.</param>
        /// <param name="fontData">The metric container that caches glyph widths.</param>
        /// <param name="glyph">The glyph index to measure.</param>
        /// <param name="charC">The base character associated with the glyph.</param>
        /// <returns>The advance width of the glyph.</returns>
        public override double GetGlyphWidth(PDFFont pdfFont, TTFontData fontData, int glyph, char charC)
        {
            double baseWidth = GetCharWidth(pdfFont, fontData, charC);
            if (fontData.glyphsInfo.IndexOfKey(glyph) >= 0)
            {
                return fontData.glyphsInfo[glyph].Width;
            }

            // Also check if the base character's nominal glyph was actually THIS glyph
            if (fontData.CacheWidths.IndexOfKey(charC) >= 0 && fontData.CacheWidths[charC].Glyph == glyph)
            {
                fontData.glyphsInfo.Add(glyph, fontData.CacheWidths[charC]);
                return fontData.CacheWidths[charC].Width;
            }

            // It's a newly discovered OpenType ligature or contextual glyph
            // Map it to a Private Use Area character so PDFCanvas sees it and subsets it
            char puaChar = (char)(0xE000 + fontData.glyphsInfo.Count);
            
            InitLibrary();
            LogFontFt cfont = (LogFontFt)fontData.LogFont;
            cfont.OpenFont();

            Monitor.Enter(flag);
            double awidth;
            try
            {
                CheckFreeType(FT.FT_Load_Glyph(cfont.ftface, (uint)glyph, FT_LOAD.FT_LOAD_NO_SCALE));
                var aglyph = cfont.ftface->glyph;
                long advanceWidth = aglyph->metrics.horiAdvance.ToInt64();
                awidth = (long)Math.Round((double)advanceWidth * cfont.convfactor * cfont.widthmult);

                GlyphInfo ninfo = new GlyphInfo();
                ninfo.Width = awidth;
                ninfo.Glyph = glyph;

                while (fontData.CacheWidths.IndexOfKey(puaChar) >= 0) puaChar++;

                fontData.CacheWidths.Add(puaChar, ninfo);
                fontData.Widths.Add(puaChar, awidth);
                fontData.Glyphs.Add(puaChar, glyph);
                fontData.glyphsInfo.Add(glyph, ninfo);
            }
            finally
            {
                Monitor.Exit(flag);
            }

            return awidth;
        }

        /// <summary>Lays out text (plain or HTML) into lines, updating <paramref name="Rect"/> with the measured width and height, by delegating to <see cref="TextExtentHtml"/>.</summary>
        /// <param name="Text">The text to lay out.</param>
        /// <param name="Rect">On input the available width; on output the measured bounding rectangle.</param>
        /// <param name="pdfFont">The base font used for layout.</param>
        /// <param name="fontData">The metric container for the base font.</param>
        /// <param name="wordwrap">True to wrap words at the available width.</param>
        /// <param name="singleline">True to lay the text out on a single line.</param>
        /// <param name="FontSize">The font size in points.</param>
        /// <param name="isHtml">True when <paramref name="Text"/> contains HTML markup.</param>
        /// <returns>The laid-out lines with their glyphs and positions.</returns>
        public override List<LineInfo> TextExtent(string Text, ref System.Drawing.Rectangle Rect, PDFFont pdfFont, TTFontData fontData, bool wordwrap, bool singleline, double FontSize, bool isHtml)
        {
            if (!isHtml)
            {
                // In Delphi, TextExtent just calls TextExtentHtml.
                // We fake a single HTML segment for the entire text so it goes through
                // the exact same Harfbuzz/BiDi layout pipeline as HTML text does.
                return TextExtentHtml(Text, ref Rect, fontData, pdfFont, wordwrap, singleline, FontSize, false /* isHtml */);
            }
            return TextExtentHtml(Text, ref Rect, fontData, pdfFont, wordwrap, singleline, FontSize, true /* isHtml */);
        }

        /// <summary>
        /// Detect HarfBuzz script tag from the first significant character in the text.
        /// Matches the Delphi logicalRun.ScriptString behavior from ICU.
        /// </summary>
        private static string DetectScript(string text)
        {
            foreach (char c in text)
            {
                if (c <= ' ') continue; // skip whitespace/control
                int cp = (int)c;
                // Arabic: U+0600..U+06FF, U+0750..U+077F, U+08A0..U+08FF, U+FB50..U+FDFF, U+FE70..U+FEFF
                if ((cp >= 0x0600 && cp <= 0x06FF) || (cp >= 0x0750 && cp <= 0x077F) ||
                    (cp >= 0x08A0 && cp <= 0x08FF) || (cp >= 0xFB50 && cp <= 0xFDFF) ||
                    (cp >= 0xFE70 && cp <= 0xFEFF))
                    return "Arab";
                // Hebrew: U+0590..U+05FF, U+FB1D..U+FB4F
                if ((cp >= 0x0590 && cp <= 0x05FF) || (cp >= 0xFB1D && cp <= 0xFB4F))
                    return "Hebr";
                // Thai: U+0E00..U+0E7F
                if (cp >= 0x0E00 && cp <= 0x0E7F)
                    return "Thai";
                // Devanagari: U+0900..U+097F
                if (cp >= 0x0900 && cp <= 0x097F)
                    return "Deva";
                // CJK ranges
                if ((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF) ||
                    (cp >= 0x3000 && cp <= 0x303F))
                    return "Hani";
                // Hangul
                if ((cp >= 0xAC00 && cp <= 0xD7AF) || (cp >= 0x1100 && cp <= 0x11FF))
                    return "Hang";
                // Latin/Common: default
                if (cp >= 0x0020 && cp <= 0x024F)
                    return "Latn";
            }
            return "Latn";
        }

        private TGlyphPos[] CalcGlyphPositions(string text, bool rightToLeft, string script, double FontSize, TTFontData adata, PDFFont pdfFont)
        {
            if (string.IsNullOrEmpty(text)) return new TGlyphPos[0];

            if (adata.FontData == null || adata.FontData.Data == null)
            {
                FillFontData(pdfFont, adata);
            }
            
            byte[] bytes = adata.FontData.Data;
            fixed (byte* pData = bytes)
            {
                using (var blob = new HarfBuzzSharp.Blob((IntPtr)pData, bytes.Length, HarfBuzzSharp.MemoryMode.ReadOnly))
                using (var hbFace = new HarfBuzzSharp.Face(blob, 0))
                using (var font = new HarfBuzzSharp.Font(hbFace))
                using (var buffer = new HarfBuzzSharp.Buffer())
                {
                    font.SetScale((int)adata.UnitsPerEM, (int)adata.UnitsPerEM);
                    font.SetFunctionsOpenType();
                    buffer.Direction = rightToLeft ? HarfBuzzSharp.Direction.RightToLeft : HarfBuzzSharp.Direction.LeftToRight;
                    if (!string.IsNullOrEmpty(script))
                    {
                        buffer.Script = HarfBuzzSharp.Script.Parse(script);
                        if (script == "Arab")
                        {
                            buffer.Language = new HarfBuzzSharp.Language("ar");
                        }
                    }
                    buffer.AddUtf16(text);
                    font.Shape(buffer);
                    
                    var glyphInfos = buffer.GlyphInfos;
                    var glyphPositions = buffer.GlyphPositions;

                    if (script == "Arab")
                    {
                        Console.Write($"[HB] Shaped '{text}' -> ");
                        foreach (var gi in glyphInfos) Console.Write(gi.Codepoint + " ");
                        Console.WriteLine();
                    }
                    
                    var result = new TGlyphPos[glyphInfos.Length];
                    
                    double scaleFactor = FontSize * 20.0 / adata.UnitsPerEM;
                    for(int i = 0; i < glyphInfos.Length; i++)
                    {
                        result[i] = new TGlyphPos();
                        result[i].GlyphIndex = (ushort)glyphInfos[i].Codepoint;
                        result[i].XAdvance = (int)Math.Round(glyphPositions[i].XAdvance * scaleFactor);
                        result[i].XOffset = (int)Math.Round(glyphPositions[i].XOffset * scaleFactor);
                        result[i].YOffset = (int)Math.Round(glyphPositions[i].YOffset * scaleFactor);
                        result[i].Cluster = (int)glyphInfos[i].Cluster;
                        if (result[i].Cluster < text.Length)
                            result[i].CharCode = text[result[i].Cluster];
                    }
                    return result;
                }
            }
        }

        private struct BiDiRun
        {
            public int Start;
            public int Length;
            public byte Level;
            public bool IsRightToLeft;
        }

        /// <summary>Performs BiDi- and script-aware text layout using HarfBuzz shaping and ICU bidirectional analysis, supporting HTML formatting runs, per-segment fonts, word wrapping and font fallback, and updates <paramref name="Rect"/> with the measured extent.</summary>
        /// <param name="Text">The text to lay out, optionally containing HTML markup.</param>
        /// <param name="Rect">On input the available width; on output the measured bounding rectangle.</param>
        /// <param name="adata">The metric container for the base font.</param>
        /// <param name="pdfFont">The base font used for layout.</param>
        /// <param name="wordwrap">True to wrap words at the available width.</param>
        /// <param name="singleline">True to lay the text out on a single line.</param>
        /// <param name="FontSize">The font size in points.</param>
        /// <param name="isHtml">True when <paramref name="Text"/> contains HTML markup.</param>
        /// <returns>The laid-out lines with their visually ordered glyphs and positions.</returns>
        public List<LineInfo> TextExtentHtml(
            string Text,
            ref System.Drawing.Rectangle Rect,
            TTFontData adata,
            PDFFont pdfFont,
            bool wordwrap,
            bool singleline,
            double FontSize,
            bool isHtml = true)
        {
            var Result = new List<LineInfo>();
            Wrapper.Init(); // initialize ICU

            lock (flag)
            {
                SelectFont(pdfFont);
            }
            var originalFont = currentfont;

            // Use adata as default for line spacing, but will be overridden per-segment below
            double linespacingEM = (double)adata.Height / 1000.0;
            int linespacing = (int)Math.Round(linespacingEM * FontSize * 20.0);
            int ascentSpacing = (int)Math.Round(((double)adata.Ascent / 1000.0) * FontSize * 20.0);
            Console.WriteLine($"[FreeType] Font: {pdfFont.WFontName}, Size: {FontSize}, adata.Height={adata.Height}, -> linespacing={linespacing}, ascentSpacing={ascentSpacing}");
            
            // rectTop tracks the top of the current line (not the baseline)
            // This matches GDI's: lineInfo.TopPos = rectTopTwips + realBaseline
            double rectTop = 0;

            List<Reportman.Drawing.HtmlFormatRun> Segments;
            if (isHtml)
            {
                Segments = HtmlTextParser.Parse(Text, pdfFont.WFontName);
            }
            else
            {
                Segments = new List<Reportman.Drawing.HtmlFormatRun> { new Reportman.Drawing.HtmlFormatRun { Text = Text } };
            }

            string PlainText = "";
            foreach (var seg in Segments)
                PlainText += seg.Text;

            var lineSubTexts = HtmlLayoutUtils.DividesIntoLines(PlainText);
            double maxWidth = 0;
            double lineWidthLimit = Rect.Width; // Twips

            var TempFont = new PDFFont();
            TempFont.Name = pdfFont.Name;
            TempFont.Size = pdfFont.Size;
            TempFont.Color = pdfFont.Color;
            TempFont.WFontName = pdfFont.WFontName;
            TempFont.LFontName = pdfFont.LFontName;

            var fontDataCache = new Dictionary<string, TTFontData>();

            using (var bidi = new BiDi())
            {
                foreach (var lineSubText in lineSubTexts)
                {
                    string line = PlainText.Substring(lineSubText.Position, lineSubText.Length);
                    var possibleBreaksCharIdx = HtmlLayoutUtils.FillPossibleLineBreaksString(line);
                    var calculatedLines = new List<LineGlyphs>();

                    bidi.SetPara(line, 255, null);

                    double remaining = lineWidthLimit;
                    int textOffset = lineSubText.Position;
                    var currentChunk = new LineGlyphs(textOffset);

                    // Reconstruct logical runs manually since ICU.net exposes GetVisualRun well but logical runs maps natively 
                    var logicalRuns = new List<BiDiRun>();
                    int startLog = 0;
                    while(startLog < line.Length)
                    {
                        byte lvl = bidi.GetLevelAt(startLog);
                        int rLen = 1;
                        while(startLog + rLen < line.Length && bidi.GetLevelAt(startLog + rLen) == lvl) rLen++;
                        
                        logicalRuns.Add(new BiDiRun { Start = startLog, Length = rLen, Level = lvl, IsRightToLeft = (lvl % 2 == 1) });
                        startLog += rLen;
                    }

                    foreach (var logicalRun in logicalRuns)
                    {
                        int RunAbsStart = lineSubText.Position + logicalRun.Start;
                        int RunLen = logicalRun.Length;
                        int SegStartAbs = 0;

                        foreach (var Seg in Segments)
                        {
                            int SegLen = Seg.Text.Length;
                            int SegEndAbs = SegStartAbs + SegLen;
                            int IntStart = Math.Max(RunAbsStart, SegStartAbs);
                            int IntEnd = Math.Min(RunAbsStart + RunLen, SegEndAbs);

                            if (IntStart < IntEnd)
                            {
                                TempFont.Bold = pdfFont.Bold || Seg.Bold;
                                TempFont.Italic = pdfFont.Italic || Seg.Italic;
                                TempFont.WFontName = !string.IsNullOrEmpty(Seg.FontFamily) ? Seg.FontFamily : pdfFont.WFontName;
                                // The family of an HTML segment goes into BOTH names, as the Delphi
                                // engine does (rpinfoprovft.pas:561-570). On Unix the font is looked
                                // up by LFontName, so leaving it with the outer name measured the
                                // paragraph font and drew the segment one.
                                TempFont.LFontName = !string.IsNullOrEmpty(Seg.FontFamily) ? Seg.FontFamily : pdfFont.LFontName;
                                double activeSize = Seg.HasFontSize ? Seg.FontSize : FontSize;

                                TempFont.Style = 0;
                                if (TempFont.Bold) TempFont.Style |= 1;
                                if (TempFont.Italic) TempFont.Style |= 2;

                                string tempKey = TempFont.GetFontFamilyKey() + TempFont.Style.ToString();
                                if (!fontDataCache.TryGetValue(tempKey, out var tempAdata))
                                {
                                    tempAdata = new TTFontData();
                                    FillFontData(TempFont, tempAdata);
                                    fontDataCache[tempKey] = tempAdata;
                                }

                                lock (flag)
                                {
                                    SelectFont(TempFont);
                                }
                                
                                bool rToL = logicalRun.IsRightToLeft;
                                string ChunkText = PlainText.Substring(IntStart, IntEnd - IntStart);
                                string scriptStr = DetectScript(ChunkText);
                                
                                var positions = CalcGlyphPositions(ChunkText, rToL, scriptStr, activeSize, tempAdata, TempFont);
                                
                                // Font fallback: if any glyph has GlyphIndex=0, the current font
                                // doesn't support these characters. Try re-selecting with content.
                                // This matches the old Delphi TextExtent fallback logic.
                                bool hasMissingGlyphs = false;
                                for (int k = 0; k < positions.Length; k++)
                                {
                                    if (positions[k].GlyphIndex == 0) { hasMissingGlyphs = true; break; }
                                }
                                if (hasMissingGlyphs)
                                {
                                    // Try to find a font that supports these characters.
                                    //
                                    // THE TEXT IS DELIBERATELY NOT SENT with the request, even
                                    // though fontconfig would take it and answer with a font that
                                    // carries the script. The glyph positions below only record the
                                    // family NAME, and the PDF writer picks the font resource from
                                    // that name (PDFCanvas.WriteGlyphs): glyph indexes belonging to
                                    // the font fontconfig found would be written out under the
                                    // resource of the font that could not draw them, and would be
                                    // added to that font's subset. For the fallback to work, the
                                    // font that was chosen has to travel with the glyph, all the way
                                    // to the writer -which is a change in the metafile, not here-.
                                    var fallbackFont = new PDFFont();
                                    fallbackFont.Name = pdfFont.Name;
                                    fallbackFont.Size = (short)Math.Round(activeSize);
                                    fallbackFont.Color = pdfFont.Color;
                                    fallbackFont.Bold = TempFont.Bold;
                                    fallbackFont.Italic = TempFont.Italic;
                                    fallbackFont.WFontName = TempFont.WFontName;
                                    fallbackFont.LFontName = TempFont.LFontName;

                                    var fallbackData = new TTFontData();
                                    FillFontData(fallbackFont, fallbackData);
                                    lock (flag) { SelectFont(fallbackFont); }
                                    positions = CalcGlyphPositions(ChunkText, rToL, scriptStr, activeSize, fallbackData, fallbackFont);
                                }
                                
                                double runWidth = 0;
                                for (int k = 0; k < positions.Length; k++)
                                {
                                    runWidth += positions[k].XAdvance;
                                    positions[k].LineCluster = positions[k].Cluster + (IntStart - lineSubText.Position);
                                    positions[k].Bold = TempFont.Bold;
                                    positions[k].Italic = TempFont.Italic;
                                    positions[k].Underline = Seg.Underline;
                                    positions[k].StrikeOut = Seg.StrikeOut;
                                    positions[k].FontFamily = TempFont.WFontName;
                                    positions[k].FontSize = (float)activeSize;
                                    positions[k].HasFontSize = Seg.HasFontSize;
                                    positions[k].Color = Seg.Color;
                                    positions[k].HasColor = Seg.HasColor;
                                }

                                if (runWidth <= remaining || !wordwrap)
                                {
                                    foreach (var g in positions)
                                        currentChunk.AddGlyph(g, logicalRun.Start);
                                    remaining -= runWidth;
                                }
                                else
                                {
                                    bool lineHasContent = currentChunk.Glyphs.Count > 0;
                                    var chunksList = rToL ? HtmlLayoutUtils.BreakChunksRTL(new List<TGlyphPos>(positions), ref remaining, lineWidthLimit, possibleBreaksCharIdx, line, lineHasContent)
                                                          : HtmlLayoutUtils.BreakChunksLTR(new List<TGlyphPos>(positions), ref remaining, lineWidthLimit, possibleBreaksCharIdx, line, lineHasContent);

                                    for (int j = 0; j < chunksList.Count; j++)
                                    {
                                        var chunk = chunksList[j];
                                        if (j == 0)
                                        {
                                            foreach (var g in chunk) currentChunk.AddGlyph(g, logicalRun.Start);
                                            calculatedLines.Add(currentChunk);
                                            currentChunk = new LineGlyphs(textOffset);
                                            remaining = lineWidthLimit;
                                        }
                                        else if (j == chunksList.Count - 1)
                                        {
                                            remaining = lineWidthLimit;
                                            foreach (var g in chunk)
                                            {
                                                currentChunk.AddGlyph(g, logicalRun.Start);
                                                remaining -= g.XAdvance;
                                            }
                                        }
                                        else
                                        {
                                            foreach (var g in chunk) currentChunk.AddGlyph(g, logicalRun.Start);
                                            remaining = lineWidthLimit;
                                            calculatedLines.Add(currentChunk);
                                            currentChunk = new LineGlyphs(textOffset);
                                        }
                                    }
                                }
                            }
                            SegStartAbs = SegEndAbs;
                        }
                    }
                    if (currentChunk.Glyphs.Count > 0) calculatedLines.Add(currentChunk);

                    for (int lineIdx = 0; lineIdx < calculatedLines.Count; lineIdx++)
                    {
                        var calculatedLine = calculatedLines[lineIdx];
                        int minCluster = calculatedLine.MinClusterText;
                        int maxCluster = calculatedLine.MaxClusterText;
                        var visualGlyphs = new List<TGlyphPos>();
                        
                        int vCount = bidi.CountRuns();
                        for (int i=0; i < vCount; i++)
                        {
                            var vDir = bidi.GetVisualRun(i, out int vStart, out int vLength);
                            bool vRtL = vDir.ToString().Contains("RTL");
                            
                            var runGlyphs = new List<TGlyphPos>();
                            if (vRtL)
                            {
                                // RTL visual runs: iterate clusters in descending order.
                                // HarfBuzz outputs RTL glyphs in visual L-to-R order with
                                // decreasing cluster values. ClusterMap maps cluster→glyph-index,
                                // so ascending iteration reverses the visual order. Descending
                                // iteration preserves HarfBuzz's correct visual order.
                                for (int k = vStart + vLength - 1; k >= vStart; k--)
                                {
                                    if (calculatedLine.ClusterMap.TryGetValue(k, out var lst))
                                    {
                                        foreach (var idx in lst) runGlyphs.Add(calculatedLine.Glyphs[idx]);
                                    }
                                }
                            }
                            else
                            {
                                for (int k = vStart; k < vStart + vLength; k++)
                                {
                                    if (calculatedLine.ClusterMap.TryGetValue(k, out var lst))
                                    {
                                        foreach (var idx in lst) runGlyphs.Add(calculatedLine.Glyphs[idx]);
                                    }
                                }
                            }
                            
                            visualGlyphs.AddRange(runGlyphs);
                        }
                        
                        // --- Trim whitespace at word-wrap boundaries (matching DirectWrite/GDI AdjustLineSpaces) ---
                        // Direction-aware: for RTL, "trailing" whitespace is at the visual LEFT (beginning of list)
                        bool isParaRTL = (bidi.GetParaLevel() % 2) == 1;
                        
                        if (!isParaRTL)
                        {
                            // LTR: remove trailing whitespace from END of list (visual right)
                            while (visualGlyphs.Count > 0)
                            {
                                char ch = visualGlyphs[visualGlyphs.Count - 1].CharCode;
                                if (ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r')
                                    visualGlyphs.RemoveAt(visualGlyphs.Count - 1);
                                else
                                    break;
                            }
                            // Remove leading whitespace from continuation lines
                            if (lineIdx > 0)
                            {
                                while (visualGlyphs.Count > 0)
                                {
                                    char ch = visualGlyphs[0].CharCode;
                                    if (ch == ' ' || ch == '\t')
                                        visualGlyphs.RemoveAt(0);
                                    else
                                        break;
                                }
                            }
                        }
                        else
                        {
                            // RTL: remove trailing whitespace from BEGINNING of list (visual left)
                            while (visualGlyphs.Count > 0)
                            {
                                char ch = visualGlyphs[0].CharCode;
                                if (ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r')
                                    visualGlyphs.RemoveAt(0);
                                else
                                    break;
                            }
                            // Remove leading whitespace from continuation lines (visual right for RTL)
                            if (lineIdx > 0)
                            {
                                while (visualGlyphs.Count > 0)
                                {
                                    char ch = visualGlyphs[visualGlyphs.Count - 1].CharCode;
                                    if (ch == ' ' || ch == '\t')
                                        visualGlyphs.RemoveAt(visualGlyphs.Count - 1);
                                    else
                                        break;
                                }
                            }
                        }

                        var lineInfo = new LineInfo();
                        lineInfo.Glyphs = visualGlyphs;
                        // Recompute min/max cluster after trimming
                        if (visualGlyphs.Count > 0)
                        {
                            minCluster = int.MaxValue;
                            maxCluster = int.MinValue;
                            foreach (var g in visualGlyphs)
                            {
                                if (g.LineCluster < minCluster) minCluster = g.LineCluster;
                                if (g.LineCluster > maxCluster) maxCluster = g.LineCluster;
                            }
                        }
                        lineInfo.Position = minCluster;
                        lineInfo.Size = visualGlyphs.Count > 0 ? maxCluster - minCluster + 1 : 0;
                        lineInfo.Text = lineInfo.Size > 0 && minCluster + lineInfo.Size <= PlainText.Length
                            ? PlainText.Substring(minCluster, lineInfo.Size)
                            : (lineInfo.Size > 0 ? PlainText.Substring(minCluster) : string.Empty);
                        
                        double lw = 0;
                        double maxLineFontSize = FontSize;
                        foreach (var g in lineInfo.Glyphs) 
                        {
                            lw += g.XAdvance;
                            if (g.HasFontSize && g.FontSize > maxLineFontSize)
                                maxLineFontSize = g.FontSize;
                        }
                        lineInfo.Width = (int)Math.Round(lw);
                        
                        // Compute per-line baseline (max ascent in twips) and line height
                        // matching DirectWrite's GetLineMetrics().Baseline and .Height
                        int maxAscentEM = adata.Ascent;  // default to original font
                        int maxHeightEM = adata.Height;   // default to original font
                        double maxAscentTwips = (double)adata.Ascent / 1000.0 * FontSize * 20.0;
                        double maxLineHeight = (double)adata.Height / 1000.0 * FontSize * 20.0;
                        // Baseline = Ascent + Leading (lineGap added above the baseline, matching DirectWrite)
                        double maxBaselineTwips = (double)(adata.Ascent + Math.Max(0, adata.Leading)) / 1000.0 * FontSize * 20.0;
                        
                        foreach (var g in lineInfo.Glyphs)
                        {
                            double gFontSize = g.HasFontSize ? g.FontSize : FontSize;
                            string gFontFamily = g.FontFamily ?? pdfFont.WFontName;
                            
                            // Find the font data for this glyph
                            TTFontData gFontData = null;
                            foreach (var kvp in fontDataCache)
                            {
                                if (kvp.Key.ToUpper().Contains(gFontFamily.ToUpper()))
                                {
                                    gFontData = kvp.Value;
                                    break;
                                }
                            }
                            
                            if (gFontData != null)
                            {
                                double gAscentTwips = (double)gFontData.Ascent / 1000.0 * gFontSize * 20.0;
                                double gHeightTwips = (double)gFontData.Height / 1000.0 * gFontSize * 20.0;
                                // Baseline includes Leading (lineGap) to match DirectWrite
                                double gBaselineTwips = (double)(gFontData.Ascent + Math.Max(0, gFontData.Leading)) / 1000.0 * gFontSize * 20.0;
                                if (gBaselineTwips > maxBaselineTwips)
                                    maxBaselineTwips = gBaselineTwips;
                                if (gHeightTwips > maxLineHeight)
                                    maxLineHeight = gHeightTwips;
                            }
                            else
                            {
                                // Fallback: use default font data scaled by glyph font size
                                double gAscentTwips = (double)adata.Ascent / 1000.0 * gFontSize * 20.0;
                                double gHeightTwips = (double)adata.Height / 1000.0 * gFontSize * 20.0;
                                double gBaselineTwips = (double)(adata.Ascent + Math.Max(0, adata.Leading)) / 1000.0 * gFontSize * 20.0;
                                if (gBaselineTwips > maxBaselineTwips)
                                    maxBaselineTwips = gBaselineTwips;
                                if (gHeightTwips > maxLineHeight)
                                    maxLineHeight = gHeightTwips;
                            }
                        }

                        int currentLineSpacing = (int)Math.Round(maxLineHeight);
                        int lineBaseline = (int)Math.Round(maxBaselineTwips);

                        // TopPos = rectTop + baseline (matches GDI's pattern)
                        lineInfo.TopPos = (int)Math.Round(rectTop) + lineBaseline;
                        lineInfo.Height = currentLineSpacing;
                        lineInfo.LineHeight = currentLineSpacing;
                        lineInfo.LastLine = false;
                        
                        Result.Add(lineInfo);
                        if (lw > maxWidth) maxWidth = lw;
                        rectTop += currentLineSpacing;
                    }
                }
            }
            if (Result.Count > 0) 
            {
                var l = Result[Result.Count - 1];
                l.LastLine = true;
                Result[Result.Count - 1] = l;
            }
            
            Rect.Width = (int)Math.Round(maxWidth);
            Rect.Height = (int)Math.Round(rectTop);
            
            currentfont = originalFont;
            return Result;
        }
    }
}
