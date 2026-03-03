using System;
using System.IO;
using Reportman.Drawing;
using Reportman.Drawing.CrossPlatform;
using Reportman.Drawing.Windows;
using Reportman.Reporting;

namespace HtmlTestApp
{
    class Program
    {
        static void AddTextBlock(MetaPage mpage, string text, string fontName, int fontSize,
            int left, int top, int width, int height, int alignment, bool isHtml, bool rtl, int penColor)
        {
            // Bounding box
            MetaObjectDraw box = new MetaObjectDraw();
            box.MetaType = MetaObjectType.Draw;
            box.DrawStyle = ShapeType.Rectangle;
            box.Left = left;
            box.Top = top;
            box.Width = width;
            box.Height = height;
            box.PenStyle = 0;
            box.PenColor = penColor;
            box.PenWidth = 10;
            box.BrushStyle = 1;
            mpage.Objects.Add(box);

            // Text object
            MetaObjectText obj = new MetaObjectText();
            obj.MetaType = MetaObjectType.Text;
            obj.Left = left;
            obj.Top = top;
            obj.Width = width;
            obj.Height = height;
            obj.IsHtml = isHtml;
            obj.WordWrap = true;
            obj.RightToLeft = rtl;
            obj.Alignment = alignment;
            obj.TextP = mpage.AddString(text);
            obj.TextS = text.Length;
            obj.WFontNameP = mpage.AddString(fontName);
            obj.WFontNameS = fontName.Length;
            obj.LFontNameP = obj.WFontNameP;
            obj.LFontNameS = obj.WFontNameS;
            obj.FontSize = (short)fontSize;
            obj.Transparent = true;
            obj.FontColor = 0;
            mpage.Objects.Add(obj);
        }

        static void AddLabel(MetaPage mpage, string text, int left, int top)
        {
            MetaObjectText lbl = new MetaObjectText();
            lbl.MetaType = MetaObjectType.Text;
            lbl.Left = left;
            lbl.Top = top;
            lbl.Width = 10000;
            lbl.Height = 400;
            lbl.TextP = mpage.AddString(text);
            lbl.TextS = text.Length;
            string f = "Arial";
            lbl.WFontNameP = mpage.AddString(f);
            lbl.WFontNameS = f.Length;
            lbl.LFontNameP = lbl.WFontNameP;
            lbl.LFontNameS = lbl.WFontNameS;
            lbl.FontSize = 12;
            lbl.Transparent = true;
            lbl.FontColor = 0x888888;
            lbl.FontStyle = 1; // Bold
            mpage.Objects.Add(lbl);
        }

        static void Main(string[] args)
        {
            try
            {
                Console.WriteLine("Generating alignment test PDFs...");

                string htmlText = "This is a much longer paragraph of HTML text designed to <b>test the word wrapping</b> capabilities of the new <span style='font-family: Courier New; font-size: 8'>FreeType manual HTML layout algorithm</span>. <span style='font-family: Arial; font-size: 24'>It needs to span approximately</span> five lines so we can see if line breaks respect the current <i>styling state</i>. We should see line breaks dynamically occur, and any tag that wraps across a line break should retain its properties (like this <u>long underlined section that hopefully breaks in the middle</u>) without leaking to the plain text. The <b>bolding</b> should also continue naturally. 2+2: {{2+2}}, Suma de cadenas ABC: {{'A'+'B'+'C'}}";
                string arabicText = "هذا هو النص الذي يتحدث عن تنسيق PDF وهو تنسيق شهير جداً. سيتم عرض هذا النص على عدة أسطر لضمان اختبار التفاف الكلمات والاتجاه الصحيح للنص العربي الذي يحتوي على كلمات إنجليزية في المنتصف. نأمل أن يتم عرض النص بشكل سليم ومقروء لتأكيد دعم اللغات من اليمين إلى اليسار.";

                int[] alignments = { 1, 4, 2 }; // Left, Center, Right
                string[] alignNames = { "Left", "Center", "Right" };

                MetaFile mfile = new MetaFile();
                mfile.Orientation = OrientationType.Portrait;
                mfile.CustomX = 11906;
                mfile.CustomY = 16838;

                for (int a = 0; a < alignments.Length; a++)
                {
                    MetaPage mpage = new MetaPage(mfile);
                    mfile.Pages.Add(mpage);

                    int boxWidth = 7000;
                    int margin = 500;

                    // Page title
                    AddLabel(mpage, $"Alignment: {alignNames[a]}", margin, 200);

                    // HTML paragraph (mixed fonts)
                    AddLabel(mpage, "HTML Mixed Fonts (Arial 14 + Courier 8 + Arial 24)", margin, 600);
                    AddTextBlock(mpage, htmlText, "Arial", 14,
                        margin, 900, boxWidth, 5000, alignments[a], true, false, 0xFF0000);

                    // Arabic text
                    AddLabel(mpage, "Arabic RTL (Noto Sans Arabic 20)", margin, 6200);
                    AddTextBlock(mpage, arabicText, "Noto Sans Arabic", 20,
                        margin, 6500, boxWidth + 3000, 3500, alignments[a], true, true, 0x0000FF);

                    // Simple non-HTML text
                    AddLabel(mpage, "Plain Text (Arial 14)", margin, 10300);
                    string plainText = "This is a plain text paragraph without any HTML formatting. It tests horizontal alignment in the simplest case with a single font. Word wrapping should work correctly and alignment should be clearly visible.";
                    AddTextBlock(mpage, plainText, "Arial", 14,
                        margin, 10600, boxWidth, 2500, alignments[a], false, false, 0x00A000);

                    // Arabic non-HTML
                    AddLabel(mpage, "Arabic Plain Text (Noto Sans Arabic 20)", margin, 13300);
                    string plainArabic = "هذا هو نص بسيط بدون أي تنسيق HTML. يختبر المحاذاة الأفقية في أبسط حالة مع خط واحد فقط.";
                    AddTextBlock(mpage, plainArabic, "Noto Sans Arabic", 20,
                        margin, 13600, boxWidth + 3000, 2500, alignments[a], false, true, 0x800080);
                }

                mfile.Finish();

                // Generate FreeType PDF
                string ftPdf = Path.GetFullPath("test_alignment_ft.pdf");
                Console.WriteLine("Generating FreeType PDF: " + ftPdf);
                using (PrintOutPDFFreeType pdfDriver = new PrintOutPDFFreeType())
                {
                    pdfDriver.FileName = ftPdf;
                    pdfDriver.Compressed = false;
                    pdfDriver.Print(mfile);
                }

                // Generate GDI PDF
                string gdiPdf = Path.GetFullPath("test_alignment_gdi.pdf");
                Console.WriteLine("Generating GDI PDF: " + gdiPdf);
                using (PrintOutPDF pdfDriver = new PrintOutPDF())
                {
                    pdfDriver.FileName = gdiPdf;
                    pdfDriver.Compressed = false;
                    pdfDriver.Print(mfile);
                }

                Console.WriteLine("Success! (Alignment test)");

                // =============================================
                // Test 2: Load htmltest.rep and generate PDFs
                // =============================================
                // Try several paths to find htmltest.rep
                string repFile = "";
                string[] possiblePaths = {
                    Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "..", "htmltest.rep"),
                    Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "htmltest.rep"),
                    Path.GetFullPath(Path.Combine("tests", "htmltest.rep")),
                    @"c:\Desarrollo\don6-dotnet\Don6_Comun\reportman\tests\htmltest.rep"
                };
                foreach (var p in possiblePaths)
                {
                    string full = Path.GetFullPath(p);
                    if (File.Exists(full))
                    {
                        repFile = full;
                        break;
                    }
                }

                if (!string.IsNullOrEmpty(repFile))
                {
                    Console.WriteLine($"\nLoading report: {repFile}");
                    Report report = new Report();
                    report.LoadFromFile(repFile);

                    // Generate GDI PDF from .rep
                    string repGdiPdf = Path.GetFullPath("htmltest_gdi.pdf");
                    Console.WriteLine("Generating GDI PDF from .rep: " + repGdiPdf);
                    using (PrintOutPDF repGdiDriver = new PrintOutPDF())
                    {
                        repGdiDriver.FileName = repGdiPdf;
                        repGdiDriver.Compressed = false;
                        repGdiDriver.Print(report.MetaFile);
                    }
                    Console.WriteLine("GDI PDF done.");

                    // Generate FreeType PDF from .rep
                    string repFtPdf = Path.GetFullPath("htmltest_ft.pdf");
                    Console.WriteLine("Generating FreeType PDF from .rep: " + repFtPdf);
                    using (PrintOutPDFFreeType repFtDriver = new PrintOutPDFFreeType())
                    {
                        repFtDriver.FileName = repFtPdf;
                        repFtDriver.Compressed = false;
                        repFtDriver.Print(report.MetaFile);
                    }
                    Console.WriteLine("FreeType PDF done.");
                    Console.WriteLine("Success! Both GDI and FreeType PDFs generated from htmltest.rep");
                }
                else
                {
                    Console.WriteLine("\nhtmltest.rep not found. Tried paths:");
                    foreach (var p in possiblePaths)
                        Console.WriteLine("  " + Path.GetFullPath(p));
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("Error: " + ex.Message);
                Console.WriteLine(ex.StackTrace);
            }
        }
    }
}
