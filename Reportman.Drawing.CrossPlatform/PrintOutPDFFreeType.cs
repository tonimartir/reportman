using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Reportman.Drawing.CrossPlatform
{
        public class PrintOutPDFFreeType : PrintOutPDFBase,IBitmapInfoProvider
        {
            FontInfoFt FontInfoProv = new FontInfoFt();
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

            public override IBitmapInfoProvider GetBitmapInfoProvider()
            {
                return this;
            }

            public override FontInfoProvider GetFontInfoProvider()
            {
                return FontInfoProv;
            }
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
