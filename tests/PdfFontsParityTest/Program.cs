using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using Reportman.Drawing;
using Reportman.Reporting;

namespace PdfFontsParityTest
{
    // Validates the exact-metrics pipeline (PrinterFonts = Recalculate / UsePDFFonts):
    // 1. PDF output for plain text switches to per-glyph positioning (Tm + Tj) when active.
    // 2. PDF output stays legacy (string Tj/TJ) when inactive.
    // 3. GDI driver (PrintOutNet) and PDF driver report identical text extents in exact mode.
    // 4. PrinterFonts survives a metafile save/load round trip (format 4.1).
    // 5. The GDI glyph-exact render path executes without errors on a real metafile page.
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

        static Report BuildReport(PrinterFontsType printerFonts)
        {
            Report report = new Report();
            report.PageSize = PageSizeType.User;
            report.CustomPageWidth = 11906;
            report.CustomPageHeight = 16838;
            report.PageOrientation = OrientationType.Portrait;
            report.PrinterFonts = printerFonts;

            SubReport subrep = new SubReport();
            subrep.Report = report;
            report.GenerateNewName(subrep);
            report.SubReports.Add(subrep);

            Section detail = subrep.AddDetail();
            detail.Height = 14500;

            AddLabel(report, detail, 0, "Texto plano de prueba 12345 - parity check", TextAlignType.Left, false, false);
            AddLabel(report, detail, 1800, "Linea larga de texto plano con word wrap activado que debe partirse en " +
                "varias lineas usando exactamente las mismas posiciones de salto tanto en el PDF como en la impresora GDI.", TextAlignType.Left, true, false);
            AddLabel(report, detail, 4600, "Alineado a la derecha", TextAlignType.Right, false, false);
            AddLabel(report, detail, 6400, "Centrado en el contenedor", TextAlignType.Center, false, false);
            AddLabel(report, detail, 8200, "Texto subrayado completo", TextAlignType.Left, false, true);
            AddLabel(report, detail, 10000, "Texto justificado que reparte el espacio sobrante entre las palabras " +
                "de cada linea excepto la ultima linea del parrafo final.", TextAlignType.Justify, true, false);
            // RTL: Arabic multi-line paragraph, shaped+bidi on both sides (C2)
            AddLabel(report, detail, 12500, "مرحبا بالعالم هذا اختبار للنص العربي الطويل الذي يجب أن يلتف على عدة أسطر مع أرقام 123 مدمجة",
                TextAlignType.Left, true, false, true);
            return report;
        }

        static void AddLabel(Report report, Section detail, int posy, string text, TextAlignType alignment, bool wordwrap, bool underline, bool rightToLeft = false)
        {
            LabelItem label = new LabelItem();
            label.Report = report;
            report.GenerateNewName(label);
            label.Section = detail;
            label.PosX = 0;
            label.PosY = posy;
            label.Width = 9000;
            label.Height = wordwrap ? 2400 : 1500;
            label.WFontName = "Arial";
            label.LFontName = "Arial";
            label.FontSize = 12;
            label.IsHtml = false;
            label.WordWrap = wordwrap;
            label.Transparent = true;
            if (underline)
                label.FontStyle = 4;
            label.Alignment = alignment;
            label.RightToLeft = rightToLeft;
            label.AllStrings.Add(text);
            detail.Components.Add(label);
        }

        static string GeneratePdf(Report report, string path)
        {
            using (PrintOutPDF pdfDriver = new PrintOutPDF())
            {
                pdfDriver.FileName = path;
                pdfDriver.Compressed = false;
                pdfDriver.Print(report.MetaFile);
            }
            byte[] raw = File.ReadAllBytes(path);
            return Encoding.Latin1.GetString(raw);
        }

        static int CountOccurrences(string text, string pattern)
        {
            int count = 0, pos = 0;
            while ((pos = text.IndexOf(pattern, pos, StringComparison.Ordinal)) >= 0)
            {
                count++;
                pos += pattern.Length;
            }
            return count;
        }

        static void Main(string[] args)
        {
            // Diagnostic mode: dump text object alignments of a metafile (Delphi or C#)
            if (args.Length >= 2 && args[0] == "dumpmeta")
            {
                MetaFile dmeta = new MetaFile();
                dmeta.LoadFromFile(args[1]);
                for (int p = 0; p < dmeta.Pages.CurrentCount; p++)
                {
                    MetaPage dpage = dmeta.Pages[p];
                    for (int o = 0; o < dpage.Objects.Count; o++)
                    {
                        if (dpage.Objects[o].MetaType == MetaObjectType.Text)
                        {
                            MetaObjectText t = (MetaObjectText)dpage.Objects[o];
                            string txt = dpage.GetText(t);
                            Console.WriteLine($"page {p} obj {o} Alignment={t.Alignment} WordWrap={t.WordWrap} " +
                                $"Text='{(txt.Length > 40 ? txt.Substring(0, 40) : txt)}'");
                        }
                    }
                }
                return;
            }
            try
            {
                // --- 1. Exact mode: per-glyph PDF for plain text ---
                Report exactReport = BuildReport(PrinterFontsType.Recalculate);
                string exactPdf = GeneratePdf(exactReport, Path.GetFullPath("parity_exact.pdf"));
                int exactTm = CountOccurrences(exactPdf, " Tm <");
                int exactActualText = CountOccurrences(exactPdf, "/ActualText");
                Console.WriteLine($"Exact PDF: {exactTm} per-glyph Tm ops, {exactActualText} ActualText spans");
                Check(exactTm > 50, "Exact mode writes per-glyph Tm+Tj", $"only {exactTm} found");
                Check(exactActualText >= 6, "Exact mode wraps lines in ActualText spans", $"only {exactActualText} found");

                // --- 2. Legacy mode: LTR plain text stays as string Tj (RTL always shapes) ---
                Report legacyReport = BuildReport(PrinterFontsType.Default);
                string legacyPdf = GeneratePdf(legacyReport, Path.GetFullPath("parity_legacy.pdf"));
                int legacyTm = CountOccurrences(legacyPdf, " Tm <");
                int legacyTj = CountOccurrences(legacyPdf, ") Tj") + CountOccurrences(legacyPdf, "] TJ");
                Console.WriteLine($"Legacy PDF: {legacyTm} per-glyph Tm ops (RTL only), {legacyTj} string Tj/TJ");
                Check(legacyTj > 0 && legacyTm < exactTm / 2,
                    "Legacy mode keeps string Tj for LTR text (only RTL shapes)",
                    $"Tm={legacyTm} Tj={legacyTj} exactTm={exactTm}");

                // --- 3. Extent parity GDI vs PDF in exact mode ---
                MetaFile exactMeta = exactReport.MetaFile;
                using (Reportman.Drawing.PrintOutNet netDriver = new Reportman.Drawing.PrintOutNet())
                using (PrintOutPDF pdfDriver = new PrintOutPDF())
                {
                    netDriver.CurrentMetafile = exactMeta;
                    netDriver.UsePDFFonts = true;
                    pdfDriver.CurrentMetafile = exactMeta;
                    pdfDriver.ForceComplexShaping = true;

                    string[] samples =
                    {
                        "Texto plano de prueba 12345 - parity check",
                        "Linea larga de texto plano con word wrap activado que debe partirse en varias lineas",
                        "WAVA Tj kerning fi fl ffi"
                    };
                    bool allEqual = true;
                    string mismatch = "";
                    foreach (string sample in samples)
                    {
                        TextObjectStruct tobj = new TextObjectStruct();
                        tobj.Text = sample;
                        tobj.WFontName = "Arial";
                        tobj.LFontName = "Arial";
                        tobj.FontSize = 12;
                        tobj.WordWrap = true;
                        tobj.Alignment = 0;
                        tobj.Type1Font = PDFFontType.Helvetica;

                        Point extNet = netDriver.TextExtent(tobj, new Point(9000, 4000));
                        Point extPdf = pdfDriver.TextExtent(tobj, new Point(9000, 4000));
                        if (extNet != extPdf)
                        {
                            allEqual = false;
                            mismatch = $"'{sample}' GDI={extNet} PDF={extPdf}";
                        }
                    }
                    Check(allEqual, "TextExtent parity GDI vs PDF (exact mode)", mismatch);
                }

                // --- 4. Metafile round trip of PrinterFonts (format 4.1) ---
                using (MemoryStream ms = new MemoryStream())
                {
                    exactMeta.SaveToStream(ms, false);
                    byte[] header = ms.ToArray();
                    string sign = Encoding.ASCII.GetString(header, 0, 12);
                    Check(sign == "RPMETAFILE41", "Recalculate metafile saved as 4.1", $"signature was '{sign}'");

                    ms.Seek(0, SeekOrigin.Begin);
                    MetaFile loaded = new MetaFile();
                    loaded.LoadFromStream(ms, true);
                    Check(loaded.PrinterFonts == PrinterFontsType.Recalculate,
                        "PrinterFonts survives metafile round trip", $"loaded value: {loaded.PrinterFonts}");
                    Check(loaded.Pages.CurrentCount == exactMeta.Pages.CurrentCount,
                        "Page count preserved in 4.1 round trip",
                        $"saved {exactMeta.Pages.CurrentCount}, loaded {loaded.Pages.CurrentCount}");
                }
                using (MemoryStream ms = new MemoryStream())
                {
                    legacyReport.MetaFile.SaveToStream(ms, false);
                    string sign = Encoding.ASCII.GetString(ms.ToArray(), 0, 12);
                    Check(sign != "RPMETAFILE41", "Default metafile keeps legacy signature", $"signature was '{sign}'");
                }

                // --- 5. GDI glyph-exact render executes on the real page ---
                using (Reportman.Drawing.PrintOutNet netDriver = new Reportman.Drawing.PrintOutNet())
                {
                    netDriver.CurrentMetafile = exactMeta;
                    // No UsePDFFonts here: the metafile PrinterFonts=Recalculate alone must
                    // activate the glyph-exact path.
                    Bitmap output = new Bitmap(1240, 1754);
                    output.SetResolution(150, 150);
                    netDriver.Output = output;
                    netDriver.DrawPage(exactMeta, exactMeta.Pages[0]);
                    bool hasInk = false;
                    for (int y = 50; y < output.Height && !hasInk; y += 4)
                        for (int x = 0; x < output.Width && !hasInk; x += 4)
                            if (output.GetPixel(x, y).GetBrightness() < 0.5f)
                                hasInk = true;
                    Check(hasInk, "GDI exact render produces visible output");
                    output.Save("parity_gdi.png");
                }

                // --- 6. Numeric glyph-position parity: GDI EMF ExtTextOutW vs PDF Tm ---
                // The PDF writes one "Tm <gid> Tj" per glyph with absolute twips-derived X.
                // The GDI exact path emits glyph-indexed ExtTextOutW records whose reference
                // point and dx array reproduce those same twips rounded to device pixels.
                // Rendering the page into an EMF lets us read back the actual GDI positions.
                {
                    var pdfGlyphTwipsX = new List<int>();
                    foreach (Match m in Regex.Matches(exactPdf, @"1 0 0 1 (-?[0-9.]+) (-?[0-9.]+) Tm <"))
                        pdfGlyphTwipsX.Add((int)Math.Round(double.Parse(m.Groups[1].Value,
                            System.Globalization.CultureInfo.InvariantCulture) * 20.0));

                    var emfGlyphPixX = new List<int>();
                    int nonGlyphTextRecords = 0;
                    float emfDpiX;
                    using (var emfStream = new MemoryStream())
                    {
                        Metafile emf;
                        using (Bitmap refBmp = new Bitmap(1, 1))
                        using (Graphics refG = Graphics.FromImage(refBmp))
                        {
                            IntPtr refHdc = refG.GetHdc();
                            emf = new Metafile(emfStream, refHdc, new Rectangle(0, 0, 1400, 1800),
                                MetafileFrameUnit.Pixel, EmfType.EmfOnly);
                            refG.ReleaseHdc(refHdc);
                        }
                        using (Graphics g = Graphics.FromImage(emf))
                        using (Reportman.Drawing.PrintOutNet netDriver = new Reportman.Drawing.PrintOutNet())
                        {
                            emfDpiX = g.DpiX;
                            netDriver.CurrentMetafile = exactMeta;
                            MetaPage page = exactMeta.Pages[0];
                            for (int i = 0; i < page.Objects.Count; i++)
                                netDriver.DrawObject(g, page, page.Objects[i]);
                        }
                        using (Bitmap dispBmp = new Bitmap(1, 1))
                        using (Graphics dispG = Graphics.FromImage(dispBmp))
                        {
                            Graphics.EnumerateMetafileProc proc = (recordType, flags, dataSize, data, callbackData) =>
                            {
                                if (recordType == EmfPlusRecordType.EmfExtTextOutW && data != IntPtr.Zero)
                                {
                                    byte[] buf = new byte[dataSize];
                                    Marshal.Copy(data, buf, 0, dataSize);
                                    // EMREXTTEXTOUTW without the 8-byte EMR header:
                                    // rclBounds(16) iGraphicsMode(4) exScale(4) eyScale(4)
                                    // EMRTEXT: ptlRef.x(28) ptlRef.y(32) nChars(36) offString(40)
                                    //          fOptions(44) rcl(48..63) offDx(64)
                                    int refX = BitConverter.ToInt32(buf, 28);
                                    int nChars = BitConverter.ToInt32(buf, 36);
                                    uint fOptions = BitConverter.ToUInt32(buf, 44);
                                    int offDx = BitConverter.ToInt32(buf, 64) - 8;
                                    if ((fOptions & 0x10) == 0)
                                    {
                                        nonGlyphTextRecords++;
                                    }
                                    else if (nChars > 0 && offDx >= 0 && offDx + nChars * 4 <= buf.Length)
                                    {
                                        int x = refX;
                                        for (int gi = 0; gi < nChars; gi++)
                                        {
                                            emfGlyphPixX.Add(x);
                                            x += BitConverter.ToInt32(buf, offDx + gi * 4);
                                        }
                                    }
                                }
                                return true;
                            };
                            dispG.EnumerateMetafile(emf, new Point(0, 0), proc);
                        }
                        emf.Dispose();
                    }

                    Console.WriteLine($"PDF glyphs: {pdfGlyphTwipsX.Count} | EMF glyphs: {emfGlyphPixX.Count} | non-glyph text records: {nonGlyphTextRecords}");
                    Check(nonGlyphTextRecords == 0, "No text fell back to non-glyph rendering",
                        $"{nonGlyphTextRecords} legacy text records");
                    Check(pdfGlyphTwipsX.Count > 0 && pdfGlyphTwipsX.Count == emfGlyphPixX.Count,
                        "PDF and GDI emit the same glyph count",
                        $"PDF {pdfGlyphTwipsX.Count} vs EMF {emfGlyphPixX.Count}");
                    if (pdfGlyphTwipsX.Count == emfGlyphPixX.Count)
                    {
                        int maxDev = 0;
                        int worst = -1;
                        for (int gi = 0; gi < pdfGlyphTwipsX.Count; gi++)
                        {
                            int expectedPix = (int)Math.Round(pdfGlyphTwipsX[gi] * emfDpiX / 1440.0);
                            int dev = Math.Abs(emfGlyphPixX[gi] - expectedPix);
                            if (dev > maxDev) { maxDev = dev; worst = gi; }
                        }
                        Console.WriteLine($"Max glyph X deviation: {maxDev}px at glyph {worst} (dpi {emfDpiX})");
                        Check(maxDev <= 1, "Every glyph X matches the PDF within 1px (rounding)",
                            $"max deviation {maxDev}px at glyph index {worst}");
                    }
                }

                Console.WriteLine(failures == 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED");
                Environment.Exit(failures == 0 ? 0 : 1);
            }
            catch (Exception ex)
            {
                Console.WriteLine("Unhandled error: " + ex.Message);
                Console.WriteLine(ex.StackTrace);
                Environment.Exit(2);
            }
        }
    }
}
