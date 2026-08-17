using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Reportman.Drawing;
using Reportman.Drawing.CrossPlatform;
using Reportman.Reporting;

namespace PdfUnicodePromotionTest
{
    // A label whose font is a PDF standard one (Type1Font = Helvetica, the default) but whose text is
    // outside WinAnsi (Greek, Cyrillic, Japanese) used to come out as '?': the writer converted the text
    // to Windows-1252 before looking for a TrueType font. Now the canvas promotes such text to an
    // embedded TrueType font, exactly as it does for right-to-left text. This bench checks, on the
    // FreeType PDF driver and on the GDI one:
    // 1. The ToUnicode CMap of the PDF maps the Greek, Cyrillic and Japanese code points (the glyphs
    //    are there, with the right characters behind them).
    // 2. No '?' (U+003F) is written anywhere: nothing was lost in a code page conversion.
    // 3. A plain Latin label keeps its standard font on the GDI driver (no promotion when not needed).
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
            Add(r, s, 0, "Factura simplificada 34,90 EUR - Tienda de Pruebas SL", "Arial");
            Add(r, s, 600, "Ευχαριστώ πολύ", "Arial");            // Greek
            Add(r, s, 1200, "Спасибо за покупку", "Arial");         // Cyrillic
            Add(r, s, 1800, "ありがとうございました 日本語", "MS Gothic"); // Japanese
            return r;
        }

        static void Add(Report r, Section s, int y, string text, string font)
        {
            LabelItem l = new LabelItem
            {
                Report = r, Section = s, PosX = 0, PosY = y, Width = 11000, Height = 500,
                WFontName = font, LFontName = font, FontSize = 12,
                Transparent = true, WordWrap = true, CutText = false,
                // Type1Font left at its default: Helvetica, a PDF standard font.
            };
            r.GenerateNewName(l);
            l.Text = text;
            s.Components.Add(l);
        }

        static string PdfFreeType()
        {
            Report r = Build();
            r.AsyncExecution = false;
            using (PrintOutPDFFreeType d = new PrintOutPDFFreeType { FileName = "", Compressed = false })
            {
                d.Print(r.MetaFile);
                MemoryStream ms = new MemoryStream();
                d.PDFStream.Position = 0;
                d.PDFStream.CopyTo(ms);
                return Encoding.Latin1.GetString(ms.ToArray());
            }
        }

        // The driver with no font provider (Delphi-Android parity): standard fonts, nothing embedded.
        static string PdfStandard()
        {
            Report r = Build();
            r.AsyncExecution = false;
            using (PrintOutPDFStandard d = new PrintOutPDFStandard { FileName = "", Compressed = false })
            {
                d.Print(r.MetaFile);
                MemoryStream ms = new MemoryStream();
                d.PDFStream.Position = 0;
                d.PDFStream.CopyTo(ms);
                return Encoding.Latin1.GetString(ms.ToArray());
            }
        }

        static string PdfGdi(string path)
        {
            Report r = Build();
            r.AsyncExecution = false;
            using (PrintOutPDF d = new PrintOutPDF { FileName = path, Compressed = false })
            {
                d.Print(r.MetaFile);
            }
            return Encoding.Latin1.GetString(File.ReadAllBytes(path));
        }

        // The ToUnicode CMaps of the PDF: "<gid> <unicode>" lines. Returns the set of code points mapped.
        static string[] MappedCodePoints(string pdf)
        {
            return Regex.Matches(pdf, @"<[0-9A-Fa-f]{4}>\s+<([0-9A-Fa-f]{4})>")
                .Cast<Match>().Select(m => m.Groups[1].Value.ToUpperInvariant()).Distinct().ToArray();
        }

        static void CheckPdf(string name, string pdf, bool expectHelvetica)
        {
            string[] mapped = MappedCodePoints(pdf);
            Check(mapped.Contains("0395") && mapped.Contains("03CE"), name + ": Greek code points are in the ToUnicode map (Ε, ώ)");
            Check(mapped.Contains("0421") && mapped.Contains("043F"), name + ": Cyrillic code points are in the ToUnicode map (С, п)");
            Check(mapped.Contains("3042") && mapped.Contains("65E5"), name + ": Japanese code points are in the ToUnicode map (あ, 日)");
            Check(!mapped.Contains("003F") && !Regex.IsMatch(pdf, @"\([^)]*\?[^)]*\)\s*Tj"),
                name + ": no '?' was written (nothing lost in a code page conversion)");
            if (expectHelvetica)
                Check(pdf.Contains("/BaseFont /Helvetica"), name + ": the Latin label keeps its standard Helvetica (no promotion when not needed)");
            Console.WriteLine("  " + name + ": " + pdf.Length + " B uncompressed, " + mapped.Length + " code points mapped");
        }

        static void Main(string[] args)
        {
            try
            {
                string outDir = Path.Combine(Path.GetTempPath(), "PdfUnicodePromotionTest");
                Directory.CreateDirectory(outDir);
                // The same report as a .rep, so the Delphi engine (printreptopdf -u) can be checked
                // against the same expectations: "--check-pdf file.pdf" runs the checks on any PDF.
                Build().SaveToFile(Path.Combine(outDir, "unicode.rep"));
                if (args.Length == 2 && args[0] == "--check-pdf")
                {
                    CheckPdf(Path.GetFileName(args[1]), Encoding.Latin1.GetString(File.ReadAllBytes(args[1])), false);
                    Console.WriteLine(failures == 0 ? "ALL PASSED" : failures + " FAILED");
                    Environment.ExitCode = failures == 0 ? 0 : 1;
                    return;
                }

                string ft = PdfFreeType();
                File.WriteAllBytes(Path.Combine(outDir, "freetype.pdf"), Encoding.Latin1.GetBytes(ft));
                CheckPdf("FreeType", ft, false);

                if (OperatingSystem.IsWindows())
                {
                    string gdi = PdfGdi(Path.Combine(outDir, "gdi.pdf"));
                    CheckPdf("GDI", gdi, true);
                }
                else
                    Console.WriteLine("[SKIP] GDI PDF driver: not Windows");

                // --- The standard-font driver (no provider): it must not crash, must write the Latin
                // label with Helvetica and embed nothing; non-WinAnsi text degrades to '?' (documented).
                string std = PdfStandard();
                File.WriteAllBytes(Path.Combine(outDir, "standard.pdf"), Encoding.Latin1.GetBytes(std));
                Check(std.Contains("/BaseFont /Helvetica") && !std.Contains("/FontFile2"),
                    "Standard: Helvetica, nothing embedded");
                Check(Regex.IsMatch(std, @"\(Factura simplificada[^)]*\)\s*Tj"), "Standard: the Latin label is written as a plain string");
                Check(Regex.IsMatch(std, @"\(\?+[^)]*\)\s*Tj") || std.Contains("(???"), "Standard: non-WinAnsi text degrades to '?' (no provider to promote to)");
                Console.WriteLine("  Standard: " + std.Length + " B uncompressed");

                Console.WriteLine("PDFs in " + outDir);
                Console.WriteLine(failures == 0 ? "ALL PASSED" : failures + " FAILED");
                Environment.ExitCode = failures == 0 ? 0 : 1;
            }
            catch (Exception ex)
            {
                Console.WriteLine("EXCEPTION: " + ex);
                Environment.ExitCode = 2;
            }
        }
    }
}
