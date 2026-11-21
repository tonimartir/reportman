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
using Reportman.Reporting;
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Text;
using System.Windows.Forms;

namespace Reportman.Designer
{
    /// <summary>
    /// Headless checks (designer.exe /uniontest) of the samples with unions of datasets: each one is opened as the
    /// welcome window opens it (a working copy next to samples.db) and previewed as the Preview button does
    /// (<see cref="FrameMainDesigner.PrintReport"/>), and its pages have the rows of the unions: contacts.rep (a union
    /// of two datasets) and year-over-year.rep (parallel unions, by a common field and by position). Run it on a
    /// desktop the user does not see: the designer window is shown to preview.
    /// </summary>
    public static class DesignerSelfTestUnions
    {
        /// <summary>Runs the checks; the text of the results, <paramref name="failed"/> the checks that failed.</summary>
        /// <param name="samplesFolder">The samples folder (samples of the repository when empty).</param>
        /// <param name="shotsFolder">A folder for a picture of each preview (empty: none).</param>
        /// <param name="failed">The number of checks that failed.</param>
        public static string Run(string samplesFolder, string shotsFolder, out int failed)
        {
            var text = new StringBuilder();
            int fails = 0;
            Action<bool, string> check = (ok, what) =>
            {
                if (!ok)
                    fails++;
                string line = (ok ? "[OK] " : "[FAIL] ") + what;
                text.AppendLine(line);
                Console.WriteLine(line);
            };
            Action<string> log = s =>
            {
                text.AppendLine(s);
                Console.WriteLine(s);
            };
            if (string.IsNullOrEmpty(samplesFolder))
                samplesFolder = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,
                    "..", "..", "..", "..", "samples"));
            if (!string.IsNullOrEmpty(shotsFolder))
                Directory.CreateDirectory(shotsFolder);

            // The texts every preview must have: rows of each dataset of the unions (no numbers that depend on
            // the culture)
            var cases = new List<KeyValuePair<string, string[]>>
            {
                new KeyValuePair<string, string[]>("contacts.rep", new[]
                {
                    "Customers", "Employees", "Alba Pereira", "Valentina Martin", "Laura Navarro", "Ext. 101",
                    "Sales Manager", "Total contacts", "63", "70"
                }),
                new KeyValuePair<string, string[]>("year-over-year.rep", new[]
                {
                    "Sales by category", "Cheese & Dairy", "Wines & Beverages", "853", "851", "148",
                    "The ten best sold products", "Hojiblanca Olive Oil Tin", "Albarino Rias Baixas", "Cava Brut Nature"
                })
            };

            string temp = Path.Combine(Path.GetTempPath(), "rm_uniontest_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(temp);
            try
            {
                File.Copy(Path.Combine(samplesFolder, "samples.db"), Path.Combine(temp, "samples.db"));
                foreach (KeyValuePair<string, string[]> sample in cases)
                {
                    log("--- " + sample.Key);
                    string source = Path.Combine(samplesFolder, sample.Key);
                    check(File.Exists(source), "the sample " + source);
                    if (!File.Exists(source))
                        continue;
                    string working = Path.Combine(temp, sample.Key);
                    File.Copy(source, working);
                    using (var form = new Form())
                    {
                        form.StartPosition = FormStartPosition.Manual;
                        form.Location = new Point(0, 0);
                        form.Size = new Size(1280, 960);
                        using (var frame = new FrameMainDesigner())
                        {
                            frame.Dock = DockStyle.Fill;
                            form.Controls.Add(frame);
                            form.Show();
                            Application.DoEvents();
                            frame.OpenSample(working, "");
                            Application.DoEvents();
                            string error = "";
                            try
                            {
                                frame.PrintReport(true);
                                Application.DoEvents();
                            }
                            catch (Exception ex)
                            {
                                error = ex.GetType().Name + ": " + ex.Message;
                            }
                            check(error.Length == 0, "the preview runs" + (error.Length > 0 ? " (" + error + ")" : ""));
                            Report printed = frame.PreviewedReport;
                            check(printed != null, "the preview printed the report");
                            if (printed == null || error.Length > 0)
                                continue;
                            MetaFile meta = printed.MetaFile;
                            meta.RequestPage(MetaFile.MAX_NUMBER_PAGES);
                            var texts = new StringBuilder();
                            for (int i = 0; i < meta.Pages.Count; i++)
                            {
                                MetaPage page = meta.Pages[i];
                                for (int j = 0; j < page.Objects.Count; j++)
                                {
                                    if (page.Objects[j].MetaType == MetaObjectType.Text)
                                        texts.Append(page.GetText((MetaObjectText)page.Objects[j])).Append('\n');
                                }
                            }
                            log("  pages: " + meta.Pages.Count);
                            check(meta.Pages.Count == 2, "two pages");
                            string all = "\n" + texts.ToString();
                            foreach (string expected in sample.Value)
                                check(all.Contains("\n" + expected + "\n"), "the page has \"" + expected + "\"");
                            if (!string.IsNullOrEmpty(shotsFolder))
                            {
                                using (var bmp = new Bitmap(form.Width, form.Height))
                                {
                                    form.DrawToBitmap(bmp, new Rectangle(0, 0, bmp.Width, bmp.Height));
                                    bmp.Save(Path.Combine(shotsFolder, Path.GetFileNameWithoutExtension(sample.Key) + ".png"),
                                        System.Drawing.Imaging.ImageFormat.Png);
                                }
                            }
                            if (sample.Key == "year-over-year.rep")
                                CheckEditing(frame, shotsFolder, check, log);
                        }
                        form.Close();
                    }
                }
            }
            catch (Exception ex)
            {
                check(false, "unexpected " + ex.GetType().Name + ": " + ex.Message + Environment.NewLine + ex.StackTrace);
            }
            finally
            {
                try { Directory.Delete(temp, true); } catch { /* a file still open: left in the temporary folder */ }
            }
            log(fails == 0 ? "All the checks passed." : fails + " check(s) failed.");
            failed = fails;
            return text.ToString();
        }

        private static List<string> PropertyNames(DesignerInterface item, out Variants values)
        {
            var names = new Strings();
            values = new Variants();
            item.GetProperties(names, new Strings(), values, new Strings(), new Strings());
            var list = new List<string>();
            foreach (string name in names)
                list.Add(name);
            return list;
        }

        // The inspector rows of a union, the dialog of the unions and the undo of its changes
        private static void CheckEditing(FrameMainDesigner frame, string shotsFolder, Action<bool, string> check, Action<string> log)
        {
            Report report = frame.Report;
            log("--- Editing the unions of year-over-year.rep");
            string unions = Translator.TranslateStr(1083);
            DataInfo byCategory = report.DataInfo["BY_CATEGORY"];
            DataInfo categoryFirst = report.DataInfo["CATEGORY_FIRST"];
            var selection = new SortedList<int, ReportItem> { { 0, byCategory } };
            var union = new DesignerInterfaceDataInfo(selection, null);
            Variants values;
            List<string> names = PropertyNames(union, out values);
            check(union.IsMyBase, "BY_CATEGORY is a dataset of the MyBase connection");
            check(!names.Contains("SQL"), "its inspector has no SQL");
            int index = names.IndexOf(unions);
            check(index >= 0 && values[index].ToString() == "CATEGORY_FIRST-CATEGORY, CATEGORY_SECOND-CATEGORY",
                "its unions: " + (index >= 0 ? values[index].ToString() : "none"));
            index = names.IndexOf(Translator.TranslateStr(1440));
            check(index >= 0 && (bool)values[index], "it is a parallel union");
            check(names.Contains(Translator.TranslateStr(164)) && names.Contains(Translator.TranslateStr(165)),
                "the index fields and the master fields");
            var sqlSelection = new SortedList<int, ReportItem> { { 0, categoryFirst } };
            List<string> sqlNames = PropertyNames(new DesignerInterfaceDataInfo(sqlSelection, null), out values);
            check(sqlNames.Contains("SQL") && !sqlNames.Contains(unions), "CATEGORY_FIRST (SQL) has its SQL and no unions");

            // Typing the unions in the inspector cell
            union.SetProperty(unions, "CATEGORY_FIRST-CATEGORY , CATEGORY_SECOND-CATEGORY,");
            check(byCategory.DataUnions.Count == 2 && byCategory.DataUnions[1] == "CATEGORY_SECOND-CATEGORY",
                "the unions typed in the cell, separated by commas");

            // The dialog
            using (var dialog = new UnionsEditorForm(report.DataInfo["TOP_PRODUCTS"]))
            {
                dialog.StartPosition = FormStartPosition.Manual;
                dialog.Location = new Point(0, 0);
                dialog.Show();
                Application.DoEvents();
                check(dialog.ColumnsText.EndsWith(": PRODUCT, SALES, Q02_, Q02_PRODUCT, Q02_SALES"),
                    "the columns of TOP_PRODUCTS (by position): " + dialog.ColumnsText);
                dialog.SelectEntry(0);
                dialog.SetFieldsOfSelected("PRODUCT", true);
                check(dialog.Settings.Validate() != null, "common fields only in the first dataset: refused");
                dialog.SelectEntry(1);
                dialog.SetFieldsOfSelected("PRODUCT", true);
                check(dialog.Settings.Validate() == null, "the same number of common fields: accepted");
                check(dialog.ColumnsText.EndsWith(": PRODUCT, SALES, Q02_, Q02_SALES"),
                    "the columns matched by PRODUCT: " + dialog.ColumnsText);
                dialog.Settings.Group = true;
                check(dialog.Settings.Validate() != null, "a grouped union without index fields: refused");
                dialog.Settings.Group = false;
                dialog.AddDataset("CATEGORY_FIRST");
                check(dialog.Settings.Entries.Count == 3 && dialog.Settings.Entries[2] == "CATEGORY_FIRST",
                    "a dataset added at the end");
                if (!string.IsNullOrEmpty(shotsFolder))
                {
                    using (var bmp = new Bitmap(dialog.Width, dialog.Height))
                    {
                        dialog.DrawToBitmap(bmp, new Rectangle(0, 0, bmp.Width, bmp.Height));
                        bmp.Save(Path.Combine(shotsFolder, "unions-dialog.png"), System.Drawing.Imaging.ImageFormat.Png);
                    }
                }

                // Applied as the inspector does, one undo step, and undone
                DataInfo topProducts = report.DataInfo["TOP_PRODUCTS"];
                string before = UnionSettings.Summary(topProducts);
                FrameMainDesigner.UndoItemState state = FrameMainDesigner.CaptureUndoState(topProducts);
                dialog.Settings.ApplyTo(topProducts);
                int groupId = 0;
                FrameMainDesigner.AddUndoChanges(report, state, ref groupId);
                check(UnionSettings.Summary(topProducts) == "TOP_FIRST-PRODUCT, TOP_SECOND-PRODUCT, CATEGORY_FIRST",
                    "the dialog applied: " + UnionSettings.Summary(topProducts));
                report.UndoCue.Undo(report);
                check(UnionSettings.Summary(topProducts) == before && topProducts.ParallelUnion,
                    "undone in one step: " + UnionSettings.Summary(topProducts));

                // The same through an object inspector (what the ellipsis of the cell runs)
                // The object inspector of the designer
                ObjectInspector inspector = frame.PropertyInspector;
                check(inspector != null, "the object inspector of the designer");
                var topSelection = new SortedList<int, ReportItem> { { 1, topProducts } };
                DesignerInterface topInterface = DesignerInterface.GetFromOject(topSelection, inspector);
                check(topInterface is DesignerInterfaceDataInfo, "the inspector interface of TOP_PRODUCTS");
                inspector.SetObject(topInterface);
                Application.DoEvents();
                Form host = frame.FindForm();
                if (!string.IsNullOrEmpty(shotsFolder) && host != null)
                {
                    using (var bmp = new Bitmap(host.Width, host.Height))
                    {
                        host.DrawToBitmap(bmp, new Rectangle(0, 0, bmp.Width, bmp.Height));
                        bmp.Save(Path.Combine(shotsFolder, "unions-inspector.png"), System.Drawing.Imaging.ImageFormat.Png);
                    }
                }
                int operations = report.UndoCue.UndoOperations.Count;
                UnionSettings settings = dialog.Settings;
                inspector.ApplyWithUndo(unions, delegate { settings.ApplyTo(topProducts); });
                check(report.UndoCue.UndoOperations.Count == operations + 1 && topProducts.DataUnions.Count == 3,
                    "the inspector applies the dialog as one undo operation");
                report.UndoCue.Undo(report);
                check(UnionSettings.Summary(topProducts) == before, "and it is undone: " + UnionSettings.Summary(topProducts));
                dialog.Close();
            }
        }
    }
}
