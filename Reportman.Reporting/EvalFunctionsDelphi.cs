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

using Reportman.Drawing;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

namespace Reportman.Reporting
{
    // The expression functions of the Delphi engine (rpevalfunc.pas) that the .NET engine did not
    // have, with the results of the Delphi evaluator: a report of the Delphi engine that uses them
    // runs here as it runs there. The TypeScript engine has the same ones (eval/functions.ts).

    /// <summary>
    /// The ANSI strings of the Delphi engine as text: Windows-1252, the code page of the Delphi
    /// reports of Western Europe and America. The bytes 0x81, 0x8D, 0x8F, 0x90 and 0x9D, undefined
    /// there, are the characters of the same code (as Windows converts them); a character outside the
    /// code page is written as '?'.
    /// </summary>
    internal static class AnsiText
    {
        private static readonly char[] High =
        {
            '€', '\u0081', '‚', 'ƒ', '„', '…', '†', '‡',
            'ˆ', '‰', 'Š', '‹', 'Œ', '\u008D', 'Ž', '\u008F',
            '\u0090', '‘', '’', '“', '”', '•', '–', '—',
            '˜', '™', 'š', '›', 'œ', '\u009D', 'ž', 'Ÿ',
        };

        /// <summary>The text of some bytes, one character per byte.</summary>
        public static string Decode(byte[] bytes, int offset, int count)
        {
            var sb = new StringBuilder(count);
            for (int i = offset; i < offset + count; i++)
            {
                byte b = bytes[i];
                sb.Append(b >= 0x80 && b < 0xA0 ? High[b - 0x80] : (char)b);
            }
            return sb.ToString();
        }

        /// <summary>The bytes of a text, one per character ('?' for a character outside the code page).</summary>
        public static byte[] Encode(string text)
        {
            var bytes = new byte[text.Length];
            for (int i = 0; i < text.Length; i++)
            {
                char c = text[i];
                if (c < 0x80 || (c >= 0xA0 && c <= 0xFF))
                    bytes[i] = (byte)c;
                else
                {
                    int index = Array.IndexOf(High, c);
                    bytes[i] = index >= 0 ? (byte)(0x80 + index) : (byte)'?';
                }
            }
            return bytes;
        }
    }

    /// <summary>
    /// FormatMaskText of Delphi's MaskUtils with an edit mask ("000-000;0;_"): the characters of a
    /// value placed in the mask's positions with its literals. The rules are Delphi's: a mask that
    /// keeps its literals (save flag other than 0) expects the value to contain them and pads each
    /// part with spaces, one that does not inserts them; '!' fills from the right; ':' and '/' are
    /// the culture's time and date separators; the blank character of the mask is not used.
    /// </summary>
    internal static class EditMaskText
    {
        private enum Kind { None, Literal, IntlLiteral, Directive, Mask, MaskOpt, FieldSeparator, Field }

        private static char At(string s, int index0)
        {
            return index0 >= 0 && index0 < s.Length ? s[index0] : '\0';
        }

        /// <summary>The kind of the mask character at the 1-based position p.</summary>
        private static Kind KindAt(string mask, int p)
        {
            int n = mask.Length;
            if (p > n)
                return Kind.None;
            char c = mask[p - 1];
            if (char.IsSurrogate(c))
                return Kind.Literal;
            // After a backslash that is not itself after a backslash
            if (p > 1 && At(mask, p - 2) == '\\' && !(p > 2 && At(mask, p - 3) == '\\'))
                return Kind.Literal;
            // The last four characters may hold the save flag and the blank: "...;0;_"
            bool tail = n >= 4 && p > n - 4;
            if (c == ';' && tail)
                return Kind.FieldSeparator;
            if (tail && At(mask, p - 2) == ';' && !(p > 2 && At(mask, p - 3) == '\\'))
                return Kind.Field;
            switch (c)
            {
                case ':':
                case '/':
                    return Kind.IntlLiteral;
                case '!':
                case '>':
                case '<':
                case '\\':
                    return Kind.Directive;
                case 'l':
                case 'a':
                case 'c':
                case '#':
                case '9':
                    return Kind.MaskOpt;
                case 'L':
                case 'A':
                case 'C':
                case '0':
                    return Kind.Mask;
                default:
                    return Kind.Literal;
            }
        }

        /// <summary>Whether the value keeps the literals of the mask (the save flag is not '0').</summary>
        private static bool KeepsLiterals(string mask)
        {
            int n = mask.Length;
            if (n < 4)
                return true;
            int last = -1, first = -1;
            for (int i = n; i > 0 && i >= n - 4 && first < 0; i--)
            {
                if (KindAt(mask, i) == Kind.FieldSeparator)
                {
                    if (last < 0)
                        last = i;
                    else
                        first = i;
                }
            }
            if (first < 0)
                first = last;
            if (first > 0 && first != n)
                return mask[first] != '0';
            return true;
        }

        /// <summary>Delphi's string.SubString (Copy): a start before the text is its beginning.</summary>
        private static string Sub(string s, int start0, int length)
        {
            int l = s.Length;
            int offset = start0 + 1 < 1 ? 0 : Math.Min(start0, l);
            int count = length < 0 ? 0 : Math.Min(l - offset, length);
            return s.Substring(offset, count);
        }

        /// <summary>The characters of the mask up to p that take a place in the text.</summary>
        private static int Places(string mask, int p)
        {
            int count = 0;
            for (int i = 1; i <= p; i++)
            {
                Kind k = KindAt(mask, i);
                if (k != Kind.Directive && k != Kind.Field && k != Kind.FieldSeparator)
                    count++;
            }
            return count;
        }

        private static string PadPart(string value, int startPart, int stopPart, int length, bool fromRight)
        {
            int span = stopPart - startPart;
            if (span < length)
            {
                int padAt = fromRight ? startPart - 1 : stopPart - 1;
                return Sub(value, 0, padAt) + new string(' ', length - span) + Sub(value, padAt, value.Length);
            }
            if (span > length)
            {
                if (fromRight)
                    return Sub(value, 0, startPart - 1) + Sub(value, stopPart - 1 - length, value.Length);
                return Sub(value, 0, startPart + length - 1) + Sub(value, stopPart - 1, value.Length);
            }
            return value;
        }

        /// <summary>FormatMaskText(mask, value) with the separators of a culture.</summary>
        public static string Format(string mask, string value, CultureInfo culture)
        {
            string dateSeparator = culture.DateTimeFormat.DateSeparator;
            string timeSeparator = culture.DateTimeFormat.TimeSeparator;
            char dateChar = dateSeparator.Length > 0 ? dateSeparator[0] : '/';
            char timeChar = timeSeparator.Length > 0 ? timeSeparator[0] : ':';
            Func<char, char> literal = c => c == '/' ? dateChar : c == ':' ? timeChar : c;
            bool fromRight = mask.IndexOf('!') >= 0;
            int n = mask.Length;
            string result = value;
            if (!KeepsLiterals(mask))
            {
                // The literals are inserted, the missing places filled with spaces
                if (!fromRight)
                {
                    int offset = 1;
                    for (int p = 1; p <= n; p++)
                    {
                        Kind k = KindAt(mask, p);
                        if (k == Kind.Literal || k == Kind.IntlLiteral)
                        {
                            result = Sub(result, 0, offset - 1) + literal(mask[p - 1]) + Sub(result, offset - 1, result.Length - offset + 1);
                            offset++;
                        }
                        else if (k == Kind.Mask || k == Kind.MaskOpt)
                        {
                            if (offset > result.Length)
                                result += " ";
                            offset++;
                        }
                    }
                }
                else
                {
                    int offset = result.Length;
                    for (int p = n; p >= 1; p--)
                    {
                        Kind k = KindAt(mask, p);
                        if (k == Kind.Literal || k == Kind.IntlLiteral)
                            result = Sub(result, 0, offset) + literal(mask[p - 1]) + Sub(result, offset, result.Length - offset);
                        else if (k == Kind.Mask || k == Kind.MaskOpt)
                        {
                            if (offset < 1)
                                result = " " + result;
                            else
                                offset--;
                        }
                    }
                }
                return result;
            }
            // The value has the literals: each part between them padded or cut to its places
            int lastLiteral = 0;
            for (int p = 1; p <= n; p++)
            {
                Kind k = KindAt(mask, p);
                if (k != Kind.Literal && k != Kind.IntlLiteral)
                    continue;
                int place = Places(mask, p);
                char lit = literal(mask[p - 1]);
                int endPart = result.Length + 1;
                for (int j = lastLiteral; j <= result.Length - 1; j++)
                {
                    if (result[j] == lit)
                    {
                        endPart = j + 1;
                        break;
                    }
                }
                if (endPart > result.Length)
                    result += lit;
                result = PadPart(result, lastLiteral + 1, endPart, place - (lastLiteral + 1), fromRight);
                lastLiteral = place;
            }
            int places = Places(mask, n);
            if (result.Length != places)
                result = PadPart(result, lastLiteral + 1, result.Length + 1, places - lastLiteral, fromRight);
            return result;
        }
    }

    /// <summary>
    /// The base64 decoding of the Delphi engine (Indy's TIdDecoderMIME, line by line): a character
    /// outside the alphabet counts as 63, an incomplete group of four at the end of a line is left
    /// out, the '=' of the end removes one or two bytes, and each byte is the character of its code.
    /// </summary>
    internal static class IndyBase64
    {
        private const string Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

        private static int Value(byte b)
        {
            int i = Alphabet.IndexOf((char)b);
            return i >= 0 ? i : 0xFF;
        }

        public static string Decode(string text)
        {
            var result = new StringBuilder();
            foreach (string line in TextLines.Split(text))
            {
                // Each character as a byte (one outside the 8 bits is '?')
                var input = new byte[line.Length];
                for (int i = 0; i < line.Length; i++)
                    input[i] = line[i] <= 0xFF ? (byte)line[i] : (byte)'?';
                int limit = input.Length / 4 * 4;
                var output = new List<byte>(limit / 4 * 3);
                for (int i = 0; i < limit; i += 4)
                {
                    int a = Value(input[i]), b = Value(input[i + 1]), c = Value(input[i + 2]), d = Value(input[i + 3]);
                    output.Add((byte)(((a & 63) << 2) | ((b >> 4) & 3)));
                    output.Add((byte)(((b & 15) << 4) | ((c >> 2) & 15)));
                    output.Add((byte)(((c & 3) << 6) | (d & 63)));
                }
                if (limit > 0 && input[limit - 1] == '=')
                {
                    int empty = input[limit - 2] == '=' ? 2 : 1;
                    output.RemoveRange(output.Count - empty, empty);
                }
                foreach (byte b in output)
                    result.Append((char)b);
            }
            return result.ToString();
        }
    }

    /// <summary>The lines of a text as Delphi's TStrings.Text splits them (CR, LF or CR LF).</summary>
    internal static class TextLines
    {
        public static List<string> Split(string text)
        {
            var lines = new List<string>();
            int i = 0;
            while (i < text.Length)
            {
                int start = i;
                while (i < text.Length && text[i] != '\r' && text[i] != '\n')
                    i++;
                lines.Add(text.Substring(start, i - start));
                if (i < text.Length && text[i] == '\r')
                    i++;
                if (i < text.Length && text[i] == '\n')
                    i++;
            }
            return lines;
        }

        /// <summary>Delphi's Trim: the characters up to the space removed at both ends.</summary>
        public static string Trim(string s)
        {
            return TrimRight(TrimLeft(s));
        }

        public static string TrimLeft(string s)
        {
            int i = 0;
            while (i < s.Length && s[i] <= ' ')
                i++;
            return s.Substring(i);
        }

        public static string TrimRight(string s)
        {
            int i = s.Length;
            while (i > 0 && s[i - 1] <= ' ')
                i--;
            return s.Substring(0, i);
        }
    }

    /// <summary>
    /// The case of Delphi's AnsiUpperCase (CharUpperBuff of Windows), which StringReplace uses to
    /// ignore the case: one character for one, and only the letters whose upper case comes back to
    /// them in lower case, so the final sigma, the micro sign, the long s and the dotless i stay as
    /// they are (they are other letters than the sigma, the mu, the s and the i).
    /// </summary>
    internal static class DelphiCase
    {
        /// <summary>The text in upper case, with the length it had.</summary>
        public static string Upper(string text)
        {
            var sb = new StringBuilder(text.Length);
            int i = 0;
            while (i < text.Length)
            {
                char ch = text[i];
                if (ch < 0x80)
                {
                    sb.Append((ch >= 'a') && (ch <= 'z') ? (char)(ch - 32) : ch);
                    i++;
                    continue;
                }
                int count = char.IsSurrogatePair(text, i) ? 2 : 1;
                string c = text.Substring(i, count);
                string u = c.ToUpperInvariant();
                if ((u != c) && ((u.Length != count) || (u.ToLowerInvariant() != c)))
                    u = c;
                sb.Append(u);
                i += count;
            }
            return sb.ToString();
        }

        /// <summary>
        /// StringReplace(source, oldPattern, newPattern, [rfReplaceAll, rfIgnoreCase]): every
        /// occurrence of the pattern, from left to right, whatever its case; an empty pattern
        /// replaces nothing.
        /// </summary>
        public static string ReplaceIgnoringCase(string source, string oldPattern, string newPattern)
        {
            if (oldPattern.Length == 0)
                return source;
            string upperSource = Upper(source);
            string upperPattern = Upper(oldPattern);
            var sb = new StringBuilder(source.Length);
            int position = 0;
            while (true)
            {
                int index = upperSource.IndexOf(upperPattern, position, StringComparison.Ordinal);
                if (index < 0)
                    break;
                sb.Append(source, position, index - position);
                sb.Append(newPattern);
                position = index + upperPattern.Length;
            }
            sb.Append(source, position, source.Length - position);
            return sb.ToString();
        }
    }

    /// <summary>
    /// ReadString of Delphi's TMemIniFile: the sections and names ignore the case, the first section
    /// and the first name of a repeated one count, spaces around '=' are removed, lines starting
    /// with ';' are comments; a file without a byte order mark is ANSI.
    /// </summary>
    internal static class IniText
    {
        public static string Read(string fileName, string section, string name, string defaultValue)
        {
            if (fileName.Length == 0 || !File.Exists(fileName))
                return defaultValue;
            byte[] bytes = File.ReadAllBytes(fileName);
            string text;
            if (bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF)
                text = new UTF8Encoding(false, false).GetString(bytes, 3, bytes.Length - 3);
            else if (bytes.Length >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE)
                text = new UnicodeEncoding(false, false, false).GetString(bytes, 2, bytes.Length - 2);
            else if (bytes.Length >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF)
                text = new UnicodeEncoding(true, false, false).GetString(bytes, 2, bytes.Length - 2);
            else
                text = AnsiText.Decode(bytes, 0, bytes.Length);
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            bool inSection = false;
            foreach (string raw in TextLines.Split(text))
            {
                string s = TextLines.Trim(raw);
                if (s.Length == 0 || s[0] == ';')
                    continue;
                if (s[0] == '[' && s[s.Length - 1] == ']')
                {
                    string sectionName = TextLines.Trim(s.Substring(1, s.Length - 2));
                    // A section seen before is skipped: its first occurrence counts
                    inSection = seen.Add(sectionName) && string.Equals(sectionName, section, StringComparison.OrdinalIgnoreCase);
                    continue;
                }
                if (!inSection)
                    continue;
                // A line without '=' is a name without a value, which ReadString does not find
                int eq = s.IndexOf('=');
                if (eq >= 0 && string.Equals(TextLines.TrimRight(s.Substring(0, eq)), name, StringComparison.OrdinalIgnoreCase))
                    return TextLines.TrimLeft(s.Substring(eq + 1));
            }
            return defaultValue;
        }
    }

    class IdenTime : IdenFunction
    {
        public IdenTime(Evaluator eval)
            : base(eval)
        {
            SetParamCount(0);
            Name = "Time";
            FModel = "function Time:time";
        }
        protected override Variant GetValue()
        {
            // A time without a date, as a time column gives it (day 0001-01-01)
            return new DateTime(DateTime.Now.TimeOfDay.Ticks);
        }
    }

    class IdenSqrt : IdenFunction
    {
        public IdenSqrt(Evaluator eval)
            : base(eval)
        {
            SetParamCount(1);
            Name = "Sqrt";
            FModel = "function Sqrt(num:double):double";
        }
        protected override Variant GetValue()
        {
            if (!Params[0].IsNumber())
                throw new NamedException(Translator.TranslateStr(438), Name);
            double value = Params[0];
            return Math.Sqrt(value);
        }
    }

    class IdenHourMinSec : IdenFunction
    {
        public IdenHourMinSec(Evaluator eval)
            : base(eval)
        {
            SetParamCount(4);
            Name = "HourMinSec";
            FModel = "function HourMinSec(h:Double, idenH:string, idenM:string, idenS:string):string";
        }
        protected override Variant GetValue()
        {
            for (int i = 1; i <= 3; i++)
            {
                if (Params[i].VarType != VariantType.String)
                    throw new NamedException(Translator.TranslateStr(438), Name);
            }
            if (!Params[0].IsNumber())
                throw new NamedException(Translator.TranslateStr(438), Name);
            double hours = Params[0];
            double whole = Math.Truncate(hours);
            double minutes = (hours - whole) * 60;
            double seconds = (minutes - Math.Truncate(minutes)) * 60;
            // As Delphi: the hours an Integer, the minutes and seconds a Word (a negative one wraps)
            int h;
            ushort m, s;
            unchecked
            {
                h = (int)(long)Math.Round(whole);
                m = (ushort)(long)Math.Round(Math.Truncate(minutes));
                s = (ushort)(long)Math.Round(seconds);
            }
            string ms = m < 10 ? "0" + m.ToString(CultureInfo.InvariantCulture) : m.ToString(CultureInfo.InvariantCulture);
            string ss = s < 10 ? "0" + s.ToString(CultureInfo.InvariantCulture) : s.ToString(CultureInfo.InvariantCulture);
            return h.ToString(CultureInfo.InvariantCulture) + Params[1].AsString + ms + Params[2].AsString + ss + Params[3].AsString;
        }
    }

    class IdenFormatMask : IdenFunction
    {
        public IdenFormatMask(Evaluator eval)
            : base(eval)
        {
            SetParamCount(2);
            Name = "FormatMask";
            FModel = "function FormatMask(format:string,v:string):string";
        }
        protected override Variant GetValue()
        {
            if (Params[0].VarType != VariantType.String || Params[1].VarType != VariantType.String)
                throw new NamedException(Translator.TranslateStr(438), Name);
            return EditMaskText.Format(Params[0].AsString, Params[1].AsString, CultureInfo.CurrentCulture);
        }
    }

    /// <summary>
    /// CHSTOCHT and CHTTOCHS of the Delphi engine: a text in simplified Chinese to traditional and the
    /// other way round, as LCMapString of Windows does it for the locale zh-CN, one character for one
    /// (ChineseTables.cs, the table Windows gives). A value that is not a string is a type error, NULL
    /// too, as in Delphi (VarIsString). Delphi converted CHTTOCHS to traditional too, a bug fixed in
    /// both engines on 22-11-2026.
    /// </summary>
    class IdenChineseConversion : IdenFunction
    {
        private readonly bool toTraditional;
        private static Dictionary<char, char> traditional;
        private static Dictionary<char, char> simplified;

        public IdenChineseConversion(Evaluator eval, bool toTraditional)
            : base(eval)
        {
            this.toTraditional = toTraditional;
            SetParamCount(1);
            Name = toTraditional ? "ChsToCht" : "ChtToChs";
            FModel = "function " + Name + "(expr:string):String";
        }

        private static Dictionary<char, char> Table(string from, string to)
        {
            var map = new Dictionary<char, char>(from.Length);
            for (int i = 0; i < from.Length; i++)
                map[from[i]] = to[i];
            return map;
        }

        protected override Variant GetValue()
        {
            if (Params[0].VarType != VariantType.String)
                throw new NamedException(Translator.TranslateStr(438), Name);
            Dictionary<char, char> map;
            if (toTraditional)
                map = traditional ?? (traditional = Table(ChineseTables.ToTraditionalFrom, ChineseTables.ToTraditionalTo));
            else
                map = simplified ?? (simplified = Table(ChineseTables.ToSimplifiedFrom, ChineseTables.ToSimplifiedTo));
            string text = Params[0].AsString;
            var sb = new StringBuilder(text.Length);
            foreach (char c in text)
                sb.Append(map.TryGetValue(c, out char m) ? m : c);
            return sb.ToString();
        }
    }

    class IdenAsc2 : IdenFunction
    {
        public IdenAsc2(Evaluator eval)
            : base(eval)
        {
            SetParamCount(1);
            Name = "ASC2";
            FModel = "function ASC2:string";
        }
        protected override Variant GetValue()
        {
            string text = Params[0].VarType == VariantType.Null ? "" : Params[0].AsString;
            var sb = new StringBuilder(text.Length);
            foreach (char c in text)
            {
                int code = c;
                if (code >= 192 && code <= 198) sb.Append('A');
                else if (code >= 224 && code <= 230) sb.Append('a');
                else if (code >= 200 && code <= 203) sb.Append('E');
                else if (code >= 232 && code <= 235) sb.Append('e');
                else if (code >= 204 && code <= 207) sb.Append('I');
                else if (code >= 236 && code <= 239) sb.Append('i');
                else if (code >= 210 && code <= 214) sb.Append('O');
                else if (code >= 242 && code <= 246) sb.Append('o');
                else if (code >= 217 && code <= 220) sb.Append('U');
                else if (code >= 249 && code <= 252) sb.Append('u');
                else if (code == 199) sb.Append('C');
                else if (code == 231) sb.Append('c');
                else if (code == 209) sb.Append('N');
                else if (code == 241) sb.Append('n');
                else if (code == 176 || code == 186) sb.Append('o');
                else if (code == 170) sb.Append('a');
                else sb.Append(c);
            }
            return sb.ToString();
        }
    }

    class IdenDecode64 : IdenFunction
    {
        public IdenDecode64(Evaluator eval)
            : base(eval)
        {
            SetParamCount(1);
            Name = "Decode64";
            FModel = "function Decode64(s:string):string";
        }
        protected override Variant GetValue()
        {
            if (Params[0].VarType != VariantType.String)
                throw new NamedException(Translator.TranslateStr(438), Name);
            return IndyBase64.Decode(Params[0].AsString);
        }
    }

    class IdenUtf8ToWideString : IdenFunction
    {
        public IdenUtf8ToWideString(Evaluator eval)
            : base(eval)
        {
            SetParamCount(1);
            Name = "UTF8ToWideString";
            FModel = "function UTF8ToWideString(value:string):WideString";
        }
        protected override Variant GetValue()
        {
            if (Params[0].VarType == VariantType.Null)
                return "";
            // The ANSI bytes of the text read as UTF-8 (an invalid sequence gives U+FFFD)
            return new UTF8Encoding(false, false).GetString(AnsiText.Encode(Params[0].AsString));
        }
    }

    class IdenIdentExists : IdenFunction
    {
        public IdenIdentExists(Evaluator eval)
            : base(eval)
        {
            SetParamCount(1);
            Name = "IdentExists";
            FModel = "function IdentExists(s:String)";
        }
        protected override Variant GetValue()
        {
            if (Params[0].VarType != VariantType.String)
                throw new NamedException(Translator.TranslateStr(438), Name);
            return EvalObject.SearchIdentifier(Params[0].AsString) != null;
        }
    }

    class IdenLoadFile : IdenFunction
    {
        public IdenLoadFile(Evaluator eval)
            : base(eval)
        {
            SetParamCount(1);
            Name = "LoadFile";
            FModel = "function LoadFile(s:string):string";
        }
        protected override Variant GetValue()
        {
            if (Params[0].VarType != VariantType.String)
                throw new NamedException(Translator.TranslateStr(438), Name);
            Evaluator.CheckFileFunctions(Name);
            string path = Params[0].AsString;
            if (path.Length == 0 || !File.Exists(path))
                throw new NamedException("File not found:" + path, Name);
            // The bytes as ANSI characters, as the Delphi engine loads a file into a string
            byte[] bytes = File.ReadAllBytes(path);
            return AnsiText.Decode(bytes, 0, bytes.Length);
        }
    }

    class IdenGetIniValue : IdenFunction
    {
        public IdenGetIniValue(Evaluator eval)
            : base(eval)
        {
            SetParamCount(4);
            Name = "GetINIValue";
            FModel = "function GetINIValue(file, section, name, default : string):String";
        }
        protected override Variant GetValue()
        {
            for (int i = 0; i < 4; i++)
            {
                if (Params[i].VarType != VariantType.String)
                    throw new NamedException(Translator.TranslateStr(438), Name);
            }
            Evaluator.CheckFileFunctions(Name);
            return IniText.Read(Params[0].AsString, Params[1].AsString, Params[2].AsString, Params[3].AsString);
        }
    }
}
