using System.Text;
using Reportman.Drawing;
using Reportman.Drawing.CrossPlatform;
using Reportman.Reporting;
using UglyToad.PdfPig;

// A MULTIPAGE HTML EXPRESSION IN AN AUTOEXPAND SECTION MEASURES ITSELF AT ITS WIDTH (18-10-2026).
//
// A long HTML text (a contract) in an AutoExpand section, followed by another subreport (the signatures).
// The text fitted on the first page, but the signatures were printed on the second one: when the section
// was measured, TrySplitHtmlForMultipage measured at PrintWidth, which is only set once the item has been
// printed (0 the first time). At width 0 every character was a line, the text "did not fit", and the
// section took the rest of the page.
//
// Checked here, with the .NET engine (PrintOutPDFFreeType):
//  1. With MultiPage, what follows the text lands where it lands without MultiPage: same page, same top.
//  2. A text that does not fit on one page still continues on the next one, with nothing lost.

namespace HtmlMultiPageExtentTest
{
    static class Program
    {
        static int failures;
        const int BoxWidth = 10000;

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
                string shortText = Paragraphs(12);
                var (pagesOn, pageOn, topOn) = Follower(shortText, multiPage: true);
                var (pagesOff, pageOff, topOff) = Follower(shortText, multiPage: false);
                Check(pagesOff == 1 && pageOff == 0, "without MultiPage the text and what follows fit on one page",
                    $"pages={pagesOff} page={pageOff}");
                Check(pagesOn == 1 && pageOn == 0, "with MultiPage, what follows a text that fits stays on the first page",
                    $"pages={pagesOn} page={pageOn} top={topOn}");
                Check(topOn == topOff, "with MultiPage, what follows starts where it starts without MultiPage",
                    $"with={topOn} without={topOff}");

                string longText = Paragraphs(90);
                var r = Report(longText, multiPage: true);
                byte[] pdf = Pdf(r);
                using var doc = PdfDocument.Open(new MemoryStream(pdf));
                string all = string.Join(" ", doc.GetPages().Select(p => p.Text));
                Check(doc.NumberOfPages > 1, "a text that does not fit continues on the next page", $"pages={doc.NumberOfPages}");
                Check(all.Contains("Paragraph 1 ") && all.Contains("Paragraph 90 "), "nothing of the long text is lost");
                Check(doc.GetPage(doc.NumberOfPages).Text.Contains("AFTER"), "what follows the long text comes after it");
            }
            catch (Exception ex)
            {
                Console.WriteLine("[FAIL] exception: " + ex);
                failures++;
            }
            Console.WriteLine(failures == 0 ? "ALL PASS" : failures + " FAILURE(S)");
            return failures == 0 ? 0 : 1;
        }

        static string Paragraphs(int count)
        {
            var sb = new StringBuilder();
            for (int i = 1; i <= count; i++)
                sb.Append("<p><b>Paragraph ").Append(i).Append(" </b>The provider maintains the software, answers the ")
                  .Append("incidents and delivers the new versions while the contract is in force.</p>\n");
            return sb.ToString();
        }

        /// <summary>The page and top of the label printed after the text, and the page count.</summary>
        static (int Pages, int Page, int Top) Follower(string html, bool multiPage)
        {
            var r = Report(html, multiPage);
            Pdf(r);
            var mf = r.MetaFile;
            for (int p = 0; p < mf.Pages.CurrentCount; p++)
                for (int i = 0; i < mf.Pages[p].Objects.Count; i++)
                    if (mf.Pages[p].Objects[i] is MetaObjectText t && mf.Pages[p].GetText(t) == "AFTER")
                        return (mf.Pages.CurrentCount, p, t.Top);
            return (mf.Pages.CurrentCount, -1, -1);
        }

        static Report Report(string html, bool multiPage)
        {
            var r = new Report();
            r.CreateNew();
            r.PageSize = PageSizeType.User;
            r.CustomPageWidth = 11906;
            r.CustomPageHeight = 16838;
            r.LeftMargin = 500; r.TopMargin = 500; r.RightMargin = 500; r.BottomMargin = 500;

            // The text, in its own AutoExpand section.
            var text = r.SubReports[0].Sections[r.SubReports[0].FirstDetail];
            text.Height = 600;
            text.AutoExpand = true;
            var e = new ExpressionItem
            {
                Report = r, Section = text, PosX = 0, PosY = 100, Width = BoxWidth, Height = 400,
                WFontName = "Arial", LFontName = "Arial", FontSize = 10, Type1Font = PDFFontType.Embedded,
                Transparent = true, WordWrap = true, CutText = false, IsHtml = true, MultiPage = multiPage,
                Expression = "'" + html.Replace("'", "''") + "'",
            };
            r.GenerateNewName(e);
            text.Components.Add(e);

            // What follows, in another subreport: the signatures of a contract.
            var sr = r.AddSubReport();
            var after = sr.Sections[sr.FirstDetail];
            after.Height = 2000;
            var l = new LabelItem
            {
                Report = r, Section = after, PosX = 0, PosY = 0, Width = BoxWidth, Height = 300,
                WFontName = "Arial", LFontName = "Arial", FontSize = 10, Type1Font = PDFFontType.Embedded,
                Transparent = true,
            };
            r.GenerateNewName(l);
            l.Text = "AFTER";
            after.Components.Add(l);
            return r;
        }

        static byte[] Pdf(Report r)
        {
            r.AsyncExecution = false;
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
