using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Threading;

namespace Reportman.Drawing.Windows
{
    /// <summary>
    /// Windows GDI+ graphics utilities for the report engine: DPI scaling, grid drawing, text measurement,
    /// font-style conversions, metafile/bitmap rendering and image codec, scaling and format helpers.
    /// </summary>
    public class GraphicUtils
    {
        private static object flag = 2;

        // Flag used by Monitor object to provide multithread capability
        private static Bitmap gridbitmap = null;
        private static Bitmap smallbit = null;
        private static System.Drawing.Imaging.Metafile gridmetafile = null;
        private static double gridscale;
        private static int gridx;
        private static int gridy;
        private static Color gridcolor;
        private static Color gridbackcolor;
        private static bool gridlines;
        /// <summary>
        /// Reference DPI (96) used as the baseline for all DPI scale calculations.
        /// </summary>
        public static int DefaultDPI = 96;
        private static float fdpiscale = 0.0f;
        private static float fdpiscalex = 0.0f;
        private static float fdpiscaley = 0.0f;
        /// <summary>
        /// Gets the ratio between the current screen DPI and <see cref="DefaultDPI"/>, cached after first use.
        /// </summary>
        public static float DPIScale
        {
            get
            {
                if (fdpiscale != 0.0f)
                    return fdpiscale;
                fdpiscale = (float)ScreenDPI() / (float)DefaultDPI;
                return fdpiscale;
            }

        }
        /// <summary>
        /// Returns the MIME type for the raw format of the given image, or "image/unknown" when the format is not recognized.
        /// </summary>
        /// <param name="i">Image whose format is inspected.</param>
        /// <returns>The MIME type string.</returns>
        public static string GetMimeType(Image i)
        {
            var imgguid = i.RawFormat.Guid;
            foreach (ImageCodecInfo codec in ImageCodecInfo.GetImageDecoders())
            {
                if (codec.FormatID == imgguid)
                    return codec.MimeType ?? "image/unknown";
            }
            return "image/unknown";
        }
        /// <summary>
        /// Extends the line defined by <paramref name="startPoint"/> and <paramref name="endPoint"/> by
        /// <paramref name="pixelCount"/> pixels, moving <paramref name="endPoint"/> along the line direction.
        /// A negative <paramref name="pixelCount"/> shortens the line.
        /// </summary>
        /// <param name="startPoint">Fixed start point of the line.</param>
        /// <param name="endPoint">End point that is moved; passed by reference.</param>
        /// <param name="pixelCount">Number of pixels to extend (positive) or shorten (negative) the line.</param>
        public static void LengthenLine(PointF startPoint, ref PointF endPoint, float pixelCount)
        {
            if (startPoint.Equals(endPoint))
                return; // not a line

            double dx = endPoint.X - startPoint.X;
            double dy = endPoint.Y - startPoint.Y;
            if (dx == 0)
            {
                // vertical line:
                if (endPoint.Y < startPoint.Y)
                    endPoint.Y -= pixelCount;
                else
                    endPoint.Y += pixelCount;
            }
            else if (dy == 0)
            {
                // horizontal line:
                if (endPoint.X < startPoint.X)
                    endPoint.X -= pixelCount;
                else
                    endPoint.X += pixelCount;
            }
            else
            {
                // non-horizontal, non-vertical line:
                double length = Math.Sqrt(dx * dx + dy * dy);
                double scale = (length + pixelCount) / length;
                dx *= scale;
                dy *= scale;
                endPoint.X = startPoint.X + Convert.ToSingle(dx);
                endPoint.Y = startPoint.Y + Convert.ToSingle(dy);
            }
        }
        /// <summary>
        /// Builds a graphics path that connects the given points with straight segments joined by
        /// rounded (bezier) corners of the specified radius.
        /// </summary>
        /// <param name="points">Ordered points that define the poly-line.</param>
        /// <param name="cornerRadius">Radius of the rounded corners.</param>
        /// <returns>A graphics path with rounded corners.</returns>
        public static System.Drawing.Drawing2D.GraphicsPath GetRoundedLine(PointF[] points, float cornerRadius)
        {
            System.Drawing.Drawing2D.GraphicsPath path = new System.Drawing.Drawing2D.GraphicsPath();
            PointF previousEndPoint = PointF.Empty;
            for (int i = 1; i < points.Length; i++)
            {
                PointF startPoint = points[i - 1];
                PointF endPoint = points[i];

                if (i > 1)
                {
                    // shorten start point and add bezier curve for all but the first line segment:
                    PointF cornerPoint = startPoint;
                    LengthenLine(endPoint, ref startPoint, -cornerRadius);
                    PointF controlPoint1 = cornerPoint;
                    PointF controlPoint2 = cornerPoint;
                    LengthenLine(previousEndPoint, ref controlPoint1, -cornerRadius / 2);
                    LengthenLine(startPoint, ref controlPoint2, -cornerRadius / 2);
                    path.AddBezier(previousEndPoint, controlPoint1, controlPoint2, startPoint);
                }
                if (i + 1 < points.Length) // shorten end point of all but the last line segment.
                    LengthenLine(startPoint, ref endPoint, -cornerRadius);

                path.AddLine(startPoint, endPoint);
                previousEndPoint = endPoint;
            }
            return path;
        }
        /// <summary>
        /// Gets the horizontal ratio between the current screen DPI and <see cref="DefaultDPI"/>, cached after first use.
        /// </summary>
        public static float DPIScaleX
        {
            get
            {
                if (fdpiscalex != 0.0f)
                    return fdpiscalex;
                fdpiscalex = (float)ScreenDPIX() / (float)DefaultDPI;
                return fdpiscalex;
            }

        }
        /// <summary>
        /// Gets the vertical ratio between the current screen DPI and <see cref="DefaultDPI"/>, cached after first use.
        /// </summary>
        public static float DPIScaleY
        {
            get
            {
                if (fdpiscaley != 0.0f)
                    return fdpiscaley;
                fdpiscaley = (float)ScreenDPIY() / (float)DefaultDPI;
                return fdpiscaley;
            }

        }
        static int ndpiy = 0;
        /// <summary>
        /// Returns the vertical screen resolution in dots per inch, measured once and cached.
        /// </summary>
        /// <returns>Vertical screen DPI.</returns>
        public static int ScreenDPIY()
        {
            if (ndpiy == 0)
            {
                using (Bitmap nbit = new Bitmap(10, 10))
                {
                    using (Graphics gr = Graphics.FromImage(nbit))
                    {
                        ndpiy = System.Convert.ToInt32(gr.DpiY);
                    }
                }

            }
            return ndpiy;
        }
        /// <summary>
        /// Returns the horizontal screen resolution in dots per inch.
        /// </summary>
        /// <returns>Horizontal screen DPI.</returns>
        public static int ScreenDPIX()
        {
            return ScreenDPI();
        }
        static int ndpi = 0;
        /// <summary>
        /// Returns the screen resolution in dots per inch, measured once and cached.
        /// </summary>
        /// <returns>Screen DPI.</returns>
        public static int ScreenDPI()
        {
            if (ndpi == 0)
            {
                using (Bitmap nbit = new Bitmap(10, 10))
                {
                    using (Graphics gr = Graphics.FromImage(nbit))
                    {
                        ndpi = System.Convert.ToInt32(gr.DpiX);
                    }
                }

            }
            return ndpi;
        }
        /// <summary>
        /// Obtain a Image (Metafile or Bitmap) to perform fast drawing of a grid, 
        /// so consecutive calls with similar parameters will execute faster.
        /// The implementation uses a shared bitmap or metafile.
        /// </summary>
        /// <param name="Width"></param>
        /// <param name="Height"></param>
        /// <param name="GWidth"></param>
        /// <param name="GHeight"></param>
        /// <param name="GColor"></param>
        /// <param name="BackColor"></param>
        /// <param name="Lines"></param>
        /// <param name="Scale"></param>
        /// <returns></returns>
        public static Image GetImageGrid(int Width, int Height, int GWidth, int GHeight, Color GColor,
            Color BackColor, bool Lines, double Scale)
        {
            const int MAX_GRID_BITMAP = 2500;
            if ((Width > MAX_GRID_BITMAP) || (Height > MAX_GRID_BITMAP))
            {
                return GetMetafileGrid(Width, Height, GWidth, GHeight, GColor, BackColor, Lines, Scale);
            }
            else
            {
                return GetBitmapGrid(Width, Height, GWidth, GHeight, GColor, BackColor, Lines, Scale);
            }
        }
        /// <summary>
        /// Obtain a bitmap to perform fast drawing of a grid, 
        /// so consecutive calls with similar parameters will execute faster.
        /// The implementation uses a shared bitmap.
        /// </summary>
        /// <param name="Width"></param>
        /// <param name="Height"></param>
        /// <param name="GWidth"></param>
        /// <param name="GHeight"></param>
        /// <param name="GColor"></param>
        /// <param name="BackColor"></param>
        /// <param name="Lines"></param>
        /// <param name="Scale"></param>
        /// <returns></returns>
        public static Bitmap GetBitmapGrid(int Width, int Height, int GWidth, int GHeight, Color GColor,
            Color BackColor, bool Lines, double Scale)
        {
            if (Height == 0)
                Height = 1;
            if (Width == 0)
                Width = 1;
            Monitor.Enter(flag);
            try
            {

                bool forceredraw = false;
                if (gridbitmap == null)
                    forceredraw = true;
                else
                {
                    if ((Height > gridbitmap.Height) || (Width > gridbitmap.Width))
                        forceredraw = true;
                    else
                        if ((GWidth != gridx) || (GHeight != gridy))
                            forceredraw = true;
                        else
                            if ((gridlines != Lines) || (gridscale != Scale) ||
                                (GColor != gridcolor) || (BackColor != gridbackcolor))
                                forceredraw = true;
                }
                if (!forceredraw && gridbitmap != null)
                    return gridbitmap;
                if (gridbitmap != null)
                    gridbitmap.Dispose();
                gridbitmap = new Bitmap(Width, Height, PixelFormat.Format24bppRgb);
                using (Graphics gr = Graphics.FromImage(gridbitmap))
                {
                    using (SolidBrush sbrush = new SolidBrush(BackColor))
                    {
                        gr.FillRectangle(sbrush, 0, 0, Width, Height);
                        DrawGrid(gr, GWidth, GHeight, Width, Height, GColor, Lines, 0, 0, Scale);
                    }
                }
                gridx = GWidth;
                gridy = GHeight;
                gridcolor = GColor;
                gridbackcolor = BackColor;
                gridlines = Lines;
                gridscale = Scale;
            }
            finally
            {
                Monitor.Exit(flag);
            }
            return gridbitmap;
        }
        /// <summary>
        /// Creates an empty Windows Metafile with the given width and height in pixels.
        /// </summary>
        /// <param name="Width">Metafile width in pixels.</param>
        /// <param name="Height">Metafile height in pixels.</param>
        /// <returns>A new metafile ready for drawing.</returns>
        public static System.Drawing.Imaging.Metafile CreateWindowsMetafile(int Width, int Height)
        {
            Monitor.Enter(flag);
            try
            {
                smallbit ??= new Bitmap(10, 10);
                using (Graphics metagr = Graphics.FromImage(smallbit))
                {
                    return new System.Drawing.Imaging.Metafile(metagr.GetHdc(), new Rectangle(0, 0, Width, Height), MetafileFrameUnit.Pixel);
                }
            }
            finally
            {
                Monitor.Exit(flag);
            }
        }
        /// <summary>
        /// Obtain a metafile to perform fast drawing of a grid, 
        /// so consecutive calls with similar parameters will execute faster.
        /// The implementation uses a shared metafile.
        /// </summary>
        /// <param name="Width"></param>
        /// <param name="Height"></param>
        /// <param name="GWidth"></param>
        /// <param name="GHeight"></param>
        /// <param name="GColor"></param>
        /// <param name="BackColor"></param>
        /// <param name="Lines"></param>
        /// <param name="Scale"></param>
        /// <returns></returns>
        public static System.Drawing.Imaging.Metafile GetMetafileGrid(int Width, int Height, int GWidth, int GHeight, Color GColor,
            Color BackColor, bool Lines, double Scale)
        {
            if (Height == 0)
                Height = 1;
            if (Width == 0)
                Width = 1;
            Monitor.Enter(flag);
            try
            {
                smallbit ??= new Bitmap(10, 10);

                bool forceredraw = false;
                if (gridmetafile == null)
                    forceredraw = true;
                else
                {
                    if ((Height > gridmetafile.Height) || (Width > gridmetafile.Width))
                        forceredraw = true;
                    else
                        if ((GWidth != gridx) || (GHeight != gridy))
                            forceredraw = true;
                        else
                            if ((gridlines != Lines) || (gridscale != Scale) ||
                                (GColor != gridcolor) || (BackColor != gridbackcolor))
                                forceredraw = true;
                }
                if (!forceredraw && gridmetafile != null)
                    return gridmetafile;
                if (gridmetafile != null)
                    gridmetafile.Dispose();
                using (Graphics metagr = Graphics.FromImage(smallbit))
                {
                    gridmetafile = new System.Drawing.Imaging.Metafile(metagr.GetHdc(), new Rectangle(0, 0, Width, Height), MetafileFrameUnit.Pixel);
                }
                using (Graphics gr = Graphics.FromImage(gridmetafile))
                {
                    using (SolidBrush sbrush = new SolidBrush(BackColor))
                    {
                        gr.FillRectangle(sbrush, 0, 0, Width, Height);
                        DrawGrid(gr, GWidth, GHeight, Width, Height, GColor, Lines, 0, 0, Scale);
                    }
                }
                gridx = GWidth;
                gridy = GHeight;
                gridcolor = GColor;
                gridbackcolor = BackColor;
                gridlines = Lines;
                gridscale = Scale;
            }
            finally
            {
                Monitor.Exit(flag);
            }
            return gridmetafile;
        }
        private static int LogicalPointToDevicePoint(int origin, int destination, int avalue)
        {
            int aresult = (int)Math.Round(avalue * (destination / (double)origin));
            return aresult;
        }
        /// <summary>
        /// Draw a grid given a distance in twips
        /// </summary>
        /// <param name="gr">Destination</param>
        /// <param name="XWidth">Width in twips (1440 twips=1 inch)</param>
        /// <param name="XHeight">Height in twips</param>
        /// <param name="PixelsWidth">Width in pixels</param>
        /// <param name="PixelsHeight">Height in pixels</param>
        /// <param name="GridColor">Color of the points or lines drawn</param>
        /// <param name="Lines">Set to true to draw lines instead of points</param>
        /// <param name="XOffset">Horizontal offset </param>
        /// <param name="YOffset">Vertical offset</param>
        /// <param name="Scale">Scale the grid, set to 1.0 to draw in real size</param>
        public static void DrawGrid(Graphics gr, int XWidth, int XHeight,
            int PixelsWidth, int PixelsHeight, Color GridColor, bool Lines,
            int XOffset, int YOffset, double Scale)
        {
            double DpiX = gr.DpiX;
            double DpiY = gr.DpiY;
            if (XHeight <= 0)
                return;
            if (XWidth <= 0)
                return;
            Rectangle rect = new Rectangle(0, 0, PixelsWidth + XOffset, PixelsHeight + YOffset);
            double pixelsperinchx = DpiX * Scale;
            double pixelsperinchy = DpiY * Scale;
            int xof = (int)Math.Round(XOffset / pixelsperinchx * Twips.TWIPS_PER_INCH);
            int yof = (int)Math.Round(YOffset / pixelsperinchy * Twips.TWIPS_PER_INCH);
            int windowwidth = (int)Math.Round(Twips.TWIPS_PER_INCH * (rect.Width + XOffset) / pixelsperinchx);
            int windowheight = (int)Math.Round(Twips.TWIPS_PER_INCH * (rect.Height + XOffset) / pixelsperinchy);

            int originX = windowwidth;
            int originY = windowheight;
            int destinationX = rect.Width;
            int destinationY = rect.Height;
            int x, y;
            int avaluex, avaluey;
            int avalue2x, avalue2y;
            // Draw the grid
            if (Lines)
            {
                using (Pen gpen = new Pen(GridColor))
                {
                    x = xof + XWidth;
                    y = xof + XHeight;
                    while ((x < windowwidth) || (y < windowheight))
                    {
                        if (x < windowwidth)
                        {
                            avaluex = x;
                            avaluey = yof;
                            avaluex = LogicalPointToDevicePoint(originX, destinationX, avaluex);
                            avaluey = LogicalPointToDevicePoint(originY, destinationY, avaluey);
                            avalue2x = avaluex;
                            avalue2y = windowheight;
                            avalue2y = LogicalPointToDevicePoint(originY, destinationY, avalue2y);
                            gr.DrawLine(gpen, avaluex, avaluey, avalue2x, avalue2y);
                            x += XWidth;
                        }
                        if (y < windowheight)
                        {
                            avaluex = xof;
                            avaluey = y;
                            avaluex = LogicalPointToDevicePoint(originX, destinationX, avaluex);
                            avaluey = LogicalPointToDevicePoint(originY, destinationY, avaluey);
                            avalue2y = avaluey;
                            avalue2x = windowwidth;
                            avalue2x = LogicalPointToDevicePoint(originX, destinationX, avalue2x);
                            gr.DrawLine(gpen, avaluex, avaluey, avalue2x, avalue2y);
                            y += XHeight;
                        }
                    }
                }
            }
            else
            {
                using (Brush gbrush = new SolidBrush(GridColor))
                {
                    x = xof + XWidth;
                    while (x < windowwidth)
                    {
                        y = yof + XHeight;
                        while (y < windowheight)
                        {
                            avaluex = LogicalPointToDevicePoint(originX, destinationX, x);
                            avaluey = LogicalPointToDevicePoint(originY, destinationY, y);

                            gr.FillRectangle(gbrush, avaluex, avaluey, 1, 1);

                            y += XHeight;
                        }
                        x += XWidth;
                    }
                }
            }
        }
        /// <summary>
        /// Calculates the with in current graphics units of a text
        /// </summary>
        /// <param name="graphics">Graphics object where the measurement will be done</param>
        /// <param name="text">Text to be measured</param>
        /// <param name="font">Font used for the measurement</param>
        /// <returns>Width in graphic units of the measured text</returns>
        static public double MeasureDisplayStringWidth(Graphics graphics,
            string text, Font font)
        {
            System.Drawing.StringFormat format = new System.Drawing.StringFormat();
            System.Drawing.RectangleF rect = new System.Drawing.RectangleF(0, 0,
                                                                  1000, 1000);
            System.Drawing.CharacterRange[] ranges =
                                       { new System.Drawing.CharacterRange(0,
                                                               text.Length) };
            System.Drawing.Region[] regions = new System.Drawing.Region[1];

            format.SetMeasurableCharacterRanges(ranges);
            regions = graphics.MeasureCharacterRanges(text, font, rect, format);
            if (regions.Length > 0)
            {
                rect = regions[0].GetBounds(graphics);
                return rect.Width;
            }
            else
                return 0;
        }
        /// <summary>
        /// Write a Windows Metafile into a stream
        /// </summary>
        /// <param name="metaf">Metafile to write</param>
        /// <param name="destination">Stream destination</param>
        /// <param name="Scale">Scale of the Windows Metafile</param>
		public static void WriteWindowsMetaFile(
            System.Drawing.Imaging.Metafile metaf, Stream destination, float Scale)
        {
            Bitmap bm = new Bitmap(1, 1, PixelFormat.Format32bppArgb);
            bm.SetResolution(1440, 1440);
            Graphics g = Graphics.FromImage(bm);
            int awidth = (int)Math.Round(metaf.Width * Scale);
            int aheight = (int)Math.Round(metaf.Height * Scale);
            Metafile nwm;
            IntPtr dc = g.GetHdc();
            try
            {
                nwm = new Metafile(destination, dc,
                    new Rectangle(0, 0, awidth, aheight),
                    MetafileFrameUnit.Pixel, EmfType.EmfOnly);
            }
            finally
            {
                g.ReleaseHdc(dc);
            }
            try
            {
                g = Graphics.FromImage(nwm);
                try
                {
                    g.PageUnit = System.Drawing.GraphicsUnit.Pixel;
                    g.DrawImage(metaf, new Rectangle(0, 0, awidth, aheight));
                }
                finally
                {
                    g.Dispose();
                }
            }
            finally
            {
                nwm.Dispose();
            }
        }

        /// <summary>
        /// Obtain a list of available image codecs
        /// </summary>
        /// <returns>A list, string collection of image codecs</returns>
		public static Strings GetImageCodecs()
        {
            ImageCodecInfo[] codecs =
                System.Drawing.Imaging.ImageCodecInfo.GetImageEncoders();
            Strings alist = new Strings();
            string aext;
            alist.Add("WMF");
            foreach (ImageCodecInfo codec in codecs)
            {
                aext = codec.FormatDescription ?? "";
                alist.Add(aext);
            }
            return alist;
        }
        /// <summary>
        /// Returns the average character width and line height, in twips, for the given font family, size and style.
        /// </summary>
        /// <param name="FontFamily">Font family name.</param>
        /// <param name="FontSize">Font size in points.</param>
        /// <param name="FStyle">Font style flags.</param>
        /// <returns>A size whose width is the average character width and whose height is the line height, in twips.</returns>
        public static Size GetAvgFontSizeTwips(string FontFamily, float FontSize, FontStyle FStyle)
        {
            Size nresult = new Size(0, 0);
            Graphics gr;
            Bitmap nbitmap = new Bitmap(1, 1, PixelFormat.Format24bppRgb);
            using (nbitmap)
            {
                Font afont = new Font(FontFamily, FontSize, FStyle);
                gr = Graphics.FromImage(nbitmap);
                using (gr)
                {
                    SizeF nsize;
                    string text = "0000000000";
                    gr.PageUnit = GraphicsUnit.Pixel;
                    nsize = gr.MeasureString(text, afont, new PointF(0, 0),
                      StringFormat.GenericDefault);
                    nresult.Width = System.Convert.ToInt32(nsize.Width / 10 * 1440 / nbitmap.HorizontalResolution);
                    text = "Mg";
                    nsize = gr.MeasureString(text, afont, new PointF(0, 0),
                      StringFormat.GenericDefault);
                    nresult.Height = System.Convert.ToInt32(nsize.Height * 1440 / nbitmap.HorizontalResolution);
                }
                return nresult;
            }

        }
        /// <summary>
        /// Converts a text to his representation in bitmap form
        /// </summary>
        /// <param name="width">Witdh of the resulting bitmap</param>
        /// <param name="text">Text to be printed into the bitmap</param>
        /// <param name="fontfamily">Font family</param>
        /// <param name="fontsize">Font size</param>
        /// <returns>Returns a bitmap with the text drawn on it</returns>
		public static Bitmap TextToBitmap(int width, string text, string fontfamily,
            float fontsize)
        {
            SizeF asize;
            Font afont;
            Graphics gr;
            Bitmap nbitmap = new Bitmap(width, 1, PixelFormat.Format24bppRgb);
            using (nbitmap)
            {
                afont = new Font(fontfamily, fontsize);
                gr = Graphics.FromImage(nbitmap);
                using (gr)
                {
                    gr.PageUnit = GraphicsUnit.Pixel;
                    asize = gr.MeasureString(text, afont, width,
                        StringFormat.GenericDefault);
                }
            }
            nbitmap = new Bitmap(width, (int)Math.Round(asize.Height),
                PixelFormat.Format24bppRgb);
            try
            {
                gr = Graphics.FromImage(nbitmap);
                using (gr)
                {
                    gr.PageUnit = GraphicsUnit.Pixel;
                    Brush abrush = new SolidBrush(Color.White);
                    using (abrush)
                        gr.FillRectangle(abrush, 0, 0, nbitmap.Width, nbitmap.Height);
                    abrush = new SolidBrush(Color.Black);
                    using (abrush)
                        gr.DrawString(text, afont, abrush, 0, 0, StringFormat.GenericDefault);
                }
            }
            catch
            {
                nbitmap.Dispose();
                throw;
            }
            return nbitmap;
        }
        /// <summary>
        /// Convert a windows metafile to a image format saved into a stream
        /// </summary>
        /// <param name="metaf">Windows Metafile to be converted</param>
        /// <param name="destination">Destination stream</param>
        /// <param name="Scale">Scale of the metafile</param>
        /// <param name="codecstring">Codec to be used you can obtain a list by using GetImageCodecs</param>
        /// <param name="mimetype">Mimetype of the selected codec</param>
		public static void WriteWindowsMetaFileCodec(Metafile metaf,
            Stream destination,
            float Scale, string codecstring, out string mimetype)
        {
            mimetype = "";
            ImageCodecInfo[] codecs = ImageCodecInfo.GetImageEncoders();
            ImageCodecInfo codec = null;
            bool isbitmap = false;
            if (codecstring.Length >= 3)
            {
                if (codecstring.Substring(0, 3) == "BMP")
                    isbitmap = true;
            }
            if (isbitmap)
                mimetype = "image/bmp";
            else
            {
                string aext;
                foreach (ImageCodecInfo lcodec in codecs)
                {
                    aext = lcodec.FormatDescription ?? "";
                    if (aext == codecstring)
                    {
                        codec = lcodec;
                        mimetype = lcodec.MimeType ?? "";
                        break;
                    }
                }
                if (codec == null)
                    throw new Exception("Codec not found:" + codecstring);
            }
            Bitmap bm = new Bitmap(1, 1, PixelFormat.Format24bppRgb);
            bm.SetResolution(1440, 1440);
            Graphics g = Graphics.FromImage(bm);
            int awidth = (int)Math.Round(metaf.Width * Scale);
            int aheight = (int)Math.Round(metaf.Height * Scale);
            Bitmap output = new Bitmap(awidth, aheight, PixelFormat.Format24bppRgb);
            try
            {
                g = Graphics.FromImage(output);
                g.PageUnit = System.Drawing.GraphicsUnit.Pixel;
                g.DrawImage(metaf, new Rectangle(0, 0, awidth, aheight));
                g.Dispose();
                if (!isbitmap)
                {
                    if (codec == null)
                        throw new Exception("Codec not found:" + codecstring);
                    output.Save(destination, codec, null);
                }
                else
                    output.Save(destination, ImageFormat.Bmp);
            }
            finally
            {
                output.Dispose();
            }
        }
        /// <summary>
        /// Returns black or white, whichever provides better contrast against the given color.
        /// </summary>
        /// <param name="c">Reference color.</param>
        /// <returns><see cref="Color.Black"/> for light colors, <see cref="Color.White"/> for dark colors.</returns>
        public static Color GetInvertedBlackWhite(Color c)
        {
            if (((int)c.R + (int)c.G + (int)c.B) > ((int)255 * 3 / 2))
                return Color.Black;
            else
                return Color.White;
        }

        /// <summary>
        /// Converts an integer font-style bitmask to its localized bracketed string representation.
        /// </summary>
        /// <param name="intstyle">Bitmask of style flags (1=Bold, 2=Italic, 4=Underline, 8=Strikeout).</param>
        /// <returns>Localized bracketed style string, for example "[Bold,Italic]".</returns>
        public static string StringFontStyleFromInteger(int intstyle)
        {
            return StringFromFontStyle(FontStyleFromInteger(intstyle));
        }
        /// <summary>
        /// Parses a localized bracketed font-style string and returns the equivalent integer bitmask.
        /// </summary>
        /// <param name="sfontstyle">Localized bracketed style string to parse.</param>
        /// <returns>Bitmask of style flags (1=Bold, 2=Italic, 4=Underline, 8=Strikeout).</returns>
        public static int IntegerFromStringFontStyle(string sfontstyle)
        {
            int astyle = 0;
            if (sfontstyle.IndexOf(Translator.TranslateStr(547)) >= 0)
                astyle++;
            if (sfontstyle.IndexOf(Translator.TranslateStr(549)) >= 0)
                astyle += 2;
            if (sfontstyle.IndexOf(Translator.TranslateStr(548)) >= 0)
                astyle += 4;
            if (sfontstyle.IndexOf(Translator.TranslateStr(550)) >= 0)
                astyle += 8;
            return astyle;
        }
        /// <summary>
        /// Returns a localized bracketed string describing the flags set in the given font style.
        /// </summary>
        /// <param name="astyle">Font style flags.</param>
        /// <returns>Localized bracketed style string, for example "[Bold,Italic]".</returns>
        public static string StringFromFontStyle(FontStyle astyle)
        {
            string sfontstyle = "[";
            if ((astyle & FontStyle.Bold) > 0)
            {
                if (sfontstyle != "[")
                    sfontstyle += ",";
                sfontstyle += Translator.TranslateStr(547);
            }
            if ((astyle & FontStyle.Italic) > 0)
            {
                if (sfontstyle != "[")
                    sfontstyle += ",";
                sfontstyle += Translator.TranslateStr(549);
            }
            if ((astyle & FontStyle.Underline) > 0)
            {
                if (sfontstyle != "[")
                    sfontstyle += ",";
                sfontstyle += Translator.TranslateStr(548);
            }
            if ((astyle & FontStyle.Strikeout) > 0)
            {
                if (sfontstyle != "[")
                    sfontstyle += ",";
                sfontstyle += Translator.TranslateStr(550);
            }
            sfontstyle += "]";
            return sfontstyle;
        }
        /// <summary>
        /// Returns a copy of the image with the given color made transparent.
        /// </summary>
        /// <param name="img">Source image.</param>
        /// <param name="OldColor">Color to render transparent.</param>
        /// <returns>A new bitmap with the specified color made transparent.</returns>
        public static Image RemapImageTransparentColor(Image img, Color OldColor)
        {

            Bitmap nbitmap = new Bitmap(img);
            nbitmap.MakeTransparent(OldColor);
            return nbitmap;
        }
        /// <summary>
        /// Saves the image to a new BMP-encoded memory stream positioned at the beginning.
        /// </summary>
        /// <param name="nimage">Image to encode.</param>
        /// <returns>A memory stream containing the BMP-encoded image, rewound to position zero.</returns>
        public static MemoryStream ImageToStream(Image nimage)
        {
            MemoryStream nstream = new MemoryStream();
            nimage.Save(nstream, ImageFormat.Bmp);
            nstream.Seek(0, SeekOrigin.Begin);
            return nstream;
        }
        /// <summary>
        /// Returns the image encoded as a BMP byte array.
        /// </summary>
        /// <param name="nimage">Image to encode.</param>
        /// <returns>The BMP-encoded image bytes.</returns>
        public static byte[] ImageToByteArray(Image nimage)
        {
            byte[] narray;
            using (MemoryStream nstream = ImageToStream(nimage))
            {
                narray = nstream.ToArray();
            }
            return narray;
        }

        /*public static bool ThumbnailCallback()
        {
            return false;
        }*/
        /// <summary>
        /// Scales a pixel count by the current DPI scale factor.
        /// </summary>
        /// <param name="pixels">Pixel count at the reference DPI.</param>
        /// <returns>The pixel count scaled to the current screen DPI.</returns>
        public static int ScaleToDPI(int pixels)
        {
            return Convert.ToInt32(pixels * DPIScale);
        }
        /// <summary>
        /// Returns the image scaled by the current DPI scale factor, or the original image when no scaling is needed.
        /// </summary>
        /// <param name="image">Image to scale.</param>
        /// <returns>The scaled image, or the original image when the DPI scale is 1.</returns>
        public static System.Drawing.Image ScaleBitmapDPI(Image image)
        {
            if (DPIScale == 1.0)
                return image;
            else
                return ScaledBitmapRatio(image, Convert.ToInt32(image.Width * DPIScale), Convert.ToInt32(image.Height * DPIScale), true, true);
        }
        /// <summary>
        /// Scales the image to fit within the given width and height while preserving its aspect ratio.
        /// </summary>
        /// <param name="image">Image to scale.</param>
        /// <param name="width">Maximum width in pixels.</param>
        /// <param name="height">Maximum height in pixels.</param>
        /// <param name="highquality">When true, uses high-quality interpolation.</param>
        /// <param name="allowexpand">When true, allows the image to be enlarged beyond its original size.</param>
        /// <returns>The scaled image, or the original image when no scaling is required.</returns>
        public static System.Drawing.Image ScaledBitmapRatio(Image image, int width, int height, bool highquality, bool allowexpand)
        {
            if (!allowexpand)
            {
                if ((image.Width <= width) && (image.Height <= height))
                    return image;
            }

            //float scale = Math.Min((float)width / image.Width, (float)height / image.Height);

            float scaledWidth = ((float)width) / image.Width;
            float scaledHeight = ((float)height) / image.Height;
            float newscale = scaledWidth;
            if (scaledHeight < scaledWidth)
                newscale = scaledHeight;


            //var brush = new System.Drawing.SolidBrush(System.Drawing.Color.Black);

            int scaleWidth = (int)(image.Width * newscale);
            int scaleHeight = (int)(image.Height * newscale);

            /*System.Drawing.Image.GetThumbnailImageAbort myCallback = new System.Drawing.Image.GetThumbnailImageAbort(ThumbnailCallback);
            return image.GetThumbnailImage(scaleWidth, scaleHeight, myCallback, IntPtr.Zero);
            */
            var bmp = new System.Drawing.Bitmap((int)scaleWidth, (int)scaleHeight);

            using (System.Drawing.Graphics graph = System.Drawing.Graphics.FromImage(bmp))
            {

                if (highquality)
                {

                    graph.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                    graph.CompositingQuality = System.Drawing.Drawing2D.CompositingQuality.HighQuality;
                    graph.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
                    graph.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
                }




                graph.DrawImage(image, new System.Drawing.Rectangle(0, 0, bmp.Width - 1, bmp.Height - 1));

                //graph.FillRectangle(brush, new System.Drawing.RectangleF(0, 0, width, height));
                //graph.DrawImage(image, new System.Drawing.Rectangle(((int)width - System.Convert.ToInt32(scaleWidth)) / 2,
                //    ((int)height - System.Convert.ToInt32(scaleHeight)) / 2,
                //    System.Convert.ToInt32(scaleWidth),
                //    System.Convert.ToInt32(scaleHeight)));
            }

            return bmp;
        }


        /// <summary>
        /// Scale bitmap to a maximum of width and height
        /// </summary>
        /// <param name="image"></param>
        /// <param name="width"></param>
        /// <param name="height"></param>
        /// <param name="highquality"></param>
        /// <returns></returns>
        public static System.Drawing.Image ScaledBitmapRatio(Image image, int width, int height, bool highquality)
        {
            return ScaledBitmapRatio(image, width, height, highquality, false);
        }

        /// <summary>
        /// Returns a Image from stream. Do rotation for jpeg camera images
        /// </summary>
        /// <param name="mstream">Memory stream to read Image from</param>
        /// <returns>Image object</returns>
        public static System.Drawing.Image ImageFromStream(Stream mstream)
        {
            Image FBitmap = Image.FromStream(mstream);
            foreach (var prop in FBitmap.PropertyItems)
            {
                if (prop.Id == 0x112 && prop.Value != null)
                {
                    int orientation = prop.Value[0];
                    RotateFlipType flipType = GetRotateFlipTypeByExifOrientationData(orientation);
                    FBitmap.RotateFlip(flipType);
                    // do my rotate code - e.g "RotateFlip"
                    // Never get's in here - can't find these properties.
                }
            }
            return FBitmap;
        }
        /// <summary>
        /// Maps an EXIF orientation value (1-8) to the corresponding <see cref="RotateFlipType"/>.
        /// </summary>
        /// <param name="orientation">EXIF orientation value, from 1 to 8.</param>
        /// <returns>The rotate/flip transform that normalizes an image with the given orientation.</returns>
        public static RotateFlipType GetRotateFlipTypeByExifOrientationData(int orientation)
        {
            switch (orientation)
            {
                case 1:
                default:
                    return RotateFlipType.RotateNoneFlipNone;
                case 2:
                    return RotateFlipType.RotateNoneFlipX;
                case 3:
                    return RotateFlipType.Rotate180FlipNone;
                case 4:
                    return RotateFlipType.Rotate180FlipX;
                case 5:
                    return RotateFlipType.Rotate90FlipX;
                case 6:
                    return RotateFlipType.Rotate90FlipNone;
                case 7:
                    return RotateFlipType.Rotate270FlipX;
                case 8:
                    return RotateFlipType.Rotate270FlipNone;
            }
        }
        /// <summary>
        /// Returns an integer bitmask representing the flags set in the given font style.
        /// </summary>
        /// <param name="astyle">Font style flags.</param>
        /// <returns>Bitmask of style flags (1=Bold, 2=Italic, 4=Underline, 8=Strikeout).</returns>
        public static int IntegerFromFontStyle(FontStyle astyle)
        {
            int intfontstyle = 0;
            if ((astyle & FontStyle.Bold) > 0)
                intfontstyle++;
            if ((astyle & FontStyle.Italic) > 0)
                intfontstyle += 2;
            if ((astyle & FontStyle.Underline) > 0)
                intfontstyle += 4;
            if ((astyle & FontStyle.Strikeout) > 0)
                intfontstyle += 8;
            return intfontstyle;
        }
        /// <summary>
        /// Returns the image encoder whose MIME type matches the given string, or null if no encoder matches.
        /// </summary>
        /// <param name="mimeType">MIME type to match, for example "image/jpeg".</param>
        /// <returns>The matching encoder, or null when none is found.</returns>
        public static ImageCodecInfo GetEncoderInfo(String mimeType)
        {
            int j;
            ImageCodecInfo[] encoders;
            encoders = ImageCodecInfo.GetImageEncoders();
            for (j = 0; j < encoders.Length; ++j)
            {
                if (encoders[j].MimeType == mimeType)
                    return encoders[j];
            }
            return null;
        }
        private const int exifOrientationID = 0x112; //274
        /// <summary>
        /// Rotates the image in place according to its EXIF orientation tag, removes the tag, and
        /// returns true if the image was rotated; returns false when no rotation was needed.
        /// </summary>
        /// <param name="img">Image to rotate; modified in place.</param>
        /// <returns>True if the image was rotated, otherwise false.</returns>
        public static bool ExifRotate(Image img)
        {
            if (!img.PropertyIdList.Contains(exifOrientationID))
                return false;

            var prop = img.GetPropertyItem(exifOrientationID);
            if (prop == null || prop.Value == null)
                return false;
            int val = BitConverter.ToUInt16(prop.Value, 0);
            var rot = RotateFlipType.RotateNoneFlipNone;

            if (val == 3 || val == 4)
                rot = RotateFlipType.Rotate180FlipNone;
            else if (val == 5 || val == 6)
                rot = RotateFlipType.Rotate90FlipNone;
            else if (val == 7 || val == 8)
                rot = RotateFlipType.Rotate270FlipNone;

            if (val == 2 || val == 4 || val == 5 || val == 7)
                rot |= RotateFlipType.RotateNoneFlipX;

            if (rot != RotateFlipType.RotateNoneFlipNone)
            {
                img.RotateFlip(rot);
                img.RemovePropertyItem(exifOrientationID);
                return true;
            }
            else
            {
                return false;
            }
        }
        /// <summary>
        /// Returns the image codec whose filename extension matches the given extension.
        /// </summary>
        /// <param name="extension">File extension to match, for example "JPG".</param>
        /// <returns>The matching image codec.</returns>
        public static System.Drawing.Imaging.ImageCodecInfo GetImageCodecFromExtension(string extension)
        {
            System.Drawing.Imaging.ImageCodecInfo[] codecs
              = System.Drawing.Imaging.ImageCodecInfo.GetImageEncoders();


            foreach (System.Drawing.Imaging.ImageCodecInfo codec in codecs)
            {
                if (codec.FilenameExtension != null && codec.FilenameExtension.ToUpper().Contains("*" + extension.ToUpper()))
                {
                    return codec;
                }
            }
            throw new Exception("Codec not found for extension: " + extension);
        }
        /// <summary>
        /// Retuns a codec with the mime type or null if not found
        /// </summary>
        /// <param name="mimeType">Codec string, example "image/jpeg"</param>
        /// <returns></returns>
        public static System.Drawing.Imaging.ImageCodecInfo GetImageCodec(string mimeType)
        {
            System.Drawing.Imaging.ImageCodecInfo[] codecs
              = System.Drawing.Imaging.ImageCodecInfo.GetImageEncoders();


            foreach (System.Drawing.Imaging.ImageCodecInfo codec in codecs)
            {
                if (String.Compare(codec.MimeType,
                                   mimeType, true) == 0)
                {
                    return codec;
                }
            }


            return null;
        }
        /// <summary>
        /// Creates a FontStyle from an integer bitmask.
        /// </summary>
        /// <param name="intfontstyle">Bitmask of style flags (1=Bold, 2=Italic, 4=Underline, 8=Strikeout).</param>
        /// <returns>The corresponding FontStyle value.</returns>
        public static FontStyle FontStyleFromInteger(int intfontstyle)
        {
            FontStyle astyle = new FontStyle();
            if ((intfontstyle & 1) > 0)
                astyle |= FontStyle.Bold;
            if ((intfontstyle & 2) > 0)
                astyle |= FontStyle.Italic;
            if ((intfontstyle & 4) > 0)
                astyle |= FontStyle.Underline;
            if ((intfontstyle & 8) > 0)
                astyle |= FontStyle.Strikeout;
            return astyle;
        }


        /// <summary>
        /// Converts a bitmap to a 1-bit-per-pixel black-and-white image using the given brightness threshold.
        /// </summary>
        /// <param name="original">Source bitmap to convert.</param>
        /// <param name="threshold">Brightness threshold (sum of R, G and B) above which a pixel becomes white.</param>
        /// <returns>A new 1bpp indexed bitmap.</returns>
        public static System.Drawing.Bitmap ConvertToBitonal(System.Drawing.Bitmap original, int threshold)
        {
            System.Drawing.Bitmap source;

            if (original.PixelFormat == System.Drawing.Imaging.PixelFormat.Format1bppIndexed)
                return (System.Drawing.Bitmap)original.Clone();
            else if (original.PixelFormat != System.Drawing.Imaging.PixelFormat.Format32bppArgb)
            { // If original bitmap is not already in 32 BPP, ARGB format, then convert
                // unfortunately Clone doesn't do this for us but returns a bitmap with the same pixel format
                //source = original.Clone( new Rectangle( Point.Empty, original.Size ), PixelFormat.Format32bppArgb );
                source = new System.Drawing.Bitmap(original.Width, original.Height, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
                source.SetResolution(original.HorizontalResolution, original.VerticalResolution);
                using (System.Drawing.Graphics g = System.Drawing.Graphics.FromImage(source))
                {
                    //g.CompositingQuality = Drawing2D.CompositingQuality.GammaCorrected;
                    //g.InterpolationMode = Drawing2D.InterpolationMode.Low;
                    //g.SmoothingMode = Drawing2D.SmoothingMode.None;
                    g.DrawImageUnscaled(original, 0, 0);
                }
            }
            else
            {
                source = original;
            }

            // Lock source bitmap in memory
            System.Drawing.Imaging.BitmapData sourceData = source.LockBits(new System.Drawing.Rectangle(0, 0, source.Width, source.Height), System.Drawing.Imaging.ImageLockMode.ReadOnly, System.Drawing.Imaging.PixelFormat.Format32bppArgb);

            // Copy image data to binary array
            int imageSize = sourceData.Stride * sourceData.Height;
            byte[] sourceBuffer = new byte[imageSize];
            System.Runtime.InteropServices.Marshal.Copy(sourceData.Scan0, sourceBuffer, 0, imageSize);

            // Unlock source bitmap
            source.UnlockBits(sourceData);

            // Dispose of source if not originally supplied bitmap
            if (source != original)
            {
                source.Dispose();
            }

            // Create destination bitmap
            System.Drawing.Bitmap destination = new System.Drawing.Bitmap(sourceData.Width, sourceData.Height, System.Drawing.Imaging.PixelFormat.Format1bppIndexed);
            destination.SetResolution(original.HorizontalResolution, original.VerticalResolution);

            // Lock destination bitmap in memory
            System.Drawing.Imaging.BitmapData destinationData = destination.LockBits(new System.Drawing.Rectangle(0, 0, destination.Width, destination.Height), System.Drawing.Imaging.ImageLockMode.WriteOnly, System.Drawing.Imaging.PixelFormat.Format1bppIndexed);

            // Create destination buffer
            byte[] destinationBuffer = SimpleThresholdBW(
            sourceBuffer,
            sourceData.Width,
            sourceData.Height,
            sourceData.Stride,
            destinationData.Stride, threshold);

            // Copy binary image data to destination bitmap
            System.Runtime.InteropServices.Marshal.Copy(destinationBuffer, 0, destinationData.Scan0, destinationData.Stride * sourceData.Height);

            // Unlock destination bitmap
            destination.UnlockBits(destinationData);

            // Return
            return destination;
        }
        /// <summary>
        /// Applies a brightness threshold to 32bpp ARGB source pixel data and returns a packed 1bpp black-and-white buffer.
        /// </summary>
        /// <param name="sourceBuffer">Source pixel data in 32bpp ARGB layout.</param>
        /// <param name="width">Image width in pixels.</param>
        /// <param name="height">Image height in pixels.</param>
        /// <param name="srcStride">Row stride of the source buffer in bytes.</param>
        /// <param name="dstStride">Row stride of the destination buffer in bytes.</param>
        /// <param name="threshold">Brightness threshold (sum of R, G and B) above which a pixel becomes white.</param>
        /// <returns>A packed 1bpp black-and-white pixel buffer.</returns>
        public static byte[] SimpleThresholdBW(byte[] sourceBuffer, int width, int height, int srcStride, int dstStride, int threshold)
        {
            byte[] destinationBuffer = new byte[dstStride * height];
            int srcIx = 0;
            int dstIx = 0;
            byte bit;
            byte pix8;

            int newpixel, i, j;

            // Iterate lines
            for (int y = 0; y < height; y++, srcIx += srcStride, dstIx += dstStride)
            {
                bit = 128;
                i = srcIx;
                j = dstIx;
                pix8 = 0;
                // Iterate pixels
                for (int x = 0; x < width; x++, i += 4)
                {
                    // Compute pixel brightness (i.e. total of Red, Green, and Blue values)
                    newpixel = sourceBuffer[i] + sourceBuffer[i + 1] + sourceBuffer[i + 2];

                    if (newpixel > threshold)
                        pix8 |= bit;
                    if (bit == 1)
                    {
                        destinationBuffer[j++] = pix8;
                        bit = 128;
                        pix8 = 0; // init next value with 0
                    }
                    else
                        bit >>= 1;
                } // line finished
                if (bit != 128)
                    destinationBuffer[j] = pix8;
            } // all lines finished
            return destinationBuffer;
        }


    }
}
