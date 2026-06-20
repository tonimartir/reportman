
namespace Reportman.Drawing
{
    /// <summary>
    /// Provides image inspection services for render drivers: reading the dimensions of an encoded
    /// image and re-encoding an image stream into bitmap (BMP) format.
    /// </summary>
    public interface IBitmapInfoProvider
    {
        BitmapInfo GetBitmapInfo(System.IO.Stream stream);
        System.IO.MemoryStream EncodeImageStreamAsBitmapStream(System.IO.MemoryStream stream);
    }
    /// <summary>
    /// Holds the pixel dimensions (width and height) of a decoded image.
    /// </summary>
    public class BitmapInfo
    {
        public int Width;
        public int Height;
    }
}
