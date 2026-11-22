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
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Reportman.Reporting
{
    /// <summary>
    /// TFormatSettings of Delphi: what its FormatDateTime reads. The day names start on Sunday;
    /// a separator Delphi has as #0 (nothing is written) is the empty string.
    /// </summary>
    public sealed class DelphiFormatSettings
    {
        /// <summary>The format of the ddddd mask and of the date of c.</summary>
        public readonly string ShortDateFormat;
        /// <summary>The format of the dddddd mask.</summary>
        public readonly string LongDateFormat;
        /// <summary>The format of the t mask.</summary>
        public readonly string ShortTimeFormat;
        /// <summary>The format of the tt mask and of the time of c.</summary>
        public readonly string LongTimeFormat;
        /// <summary>The text of ampm before noon.</summary>
        public readonly string TimeAMString;
        /// <summary>The text of ampm from noon.</summary>
        public readonly string TimePMString;
        /// <summary>What the / of a mask writes.</summary>
        public readonly string DateSeparator;
        /// <summary>What the : of a mask writes.</summary>
        public readonly string TimeSeparator;
        /// <summary>The mmm names, January first.</summary>
        public readonly string[] ShortMonthNames;
        /// <summary>The mmmm names, January first.</summary>
        public readonly string[] LongMonthNames;
        /// <summary>The ddd names, Sunday first.</summary>
        public readonly string[] ShortDayNames;
        /// <summary>The dddd names, Sunday first.</summary>
        public readonly string[] LongDayNames;
        /// <summary>The era of the calendar of the locale (GetDateFormat 'gg'), for the g mask.</summary>
        public readonly string EraName;

        /// <summary>Format settings with the given values.</summary>
        public DelphiFormatSettings(string shortDateFormat, string longDateFormat, string shortTimeFormat, string longTimeFormat,
            string timeAMString, string timePMString, string dateSeparator, string timeSeparator, string[] shortMonthNames,
            string[] longMonthNames, string[] shortDayNames, string[] longDayNames, string eraName)
        {
            ShortDateFormat = shortDateFormat;
            LongDateFormat = longDateFormat;
            ShortTimeFormat = shortTimeFormat;
            LongTimeFormat = longTimeFormat;
            TimeAMString = timeAMString;
            TimePMString = timePMString;
            DateSeparator = dateSeparator;
            TimeSeparator = timeSeparator;
            ShortMonthNames = shortMonthNames;
            LongMonthNames = longMonthNames;
            ShortDayNames = shortDayNames;
            LongDayNames = longDayNames;
            EraName = eraName;
        }
    }

    /// <summary>
    /// The date masks of the Delphi engine, for the reports converted from Delphi
    /// (<see cref="BaseReport.ConvertedFromDelphi"/>, decision of 22-11-2026): FormatDateTime of the
    /// Delphi RTL (DateTimeToString of System.SysUtils) with the format settings Delphi takes from
    /// Windows for the culture. The other reports keep the masks of .NET
    /// (<see cref="Variant.DateFormatMask"/>). The same code as delphidateformat.ts of the
    /// TypeScript engine; both are checked against Delphi itself (typescript/tools/golden-delphi-dates).
    /// </summary>
    public static class DelphiDateFormat
    {
        /// <summary>
        /// The format settings of a culture: those of Delphi on Windows for the cultures with a table
        /// (by name or, for a neutral culture such as "ca", the first of its language); for the others,
        /// built from the data of .NET, so the masks keep the rules of Delphi with the names of .NET.
        /// </summary>
        public static DelphiFormatSettings SettingsFor(CultureInfo culture)
        {
            string name = culture.Name;
            DelphiFormatSettings settings;
            if (DelphiFormatSettingsData.Cultures.TryGetValue(name, out settings))
                return settings;
            if (name.IndexOf('-') < 0)
            {
                foreach (KeyValuePair<string, DelphiFormatSettings> pair in DelphiFormatSettingsData.Cultures)
                    if (pair.Key.StartsWith(name + "-", StringComparison.OrdinalIgnoreCase))
                        return pair.Value;
            }
            lock (Derived)
            {
                if (!Derived.TryGetValue(name, out settings))
                {
                    settings = FromDotNet(culture);
                    Derived[name] = settings;
                }
            }
            return settings;
        }

        private static readonly Dictionary<string, DelphiFormatSettings> Derived = new Dictionary<string, DelphiFormatSettings>(StringComparer.OrdinalIgnoreCase);

        /// <summary>Format settings from the data of .NET, for a culture Delphi's table has not.</summary>
        private static DelphiFormatSettings FromDotNet(CultureInfo culture)
        {
            DateTimeFormatInfo d = culture.DateTimeFormat;
            string[] shortMonths = new string[12];
            string[] longMonths = new string[12];
            Array.Copy(d.AbbreviatedMonthNames, shortMonths, 12);
            Array.Copy(d.MonthNames, longMonths, 12);
            return new DelphiFormatSettings(DotNetPatternToDelphi(d.ShortDatePattern), DotNetPatternToDelphi(d.LongDatePattern),
                DotNetPatternToDelphi(d.ShortTimePattern), DotNetPatternToDelphi(d.LongTimePattern), d.AMDesignator, d.PMDesignator,
                d.DateSeparator, d.TimeSeparator, shortMonths, longMonths, (string[])d.AbbreviatedDayNames.Clone(),
                (string[])d.DayNames.Clone(), d.GetEraName(1));
        }

        /// <summary>A pattern of .NET as a format of Delphi: M is m, m is n, tt is ampm, f is z, g is gg.</summary>
        private static string DotNetPatternToDelphi(string pattern)
        {
            var sb = new StringBuilder();
            int i = 0;
            while (i < pattern.Length)
            {
                char c = pattern[i];
                if (c == '\'' || c == '"')
                {
                    int end = pattern.IndexOf(c, i + 1);
                    if (end < 0) end = pattern.Length - 1;
                    sb.Append(pattern, i, end - i + 1);
                    i = end + 1;
                    continue;
                }
                if (c == '\\' && i + 1 < pattern.Length)
                {
                    char q = pattern[i + 1] == '"' ? '\'' : '"';
                    sb.Append(q).Append(pattern[i + 1]).Append(q);
                    i += 2;
                    continue;
                }
                int run = 1;
                while (i + run < pattern.Length && pattern[i + run] == c) run++;
                switch (c)
                {
                    case 'M': sb.Append('m', run); break;
                    case 'm': sb.Append('n', run); break;
                    case 'H': sb.Append('h', run); break;
                    case 'h': case 'd': case 's': case 'y': sb.Append(c, run); break;
                    case 't': sb.Append("ampm"); break;
                    case 'f': case 'F': sb.Append('z', Math.Min(run, 3)); break;
                    case 'g': sb.Append("gg"); break;
                    case 'K': case 'z': break;
                    default:
                        // A letter that is literal for .NET may be a mask of Delphi: quoted
                        if (char.IsLetter(c))
                            sb.Append('"').Append(c, run).Append('"');
                        else
                            sb.Append(c, run);
                        break;
                }
                i += run;
            }
            return sb.ToString();
        }

        private static bool IsHigh(char c) { return c >= '\uD800' && c <= '\uDBFF'; }

        /// <summary>The length of the character at i (StrCharLength): a surrogate pair is two.</summary>
        private static int CharLength(string s, int i)
        {
            return IsHigh(s[i]) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1]) ? 2 : 1;
        }

        /// <summary>StrLIComp(P, S, Length(S)) = 0: the text at i is s, ASCII letters in any case.</summary>
        private static bool StartsWithI(string text, int i, string s)
        {
            if (i + s.Length > text.Length) return false;
            for (int k = 0; k < s.Length; k++)
            {
                char a = text[i + k];
                if (a >= 'a' && a <= 'z') a = (char)(a - 32);
                if (a != s[k]) return false;
            }
            return true;
        }

        /// <summary>'%.*d': at least digits digits.</summary>
        private static string Pad(int n, int digits)
        {
            string s = n.ToString(CultureInfo.InvariantCulture);
            return s.Length >= digits ? s : new string('0', digits - s.Length) + s;
        }

        /// <summary>
        /// FormatDateTime(mask, value) of Delphi: d m y h n s z for day, month, year, hour, minute,
        /// second and millisecond (m is the minute right after an h), ddd dddd mmm mmmm for the names,
        /// ddddd dddddd c t tt for the formats of the settings (one level deep, as Delphi), am/pm a/p
        /// ampm for the 12 hour clock (an h looks ahead for one before the next h), g and e for the era,
        /// / and : for the separators, quoted text as it is. An empty mask is c.
        /// </summary>
        public static string Format(DateTime value, string mask, DelphiFormatSettings fs)
        {
            var state = new FormatState(value, fs);
            state.AppendFormat(string.IsNullOrEmpty(mask) ? "C" : mask);
            return state.Output.ToString();
        }

        private sealed class FormatState
        {
            public readonly StringBuilder Output = new StringBuilder();
            private readonly DelphiFormatSettings fs;
            private readonly int year, month, day, dow, hour, min, sec, msec;
            private int level;

            public FormatState(DateTime value, DelphiFormatSettings settings)
            {
                fs = settings;
                year = value.Year;
                month = value.Month;
                day = value.Day;
                dow = (int)value.DayOfWeek;
                hour = value.Hour;
                min = value.Minute;
                sec = value.Second;
                msec = value.Millisecond;
            }

            public void AppendFormat(string format)
            {
                if (level >= 2) return;
                level++;
                StringBuilder sb = Output;
                char lastToken = ' ';
                bool use12HourClock = false;
                int i = 0;
                while (i < format.Length)
                {
                    char starter = format[i];
                    if (IsHigh(starter))
                    {
                        int n = CharLength(format, i);
                        sb.Append(format, i, n);
                        i += n;
                        lastToken = ' ';
                        continue;
                    }
                    i++;
                    char token = starter;
                    if (token >= 'a' && token <= 'z') token = (char)(token - 32);
                    if (token >= 'A' && token <= 'Z')
                    {
                        if (token == 'M' && lastToken == 'H') token = 'N';
                        lastToken = token;
                    }
                    int count;
                    switch (token)
                    {
                        case 'Y':
                            count = GetCount(format, ref i, starter);
                            sb.Append(count <= 2 ? Pad(year % 100, 2) : Pad(year, 4));
                            break;
                        case 'G':
                            GetCount(format, ref i, starter);
                            sb.Append(fs.EraName);
                            break;
                        case 'E':
                            {
                                // ConvertYearString: GetDateFormat 'yy' or 'yyyy' in the calendar of the locale (Gregorian)
                                count = GetCount(format, ref i, starter);
                                string s = count <= 2 ? Pad(year % 100, 2) : Pad(year, 4);
                                if (count == 1 && s[0] == '0') s = s.Substring(1);
                                sb.Append(s);
                                break;
                            }
                        case 'M':
                            count = GetCount(format, ref i, starter);
                            if (count <= 2) sb.Append(Pad(month, count));
                            else sb.Append(count == 3 ? fs.ShortMonthNames[month - 1] : fs.LongMonthNames[month - 1]);
                            break;
                        case 'D':
                            count = GetCount(format, ref i, starter);
                            if (count <= 2) sb.Append(Pad(day, count));
                            else if (count == 3) sb.Append(fs.ShortDayNames[dow]);
                            else if (count == 4) sb.Append(fs.LongDayNames[dow]);
                            else if (count == 5) AppendFormat(fs.ShortDateFormat);
                            else AppendFormat(fs.LongDateFormat);
                            break;
                        case 'H':
                            {
                                count = GetCount(format, ref i, starter);
                                // The 12 hour clock when an am/pm follows before another hour (outside quotes)
                                bool betweenQuotes = false;
                                int p = i;
                                while (p < format.Length)
                                {
                                    char ch = format[p];
                                    if (IsHigh(ch))
                                    {
                                        p += CharLength(format, p);
                                        continue;
                                    }
                                    if (ch == 'A' || ch == 'a')
                                    {
                                        if (!betweenQuotes)
                                        {
                                            if (StartsWithI(format, p, "AM/PM") || StartsWithI(format, p, "A/P") || StartsWithI(format, p, "AMPM"))
                                                use12HourClock = true;
                                            break;
                                        }
                                    }
                                    else if (ch == 'H' || ch == 'h')
                                        break;
                                    else if (ch == '\'' || ch == '"')
                                        betweenQuotes = !betweenQuotes;
                                    p++;
                                }
                                int h = hour;
                                if (use12HourClock)
                                {
                                    if (h == 0) h = 12;
                                    else if (h > 12) h -= 12;
                                }
                                if (count > 2) count = 2;
                                sb.Append(Pad(h, count));
                                break;
                            }
                        case 'N':
                            sb.Append(Pad(min, Math.Min(GetCount(format, ref i, starter), 2)));
                            break;
                        case 'S':
                            sb.Append(Pad(sec, Math.Min(GetCount(format, ref i, starter), 2)));
                            break;
                        case 'T':
                            AppendFormat(GetCount(format, ref i, starter) == 1 ? fs.ShortTimeFormat : fs.LongTimeFormat);
                            break;
                        case 'Z':
                            sb.Append(Pad(msec, Math.Min(GetCount(format, ref i, starter), 3)));
                            break;
                        case 'A':
                            {
                                int p = i - 1;
                                if (StartsWithI(format, p, "AM/PM"))
                                {
                                    // The text of the mask itself: am/pm gives am or pm
                                    sb.Append(format, hour >= 12 ? p + 3 : p, 2);
                                    i += 4;
                                    use12HourClock = true;
                                }
                                else if (StartsWithI(format, p, "A/P"))
                                {
                                    sb.Append(format[hour >= 12 ? p + 2 : p]);
                                    i += 2;
                                    use12HourClock = true;
                                }
                                else if (StartsWithI(format, p, "AMPM"))
                                {
                                    sb.Append(hour < 12 ? fs.TimeAMString : fs.TimePMString);
                                    i += 3;
                                    use12HourClock = true;
                                }
                                else if (StartsWithI(format, p, "AAAA"))
                                {
                                    sb.Append(fs.LongDayNames[dow]);
                                    i += 3;
                                }
                                else if (StartsWithI(format, p, "AAA"))
                                {
                                    sb.Append(fs.ShortDayNames[dow]);
                                    i += 2;
                                }
                                else
                                    sb.Append(starter);
                                break;
                            }
                        case 'C':
                            GetCount(format, ref i, starter);
                            AppendFormat(fs.ShortDateFormat);
                            if (hour != 0 || min != 0 || sec != 0 || msec != 0)
                            {
                                sb.Append(' ');
                                AppendFormat(fs.LongTimeFormat);
                            }
                            break;
                        case '/':
                            sb.Append(fs.DateSeparator);
                            break;
                        case ':':
                            sb.Append(fs.TimeSeparator);
                            break;
                        case '\'':
                        case '"':
                            {
                                int p = i;
                                while (i < format.Length && format[i] != starter)
                                    i += IsHigh(format[i]) ? CharLength(format, i) : 1;
                                sb.Append(format, p, i - p);
                                if (i < format.Length) i++;
                                break;
                            }
                        default:
                            sb.Append(starter);
                            break;
                    }
                }
                level--;
            }

            /// <summary>GetCount: the starter and the same characters after it.</summary>
            private static int GetCount(string format, ref int i, char starter)
            {
                int p = i;
                while (i < format.Length && format[i] == starter) i++;
                return i - p + 1;
            }
        }
    }
}
