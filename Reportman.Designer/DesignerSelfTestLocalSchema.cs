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
using System.Data.Common;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Windows.Forms;

namespace Reportman.Designer
{
    /// <summary>
    /// Headless checks of the import of local schemas (invoked from designer.exe /localschematest), with the fixtures
    /// the Delphi designer and the web test too (tests\local_schema_file): the schemas of the Reportman AI library whose
    /// table names are qualified (<c>[{DB_NAME}].dbo.OINV</c>) or templates for the AI (<c>[{COMPANY_NAME}$Customer]</c>),
    /// the values of their placeholders, how much of each schema a database has and the one detected for it, and the
    /// import of names that are in the database as they are, which works as it did. And the word filter of the lists,
    /// a large catalog (the names first, the columns of a table when it is used, with a SQLite database of eight tables
    /// and the threshold at five) and the lists that paint only what they show.
    /// </summary>
    public static class DesignerSelfTestLocalSchema
    {
        private const string Cronus = "CRONUS España S_A_";
        private const string Other = "Otra Empresa";

        // The old Desktop: PascalCase and numeric data types; a table and two columns that are not in the database
        private const string DesktopFile =
            "{\"Name\":\"Desktop\",\"SchemaTables\":[" +
            "{\"Name\":\"sales\",\"Context\":\"Sales of the old Desktop\",\"Columns\":[" +
            "{\"Name\":\"saleid\",\"DataType\":1,\"Context\":\"\",\"IsPrimaryKey\":true}," +
            "{\"Name\":\"Total\",\"DataType\":3,\"Context\":\"Total amount\",\"IsPrimaryKey\":false,\"AllowedValues\":[]}," +
            "{\"Name\":\"DISCOUNT\",\"DataType\":2}]," +
            "\"ForeignKeys\":[{\"ConstraintName\":\"FK_SALES_CUSTOMER\",\"TargetTable\":\"customers\"," +
            "\"SourceColumns\":[\"CUSTOMERID\"],\"TargetColumns\":[\"CUSTOMERID\"],\"RelationshipContext\":\"From the Desktop\"}]}," +
            "{\"Name\":\"GONE\",\"Columns\":[{\"Name\":\"ID\",\"DataType\":1}]}," +
            "{\"Name\":\"products\",\"Columns\":[{\"Name\":\"PRICE\",\"DataType\":3}]}," +
            "{\"Name\":\"CUSTOMERS\",\"Columns\":[{\"Name\":\"STATE\",\"DataType\":4," +
            "\"AllowedValues\":[{\"Value\":\"X\",\"Label\":\"Closed\"},{\"Value\":\"\",\"Label\":\"\"}]}]}]}";

        // The lines of a BC invoice and their relation to the header, both templates
        private const string LinesFile =
            "{\"name\":\"Lines\",\"schemaTables\":[{\"name\":\"[{COMPANY_NAME}$Sales Invoice Line]\"," +
            "\"columns\":[{\"name\":\"Document No_\"}],\"foreignKeys\":[{\"targetTable\":\"[{COMPANY_NAME}$Sales Invoice Header]\"," +
            "\"sourceColumns\":[\"Document No_\"],\"targetColumns\":[\"No_\"],\"relationshipContext\":\"Its header\"}]}]}";

        /// <summary>
        /// Runs the checks. Returns one line per failed or skipped check and a summary line
        /// ("LOCALSCHEMA: n passed, m failed").
        /// </summary>
        /// <param name="folder">The folder of the fixtures (tests\local_schema_file); null or empty to look for it
        /// above the program.</param>
        /// <param name="failed">The number of failed checks.</param>
        public static string RunLocalSchemaTests(string folder, out int failed)
        {
            var log = new LocalSchemaLog();
            if (string.IsNullOrEmpty(folder))
                folder = FindFixtures();
            if (string.IsNullOrEmpty(folder) || !File.Exists(Path.Combine(folder, "library", "dbxschemas-library.json")))
            {
                log.Start("fixtures");
                log.Check(false, "tests\\local_schema_file\\library not found");
                failed = log.Failed;
                return log.ToString();
            }
            RunCheck(log, "library 1: the placeholders of BC", f => TestPlaceholdersBc(f, folder));
            RunCheck(log, "library 2: BC without values", f => TestImportBc(f, folder));
            RunCheck(log, "library 3: BC with Otra Empresa", f => TestImportBcOther(f, folder));
            RunCheck(log, "library 4: B1, qualified names", f => TestImportB1(f, folder));
            RunCheck(log, "library 5: coverage, detected and best", f => TestCoverage(f, folder));
            RunCheck(log, "library: a table name resolved", f => TestResolve(f, folder));
            RunCheck(log, "library: relations between templates", f => TestRelations(f, folder));
            RunCheck(log, "library 6: exact names as before", f => TestExactNames(f, folder));
            RunCheck(log, "filter: the shared cases", TestFilter);
            RunCheck(log, "filter: case and accents", TestFold);
            RunCheck(log, "large catalog: the merge of the columns read", TestMergeColumns);
            RunCheck(log, "large catalog: an import reads its tables first", f => TestImportLargeCatalog(f, folder));
            RunCheck(log, "large catalog: a SQLite database, threshold 5", TestLargeCatalogDatabase);
            RunCheck(log, "lists: a hundred thousand tables", TestTableList);
            failed = log.Failed;
            return log.ToString();
        }

        private sealed class LocalSchemaLog
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
                return FText.ToString() + "LOCALSCHEMA: " + Passed.ToString() + " passed, " +
                    Failed.ToString() + " failed" + Environment.NewLine;
            }
        }

        private static void RunCheck(LocalSchemaLog log, string name, Action<LocalSchemaLog> test)
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

        private static string FindFixtures()
        {
            DirectoryInfo dir = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
            for (int i = 0; i < 8 && dir != null; i++)
            {
                string candidate = Path.Combine(dir.FullName, "tests", "local_schema_file");
                if (File.Exists(Path.Combine(candidate, "library", "dbxschemas-library.json")))
                    return candidate;
                dir = dir.Parent;
            }
            return null;
        }

        // A dictionary of its own for each import: an import writes descriptions and relations to it
        private static LocalSchemaFile LoadLibraryFile(string folder)
        {
            return LocalSchemaStore.Load(Path.Combine(folder, "library", "dbxschemas-library.json"));
        }

        private static string ReadLibrary(string folder, string name)
        {
            return File.ReadAllText(Path.Combine(folder, "library", name), Encoding.UTF8);
        }

        private static string Joined(IEnumerable<string> values)
        {
            return values == null ? "(null)" : string.Join("|", values);
        }

        private static string Columns(LocalSchemaFile file, LocalSubschema subschema, string table)
        {
            LocalSchemaTable t = LocalSchemaEditing.FindTable(file, table);
            return t == null ? "(no table " + table + ")" : Joined(LocalSchemaEditing.TravellingColumns(subschema, t));
        }

        private static string Values(LocalSchemaImportResult result)
        {
            var parts = new List<string>();
            foreach (KeyValuePair<string, string> value in result.TemplateValues)
                parts.Add(value.Key + "=" + value.Value);
            return Joined(parts);
        }

        private static Dictionary<string, string> Choice(string name, string value)
        {
            return new Dictionary<string, string> { { name, value } };
        }

        // 1. One placeholder, COMPANY_NAME: CRONUS finds 4 tables, Otra Empresa 2
        private static void TestPlaceholdersBc(LocalSchemaLog log, string folder)
        {
            LocalSchemaFile file = LoadLibraryFile(folder);
            List<LocalSchemaPlaceholder> placeholders = LocalSchemaEditing.LibraryPlaceholders(file, ReadLibrary(folder, "library-bc-invoices.json"));
            log.Check(placeholders.Count == 1, "one placeholder: " + placeholders.Count.ToString());
            if (placeholders.Count == 0)
                return;
            log.Check(placeholders[0].Name == "COMPANY_NAME", "named COMPANY_NAME: " + placeholders[0].Name);
            log.Check(Joined(placeholders[0].Values) == Cronus + "|" + Other,
                "its values, the one with more tables first: " + Joined(placeholders[0].Values));
            log.Check(LocalSchemaEditing.LibraryPlaceholders(file, "not json").Count == 0 &&
                LocalSchemaEditing.LibraryPlaceholders(file, "{\"tables\":[]}").Count == 0, "none when it is not a schema");
        }

        // 2. Without values: the first one, CRONUS, and every table of the schema
        private static void TestImportBc(LocalSchemaLog log, string folder)
        {
            LocalSchemaFile file = LoadLibraryFile(folder);
            int schemas = file.Schemas.Count;
            LocalSchemaImportResult result = LocalSchemaEditing.Import(file, ReadLibrary(folder, "library-bc-invoices.json"), "", null, "Invoices");
            log.Check(result != null && result.Subschema != null, "a subschema is created");
            if (result == null || result.Subschema == null)
                return;
            log.Check(result.Subschema.Name == "Invoices" && file.Schemas.Count == schemas + 1, "named as the library: " + result.Subschema.Name);
            log.Check(Joined(result.Subschema.Tables) == "Company|" + Cronus + "$Customer|" + Cronus + "$Item|" +
                Cronus + "$Sales Invoice Header|" + Cronus + "$Sales Invoice Line",
                "the 5 tables, as the catalog spells them: " + Joined(result.Subschema.Tables));
            log.Check(result.Skipped.Count == 0, "nothing skipped: " + Joined(result.Skipped));
            log.Check(Values(result) == "COMPANY_NAME=" + Cronus, "the value used: " + Values(result));
            log.Check(LocalSchemaEditing.TemplateValuesText(result.TemplateValues) == "{COMPANY_NAME} = " + Cronus,
                "the value used, for the message: " + LocalSchemaEditing.TemplateValuesText(result.TemplateValues));
            string lines = Columns(file, result.Subschema, Cronus + "$Sales Invoice Line");
            log.Check(lines == "Document No_|Type|No_|Quantity|Line Amount",
                "the columns of the lines in the catalog's order, not Line No_: " + lines);
            LocalSchemaTable customer = LocalSchemaEditing.FindTable(file, Cronus + "$Customer");
            log.Check(customer != null && customer.Context.StartsWith("Maestro de Clientes. Sustituye '{COMPANY_NAME}'", StringComparison.Ordinal),
                "the descriptions are not rewritten: " + (customer != null ? customer.Context : "(no table)"));
            log.Check(LocalSchemaEditing.FindColumn(customer, "Name") != null &&
                LocalSchemaEditing.FindColumn(customer, "Name").Context == "Nombre del cliente.",
                "the description of a column goes to the table found");
        }

        // 3. Otra Empresa: its two tables; the ones it does not have are said as the schema names them
        private static void TestImportBcOther(LocalSchemaLog log, string folder)
        {
            string bc = ReadLibrary(folder, "library-bc-invoices.json");
            foreach (string key in new[] { "COMPANY_NAME", "company_name" })
            {
                LocalSchemaFile file = LoadLibraryFile(folder);
                LocalSchemaImportResult result = LocalSchemaEditing.Import(file, bc, "", null, "Invoices", Choice(key, Other));
                log.Check(result != null && result.Subschema != null, key + ": a subschema is created");
                if (result == null || result.Subschema == null)
                    continue;
                log.Check(Joined(result.Subschema.Tables) == "Company|" + Other + "$Customer|" + Other + "$Item",
                    key + ": its 3 tables: " + Joined(result.Subschema.Tables));
                log.Check(Joined(result.Skipped) == "[{COMPANY_NAME}$Sales Invoice Header]|[{COMPANY_NAME}$Sales Invoice Line]",
                    key + ": skipped exactly the two it does not have: " + Joined(result.Skipped));
                log.Check(Values(result) == "COMPANY_NAME=" + Other, key + ": the value used: " + Values(result));
                log.Check(Columns(file, result.Subschema, Other + "$Customer") == "No_|Name",
                    key + ": the columns of its customers: " + Columns(file, result.Subschema, Other + "$Customer"));
            }
        }

        // 4. Business One: the qualifier dropped, no placeholders; Empresas is not here
        private static void TestImportB1(LocalSchemaLog log, string folder)
        {
            LocalSchemaFile file = LoadLibraryFile(folder);
            string b1 = ReadLibrary(folder, "library-b1-invoices.json");
            log.Check(LocalSchemaEditing.LibraryPlaceholders(file, b1).Count == 0, "no placeholders");
            LocalSchemaImportResult result = LocalSchemaEditing.Import(file, b1, "", null, "Invoices");
            log.Check(result != null && result.Subschema != null, "a subschema is created");
            if (result == null || result.Subschema == null)
                return;
            log.Check(Joined(result.Subschema.Tables) == "OINV|INV1", "OINV and INV1: " + Joined(result.Subschema.Tables));
            log.Check(Joined(result.Skipped) == "Empresas", "skipped Empresas only: " + Joined(result.Skipped));
            log.Check(result.TemplateValues.Count == 0, "no values used: " + Values(result));
            log.Check(Columns(file, result.Subschema, "INV1") == "DocEntry|ItemCode|Quantity|LineTotal",
                "the columns of INV1: " + Columns(file, result.Subschema, "INV1"));
        }

        private static LocalSchemaLibraryCategory Category(string name, string schema, LocalSchemaCoverage coverage)
        {
            var category = new LocalSchemaLibraryCategory { Name = name };
            category.Schemas.Add(new LocalSchemaLibrarySchema { Id = category.Schemas.Count + 1, Name = schema, Coverage = coverage });
            return category;
        }

        private static string Show(LocalSchemaCoverage coverage)
        {
            return coverage == null ? "(null)" : coverage.Matched.ToString() + " of " + coverage.Total.ToString() +
                (coverage.Detected ? ", detected" : "");
        }

        // 5. BC 5 of 5, B1 2 of 3 (detected), SAPINVOICE 2 of 6 (not detected); the best of the three, BC
        private static void TestCoverage(LocalSchemaLog log, string folder)
        {
            LocalSchemaFile file = LoadLibraryFile(folder);
            LocalSchemaCoverage bc = LocalSchemaEditing.LibraryCoverage(file, ReadLibrary(folder, "library-bc-invoices.json"));
            LocalSchemaCoverage b1 = LocalSchemaEditing.LibraryCoverage(file, ReadLibrary(folder, "library-b1-invoices.json"));
            LocalSchemaCoverage sap = LocalSchemaEditing.LibraryCoverage(file, ReadLibrary(folder, "library-sap-invoice.json"));
            log.Check(bc != null && bc.Matched == 5 && bc.Total == 5 && bc.Detected, "BC 5 of 5, detected: " + Show(bc));
            log.Check(b1 != null && b1.Matched == 2 && b1.Total == 3 && b1.Detected, "B1 2 of 3, detected: " + Show(b1));
            log.Check(sap != null && sap.Matched == 2 && sap.Total == 6 && !sap.Detected, "SAPINVOICE 2 of 6, not detected: " + Show(sap));
            log.Check(file.Schemas.Count == 0, "the coverage changes nothing");
            log.Check(LocalSchemaEditing.LibraryCoverage(file, "not json") == null &&
                LocalSchemaEditing.LibraryCoverage(file, "{\"tables\":[]}") == null, "none when it is not a schema");
            LocalSchemaCoverage twice = LocalSchemaEditing.LibraryCoverage(file,
                "{\"schemaTables\":[{\"name\":\"OINV\"},{\"name\":\"oinv\"},{\"name\":\"GONE\"}]}");
            log.Check(twice != null && twice.Matched == 1 && twice.Total == 2, "different names only: " + Show(twice));

            var library = new List<LocalSchemaLibraryCategory>
            {
                Category("Dynamics BC", "Invoices", bc),
                Category("SAP BO", "Invoices", b1),
                Category("SAP R3", "SAPINVOICE", sap)
            };
            LocalSchemaLibraryCategory category;
            LocalSchemaLibrarySchema best = LocalSchemaEditing.BestLibrarySchema(library, out category);
            log.Check(best != null && best == library[0].Schemas[0] && category == library[0],
                "the best of the three is BC: " + (category != null ? category.Name : "(none)"));

            // The rule of detection
            log.Check(new LocalSchemaCoverage(1, 1).Detected && !new LocalSchemaCoverage(1, 2).Detected &&
                !new LocalSchemaCoverage(2, 5).Detected && new LocalSchemaCoverage(2, 4).Detected &&
                !new LocalSchemaCoverage(0, 0).Detected && !new LocalSchemaCoverage(0, 1).Detected,
                "detected: two tables or more (or the only one), and at least half");
            // More tables first, then the larger part, then the library's order
            library = new List<LocalSchemaLibraryCategory>
            {
                Category("A", "3 of 6", new LocalSchemaCoverage(3, 6)),
                Category("B", "3 of 4", new LocalSchemaCoverage(3, 4)),
                Category("C", "3 of 4 again", new LocalSchemaCoverage(3, 4)),
                Category("D", "not read", null),
                Category("E", "1 of 8", new LocalSchemaCoverage(1, 8))
            };
            best = LocalSchemaEditing.BestLibrarySchema(library, out category);
            log.Check(best != null && best.Name == "3 of 4" && category == library[1],
                "the same tables: the larger part, the first of a tie: " + (best != null ? best.Name : "(none)"));
            library.Add(Category("F", "4 of 8", new LocalSchemaCoverage(4, 8)));
            best = LocalSchemaEditing.BestLibrarySchema(library, out category);
            log.Check(best != null && best.Name == "4 of 8", "more tables first: " + (best != null ? best.Name : "(none)"));
            library = new List<LocalSchemaLibraryCategory> { Category("E", "1 of 8", new LocalSchemaCoverage(1, 8)), Category("D", "not read", null) };
            best = LocalSchemaEditing.BestLibrarySchema(library, out category);
            log.Check(best == null && category == null, "none detected, none");
        }

        private static string Resolved(LocalSchemaFile file, string name, IDictionary<string, string> values)
        {
            LocalSchemaTable table = LocalSchemaEditing.ResolveTable(file, name, values);
            return table != null ? table.Name : "(none)";
        }

        // L1, one name at a time
        private static void TestResolve(LocalSchemaLog log, string folder)
        {
            LocalSchemaFile file = LoadLibraryFile(folder);
            log.Check(Resolved(file, " company ", null) == "Company", "exact, ignoring case and spaces");
            log.Check(Resolved(file, "[{DB_NAME}].dbo.OINV", null) == "OINV", "the last part: " + Resolved(file, "[{DB_NAME}].dbo.OINV", null));
            log.Check(Resolved(file, "dbo.\"inv1\"", null) == "INV1", "the last part, without its quotes");
            log.Check(Resolved(file, "[Server.One].[KNA1]", null) == "KNA1", "a dot inside brackets does not split");
            log.Check(Resolved(file, "[{COMPANY_NAME}$Item]", null) == Cronus + "$Item", "a template without a value: the first of the catalog");
            log.Check(Resolved(file, "[{COMPANY_NAME}$Item]", Choice("COMPANY_NAME", Other)) == Other + "$Item", "a template with its value");
            log.Check(Resolved(file, "[{COMPANY_NAME}$sales invoice line]", Choice("company_name", Cronus.ToLowerInvariant())) == Cronus + "$Sales Invoice Line",
                "a template with its value, ignoring case");
            log.Check(Resolved(file, "[{COMPANY_NAME}$Sales Invoice Line]", Choice("COMPANY_NAME", Other)) == "(none)",
                "a value without that table: none");
            log.Check(Resolved(file, "[{COMPANY_NAME}$Sales Invoice Line]", Choice("OTHER", Other)) == Cronus + "$Sales Invoice Line",
                "a value of another placeholder: as without values");
            log.Check(Resolved(file, "[{COMPANY_NAME}$Nothing]", null) == "(none)", "a template the catalog does not match: none");
            log.Check(Resolved(file, "{COMPANY_NAME}", null) == "Company", "a placeholder alone takes the whole name: the first table");
            log.Check(Resolved(file, "{COMPANY-NAME}$Item", null) == "(none)", "not a placeholder: a literal text");
            log.Check(Resolved(file, "GONE", null) == "(none)" && Resolved(file, "", null) == "(none)", "not there: none");
            // A placeholder written twice takes the same text both times (XY_ZW, first in the catalog, does not match)
            file.Tables.Add(new LocalSchemaTable { Name = "XY_ZW" });
            file.Tables.Add(new LocalSchemaTable { Name = "XY_XY" });
            log.Check(Resolved(file, "{P}_{P}", null) == "XY_XY", "a placeholder written twice, the same text: " + Resolved(file, "{P}_{P}", null));
        }

        // A relation whose target is a template: found as the tables are, with the same value
        private static void TestRelations(LocalSchemaLog log, string folder)
        {
            LocalSchemaFile file = LoadLibraryFile(folder);
            LocalSchemaImportResult result = LocalSchemaEditing.Import(file, LinesFile, "", null);
            log.Check(result != null && result.Subschema != null && Joined(result.Subschema.Tables) == Cronus + "$Sales Invoice Line",
                "the lines of CRONUS: " + (result != null && result.Subschema != null ? Joined(result.Subschema.Tables) : "(none)"));
            LocalSchemaTable lines = LocalSchemaEditing.FindTable(file, Cronus + "$Sales Invoice Line");
            LocalSchemaForeignKey fk = lines != null && lines.ForeignKeys.Count == 1 ? lines.ForeignKeys[0] : null;
            log.Check(fk != null && fk.TargetTable == Cronus + "$Sales Invoice Header" && Joined(fk.SourceColumns) == "Document No_" &&
                Joined(fk.TargetColumns) == "No_" && fk.RelationshipContext == "Its header" && fk.ConstraintName == "",
                "the relation to the header of CRONUS: " + (fk != null ? fk.TargetTable : "(none)"));

            file = LoadLibraryFile(folder);
            result = LocalSchemaEditing.Import(file, LinesFile, "", null, "", Choice("COMPANY_NAME", Other));
            log.Check(result != null && result.Subschema == null && result.Name == "Lines" && file.Schemas.Count == 0,
                "Otra Empresa has no lines: nothing is created");
            log.Check(result != null && result.TemplateValues.Count == 0, "and no value was used");
            lines = LocalSchemaEditing.FindTable(file, Cronus + "$Sales Invoice Line");
            log.Check(lines != null && lines.ForeignKeys.Count == 0, "nor a relation written");
        }

        // F. Every word in the name or in the description, in any order, ignoring case and accents
        private static void TestFilter(LocalSchemaLog log)
        {
            const string customers = "Clientes activos y bloqueados";
            string[,] cases =
            {
                { "CUSTOMERS", customers, "cliente activo", "yes" },
                { "CUSTOMERS", customers, "cliente borrado", "no" },
                { "CUSTOMERS", customers, "cust ACTIV", "yes" },
                { "CUSTOMERS", customers, "", "yes" },
                { "CUSTOMERS", customers, "   ", "yes" },
                { "PRODUCTS", "Categoría de producto", "categoria", "yes" },
                { "PRODUCTS", "Categoría de producto", "CATEGORÍA", "yes" },
                { Cronus + "$Item", "", "espana item", "yes" },
                { Cronus + "$Item", "", "ESPAÑA", "yes" },
                { "VBAK", "Documento de ventas: datos de cabecera", "cabecera pedido", "no" },
                { "VBAK", "Documento de ventas: datos de cabecera", "ventas cabecera", "yes" },
                { "KNA1", "", "kna1 cliente", "no" }
            };
            for (int i = 0; i < cases.GetLength(0); i++)
            {
                bool expected = cases[i, 3] == "yes";
                bool matches = LocalSchemaEditing.MatchesWords(cases[i, 0], cases[i, 1], cases[i, 2]);
                log.Check(matches == expected, cases[i, 0] + " / «" + cases[i, 1] + "» / «" + cases[i, 2] + "»: " +
                    (matches ? "matches" : "does not match"));
            }
            log.Check(new LocalSchemaFilter(" \t ").IsEmpty && !new LocalSchemaFilter("a").IsEmpty, "only spaces is no word");
            log.Check(LocalSchemaEditing.MatchesWords("A", null, "a") && !LocalSchemaEditing.MatchesWords(null, null, "a"),
                "no description, no name");
        }

        // F.3: lower case first, then the 161 letters of the table as their base letter; any other character stays
        private static void TestFold(LocalSchemaLog log)
        {
            const string accented = "ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽž";
            const string plain = "aaaaaaceeeeiiiinooooouuuuyaaaaaaceeeeiiiinooooouuuuyyaaaaaaccccccccddeeeeeeeeeegggggggghhiiiiiiiiijjkkllllllnnnnnnoooooorrrrrrssssssssttttuuuuuuuuuuuuwwyyyzzzzzz";
            log.Check(accented.Length == 161 && plain.Length == 161, "161 letters");
            string folded = LocalSchemaFilter.Fold(accented);
            int wrong = 0;
            for (int i = 0; i < accented.Length && i < folded.Length; i++)
                if (folded[i] != plain[i])
                {
                    if (wrong++ == 0)
                        log.Check(false, "the letter " + accented[i] + " is " + folded[i] + ", not " + plain[i]);
                }
            log.Check(wrong == 0 && folded.Length == plain.Length, "every letter of the table: " + wrong.ToString() + " wrong");
            log.Check(LocalSchemaFilter.Fold("ÆØßΩ-Ñ_$1") == "æøßω-n_$1", "any other character only in lower case: " + LocalSchemaFilter.Fold("ÆØßΩ-Ñ_$1"));
            log.Check(LocalSchemaFilter.Fold(null) == "" && LocalSchemaFilter.Fold("") == "", "nothing is nothing");
        }

        private static LocalSchemaTable NewTable(string name, string context, bool read)
        {
            var table = new LocalSchemaTable { Name = name, Context = context };
            if (!read)
                table.ColumnsRead = false;
            return table;
        }

        // C.4, the shared case: A not read is merged with the catalog's A; B, read, is not touched
        private static void TestMergeColumns(LocalSchemaLog log)
        {
            var file = new LocalSchemaFile { Alias = "MERGE" };
            file.Tables.Add(NewTable("A", "Tabla A", false));
            LocalSchemaTable b = NewTable("B", "", true);
            b.Columns.Add(new LocalSchemaColumn { Name = "X", Context = "dicho" });
            file.Tables.Add(b);
            var catalogA = new LocalSchemaTable { Name = "a" };
            catalogA.Columns.Add(new LocalSchemaColumn { Name = "ID", DataType = "Integer", IsPrimaryKey = true });
            catalogA.Columns.Add(new LocalSchemaColumn { Name = "NAME" });
            var fk = new LocalSchemaForeignKey { ConstraintName = "FK_A_B", TargetTable = "B" };
            fk.SourceColumns.Add("ID");
            fk.TargetColumns.Add("X");
            catalogA.ForeignKeys.Add(fk);
            var catalogB = new LocalSchemaTable { Name = "B" };
            catalogB.Columns.Add(new LocalSchemaColumn { Name = "Y" });

            List<string> merged = LocalSchemaStore.MergeColumns(file, new[] { catalogA, catalogB });
            log.Check(Joined(merged) == "A", "only A is merged: " + Joined(merged));
            LocalSchemaTable a = file.Tables[0];
            var names = new List<string>();
            foreach (LocalSchemaColumn c in a.Columns)
                names.Add(c.Name);
            log.Check(Joined(names) == "ID|NAME" && a.Columns[0].IsPrimaryKey && !a.Columns[1].IsPrimaryKey, "A has ID (its key) and NAME: " + Joined(names));
            log.Check(a.ForeignKeys.Count == 1 && a.ForeignKeys[0].TargetTable == "B" && Joined(a.ForeignKeys[0].SourceColumns) == "ID" &&
                Joined(a.ForeignKeys[0].TargetColumns) == "X", "A has the foreign key to B.X");
            log.Check(a.Context == "Tabla A" && a.ColumnsRead == null && LocalSchemaStore.IsRead(a), "A keeps its description and loses the mark");
            log.Check(b.Columns.Count == 1 && b.Columns[0].Name == "X" && b.Columns[0].Context == "dicho", "B is not touched");
            log.Check(LocalSchemaStore.ToJson(file).IndexOf("columnsRead", StringComparison.Ordinal) < 0, "no mark is written");
        }

        // C.4: before an import, the tables it finds are read; then it imports as over the whole catalog
        private static void TestImportLargeCatalog(LocalSchemaLog log, string folder)
        {
            string bc = ReadLibrary(folder, "library-bc-invoices.json");
            LocalSchemaFile whole = LoadLibraryFile(folder);
            LocalSchemaFile large = LoadLibraryFile(folder);
            foreach (LocalSchemaTable t in large.Tables)
            {
                t.Columns.Clear();
                t.ForeignKeys.Clear();
                t.ColumnsRead = false;
            }
            log.Check(LocalSchemaStore.IsLargeCatalog(large) && !LocalSchemaStore.IsLargeCatalog(whole), "the catalog without its columns is large");
            List<string> tables = LocalSchemaEditing.ImportTables(large, bc, null);
            log.Check(Joined(tables) == "Company|" + Cronus + "$Customer|" + Cronus + "$Item|" + Cronus + "$Sales Invoice Header|" +
                Cronus + "$Sales Invoice Line", "the tables it finds, by names only: " + Joined(tables));
            log.Check(Joined(LocalSchemaEditing.ImportTables(large, bc, Choice("COMPANY_NAME", Other))) == "Company|" + Other + "$Customer|" + Other + "$Item",
                "with the values chosen: " + Joined(LocalSchemaEditing.ImportTables(large, bc, Choice("COMPANY_NAME", Other))));
            log.Check(Joined(LocalSchemaEditing.ImportTables(large, LinesFile, null)) == Cronus + "$Sales Invoice Line|" + Cronus + "$Sales Invoice Header",
                "and the targets of its relations: " + Joined(LocalSchemaEditing.ImportTables(large, LinesFile, null)));
            log.Check(LocalSchemaEditing.ImportTables(large, "not json", null).Count == 0, "none when it is not a schema");
            log.Check(LocalSchemaStore.IsLargeCatalog(large) && large.Schemas.Count == 0, "finding them changes nothing");

            // The reading: the tables of the catalog (a whole file of its own has them) merged
            LocalSchemaFile catalog = LoadLibraryFile(folder);
            var read = new List<LocalSchemaTable>();
            foreach (string name in LocalSchemaStore.UnreadTables(large, tables))
                read.Add(LocalSchemaEditing.FindTable(catalog, name));
            log.Check(Joined(LocalSchemaStore.MergeColumns(large, read)) == Joined(tables), "they are read");
            LocalSchemaImportResult expected = LocalSchemaEditing.Import(whole, bc, "", null, "Invoices");
            LocalSchemaImportResult result = LocalSchemaEditing.Import(large, bc, "", null, "Invoices");
            log.Check(result != null && result.Subschema != null && expected != null && expected.Subschema != null, "both import");
            if (result == null || result.Subschema == null || expected == null || expected.Subschema == null)
                return;
            log.Check(Joined(result.Subschema.Tables) == Joined(expected.Subschema.Tables) && Joined(result.Skipped) == Joined(expected.Skipped),
                "the same tables and nothing else skipped: " + Joined(result.Subschema.Tables) + " / " + Joined(result.Skipped));
            string lines = Columns(large, result.Subschema, Cronus + "$Sales Invoice Line");
            log.Check(lines == Columns(whole, expected.Subschema, Cronus + "$Sales Invoice Line"), "the same columns: " + lines);
            log.Check(!LocalSchemaStore.IsRead(LocalSchemaEditing.FindTable(large, "KNA1")), "a table it does not use stays unread");
        }

        private static void Execute(Func<DbConnection> create, string sql)
        {
            using (DbConnection connection = create())
            {
                connection.Open();
                using (DbCommand command = connection.CreateCommand())
                {
                    command.CommandText = sql;
                    command.ExecuteNonQuery();
                }
            }
        }

        private static string ReadNames(LocalSchemaFile file)
        {
            var names = new List<string>();
            foreach (LocalSchemaTable t in file.Tables)
                if (LocalSchemaStore.IsRead(t))
                    names.Add(t.Name);
            return Joined(names);
        }

        // C: eight tables and the threshold at five; a subschema with two of them; one more asked for
        private static void TestLargeCatalogDatabase(LocalSchemaLog log)
        {
            DbProviderFactory factory;
            try
            {
                factory = DbProviderFactories.GetFactory("SQLiteCore");
            }
            catch (Exception ex)
            {
                log.Check(false, "no SQLiteCore provider (designer.exe registers it): " + ex.Message);
                return;
            }
            string dir = Path.Combine(Path.GetTempPath(), "rplocalschema-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            // Without pooling the file is closed with the connection, and the folder can go
            string database = "Data Source=" + Path.Combine(dir, "large.db") + ";Pooling=False";
            Func<DbConnection> create = () =>
            {
                DbConnection connection = factory.CreateConnection();
                connection.ConnectionString = database;
                return connection;
            };
            try
            {
                var sql = new StringBuilder("CREATE TABLE T1 (ID INTEGER PRIMARY KEY, NAME TEXT);");
                for (int i = 2; i <= 8; i++)
                    sql.Append("CREATE TABLE T" + i.ToString() + " (ID INTEGER PRIMARY KEY, NAME TEXT" + (i == 2 ? ", T1_ID INTEGER REFERENCES T1(ID)" : "") + ");");
                Execute(create, sql.ToString());

                LocalSchemaFile file = LocalSchemaStore.LoadOrGenerate(dir, "LARGE", create, false, 5);
                log.Check(file.Tables.Count == 8 && ReadNames(file) == "" && LocalSchemaStore.IsLargeCatalog(file),
                    "the first time, the names of the 8 tables only: " + ReadNames(file));
                log.Check(file.Tables.TrueForAll(t => t.Columns.Count == 0 && t.ForeignKeys.Count == 0 && t.ColumnsRead == false), "every table marked, without columns");

                var two = new LocalSubschema { Name = "Two" };
                two.Tables.Add("T2");
                two.Tables.Add("t5");
                file.Schemas.Add(two);
                LocalSchemaStore.Save(file, LocalSchemaStore.PathFor(dir, "LARGE"));
                file = LocalSchemaStore.LoadOrGenerate(dir, "LARGE", create, true, 5);
                log.Check(ReadNames(file) == "T2|T5", "read again, the two tables of the subschema: " + ReadNames(file));
                log.Check(file.Tables.FindAll(t => t.ColumnsRead == false).Count == 6, "the other six keep the mark");
                LocalSchemaTable t2 = LocalSchemaEditing.FindTable(file, "T2");
                log.Check(t2.Columns.Count == 3 && t2.Columns[0].IsPrimaryKey && t2.ForeignKeys.Count == 1 && t2.ForeignKeys[0].TargetTable == "T1",
                    "T2 with its columns, key and foreign key");

                List<string> read;
                using (DbConnection connection = create())
                    read = LocalSchemaStore.ReadColumns(file, connection, new[] { "t7", "T2" });
                log.Check(Joined(read) == "T7" && ReadNames(file) == "T2|T5|T7", "asking for one more reads it: " + ReadNames(file));
                log.Check(LocalSchemaEditing.FindTable(file, "T7").Columns.Count == 2, "T7 with its two columns");
            }
            finally
            {
                try { Directory.Delete(dir, true); } catch { }
            }
        }

        // V: a list of a hundred thousand tables fills at once, and keeps its selection by name
        private static void TestTableList(LocalSchemaLog log)
        {
            var tables = new List<LocalSchemaTable>();
            for (int i = 0; i < 100000; i++)
                tables.Add(new LocalSchemaTable { Name = "T" + i.ToString("D6") });
            using (var form = new Form { ShowInTaskbar = false, StartPosition = FormStartPosition.Manual, Location = new Point(-20000, -20000), Size = new Size(300, 400) })
            {
                var list = new LocalSchemaEditorForm.TableList(true) { Dock = DockStyle.Fill };
                form.Controls.Add(list);
                // Before its window: kept, and shown when it is created
                list.SetTables(tables);
                list.SelectTables(new[] { tables[5] });
                log.Check(form.Handle != IntPtr.Zero && list.Handle != IntPtr.Zero, "the windows are created");
                log.Check(list.VirtualListSize == 100000 && Joined(Names(list.SelectedTables)) == "T000005", "selected before its window: " +
                    Joined(Names(list.SelectedTables)));

                var watch = Stopwatch.StartNew();
                list.SetTables(tables);
                list.SelectTables(new[] { tables[5], tables[99998] });
                long ms = watch.ElapsedMilliseconds;
                log.Check(ms < 2000, "a hundred thousand tables in " + ms.ToString() + " ms");
                log.Check(Joined(Names(list.SelectedTables)) == "T000005|T099998" && list.SelectedCount == 2, "two selected: " + Joined(Names(list.SelectedTables)));
                log.Check(list.CurrentTable == tables[99998], "the last one is the current one");

                // Filtered: the one that is still there stays selected
                var filtered = tables.FindAll(t => t.Name.EndsWith("8", StringComparison.Ordinal));
                list.SetTables(filtered);
                log.Check(list.VirtualListSize == 10000 && Joined(Names(list.SelectedTables)) == "T099998", "filtered, the one still there: " +
                    Joined(Names(list.SelectedTables)));
                list.SelectTables(null);
                log.Check(list.SelectedCount == 0 && list.CurrentTable == null, "none selected");
                list.SetTables(new List<LocalSchemaTable>());
                log.Check(list.VirtualListSize == 0 && list.SelectedTables.Count == 0, "empty");
            }
        }

        private static List<string> Names(List<LocalSchemaTable> tables)
        {
            var result = new List<string>();
            foreach (LocalSchemaTable t in tables)
                result.Add(t.Name);
            return result;
        }

        // 6. Names that are in the database as they are: as before
        private static void TestExactNames(LocalSchemaLog log, string folder)
        {
            LocalSchemaFile file = LocalSchemaStore.Load(Path.Combine(folder, "dbxschemas-v2.json"));
            log.Check(file != null, "dbxschemas-v2.json is read");
            if (file == null)
                return;
            int schemas = file.Schemas.Count;
            LocalSchemaImportResult result = LocalSchemaEditing.Import(file, DesktopFile, "desktop.json", null);
            log.Check(result != null && result.Subschema != null && result.Subschema.Name == "Desktop", "the Desktop is imported");
            if (result == null || result.Subschema == null)
                return;
            // In the catalog's order, as AddTable keeps the tables of a subschema
            log.Check(Joined(result.Subschema.Tables) == "CUSTOMERS|PRODUCTS|SALES",
                "the tables as the catalog spells them, in its order: " + Joined(result.Subschema.Tables));
            log.Check(Columns(file, result.Subschema, "SALES") == "SALEID|TOTAL", "the columns of the file that are there: " +
                Columns(file, result.Subschema, "SALES"));
            log.Check(Columns(file, result.Subschema, "PRODUCTS") == "PRODUCTID", "no column left, its primary key");
            LocalSchemaTable sales = LocalSchemaEditing.FindTable(file, "SALES");
            log.Check(LocalSchemaEditing.FindColumn(sales, "TOTAL").DataType == "Currency", "the type is the one of the catalog");
            log.Check(sales.Context == "Sales of the old Desktop" && LocalSchemaEditing.FindColumn(sales, "TOTAL").Context == "Total amount" &&
                LocalSchemaEditing.FindColumn(sales, "SALEID").Context == "", "what the file describes, whatever the case of its names");
            LocalSchemaColumn state = LocalSchemaEditing.FindColumn(LocalSchemaEditing.FindTable(file, "CUSTOMERS"), "STATE");
            log.Check(state.AllowedValues != null && state.AllowedValues.Count == 1 && state.AllowedValues[0].Value == "X" &&
                state.AllowedValues[0].Label == "Closed", "the allowed values of the file win");
            log.Check(sales.ForeignKeys.Count == 1 && sales.ForeignKeys[0].ConstraintName == "FK_SALES_CUSTOMER" &&
                sales.ForeignKeys[0].RelationshipContext == "From the Desktop", "the relation of the database, described by the Desktop");
            log.Check(Joined(result.Skipped) == "SALES.DISCOUNT|GONE|PRODUCTS.PRICE", "what is not in the database is said: " + Joined(result.Skipped));
            log.Check(result.TemplateValues.Count == 0, "no template values");

            // The library: named after the schema of the library
            const string web = "{\"Name\":\"Config of the web\",\"SchemaTables\":[" +
                "{\"Name\":\"sales\",\"Columns\":[{\"Name\":\"SALEID\"},{\"Name\":\"TOTAL\"}]},{\"Name\":\"GONE\"}]}";
            result = LocalSchemaEditing.Import(file, web, "", null, "Library sales");
            log.Check(result != null && result.Subschema != null && result.Subschema.Name == "Library sales" &&
                Joined(result.Subschema.Tables) == "SALES" && Joined(result.Skipped) == "GONE", "the library, named after its schema");
            result = LocalSchemaEditing.Import(file, web, "", null, "Library sales");
            log.Check(result != null && result.Subschema != null && result.Subschema.Name == "Library sales 2", "imported again, «name 2»");

            // Not a schema: refused, nothing changes
            schemas = file.Schemas.Count;
            log.Check(LocalSchemaEditing.Import(file, "{\"tables\":[]}", "x.json", null) == null &&
                LocalSchemaEditing.Import(file, "not json", "x.json", null) == null &&
                LocalSchemaEditing.Import(file, "[{\"name\":\"SALES\"}]", "x.json", null) == null &&
                LocalSchemaEditing.Import(file, "{\"name\":\"X\",\"schemaTables\":{}}", "x.json", null) == null &&
                file.Schemas.Count == schemas, "a text that is not a schema is refused, nothing changes");
        }
    }
}
