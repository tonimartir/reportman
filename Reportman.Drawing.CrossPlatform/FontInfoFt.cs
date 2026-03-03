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
    unsafe public class  LogFontFt
    {
        public bool fixedpitch;
        public string postcriptname;
        public string familyname;
        public string stylename;
        public bool italic;
        public bool bold;
        public string filename;
        public int ascent;
        public int descent;
        public int height;
        public int weight;
        public int MaxWidth;
        public int avCharWidth;
        public int Capheight;
        public double ItalicAngle;
        public int leading;
        public Rectangle BBox;
        public bool fullinfo;
        public double StemV;
        public FT_FaceRec_* ftface;
        public bool faceinit;
        public bool havekerning;
        public bool type1;
        public double widthmult = 1;
        public double convfactor = 1;
        public double heightmult = 1;
        public string keyname;
        public FT_LibraryRec_* ftlibrary;
        public string kerningfile;
        public static SortedList<string,int> FontFaces = new SortedList<string,int>();
        public int iface;
        public LogFontFt()
        {
            kerningfile = "";
            iface = 0;
        }
        public void Dispose()
        {
        }
        public void OpenFont()
        {
            if (faceinit)
                return;
            Monitor.Enter(FontInfoFt.flag);
            try
            {
                if (FontFaces.IndexOfKey(keyname) >= 0)
                {
                    iface = FontFaces[keyname];
                    faceinit = true;
                }
                else
                {

                    //FontInfoFt.CheckFreeType(FT.FT_New_Face(ftlibrary, filename, 0, out iface));
                    FT_FaceRec_* aface;
                    FontInfoFt.CheckFreeType(
                            FT.FT_New_Face(ftlibrary, (byte*)Marshal.StringToHGlobalAnsi(filename), (IntPtr)0, &aface)
                            //FT.FT_New_Face(ftlibrary, FontInfoFt.StringToBytePtr(filename), new IntPtr(0), &aface)
                        );
                    //SharpFont.Face aface = new SharpFont.Face(ftlibrary,filename);
                    iface = aface->face_index.ToInt32();
                    ftface = aface;
                    //FontInfoFt.CheckFreeType(FT.FT_New_Face(ftlibrary, filename, 0, out iface));
                    //aface = (FT_FaceRec)Marshal.PtrToStructure(iface, typeof(FT_FaceRec));
                    faceinit = true;
                    if (type1)
                    {
                        kerningfile = System.IO.Path.ChangeExtension(filename, ".afm");
                        if (File.Exists(kerningfile))
                        {
                            // aface.AttachFile(kerningfile);
                            FontInfoFt.CheckFreeType(FT.FT_Attach_File(aface, FontInfoFt.StringToBytePtr(kerningfile)));
                        }
                    }
                    // Don't need scale, but this is a scale that returns
                    // exact widht for pdf if you divide the result
                    // of Get_Char_Width by 64
                    //aface.SetCharSize(0, 64 * 100, 96, 96); // Tamaño en puntos y DPI
                    int acharWidth = 0;
                    var pointer = &acharWidth;
                    int heightInt = 64 * 100;
                    var heightPointer = &heightInt;
                    FontInfoFt.CheckFreeType(FT.FT_Set_Char_Size(aface, (IntPtr)0, (IntPtr)(64*100),96,96));
                    FontFaces.Add(keyname, iface);
                }
            }
            finally
            {
                Monitor.Exit(FontInfoFt.flag);
            }
        }
    }
 
    public unsafe class FontInfoFt:FontInfoProvider,IDisposable
    {
        LogFontFt  currentfont;
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
        static string BytePtrToString(byte* ptr)
        {
            int length = 0;

            // Buscar el terminador nulo '\0'
            while (ptr[length] != 0)
                length++;

            // Convertir a string con codificación UTF-8
            return Encoding.UTF8.GetString(ptr, length);
        }
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
                
                Strings npaths = GetFontDirectories();
                foreach (string ndir in npaths)
                {
					if (Directory.Exists(ndir))
					{
                    string[] nfiles = StreamUtil.GetFiles(ndir,"*.TTF|*.ttf|*.pf*",SearchOption.AllDirectories);
                    foreach (string nfile in nfiles)
                    {
                            //FT_FaceRec aface = new FT_FaceRec();
                            // var aface = new FT.Face .Face(FreeTypeLib, nfile);
                            FT_FaceRec_* iface;
                            int faceIndex = 0;
                            var faceIndexPointer = &faceIndex;
                        CheckFreeType(
                            // FT.FT_New_Face(FreeTypeLib, StringToBytePtr(nfile), (IntPtr)faceIndexPointer, &iface)
                            FT.FT_New_Face(FreeTypeLib, (byte*)Marshal.StringToHGlobalAnsi(nfile),(IntPtr) 0, &iface));
                        try
                        {
                                //aface = (FT_FaceRec)Marshal.PtrToStructure(iface, typeof(FT_FaceRec));
                                //if ((aface.face_flags & (int)FT_Face_Flags.FT_FACE_FLAG_SCALABLE)!=0)
                                //string familyMame = BytePtrToString(iface->family_name);
                                // if (aface.FaceFlags.HasFlag(SharpFont.FaceFlags.Scalable))
                            if ((iface->face_flags.ToInt32() & (int)FT_FACE_FLAG.FT_FACE_FLAG_SCALABLE)!=0)
                            {
                                LogFontFt aobj = new LogFontFt();
                                aobj.ftlibrary = FreeTypeLib;
                                aobj.fullinfo = false;
                                    // Fill font properties
                                    //aobj.type1 = ((int)FT_Face_Flags.FT_FACE_FLAG_SFNT & aface.face_flags)==0;
                                    //aobj.type1 = !aface.FaceFlags.HasFlag(SharpFont.FaceFlags.Sfnt);
                                    aobj.type1 = (iface->face_flags.ToInt32() & (int)FT_FACE_FLAG.FT_FACE_FLAG_SFNT) == 0;
                                    if (aobj.type1)
                                {
                                        //       aobj.convfactor:=1000/aface.units_per_EM;
                                        //aobj.widthmult = 1024.0/aface.UnitsPerEM;
                                        //aobj.heightmult = 1024.0/aface.UnitsPerEM;
                                        aobj.widthmult = 1;
                                        aobj.heightmult = 1;
                                    }
                                    else
                                {
                                        //aobj.convfactor=1;
                                        aobj.convfactor=1000.0/iface->units_per_EM;
                                        aobj.widthmult = 1;
                                        aobj.heightmult = 1;
                                        //aobj.widthmult = 1024.0 / aface.UnitsPerEM;
                                        //aobj.heightmult = 1024.0 / aface.UnitsPerEM;
                                    }
                                    aobj.filename=nfile;
                                string family_name = BytePtrToString(iface->family_name);
                                aobj.postcriptname=family_name.Replace(" ","");
                                aobj.familyname=family_name;
                                aobj.keyname = family_name + "____";
                                    //aobj.fixedpitch=(aface.face_flags & (int)FT_Face_Flags.FT_FACE_FLAG_FIXED_WIDTH)!=0;
                                    // aobj.fixedpitch = aface.FaceFlags.HasFlag(SharpFont.FaceFlags.FixedWidth);
                                aobj.fixedpitch = (iface->face_flags.ToInt32() & (int)FT_FACE_FLAG.FT_FACE_FLAG_FIXED_WIDTH)!=0;
                                    //aobj.havekerning=(aface.face_flags & (int)FT_Face_Flags.FT_FACE_FLAG_KERNING)!=0;
                                //aobj.havekerning = aface.FaceFlags.HasFlag(SharpFont.FaceFlags.Kerning);
                                aobj.havekerning = (iface->face_flags.ToInt32() & (int)FT_FACE_FLAG.FT_FACE_FLAG_KERNING) != 0;
                                int bboxleft = iface->bbox.xMin.ToInt32();
                                int bboxright = iface->bbox.xMax.ToInt32();
                                int bboxtop  = iface->bbox.yMin.ToInt32();
                                int bboxbottom = iface->bbox.yMax.ToInt32();

                                int nleft = System.Convert.ToInt32(Math.Round(aobj.convfactor * (double)bboxleft));
                                int nright = System.Convert.ToInt32(Math.Round(aobj.convfactor * (double)bboxright));
                                int ntop = System.Convert.ToInt32(Math.Round(aobj.convfactor * (double)bboxtop));
                                int nbottom = System.Convert.ToInt32(Math.Round(aobj.convfactor * (double)bboxbottom));
                                // BBox calcultions are incorrect
                                // aobj.BBox = new Rectangle(nleft,ntop,nright-nleft,nbottom-ntop);
                                aobj.ascent=System.Convert.ToInt32(Math.Round(aobj.convfactor * (double)iface->ascender));
                                aobj.descent=System.Convert.ToInt32(Math.Round(aobj.convfactor * (double)iface->descender));
                                aobj.height=System.Convert.ToInt32(Math.Round(aobj.convfactor * (double)iface->height));
                                aobj.leading=System.Convert.ToInt32(Math.Round(aobj.convfactor * (double)iface->height)-(aobj.ascent-aobj.descent));
                                aobj.MaxWidth=System.Convert.ToInt32(Math.Round(aobj.convfactor*(double)iface->max_advance_width));
                                aobj.Capheight=System.Convert.ToInt32(Math.Round(aobj.convfactor*(double)iface->ascender));
                                string style_name = BytePtrToString(iface->style_name);
                                aobj.stylename=style_name;
                                    //aobj.bold=(aface.style_flags & (int)FT_Style_Flags.FT_STYLE_FLAG_BOLD)!=0;
                                aobj.bold = (iface->style_flags.ToInt32() &  (int)FT_STYLE_FLAG.FT_STYLE_FLAG_BOLD) != 0;
                                    //aobj.italic=(aface.style_flags & (int)FT_Style_Flags.FT_STYLE_FLAG_ITALIC)!=0;
                                    //aobj.italic = aface.StyleFlags.HasFlag(SharpFont.StyleFlags.Italic);
                                 aobj.italic = (iface->style_flags.ToInt32() & (int)FT_STYLE_FLAG.FT_STYLE_FLAG_ITALIC) != 0;
                                 if (aobj.bold)
                                    aobj.keyname = aobj.keyname + "B1";
                                else
                                    aobj.keyname = aobj.keyname + "B0";

                                if (aobj.italic)
                                    aobj.keyname = aobj.keyname + "I1";
                                else
                                    aobj.keyname = aobj.keyname + "I0";
                                // Default font configuration, LUXI SANS is default
                                if ((!aobj.italic) && (!aobj.bold))
                                {
                                   if (defaultfont==null)
                                    defaultfont=aobj;
                                   else
                                   {
                                        if (aobj.familyname.ToUpper()=="LUXI SANS")
                                        {
                                             defaultfont=aobj;
                                         }
                                        else
                                         if (aobj.familyname.ToUpper()=="DEJAVU SANS") {
                                                defaultfont =aobj;
                                            }
                                   }
                                }
                                else
                                    if ((!aobj.italic) && (aobj.bold))
                                    {
                                       if  (defaultfontb==null)
                                        defaultfontb=aobj;
                                       else
                                       {
                                            if (aobj.familyname.ToUpper()=="LUXI SANS")
                                            {
                                                defaultfontb=aobj;
                                            }
                                       }
                                    }
                                    else
                                        if ((aobj.italic) && (!aobj.bold))
                                        {
                                               if (defaultfontit==null)
                                                    defaultfontit=aobj;
                                               else
                                               {
                                                if (aobj.familyname.ToUpper()=="LUXI SANS")
                                                {
                                                    defaultfontit=aobj;
                                                }
                                               }
                                        }
                                        else
                                            if ((aobj.italic) && (aobj.bold))
                                            {
                                               if (defaultfontbit==null)
                                                defaultfontbit=aobj;
                                               else
                                               {
                                                if (aobj.familyname.ToUpper()=="LUXI SANS")
                                                {
                                                 defaultfontbit=aobj;
                                                }
                                               }
                                            }

                                aobj.keyname = aobj.keyname.ToUpper();
                                if (fontlist.IndexOfKey(aobj.keyname)<0)
                                    fontlist.Add(aobj.keyname.ToUpper(),aobj);

                            }
                                int nindex = fontfiles.IndexOfKey(nfile);
                            if (nindex < 0)
                                fontfiles.Add(nfile, nfile);
                        }
                        finally
                        {
                                //iface.Dispose();
                            
                            CheckFreeType(FT.FT_Done_Face(iface));
                        }
						}
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
        private void SelectFont(PDFFont pdfFont)
        {
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
		public override void FillFontData(PDFFont pdfFont, TTFontData data)
        {
            InitLibrary();



            SelectFont(pdfFont);

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

        public FontInfoFt()
        {
            InitLibrary();
        }
        public void Dispose()
        {

        }
        static public string GetFontPath()
        {
            string systemPath = Environment.GetFolderPath(Environment.SpecialFolder.System);
            string result = Path.GetDirectoryName(systemPath)
                + Path.DirectorySeparatorChar 
                + "FONTS"
                + Path.DirectorySeparatorChar;
                return result;
        }


        public static Strings GetFontDirectories()
        {
            Strings dirs = new Strings();
            Strings afile = null;
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
                        afile.LoadFromFile("/etc/fonts/fonts.conf");
                    }
                    else
                        throw new Exception("File not found: /etc/fonts/fonts.conf");
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
            return dirs;
        }

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
                                    // Try to find a font that supports these characters
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
