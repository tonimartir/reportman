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
 *     Software is distributed on an "AS IS" basis,
 *     WITHOUT WARRANTY OF ANY KIND, either
 *     express or implied.  See the License for the specific
 *     language governing rights and limitations.
 *
 *  Copyright (c) 1994 - 2008 Toni Martir (toni@reportman.es)
 *  All Rights Reserved.
*/
#endregion

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;

namespace Reportman.Drawing
{
    /// <summary>
    /// Reads and writes classic INI configuration files, exposing typed accessors for
    /// string, integer, decimal, boolean and date/time values grouped into named sections,
    /// with support for loading from a file or stream and saving back.
    /// </summary>
    public class IniFile
    {
        string fname;
        Strings lines;
        NumberFormatInfo numberfor;
        /// <summary>
        /// Sections of the INI file, keyed by upper-cased section name.
        /// </summary>
        public SortedList<string, IniSection> sections;
        FileInfo finfo;
        /// <summary>
        /// Initializes a new instance loading its contents from the given file, if it exists.
        /// </summary>
        /// <param name="filename">Path of the INI file to load.</param>
        public IniFile(string filename)
        {
            fname = filename;
            lines = new Strings();
            finfo = new FileInfo(fname);
            if (finfo.Exists)
                lines.LoadFromFile(filename);
            sections = new SortedList<string, IniSection>();
            ParseText();
        }
        /// <summary>
        /// Initializes a new instance loading its contents from the given stream.
        /// </summary>
        /// <param name="inistream">Stream containing the INI file text.</param>
        public IniFile(Stream inistream)
        {
            lines = new Strings();
            lines.LoadFromStream(inistream);
            sections = new SortedList<string, IniSection>();
            ParseText();
        }
        /// <summary>
        /// Reads a string value from the given section, returning <paramref name="defaultvalue"/>
        /// when the section or value is not present.
        /// </summary>
        /// <param name="sectionname">Name of the section to read from.</param>
        /// <param name="valuename">Name of the value to read.</param>
        /// <param name="defaultvalue">Value returned when the entry is missing.</param>
        /// <returns>The stored string, or the default value.</returns>
        public string ReadString(string sectionname, string valuename, string defaultvalue)
        {
            string aresult = defaultvalue;
            string asec = sectionname.ToUpper();
            if (sections.IndexOfKey(asec) >= 0)
            {
                IniSection inisec = sections[asec];
                string aval = valuename.ToUpper();
                if (inisec.Values.IndexOfKey(aval) >= 0)
                {
                    aresult = inisec.Values[aval];
                }
            }
            return aresult;
        }
        /// <summary>
        /// Writes a string value into the given section, creating the section or entry when needed.
        /// </summary>
        /// <param name="sectionname">Name of the section to write to.</param>
        /// <param name="valuename">Name of the value to write.</param>
        /// <param name="newvalue">Value to store.</param>
        public void WriteString(string sectionname, string valuename, string newvalue)
        {
            string asec = sectionname.ToUpper();
            IniSection inisec;
            if (sections.IndexOfKey(asec) < 0)
            {
                inisec = new IniSection();
                sections.Add(asec, inisec);
            }
            else
                inisec = sections[asec];
            string aval = valuename.ToUpper();
            if (inisec.Values.IndexOfKey(aval) >= 0)
            {
                inisec.Values[aval] = newvalue;
            }
            else
                inisec.Values.Add(aval, newvalue);
        }
        /// <summary>
        /// Reads a date/time value stored in the "yyyyMMdd HHmmss" format, returning
        /// <paramref name="defaultvalue"/> when the entry is missing or cannot be parsed.
        /// </summary>
        /// <param name="sectionname">Name of the section to read from.</param>
        /// <param name="valuename">Name of the value to read.</param>
        /// <param name="defaultvalue">Value returned when the entry is missing or invalid.</param>
        /// <returns>The parsed date/time, or the default value.</returns>
        public DateTime ReadDateTime(string sectionname, string valuename, DateTime defaultvalue)
        {
            DateTime aresult = defaultvalue;
            string asec = sectionname.ToUpper();
            if (sections.IndexOfKey(asec) >= 0)
            {
                IniSection inisec = sections[asec];
                string aval = valuename.ToUpper();
                if (inisec.Values.IndexOfKey(aval) >= 0)
                {
                    try
                    {
                        string avalue = inisec.Values[aval];
                        if (avalue.Length > 0)
                        {
                            int year = System.Convert.ToInt32(avalue.Substring(0, 4));
                            int month = System.Convert.ToInt32(avalue.Substring(4, 2));
                            int day = System.Convert.ToInt32(avalue.Substring(6, 2));

                            int hour = System.Convert.ToInt32(avalue.Substring(9, 2));
                            int minute = System.Convert.ToInt32(avalue.Substring(11, 2));
                            int second = System.Convert.ToInt32(avalue.Substring(13, 2));

                            aresult = new DateTime(year, month, day, hour, minute, second);
                        }
                        else
                            aresult = defaultvalue;
                    }
                    catch
                    {
                        aresult = defaultvalue;
                    }
                }
            }
            return aresult;
        }
        /// <summary>
        /// Writes a date/time value into the given section using the "yyyyMMdd HHmmss" format.
        /// </summary>
        /// <param name="sectionname">Name of the section to write to.</param>
        /// <param name="valuename">Name of the value to write.</param>
        /// <param name="newvalue">Date/time to store.</param>
        public void WriteDateTime(string sectionname, string valuename, DateTime newvalue)
        {
            string asec = sectionname.ToUpper();
            IniSection inisec;
            if (sections.IndexOfKey(asec) < 0)
            {
                inisec = new IniSection();
                sections.Add(asec, inisec);
            }
            else
                inisec = sections[asec];
            string aval = valuename.ToUpper();
            string datestring = newvalue.ToString("yyyyMMdd HHmmss");
            if (inisec.Values.IndexOfKey(aval) >= 0)
            {
                inisec.Values[aval] = datestring;
            }
            else
                inisec.Values.Add(aval, datestring);
        }
        /// <summary>
        /// Writes an integer value into the given section, creating the section or entry when needed.
        /// </summary>
        /// <param name="sectionname">Name of the section to write to.</param>
        /// <param name="valuename">Name of the value to write.</param>
        /// <param name="intvalue">Integer to store.</param>
        public void WriteInteger(string sectionname, string valuename, int intvalue)
        {
            string newvalue = intvalue.ToString();
            string asec = sectionname.ToUpper();
            IniSection inisec;
            if (sections.IndexOfKey(asec) < 0)
            {
                inisec = new IniSection();
                sections.Add(asec, inisec);
            }
            else
                inisec = sections[asec];
            string aval = valuename.ToUpper();
            if (inisec.Values.IndexOfKey(aval) >= 0)
            {
                inisec.Values[aval] = newvalue;
            }
            else
                inisec.Values.Add(aval, newvalue);
        }
        /// <summary>
        /// Writes a decimal value into the given section using an invariant-style number format
        /// (dot decimal separator, no group separator).
        /// </summary>
        /// <param name="sectionname">Name of the section to write to.</param>
        /// <param name="valuename">Name of the value to write.</param>
        /// <param name="decvalue">Decimal to store.</param>
        public void WriteDecimal(string sectionname, string valuename, decimal decvalue)
        {
            CheckNumberFormat();
            valuename = valuename.ToUpper();
            string newvalue = decvalue.ToString(numberfor);
            string asec = sectionname.ToUpper();
            IniSection inisec;
            if (sections.IndexOfKey(asec) < 0)
            {
                inisec = new IniSection();
                sections.Add(asec, inisec);
            }
            else
                inisec = sections[asec];
            string aval = valuename.ToUpper();
            if (inisec.Values.IndexOfKey(aval) >= 0)
            {
                inisec.Values[aval] = newvalue;
            }
            else
                inisec.Values.Add(valuename, newvalue);
        }
        /// <summary>
        /// Writes a boolean value into the given section, stored as 1 for true and 0 for false.
        /// </summary>
        /// <param name="sectionname">Name of the section to write to.</param>
        /// <param name="valuename">Name of the value to write.</param>
        /// <param name="boolvalue">Boolean to store.</param>
        public void WriteBool(string sectionname, string valuename, bool boolvalue)
        {
            int defint = 0;
            if (boolvalue)
                defint = 1;

            WriteInteger(sectionname, valuename, defint);
        }
        /// <summary>
        /// Reads an integer value from the given section, returning <paramref name="defaultvalue"/>
        /// when the entry is missing or empty.
        /// </summary>
        /// <param name="sectionname">Name of the section to read from.</param>
        /// <param name="valuename">Name of the value to read.</param>
        /// <param name="defaultvalue">Value returned when the entry is missing or empty.</param>
        /// <returns>The stored integer, or the default value.</returns>
        public int ReadInteger(string sectionname, string valuename, int defaultvalue)
        {
            string sresult = ReadString(sectionname, valuename, defaultvalue.ToString());
            if (sresult.Length == 0)
                return defaultvalue;
            else
                return System.Convert.ToInt32(sresult);
        }
        /// <summary>
        /// Ensures the internal number format (dot decimal separator, no group separator)
        /// used to read and write decimal values is initialized.
        /// </summary>
        public void CheckNumberFormat()
        {
            if (numberfor == null)
            {
                numberfor = new NumberFormatInfo();
                numberfor.NumberDecimalSeparator = ".";
                numberfor.NumberGroupSeparator = "";
            }
        }
        /// <summary>
        /// Reads a decimal value from the given section using an invariant-style number format,
        /// returning <paramref name="defaultvalue"/> when the entry is missing or empty.
        /// </summary>
        /// <param name="sectionname">Name of the section to read from.</param>
        /// <param name="valuename">Name of the value to read.</param>
        /// <param name="defaultvalue">Value returned when the entry is missing or empty.</param>
        /// <returns>The stored decimal, or the default value.</returns>
        public decimal ReadDecimal(string sectionname, string valuename, decimal defaultvalue)
        {
            CheckNumberFormat();
            string sresult = ReadString(sectionname, valuename, defaultvalue.ToString(numberfor));
            if (sresult.Length == 0)
                return defaultvalue;
            else
                return System.Convert.ToDecimal(sresult, numberfor);
        }
        /// <summary>
        /// Reads a boolean value from the given section, interpreting 1 as true and any other
        /// value as false, and returning <paramref name="defaultvalue"/> when the entry is missing.
        /// </summary>
        /// <param name="sectionname">Name of the section to read from.</param>
        /// <param name="valuename">Name of the value to read.</param>
        /// <param name="defaultvalue">Value returned when the entry is missing.</param>
        /// <returns>The stored boolean, or the default value.</returns>
        public bool ReadBool(string sectionname, string valuename, bool defaultvalue)
        {
            int defint = 0;
            if (defaultvalue)
                defint = 1;

            int intresult = ReadInteger(sectionname, valuename, defint);
            return (intresult == 1);
        }
        private void ParseText()
        {
            IniSection currentsection = null;
            foreach (string linex in lines)
            {
                string line = linex.Trim();
                // A section ?
                if (line.Length > 0)
                {
                    if (line[0] == '[')
                    {
                        string secname = line.Substring(1, line.Length - 1).ToUpper();
                        int index1 = secname.IndexOf(']');
                        if (index1 > 0)
                        {
                            secname = secname.Substring(0, index1);
                        }
                        currentsection = new IniSection();
                        if (sections.IndexOfKey(secname) < 0)
                            sections.Add(secname, currentsection);
                    }
                    else
                    {
                        // Must be a value
                        if (currentsection != null)
                        {
                            string nvalue = "";
                            string valuename = line.ToUpper();
                            int index2 = line.IndexOf('=');
                            if (index2 > 0)
                            {
                                nvalue = line.Substring(index2 + 1, line.Length - index2 - 1);
                                valuename = line.Substring(0, index2).ToUpper();
                            }
                            if (currentsection.Values.IndexOfKey(valuename) < 0)
                                currentsection.Values.Add(valuename, nvalue);
                        }
                    }
                }
            }
        }
        /// <summary>
        /// Writes every section and value to the given stream in INI text format.
        /// </summary>
        /// <param name="nstream">Destination stream.</param>
        public void SaveToStream(Stream nstream)
        {
            Strings nstring = new Strings();
            foreach (string secname in sections.Keys)
            {
                IniSection inisec = sections[secname];
                nstring.Add("[" + secname + "]");
                foreach (string nkey in inisec.Values.Keys)
                {
                    nstring.Add(nkey + "=" + inisec.Values[nkey]);
                }
            }
            nstring.Add("[SEC2]");
            string ntext = nstring.Text;
            byte[] content = StreamUtil.StringToByteArray(ntext, ntext.Length);
            nstream.Write(content, 0, content.Length);

        }
        /// <summary>
        /// Saves every section and value to the given file, creating the target directory when needed.
        /// </summary>
        /// <param name="filename">Path of the file to write.</param>
        public void SaveToFile(string filename)
        {
            string apath = Path.GetDirectoryName(filename);
            if (!Directory.Exists(apath))
                Directory.CreateDirectory(apath);
            using (FileStream fstream = new FileStream(filename, FileMode.Create, FileAccess.Write))
            {
                SaveToStream(fstream);
            }
        }
    }

    /// <summary>
    /// A single section of an <see cref="IniFile"/>, holding its key/value pairs as a
    /// sorted list keyed by value name.
    /// </summary>
    public class IniSection
    {
        /// <summary>
        /// Key/value pairs of the section, keyed by upper-cased value name.
        /// </summary>
        public SortedList<string, string> Values;
        /// <summary>
        /// Initializes a new, empty section.
        /// </summary>
        public IniSection()
        {
            Values = new SortedList<string, string>();
        }
    }
}
