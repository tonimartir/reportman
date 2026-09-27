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
using System.Text;

namespace Reportman.Designer
{
    /// <summary>Headless designer self-tests (invoked from designer.exe /undotest).</summary>
    public static class DesignerSelfTest
    {
        /// <summary>
        /// Verifies that committing a property at the value it already has (which happens
        /// when switching selection — PrintCondition is the first inspector row) does NOT
        /// create an undo entry, while a real change does.
        /// </summary>
        public static string RunUndoSelectTest(string repFile)
        {
            StringBuilder sb = new StringBuilder();
            try
            {
                Report rep = new Report();
                rep.LoadFromFile(repFile);
                rep.UndoCue = new UndoCue();
                PrintPosItem item = FindFirstPrintItem(rep);
                if (item == null)
                {
                    sb.AppendLine("No print item found in " + repFile);
                    return sb.ToString();
                }

                ObjectInspector inspector = new ObjectInspector();
                SortedList<int, ReportItem> sel = new SortedList<int, ReportItem>();
                sel.Add(1, item);
                DesignerInterface iface = DesignerInterface.GetFromOject(sel, inspector);
                string printCond = Translator.TranslateStr(614); // "Print condition"
                sb.AppendLine("Item: " + item.Name + " (" + item.GetType().Name + ")");
                sb.AppendLine(inspector.SelfTestUndoOnSelect(iface, printCond, "RPSELFTEST_COND"));
            }
            catch (Exception ex)
            {
                sb.AppendLine("ERR: " + ex);
            }
            sb.Append(RunUndoRegressionTests());
            return sb.ToString();
        }

        /// <summary>
        /// Regression checks of the undo engine and of the designer undo recording: the inspector
        /// records model values (also in a multiple selection and as one group for a font change),
        /// deleted items come back complete and in place (also from a saved history), histories with
        /// the removed values in the old values or bring to front without positions still undo, and a
        /// failing operation stays in its list. Returns one line per failed check and a summary line
        /// ("UNDO REGRESSION: n passed, m failed").
        /// </summary>
        public static string RunUndoRegressionTests()
        {
            SelfTestLog log = new SelfTestLog();
            RunCheck(log, "inspector records model values", TestInspectorModelValues);
            RunCheck(log, "font change is one undo group", TestInspectorFontGroup);
            RunCheck(log, "delete keeps the component order", TestDeleteKeepsOrder);
            RunCheck(log, "remove restores values saved in the old values", TestRemoveOldValueFallback);
            RunCheck(log, "swap and bring to front", TestSwapOperations);
            RunCheck(log, "failing operation stays in its list", TestFailingOperation);
            RunCheck(log, "delete restores every saved property", TestDeleteRestoresProperties);
            RunCheck(log, "expression PAGECOUNT flag after undo", TestExpressionPageCount);
            return log.ToString();
        }

        private sealed class SelfTestLog
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

            public override string ToString()
            {
                return FText.ToString() + "UNDO REGRESSION: " + Passed.ToString() + " passed, " +
                    Failed.ToString() + " failed" + Environment.NewLine;
            }
        }

        private static void RunCheck(SelfTestLog log, string name, Action<SelfTestLog> test)
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

        private static Report NewUndoReport()
        {
            Report rep = new Report();
            rep.CreateNew();
            rep.UndoCue = new UndoCue();
            return rep;
        }

        private static T AddItem<T>(Report rep, Section sec, T item) where T : PrintPosItem
        {
            item.Report = rep;
            rep.GenerateNewName(item);
            item.Section = sec;
            sec.Components.Add(item);
            return item;
        }

        private static Section Detail(Report rep)
        {
            return rep.SubReports[0].Sections[rep.SubReports[0].FirstDetail];
        }

        private static List<ChangeObjectOperation> LastGroup(UndoCue cue)
        {
            var ops = new List<ChangeObjectOperation>();
            if (cue.UndoOperations.Count == 0)
                return ops;
            int groupId = cue.UndoOperations[cue.UndoOperations.Count - 1].GroupId;
            foreach (ChangeObjectOperation op in cue.UndoOperations)
            {
                if (op.GroupId == groupId)
                    ops.Add(op);
            }
            return ops;
        }

        // Report template without the undo history, to compare report states
        private static string SaveXml(Report rep)
        {
            UndoCue cue = rep.UndoCue;
            rep.UndoCue = null;
            try
            {
                using (System.IO.MemoryStream stream = new System.IO.MemoryStream())
                {
                    rep.SaveToStream(stream, StreamVersion.V2);
                    return Encoding.UTF8.GetString(stream.ToArray());
                }
            }
            finally
            {
                rep.UndoCue = cue;
            }
        }

        // Saves the report with its undo history and loads it again (the history goes through json)
        private static Report ReloadWithHistory(Report rep)
        {
            using (System.IO.MemoryStream stream = new System.IO.MemoryStream())
            {
                rep.SaveToStream(stream, StreamVersion.V2);
                stream.Position = 0;
                Report loaded = new Report();
                loaded.LoadFromStream(stream, false);
                if (loaded.UndoCue == null)
                    loaded.UndoCue = new UndoCue();
                return loaded;
            }
        }

        private static void TestInspectorModelValues(SelfTestLog log)
        {
            Report rep = NewUndoReport();
            Section sec = Detail(rep);
            LabelItem label1 = AddItem(rep, sec, new LabelItem());
            LabelItem label2 = AddItem(rep, sec, new LabelItem());
            label1.Width = 1000;
            label2.Width = 2000;
            ObjectInspector inspector = new ObjectInspector();
            SortedList<int, ReportItem> sel = new SortedList<int, ReportItem>();
            sel.Add(1, label1);
            sel.Add(2, label2);
            DesignerInterface iface = DesignerInterface.GetFromOject(sel, inspector);
            // The inspector cell holds the width in units (cm or inches), the model in twips
            decimal units = Twips.UnitsFromTwips(3000m);
            int expected = Twips.TwipsFromUnits(units);
            log.Check(inspector.SelfTestSetProperty(iface, Translator.TranslateStr(554), units), "width row not found");
            log.Check(label1.Width == expected && label2.Width == expected, "width not applied");
            List<ChangeObjectOperation> ops = LastGroup(rep.UndoCue);
            log.Check(ops.Count == 2, "expected one operation per selected item, got " + ops.Count.ToString());
            foreach (ChangeObjectOperation op in ops)
            {
                ChangeOperationItem prop = op.Properties.Find(p => p.PropertyName == "Width");
                log.Check(prop != null && op.Properties.Count == 1, op.ComponentName + ": only the Width must be recorded");
                if (prop != null)
                {
                    int oldWidth = op.ComponentName == label1.Name ? 1000 : 2000;
                    log.Check(prop.OldValue is int && (int)prop.OldValue == oldWidth, op.ComponentName + ": old value is not the model width");
                    log.Check(prop.NewValue is int && (int)prop.NewValue == expected, op.ComponentName + ": new value is not the model width");
                    log.Check(prop.PropertyType == PropertyType.Integer, "width recorded as " + prop.PropertyType.ToString());
                }
            }
            rep.UndoCue.Undo(rep);
            log.Check(label1.Width == 1000 && label2.Width == 2000, "undo must restore each item its own width");
            rep.UndoCue.Redo(rep);
            log.Check(label1.Width == expected && label2.Width == expected, "redo must restore the new width");
        }

        private static void TestInspectorFontGroup(SelfTestLog log)
        {
            Report rep = NewUndoReport();
            Section sec = Detail(rep);
            LabelItem label = AddItem(rep, sec, new LabelItem());
            label.FontSize = 10;
            label.FontStyle = 0;
            ObjectInspector inspector = new ObjectInspector();
            SortedList<int, ReportItem> sel = new SortedList<int, ReportItem>();
            sel.Add(1, label);
            DesignerInterface iface = DesignerInterface.GetFromOject(sel, inspector);
            int before = rep.UndoCue.UndoOperations.Count;
            inspector.BeginUndoGroup();
            try
            {
                inspector.SelfTestSetProperty(iface, Translator.TranslateStr(563), 20);
                inspector.SelfTestSetProperty(iface, Translator.TranslateStr(566), 1);
            }
            finally
            {
                inspector.EndUndoGroup();
            }
            log.Check(label.FontSize == 20 && label.FontStyle == 1, "font not applied");
            log.Check(rep.UndoCue.UndoOperations.Count - before == 2, "expected two operations");
            log.Check(LastGroup(rep.UndoCue).Count == 2, "font size and style must share one group");
            rep.UndoCue.Undo(rep);
            log.Check(label.FontSize == 10 && label.FontStyle == 0, "one undo must restore size and style");
        }

        private static void TestDeleteKeepsOrder(SelfTestLog log)
        {
            Report rep = NewUndoReport();
            Section sec = Detail(rep);
            LabelItem a = AddItem(rep, sec, new LabelItem());
            ShapeItem b = AddItem(rep, sec, new ShapeItem());
            LabelItem c = AddItem(rep, sec, new LabelItem());
            string bName = b.Name;
            rep.DeleteItem(b, rep.UndoCue.GetGroupId());
            rep.UndoCue.Undo(rep);
            log.Check(sec.Components.Count == 3 && sec.Components[0] == a && sec.Components[1].Name == bName &&
                sec.Components[2] == c, "undo must put the component back at its position");
        }

        private static Param AddParam(Report rep, string alias, ParamType paramType, Variant value)
        {
            Param param = new Param();
            param.Report = rep;
            rep.GenerateNewName(param);
            param.Alias = alias;
            param.ParamType = paramType;
            param.Value = value;
            rep.Params.Add(param);
            return param;
        }

        private static void TestRemoveOldValueFallback(SelfTestLog log)
        {
            Report rep = NewUndoReport();
            AddParam(rep, "FIRST", ParamType.Integer, 5);
            AddParam(rep, "SECOND", ParamType.String, "text");
            string xmlBefore = SaveXml(rep);
            int groupId = rep.UndoCue.GetGroupId();
            rep.DeleteItem(rep.Params[0], groupId);
            rep.DeleteItem(rep.Params[0], groupId);
            // Histories saved by recorders that kept the removed values in the old values
            foreach (ChangeObjectOperation op in rep.UndoCue.UndoOperations)
            {
                foreach (ChangeOperationItem prop in op.Properties)
                {
                    prop.OldValue = prop.NewValue;
                    prop.NewValue = null;
                }
            }
            rep.UndoCue.Undo(rep);
            log.Check(rep.Params.Count == 2, "both parameters must come back");
            log.Check(SaveXml(rep) == xmlBefore, "parameters must come back with their values");
        }

        private static void TestSwapOperations(SelfTestLog log)
        {
            Report rep = NewUndoReport();
            Section sec = Detail(rep);
            LabelItem a = AddItem(rep, sec, new LabelItem());
            LabelItem b = AddItem(rep, sec, new LabelItem());
            LabelItem c = AddItem(rep, sec, new LabelItem());
            // Bring to front recorded without positions by older versions: undo does nothing
            ChangeObjectOperation legacy = new ChangeObjectOperation(OperationType.SwapUp, rep.UndoCue.GetGroupId());
            legacy.ComponentName = a.Name;
            legacy.ComponentClass = a.ClassName;
            legacy.ParentName = sec.Name;
            legacy.OldItemIndex = -1;
            rep.UndoCue.AddOperation(legacy, rep);
            rep.UndoCue.Undo(rep);
            log.Check(rep.UndoCue.RedoOperations.Contains(legacy), "a legacy swap must be undone (as a no-op), not lost");
            log.Check(sec.Components[0] == a && sec.Components[1] == b && sec.Components[2] == c, "a legacy swap must not move anything");
            // Bring to front with its positions, as the designer records it
            sec.Components.Remove(a);
            sec.Components.Add(a);
            ChangeObjectOperation move = new ChangeObjectOperation(OperationType.SwapUp, rep.UndoCue.GetGroupId());
            move.ComponentName = a.Name;
            move.ComponentClass = a.ClassName;
            move.ParentName = sec.Name;
            move.OldItemIndex = 0;
            move.AddProperty(UndoCue.ItemIndexProperty, PropertyType.Integer, 0, 2);
            rep.UndoCue.AddOperation(move, rep);
            rep.UndoCue.Undo(rep);
            log.Check(sec.Components[0] == a && sec.Components[1] == b && sec.Components[2] == c, "undo of bring to front");
            rep.UndoCue.Redo(rep);
            log.Check(sec.Components[0] == b && sec.Components[1] == c && sec.Components[2] == a, "redo of bring to front");
            // Adjacent swap of section components (reorder recorded by the batch editor)
            sec.Components.Reverse(0, 2);
            ChangeObjectOperation swap = new ChangeObjectOperation(OperationType.SwapDown, rep.UndoCue.GetGroupId());
            swap.ComponentName = b.Name;
            swap.ComponentClass = b.ClassName;
            swap.ParentName = sec.Name;
            swap.OldItemIndex = 0;
            rep.UndoCue.AddOperation(swap, rep);
            rep.UndoCue.Undo(rep);
            log.Check(sec.Components[0] == b && sec.Components[1] == c && sec.Components[2] == a, "undo of a component swap");
        }

        private static void TestFailingOperation(SelfTestLog log)
        {
            Report rep = NewUndoReport();
            Section sec = Detail(rep);
            LabelItem label = AddItem(rep, sec, new LabelItem());
            label.Width = 1000;
            int groupId = rep.UndoCue.GetGroupId();
            ChangeObjectOperation failing = new ChangeObjectOperation(OperationType.Modify, groupId);
            failing.ComponentName = "RPSELFTEST_MISSING";
            failing.ComponentClass = "TRPLABEL";
            failing.AddProperty("Width", PropertyType.Integer, 1, 2);
            rep.UndoCue.AddOperation(failing, rep);
            ChangeObjectOperation modify = new ChangeObjectOperation(OperationType.Modify, groupId);
            modify.ComponentName = label.Name;
            modify.ComponentClass = label.ClassName;
            modify.AddProperty("Width", PropertyType.Integer, 1000, 2000);
            label.Width = 2000;
            rep.UndoCue.AddOperation(modify, rep);
            rep.Modified = false;
            bool raised = false;
            try
            {
                rep.UndoCue.Undo(rep);
            }
            catch (InvalidOperationException)
            {
                raised = true;
            }
            log.Check(raised, "a failing undo must raise");
            log.Check(label.Width == 1000, "the operation undone before the failure is applied");
            log.Check(rep.UndoCue.UndoOperations.Count == 1 && rep.UndoCue.UndoOperations[0] == failing, "the failing operation must stay in the undo list");
            log.Check(rep.UndoCue.RedoOperations.Count == 1 && rep.UndoCue.RedoOperations[0] == modify, "the undone operation must be in the redo list");
            log.Check(rep.Modified, "the report must be marked as modified");
            // An item recreated by a failing operation is discarded (a section can not go in a section)
            rep.UndoCue.UndoOperations.Clear();
            ChangeObjectOperation remove = new ChangeObjectOperation(OperationType.Remove, rep.UndoCue.GetGroupId());
            remove.ComponentName = "RPSELFTESTSECTION";
            remove.ComponentClass = "TRPSECTION";
            remove.ParentName = sec.Name;
            remove.OldItemIndex = 0;
            rep.UndoCue.AddOperation(remove, rep);
            raised = false;
            try
            {
                rep.UndoCue.Undo(rep);
            }
            catch (InvalidOperationException)
            {
                raised = true;
            }
            log.Check(raised, "a failing remove undo must raise");
            log.Check(!rep.Components.ContainsKey("RPSELFTESTSECTION"), "the recreated item must be discarded");
            log.Check(sec.Components.Count == 1 && rep.UndoCue.UndoOperations.Count == 1, "the report and the list must be as before");
        }

        // Report with a non default value in the properties undo must restore after a delete
        private static Report BuildFullReport()
        {
            Report rep = NewUndoReport();
            SubReport sub = rep.SubReports[0];
            Section header = sub.AddPageHeader();
            header.ExternalFilename = "ext.rep";
            header.ExternalConnection = "EXTCONN";
            header.ExternalTable = "EXTTABLE";
            header.ExternalField = "EXTFIELD";
            header.ExternalSearchField = "EXTSEARCH";
            header.ExternalSearchValue = "EXTVALUE";
            header.BackExpression = "1=1";
            header.Height = 777;
            Section detail = Detail(rep);
            LabelItem label = AddItem(rep, detail, new LabelItem());
            label.AllStrings = new Strings();
            label.AllStrings.Add("Hello");
            label.AllStrings.Add("Hola");
            label.VAlignment = TextAlignVerticalType.Center;
            label.PosX = 100;
            label.Width = 1500;
            ExpressionItem expression = AddItem(rep, detail, new ExpressionItem());
            expression.Expression = "PAGECOUNT";
            expression.ExportExpression = "EXPORTEXPRE";
            expression.ExportDisplayFormat = "0.00";
            expression.ExportLine = 3;
            expression.ExportPosition = 4;
            expression.ExportSize = 5;
            expression.ExportDoNewLine = true;
            expression.AutoExpand = true;
            expression.AutoContract = true;
            BarcodeItem barcode = AddItem(rep, detail, new BarcodeItem());
            barcode.Expression = "'123'";
            barcode.Rotation = 900;
            barcode.DisplayFormat = "#";
            barcode.BackColor = 0x00FF00;
            barcode.Transparent = false;
            ShapeItem shape = AddItem(rep, detail, new ShapeItem());
            shape.PenWidth = 30;
            shape.BrushColor = 0x0000FF;
            ChartItem chart = AddItem(rep, detail, new ChartItem());
            chart.ValueExpression = "VALUEEXPRE";
            chart.GetValueCondition = "1=1";
            chart.SerieColorExpression = "123";
            chart.ClearExpression = "CLEAREXPRE";
            SubReport sub2 = rep.AddSubReport();
            sub2.ReOpenOnPrint = true;
            sub2.PrintOnlyIfDataAvailable = true;
            DatabaseInfo dbinfo = new DatabaseInfo();
            dbinfo.Report = rep;
            rep.GenerateNewName(dbinfo);
            dbinfo.Alias = "CONN";
            dbinfo.ConfigFile = "config.ini";
            dbinfo.LoadParams = false;
            dbinfo.ConnectionString = "Data Source=x";
            rep.DatabaseInfo.Add(dbinfo);
            DataInfo dinfo = new DataInfo();
            dinfo.Report = rep;
            rep.GenerateNewName(dinfo);
            dinfo.Alias = "DATA";
            dinfo.DatabaseAlias = "CONN";
            dinfo.SQL = "SELECT 1";
            dinfo.SQLExplanation = "EXPLANATION";
            dinfo.SQLExplanationError = "EXPLANATION ERROR";
            dinfo.HubSchemaId = 42;
            rep.DataInfo.Add(dinfo);
            Param param = AddParam(rep, "PARAM", ParamType.Integer, 7);
            param.Items.Add("one");
            param.Values.Add("1");
            return rep;
        }

        private static void TestDeleteRestoresProperties(SelfTestLog log)
        {
            Report model = BuildFullReport();
            var names = new List<string>();
            foreach (SubReport sub in model.SubReports)
            {
                if (sub != model.SubReports[0])
                    names.Add(sub.Name);
                foreach (Section sec in sub.Sections)
                {
                    if (sec.SectionType != SectionType.Detail)
                        names.Add(sec.Name);
                    foreach (PrintPosItem item in sec.Components)
                        names.Add(item.Name);
                }
            }
            names.Add(model.DatabaseInfo[0].Name);
            names.Add(model.DataInfo[0].Name);
            names.Add(model.Params[0].Name);
            foreach (string name in names)
            {
                // Deleted from the structure tree / data definitions (BaseReport.DeleteItem)
                Report rep = BuildFullReport();
                string xmlBefore = SaveXml(rep);
                rep.DeleteItem(rep.Components[name], rep.UndoCue.GetGroupId());
                log.Check(SaveXml(rep) != xmlBefore, name + ": not deleted");
                Report saved = ReloadWithHistory(rep);
                rep.UndoCue.Undo(rep);
                log.Check(SaveXml(rep) == xmlBefore, name + ": undo of the delete does not restore the report");
                rep.UndoCue.Redo(rep);
                rep.UndoCue.Undo(rep);
                log.Check(SaveXml(rep) == xmlBefore, name + ": undo after redo does not restore the report");
                saved.UndoCue.Undo(saved);
                log.Check(SaveXml(saved) == xmlBefore, name + ": undo from a saved history does not restore the report");
            }
            foreach (string name in names)
            {
                Report rep = BuildFullReport();
                PrintPosItem item = rep.Components[name] as PrintPosItem;
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
                rep.UndoCue.AddOperation(op, rep);
                item.Section.Components.Remove(item);
                rep.RemoveComponent(item);
                Report saved = ReloadWithHistory(rep);
                rep.UndoCue.Undo(rep);
                log.Check(SaveXml(rep) == xmlBefore, name + ": undo of a designer delete does not restore the report");
                saved.UndoCue.Undo(saved);
                log.Check(SaveXml(saved) == xmlBefore, name + ": undo of a designer delete from a saved history does not restore the report");
            }
        }

        private static void TestExpressionPageCount(SelfTestLog log)
        {
            Report rep = NewUndoReport();
            Section sec = Detail(rep);
            ExpressionItem expression = AddItem(rep, sec, new ExpressionItem());
            expression.Expression = "PAGECOUNT";
            string name = expression.Name;
            rep.DeleteItem(expression, rep.UndoCue.GetGroupId());
            rep.UndoCue.Undo(rep);
            ExpressionItem restored = rep.Components[name] as ExpressionItem;
            log.Check(restored != null && restored.IsPageCount, "PAGECOUNT flag lost undoing a delete");
            if (restored == null)
                return;
            ChangeObjectOperation op = new ChangeObjectOperation(OperationType.Modify, rep.UndoCue.GetGroupId());
            op.ComponentName = name;
            op.ComponentClass = "TRPEXPRESSION";
            op.AddProperty("expression", PropertyType.String, "PAGECOUNT", "1");
            restored.Expression = "1";
            rep.UndoCue.AddOperation(op, rep);
            rep.UndoCue.Undo(rep);
            log.Check(restored.IsPageCount, "PAGECOUNT flag lost undoing an expression change");
            rep.UndoCue.Redo(rep);
            log.Check(!restored.IsPageCount, "PAGECOUNT flag kept redoing an expression change");
        }

        private static PrintPosItem FindFirstPrintItem(Report rep)
        {
            foreach (SubReport sub in rep.SubReports)
                foreach (Section sec in sub.Sections)
                    if (sec.Components != null && sec.Components.Count > 0)
                        return sec.Components[0];
            return null;
        }
    }
}
