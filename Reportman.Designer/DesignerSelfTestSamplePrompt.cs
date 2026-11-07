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
using System.IO;
using System.Text;

namespace Reportman.Designer
{
    /// <summary>
    /// Headless checks (designer.exe /sampleprompttest) of the first try of the AI with a sample: the mode of the AI
    /// is Reasoning by default (a mode the user chose stays), the request the index of the samples suggests
    /// (key Prompt of samples.ini, in English) is read, and opening a sample as the welcome window does leaves it
    /// in the input box of the copilot, not sent.
    /// </summary>
    public static class DesignerSelfTestSamplePrompt
    {
        private const string SamplePromptText =
            "Add the email of each customer to the dataset CUST and show it in the report as a new column after the phone";

        /// <summary>Runs the checks; the text of the results, <paramref name="failed"/> the checks that failed.</summary>
        /// <param name="samplesFolder">The samples folder (samples of the repository when empty).</param>
        /// <param name="failed">The number of checks that failed.</param>
        public static string Run(string samplesFolder, out int failed)
        {
            var text = new StringBuilder();
            int passed = 0;
            int fails = 0;
            Action<bool, string> check = (ok, what) =>
            {
                if (ok)
                    passed++;
                else
                    fails++;
                string line = (ok ? "[OK] " : "[FAIL] ") + what;
                text.AppendLine(line);
                Console.WriteLine(line);
            };
            Action<string> line2 = s =>
            {
                text.AppendLine(s);
                Console.WriteLine(s);
            };

            line2("--- The mode of the AI by default");
            using (var selection = new AISelectionControl())
            {
                check(selection.SelectedMode == "Reasoning", "the AI selection starts in Reasoning");
                selection.SelectedMode = "Fast";
                check(selection.SelectedMode == "Fast", "a mode the user chooses stays");
            }
            check(new LocalSchemaAnalysisSettings().Mode == "Reasoning",
                "the analysis of a local schema without a previous choice: Reasoning");

            line2("--- The request of a sample in the index (key Prompt)");
            string temp = Path.Combine(Path.GetTempPath(), "rm_sampleprompt_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(temp);
            try
            {
                File.WriteAllText(Path.Combine(temp, "a.rep"), "");
                File.WriteAllText(Path.Combine(temp, "b.rep"), "");
                File.WriteAllText(Path.Combine(temp, SampleReports.IndexFileName),
                    "[a.rep]\r\nTitle=A\r\nPrompt=" + SamplePromptText + "\r\nPrompt.es=No se usa\r\n\r\n" +
                    "[b.rep]\r\nTitle=B\r\n", new UTF8Encoding(false));
                var samples = SampleReports.Load(temp);
                check(samples.Count == 2, "the two samples of the index");
                if (samples.Count == 2)
                {
                    check(samples[0].Prompt == SamplePromptText, "the request of the sample, in English");
                    check(samples[1].Prompt == "", "a sample without one: empty");
                }
            }
            finally
            {
                try { Directory.Delete(temp, true); } catch { }
            }

            line2("--- Opening a sample as the welcome window does");
            if (string.IsNullOrEmpty(samplesFolder))
                samplesFolder = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,
                    "..", "..", "..", "..", "samples"));
            string source = Path.Combine(samplesFolder, "customers.rep");
            check(File.Exists(source), "the sample " + source);
            if (File.Exists(source))
            {
                // A working copy with its database, as the welcome window opens it
                string working = Path.Combine(Path.GetTempPath(), "rm_sampleprompt_" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(working);
                try
                {
                    File.Copy(source, Path.Combine(working, "customers.rep"));
                    File.Copy(Path.Combine(samplesFolder, "samples.db"), Path.Combine(working, "samples.db"));
                    using (var frame = new FrameMainDesigner())
                    {
                        frame.OpenSample(Path.Combine(working, "customers.rep"), SamplePromptText);
                        check(frame.AIChatPromptText == SamplePromptText,
                            "the input box of the copilot has the request of the sample");
                    }
                    using (var frame = new FrameMainDesigner())
                    {
                        frame.OpenSample(Path.Combine(working, "customers.rep"), "");
                        check(frame.AIChatPromptText == "", "a sample without a request: the input box stays empty");
                    }
                }
                finally
                {
                    try { Directory.Delete(working, true); } catch { }
                }
            }

            line2("RESULT: " + (fails == 0 ? "OK" : fails + " FAILED") + " (" + passed + " passed)");
            failed = fails;
            return text.ToString();
        }
    }
}
