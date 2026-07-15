using System;
using System.Drawing;
using System.Threading;

namespace Reportman.Drawing
{
    /// <summary>
    /// Helper for converting between twips and screen pixels at the current display DPI (with an
    /// optional scale factor) and for snapping points to a design grid.
    /// </summary>
    public class TwipsGraphics
    {
        /// <summary>
        /// Returns number of pixels (uses screen pixels per inch) from a twips measure
        /// scaled
        /// </summary>
        /// <param name="twips"></param>
        /// <param name="scale"></param>
        /// <returns></returns>
        public static int TwipsToPixels(int twips, double scale)
        {
            Monitor.Enter(flag);
            try
            {
                if (ScreenDPI == 0.0F)
                {
                    using (System.Drawing.Bitmap bm = new System.Drawing.Bitmap(5, 5))
                    {
                        using (System.Drawing.Graphics gr = System.Drawing.Graphics.FromImage(bm))
                        {
                            ScreenDPI = gr.DpiX;
                            if (ScreenDPI == 0)
                                ScreenDPI = 96.0F;
                        }
                    }
                }
            }
            finally
            {
                Monitor.Exit(flag);
            }

            return (int)Math.Round(((double)twips / Twips.TWIPS_PER_INCH) * ScreenDPI * scale);
        }
        /// <summary>
        /// Returns number of twips from a scaled pixels measure (uses screen pixels per inch)
        /// </summary>
        /// <param name="pixels">Scaled pixels to convert</param>
        /// <param name="scale">Scale factor</param>
        /// <returns></returns>
        public static int PixelsToTwips(int pixels, double scale)
        {
            Monitor.Enter(flag);
            try
            {
                if (ScreenDPI == 0.0F)
                {
                    using (System.Drawing.Bitmap bm = new System.Drawing.Bitmap(5, 5))
                    {
                        using (System.Drawing.Graphics gr = System.Drawing.Graphics.FromImage(bm))
                        {
                            ScreenDPI = gr.DpiX;
                            if (ScreenDPI == 0)
                                ScreenDPI = 96.0F;
                        }
                    }
                }
            }
            finally
            {
                Monitor.Exit(flag);
            }

            return (int)Math.Round(((double)pixels * Twips.TWIPS_PER_INCH) / (ScreenDPI * scale));
        }
        /// <summary>
        /// Snaps a pixel-space point to the nearest design-grid intersection by
        /// converting to twips, rounding to the grid, and converting back.
        /// </summary>
        /// <param name="npoint">The point in screen pixels.</param>
        /// <param name="gridx">Horizontal grid spacing in twips.</param>
        /// <param name="gridy">Vertical grid spacing in twips.</param>
        /// <param name="scale">Current display scale factor.</param>
        /// <returns>The grid-aligned point in screen pixels.</returns>
        public static Point AlignToGridPixels(Point npoint, int gridx, int gridy, double scale)
        {
            npoint = new Point(PixelsToTwips(npoint.X, scale),
                 PixelsToTwips(npoint.Y, scale));
            npoint = new Point(((npoint.X + gridx / 2) / gridx) * gridx, ((npoint.Y + gridy / 2) / gridy) * gridy);
            return new Point(TwipsToPixels(npoint.X, scale), TwipsToPixels(npoint.Y, scale));
        }
        /// <summary>
        /// Snaps a single pixel-space coordinate to the nearest horizontal grid line by
        /// converting to twips, rounding to the grid, and converting back.
        /// </summary>
        /// <param name="x">The coordinate in screen pixels.</param>
        /// <param name="gridx">Horizontal grid spacing in twips.</param>
        /// <param name="gridy">Vertical grid spacing in twips (unused but kept for API symmetry).</param>
        /// <param name="scale">Current display scale factor.</param>
        /// <returns>The grid-aligned coordinate in screen pixels.</returns>
        public static int AlignToGridPixels(int x, int gridx, int gridy, double scale)
        {
            x = PixelsToTwips(x, scale);
            x = ((x + gridx / 2) / gridx) * gridx;
            return TwipsToPixels(x, scale);
        }
        /// <summary>
        /// Align to grid a point
        /// </summary>
        /// <param name="npoint"></param>
        /// <param name="gridx"></param>
        /// <param name="gridy"></param>
        /// <returns></returns>
        public static Point AlignToGridTwips(Point npoint, int gridx, int gridy)
        {
            npoint = new Point(((npoint.X + gridx / 2) / gridx) * gridx, ((npoint.Y + gridy / 2) / gridy) * gridy);
            return npoint;
        }
        private static object flag = 1;
        private static float ScreenDPI = 0.0F;
    }
}
