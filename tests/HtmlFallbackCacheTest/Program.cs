using System.Collections;
using System.Diagnostics;
using System.Drawing;
using System.Reflection;
using System.Text;
using Reportman.Drawing;
using Reportman.Drawing.CrossPlatform;
using Reportman.Reporting;

// THE METRICS OF A FALLBACK FONT ARE FILLED ONCE PER PROVIDER (19-10-2026).
//
// When a run of an HTML text has characters its font lacks (emoji, CJK in a Latin font), the FreeType
// layout (FontInfoFt.TextExtentHtml) draws them with a fallback font. The font data of that fallback was
// a new TTFontData on every measure, and filling it reads the whole font file from disk: a CJK font is
// 15 to 20 MB, read for every such text of a report. The variants of the text itself were already kept in
// fontDataCache (20d0628, 07-10-2026); the fallback now goes there too, under the same key.
//
// Checked with the .NET engine (PrintOutPDFFreeType): the CJK characters get a fallback family, its
// font data is in the cache of the provider after the first measure, and measuring again reuses it.

namespace HtmlFallbackCacheTest
{
    static class Program
    {
        static int failures;
        const string Html = "alpha 中文字体 omega";

        static void Check(bool ok, string name, string detail = "")
        {
            if (ok) Console.WriteLine("[PASS] " + name);
            else { Console.WriteLine("[FAIL] " + name + (detail.Length > 0 ? " -> " + detail : "")); failures++; }
        }

        static int Main()
        {
            Console.OutputEncoding = Encoding.UTF8;
            try
            {
                using var d = new PrintOutPDFFreeType { FileName = "", Compressed = false };
                var r = Report();
                d.Print(r.MetaFile);
                var provider = (FontInfoFt)d.GetFontInfoProvider();
                var cache = (IDictionary)typeof(FontInfoFt)
                    .GetField("fontDataCache", BindingFlags.NonPublic | BindingFlags.Instance)
                    .GetValue(provider);

                var lines = Measure(d);
                string family = null;
                foreach (var line in lines)
                    foreach (var g in line.Glyphs ?? new List<TGlyphPos>())
                        if (g.CharCode == '中')
                            family = g.FontFamily;
                Check(!string.IsNullOrEmpty(family) && !family.Equals("Arial", StringComparison.OrdinalIgnoreCase),
                    "the CJK characters are drawn with a fallback font", $"family={family}");

                object fallback = null;
                string fallbackKey = null;
                if (!string.IsNullOrEmpty(family))
                    foreach (DictionaryEntry e in cache)
                        if (((string)e.Key).StartsWith(family.Replace(" ", ""), StringComparison.OrdinalIgnoreCase))
                        {
                            fallbackKey = (string)e.Key;
                            fallback = e.Value;
                        }
                Check(fallback != null, "the font data of the fallback is kept in the cache of the provider",
                    "keys: " + string.Join(", ", cache.Keys.Cast<string>()));

                int entries = cache.Count;
                const int rounds = 200;
                var watch = Stopwatch.StartNew();
                for (int i = 0; i < rounds; i++)
                    Measure(d);
                watch.Stop();
                Console.WriteLine($"   (info) {rounds} measures in {watch.ElapsedMilliseconds} ms " +
                    $"({watch.Elapsed.TotalMilliseconds / rounds:F2} ms each), fallback {family}");
                Check(cache.Count == entries, "measuring again adds nothing to the cache", $"{entries} -> {cache.Count}");
                Check(fallback == null || ReferenceEquals(cache[fallbackKey], fallback),
                    "measuring again reuses the same font data of the fallback");
            }
            catch (Exception ex)
            {
                Console.WriteLine("[FAIL] exception: " + ex);
                failures++;
            }
            Console.WriteLine(failures == 0 ? "ALL PASS" : failures + " FAILURE(S)");
            return failures == 0 ? 0 : 1;
        }

        static List<LineInfo> Measure(PrintOutPDFFreeType d)
        {
            var text = new TextObjectStruct
            {
                Text = Html, WFontName = "Arial", LFontName = "Arial", FontSize = 10, Type1Font = PDFFontType.Embedded,
                WordWrap = true, IsHtml = true,
            };
            var extent = new Point(10000, 100000);
            return d.TextExtentLineInfo(text, ref extent);
        }

        static Report Report()
        {
            var r = new Report();
            r.CreateNew();
            r.PageSize = PageSizeType.User;
            r.CustomPageWidth = 11906;
            r.CustomPageHeight = 16838;
            var s = r.SubReports[0].Sections[r.SubReports[0].FirstDetail];
            var l = new LabelItem
            {
                Report = r, Section = s, PosX = 0, PosY = 0, Width = 10000, Height = 300,
                WFontName = "Arial", LFontName = "Arial", FontSize = 10, Type1Font = PDFFontType.Embedded,
                Transparent = true,
            };
            r.GenerateNewName(l);
            l.Text = "x";
            s.Components.Add(l);
            r.AsyncExecution = false;
            return r;
        }
    }
}
