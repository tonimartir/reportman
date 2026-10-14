using System.Text;
using System.Text.RegularExpressions;
using Reportman.Drawing;
using Reportman.Drawing.CrossPlatform;
using Reportman.Reporting;
using SkiaSharp;

namespace FormasClearTest
{
    // A SHAPE WITH A CLEAR PEN AND A CLEAR BRUSH PAINTS NOTHING, in every driver (14-10-2026).
    //
    // Why it exists. ReportmanFiscal needed an invisible shape to hold the height of a contracting
    // section, and a Rectangle with PenStyle Clear and BrushStyle Clear came out of the PDF as a black
    // bar. PDFCanvas skipped the drawing only for BrushStyle 2 (Horizontal), a translation slip from
    // Delphi's rppdffile.pas, which skips it for 1 (bsClear): with a clear brush the C# canvas fell
    // through to "S" and stroked the outline with the default pen. The same slip made a hatched shape
    // with a clear pen vanish. And the Skia bitmap driver painted the LINES whatever the pen style.
    //
    // What is measured: for each shape, the page content stream of the PDF (uncompressed) holds no
    // path operator, and the Skia bitmap has no pixel that is not the background. A visible control
    // shape and a hatched one with a clear pen prove the measure sees what is drawn.
    //
    //   FormasClearTest                 paints with the .NET engine and checks
    //   FormasClearTest --rep <dir>     writes one .rep per case, for the Delphi engine
    //   FormasClearTest --check <dir>   checks the <case>-delphi.pdf files of a directory
    //
    // The Delphi engine is measured with `printreptopdf` (repman/utils), uncompressed:
    //
    //   FormasClearTest --rep /tmp/formas
    //   for f in /tmp/formas/*.rep; do printreptopdf -q -u "$f" "${f%.rep}-delphi.pdf"; done
    //   FormasClearTest --check /tmp/formas
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

        static Report Build(ShapeType shape, PenType pen, BrushType brush)
        {
            Report r = new Report();
            r.CreateNew();
            r.PageSize = PageSizeType.User;
            r.CustomPageWidth = 5000;
            r.CustomPageHeight = 4000;
            r.LeftMargin = 0; r.TopMargin = 0; r.RightMargin = 0; r.BottomMargin = 0;
            Section s = r.SubReports[0].Sections[r.SubReports[0].FirstDetail];
            s.Height = 3000;
            ShapeItem item = new ShapeItem
            {
                Report = r, Section = s, PosX = 500, PosY = 500, Width = 3000, Height = 2000,
                Shape = shape, PenStyle = pen, BrushStyle = brush, PenColor = 0, BrushColor = 0, PenWidth = 20,
            };
            r.GenerateNewName(item);
            s.Components.Add(item);
            r.AsyncExecution = false;
            return r;
        }

        /// <summary>The path-construction operators (m l c re) in the uncompressed page content.</summary>
        static int PathOperators(ShapeType shape, PenType pen, BrushType brush)
        {
            using (PrintOutPDFFreeType d = new PrintOutPDFFreeType { FileName = "", Compressed = false })
            {
                d.Print(Build(shape, pen, brush).MetaFile);
                MemoryStream ms = new MemoryStream();
                d.PDFStream.Position = 0;
                d.PDFStream.CopyTo(ms);
                return PathOperators(Encoding.Latin1.GetString(ms.ToArray()));
            }
        }

        static int PathOperators(string uncompressedPdf)
            => Regex.Matches(uncompressedPdf, @"(?m)^(-?[\d.]+ )+(m|l|c|v|re)\r?$").Count;

        /// <summary>Every case, with its name and whether something must be painted.</summary>
        static IEnumerable<(string Name, ShapeType Shape, PenType Pen, BrushType Brush, bool Painted)> Cases()
        {
            yield return ("control-rectangle", ShapeType.Rectangle, PenType.Solid, BrushType.Clear, true);
            foreach (ShapeType shape in new[] { ShapeType.Rectangle, ShapeType.Square, ShapeType.RoundRect, ShapeType.Ellipse,
                ShapeType.Circle, ShapeType.HorzLine, ShapeType.VertLine, ShapeType.Oblique1, ShapeType.Oblique2 })
                yield return ("clear-" + shape.ToString().ToLowerInvariant(), shape, PenType.Clear, BrushType.Clear, false);
            yield return ("hatched-rectangle", ShapeType.Rectangle, PenType.Clear, BrushType.Horizontal, true);
            yield return ("hatched-ellipse", ShapeType.Ellipse, PenType.Clear, BrushType.Horizontal, true);
        }

        /// <summary>The pixels of the Skia bitmap that are not the white background.</summary>
        static int InkedPixels(ShapeType shape, PenType pen, BrushType brush)
        {
            using (PrintOutBitmapSkia d = new PrintOutBitmapSkia { Dpi = 96 })
            {
                d.Print(Build(shape, pen, brush).MetaFile);
                using (SKBitmap bmp = SKBitmap.Decode(d.Pages[0]))
                {
                    int inked = 0;
                    for (int y = 0; y < bmp.Height; y++)
                        for (int x = 0; x < bmp.Width; x++)
                            if (bmp.GetPixel(x, y) != SKColors.White) inked++;
                    return inked;
                }
            }
        }

        static void Main(string[] args)
        {
            try
            {
                if (args.Length == 2 && args[0] == "--rep")
                {
                    Directory.CreateDirectory(args[1]);
                    foreach (var c in Cases())
                        Build(c.Shape, c.Pen, c.Brush).SaveToFile(Path.Combine(args[1], c.Name + ".rep"));
                    Console.WriteLine("Written " + Cases().Count() + " .rep files to " + args[1]);
                    return;
                }
                if (args.Length == 2 && args[0] == "--check")
                {
                    foreach (var c in Cases())
                    {
                        string file = Path.Combine(args[1], c.Name + "-delphi.pdf");
                        if (!File.Exists(file)) { Check(false, c.Name, "missing " + file); continue; }
                        int ops = PathOperators(Encoding.Latin1.GetString(File.ReadAllBytes(file)));
                        Check(c.Painted ? ops > 0 : ops == 0,
                            "Delphi PDF: " + c.Name + (c.Painted ? " is painted" : " paints nothing"), ops + " path operators");
                    }
                    Console.WriteLine(failures == 0 ? "ALL PASSED" : failures + " FAILURE(S)");
                    Environment.Exit(failures == 0 ? 0 : 1);
                }

                ShapeType[] shapes ={ ShapeType.Rectangle, ShapeType.Square, ShapeType.RoundRect, ShapeType.Ellipse,
                    ShapeType.Circle, ShapeType.HorzLine, ShapeType.VertLine, ShapeType.Oblique1, ShapeType.Oblique2 };

                // The measure sees what is drawn.
                int control = PathOperators(ShapeType.Rectangle, PenType.Solid, BrushType.Clear);
                Check(control > 0, "PDF: a solid outlined rectangle has path operators", control.ToString());
                int inkControl = InkedPixels(ShapeType.Rectangle, PenType.Solid, BrushType.Clear);
                Check(inkControl > 0, "Skia: a solid outlined rectangle has inked pixels", inkControl.ToString());

                foreach (ShapeType shape in shapes)
                {
                    int ops = PathOperators(shape, PenType.Clear, BrushType.Clear);
                    Check(ops == 0, "PDF: " + shape + " with clear pen and clear brush paints nothing", ops + " path operators");
                    int ink = InkedPixels(shape, PenType.Clear, BrushType.Clear);
                    Check(ink == 0, "Skia: " + shape + " with clear pen and clear brush paints nothing", ink + " pixels");
                }

                // A clear pen does not swallow the brush: a hatched rectangle without outline is still filled.
                int hatched = PathOperators(ShapeType.Rectangle, PenType.Clear, BrushType.Horizontal);
                Check(hatched > 0, "PDF: a hatched rectangle with a clear pen is still filled", hatched + " path operators");
                int hatchedEllipse = PathOperators(ShapeType.Ellipse, PenType.Clear, BrushType.Horizontal);
                Check(hatchedEllipse > 0, "PDF: a hatched ellipse with a clear pen is still filled", hatchedEllipse + " path operators");
            }
            catch (Exception e)
            {
                Console.WriteLine("[FAIL] " + e);
                failures++;
            }
            Console.WriteLine(failures == 0 ? "ALL PASSED" : failures + " FAILURE(S)");
            Environment.Exit(failures == 0 ? 0 : 1);
        }
    }
}
