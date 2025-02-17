
namespace Reportman.Drawing
{
    public interface IBitmapInfoProvider
    {
        BitmapInfo GetBitmapInfo(System.IO.Stream stream);
        System.IO.MemoryStream EncodeImageStreamAsBitmapStream(System.IO.MemoryStream stream);
    }
    public class BitmapInfo
    {
        public int Width;
        public int Height;
    }
}
