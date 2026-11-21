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
                        }
                        form.Close();
                    }
                }
            }
            catch (Exception ex)
            {
                check(false, "unexpected " + ex.GetType().Name + ": " + ex.Message);
            }
            finally
            {
                try { Directory.Delete(temp, true); } catch { /* a file still open: left in the temporary folder */ }
            }
            log(fails == 0 ? "All the checks passed." : fails + " check(s) failed.");
            failed = fails;
            return text.ToString();
        }
    }
}
