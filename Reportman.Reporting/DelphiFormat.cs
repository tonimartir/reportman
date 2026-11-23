#region Copyright
/*
 *  Report Manager:  Database Reporting tool for .Net and Mono
 *
 *     This Source Code Form is subject to the terms of the Mozilla
 *     Public License, v. 2.0. If a copy of the MPL was not distributed
 *     with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 *  Copyright (c) 1994 - 2026 Toni Martir (toni@reportman.es)
 *  All Rights Reserved.
*/
#endregion
using System.Globalization;
using System.Text;

namespace Reportman.Reporting
{
    /// <summary>
    /// Texts as the Delphi engine writes them, for the reports converted from Delphi
    /// (<see cref="BaseReport.ConvertedFromDelphi"/>): the display format of a text (Delphi's
    /// Format with one argument) and a number without a mask (FloatToStr). The same code as
    /// delphiformat.ts of the TypeScript engine.
    /// </summary>
    public static class DelphiFormat
    {
        /// <summary>
        /// Format(format, [argument]) of Delphi for one text argument: %s (and %0:s) is the text,
        /// with a width (%10s to the right, %-10s to the left) and a precision that cuts it (%.3s),
        /// and %% is a percent sign. Everything else stays as it is written: a mask without % prints
        /// itself, as in Delphi, and the specifiers Delphi refuses for a text (%d, %f...) are left as
        /// text instead of the error Delphi raises.
        /// </summary>
        public static string FormatString(string format, string argument)
        {
            if (string.IsNullOrEmpty(format) || format.IndexOf('%') < 0)
                return format;
            var sb = new StringBuilder(format.Length + argument.Length);
            int i = 0;
            while (i < format.Length)
            {
                char c = format[i];
                if (c != '%')
                {
                    sb.Append(c);
                    i++;
                    continue;
                }
                int start = i;
                i++;
                if (i < format.Length && format[i] == '%')
                {
                    sb.Append('%');
                    i++;
                    continue;
                }
                // [index ':'] ['-'] [width] ['.' precision] type
                int p = i;
                int number = ReadNumber(format, ref p);
                int index = 0;
                if (p < format.Length && format[p] == ':')
                {
                    index = number < 0 ? 0 : number;
                    p++;
                    number = -1;
                }
                bool left = false;
                if (number < 0 && p < format.Length && format[p] == '-')
                {
                    left = true;
                    p++;
                }
                int width = number >= 0 ? number : ReadNumber(format, ref p);
                int precision = -1;
                if (p < format.Length && format[p] == '.')
                {
                    p++;
                    precision = ReadNumber(format, ref p);
                    if (precision < 0)
                        precision = 0;
                }
                if (p < format.Length && (format[p] == 's' || format[p] == 'S') && index == 0)
                {
                    string text = (precision >= 0 && precision < argument.Length) ? argument.Substring(0, precision) : argument;
                    if (width > text.Length)
                        text = left ? text.PadRight(width) : text.PadLeft(width);
                    sb.Append(text);
                    i = p + 1;
                }
                else
                {
                    // Not a text specifier: as it is written
                    sb.Append(format, start, i - start);
                }
            }
            return sb.ToString();
        }

        /// <summary>Reads a number at p; -1 when there is none.</summary>
        private static int ReadNumber(string s, ref int p)
        {
            int value = -1;
            while (p < s.Length && s[p] >= '0' && s[p] <= '9' && value < 100000)
            {
                value = (value < 0 ? 0 : value * 10) + (s[p] - '0');
                p++;
            }
            return value;
        }

        /// <summary>
        /// FloatToStr of Delphi: 15 significant digits, the exponent without a plus sign or leading
        /// zeros (1E20, 1E-5), and zero without a sign.
        /// </summary>
        public static string FloatText(double value)
        {
            if (value == 0)
                return "0";
            string s = value.ToString("G15", CultureInfo.CurrentCulture);
            int e = s.IndexOf('E');
            if (e < 0)
                return s;
            string exponent = s.Substring(e + 1);
            bool negative = exponent.StartsWith("-");
            exponent = exponent.TrimStart('+', '-').TrimStart('0');
            if (exponent.Length == 0)
                exponent = "0";
            return s.Substring(0, e) + "E" + (negative ? "-" : "") + exponent;
        }

        /// <summary>
        /// A Decimal without a mask: with up to four decimals it is the Currency of Delphi, which
        /// keeps its digits; with more it is a Double there, with its 15 digits (80/9 is
        /// 8,88888888888889).
        /// </summary>
        public static string DecimalText(decimal value)
        {
            int scale = (decimal.GetBits(value)[3] >> 16) & 0xFF;
            if (scale <= 4)
                return value.ToString("G29", CultureInfo.CurrentCulture);
            return FloatText((double)value);
        }
    }
}
