using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using Reportman.Drawing;

namespace ImagesToPdfPageSizeTest
{
    // Validates that PrintOutPDF.ImagesToPDF gives every page the size and orientation of its
    // own image (portrait, landscape and a smaller portrait one at 100 dpi):
    // 1. One /MediaBox per image, each with the size of that image, not the size of the first.
    // 2. The image of every page fills it: scaled to the page size and placed at its origin
    //    (a page with the height of another one moves the image off the page).
    // 3. The same holds for the bitonal paths the scanner uses (GIF + Text, BMP + BW).
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

        const int Dpi = 100;
        // Pixels at 100 dpi: Letter portrait, Letter landscape, 5x7 in portrait
        static readonly Size[] ImageSizes = { new Size(850, 1100), new Size(1100, 850), new Size(500, 700) };

        static List<Image> BuildImages()
        {
            List<Image> images = new List<Image>();
            foreach (Size size in ImageSizes)
            {
                Bitmap nbitmap = new Bitmap(size.Width, size.Height, PixelFormat.Format24bppRgb);
                using (Graphics gr = Graphics.FromImage(nbitmap))
                {
                    gr.Clear(Color.White);
                    gr.FillRectangle(Brushes.Black, 50, 50, size.Width / 3, size.Height / 4);
                }
                images.Add(nbitmap);
            }
            return images;
        }

        static double Num(string s)
        {
            return double.Parse(s, CultureInfo.InvariantCulture);
        }

        static bool Near(double a, double b)
        {
            return Math.Abs(a - b) < 0.5;
        }

        static void CheckPdf(string label, MemoryStream pdf, bool checkContent)
        {
            string text = Encoding.Latin1.GetString(pdf.ToArray());
            MatchCollection boxes = Regex.Matches(text, @"/MediaBox \[ 0 0 ([\d.]+) ([\d.]+)\]");
            Check(boxes.Count == ImageSizes.Length, label + ": one page per image",
                boxes.Count.ToString() + " pages");
            for (int i = 0; i < Math.Min(boxes.Count, ImageSizes.Length); i++)
            {
                double ew = ImageSizes[i].Width * 72.0 / Dpi;
                double eh = ImageSizes[i].Height * 72.0 / Dpi;
                double w = Num(boxes[i].Groups[1].Value);
                double h = Num(boxes[i].Groups[2].Value);
                Check(Near(w, ew) && Near(h, eh),
                    label + ": page " + (i + 1).ToString() + " is " + ew.ToString(CultureInfo.InvariantCulture) + "x" + eh.ToString(CultureInfo.InvariantCulture),
                    "MediaBox " + w.ToString(CultureInfo.InvariantCulture) + "x" + h.ToString(CultureInfo.InvariantCulture));
            }
            if (!checkContent)
                return;
            // Each image is drawn as "q / 1 0 0 1 x y cm / w 0 0  h 0 0 cm / /ImN Do / Q"
            MatchCollection draws = Regex.Matches(text,
                @"1 0 0 1 ([\d.\-]+) ([\d.\-]+) cm\s+([\d.\-]+) 0 0  ([\d.\-]+) 0 0 cm\s+/Im\d+ Do");
            Check(draws.Count == ImageSizes.Length, label + ": one image drawn per page",
                draws.Count.ToString() + " images");
            for (int i = 0; i < Math.Min(draws.Count, ImageSizes.Length); i++)
            {
                double ew = ImageSizes[i].Width * 72.0 / Dpi;
                double eh = ImageSizes[i].Height * 72.0 / Dpi;
                double x = Num(draws[i].Groups[1].Value);
                double y = Num(draws[i].Groups[2].Value);
                double w = Num(draws[i].Groups[3].Value);
                double h = Num(draws[i].Groups[4].Value);
                Check(Near(x, 0) && Near(y, 0) && Near(w, ew) && Near(h, eh),
                    label + ": image " + (i + 1).ToString() + " fills its page",
                    "at " + x.ToString(CultureInfo.InvariantCulture) + "," + y.ToString(CultureInfo.InvariantCulture) +
                    " size " + w.ToString(CultureInfo.InvariantCulture) + "x" + h.ToString(CultureInfo.InvariantCulture));
            }
        }

        static int Main(string[] args)
        {
            List<Image> images = BuildImages();
            try
            {
                using (MemoryStream pdf = PrintOutPDF.ImagesToPDF(images, Dpi, ImageFormat.Jpeg, 80,
                    PrintOutPDF.ImageDepth.Color, PDFConformanceType.PDF_1_4))
                {
                    if (args.Length > 0)
                        File.WriteAllBytes(args[0], pdf.ToArray());
                    CheckPdf("JPEG", pdf, true);
                }
                using (MemoryStream pdf = PrintOutPDF.ImagesToPDF(images, Dpi, ImageFormat.Gif, 100,
                    PrintOutPDF.ImageDepth.Text, PDFConformanceType.PDF_1_4))
                {
                    CheckPdf("GIF Text", pdf, true);
                }
                // BMP compresses the content streams: only the page boxes are readable
                using (MemoryStream pdf = PrintOutPDF.ImagesToPDF(images, Dpi, ImageFormat.Bmp, 100,
                    PrintOutPDF.ImageDepth.BW, PDFConformanceType.PDF_1_4))
                {
                    CheckPdf("BMP BW", pdf, false);
                }
            }
            finally
            {
                foreach (Image nimage in images)
                    nimage.Dispose();
            }
            Console.WriteLine(failures == 0 ? "ALL PASSED" : failures.ToString() + " FAILED");
            return failures == 0 ? 0 : 1;
        }
    }
}
