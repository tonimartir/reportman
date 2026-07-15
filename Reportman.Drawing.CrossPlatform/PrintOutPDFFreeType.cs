using System.IO;

namespace Reportman.Drawing.CrossPlatform
{
    /// <summary>
    /// Cross-platform PDF render driver that uses FreeType for font metrics and SkiaSharp for image
    /// handling, supplying its own bitmap-info and font-info providers for portable PDF generation.
    /// </summary>
    public class PrintOutPDFFreeType : PrintOutPDFBase, IBitmapInfoProvider
    {
        FontInfoFt FontInfoProv = new FontInfoFt();
        /// <summary>
        /// Decodes the image from the supplied stream using SkiaSharp and returns its
        /// width and height wrapped in a <see cref="BitmapInfo"/> instance.
        /// </summary>
        /// <param name="stream">A readable stream containing the image data.</param>
        /// <returns>A <see cref="BitmapInfo"/> with the pixel dimensions of the image.</returns>
        public BitmapInfo GetBitmapInfo(Stream stream)
        {
            BitmapInfo info = new BitmapInfo();
            using (SkiaSharp.SKBitmap bitmap = SkiaSharp.SKBitmap.Decode(stream))
            {
                info.Width = bitmap.Width;
                info.Height = bitmap.Height;
            }
            return info;
        }

        /// <summary>
        /// Returns this instance as the bitmap-info provider, since the class itself
        /// implements <see cref="IBitmapInfoProvider"/>.
        /// </summary>
        /// <returns>This <see cref="PrintOutPDFFreeType"/> instance.</returns>
        public override IBitmapInfoProvider GetBitmapInfoProvider()
        {
            return this;
        }

        /// <summary>
        /// Returns the FreeType-based font-info provider used for font metrics during
        /// PDF generation.
        /// </summary>
        /// <returns>A <see cref="FontInfoProvider"/> backed by FreeType.</returns>
        public override FontInfoProvider GetFontInfoProvider()
        {
            return FontInfoProv;
        }
        /// <summary>
        /// Decodes an image from the supplied stream using SkiaSharp and re-encodes it
        /// as a BMP bitmap, returning the result in a new <see cref="MemoryStream"/>
        /// positioned at the beginning.
        /// </summary>
        /// <param name="stream">A <see cref="System.IO.MemoryStream"/> containing the source image data.</param>
        /// <returns>A new <see cref="MemoryStream"/> containing the BMP-encoded image.</returns>
        public System.IO.MemoryStream EncodeImageStreamAsBitmapStream(System.IO.MemoryStream stream)
        {
            var newimage = SkiaSharp.SKBitmap.Decode(stream);
            MemoryStream newbitmapstream = new MemoryStream();
            newimage.Encode(newbitmapstream, SkiaSharp.SKEncodedImageFormat.Bmp, 100);
            newbitmapstream.Seek(0, System.IO.SeekOrigin.Begin);
            return newbitmapstream;
        }

    }
}
