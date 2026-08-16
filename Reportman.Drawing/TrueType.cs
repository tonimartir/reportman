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
using System.Text;
using System.Threading;

namespace Reportman.Drawing
{
    /// <summary>
    /// Directory entry for a single table inside a TrueType font file, holding its tag name,
    /// byte offset, length and checksum.
    /// </summary>
    public class TableData
    {
        /// <summary>
        /// Four-character table tag identifying this font table (for example "glyf" or "loca").
        /// </summary>
        public string TableName;
        /// <summary>
        /// Byte offset of the table within the font file.
        /// </summary>
        public int Location;
        /// <summary>
        /// Length of the table in bytes.
        /// </summary>
        public int Length;
        /// <summary>
        /// Checksum of the table as stored in the font directory.
        /// </summary>
        public int Checksum;
        /// <summary>
        /// Initializes a new table directory entry with the given tag, location, length and checksum.
        /// </summary>
        /// <param name="tname">Four-character table tag.</param>
        /// <param name="tlocation">Byte offset of the table within the font file.</param>
        /// <param name="tlength">Length of the table in bytes.</param>
        /// <param name="tchecksum">Checksum of the table.</param>
        public TableData(string tname, int tlocation, int tlength, int tchecksum)
        {
            TableName = tname;
            Location = tlocation;
            Length = tlength;
            Checksum = tchecksum;
        }
    }
    /// <summary>
    /// Builds a minimal subset of a TrueType font containing only the glyphs actually used,
    /// rewriting the loca/glyf tables and reassembling the font for embedding (e.g. in PDF output).
    /// </summary>
    public class TrueTypeFontSubSet
    {
        internal static string[] tablenameconst = {"cvt ", "fpgm", "glyf", "head",
                                               "hhea", "hmtx", "loca", "maxp", "prep"};
        internal static int[] entryselec = { 0, 0, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4 };
        internal static int HEAD_LOCA_FORMAT_OFFSET = 51;

        internal static int ARG_1_AND_2_ARE_WORDS = 1;
        internal static int WE_HAVE_A_SCALE = 8;
        internal static int MORE_COMPONENTS = 32;
        internal static int WE_HAVE_AN_X_AND_Y_SCALE = 64;
        internal static int WE_HAVE_A_TWO_BY_TWO = 128;
        string PostcriptName;

        /// <summary>
        /// Directory of the font tables keyed by their four-character tag.
        /// </summary>
        protected SortedList<string, TableData> tables;
        /// <summary>
        /// Raw bytes of the source font file being subset.
        /// </summary>
        protected byte[] rfarray;
        /// <summary>
        /// True when the font uses the short (16-bit) loca table format; false for the long (32-bit) format.
        /// </summary>
        protected bool locaShortTable;
        // Cached glyph tables
        private static SortedList<string, int[]> CachedlocaTables;

        private static object tflag = 2;

        /// <summary>
        /// Glyph offsets read from the original loca table.
        /// </summary>
        protected int[] locaTable;
        /// <summary>
        /// Glyphs requested for the subset, keyed by glyph index.
        /// </summary>
        protected Dictionary<int, int[]> glyphsUsed;
        /// <summary>
        /// Working list of glyph indexes included in the subset, expanded to pull in composite glyph components.
        /// </summary>
        protected List<int> glyphsInList;
        /// <summary>
        /// Offset of the glyf table within the source font.
        /// </summary>
        protected int tableGlyphOffset;
        /// <summary>
        /// Glyph offsets for the rewritten loca table of the subset font.
        /// </summary>
        protected int[] newLocaTable;
        /// <summary>
        /// Serialized bytes of the rewritten loca table.
        /// </summary>
        protected byte[] newLocaTableOut;
        /// <summary>
        /// Serialized bytes of the rewritten glyf table containing only the used glyphs.
        /// </summary>
        protected byte[] newGlyfTable;
        /// <summary>
        /// Actual (unpadded) size in bytes of the rewritten glyf table.
        /// </summary>
        protected int glyfTableRealSize;
        /// <summary>
        /// Actual (unpadded) size in bytes of the rewritten loca table.
        /// </summary>
        protected int locaTableRealSize;
        /// <summary>
        /// Buffer receiving the bytes of the font currently being written.
        /// </summary>
        protected byte[] outFont;
        /// <summary>
        /// Current write position within <see cref="outFont"/>.
        /// </summary>
        protected int fontPtr;
        /// <summary>
        /// Offset of the font directory within the source font file (or of the selected font within a collection).
        /// </summary>
        protected uint directoryOffset;

        /// <summary>
        /// Create a class to extact the subset stream of a font, given the glyphs used
        /// </summary>
        /// <param name="fontname"></param>
        /// <param name="rfarray"></param>
        /// <param name="glyphsUsed"></param>
        /// <param name="directoryOffset"></param>
        public TrueTypeFontSubSet(string fontname, byte[] rfarray, Dictionary<int, int[]> glyphsUsed, uint directoryOffset)
        {
            this.rfarray = rfarray;
            this.glyphsUsed = glyphsUsed;
            this.PostcriptName = fontname.ToUpper().Trim();
            this.directoryOffset = directoryOffset;
            glyphsInList = new List<int>(glyphsUsed.Keys);
        }

        /// <summary>
        /// Builds the font subset and returns the assembled font as a byte array containing only the used glyphs.
        /// </summary>
        /// <returns>The bytes of the subset TrueType font.</returns>
        public byte[] Execute()
        {
            // LO QUE NO SE PUEDE SUBSETEAR SE EMBEBE ENTERO, que es lo que hace el motor Delphi
            // (rptruetype.pas: `if (not CreateTableDirectory) then begin Result:=FRFArray; exit;`).
            // El port se dejo esa salida y lanzaba excepcion: un OpenType con contornos CFF
            // ('OTTO') tumbaba la impresion en vez de ir a parar al PDF tal cual.
            if (!CreateTableDirectory())
                return rfarray;
            ReadLoca();
            FlatGlyphs();
            CreateNewGlyphTables();
            LocaTobytes();
            AssembleFont();
            return outFont;
        }

        /// <summary>
        /// Assembles the final subset font into <see cref="outFont"/>, writing the table directory and copying
        /// the retained tables together with the rewritten loca and glyf tables.
        /// </summary>
        protected void AssembleFont()
        {
            int fullFontSize = 0;
            int tablesUsed = 2;
            int len = 0;
            for (int k = 0; k < tablenameconst.Length; ++k)
            {
                string name = tablenameconst[k];
                if (name.Equals("glyf") || name.Equals("loca"))
                    continue;
                if (tables.IndexOfKey(name) < 0)
                    continue;
                TableData tdata = tables[name];
                if (tdata == null)
                    continue;
                ++tablesUsed;
                fullFontSize += (tdata.Length + 3) & (~3);
            }
            fullFontSize += newLocaTableOut.Length;
            fullFontSize += newGlyfTable.Length;
            int iref = 16 * tablesUsed + 12;
            fullFontSize += iref;
            outFont = new byte[fullFontSize];
            fontPtr = 0;
            WriteFontInt(0x00010000);
            WriteFontShort(tablesUsed);
            int selector = entryselec[tablesUsed];
            WriteFontShort((1 << selector) * 16);
            WriteFontShort(selector);
            WriteFontShort((tablesUsed - (1 << selector)) * 16);
            for (int k = 0; k < tablenameconst.Length; ++k)
            {
                string name = tablenameconst[k];
                if (tables.IndexOfKey(name) < 0)
                    continue;
                TableData tdata = tables[name];
                if (tdata == null)
                    continue;
                WriteFontString(name);
                if (name.Equals("glyf"))
                {
                    WriteFontInt(CalculateChecksum(newGlyfTable));
                    len = glyfTableRealSize;
                }
                else if (name.Equals("loca"))
                {
                    WriteFontInt(CalculateChecksum(newLocaTableOut));
                    len = locaTableRealSize;
                }
                else
                {
                    WriteFontInt(tdata.Checksum);
                    len = tdata.Length;
                }
                WriteFontInt(iref);
                WriteFontInt(len);
                iref += (len + 3) & (~3);
            }
            for (int k = 0; k < tablenameconst.Length; ++k)
            {
                string name = tablenameconst[k];
                if (tables.IndexOfKey(name) < 0)
                    continue;
                TableData tdata = tables[name];
                if (tdata == null)
                    continue;
                if (name.Equals("glyf"))
                {
                    Array.Copy(newGlyfTable, 0, outFont, fontPtr, newGlyfTable.Length);
                    fontPtr += newGlyfTable.Length;
                    newGlyfTable = null;
                }
                else if (name.Equals("loca"))
                {
                    Array.Copy(newLocaTableOut, 0, outFont, fontPtr, newLocaTableOut.Length);
                    fontPtr += newLocaTableOut.Length;
                    newLocaTableOut = null;
                }
                else
                {
                    int nindex = tdata.Location;
                    Array.Copy(rfarray, nindex, outFont, fontPtr, tdata.Length);
                    fontPtr += (tdata.Length + 3) & (~3);
                }
            }
        }
        /// <summary>
        /// Converts a byte array to an uint value
        /// </summary>
        public static uint ByteArrayToUInt(byte[] b1, int index, int alen)
        {
            uint aresult = 0;
            switch (alen)
            {

                case 0:
                    aresult = 0;
                    break;
                case 1:
                    aresult = (uint)b1[index + 0];
                    break;
                case 2:
                    aresult = (uint)b1[index + 0] + (((uint)b1[index + 1]) << 8);
                    break;
                case 3:
                    aresult = (uint)b1[index + 0] + ((uint)b1[index + 1]) * 0xFF + ((uint)b1[index + 2]) * 0xFFFF;
                    break;
                default:
                    aresult = (uint)b1[index + 3] + (((uint)b1[index + 2]) << 8) +
                        (((uint)b1[index + 1]) << 16) + (((uint)b1[index + 0]) << 24);
                    break;
            }
            return (aresult);

        }

        /// <summary>
        /// Converts up to four big-endian bytes of the array to a signed int value.
        /// </summary>
        /// <param name="b1">Source byte array.</param>
        /// <param name="index">Offset of the first byte to read.</param>
        /// <param name="alen">Number of bytes to read (0 to 4).</param>
        /// <returns>The decoded integer value.</returns>
        public static int ByteArrayToInt(byte[] b1, int index, int alen)
        {
            int aresult = 0;
            switch (alen)
            {
                case 0:
                    aresult = 0;
                    break;
                case 1:
                    aresult = (int)b1[index + 0];
                    break;
                case 2:
                    aresult = (int)b1[index + 0] + (((int)b1[index + 1]) << 8);
                    break;
                case 3:
                    aresult = (int)b1[index + 0] + ((int)b1[index + 1]) * 0xFF + ((int)b1[index + 2]) * 0xFFFF;
                    break;
                default:
                    aresult = (int)b1[index + 3] + (((int)b1[index + 2]) << 8) +
                        (((int)b1[index + 1]) << 16) + (((int)b1[index + 0]) << 24);
                    break;
            }
            return (aresult);

        }
        /// <summary>
        /// Converts up to two big-endian bytes of the array to an unsigned 16-bit value.
        /// </summary>
        /// <param name="b1">Source byte array.</param>
        /// <param name="index">Offset of the first byte to read.</param>
        /// <param name="alen">Number of bytes to read (0, 1 or 2).</param>
        /// <returns>The decoded unsigned short value.</returns>
        public static ushort ByteArrayToUShort(byte[] b1, int index, int alen)
        {
            ushort aresult = 0;
            switch (alen)
            {
                case 0:
                    aresult = 0;
                    break;
                case 1:
                    aresult = (ushort)b1[index + 0];
                    break;
                default:
                    aresult = System.Convert.ToUInt16(b1[index + 1] + (b1[index] << 8));
                    break;
            }
            return (aresult);

        }
        /// <summary>
        /// Converts up to two big-endian bytes of the array to a signed 16-bit value.
        /// </summary>
        /// <param name="b1">Source byte array.</param>
        /// <param name="index">Offset of the first byte to read.</param>
        /// <param name="alen">Number of bytes to read (0, 1 or 2).</param>
        /// <returns>The decoded short value.</returns>
        public static short ByteArrayToShort(byte[] b1, int index, int alen)
        {
            short aresult = 0;
            switch (alen)
            {
                case 0:
                    aresult = 0;
                    break;
                case 1:
                    aresult = (short)b1[index + 0];
                    break;
                default:
                    aresult = (short)(((int)b1[index] << 8) + (int)b1[index + 1]);
                    break;
            }
            return (aresult);

        }
        /// <summary>
        /// Reads the PostScript name (name record id 6) of the font whose table directory starts at the given offset.
        /// </summary>
        /// <param name="offset">Byte offset of the font's table directory within the source data.</param>
        /// <returns>The PostScript name, or an empty string if no name table is present.</returns>
        public string GetPostcriptName(int offset)
        {
            int id = ByteArrayToInt(rfarray, Convert.ToInt32(offset), 4);
            offset = offset + 4;
            if (id != 0x00010000)
            {
                throw new Exception("Font collection to font offset error");
            }
            int num_tables = ByteArrayToUShort(rfarray, offset, 2);
            offset = offset + 2;
            offset = offset + 6;
            TableData tdata = null;
            for (int k = 0; k < num_tables; ++k)
            {
                string tag = StreamUtil.ByteArrayToString(rfarray, offset, 4);
                offset = offset + 4;
                int checksum = ByteArrayToInt(rfarray, offset, 4);
                offset = offset + 4;
                int location = ByteArrayToInt(rfarray, offset, 4);
                offset = offset + 4;
                int length = ByteArrayToInt(rfarray, offset, 4);
                offset = offset + 4;
                if (tag == "name")
                {
                    tdata = new TableData(tag, location, length, checksum); ;
                    break;
                }
            }
            if (tdata == null)
            {
                return "";
            }
            offset = tdata.Location;
            ushort format = ByteArrayToUShort(rfarray, offset, 2);
            offset = offset + 2;
            ushort nameCount = ByteArrayToUShort(rfarray, offset, 2);
            offset = offset + 2;
            ushort stringOffset = ByteArrayToUShort(rfarray, offset, 2);
            offset = offset + 2;
            string postName = "";
            for (int i = 0; i < nameCount; i++)
            {
                ushort platformId = ByteArrayToUShort(rfarray, offset, 2);
                offset = offset + 2;
                ushort platformSpecificId = ByteArrayToUShort(rfarray, offset, 2);
                offset = offset + 2;
                ushort languajeId = ByteArrayToUShort(rfarray, offset, 2);
                offset = offset + 2;
                ushort nameId = ByteArrayToUShort(rfarray, offset, 2);
                offset = offset + 2;
                ushort length = ByteArrayToUShort(rfarray, offset, 2);
                offset = offset + 2;
                ushort offset2 = ByteArrayToUShort(rfarray, offset, 2);
                offset = offset + 2;
                int newoffset = tdata.Location + stringOffset + offset2;
                byte[] byteName = new byte[length];
                Array.Copy(rfarray, newoffset, byteName, 0, length);
                string name = null;
                if (platformId == 0)
                {
                    name = UTF8Encoding.Unicode.GetString(byteName);
                }
                else
                    if (platformId == 3)
                {

                    name = "";
                    for (int cidx = 0; cidx < byteName.Length; cidx = cidx + 2)
                    {
                        ushort charint = ByteArrayToUShort(rfarray, newoffset + cidx, 2);
                        char nchar = (char)charint;
                        name = name + nchar;
                    }
                }
                else
                {
                    name = ASCIIEncoding.ASCII.GetString(byteName);
                }
                if (nameId == 6)
                {
                    postName = name;
                    break;
                }
            }
            return postName;
        }
        /// <summary>
        /// Reads the font table directory into <see cref="tables"/>, resolving the requested font inside a
        /// TrueType collection (ttcf) by matching its PostScript name when necessary.
        /// </summary>
        /// <returns>False when this is not a font this subsetter can take apart (CFF outlines or an
        /// unknown format); the caller then embeds the font whole, as the Delphi engine does.</returns>
        protected bool CreateTableDirectory()
        {
            tables = new SortedList<string, TableData>();
            int id = ByteArrayToInt(rfarray, Convert.ToInt32(directoryOffset), 4);
            int nindex = Convert.ToInt32(directoryOffset) + 4;
            if (id != 0x00010000)
            {
                string ttcfHeader = StreamUtil.ByteArrayToString(rfarray, 0, 4);
                // 'OTTO': OpenType con contornos CFF. Esto sabe de `glyf` y `loca`, no de CFF.
                if (ttcfHeader == "OTTO")
                    return false;
                if (ttcfHeader == "ttcf")
                {
                    directoryOffset = directoryOffset + 4;
                    var marjorVersion = ByteArrayToUShort(rfarray, Convert.ToInt32(directoryOffset), 2);
                    directoryOffset = directoryOffset + 2;
                    var minorVersion = ByteArrayToUShort(rfarray, Convert.ToInt32(directoryOffset), 2);
                    directoryOffset = directoryOffset + 2;
                    var numFonts = ByteArrayToUInt(rfarray, Convert.ToInt32(directoryOffset), 4);
                    directoryOffset = directoryOffset + 4;
                    if (numFonts > 1000)
                    {
                        numFonts = 1000;
                    }
                    UInt32[] offsets = new UInt32[numFonts];
                    bool found = false;
                    for (int i = 0; i < numFonts; i++)
                    {
                        UInt32 offset = ByteArrayToUInt(rfarray, Convert.ToInt32(directoryOffset) + i * 4, 4);
                        // El array se rellena AQUI. Estaba declarado y nunca escrito, asi que el
                        // rescate de mas abajo hacia `offsets[0] + 4` = 4 y leia el directorio de
                        // tablas DENTRO de la cabecera 'ttcf': num_tables salia de dos bytes que no
                        // lo son, y el subconjunto salia corrupto o reventaba por indice.
                        offsets[i] = offset;
                        string psName = GetPostcriptName(Convert.ToInt32(offset));
                        string psNameNorm = psName.ToUpper().Replace(',', '-');
                        string postNorm = PostcriptName.ToUpper().Replace(',', '-');

                        if (postNorm == psNameNorm)
                        {
                            found = true;
                            directoryOffset = offset + 4;
                            nindex = Convert.ToInt32(directoryOffset);
                            break;
                        }
                    }
                    if (!found)
                    {
                        directoryOffset = offsets[0] + 4;
                        nindex = Convert.ToInt32(directoryOffset);
                    }
                }
                else
                    return false;
            }
            int num_tables = ByteArrayToUShort(rfarray, nindex, 2);
            nindex = nindex + 2;
            nindex = nindex + 6;

            for (int k = 0; k < num_tables; ++k)
            {
                string tag = StreamUtil.ByteArrayToString(rfarray, nindex, 4);
                nindex = nindex + 4;
                int checksum = ByteArrayToInt(rfarray, nindex, 4);
                nindex = nindex + 4;
                int location = ByteArrayToInt(rfarray, nindex, 4);
                nindex = nindex + 4;
                int length = ByteArrayToInt(rfarray, nindex, 4);
                nindex = nindex + 4;
                tables[tag] = new TableData(tag, location, length, checksum);

            }
            return true;
        }

        /// <summary>
        /// Reads the glyph offsets from the original loca table into <see cref="locaTable"/>, caching the result
        /// per PostScript name and detecting the short/long loca format from the head table.
        /// </summary>
        protected void ReadLoca()
        {



            TableData tdata = tables["head"];
            if (tdata == null)
                throw new Exception("Table head not found");
            int nindex = tdata.Location + HEAD_LOCA_FORMAT_OFFSET;
            //rf.Seek(nindex,SeekOrigin.Begin);
            locaShortTable = (ByteArrayToUShort(rfarray, nindex, 4) == 0);
            nindex = nindex + 4;

            // Cached
            Monitor.Enter(tflag);
            try
            {
                if (CachedlocaTables == null)
                    CachedlocaTables = new SortedList<string, int[]>();
                if (CachedlocaTables.IndexOfKey(PostcriptName) >= 0)
                {
                    locaTable = CachedlocaTables[PostcriptName];
                }
                else
                {
                    tdata = tables["loca"];
                    if (tdata == null)
                        throw new Exception("Table loca not found");
                    nindex = tdata.Location;
                    if (locaShortTable)
                    {
                        int entries = tdata.Length / 2;
                        locaTable = new int[entries];
                        for (int k = 0; k < entries; ++k)
                        {
                            locaTable[k] = ByteArrayToUShort(rfarray, nindex, 2) * 2;
                            nindex = nindex + 2;
                        }
                    }
                    else
                    {
                        int entries = tdata.Length / 4;
                        locaTable = new int[entries];
                        for (int k = 0; k < entries; ++k)
                        {
                            locaTable[k] = ByteArrayToInt(rfarray, nindex, 4);
                            nindex = nindex + 4;
                        }
                    }
                    CachedlocaTables.Add(PostcriptName, locaTable);
                }

            }
            finally
            {
                Monitor.Exit(tflag);
            }
        }

        /// <summary>
        /// Builds the rewritten loca and glyf tables (<see cref="newLocaTable"/> and <see cref="newGlyfTable"/>)
        /// for the subset, copying only the bytes of the glyphs that are actually used.
        /// </summary>
        protected void CreateNewGlyphTables()
        {
            newLocaTable = new int[locaTable.Length];
            int[] activeGlyphs = new int[glyphsInList.Count];
            for (int k = 0; k < activeGlyphs.Length; ++k)
                activeGlyphs[k] = glyphsInList[k];
            Array.Sort(activeGlyphs);
            int glyfSize = 0;
            for (int k = 0; k < activeGlyphs.Length; ++k)
            {
                int glyph = activeGlyphs[k];
                int glyphlength = locaTable[glyph + 1] - locaTable[glyph];
                //if (locaShortTable)
                //    glyphlength = glyphlength * 2;
                glyfSize += glyphlength;
            }
            glyfTableRealSize = glyfSize;
            glyfSize = (glyfSize + 3) & (~3);
            newGlyfTable = new byte[glyfSize];
            int glyfPtr = 0;
            int listGlyf = 0;
            for (int k = 0; k < newLocaTable.Length; ++k)
            {
                int newGlyphPtr = glyfPtr;
                //if (locaShortTable)
                //{
                //    newGlyphPtr = glyfPtr / 2;
                //}
                newLocaTable[k] = newGlyphPtr;
                if (listGlyf < activeGlyphs.Length && activeGlyphs[listGlyf] == k)
                {
                    ++listGlyf;
                    newLocaTable[k] = newGlyphPtr;
                    int start = locaTable[k];
                    int len = locaTable[k + 1] - start;
                    //if (locaShortTable)
                    //    len = len * 2;
                    if (len > 0)
                    {
                        int nindex = tableGlyphOffset + start;
                        ReadBytes(nindex, newGlyfTable, glyfPtr, len);


                        glyfPtr += len;
                    }
                }
            }
        }
        /// <summary>
        /// Copies a run of bytes from the source font array into the given buffer.
        /// </summary>
        /// <param name="nindex">Offset within the source font array to copy from.</param>
        /// <param name="b">Destination buffer.</param>
        /// <param name="off">Offset within the destination buffer to copy to.</param>
        /// <param name="len">Number of bytes to copy.</param>
        public void ReadBytes(int nindex, byte[] b, int off, int len)
        {
            if (len == 0)
                return;
            Array.Copy(rfarray, nindex, b, off, len);
        }


        /// <summary>
        /// Serializes <see cref="newLocaTable"/> into <see cref="newLocaTableOut"/> using the short or long
        /// loca format according to <see cref="locaShortTable"/>.
        /// </summary>
        protected void LocaTobytes()
        {
            if (locaShortTable)
                locaTableRealSize = newLocaTable.Length * 2;
            else
                locaTableRealSize = newLocaTable.Length * 4;
            newLocaTableOut = new byte[(locaTableRealSize + 3) & (~3)];
            outFont = newLocaTableOut;
            fontPtr = 0;
            for (int k = 0; k < newLocaTable.Length; ++k)
            {
                if (locaShortTable)
                    WriteFontShort(newLocaTable[k] / 2);
                else
                    WriteFontInt(newLocaTable[k]);
            }

        }

        /// <summary>
        /// Expands the set of used glyphs so that every component referenced by a composite glyph is included,
        /// always adding glyph 0 (the missing-glyph placeholder).
        /// </summary>
        protected void FlatGlyphs()
        {
            TableData tdata = tables["glyf"];
            if (tdata == null)
                throw new Exception("Table glyf not found");
            int glyph0 = 0;
            if (!glyphsUsed.ContainsKey(glyph0))
            {
                glyphsUsed[glyph0] = null;
                glyphsInList.Add(glyph0);
            }
            tableGlyphOffset = tdata.Location;
            for (int k = 0; k < glyphsInList.Count; ++k)
            {
                int glyph = glyphsInList[k];
                CheckGlyphComposite(glyph);
            }
        }

        /// <summary>
        /// Inspects a glyph and, when it is a composite glyph, adds every referenced component glyph to the subset.
        /// </summary>
        /// <param name="glyph">Index of the glyph to inspect.</param>
        protected void CheckGlyphComposite(int glyph)
        {
            //if (glyph>=(locaTable.Length-1))
            //{
            //    return;
            //}
            int start = locaTable[glyph];
            if (glyph < (locaTable.Length - 1))
            {
                if (start == locaTable[glyph + 1])
                    return;

            }
            int nindex = tableGlyphOffset + start;
            int numContours = (int)ByteArrayToShort(rfarray, nindex, 2);
            nindex = nindex + 2;
            if (numContours >= 0)
                return;
            nindex = nindex + 8;
            for (; ; )
            {
                int flags = ByteArrayToUShort(rfarray, nindex, 2);
                nindex = nindex + 2;
                int cGlyph = ByteArrayToUShort(rfarray, nindex, 2);
                nindex = nindex + 2;
                if (!glyphsUsed.ContainsKey(cGlyph))
                {
                    if (cGlyph < locaTable.Length)
                    {
                        glyphsUsed[cGlyph] = null;
                        glyphsInList.Add(cGlyph);
                    }
                }
                if ((flags & MORE_COMPONENTS) == 0)
                    return;
                int skip;
                if ((flags & ARG_1_AND_2_ARE_WORDS) != 0)
                    skip = 4;
                else
                    skip = 2;
                if ((flags & WE_HAVE_A_SCALE) != 0)
                    skip += 2;
                else if ((flags & WE_HAVE_AN_X_AND_Y_SCALE) != 0)
                    skip += 4;
                if ((flags & WE_HAVE_A_TWO_BY_TWO) != 0)
                    skip += 8;
                nindex = nindex + skip;
            }
        }
        /// <summary>
        /// Writes a 16-bit value in big-endian order to <see cref="outFont"/> and advances the write pointer.
        /// </summary>
        /// <param name="n">Value whose low 16 bits are written.</param>
        protected void WriteFontShort(int n)
        {
            outFont[fontPtr++] = (byte)(n >> 8);
            outFont[fontPtr++] = (byte)(n);
        }

        /// <summary>
        /// Writes a 32-bit value in big-endian order to <see cref="outFont"/> and advances the write pointer.
        /// </summary>
        /// <param name="n">Value to write.</param>
        protected void WriteFontInt(int n)
        {
            outFont[fontPtr++] = (byte)(n >> 24);
            outFont[fontPtr++] = (byte)(n >> 16);
            outFont[fontPtr++] = (byte)(n >> 8);
            outFont[fontPtr++] = (byte)(n);
        }

        /// <summary>
        /// Writes the bytes of the given string to <see cref="outFont"/> and advances the write pointer.
        /// </summary>
        /// <param name="s">String to write, typically a four-character table tag.</param>
        protected void WriteFontString(string s)
        {
            byte[] b = StreamUtil.StringToByteArray(s, s.Length);
            Array.Copy(b, 0, outFont, fontPtr, b.Length);
            fontPtr += b.Length;
        }

        /// <summary>
        /// Computes the TrueType table checksum (the sum of the table's 32-bit big-endian words) for the given bytes.
        /// </summary>
        /// <param name="b">Table bytes to checksum.</param>
        /// <returns>The 32-bit checksum value.</returns>
        protected int CalculateChecksum(byte[] b)
        {
            int len = b.Length / 4;
            int v0 = 0;
            int v1 = 0;
            int v2 = 0;
            int v3 = 0;
            int ptr = 0;
            for (int k = 0; k < len; ++k)
            {
                v3 += (int)b[ptr++] & 0xff;
                v2 += (int)b[ptr++] & 0xff;
                v1 += (int)b[ptr++] & 0xff;
                v0 += (int)b[ptr++] & 0xff;
            }
            return v0 + (v1 << 8) + (v2 << 16) + (v3 << 24);
        }
    }
}