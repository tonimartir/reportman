using System.Text;
using Reportman.Drawing;

namespace Reportman.Designer
{
    /// <summary>
    /// The translated texts of the designer: the Reportman resource strings (reportmanres.*), shared
    /// with the Delphi designer, which uses the same keys.
    /// </summary>
    internal static class DesignerText
    {
        /// <summary>The resource string <paramref name="index"/> in the language of the user.</summary>
        public static string Tr(int index)
        {
            return Translator.TranslateStr(index);
        }

        /// <summary>
        /// A translated text with its %s and %d filled in order with <paramref name="args"/>, as the Delphi
        /// designer's Format does with the same resource strings (%% is a percent sign).
        /// </summary>
        public static string Format(int index, params string[] args)
        {
            string text = Tr(index);
            var result = new StringBuilder(text.Length + 32);
            int next = 0;
            for (int i = 0; i < text.Length; i++)
            {
                char c = text[i];
                if (c == '%' && i + 1 < text.Length)
                {
                    char kind = text[i + 1];
                    if (kind == '%')
                    {
                        result.Append('%');
                        i++;
                        continue;
                    }
                    if (kind == 's' || kind == 'd')
                    {
                        if (args != null && next < args.Length)
                            result.Append(args[next]);
                        next++;
                        i++;
                        continue;
                    }
                }
                result.Append(c);
            }
            return result.ToString();
        }
    }
}
