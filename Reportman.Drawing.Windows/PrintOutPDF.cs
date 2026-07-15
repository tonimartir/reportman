using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Reportman.Drawing
{
    /// <summary>
    /// PDF render driver that uses GDI+/System.Drawing for font metrics and bitmap handling,
    /// and provides helpers to encode images and build a PDF directly from a sequence of images.
    /// </summary>
    public class PrintOutPDF : PrintOutPDFBase, IBitmapInfoProvider
    {
        /// <summary>
        /// Gets the font information provider instance, which is configured for GDI+ on Windows.
        /// </summary>
        /// <returns>A <see cref="FontInfoProvider"/> instance used for retrieving font metrics.</returns>
        public override FontInfoProvider GetFontInfoProvider()
        {
            return new FontInfoGDI();
        }
        /// <summary>
        /// Retrieves metadata (such as width and height) for a bitmap image loaded from the specified stream.
        /// </summary>
        /// <param name="stream">The source <see cref="Stream"/> containing the image data.</param>
        /// <returns>A <see cref="BitmapInfo"/> instance containing image details.</returns>
        public BitmapInfo GetBitmapInfo(Stream stream)
        {
            BitmapInfo info = new BitmapInfo();
            using (System.Drawing.Image nimage = System.Drawing.Image.FromStream(stream))
            {
                info.Width = nimage.Width;
                info.Height = nimage.Height;
            }
            return info;
        }
        /// <summary>
        /// Re-encodes the provided image stream as a 32-bit ARGB BMP stream.
        /// </summary>
        /// <param name="stream">The original image stream as a <see cref="MemoryStream"/>.</param>
        /// <returns>A new <see cref="MemoryStream"/> containing the BMP-formatted image data.</returns>
        public System.IO.MemoryStream EncodeImageStreamAsBitmapStream(System.IO.MemoryStream stream)
        {
            System.IO.MemoryStream newbitmapstream = new System.IO.MemoryStream();
            var newimage = System.Drawing.Image.FromStream(stream);
            try
            {
                using (System.Drawing.Bitmap newbitmap = new System.Drawing.Bitmap(newimage.Width, newimage.Height, System.Drawing.Imaging.PixelFormat.Format32bppArgb))
                {
                    using (System.Drawing.Graphics gr = System.Drawing.Graphics.FromImage(newbitmap))
                    {
                        gr.FillRectangle(System.Drawing.Brushes.Transparent, new System.Drawing.Rectangle(0, 0, newbitmap.Width, newbitmap.Height));
                        gr.DrawImage(newimage, new System.Drawing.Rectangle(0, 0, newbitmap.Width, newbitmap.Height));
                    }
                    newbitmap.Save(newbitmapstream, System.Drawing.Imaging.ImageFormat.Bmp);
                }
            }
            finally
            {
                newimage.Dispose();
            }
            newbitmapstream.Seek(0, System.IO.SeekOrigin.Begin);
            return newbitmapstream;
        }

        /// <summary>
        /// Gets the current instance as the bitmap information provider.
        /// </summary>
        /// <returns>An <see cref="IBitmapInfoProvider"/> reference to this instance.</returns>
        public override IBitmapInfoProvider GetBitmapInfoProvider()
        {
            return this;
        }
        /// <summary>
        /// Converts a sequence of images into a PDF document and returns it as a memory stream.
        /// </summary>
        /// <param name="images">The collection of <see cref="System.Drawing.Image"/> objects to include in the PDF.</param>
        /// <param name="dpi">The target DPI resolution for the PDF document pages.</param>
        /// <param name="nformat">The image format used to process the images (e.g., JPEG or BMP).</param>
        /// <param name="quality">The JPEG compression quality level (used if the format is not BMP/GIF).</param>
        /// <param name="ndepth">The image color depth rendering mode to apply to the images.</param>
        /// <param name="Conformance">The PDF conformance type (e.g. PDF/A-1b).</param>
        /// <returns>A <see cref="MemoryStream"/> containing the generated PDF data.</returns>
        public static System.IO.MemoryStream ImagesToPDF(System.Collections.Generic.IEnumerable<System.Drawing.Image> images, int dpi, System.Drawing.Imaging.ImageFormat nformat, int quality, ImageDepth ndepth, PDFConformanceType Conformance)
        {
            System.IO.MemoryStream nresult = null;
            System.Drawing.Imaging.ImageCodecInfo icodec = null;
            bool getcodec = true;
            Reportman.Drawing.MetaFile nmetafile = new Reportman.Drawing.MetaFile();
            nmetafile.PDFConformance = Conformance;
            nmetafile.PageSizeIndex = 0;
            int index = 0;
            foreach (System.Drawing.Image nimage in images)
            {
                if (index == 0)
                {
                    nmetafile.CustomX = nimage.Width * 1440 / dpi;
                    nmetafile.CustomY = nimage.Height * 1440 / dpi;
                }
                Reportman.Drawing.MetaPage npage = new Reportman.Drawing.MetaPage(nmetafile);
                npage.PageDetail.Custom = true;
                npage.PageDetail.CustomWidth = nimage.Width * 1440 / dpi;
                npage.PageDetail.CustomHeight = nimage.Height * 1440 / dpi;
                nmetafile.Pages.Add(npage);

                int pwidth = nimage.Width * 1440 / dpi;
                int pheight = nimage.Height * 1440 / dpi;
                using (System.IO.MemoryStream mstream = new System.IO.MemoryStream())
                {
                    if ((nformat == System.Drawing.Imaging.ImageFormat.Gif) || (nformat == System.Drawing.Imaging.ImageFormat.Bmp))
                    {
                        if ((ndepth == ImageDepth.BW) || (ndepth == ImageDepth.Text) || (ndepth == ImageDepth.TextQuality)
                             || (ndepth == ImageDepth.BWImage))
                        {
                            System.Drawing.Bitmap nbitmaptosave = null;
                            System.Drawing.Bitmap nbitmaptoconvert = null;
                            if (nimage is System.Drawing.Bitmap)
                            {
                                if (nimage.PixelFormat == System.Drawing.Imaging.PixelFormat.Format1bppIndexed)
                                    nbitmaptosave = (System.Drawing.Bitmap)nimage;
                                else
                                    nbitmaptoconvert = (System.Drawing.Bitmap)nimage;
                            }
                            else
                            {
                                nbitmaptoconvert = new System.Drawing.Bitmap(nimage.Width, nimage.Height, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
                                using (System.Drawing.Graphics ngraph = System.Drawing.Graphics.FromImage(nbitmaptoconvert))
                                {
                                    ngraph.DrawImage(nimage, new System.Drawing.Point(0, 0));
                                }
                            }
                            if (nbitmaptosave == null)
                            {
                                nbitmaptosave = Windows.GraphicUtils.ConvertToBitonal(nbitmaptoconvert, 255 * 3 / 2);
                            }
                            if (nbitmaptoconvert != null)
                            {
                                if (nbitmaptoconvert != nimage)
                                {
                                    nbitmaptoconvert.Dispose();
                                }
                            }
                            nbitmaptosave.Save(mstream, System.Drawing.Imaging.ImageFormat.Bmp);
                        }
                        else
                        {
                            System.Drawing.Image nbitmap = null;
                            if ((nimage.PixelFormat != System.Drawing.Imaging.PixelFormat.Format8bppIndexed) && (nimage.PixelFormat != System.Drawing.Imaging.PixelFormat.Format4bppIndexed))
                            {
                                throw new Exception("ImageDepth Indexed not supported in .Net Core");
                                // nbitmap = ImageOptimizer.ConvertToBitmapDepth(nimage, 256);
                            }
                            else
                            {
                                nbitmap = nimage;
                            }
                            mstream.SetLength(0);
                            nimage.Save(mstream, System.Drawing.Imaging.ImageFormat.Bmp);
                        }
                    }
                    else
                    {
                        if (getcodec)
                        {
                            icodec = Reportman.Drawing.Windows.GraphicUtils.GetImageCodec("image/jpeg");
                            getcodec = false;
                        }
                        if (icodec != null)
                        {
                            System.Drawing.Imaging.EncoderParameters eparams = new System.Drawing.Imaging.EncoderParameters(1);
                            System.Drawing.Imaging.EncoderParameter qParam = new System.Drawing.Imaging.EncoderParameter(System.Drawing.Imaging.Encoder.Quality,
                                (long)quality);
                            eparams.Param[0] = qParam;
                            nimage.Save(mstream, icodec, eparams);
                        }
                        else
                            nimage.Save(mstream, System.Drawing.Imaging.ImageFormat.Bmp);

                    }
                    mstream.Seek(0, System.IO.SeekOrigin.Begin);
                    npage.DrawImage(0, 0, pwidth, pheight, Reportman.Drawing.ImageDrawStyleType.Stretch, dpi, mstream);

                }
                index++;
            }
            if (index == 0)
                throw new Exception("No images suplied to ImagesToPDF");

            nmetafile.Finish();
            Reportman.Drawing.PrintOutPDF npdf = new Reportman.Drawing.PrintOutPDF();
            if (nformat == System.Drawing.Imaging.ImageFormat.Bmp)
                npdf.Compressed = true;
            else
                npdf.Compressed = false;
            npdf.Print(nmetafile);
            nresult = Reportman.Drawing.StreamUtil.StreamToMemoryStream(npdf.PDFStream);
            return nresult;
        }
        /// <summary>
        /// Color depth and rendering mode used when embedding images into the PDF, ranging from
        /// full color through grayscale to bitonal black-and-white and text-optimized variants.
        /// </summary>
        public enum ImageDepth
        {
            /// <summary>
            /// Full color mode.
            /// </summary>
            Color,
            /// <summary>
            /// Grayscale mode.
            /// </summary>
            GrayScale,
            /// <summary>
            /// Bitonal black and white mode.
            /// </summary>
            BW,
            /// <summary>
            /// Text-optimized rendering mode.
            /// </summary>
            Text,
            /// <summary>
            /// High quality text-optimized mode.
            /// </summary>
            TextQuality,
            /// <summary>
            /// Black and white image mode.
            /// </summary>
            BWImage,
            /// <summary>
            /// 8-bit color depth mode.
            /// </summary>
            Color8bit,
            /// <summary>
            /// 4-bit color depth mode.
            /// </summary>
            Color4bit
        };


    }
}
