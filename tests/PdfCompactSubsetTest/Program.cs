using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Reportman.Drawing;
using Reportman.Drawing.CrossPlatform;
using Reportman.Reporting;

namespace PdfCompactSubsetTest
{
    // Validates the compact font subset of the FreeType PDF driver (hb-subset plan API + /CIDToGIDMap):
    // 1. hb-subset with the plan API renumbers the glyphs and reports the old -> new map.
    // 2. The embedded FontFile2 of a compact subset is smaller than the one that keeps the indices.
    // 3. A compact subset comes with a /CIDToGIDMap stream; the retained one keeps /Identity.
    // 4. The Tj payload (the original glyph indices) is identical in both PDFs: only the font
    //    stream and the map differ, so a viewer reads the same text either way.
    // 5. The whole PDF shrinks.
    class Program
    {
        static int failures = 0;

        static void Check(bool condition, string name, string detail = "")
        {
            if (condition)
                Console.WriteLine("[PASS] " + name);
            else
            {
                Console.WriteLine("[FAIL] " + name + (detail.Length > 0 ? " -> " + detail : ""));
                failures++;
            }
        }

        static Report Build()
        {
            Report r = new Report();
            r.CreateNew();
            r.PageSize = PageSizeType.User;
            r.CustomPageWidth = 11906;
            r.CustomPageHeight = 16838;
            Section s = r.SubReports[0].Sections[r.SubReports[0].FirstDetail];
            s.Height = 6000;
            Add(r, s, 0, "Factura simplificada 34,90 EUR — Tienda de Pruebas SL", "Arial", 12, false, false);
            Add(r, s, 600, "TOTAL 34,90", "Arial", 16, true, false);
            Add(r, s, 1400, "مرحبا بالعالم هذا اختبار 123", "Arial", 12, false, true);
            Add(r, s, 2200, "Gracias por su visita — Vielen Dank — Merci — Obrigado", "Arial", 10, false, false);
            return r;
        }

        static void Add(Report r, Section s, int y, string text, string font, short size, bool bold, bool rtl)
        {
            LabelItem l = new LabelItem
            {
                Report = r, Section = s, PosX = 0, PosY = y, Width = 11000, Height = 500,
                WFontName = font, LFontName = font, FontSize = size, FontStyle = (short)(bold ? 1 : 0),
                Transparent = true, WordWrap = true, CutText = false, RightToLeft = rtl,
            };
            r.GenerateNewName(l);
            l.Text = text;
            s.Components.Add(l);
        }

        static byte[] Pdf(bool compact)
        {
            HbSubset.CompactSubsets = compact;
            Report r = Build();
            r.AsyncExecution = false;
            using (PrintOutPDFFreeType d = new PrintOutPDFFreeType { FileName = "", Compressed = false })
            {
                d.Print(r.MetaFile);
                MemoryStream ms = new MemoryStream();
                d.PDFStream.Position = 0;
                d.PDFStream.CopyTo(ms);
                return ms.ToArray();
            }
        }

        static int FontFileBytes(string pdf)
        {
            // Uncompressed: the /Length of every stream a font descriptor points to with /FontFile2.
            int total = 0;
            foreach (Match m in Regex.Matches(pdf, @"/FontFile2 (\d+) 0 R"))
            {
                Match obj = Regex.Match(pdf, @"(?m)^" + m.Groups[1].Value + @" 0 obj\s*<<[^>]*?/Length (\d+)");
                if (obj.Success) total += int.Parse(obj.Groups[1].Value);
            }
            return total;
        }

        static string Payload(string pdf)
        {
            return string.Join("|", Regex.Matches(pdf, @"<([0-9A-Fa-f]+)>\s*Tj").Cast<Match>().Select(m => m.Groups[1].Value));
        }

        static void Main(string[] args)
        {
            try
            {
                HbSubset.Init();
                Console.WriteLine("HbSubset: " + HbSubset.Available + " " + HbSubset.LibraryName);
                if (!HbSubset.Available)
                {
                    Console.WriteLine("[SKIP] hb-subset not available on this machine");
                    return;
                }

                // --- 1. The plan API renumbers and tells the map ---
                string arial = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Fonts), "arial.ttf");
                if (!File.Exists(arial)) arial = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf";
                byte[] font = File.ReadAllBytes(arial);
                int[] wanted = { 36, 68, 72, 3, 1500 };     // A a e space and a high one
                SortedList<int, int> map;
                byte[] compact = HbSubset.Subset(font, 0, wanted, true, out map);
                SortedList<int, int> ignored;
                byte[] retained = HbSubset.Subset(font, 0, wanted, false, out ignored);
                Check(compact != null && map != null && map.Count == wanted.Length, "Compact subset returns a map for every requested glyph",
                    "compact=" + (compact == null ? -1 : compact.Length) + " map=" + (map == null ? -1 : map.Count));
                Check(map != null && map.Values.All(v => v > 0 && v <= wanted.Length + 8) && map.Values.Distinct().Count() == map.Count,
                    "New glyph indices are small and distinct", map == null ? "" : string.Join(",", map.Select(kv => kv.Key + "->" + kv.Value)));
                Check(compact != null && retained != null && compact.Length < retained.Length,
                    "Compact subset is smaller than the retained one", (compact == null ? -1 : compact.Length) + " vs " + (retained == null ? -1 : retained.Length));

                // --- 2..5. Through the PDF driver ---
                string pdfCompact = Encoding.Latin1.GetString(Pdf(true));
                string pdfRetained = Encoding.Latin1.GetString(Pdf(false));
                HbSubset.CompactSubsets = true;

                int bytesCompact = FontFileBytes(pdfCompact), bytesRetained = FontFileBytes(pdfRetained);
                Check(bytesCompact > 0 && bytesCompact < bytesRetained, "Embedded font bytes shrink with the compact subset",
                    bytesCompact + " vs " + bytesRetained);
                Check(Regex.IsMatch(pdfCompact, @"/CIDToGIDMap \d+ 0 R") && !pdfCompact.Contains("/CIDToGIDMap /Identity"),
                    "Compact PDF references a /CIDToGIDMap stream for its embedded fonts");
                Check(pdfRetained.Contains("/CIDToGIDMap /Identity") && !Regex.IsMatch(pdfRetained, @"/CIDToGIDMap \d+ 0 R"),
                    "Retained PDF keeps /CIDToGIDMap /Identity");
                Check(Payload(pdfCompact) == Payload(pdfRetained) && Payload(pdfCompact).Length > 0,
                    "The Tj payload (original glyph indices) is identical in both PDFs");
                Console.WriteLine("  font bytes " + bytesRetained + " -> " + bytesCompact + "; PDF " + pdfRetained.Length + " -> " + pdfCompact.Length + " B (uncompressed)");
                Check(pdfCompact.Length < pdfRetained.Length, "The whole PDF shrinks");

                Console.WriteLine();
                Console.WriteLine(failures == 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED");
                Environment.Exit(failures == 0 ? 0 : 1);
            }
            catch (Exception ex)
            {
                Console.WriteLine("[ERROR] " + ex);
                Environment.Exit(2);
            }
        }
    }
}
