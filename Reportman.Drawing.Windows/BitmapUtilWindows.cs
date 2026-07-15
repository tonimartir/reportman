using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Reportman.Drawing.Windows
{
    /// <summary>
    /// Windows-specific bitmap helpers, including an extension method that resolves the default file
    /// extension for a given <see cref="System.Drawing.Imaging.ImageFormat"/>.
    /// </summary>
    public static class BitmapUtilWindows
    {
        /// <summary>
        /// Gets the standard file extension (with a leading dot) for a given ImageFormat.
        /// It queries the system's registered image encoders and defaults to the lowercase format name if not found.
        /// </summary>
        /// <param name="imageFormat">The ImageFormat to query.</param>
        /// <returns>The lowercase file extension including the leading dot (e.g. ".png").</returns>
        public static string GetFileExtension(this System.Drawing.Imaging.ImageFormat imageFormat)
        {
            var extension = System.Drawing.Imaging.ImageCodecInfo.GetImageEncoders()
                .Where(ie => ie.FormatID == imageFormat.Guid)
                .Select(ie => ie.FilenameExtension
                    .Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries)
                    .First()
                    .Trim('*')
                    .ToLower())
                .FirstOrDefault();

            return extension ?? string.Format(".{0}", imageFormat.ToString().ToLower());
        }
    }
}
