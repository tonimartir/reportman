
namespace Reportman.Drawing
{
    /// <summary>
    /// Provides image inspection services for render drivers: reading the dimensions of an encoded
    /// image and re-encoding an image stream into bitmap (BMP) format.
    /// </summary>
    public interface IBitmapInfoProvider
    {
        /// <summary>
        /// Reads and extracts the dimensions of the image contained in the stream without loading the full image data.
        /// </summary>
        /// <param name="stream">The image stream to inspect.</param>
        /// <returns>A BitmapInfo containing the image dimensions.</returns>
        BitmapInfo GetBitmapInfo(System.IO.Stream stream);
        /// <summary>
        /// Re-encodes the supplied image stream into bitmap (BMP) format.
        /// </summary>
        /// <param name="stream">The source image stream.</param>
        /// <returns>A memory stream containing the bitmap encoded data.</returns>
        System.IO.MemoryStream EncodeImageStreamAsBitmapStream(System.IO.MemoryStream stream);
    }
    /// <summary>
    /// Holds the pixel dimensions (width and height) of a decoded image.
    /// </summary>
    public class BitmapInfo
    {
        /// <summary>
        /// The width of the image in pixels.
        /// </summary>
        public int Width;
        /// <summary>
        /// The height of the image in pixels.
        /// </summary>
        public int Height;
    }
}
