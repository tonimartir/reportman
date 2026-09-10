using System.IO;
using Reportman.Drawing;

namespace Reportman.Drawing.CrossPlatform
{
    /// <summary>
    /// Image decoding for the render drivers, backed by SkiaSharp and nothing else.
    ///
    /// The two PDF drivers already implement <see cref="IBitmapInfoProvider"/> themselves, so until
    /// now there was no need for a type of its own. <see cref="PrintOutText"/> changed that: it
    /// prints a logo as raster graphics on ESC/POS and needs a decoder, and borrowing a PDF driver
    /// just to decode an image would drag in whatever that driver needs. This one needs only Skia.
    ///
    /// THAT MATTERS ON ANDROID. <see cref="PrintOutPDFFreeType"/> is the better PDF driver but it
    /// loads native FreeType, which some devices do not, and the host falls back to
    /// <see cref="PrintOutPDFStandard"/> when that happens. Decoding an image has nothing to do with
    /// fonts, so it should not be hostage to that fallback: SkiaSharp is present wherever the app
    /// draws anything at all, Android included.
    /// </summary>
    public sealed class SkiaBitmapInfoProvider : IBitmapInfoProvider
    {
        /// <summary>Reads the pixel dimensions without keeping the decoded image around.</summary>
        public BitmapInfo GetBitmapInfo(Stream stream)
        {
            BitmapInfo info = new BitmapInfo();
            long previous = stream.CanSeek ? stream.Position : 0;
            using (SkiaSharp.SKBitmap bitmap = SkiaSharp.SKBitmap.Decode(stream))
            {
                if (bitmap != null)
                {
                    info.Width = bitmap.Width;
                    info.Height = bitmap.Height;
                }
            }
            if (stream.CanSeek)
                stream.Position = previous;
            return info;
        }

        /// <summary>
        /// Re-encodes the image as an uncompressed 32-bit BMP, positioned at the beginning.
        /// </summary>
        /// <remarks>
        /// THE HEADER IS WRITTEN BY HAND, and that is not reinventing anything: Skia dropped its BMP
        /// ENCODER years ago (it still decodes them), so <c>SKBitmap.Encode(..., SKEncodedImageFormat.Bmp,
        /// ...)</c> returns false and leaves an EMPTY stream — silently, which is how it went unnoticed.
        /// Measured here on a 600x600 PNG: zero bytes out.
        ///
        /// So Skia decodes —which is the hard half, and the half that knows about PNG, JPEG, WEBP and
        /// the rest— and the forty bytes of a BITMAPINFOHEADER plus the rows go out from here. BI_RGB,
        /// bottom-up, BGRA: the plainest BMP there is, which is what a consumer of this interface
        /// expects to be able to read without a codec.
        /// </remarks>
        public MemoryStream EncodeImageStreamAsBitmapStream(MemoryStream stream)
        {
            MemoryStream result = new MemoryStream();
            using (SkiaSharp.SKBitmap bitmap = SkiaSharp.SKBitmap.Decode(stream))
            {
                if (bitmap == null || bitmap.Width <= 0 || bitmap.Height <= 0)
                {
                    result.Seek(0, SeekOrigin.Begin);
                    return result;
                }
                int w = bitmap.Width, h = bitmap.Height;
                int stride = w * 4;                                // 32 bpp is already 4-byte aligned
                int pixels = stride * h;
                const int headers = 14 + 40;                       // BITMAPFILEHEADER + BITMAPINFOHEADER

                BinaryWriter wr = new BinaryWriter(result);
                wr.Write((byte)'B'); wr.Write((byte)'M');
                wr.Write(headers + pixels);                        // file size
                wr.Write(0);                                       // reserved
                wr.Write(headers);                                 // offset to the pixels
                wr.Write(40);                                      // header size
                wr.Write(w);
                wr.Write(h);                                       // positive: rows bottom-up
                wr.Write((short)1);                                // planes
                wr.Write((short)32);                               // bits per pixel
                wr.Write(0);                                       // BI_RGB, no compression
                wr.Write(pixels);
                wr.Write(2835); wr.Write(2835);                    // 72 dpi in pixels per metre
                wr.Write(0); wr.Write(0);                          // no palette

                SkiaSharp.SKColor[] src = bitmap.Pixels;           // unpremultiplied RGBA
                byte[] row = new byte[stride];
                for (int y = h - 1; y >= 0; y--)                   // bottom-up
                {
                    int p = 0;
                    for (int x = 0; x < w; x++)
                    {
                        SkiaSharp.SKColor c = src[y * w + x];
                        row[p++] = c.Blue; row[p++] = c.Green; row[p++] = c.Red; row[p++] = c.Alpha;
                    }
                    wr.Write(row, 0, stride);
                }
                wr.Flush();
            }
            result.Seek(0, SeekOrigin.Begin);
            return result;
        }
    }
}
