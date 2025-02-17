using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Reportman.Drawing.Windows
{
    public static class BitmapUtilWindows
    {
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
