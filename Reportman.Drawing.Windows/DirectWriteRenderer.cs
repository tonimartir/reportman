using Reportman.Drawing;
using SharpDX;
using SharpDX.Direct2D1;
using SharpDX.DirectWrite;
using SharpDX.Mathematics.Interop;
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;

namespace Reportman.Drawing.Windows
{

    public class TGlyphLine
    {
        public float BaselineY;
        public List<TGlyphPos> Glyphs = new List<TGlyphPos>();
        public bool IsRTL;
        public bool LastRunIsLTR;
        public int LastRunLength;
        public int RunCount;

        public TGlyphLine(float baselineY, bool isRTL)
        {
            BaselineY = baselineY;
            IsRTL = isRTL;
        }
    }

    public class TFontFaceCache : Dictionary<IntPtr, string> { }

    public class TTextExtentRenderer : TextRendererBase
    {
        private const float DIP_TO_TWIPS_FACTOR = 15.0f;

        private string _originalText;
        private int TextLength;
        public FontFace _fontFace;
        private TFontFaceCache _fontFamilyCache = new TFontFaceCache();

        public List<TGlyphPos> GlyphPositions { get; } = new List<TGlyphPos>();
        public List<TGlyphLine> Lines { get; } = new List<TGlyphLine>();

        public TTextExtentRenderer(string originalText)
        {
            _originalText = originalText;
            TextLength = originalText.Length;
        }

        private TGlyphLine GetLineByBaseline(float baselineY, bool firstRunIsRTL)
        {
            foreach (var line in Lines)
            {
                if (Math.Abs(line.BaselineY - baselineY) < 0.01f)
                {
                    line.RunCount++;
                    return line;
                }
            }

            var newLine = new TGlyphLine(baselineY, firstRunIsRTL)
            {
                LastRunIsLTR = !firstRunIsRTL,
                RunCount = 1
            };
            Lines.Add(newLine);
            return newLine;
        }

        private string GetFontFamily(FontFace fontFace)
        {
            if (fontFace == null) return string.Empty;

            IntPtr ptr = fontFace.NativePointer;
            if (_fontFamilyCache.TryGetValue(ptr, out string cached))
                return cached;

            string familyName = FontUtils.GetFontFamilyFromFontFace(fontFace);
            _fontFamilyCache[ptr] = familyName;
            return familyName;
        }

        public override Result DrawGlyphRun(
            object clientDrawingContext,
            float baselineOriginX,
            float baselineOriginY,
            MeasuringMode measuringMode,
            GlyphRun glyphRun,
            GlyphRunDescription glyphRunDescription,
            ComObject clientDrawingEffect)
        {
            bool runIsRTL = (glyphRun.BidiLevel % 2) == 1;
            var line = GetLineByBaseline(baselineOriginY, runIsRTL);

            var glyphList = new List<TGlyphPos>();
            int glyphCount = glyphRun.Indices.Length;
            int clusterIndexCount = glyphRunDescription.Text.Length;
            var clusterDic = new  SortedList<int, int>();

            // Leer ClusterMap desde IntPtr
            ushort[] clusterMap = new ushort[clusterIndexCount];
            // if (glyphRunDescription.ClusterMap != IntPtr.Zero && count > 0)
                Utilities.Read(glyphRunDescription.ClusterMap, clusterMap, 0, clusterIndexCount);
            //Marshal.Copy(glyphRunDescription.ClusterMap, (short[])(object)clusterMap, 0, count);
            for (int i = 0;i<clusterIndexCount;i++)
            {
                var firstGlyph = clusterMap[i];
                if (!clusterDic.ContainsKey(firstGlyph))
                    clusterDic.Add(firstGlyph, i);
            }
            int currentCluster = 0;
            for (int i = 0; i < glyphCount; i++)
            {
                if (clusterDic.ContainsKey(i))
                {
                    currentCluster = clusterDic[i];
                }
                int textIndex = glyphRunDescription.TextPosition + currentCluster;
                var pos = new TGlyphPos
                {
                    GlyphIndex = glyphRun.Indices[i],
                    XAdvance = glyphRun.Advances != null ? (int)Math.Round(glyphRun.Advances[i] * DIP_TO_TWIPS_FACTOR) : 0,
                    YAdvance = 0,
                    Cluster = currentCluster,
                    LineCluster = textIndex
                };
                if (pos.LineCluster>=TextLength)
                {
                    throw new Exception("Cluster out of range");
                }
                else
                {
                    if (pos.LineCluster == TextLength)
                    {
                        pos.CharCode = (char)0;
                    } else
                    {
                        pos.CharCode = _originalText[pos.LineCluster];
                    }
                }

                if (glyphRun.Offsets != null)
                {
                    var off = glyphRun.Offsets[i];
                    pos.XOffset = (int)Math.Round(-off.AdvanceOffset * DIP_TO_TWIPS_FACTOR);
                    pos.YOffset = (int)Math.Round(off.AscenderOffset * DIP_TO_TWIPS_FACTOR);
                }
                if (_fontFace != glyphRun.FontFace)
                {
                    pos.FontFamily = GetFontFamily(glyphRun.FontFace);
                }

                glyphList.Add(pos);
                GlyphPositions.Add(pos);
            }

            // Invertir run si es RTL
            if (runIsRTL)
                glyphList.Reverse();

            // Insertar según dirección dominante de la línea
            if (line.IsRTL)
            {
                if (line.LastRunIsLTR && !runIsRTL)
                    line.Glyphs.InsertRange(line.LastRunLength, glyphList);
                else
                    line.Glyphs.InsertRange(0, glyphList);
            }
            else
            {
                line.Glyphs.AddRange(glyphList);
            }

            line.LastRunIsLTR = !runIsRTL;
            line.LastRunLength = line.LastRunIsLTR ? line.LastRunLength + glyphList.Count : 0;

            return Result.Ok;
        }


        public override Result DrawUnderline(object clientDrawingContext, float baselineOriginX, float baselineOriginY,
            ref Underline underline, ComObject clientDrawingEffect)
        {
            return Result.Ok;
        }

        public override Result DrawStrikethrough(object clientDrawingContext, float baselineOriginX, float baselineOriginY,
            ref Strikethrough strikethrough, ComObject clientDrawingEffect)
        {
            return Result.Ok;
        }

        public override Result DrawInlineObject(object clientDrawingContext, float originX, float originY,
            InlineObject inlineObject, bool isSideways, bool isRightToLeft, ComObject clientDrawingEffect)
        {
            return Result.Ok;
        }

        public override bool IsPixelSnappingDisabled(object clientDrawingContext)
        {
            return false;
        }

        public override RawMatrix3x2 GetCurrentTransform(object clientDrawingContext)
        {
            return new RawMatrix3x2 { M11 = 1f, M22 = 1f };
        }

        public override float GetPixelsPerDip(object clientDrawingContext)
        {
            return 1f;
        }
    }

    public static class FontUtils
    {
        private const uint NAME_TABLE_TAG = 0x656D616E; // 'eman' en little endian invertido

        private static ushort SwapWord(ushort value) => (ushort)(((value & 0xFF) << 8) | (value >> 8));

        private static void SwapUTF16Bytes(IntPtr ptr, int lengthInBytes)
        {
            for (int i = 0; i < lengthInBytes; i += 2)
            {
                byte b0 = Marshal.ReadByte(ptr, i);
                byte b1 = Marshal.ReadByte(ptr, i + 1);
                Marshal.WriteByte(ptr, i, b1);
                Marshal.WriteByte(ptr, i + 1, b0);
            }
        }

        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        private struct NameTableHeader
        {
            public ushort formatSelector;
            public ushort count;
            public ushort stringOffset;
        }

        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        private struct NameRecord
        {
            public ushort platformID;
            public ushort encodingID;
            public ushort languageID;
            public ushort nameID;
            public ushort length;
            public ushort offset;
        }

        public static string GetFontFamilyFromFontFace(FontFace fontFace)
        {
            if (fontFace == null)
                return string.Empty;

            if (!fontFace.TryGetFontTable((int)NAME_TABLE_TAG, out var tableData, out IntPtr tableContext) || tableData.Pointer == IntPtr.Zero)
                return string.Empty;

            try
            {
                int tableSize = tableData.Size;
                if (tableSize < Marshal.SizeOf<NameTableHeader>())
                    return string.Empty;

                // Leer header
                NameTableHeader header = Marshal.PtrToStructure<NameTableHeader>(tableData.Pointer);
                ushort recordCount = SwapWord(header.count);
                ushort stringOffset = SwapWord(header.stringOffset);

                IntPtr recordsBasePtr = IntPtr.Add(tableData.Pointer, Marshal.SizeOf<NameTableHeader>());

                for (int i = 0; i < recordCount; i++)
                {
                    IntPtr currentRecordPtr = IntPtr.Add(recordsBasePtr, i * Marshal.SizeOf<NameRecord>());
                    if (currentRecordPtr.ToInt64() + Marshal.SizeOf<NameRecord>() > tableData.Pointer.ToInt64() + tableSize)
                        break;

                    NameRecord record = Marshal.PtrToStructure<NameRecord>(currentRecordPtr);

                    if (SwapWord(record.nameID) != 1)
                        continue; // Solo NameID = 1 (Font Family)

                    ushort platformID = SwapWord(record.platformID);
                    ushort encodingID = SwapWord(record.encodingID);

                    if (!(platformID == 0 || (platformID == 3 && (encodingID == 1 || encodingID == 10))))
                        continue; // Solo Unicode/Windows Unicode

                    ushort lengthInBytes = SwapWord(record.length);
                    ushort offset = SwapWord(record.offset);
                    IntPtr strPtr = IntPtr.Add(tableData.Pointer, stringOffset + offset);

                    if (strPtr.ToInt64() + lengthInBytes > tableData.Pointer.ToInt64() + tableSize)
                        continue;

                    // Copiar y swap
                    byte[] buffer = new byte[lengthInBytes];
                    Marshal.Copy(strPtr, buffer, 0, lengthInBytes);

                    GCHandle handle = GCHandle.Alloc(buffer, GCHandleType.Pinned);
                    try
                    {
                        SwapUTF16Bytes(handle.AddrOfPinnedObject(), lengthInBytes);
                        return Marshal.PtrToStringUni(handle.AddrOfPinnedObject(), lengthInBytes / 2);
                    }
                    finally
                    {
                        handle.Free();
                    }
                }
            }
            finally
            {
                fontFace.ReleaseFontTable(tableContext);
            }

            return string.Empty;
        }
    }
}
