using System.Drawing;
using System.Text;
using Reportman.Drawing;
using Reportman.Drawing.CrossPlatform;
using Reportman.Reporting;
using UglyToad.PdfPig;

// AN EMPTY LINE OF AN HTML TEXT TAKES ITS HEIGHT (18-10-2026).
//
// "a<br><br>b" is three lines: a, a blank one, b. The FreeType layout (FontInfoFt.TextExtentHtml) only
// added a line when it had glyphs, so the blank one vanished, both when measuring and when drawing,
// and the paragraphs of a contract printed one against the other. DirectWrite, with the same plain
// text, keeps it.
//
// Checked with the .NET engine (PrintOutPDFFreeType): the measured height grows by one line per empty
// line, and in the PDF the second word is one line lower with the blank line than without it.

namespace HtmlBlankLineTest
{
    static class Program
    {
        static int failures;

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
                int two = Height("alpha<br>omega");
                int three = Height("alpha<br><br>omega");
                int four = Height("alpha<br><br><br>omega");
                int line = two / 2;
                Check(two > 0, "two lines have a height", $"h={two}");
                Check(Math.Abs(three - (two + line)) <= 2, "an empty line adds one line of height", $"2 lines={two} 3 lines={three}");
                Check(Math.Abs(four - (two + 2 * line)) <= 4, "two empty lines add two lines of height", $"2 lines={two} 4 lines={four}");
                Check(Height("<p>alpha</p>\n<p>omega</p>") == three, "a source newline between paragraphs is a blank line",
                    $"h={Height("<p>alpha</p>\n<p>omega</p>")}");

                double gapWithout = Gap("alpha<br>omega");
                double gapWith = Gap("alpha<br><br>omega");
                Check(gapWith > gapWithout * 1.7, "in the PDF, the word after an empty line is one line lower",
                    $"gap without={gapWithout:F1} with={gapWith:F1}");
            }
            catch (Exception ex)
            {
                Console.WriteLine("[FAIL] exception: " + ex);
                failures++;
            }
            Console.WriteLine(failures == 0 ? "ALL PASS" : failures + " FAILURE(S)");
            return failures == 0 ? 0 : 1;
        }

        static TextObjectStruct Text(string html) => new TextObjectStruct
        {
            Text = html, WFontName = "Arial", LFontName = "Arial", FontSize = 10, Type1Font = PDFFontType.Embedded,
            WordWrap = true, IsHtml = true,
        };

        /// <summary>The measured height of an HTML text 10000 twips wide.</summary>
        static int Height(string html)
        {
            using var d = new PrintOutPDFFreeType { FileName = "", Compressed = false };
            var r = Report("x");
            d.Print(r.MetaFile);
            var extent = new Point(10000, 100000);
            d.TextExtentLineInfo(Text(html), ref extent);
            return extent.Y;
        }

        /// <summary>The vertical distance, in PDF points, from "alpha" to "omega".</summary>
        static double Gap(string html)
        {
            byte[] pdf = Pdf(Report(html));
            using var doc = PdfDocument.Open(new MemoryStream(pdf));
            var words = doc.GetPage(1).GetWords().ToList();
            var a = words.First(w => w.Text == "alpha");
            var o = words.First(w => w.Text == "omega");
            return a.BoundingBox.Bottom - o.BoundingBox.Bottom;
        }

        static Report Report(string html)
        {
            var r = new Report();
            r.CreateNew();
            r.PageSize = PageSizeType.User;
            r.CustomPageWidth = 11906;
            r.CustomPageHeight = 16838;
            r.LeftMargin = 500; r.TopMargin = 500; r.RightMargin = 500; r.BottomMargin = 500;
            var s = r.SubReports[0].Sections[r.SubReports[0].FirstDetail];
            s.Height = 3000;
            var l = new LabelItem
            {
                Report = r, Section = s, PosX = 0, PosY = 0, Width = 10000, Height = 2500,
                WFontName = "Arial", LFontName = "Arial", FontSize = 10, Type1Font = PDFFontType.Embedded,
                Transparent = true, WordWrap = true, IsHtml = true,
            };
            r.GenerateNewName(l);
            l.Text = html;
            s.Components.Add(l);
            r.AsyncExecution = false;
            return r;
        }

        static byte[] Pdf(Report r)
        {
            r.MetaFile.Clear();
            using var d = new PrintOutPDFFreeType { FileName = "", Compressed = false };
            d.Print(r.MetaFile);
            using var ms = new MemoryStream();
            d.PDFStream.Position = 0;
            d.PDFStream.CopyTo(ms);
            return ms.ToArray();
        }
    }
}
