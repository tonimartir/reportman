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

using Reportman.Reporting;
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace Reportman.Designer
{
    /// <summary>
    /// Headless checks (designer.exe /sampleprompttest) of the first try of the AI with a sample: the mode of the AI
    /// is Reasoning by default (a mode the user chose stays), the request the index of the samples suggests
    /// (key Prompt of samples.ini, in English) is read, opening a sample as the welcome window does leaves it in the
    /// input box of the copilot, not sent, and an installed local schema of the samples is brought up to date
    /// (<see cref="SampleReports.UpgradeSchema"/>). Only copies are written, never the dbxschemas of the computer.
    /// </summary>
    public static class DesignerSelfTestSamplePrompt
    {
        private const string TestPromptText = "Add the email of each customer to the dataset CUST";

        /// <summary>Runs the checks; the text of the results, <paramref name="failed"/> the checks that failed.</summary>
        /// <param name="samplesFolder">The samples folder (samples of the repository when empty).</param>
        /// <param name="oldSchema">A SAMPLES.json as it was installed before 07-11-2026 (empty: those checks are skipped).</param>
        /// <param name="installedSchema">The SAMPLES.json installed on this computer, to try a copy of it (empty: skipped).</param>
        /// <param name="failed">The number of checks that failed.</param>
        public static string Run(string samplesFolder, string oldSchema, string installedSchema, out int failed)
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
            Action<string> log = s =>
            {
                text.AppendLine(s);
                Console.WriteLine(s);
            };
            if (string.IsNullOrEmpty(samplesFolder))
                samplesFolder = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,
                    "..", "..", "..", "..", "samples"));

            log("--- The mode of the AI by default");
            using (var selection = new AISelectionControl())
            {
                check(selection.SelectedMode == "Reasoning", "the AI selection starts in Reasoning");
                selection.SelectedMode = "Fast";
                check(selection.SelectedMode == "Fast", "a mode the user chooses stays");
            }
            check(new LocalSchemaAnalysisSettings().Mode == "Reasoning",
                "the analysis of a local schema without a previous choice: Reasoning");

            string temp = Path.Combine(Path.GetTempPath(), "rm_sampleprompt_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(temp);
            try
            {
                log("--- The request of a sample in the index (key Prompt)");
                string index = Path.Combine(temp, "index");
                Directory.CreateDirectory(index);
                File.WriteAllText(Path.Combine(index, "a.rep"), "");
                File.WriteAllText(Path.Combine(index, "b.rep"), "");
                File.WriteAllText(Path.Combine(index, SampleReports.IndexFileName),
                    "[a.rep]\r\nTitle=A\r\nPrompt=" + TestPromptText + "\r\nPrompt.es=No se usa\r\n\r\n" +
                    "[b.rep]\r\nTitle=B\r\n", new UTF8Encoding(false));
                List<SampleReportInfo> samples = SampleReports.Load(index);
                check(samples.Count == 2, "the two samples of the index");
                if (samples.Count == 2)
                {
                    check(samples[0].Prompt == TestPromptText, "the request of the sample, in English");
                    check(samples[1].Prompt == "", "a sample without one: empty");
                }

                log("--- The samples of " + samplesFolder);
                samples = SampleReports.Load(samplesFolder);
                check(samples.Count == 9, "the nine samples of samples.ini");
                string customersPrompt = "";
                foreach (SampleReportInfo sample in samples)
                {
                    log("  " + sample.FileName + ": " + sample.Prompt);
                    check(sample.Prompt.Length > 0, sample.FileName + " has its request to the copilot");
                    if (string.Equals(sample.FileName, "customers.rep", StringComparison.OrdinalIgnoreCase))
                        customersPrompt = sample.Prompt;
                }

                log("--- Opening a sample as the welcome window does");
                string source = Path.Combine(samplesFolder, "customers.rep");
                check(File.Exists(source) && customersPrompt.Length > 0, "the sample customers.rep and its request");
                if (File.Exists(source) && customersPrompt.Length > 0)
                {
                    // A working copy with its database, as the welcome window opens it
                    string working = Path.Combine(temp, "working");
                    Directory.CreateDirectory(working);
                    File.Copy(source, Path.Combine(working, "customers.rep"));
                    File.Copy(Path.Combine(samplesFolder, "samples.db"), Path.Combine(working, "samples.db"));
                    using (var frame = new FrameMainDesigner())
                    {
                        frame.OpenSample(Path.Combine(working, "customers.rep"), customersPrompt);
                        check(frame.AIChatPromptText == customersPrompt,
                            "the input box of the copilot has the request of the sample");
                    }
                    using (var frame = new FrameMainDesigner())
                    {
                        frame.OpenSample(Path.Combine(working, "customers.rep"), "");
                        check(frame.AIChatPromptText == "", "a sample without a request: the input box stays empty");
                    }
                }

                log("--- The local schema of the samples installed before (SampleReports.UpgradeSchema)");
                string shipped = Path.Combine(samplesFolder, LocalSchemaStore.FolderName, SampleReports.ConnectionAlias + ".json");
                LocalSubschema fishes = FishesOf(LocalSchemaStore.Load(shipped));
                check(fishes != null && fishes.Description == SampleReports.NewFishesDescription && HasGraphic(fishes),
                    "the schema shipped now: Fishes with GRAPHIC");
                string copy = Path.Combine(temp, "shipped.json");
                File.Copy(shipped, copy);
                string before = File.ReadAllText(copy);
                check(!SampleReports.UpgradeSchema(copy) && File.ReadAllText(copy) == before,
                    "the schema shipped now: nothing to do");

                if (!string.IsNullOrEmpty(oldSchema) && File.Exists(oldSchema))
                {
                    copy = Path.Combine(temp, "old.json");
                    File.Copy(oldSchema, copy);
                    fishes = FishesOf(LocalSchemaStore.Load(copy));
                    check(fishes != null && fishes.Description == SampleReports.OldFishesDescription && !HasGraphic(fishes),
                        "the schema installed before: Fishes without GRAPHIC");
                    check(SampleReports.UpgradeSchema(copy), "it is brought up to date");
                    fishes = FishesOf(LocalSchemaStore.Load(copy));
                    check(fishes != null && fishes.Description == SampleReports.NewFishesDescription && HasGraphic(fishes),
                        "Fishes with GRAPHIC and its new description");
                    before = File.ReadAllText(copy);
                    check(!SampleReports.UpgradeSchema(copy) && File.ReadAllText(copy) == before,
                        "a second time: nothing to do");

                    // A subschema Fishes the user changed is left alone
                    copy = Path.Combine(temp, "changed.json");
                    File.Copy(oldSchema, copy);
                    LocalSchemaFile changed = LocalSchemaStore.Load(copy);
                    FishesOf(changed).Description = "My fishes";
                    LocalSchemaStore.Save(changed, copy);
                    before = File.ReadAllText(copy);
                    check(!SampleReports.UpgradeSchema(copy) && File.ReadAllText(copy) == before,
                        "a Fishes the user changed is left alone");
                }
                else
                    log("SKIPPED: the schema installed before (/oldschema)");

                if (!string.IsNullOrEmpty(installedSchema) && File.Exists(installedSchema))
                {
                    // A copy of the one of this computer: the old one comes up to date, any other stays
                    copy = Path.Combine(temp, "installed.json");
                    File.Copy(installedSchema, copy);
                    fishes = FishesOf(LocalSchemaStore.Load(copy));
                    bool wasOld = fishes != null && fishes.Description == SampleReports.OldFishesDescription &&
                        !HasGraphic(fishes);
                    before = File.ReadAllText(copy);
                    bool upgraded = SampleReports.UpgradeSchema(copy);
                    log("  the copy of " + installedSchema + ": " +
                        (wasOld ? "as installed before" : "already up to date or changed"));
                    if (wasOld)
                    {
                        fishes = FishesOf(LocalSchemaStore.Load(copy));
                        check(upgraded && fishes.Description == SampleReports.NewFishesDescription && HasGraphic(fishes),
                            "the copy of the installed schema is brought up to date");
                    }
                    else
                        check(!upgraded && File.ReadAllText(copy) == before, "the copy of the installed schema stays");
                    before = File.ReadAllText(copy);
                    check(!SampleReports.UpgradeSchema(copy) && File.ReadAllText(copy) == before,
                        "the copy of the installed schema, a second time: nothing to do");
                }
                else
                    log("SKIPPED: the schema installed on this computer (/installedschema)");
            }
            finally
            {
                try { Directory.Delete(temp, true); } catch { }
            }

            log("RESULT: " + (fails == 0 ? "OK" : fails + " FAILED") + " (" + passed + " passed)");
            failed = fails;
            return text.ToString();
        }

        private static LocalSubschema FishesOf(LocalSchemaFile file)
        {
            if (file == null)
                return null;
            foreach (LocalSubschema schema in file.Schemas)
                if (string.Equals(schema.Name, "Fishes", StringComparison.OrdinalIgnoreCase))
                    return schema;
            return null;
        }

        private static bool HasGraphic(LocalSubschema schema)
        {
            if (schema == null || schema.Columns == null)
                return false;
            foreach (KeyValuePair<string, List<string>> pair in schema.Columns)
                if (string.Equals(pair.Key, "FISHES", StringComparison.OrdinalIgnoreCase))
                    return pair.Value.Exists(c => string.Equals(c, "GRAPHIC", StringComparison.OrdinalIgnoreCase));
            return false;
        }
    }
}
