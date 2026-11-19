#region Copyright
/*
 *  Report Manager:  Database Reporting tool for .Net and Mono
 *
 *     The contents of this file are subject to the MPL License
 *     with optional use of GPL or LGPL licenses.
 *     You may not use this file except in compliance with the
 *     Licenses. You may obtain copies of the Licenses at:
 *     http://reportman.sourceforge.net/license
 *
 *  Copyright (c) 1994 - 2026 Toni Martir (toni@reportman.es)
 *  All Rights Reserved.
*/
#endregion

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

namespace Reportman.Reporting
{
    /// <summary>A section of a <see cref="DbxIniDocument"/>: its name and its keys, in their order.</summary>
    public sealed class DbxIniSection
    {
        /// <summary>The name, as it is in the file (without the brackets).</summary>
        public string Name { get; set; } = "";
        /// <summary>The keys and their values (trimmed), in their order; comments are not here.</summary>
        public List<KeyValuePair<string, string>> Keys { get; } = new List<KeyValuePair<string, string>>();
    }

    /// <summary>
    /// THE SHARED <c>dbxconnections.ini</c> AS A DOCUMENT, read and written by the same rules in every Reportman program
    /// (the .Net engine and designer, Reportman.Server, Reportman AI, the Delphi and FPC designers):
    /// <list type="bullet">
    /// <item><b>Encoding.</b> A file that starts with the UTF-8 BOM (EF BB BF) is UTF-8 and is written back with its
    /// BOM. Without it: on Windows the ANSI code page of the system (<c>TextInfo.ANSICodePage</c> of the current culture,
    /// 1252 in Spain; <c>Encoding.Default</c> in .Net Framework), on Linux and macOS UTF-8 (the convention of
    /// FPC/Lazarus).</item>
    /// <item><b>Surgical writing.</b> Each line keeps its original bytes and its line ending (CRLF, LF or CR); only the
    /// lines of the keys that change, and the ones added, are encoded again. Whether the file ends with a line ending
    /// or not is kept too. Every other byte (other sections, comments, blank lines, an ANSI accent of Delphi) is
    /// written back as it was.</item>
    /// </list>
    /// A new file is written without BOM (so, by the rule, ANSI on Windows) with the line endings of the platform.
    /// </summary>
    public sealed class DbxIniDocument
    {
        private sealed class Line
        {
            public byte[] Raw;      // the original bytes, without the ending; null for a line written here
            public byte[] Ending;   // CRLF, LF, CR or nothing (the last line of a file without a final line ending)
            public string Text;     // decoded
        }

        private static readonly byte[] Utf8Bom = new byte[] { 0xEF, 0xBB, 0xBF };
        private readonly List<Line> FLines = new List<Line>();
        private byte[] FNewLine;

        /// <summary>The file of the document ("" for one parsed from bytes).</summary>
        public string FileName { get; private set; } = "";
        /// <summary>The encoding the file has, by the rule of the class.</summary>
        public Encoding Encoding { get; private set; }
        /// <summary>Whether the file starts with the UTF-8 BOM (and is written back with it).</summary>
        public bool HasBom { get; private set; }
        /// <summary>The line ending of the file (the first one it has), used for the lines added.</summary>
        public string NewLine { get; private set; }

        private DbxIniDocument()
        {
        }

        /// <summary>Whether this is Windows (the encoding of a file without BOM depends on it).</summary>
        private static bool IsWindows
        {
            get { return Environment.OSVersion.Platform == PlatformID.Win32NT; }
        }

#if NETCOREAPP
        static DbxIniDocument()
        {
            // The ANSI code pages are not built in .Net Core
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        }
#endif

        /// <summary>
        /// The encoding of a file without BOM: on Windows the ANSI code page of the system, elsewhere UTF-8.
        /// </summary>
        public static Encoding WithoutBomEncoding()
        {
            if (!IsWindows)
                return new UTF8Encoding(false);
#if NETFRAMEWORK
            return Encoding.Default;
#else
            try
            {
                int codePage = CultureInfo.CurrentCulture.TextInfo.ANSICodePage;
                if (codePage > 0)
                    return Encoding.GetEncoding(codePage);
            }
            catch (ArgumentException)
            {
            }
            catch (NotSupportedException)
            {
            }
            return Encoding.GetEncoding(1252);
#endif
        }

        /// <summary>The encoding of a file with these bytes, by the rule of the class.</summary>
        public static Encoding EncodingOf(byte[] bytes, out bool bom)
        {
            bom = bytes.Length >= 3 && bytes[0] == Utf8Bom[0] && bytes[1] == Utf8Bom[1] && bytes[2] == Utf8Bom[2];
            return bom ? new UTF8Encoding(false) : WithoutBomEncoding();
        }

        /// <summary>The document of <paramref name="path"/>; an empty one (a new file) when it does not exist.</summary>
        public static DbxIniDocument Load(string path)
        {
            DbxIniDocument document = File.Exists(path) ? Parse(File.ReadAllBytes(path)) : Parse(new byte[0]);
            document.FileName = path ?? "";
            return document;
        }

        /// <summary>The document of these bytes (the content of a file).</summary>
        public static DbxIniDocument Parse(byte[] bytes)
        {
            DbxIniDocument document = new DbxIniDocument();
            bool bom;
            document.Encoding = EncodingOf(bytes, out bom);
            document.HasBom = bom;
            int start = bom ? 3 : 0;
            int lineStart = start;
            string newline = null;
            for (int i = start; i < bytes.Length; i++)
            {
                byte b = bytes[i];
                if (b != 10 && b != 13)
                    continue;
                int endingLength = b == 13 && i + 1 < bytes.Length && bytes[i + 1] == 10 ? 2 : 1;
                document.AddRaw(bytes, lineStart, i - lineStart, i, endingLength);
                if (newline == null)
                    newline = endingLength == 2 ? "\r\n" : (b == 10 ? "\n" : "\r");
                i += endingLength - 1;
                lineStart = i + 1;
            }
            if (lineStart < bytes.Length)
                document.AddRaw(bytes, lineStart, bytes.Length - lineStart, bytes.Length, 0);
            document.NewLine = newline ?? (IsWindows ? "\r\n" : "\n");
            document.FNewLine = Encoding.ASCII.GetBytes(document.NewLine);
            return document;
        }

        private void AddRaw(byte[] bytes, int start, int length, int endingStart, int endingLength)
        {
            Line line = new Line();
            line.Raw = new byte[length];
            Array.Copy(bytes, start, line.Raw, 0, length);
            line.Ending = new byte[endingLength];
            Array.Copy(bytes, endingStart, line.Ending, 0, endingLength);
            line.Text = Encoding.GetString(line.Raw);
            FLines.Add(line);
        }

        /// <summary>The lines of the file, decoded (without their endings).</summary>
        public List<string> Lines()
        {
            List<string> result = new List<string>(FLines.Count);
            foreach (Line line in FLines)
                result.Add(line.Text);
            return result;
        }

        /// <summary>The lines of <paramref name="path"/>, decoded by the rule of the class (none when it does not exist).</summary>
        public static string[] ReadLines(string path)
        {
            if (string.IsNullOrEmpty(path) || !File.Exists(path))
                return new string[0];
            return Load(path).Lines().ToArray();
        }

        /// <summary>The bytes of the document: what is not changed, as it was read.</summary>
        public byte[] ToBytes()
        {
            using (MemoryStream stream = new MemoryStream())
            {
                if (HasBom)
                    stream.Write(Utf8Bom, 0, Utf8Bom.Length);
                foreach (Line line in FLines)
                {
                    byte[] content = line.Raw ?? Encoding.GetBytes(line.Text);
                    stream.Write(content, 0, content.Length);
                    stream.Write(line.Ending, 0, line.Ending.Length);
                }
                return stream.ToArray();
            }
        }

        /// <summary>Writes the document to <paramref name="path"/> (its own file when null), creating its folder.</summary>
        public void Save(string path = null)
        {
            if (string.IsNullOrEmpty(path))
                path = FileName;
            if (string.IsNullOrEmpty(path))
                throw new InvalidOperationException("The connections file has no name");
            string dir = Path.GetDirectoryName(Path.GetFullPath(path));
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                Directory.CreateDirectory(dir);
            File.WriteAllBytes(path, ToBytes());
        }

        // ---- reading ----

        private static bool IsHeader(string text, out string name)
        {
            name = "";
            string t = text.Trim();
            if (t.Length >= 2 && t[0] == '[' && t[t.Length - 1] == ']')
            {
                name = t.Substring(1, t.Length - 2).Trim();
                return true;
            }
            return false;
        }

        // The key of a line, or null (blank, comment, header, no '=')
        private static string KeyOf(string text)
        {
            string t = text.Trim();
            if (t.Length == 0 || t[0] == ';' || t[0] == '#' || t[0] == '[')
                return null;
            int eq = t.IndexOf('=');
            return eq > 0 ? t.Substring(0, eq).Trim() : null;
        }

        /// <summary>The sections of the file, in its order (a repeated name is listed each time).</summary>
        public List<DbxIniSection> Sections()
        {
            List<DbxIniSection> result = new List<DbxIniSection>();
            DbxIniSection current = null;
            foreach (Line line in FLines)
            {
                string name;
                if (IsHeader(line.Text, out name))
                {
                    current = new DbxIniSection { Name = name };
                    result.Add(current);
                    continue;
                }
                if (current == null)
                    continue;
                string key = KeyOf(line.Text);
                if (key == null)
                    continue;
                string t = line.Text.Trim();
                current.Keys.Add(new KeyValuePair<string, string>(key, t.Substring(t.IndexOf('=') + 1).Trim()));
            }
            return result;
        }

        /// <summary>The names of the sections, in the order of the file.</summary>
        public List<string> SectionNames()
        {
            List<string> result = new List<string>();
            foreach (DbxIniSection section in Sections())
                if (section.Name.Length > 0)
                    result.Add(section.Name);
            return result;
        }

        /// <summary>Whether the file has the section <paramref name="section"/> (the case does not matter).</summary>
        public bool HasSection(string section)
        {
            return FindSection(section) >= 0;
        }

        /// <summary>
        /// The value (trimmed) of <paramref name="key"/> in the first section <paramref name="section"/>, or
        /// <paramref name="defaultValue"/>. Neither the section nor the key depend on the case.
        /// </summary>
        public string GetValue(string section, string key, string defaultValue)
        {
            int start = FindSection(section);
            if (start < 0)
                return defaultValue;
            int line = FindKey(start, SectionEnd(start), key);
            if (line < 0)
                return defaultValue;
            string t = FLines[line].Text.Trim();
            return t.Substring(t.IndexOf('=') + 1).Trim();
        }

        private int FindSection(string section)
        {
            if (section == null)
                return -1;
            string wanted = section.Trim();
            for (int i = 0; i < FLines.Count; i++)
            {
                string name;
                if (IsHeader(FLines[i].Text, out name) && string.Equals(name, wanted, StringComparison.OrdinalIgnoreCase))
                    return i;
            }
            return -1;
        }

        private int SectionEnd(int start)
        {
            for (int i = start + 1; i < FLines.Count; i++)
            {
                string ignored;
                if (IsHeader(FLines[i].Text, out ignored))
                    return i;
            }
            return FLines.Count;
        }

        private int FindKey(int start, int end, string key)
        {
            for (int i = start + 1; i < end; i++)
                if (string.Equals(KeyOf(FLines[i].Text), key, StringComparison.OrdinalIgnoreCase))
                    return i;
            return -1;
        }

        // ---- writing ----

        /// <summary>
        /// Sets <paramref name="values"/> in the first section <paramref name="section"/>: the line of a key that is
        /// there gets the new value (its key and the spaces around the '=' as they were), a key that is not is added
        /// after the last line of the section (comments included, blank lines not), and a section that is not there is
        /// added at the end of the file, after a blank line. A value that does not change leaves its line untouched.
        /// Returns whether anything changed. Nothing else of the document changes.
        /// </summary>
        public bool SetValues(string section, IEnumerable<KeyValuePair<string, string>> values)
        {
            if (string.IsNullOrWhiteSpace(section) || section.IndexOfAny(new char[] { '[', ']', '\r', '\n' }) >= 0)
                throw new ArgumentException("Invalid section name: " + section);
            List<KeyValuePair<string, string>> list = new List<KeyValuePair<string, string>>();
            foreach (KeyValuePair<string, string> pair in values)
            {
                if (string.IsNullOrWhiteSpace(pair.Key) || pair.Key.IndexOfAny(new char[] { '=', '\r', '\n' }) >= 0 ||
                    pair.Key.Trim().StartsWith("[", StringComparison.Ordinal) ||
                    (pair.Value ?? "").IndexOfAny(new char[] { '\r', '\n' }) >= 0)
                    throw new ArgumentException("Invalid key for the section " + section + ": " + pair.Key);
                list.Add(new KeyValuePair<string, string>(pair.Key.Trim(), pair.Value ?? ""));
            }
            int start = FindSection(section);
            if (start < 0)
            {
                AppendSection(section.Trim(), list);
                return true;
            }
            bool changed = false;
            foreach (KeyValuePair<string, string> pair in list)
            {
                int end = SectionEnd(start);
                int keyLine = FindKey(start, end, pair.Key);
                if (keyLine >= 0)
                {
                    Line line = FLines[keyLine];
                    int eq = line.Text.IndexOf('=');
                    string after = line.Text.Substring(eq + 1);
                    if (after.Trim() == pair.Value)
                        continue;
                    string spaces = after.Substring(0, after.Length - after.TrimStart().Length);
                    line.Text = line.Text.Substring(0, eq + 1) + spaces + pair.Value;
                    line.Raw = null;
                }
                else
                {
                    int last = start;
                    for (int i = start + 1; i < end; i++)
                        if (FLines[i].Text.Trim().Length > 0)
                            last = i;
                    InsertAfter(last, pair.Key + "=" + pair.Value);
                }
                changed = true;
            }
            return changed;
        }

        // A line after the line «index», with the file's line ending; after the last line of a file without a final
        // line ending, that line gets one and the new one goes without it (the file keeps ending so)
        private void InsertAfter(int index, string text)
        {
            Line previous = FLines[index];
            Line line = new Line { Text = text };
            if (previous.Ending.Length == 0)
            {
                previous.Ending = FNewLine;
                line.Ending = new byte[0];
            }
            else
                line.Ending = FNewLine;
            FLines.Insert(index + 1, line);
        }

        private void AppendSection(string section, List<KeyValuePair<string, string>> values)
        {
            bool withoutFinalEnding = FLines.Count > 0 && FLines[FLines.Count - 1].Ending.Length == 0;
            if (withoutFinalEnding)
                FLines[FLines.Count - 1].Ending = FNewLine;
            if (FLines.Count > 0 && FLines[FLines.Count - 1].Text.Trim().Length > 0)
                FLines.Add(new Line { Text = "", Ending = FNewLine });
            FLines.Add(new Line { Text = "[" + section + "]", Ending = FNewLine });
            foreach (KeyValuePair<string, string> pair in values)
                FLines.Add(new Line { Text = pair.Key + "=" + pair.Value, Ending = FNewLine });
            if (withoutFinalEnding)
                FLines[FLines.Count - 1].Ending = new byte[0];
        }
    }
}
