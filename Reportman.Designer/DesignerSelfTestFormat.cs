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

using Reportman.Drawing;
using Reportman.Reporting;
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace Reportman.Designer
{
    /// <summary>
    /// Headless checks of the report file format (invoked from designer.exe /undotest): the bidi modes of
    /// the text components, the series colors of the charts and the begin page flag of the sections load
    /// from a Delphi report, are saved with the Delphi syntax, survive a save and reload and come back when
    /// undo restores a deleted item.
    /// </summary>
    public static class DesignerSelfTestFormat
    {
        /// <summary>
        /// Runs the format checks. Returns one line per failed or skipped check and a summary line
        /// ("FORMAT: n passed, m failed").
        /// </summary>
        public static string RunFormatTests()
        {
            FormatLog log = new FormatLog();
            RunCheck(log, "Delphi xml loads bidi modes, series colors and begin page", TestLoadDelphiXml);
            RunCheck(log, "save and reload keep them", TestSaveReload);
            RunCheck(log, "saved with the Delphi syntax", TestDelphiSyntax);
            RunCheck(log, "compressed xml keeps them", TestCompressed);
            RunCheck(log, "json keeps the bidi modes", TestJson);
            RunCheck(log, "Delphi sample report", TestDelphiSample);
            RunCheck(log, "bidi mode of the report language", TestLanguages);
            RunCheck(log, "delete and undo restore them", TestDeleteUndo);
            return log.ToString();
        }

        private sealed class FormatLog
        {
            private readonly StringBuilder FText = new StringBuilder();
            private string FTest = "";
            internal int Passed;
            internal int Failed;

            internal void Start(string test)
            {
                FTest = test;
            }

            internal void Check(bool condition, string message)
            {
                if (condition)
                {
                    Passed++;
                    return;
                }
                Failed++;
                FText.AppendLine("FAIL [" + FTest + "] " + message);
            }

            internal void Skip(string message)
            {
                FText.AppendLine("SKIP [" + FTest + "] " + message);
            }

            public override string ToString()
            {
                return FText.ToString() + "FORMAT: " + Passed.ToString() + " passed, " +
                    Failed.ToString() + " failed" + Environment.NewLine;
            }
        }

        private static void RunCheck(FormatLog log, string name, Action<FormatLog> test)
        {
            log.Start(name);
            try
            {
                test(log);
            }
            catch (Exception ex)
            {
                log.Check(false, "exception: " + ex);
            }
        }

        private const string LabelFull = "TRpLabel0";
        private const string LabelPartial = "TRpLabel1";
        private const string ExpressionFull = "TRpExpression0";
        private const string Chart = "TRpChart0";
        private const string DetailSection = "TRpSection0";

        // The Delphi StringToRpString (rpxmlstream.pas): letters, digits and "_ .()=;:" as they are, any other
        // character as #code#, and a CR LF each time a line passes 40 characters
        private static string DelphiRpString(string value)
        {
            const string symbols = "_ .()=;:";
            StringBuilder result = new StringBuilder();
            int length = 0;
            foreach (char c in value)
            {
                bool alpha = (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || symbols.IndexOf(c) >= 0;
                string part = alpha ? c.ToString() : "#" + ((int)c).ToString() + "#";
                result.Append(part);
                length += part.Length;
                if (length > 40)
                {
                    length = 0;
                    result.Append("\r\n");
                }
            }
            return result.ToString();
        }

        private static string Prop(string name, string type, string value)
        {
            return "<" + name + " type=\"" + type + "\">" + value + "</" + name + ">\r\n";
        }

        // Text component as the Delphi xml writer saved it before April 2026: BIDIMODE with the mode of the
        // current language (2 is BidiFull) after LFONTNAME and BIDIMODES (BidiModes.Text) after SINGLELINE
        private static void AppendTextComponent(StringBuilder x, string name, string className, int bidiMode, string bidiModesText)
        {
            x.Append("<COMPONENT>\r\n");
            x.Append(Prop("NAME", "String", name));
            x.Append(Prop("CLASSNAME", "String", className));
            x.Append(Prop("WIDTH", "Integer", "2000"));
            x.Append(Prop("HEIGHT", "Integer", "300"));
            x.Append(Prop("PRINTCONDITION", "WideString", ""));
            x.Append(Prop("DOBEFOREPRINT", "WideString", ""));
            x.Append(Prop("DOAFTERPRINT", "WideString", ""));
            x.Append(Prop("ANNOTATION", "String", ""));
            x.Append(Prop("POSX", "Integer", "100"));
            x.Append(Prop("POSY", "Integer", "100"));
            x.Append(Prop("ALIGN", "Integer", "0"));
            x.Append(Prop("WFONTNAME", "WideString", "Noto Sans Arabic"));
            x.Append(Prop("LFONTNAME", "WideString", "Noto Sans Arabic"));
            x.Append(Prop("BIDIMODE", "Integer", bidiMode.ToString()));
            x.Append(Prop("TYPE1FONT", "Integer", "0"));
            x.Append(Prop("FONTSIZE", "Integer", "10"));
            x.Append(Prop("ALIGNMENT", "Integer", "0"));
            x.Append(Prop("VALIGNMENT", "Integer", "0"));
            x.Append(Prop("INTERLINE", "Integer", "0"));
            x.Append(Prop("WORDWRAP", "Boolean", "False"));
            x.Append(Prop("WORDBREAK", "Boolean", "True"));
            x.Append(Prop("SINGLELINE", "Boolean", "False"));
            if (bidiModesText != null)
                x.Append(Prop("BIDIMODES", "String", DelphiRpString(bidiModesText)));
            x.Append(Prop("MULTIPAGE", "Boolean", "False"));
            x.Append(Prop("PRINTSTEP", "Integer", "0"));
        }

        // A report in Delphi xml, with the SERIESCOLORS and BEGINPAGE properties this port adds (the Delphi
        // xml reader ignores them): a BidiFull label with three languages, a label and an expression with
        // only the mode of the current language, a chart with series colors and a section that begins a page
        private static string DelphiXml()
        {
            StringBuilder x = new StringBuilder();
            x.Append("<?xml version=\"1.0\" standalone=\"no\"?>\r\n");
            x.Append("<!DOCTYPE REPORT_MANAGER_2>\r\n");
            x.Append("<REPORT>\r\n");
            x.Append(Prop("WFONTNAME", "WideString", "Arial"));
            x.Append(Prop("LFONTNAME", "WideString", "Helvetica"));
            x.Append(Prop("LANGUAGE", "Integer", "-1"));
            x.Append(Prop("BIDIMODES", "String", ""));
            x.Append("<SUBREPORT>\r\n");
            x.Append(Prop("NAME", "String", "TRpSubReport0"));
            x.Append(Prop("ALIAS", "String", ""));
            x.Append(Prop("PRINTONLYIFDATAAVAILABLE", "Boolean", "True"));
            x.Append("<SECTION>\r\n");
            x.Append(Prop("NAME", "String", DetailSection));
            x.Append(Prop("WIDTH", "Integer", "10772"));
            x.Append(Prop("HEIGHT", "Integer", "4140"));
            x.Append(Prop("SUBREPORT", "String", "TRpSubReport0"));
            x.Append(Prop("BEGINPAGEEXPRESSION", "WideString", ""));
            x.Append(Prop("BEGINPAGE", "Boolean", "True"));
            x.Append(Prop("SECTIONTYPE", "Integer", ((int)SectionType.Detail).ToString()));
            AppendTextComponent(x, LabelFull, "TRPLABEL", 2, "BidiFull\r\nBidiPartial\r\nBidiNo\r\n");
            x.Append(Prop("WIDETEXT", "WideString", DelphiRpString("Hello\r\nHola")));
            x.Append("</COMPONENT>\r\n");
            AppendTextComponent(x, LabelPartial, "TRPLABEL", 1, "BidiPartial\r\n");
            x.Append(Prop("WIDETEXT", "WideString", "Text"));
            x.Append("</COMPONENT>\r\n");
            AppendTextComponent(x, ExpressionFull, "TRPEXPRESSION", 2, null);
            x.Append(Prop("EXPRESSION", "WideString", "1"));
            x.Append("</COMPONENT>\r\n");
            AppendTextComponent(x, Chart, "TRPCHART", 0, "BidiNo\r\nBidiFull\r\n");
            x.Append(Prop("VALUEEXPRESSION", "WideString", "1"));
            x.Append(Prop("SERIESCOLORS", "String", DelphiRpString("255,65280,-1")));
            x.Append(Prop("CHARTTYPE", "Integer", "0"));
            x.Append("</COMPONENT>\r\n");
            x.Append("</SECTION>\r\n");
            x.Append("</SUBREPORT>\r\n");
            x.Append("</REPORT>\r\n");
            return x.ToString();
        }

        private static Report LoadXml(string xml)
        {
            return LoadBytes(Encoding.UTF8.GetBytes(xml));
        }

        private static Report LoadBytes(byte[] bytes)
        {
            Report rep = new Report();
            using (MemoryStream stream = new MemoryStream(bytes))
            {
                rep.LoadFromStream(stream, false);
            }
            return rep;
        }

        private static byte[] SaveBytes(Report rep, StreamVersion version)
        {
            using (MemoryStream stream = new MemoryStream())
            {
                rep.SaveToStream(stream, version);
                return stream.ToArray();
            }
        }

        // Report template without the undo history, to compare report states
        private static string SaveXml(Report rep, StreamVersion version = StreamVersion.V2)
        {
            UndoCue cue = rep.UndoCue;
            rep.UndoCue = null;
            try
            {
                return Encoding.UTF8.GetString(SaveBytes(rep, version));
            }
            finally
            {
                rep.UndoCue = cue;
            }
        }

        // Saves the report with its undo history and loads it again (the history goes through json)
        private static Report ReloadWithHistory(Report rep)
        {
            Report loaded = LoadBytes(SaveBytes(rep, StreamVersion.V2));
            if (loaded.UndoCue == null)
                loaded.UndoCue = new UndoCue();
            return loaded;
        }

        private static ReportItem FindItem(Report rep, string name)
        {
            foreach (SubReport sub in rep.SubReports)
            {
                foreach (Section sec in sub.Sections)
                {
                    if (string.Equals(sec.Name, name, StringComparison.OrdinalIgnoreCase))
                        return sec;
                    foreach (PrintPosItem item in sec.Components)
                    {
                        if (string.Equals(item.Name, name, StringComparison.OrdinalIgnoreCase))
                            return item;
                    }
                }
            }
            return null;
        }

        private static Strings Lines(params string[] lines)
        {
            Strings list = new Strings();
            list.AddRange(lines);
            return list;
        }

        private static string Show(Strings list)
        {
            return list == null ? "null" : "[" + string.Join(",", list.ToArray()) + "]";
        }

        private static bool SameLines(Strings list, params string[] lines)
        {
            if (list == null || list.Count != lines.Length)
                return false;
            for (int i = 0; i < lines.Length; i++)
            {
                if (!string.Equals(list[i], lines[i], StringComparison.Ordinal))
                    return false;
            }
            return true;
        }

        private static int CountOf(string text, string value)
        {
            int count = 0;
            int index = text.IndexOf(value, StringComparison.Ordinal);
            while (index >= 0)
            {
                count++;
                index = text.IndexOf(value, index + value.Length, StringComparison.Ordinal);
            }
            return count;
        }

        // Checks the values the Delphi xml of DelphiXml holds
        private static void CheckDelphiValues(FormatLog log, Report rep, string where)
        {
            PrintItemText labelFull = FindItem(rep, LabelFull) as PrintItemText;
            PrintItemText labelPartial = FindItem(rep, LabelPartial) as PrintItemText;
            PrintItemText expression = FindItem(rep, ExpressionFull) as PrintItemText;
            ChartItem chart = FindItem(rep, Chart) as ChartItem;
            Section section = FindItem(rep, DetailSection) as Section;
            log.Check(labelFull != null && labelPartial != null && expression != null && chart != null && section != null,
                where + ": items not found");
            if (labelFull == null || labelPartial == null || expression == null || chart == null || section == null)
                return;
            log.Check(SameLines(labelFull.BidiModes, "BidiFull", "BidiPartial", "BidiNo"),
                where + ": label bidi modes " + Show(labelFull.BidiModes));
            log.Check(labelFull.BidiMode == BidiModeType.Full && labelFull.RightToLeft, where + ": label is not BidiFull");
            log.Check(labelFull.PrintAlignment == MetaFile.AlignmentFlags_AlignRight,
                where + ": BidiFull must print a left aligned text at the right, got " + labelFull.PrintAlignment.ToString());
            log.Check(labelFull.WordBreak, where + ": word break lost");
            log.Check(SameLines(labelPartial.BidiModes, "BidiPartial") && labelPartial.BidiMode == BidiModeType.Partial,
                where + ": partial label bidi modes " + Show(labelPartial.BidiModes));
            log.Check(labelPartial.PrintAlignment == 0, where + ": BidiPartial must keep the alignment");
            log.Check(SameLines(expression.BidiModes, "BidiFull") && expression.BidiMode == BidiModeType.Full,
                where + ": expression bidi modes " + Show(expression.BidiModes));
            log.Check(SameLines(chart.BidiModes, "BidiNo", "BidiFull") && !chart.RightToLeft,
                where + ": chart bidi modes " + Show(chart.BidiModes));
            log.Check(chart.SeriesColorsText == "255,65280,-1", where + ": series colors " + chart.SeriesColorsText);
            log.Check(section.BeginPage, where + ": begin page lost");
        }

        private static void TestLoadDelphiXml(FormatLog log)
        {
            CheckDelphiValues(log, LoadXml(DelphiXml()), "load");
        }

        private static void TestSaveReload(FormatLog log)
        {
            Report rep = LoadXml(DelphiXml());
            string saved = SaveXml(rep);
            Report reloaded = LoadXml(saved);
            CheckDelphiValues(log, reloaded, "reload");
            log.Check(SaveXml(reloaded) == saved, "a second save must give the same text");
            // V1 (legacy readers) keeps the properties Delphi reads and leaves out the ones this port adds
            string legacy = SaveXml(rep, StreamVersion.V1);
            log.Check(CountOf(legacy, "<BIDIMODES ") == 3, "V1 must keep BIDIMODES");
            log.Check(!legacy.Contains("<SERIESCOLORS ") && !legacy.Contains("<BEGINPAGE "),
                "V1 must not write SERIESCOLORS nor BEGINPAGE");
        }

        private static void TestDelphiSyntax(FormatLog log)
        {
            string saved = SaveXml(LoadXml(DelphiXml()));
            // BidiModes.Text (lines ended by CR LF) as the Delphi xml writer saved it, after SINGLELINE
            log.Check(saved.Contains("<SINGLELINE type=\"Boolean\">False</SINGLELINE>\n<BIDIMODES type=\"String\">" +
                DelphiRpString("BidiFull\r\nBidiPartial\r\nBidiNo\r\n") + "</BIDIMODES>\n"),
                "label BIDIMODES not in the Delphi syntax");
            log.Check(saved.Contains("<BIDIMODES type=\"String\">" + DelphiRpString("BidiFull\r\n") + "</BIDIMODES>"), "expression BIDIMODES");
            log.Check(saved.Contains("<BIDIMODES type=\"String\">" + DelphiRpString("BidiNo\r\nBidiFull\r\n") + "</BIDIMODES>"), "chart BIDIMODES");
            // BIDIMODE right after LFONTNAME, once per text component, 1 when right to left as the Delphi writer
            log.Check(saved.Contains("<LFONTNAME type=\"String\">Noto Sans Arabic</LFONTNAME>\n<BIDIMODE type=\"Integer\">1</BIDIMODE>\n"),
                "BIDIMODE not after LFONTNAME");
            log.Check(CountOf(saved, "<BIDIMODE ") == 4, "one BIDIMODE per text component, found " + CountOf(saved, "<BIDIMODE ").ToString());
            log.Check(CountOf(saved, "<BIDIMODE type=\"Integer\">1</BIDIMODE>") == 3, "BIDIMODE must be 1 when right to left");
            // The partial label only needs BIDIMODE, as the Delphi xml writer saves it now
            log.Check(CountOf(saved, "<BIDIMODES ") == 3, "BIDIMODES only when BIDIMODE does not express it");
            log.Check(saved.Contains("<SERIESCOLORS type=\"String\">" + DelphiRpString("255,65280,-1") + "</SERIESCOLORS>"), "SERIESCOLORS");
            log.Check(saved.Contains("<BEGINPAGE type=\"Boolean\">True</BEGINPAGE>"), "BEGINPAGE");
            // A report without them is saved as before
            Report plain = new Report();
            plain.CreateNew();
            Section detail = plain.SubReports[0].Sections[plain.SubReports[0].FirstDetail];
            LabelItem label = new LabelItem();
            label.Report = plain;
            plain.GenerateNewName(label);
            label.Section = detail;
            detail.Components.Add(label);
            ChartItem chart = new ChartItem();
            chart.Report = plain;
            plain.GenerateNewName(chart);
            chart.Section = detail;
            detail.Components.Add(chart);
            string plainXml = SaveXml(plain);
            log.Check(!plainXml.Contains("<BIDIMODES ") && !plainXml.Contains("<SERIESCOLORS ") && !plainXml.Contains("<BEGINPAGE "),
                "a report without bidi modes, series colors nor begin page must not write them");
            log.Check(CountOf(plainXml, "<BIDIMODE type=\"Integer\">0</BIDIMODE>") == 2, "BIDIMODE 0 once per text component");
        }

        private static void TestCompressed(FormatLog log)
        {
            Report rep = LoadXml(DelphiXml());
            rep.StreamFormat = StreamFormatType.XMLZlib;
            byte[] bytes = SaveBytes(rep, StreamVersion.V2);
            log.Check(bytes.Length > 0 && bytes[0] == (byte)'x', "the report must be saved compressed");
            CheckDelphiValues(log, LoadBytes(bytes), "compressed");
        }

        private static void TestJson(FormatLog log)
        {
            LabelItem label = new LabelItem();
            label.BidiModes = Lines("BidiFull", "BidiNo", "BidiPartial");
            string json = Newtonsoft.Json.JsonConvert.SerializeObject(label);
            LabelItem loaded = Newtonsoft.Json.JsonConvert.DeserializeObject<LabelItem>(json);
            log.Check(loaded != null && SameLines(loaded.BidiModes, "BidiFull", "BidiNo", "BidiPartial"),
                "BidiModes must be read after RightToLeft: " + (loaded == null ? "null" : Show(loaded.BidiModes)));
        }

        private static string FindSampleReport()
        {
            DirectoryInfo dir = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
            for (int i = 0; i < 8 && dir != null; i++)
            {
                string candidate = Path.Combine(dir.FullName, "tests", "htmltest.rep");
                if (File.Exists(candidate))
                    return candidate;
                dir = dir.Parent;
            }
            return null;
        }

        // tests\htmltest.rep was saved by the Delphi xml writer before April 2026 (BIDIMODES in every text)
        private static void TestDelphiSample(FormatLog log)
        {
            string file = FindSampleReport();
            if (file == null)
            {
                log.Skip("tests\\htmltest.rep not found");
                return;
            }
            Report rep = LoadBytes(File.ReadAllBytes(file));
            string saved = SaveXml(rep);
            Report reloaded = LoadXml(saved);
            int rightToLeft = 0;
            foreach (SubReport sub in rep.SubReports)
            {
                foreach (Section sec in sub.Sections)
                {
                    foreach (PrintPosItem item in sec.Components)
                    {
                        PrintItemText text = item as PrintItemText;
                        if (text == null)
                            continue;
                        if (text.RightToLeft)
                        {
                            rightToLeft++;
                            log.Check(text.BidiModes.Count > 0 && text.BidiModes[0] == "BidiPartial",
                                text.Name + ": bidi modes " + Show(text.BidiModes));
                        }
                        // Compared item by item: the label texts of this sample do not survive a save
                        // unchanged (blank lines in WIDETEXT), which is not what this test checks
                        PrintItemText again = FindItem(reloaded, text.Name) as PrintItemText;
                        log.Check(again != null && again.RightToLeft == text.RightToLeft && again.BidiMode == text.BidiMode,
                            text.Name + ": bidi mode changed by a save and reload");
                    }
                }
            }
            log.Check(rightToLeft > 0, "no right to left text in " + file);
            // Nothing more than BIDIMODE is needed there: saved as the Delphi xml writer saves it now
            log.Check(!saved.Contains("<BIDIMODES "), "BIDIMODES written when BIDIMODE expresses it");
            log.Check(CountOf(saved, "<BIDIMODE type=\"Integer\">1</BIDIMODE>") == rightToLeft, "BIDIMODE 1 once per right to left text");
        }

        private static void TestLanguages(FormatLog log)
        {
            Report rep = new Report();
            rep.CreateNew();
            Section detail = rep.SubReports[0].Sections[rep.SubReports[0].FirstDetail];
            LabelItem label = new LabelItem();
            label.Report = rep;
            rep.GenerateNewName(label);
            label.Section = detail;
            detail.Components.Add(label);
            label.BidiModes = Lines("BidiNo", "BidiNo", "BidiFull");
            label.Alignment = TextAlignType.Right;
            rep.Language = 1;
            log.Check(label.BidiMode == BidiModeType.Full && label.RightToLeft, "language 1 is BidiFull");
            log.Check(label.PrintAlignment == MetaFile.AlignmentFlags_AlignLeft, "BidiFull must print a right aligned text at the left");
            label.Alignment = TextAlignType.Center;
            log.Check(label.PrintAlignment == MetaFile.AlignmentFlags_AlignHCenter, "BidiFull keeps a centered text");
            label.Alignment = TextAlignType.Right;
            rep.Language = 0;
            log.Check(label.BidiMode == BidiModeType.No && !label.RightToLeft, "language 0 is BidiNo");
            log.Check(label.PrintAlignment == MetaFile.AlignmentFlags_AlignRight, "BidiNo keeps the alignment");
            // As Delphi SetBidiMode: RightToLeft sets BidiPartial or BidiNo in the current language only
            label.RightToLeft = true;
            log.Check(SameLines(label.BidiModes, "BidiNo", "BidiPartial", "BidiFull"), "RightToLeft in language 0: " + Show(label.BidiModes));
            rep.Language = 3;
            label.RightToLeft = true;
            log.Check(SameLines(label.BidiModes, "BidiNo", "BidiPartial", "BidiFull", "BidiNo", "BidiPartial"),
                "the missing languages are filled with BidiNo: " + Show(label.BidiModes));
            rep.Language = 1;
            label.RightToLeft = true;
            log.Check(label.BidiMode == BidiModeType.Partial && label.BidiModes[2] == "BidiPartial", "RightToLeft true sets BidiPartial");
            // Out of range languages use the default one, as Delphi
            label.BidiModes = Lines("BidiFull");
            rep.Language = 300;
            log.Check(label.BidiMode == BidiModeType.Full, "language 300 must use the default language");
            rep.Language = -1;
        }

        private static Report BuildReport()
        {
            Report rep = new Report();
            rep.CreateNew();
            rep.UndoCue = new UndoCue();
            SubReport sub = rep.SubReports[0];
            Section header = sub.AddPageHeader();
            header.BeginPage = true;
            Section detail = sub.Sections[sub.FirstDetail];
            LabelItem label = new LabelItem();
            label.Report = rep;
            rep.GenerateNewName(label);
            label.Section = detail;
            detail.Components.Add(label);
            // BidiFull in the current language: rightToLeft alone would restore BidiPartial
            label.BidiModes = Lines("BidiFull", "BidiNo", "BidiPartial");
            ChartItem chart = new ChartItem();
            chart.Report = rep;
            rep.GenerateNewName(chart);
            chart.Section = detail;
            detail.Components.Add(chart);
            chart.SeriesColorsText = "255,65280";
            chart.BidiModes = Lines("BidiNo", "BidiFull");
            return rep;
        }

        private static void CheckRestored(FormatLog log, Report rep, string name, string where)
        {
            ReportItem item = FindItem(rep, name);
            log.Check(item != null, where + ": " + name + " not restored");
            Section section = item as Section;
            if (section != null && section.SectionType == SectionType.PageHeader)
                log.Check(section.BeginPage, where + ": begin page not restored");
            LabelItem label = item as LabelItem;
            if (label != null)
                log.Check(SameLines(label.BidiModes, "BidiFull", "BidiNo", "BidiPartial"), where + ": label bidi modes " + Show(label.BidiModes));
            ChartItem chart = item as ChartItem;
            if (chart != null)
            {
                log.Check(chart.SeriesColorsText == "255,65280", where + ": series colors " + chart.SeriesColorsText);
                log.Check(SameLines(chart.BidiModes, "BidiNo", "BidiFull"), where + ": chart bidi modes " + Show(chart.BidiModes));
            }
        }

        private static int PropertyIndex(ChangeObjectOperation op, string name)
        {
            return op.Properties.FindIndex(p => string.Equals(p.PropertyName, name, StringComparison.OrdinalIgnoreCase));
        }

        private static void TestDeleteUndo(FormatLog log)
        {
            Report model = BuildReport();
            List<string> names = new List<string>();
            foreach (Section sec in model.SubReports[0].Sections)
            {
                if (sec.SectionType == SectionType.PageHeader)
                    names.Add(sec.Name);
                foreach (PrintPosItem item in sec.Components)
                    names.Add(item.Name);
            }
            log.Check(names.Count == 3, "expected a page header, a label and a chart");
            foreach (string name in names)
            {
                // Deleted from the structure tree (BaseReport.DeleteItem)
                Report rep = BuildReport();
                string xmlBefore = SaveXml(rep);
                rep.DeleteItem(FindItem(rep, name), rep.UndoCue.GetGroupId());
                log.Check(FindItem(rep, name) == null, name + ": not deleted");
                ChangeObjectOperation remove = null;
                foreach (ChangeObjectOperation op in rep.UndoCue.UndoOperations)
                {
                    if (string.Equals(op.ComponentName, name, StringComparison.OrdinalIgnoreCase))
                        remove = op;
                }
                log.Check(remove != null, name + ": remove not recorded");
                if (remove != null && FindItem(model, name) is PrintItemText)
                    log.Check(PropertyIndex(remove, "bidiModes") > PropertyIndex(remove, "rightToLeft") && PropertyIndex(remove, "rightToLeft") >= 0,
                        name + ": bidiModes must be recorded after rightToLeft");
                Report saved = ReloadWithHistory(rep);
                rep.UndoCue.Undo(rep);
                log.Check(SaveXml(rep) == xmlBefore, name + ": undo of the delete does not restore the report");
                CheckRestored(log, rep, name, "undo");
                rep.UndoCue.Redo(rep);
                rep.UndoCue.Undo(rep);
                CheckRestored(log, rep, name, "undo after redo");
                saved.UndoCue.Undo(saved);
                log.Check(SaveXml(saved) == xmlBefore, name + ": undo from a saved history does not restore the report");
                CheckRestored(log, saved, name, "undo from a saved history");
            }
            foreach (string name in names)
            {
                Report rep = BuildReport();
                PrintPosItem item = FindItem(rep, name) as PrintPosItem;
                if (item == null)
                    continue;
                // Deleted in the designer (ButtonDeleteClick)
                string xmlBefore = SaveXml(rep);
                ChangeObjectOperation op = new ChangeObjectOperation(OperationType.Remove, rep.UndoCue.GetGroupId());
                op.ComponentName = item.Name;
                op.ComponentClass = item.ClassName;
                op.ParentName = item.Section.Name;
                op.OldItemIndex = item.Section.Components.IndexOf(item);
                FrameMainDesigner.AddAllPropertiesToOperation(item, op);
                log.Check(PropertyIndex(op, "BidiModes") > PropertyIndex(op, "RightToLeft") &&
                    PropertyIndex(op, "BidiModes") > PropertyIndex(op, "BidiMode") && PropertyIndex(op, "RightToLeft") >= 0,
                    name + ": the designer must record BidiModes after RightToLeft and BidiMode");
                rep.UndoCue.AddOperation(op, rep);
                item.Section.Components.Remove(item);
                rep.RemoveComponent(item);
                Report saved = ReloadWithHistory(rep);
                rep.UndoCue.Undo(rep);
                log.Check(SaveXml(rep) == xmlBefore, name + ": undo of a designer delete does not restore the report");
                CheckRestored(log, rep, name, "designer undo");
                saved.UndoCue.Undo(saved);
                log.Check(SaveXml(saved) == xmlBefore, name + ": undo of a designer delete from a saved history does not restore the report");
                CheckRestored(log, saved, name, "designer undo from a saved history");
            }
        }
    }
}
