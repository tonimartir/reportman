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
            return sb.ToString();
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
