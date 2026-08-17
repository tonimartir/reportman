using System;
using System.IO;

namespace Reportman.Drawing.CrossPlatform
{
    /// <summary>
    /// PDF driver with NO font provider: text is written with the 14 PDF standard fonts
    /// (Helvetica, Courier, Times...) and their built-in metrics, WinAnsi only, nothing embedded.
    /// Linked/Embedded requests fall back to Helvetica. This is exactly what the Delphi engine
    /// does on Android, and it needs no native library besides SkiaSharp (image decoding),
    /// so it runs wherever FreeType/HarfBuzz/ICU are not available yet.
    /// Trade-offs: no shaping (no RTL, no CJK), no font embedding, Arial becomes Helvetica.
    /// </summary>
    public class PrintOutPDFStandard : PrintOutPDFBase, IBitmapInfoProvider
    {
        /// <summary>Decodes the image with SkiaSharp and returns its pixel size.</summary>
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

        /// <summary>This instance decodes the images.</summary>
        public override IBitmapInfoProvider GetBitmapInfoProvider()
        {
            return this;
        }

        /// <summary>No provider: standard fonts only.</summary>
        public override FontInfoProvider GetFontInfoProvider()
        {
            return null;
        }

        /// <summary>Re-encodes an image stream as BMP with SkiaSharp.</summary>
        public MemoryStream EncodeImageStreamAsBitmapStream(MemoryStream stream)
        {
            var newimage = SkiaSharp.SKBitmap.Decode(stream);
            MemoryStream newbitmapstream = new MemoryStream();
            newimage.Encode(newbitmapstream, SkiaSharp.SKEncodedImageFormat.Bmp, 100);
            newbitmapstream.Seek(0, SeekOrigin.Begin);
            return newbitmapstream;
        }
    }
}
