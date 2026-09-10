using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Reportman.Drawing.CrossPlatform
{
        /// <summary>
        /// Cross-platform PDF render driver that uses FreeType for font metrics and SkiaSharp for image
        /// handling, supplying its own bitmap-info and font-info providers for portable PDF generation.
        /// </summary>
        public class PrintOutPDFFreeType : PrintOutPDFBase,IBitmapInfoProvider
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
            /// <remarks>
            /// IT DELEGATES, and that is the fix: this used to call
            /// <c>SKBitmap.Encode(..., SKEncodedImageFormat.Bmp, ...)</c>, and Skia dropped its BMP
            /// ENCODER years ago (it still decodes them). The call returns false and leaves an EMPTY
            /// stream, in silence. Measured on a 600x600 PNG: zero bytes.
            ///
            /// It is not a latent bug: <see cref="Reportman.Drawing.PDFCanvas"/> only comes through
            /// here for what PDF cannot embed as it is —a JPEG goes in verbatim as DCTDecode and a
            /// BMP is read directly— which leaves PNG and GIF. So every PNG placed in a report was
            /// silently missing from the PDF: an image XObject with no pixels, which even counts as
            /// an image to a PDF reader, so a test that counts images passes while the page is blank.
            /// </remarks>
            public System.IO.MemoryStream EncodeImageStreamAsBitmapStream(System.IO.MemoryStream stream)
            {
                return new SkiaBitmapInfoProvider().EncodeImageStreamAsBitmapStream(stream);
            }

        }
}
