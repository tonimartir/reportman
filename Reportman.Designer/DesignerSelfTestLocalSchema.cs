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
using System.Threading;
using System.Threading.Tasks;
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
    /// and the threshold at five) and the lists that paint only what they show. And the progress of the reads of the
    /// database (their phases and rows in order, a read cancelled that changes nothing, the status line). And Export all and
    /// Import all of the whole file (merge, replace, what has content, what is not a whole file, the round trip), the same
    /// cases as the Delphi designer and Reportman Server.
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
            RunCheck(log, "progress: the phases and the rows of a read", TestReadProgress);
            RunCheck(log, "progress: a read cancelled changes nothing", TestReadCancelled);
            RunCheck(log, "progress: the status line", TestReadStatusText);
            RunCheck(log, "lists: a hundred thousand tables", TestTableList);
            RunCheck(log, "import all: merge", TestImportAllMerge);
            RunCheck(log, "import all: replace", TestImportAllReplace);
            RunCheck(log, "import all: has content", TestImportAllHasContent);
            RunCheck(log, "import all: not a whole file", f => TestImportAllNotWholeFile(f, folder));
            RunCheck(log, "import all: export all, round trip", TestExportAllRoundTrip);
            RunCheck(log, "import all: the relations of the database", TestImportAllDatabaseRelations);
            RunCheck(log, "import all: a large catalog reads first", TestImportAllLargeCatalog);
            RunCheck(log, "import all: the strings 2043-2053", TestImportAllStrings);
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

        /// <summary>
        /// A SQLite database in <paramref name="dir"/> made by <paramref name="sql"/>; null, failing, without the SQLiteCore
        /// provider (designer.exe registers it).
        /// </summary>
        private static Func<DbConnection> SqliteDatabase(LocalSchemaLog log, string dir, string sql)
        {
            DbProviderFactory factory;
            try
            {
                factory = DbProviderFactories.GetFactory("SQLiteCore");
            }
            catch (Exception ex)
            {
                log.Check(false, "no SQLiteCore provider (designer.exe registers it): " + ex.Message);
                return null;
            }
            Directory.CreateDirectory(dir);
            // Without pooling the file is closed with the connection, and the folder can go
            string database = "Data Source=" + Path.Combine(dir, "progress.db") + ";Pooling=False";
            Func<DbConnection> create = () =>
            {
                DbConnection connection = factory.CreateConnection();
                connection.ConnectionString = database;
                return connection;
            };
            Execute(create, sql);
            return create;
        }

        // Eight tables (T2 points to T1) and seven rows in T1: 8 names + 17 columns + 1 foreign key are 26 rows of catalog
        private static string EightTablesSql()
        {
            var sql = new StringBuilder("CREATE TABLE T1 (ID INTEGER PRIMARY KEY, NAME TEXT);");
            for (int i = 2; i <= 8; i++)
                sql.Append("CREATE TABLE T" + i.ToString() + " (ID INTEGER PRIMARY KEY, NAME TEXT" + (i == 2 ? ", T1_ID INTEGER REFERENCES T1(ID)" : "") + ");");
            for (int i = 1; i <= 7; i++)
                sql.Append("INSERT INTO T1 (ID, NAME) VALUES (" + i.ToString() + ", 'Name " + i.ToString() + "');");
            return sql.ToString();
        }

        /// <summary>The reports of a read as they come, on the thread that reads; <see cref="OnReport"/> sees each one.</summary>
        private sealed class RecordedProgress : IProgress<DatabaseReadProgress>
        {
            public readonly List<DatabaseReadProgress> Reports = new List<DatabaseReadProgress>();
            public Action<DatabaseReadProgress> OnReport;

            public void Report(DatabaseReadProgress value)
            {
                lock (Reports)
                    Reports.Add(value);
                if (OnReport != null)
                    OnReport(value);
            }

            public string Phases()
            {
                var parts = new List<string>();
                lock (Reports)
                    foreach (DatabaseReadProgress p in Reports)
                        parts.Add(p.PhaseName + ":" + p.Rows.ToString());
                return string.Join(" ", parts);
            }
        }

        /// <summary>
        /// The reports of a read in order: connecting first (none when the connection was open), executing before
        /// fetching, the rows never fewer than before and, at the end, <paramref name="rows"/>.
        /// </summary>
        private static void CheckOrder(LocalSchemaLog log, string what, RecordedProgress progress, bool connects, long rows)
        {
            List<DatabaseReadProgress> reports = progress.Reports;
            log.Check(reports.Count >= (connects ? 3 : 2), what + ": the phases are reported: " + progress.Phases());
            if (reports.Count == 0)
                return;
            log.Check(connects == (reports[0].Phase == DatabaseReadPhase.Connecting) && reports[0].Rows == 0,
                what + ": " + (connects ? "connecting first" : "no connecting") + ": " + progress.Phases());
            int executing = reports.FindIndex(p => p.Phase == DatabaseReadPhase.Executing);
            int fetching = reports.FindIndex(p => p.Phase == DatabaseReadPhase.Fetching);
            log.Check(executing >= 0 && fetching > executing, what + ": executing, then fetching: " + progress.Phases());
            bool growing = true;
            for (int i = 1; i < reports.Count; i++)
                if (reports[i].Rows < reports[i - 1].Rows || reports[i].Elapsed < reports[i - 1].Elapsed)
                    growing = false;
            log.Check(growing, what + ": the rows and the time only grow: " + progress.Phases());
            log.Check(reports[reports.Count - 1].Rows == rows, what + ": " + rows.ToString() + " rows in all: " + progress.Phases());
        }

        // P: a read reports its phases and the rows of all its queries, in order (the catalog, the columns of some tables
        // and the first rows of a table)
        private static void TestReadProgress(LocalSchemaLog log)
        {
            string dir = Path.Combine(Path.GetTempPath(), "rplocalschema-" + Guid.NewGuid().ToString("N"));
            try
            {
                Func<DbConnection> create = SqliteDatabase(log, dir, EightTablesSql());
                if (create == null)
                    return;
                var progress = new RecordedProgress();
                LocalSchemaFile file = Task.Run(async () =>
                {
                    using (DbConnection connection = create())
                        return await LocalSchemaStore.GenerateAsync(connection, "PROGRESS", null, 0, progress, CancellationToken.None);
                }).GetAwaiter().GetResult();
                log.Check(file.Tables.Count == 8 && ReadNames(file) == "T1|T2|T3|T4|T5|T6|T7|T8", "the catalog is read as always: " + ReadNames(file));
                CheckOrder(log, "the catalog", progress, true, 26);

                // The columns of two tables of a large catalog: the 8 names, the 5 columns and the foreign key
                var large = LocalSchemaStore.LoadOrGenerate(dir, "PROGRESS", create, false, 5);
                progress = new RecordedProgress();
                List<string> read = Task.Run(async () =>
                {
                    using (DbConnection connection = create())
                        return await LocalSchemaStore.ReadColumnsAsync(large, connection, new[] { "T1", "t2" }, progress, CancellationToken.None);
                }).GetAwaiter().GetResult();
                log.Check(Joined(read) == "T1|T2", "two tables read: " + Joined(read));
                CheckOrder(log, "the columns", progress, true, 14);

                // An open connection: no connecting
                progress = new RecordedProgress();
                using (DbConnection connection = create())
                {
                    connection.Open();
                    List<LocalSchemaTable> tables = Task.Run(() => DatabaseCatalogReader.ReadTableDetailsAsync(connection, new[] { "T3" }, progress,
                        CancellationToken.None)).GetAwaiter().GetResult();
                    log.Check(tables.Count == 1 && tables[0].Columns.Count == 2, "T3 with its two columns");
                }
                CheckOrder(log, "an open connection", progress, false, 10);

                // The preview: five rows of the seven
                progress = new RecordedProgress();
                System.Data.DataTable rows = Task.Run(() => LocalSchemaEditing.ReadPreviewAsync(create, "SQLite", "T1", 5, progress,
                    CancellationToken.None)).GetAwaiter().GetResult();
                log.Check(rows.Rows.Count == 5 && rows.Columns.Count == 2, "the preview, 5 rows: " + rows.Rows.Count.ToString());
                CheckOrder(log, "the preview", progress, true, 5);
            }
            finally
            {
                try { Directory.Delete(dir, true); } catch { }
            }
        }

        /// <summary>Runs a read that must be cancelled; the text of what it threw otherwise ("" when it was cancelled).</summary>
        private static string Cancelled(Func<Task> read)
        {
            try
            {
                Task.Run(read).GetAwaiter().GetResult();
                return "not cancelled";
            }
            catch (OperationCanceledException)
            {
                return "";
            }
            catch (Exception ex)
            {
                return ex.GetType().Name + ": " + ex.Message;
            }
        }

        // P: a read cancelled while it fetches stops, and the file stays as it was: not written, nothing merged
        private static void TestReadCancelled(LocalSchemaLog log)
        {
            string dir = Path.Combine(Path.GetTempPath(), "rplocalschema-" + Guid.NewGuid().ToString("N"));
            try
            {
                Func<DbConnection> create = SqliteDatabase(log, dir, EightTablesSql());
                if (create == null)
                    return;
                string path = LocalSchemaStore.PathFor(dir, "CANCEL");
                LocalSchemaFile file = LocalSchemaStore.LoadOrGenerate(dir, "CANCEL", create, false, 5);
                var two = new LocalSubschema { Name = "Two" };
                two.Tables.Add("T2");
                file.Schemas.Add(two);
                LocalSchemaStore.Save(file, path);
                string onDisk = File.ReadAllText(path, Encoding.UTF8);

                // Read again, cancelled at its first row: the file on disk is the same
                var cts = new CancellationTokenSource();
                var progress = new RecordedProgress();
                progress.OnReport = p =>
                {
                    if (p.Phase == DatabaseReadPhase.Fetching)
                        cts.Cancel();
                };
                string outcome = Cancelled(() => LocalSchemaStore.LoadOrGenerateAsync(dir, "CANCEL", create, true, 5, progress, cts.Token));
                log.Check(outcome == "", "reading the catalog again is cancelled: " + outcome);
                log.Check(File.ReadAllText(path, Encoding.UTF8) == onDisk, "the file on disk is the same");
                log.Check(progress.Reports.Count > 0 && progress.Reports[progress.Reports.Count - 1].Phase == DatabaseReadPhase.Fetching &&
                    progress.Reports[progress.Reports.Count - 1].Rows == 1, "it stopped at its first row: " + progress.Phases());

                // The columns of a table, cancelled: the table stays unread
                string before = LocalSchemaStore.ToJson(file);
                cts = new CancellationTokenSource();
                progress = new RecordedProgress();
                progress.OnReport = p =>
                {
                    if (p.Phase == DatabaseReadPhase.Fetching)
                        cts.Cancel();
                };
                outcome = Cancelled(async () =>
                {
                    using (DbConnection connection = create())
                        await LocalSchemaStore.ReadColumnsAsync(file, connection, new[] { "T7" }, progress, cts.Token);
                });
                log.Check(outcome == "", "reading the columns of T7 is cancelled: " + outcome);
                log.Check(!LocalSchemaStore.IsRead(LocalSchemaEditing.FindTable(file, "T7")) && LocalSchemaStore.ToJson(file) == before,
                    "T7 stays unread, the file is the same");

                // A token cancelled before: nothing is read
                cts = new CancellationTokenSource();
                cts.Cancel();
                progress = new RecordedProgress();
                outcome = Cancelled(() => LocalSchemaEditing.ReadPreviewAsync(create, "SQLite", "T1", 5, progress, cts.Token));
                log.Check(outcome == "" && progress.Reports.Count == 0, "a preview cancelled before it starts: " + outcome + " " + progress.Phases());
                cts = new CancellationTokenSource();
                progress = new RecordedProgress();
                progress.OnReport = p =>
                {
                    if (p.Phase == DatabaseReadPhase.Fetching)
                        cts.Cancel();
                };
                outcome = Cancelled(() => LocalSchemaEditing.ReadPreviewAsync(create, "SQLite", "T1", 5, progress, cts.Token));
                log.Check(outcome == "", "a preview cancelled at its first row: " + outcome);
            }
            finally
            {
                try { Directory.Delete(dir, true); } catch { }
            }
        }

        // P: 2037 while it connects, 2038 while a query runs, 2039 with the rows (thousands separators) while they come
        private static void TestReadStatusText(LocalSchemaLog log)
        {
            log.Check(DesignerText.Tr(2037).Length > 0 && DesignerText.Tr(2038).Length > 0 && DesignerText.Tr(2039).Length > 0 &&
                DesignerText.Tr(2040).Length > 0 && DesignerText.Tr(2041).Length > 0 && DesignerText.Tr(2042).Length > 0, "the strings 2037-2042");
            string text = LocalSchemaEditorForm.ReadStatusText(null, TimeSpan.FromSeconds(3.7));
            log.Check(text == DesignerText.Format(2037, "3"), "before the first report, connecting: " + text);
            text = LocalSchemaEditorForm.ReadStatusText(new DatabaseReadProgress(DatabaseReadPhase.Executing, 0, TimeSpan.Zero), TimeSpan.FromSeconds(12.2));
            log.Check(text == DesignerText.Format(2038, "12"), "executing, the seconds of the read: " + text);
            string rows = 1234567L.ToString("N0", System.Globalization.CultureInfo.CurrentCulture);
            text = LocalSchemaEditorForm.ReadStatusText(new DatabaseReadProgress(DatabaseReadPhase.Fetching, 1234567, TimeSpan.Zero), TimeSpan.FromSeconds(5));
            log.Check(text == DesignerText.Format(2039, rows, "5") && text.Contains(rows), "fetching, the rows with their separators: " + text);
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

        // ===== X.6: Export all and Import all, the same cases as the Delphi designer and Reportman Server =====

        // The catalog of the connection: ORDERS (ID, STATUS, X, CUSTOMER_ID -> CUSTOMERS), CUSTOMERS (ID, Y), PRODUCTS (ID)
        private static LocalSchemaFile ShopCatalog()
        {
            var file = new LocalSchemaFile { Alias = "SHOP", Dialect = "SQLite", GeneratedUtc = "2026-10-19T00:00:00Z" };
            LocalSchemaTable orders = CatalogTable("ORDERS", "ID", "STATUS", "X", "CUSTOMER_ID");
            orders.ForeignKeys.Add(NewRelation("FK_ORDERS_CUSTOMERS", "CUSTOMERS", "CUSTOMER_ID", "ID", ""));
            file.Tables.Add(orders);
            file.Tables.Add(CatalogTable("CUSTOMERS", "ID", "Y"));
            file.Tables.Add(CatalogTable("PRODUCTS", "ID"));
            return file;
        }

        // A table whose first column is its primary key
        private static LocalSchemaTable CatalogTable(string name, params string[] columns)
        {
            var table = new LocalSchemaTable { Name = name };
            for (int i = 0; i < columns.Length; i++)
                table.Columns.Add(new LocalSchemaColumn { Name = columns[i], DataType = i == 0 ? "Integer" : "String", IsPrimaryKey = i == 0 });
            return table;
        }

        // A relation of one column; written by hand when the constraint name is empty
        private static LocalSchemaForeignKey NewRelation(string constraint, string target, string sourceColumn, string targetColumn, string context)
        {
            var fk = new LocalSchemaForeignKey { ConstraintName = constraint, TargetTable = target, RelationshipContext = context };
            fk.SourceColumns.Add(sourceColumn);
            fk.TargetColumns.Add(targetColumn);
            return fk;
        }

        private static LocalRelationRef NewEntry(string sourceTable, string sourceColumn, string targetTable, string targetColumn)
        {
            var entry = new LocalRelationRef { SourceTable = sourceTable, TargetTable = targetTable };
            entry.SourceColumns.Add(sourceColumn);
            entry.TargetColumns.Add(targetColumn);
            return entry;
        }

        private static LocalSubschema NewSubschema(string name, params string[] tables)
        {
            var schema = new LocalSubschema { Name = name };
            schema.Tables.AddRange(tables);
            return schema;
        }

        private static List<LocalAllowedValue> NewValues(params string[] values)
        {
            var result = new List<LocalAllowedValue>();
            foreach (string value in values)
                result.Add(new LocalAllowedValue { Value = value, Label = "Label " + value });
            return result;
        }

        // D: Sales (ORDERS, CUSTOMERS) and Mine (PRODUCTS); ORDERS "D orders", ORDERS.STATUS [A], CUSTOMERS "D customers";
        // ORDERS.X -> PRODUCTS by hand. And ORDERS.ID "D id", FK_ORDERS_CUSTOMERS "D: who"
        private static LocalSchemaFile ShopD()
        {
            LocalSchemaFile d = ShopCatalog();
            d.Schemas.Add(NewSubschema("Sales", "ORDERS", "CUSTOMERS"));
            d.Schemas.Add(NewSubschema("Mine", "PRODUCTS"));
            LocalSchemaTable orders = LocalSchemaEditing.FindTable(d, "ORDERS");
            orders.Context = "D orders";
            LocalSchemaEditing.FindColumn(orders, "ID").Context = "D id";
            LocalSchemaEditing.FindColumn(orders, "STATUS").AllowedValues = NewValues("A");
            orders.ForeignKeys[0].RelationshipContext = "D: who";
            orders.ForeignKeys.Add(NewRelation("", "PRODUCTS", "X", "ID", "D: its product"));
            LocalSchemaEditing.FindTable(d, "CUSTOMERS").Context = "D customers";
            return d;
        }

        // F, the whole file of another installation: Sales (ORDERS, GHOST) and New (customers); ORDERS "F orders", CUSTOMERS "",
        // ORDERS.STATUS [B, C], a column ORDERS.NOPE, a table GHOST, CUSTOMERS.Y -> ORDERS by hand, a root exclusion (and one
        // of GHOST, which is not here)
        private static string ShopF()
        {
            var f = new LocalSchemaFile { Alias = "OTHER", Dialect = "SQLite", GeneratedUtc = "2026-10-18T00:00:00Z" };
            LocalSchemaTable orders = CatalogTable("ORDERS", "ID", "STATUS", "X", "CUSTOMER_ID", "NOPE");
            orders.Context = "F orders";
            LocalSchemaEditing.FindColumn(orders, "STATUS").AllowedValues = NewValues("B", "C");
            orders.ForeignKeys.Add(NewRelation("FK_ORDERS_CUSTOMERS", "CUSTOMERS", "CUSTOMER_ID", "ID", "F: who ordered"));
            f.Tables.Add(orders);
            LocalSchemaTable customers = CatalogTable("CUSTOMERS", "ID", "Y");
            customers.ForeignKeys.Add(NewRelation("", "ORDERS", "Y", "ID", "F: by hand"));
            f.Tables.Add(customers);
            f.Tables.Add(CatalogTable("GHOST", "ID"));
            LocalSubschema sales = NewSubschema("Sales", "ORDERS", "GHOST");
            sales.Description = "F sales";
            sales.Columns = new Dictionary<string, List<string>> { { "ORDERS", new List<string> { "ID", "STATUS", "NOPE" } } };
            f.Schemas.Add(sales);
            f.Schemas.Add(NewSubschema("New", "customers"));
            f.ExcludedRelations = new List<LocalRelationRef>
            {
                NewEntry("ORDERS", "CUSTOMER_ID", "CUSTOMERS", "ID"),
                NewEntry("GHOST", "ID", "ORDERS", "ID")
            };
            return LocalSchemaStore.ToJson(f);
        }

        private static string SchemaNames(LocalSchemaFile file)
        {
            var names = new List<string>();
            foreach (LocalSubschema s in file.Schemas)
                names.Add(s.Name);
            return Joined(names);
        }

        // The relations written by hand of a table: «X>PRODUCTS.ID=description»
        private static string Written(LocalSchemaFile file, string table)
        {
            var result = new List<string>();
            LocalSchemaTable t = LocalSchemaEditing.FindTable(file, table);
            if (t != null)
                foreach (LocalSchemaForeignKey fk in t.ForeignKeys)
                    if (LocalSchemaEditing.IsWritten(fk))
                        result.Add(string.Join(",", fk.SourceColumns) + ">" + fk.TargetTable + "." + string.Join(",", fk.TargetColumns) + "=" + fk.RelationshipContext);
            return Joined(result);
        }

        private static string Entries(List<LocalRelationRef> list)
        {
            var result = new List<string>();
            if (list != null)
                foreach (LocalRelationRef r in list)
                    result.Add(r.SourceTable + "." + string.Join(",", r.SourceColumns) + ">" + r.TargetTable + "." + string.Join(",", r.TargetColumns));
            return Joined(result);
        }

        private static string Sorted(List<string> values)
        {
            var copy = new List<string>(values);
            copy.Sort(StringComparer.OrdinalIgnoreCase);
            return Joined(copy);
        }

        private static string Context(LocalSchemaFile file, string table)
        {
            LocalSchemaTable t = LocalSchemaEditing.FindTable(file, table);
            return t != null ? t.Context : "(no table " + table + ")";
        }

        private static string ColumnContext(LocalSchemaFile file, string table, string column)
        {
            LocalSchemaColumn c = LocalSchemaEditing.FindColumn(LocalSchemaEditing.FindTable(file, table), column);
            return c != null ? c.Context : "(no column " + table + "." + column + ")";
        }

        private static string AllowedValues(LocalSchemaFile file, string table, string column)
        {
            LocalSchemaColumn c = LocalSchemaEditing.FindColumn(LocalSchemaEditing.FindTable(file, table), column);
            if (c == null)
                return "(no column " + table + "." + column + ")";
            var values = new List<string>();
            if (c.AllowedValues != null)
                foreach (LocalAllowedValue v in c.AllowedValues)
                    values.Add(v.Value);
            return Joined(values);
        }

        private static string RelationContext(LocalSchemaFile file, string table, string constraint)
        {
            LocalSchemaTable t = LocalSchemaEditing.FindTable(file, table);
            LocalSchemaForeignKey fk = t != null ? t.ForeignKeys.Find(f => f.ConstraintName == constraint) : null;
            return fk != null ? fk.RelationshipContext : "(no relation " + constraint + ")";
        }

        private static string Catalog(LocalSchemaFile file)
        {
            var result = new List<string>();
            foreach (LocalSchemaTable t in file.Tables)
            {
                var columns = new List<string>();
                foreach (LocalSchemaColumn c in t.Columns)
                    columns.Add(c.Name + (c.IsPrimaryKey ? "*" : ""));
                int database = t.ForeignKeys.FindAll(fk => !LocalSchemaEditing.IsWritten(fk)).Count;
                result.Add(t.Name + "(" + string.Join(",", columns) + ")" + database.ToString());
            }
            return Joined(result);
        }

        private const string ShopCatalogText = "ORDERS(ID*,STATUS,X,CUSTOMER_ID)1|CUSTOMERS(ID*,Y)0|PRODUCTS(ID*)0";

        // X.6 Merge: Sales (from F: only ORDERS), Mine (kept), New; added 2, replaced 1; ORDERS "F orders", CUSTOMERS
        // "D customers"; STATUS [B, C]; both relations by hand; the exclusion; skipped GHOST and ORDERS.NOPE
        private static void TestImportAllMerge(LocalSchemaLog log)
        {
            LocalSchemaFile d = ShopD();
            LocalSchemaImportAllResult result = d.ImportAll(LocalSchemaFile.Parse(ShopF()), false);
            log.Check(SchemaNames(d) == "Sales|Mine|New", "Sales replaced in place, Mine kept, New at the end: " + SchemaNames(d));
            log.Check(result.Added == 2 && result.Replaced == 1, "added 2, replaced 1: " + result.Added.ToString() + ", " + result.Replaced.ToString());
            log.Check(Joined(result.Subschemas) == "Sales|New", "the subschemas imported, in the order of the file: " + Joined(result.Subschemas));
            LocalSubschema sales = LocalSchemaStore.FindSubschema(d, "Sales");
            log.Check(sales != null && Joined(sales.Tables) == "ORDERS" && sales.Description == "F sales",
                "Sales is the file's, with ORDERS only: " + (sales != null ? Joined(sales.Tables) : "(none)"));
            log.Check(sales != null && Columns(d, sales, "ORDERS") == "ID|STATUS", "its columns that are here: " + (sales != null ? Columns(d, sales, "ORDERS") : ""));
            LocalSubschema mine = LocalSchemaStore.FindSubschema(d, "Mine");
            log.Check(mine != null && Joined(mine.Tables) == "PRODUCTS", "Mine stays");
            LocalSubschema added = LocalSchemaStore.FindSubschema(d, "New");
            log.Check(added != null && Joined(added.Tables) == "CUSTOMERS", "New, its table as this file spells it: " + (added != null ? Joined(added.Tables) : "(none)"));
            log.Check(Context(d, "ORDERS") == "F orders" && Context(d, "CUSTOMERS") == "D customers",
                "ORDERS takes F's description, CUSTOMERS keeps D's: " + Context(d, "ORDERS") + " / " + Context(d, "CUSTOMERS"));
            log.Check(ColumnContext(d, "ORDERS", "ID") == "D id", "a column description F does not have stays");
            log.Check(AllowedValues(d, "ORDERS", "STATUS") == "B|C", "STATUS takes F's whole list: " + AllowedValues(d, "ORDERS", "STATUS"));
            log.Check(Written(d, "ORDERS") == "X>PRODUCTS.ID=D: its product" && Written(d, "CUSTOMERS") == "Y>ORDERS.ID=F: by hand",
                "both relations by hand: " + Written(d, "ORDERS") + " / " + Written(d, "CUSTOMERS"));
            log.Check(RelationContext(d, "ORDERS", "FK_ORDERS_CUSTOMERS") == "F: who ordered", "the relation of the database takes F's description");
            log.Check(Entries(d.ExcludedRelations) == "ORDERS.CUSTOMER_ID>CUSTOMERS.ID", "the exclusion of ORDERS, not the one of GHOST: " +
                Entries(d.ExcludedRelations));
            log.Check(Sorted(result.Skipped) == "GHOST|ORDERS.NOPE", "skipped GHOST and ORDERS.NOPE: " + Joined(result.Skipped));
            log.Check(Catalog(d) == ShopCatalogText, "the catalog does not change: " + Catalog(d));
            log.Check(d.Alias == "SHOP", "nor the alias");

            // Imported again: nothing twice
            result = d.ImportAll(LocalSchemaFile.Parse(ShopF()), false);
            log.Check(SchemaNames(d) == "Sales|Mine|New" && result.Added == 2 && result.Replaced == 2, "imported again, both replace: " + SchemaNames(d));
            log.Check(Written(d, "ORDERS") == "X>PRODUCTS.ID=D: its product" && Written(d, "CUSTOMERS") == "Y>ORDERS.ID=F: by hand" &&
                Entries(d.ExcludedRelations) == "ORDERS.CUSTOMER_ID>CUSTOMERS.ID", "no relation nor exclusion twice");
        }

        // X.6 Replace: Sales and New only; CUSTOMERS without description; only F's relation by hand
        private static void TestImportAllReplace(LocalSchemaLog log)
        {
            LocalSchemaFile d = ShopD();
            LocalSchemaImportAllResult result = d.ImportAll(LocalSchemaFile.Parse(ShopF()), true);
            log.Check(SchemaNames(d) == "Sales|New", "Sales and New only: " + SchemaNames(d));
            log.Check(result.Added == 2 && result.Replaced == 0, "added 2, none replaced (D's were gone): " + result.Added.ToString() + ", " +
                result.Replaced.ToString());
            log.Check(Context(d, "CUSTOMERS") == "" && Context(d, "ORDERS") == "F orders", "CUSTOMERS without description, ORDERS F's: «" +
                Context(d, "CUSTOMERS") + "» / " + Context(d, "ORDERS"));
            log.Check(ColumnContext(d, "ORDERS", "ID") == "", "D's column descriptions go");
            log.Check(Written(d, "ORDERS") == "" && Written(d, "CUSTOMERS") == "Y>ORDERS.ID=F: by hand",
                "only F's relation by hand: " + Written(d, "ORDERS") + " / " + Written(d, "CUSTOMERS"));
            log.Check(AllowedValues(d, "ORDERS", "STATUS") == "B|C", "STATUS [B, C]: " + AllowedValues(d, "ORDERS", "STATUS"));
            log.Check(RelationContext(d, "ORDERS", "FK_ORDERS_CUSTOMERS") == "F: who ordered", "the relation of the database, F's description");
            log.Check(Entries(d.ExcludedRelations) == "ORDERS.CUSTOMER_ID>CUSTOMERS.ID", "F's exclusion: " + Entries(d.ExcludedRelations));
            log.Check(Sorted(result.Skipped) == "GHOST|ORDERS.NOPE", "skipped GHOST and ORDERS.NOPE: " + Joined(result.Skipped));
            log.Check(Catalog(d) == ShopCatalogText, "the catalog does not change (its relation of the database stays): " + Catalog(d));

            // Without anything written, merge and replace give the same file
            LocalSchemaFile merged = ShopCatalog();
            merged.ImportAll(LocalSchemaFile.Parse(ShopF()), false);
            LocalSchemaFile replaced = ShopCatalog();
            replaced.ImportAll(LocalSchemaFile.Parse(ShopF()), true);
            log.Check(LocalSchemaStore.ToJson(merged) == LocalSchemaStore.ToJson(replaced), "into a fresh catalog merge and replace are the same");
        }

        // X.6 Has content: D yes; a fresh catalog no; each thing written alone, yes
        private static void TestImportAllHasContent(LocalSchemaLog log)
        {
            log.Check(ShopD().HasContent(), "D has content");
            log.Check(!ShopCatalog().HasContent(), "a fresh catalog has none");
            log.Check(!LocalSchemaFile.Parse(LocalSchemaStore.ToJson(ShopCatalog())).HasContent(), "nor once saved and read");
            Func<Action<LocalSchemaFile>, bool> with = change =>
            {
                LocalSchemaFile file = ShopCatalog();
                change(file);
                return file.HasContent();
            };
            log.Check(with(f => f.Schemas.Add(NewSubschema("Empty"))), "a subschema, even empty");
            log.Check(with(f => f.ExcludedRelations = new List<LocalRelationRef> { NewEntry("ORDERS", "CUSTOMER_ID", "CUSTOMERS", "ID") }),
                "a relation left out of every subschema");
            log.Check(with(f => LocalSchemaEditing.FindTable(f, "ORDERS").ForeignKeys.Add(NewRelation("", "PRODUCTS", "X", "ID", ""))),
                "a relation written by hand, without description");
            log.Check(with(f => LocalSchemaEditing.FindTable(f, "CUSTOMERS").Context = "x"), "a table description");
            log.Check(with(f => LocalSchemaEditing.FindColumn(LocalSchemaEditing.FindTable(f, "CUSTOMERS"), "Y").Context = "x"), "a column description");
            log.Check(with(f => LocalSchemaEditing.FindColumn(LocalSchemaEditing.FindTable(f, "ORDERS"), "STATUS").AllowedValues = NewValues("A")),
                "allowed values");
            log.Check(with(f => LocalSchemaEditing.FindTable(f, "ORDERS").ForeignKeys[0].RelationshipContext = "x"),
                "a description of a relation of the database");
            log.Check(!with(f => LocalSchemaEditing.FindTable(f, "CUSTOMERS").Context = "  "), "only spaces is no description");
        }

        private static bool ParseThrows(string json)
        {
            try
            {
                LocalSchemaFile.Parse(json);
                return false;
            }
            catch (System.Text.Json.JsonException)
            {
                return true;
            }
        }

        // X.6 Not a whole file: a subschema export and the web's format are refused, D unchanged
        private static void TestImportAllNotWholeFile(LocalSchemaLog log, string folder)
        {
            LocalSchemaFile d = ShopD();
            string before = LocalSchemaStore.ToJson(d);
            string subschema = LocalSchemaEditing.ExportJson(d, LocalSchemaStore.FindSubschema(d, "Sales"));
            log.Check(!LocalSchemaFile.IsWholeFileJson(subschema) && !LocalSchemaFile.IsWholeFileJson(LocalSchemaEditing.ExportJson(d, null)),
                "a subschema exported with Export (and all the tables) is not a whole file");
            log.Check(!LocalSchemaFile.IsWholeFileJson("{\"name\":\"x\",\"schemaTables\":[]}") &&
                !LocalSchemaFile.IsWholeFileJson("{\"Name\":\"x\",\"SchemaTables\":[]}"), "nor the web's format");
            log.Check(!LocalSchemaFile.IsWholeFileJson("not json") && !LocalSchemaFile.IsWholeFileJson("") && !LocalSchemaFile.IsWholeFileJson(null) &&
                !LocalSchemaFile.IsWholeFileJson("[]") && !LocalSchemaFile.IsWholeFileJson("{\"tables\":{}}") &&
                !LocalSchemaFile.IsWholeFileJson("{\"tables\":[]"), "nor anything else");
            log.Check(LocalSchemaFile.IsWholeFileJson(before) && LocalSchemaFile.IsWholeFileJson("\uFEFF{\"tables\":[]}") &&
                LocalSchemaFile.IsWholeFileJson("{\"version\":2,\"Tables\":[],}"), "a whole file is, with a BOM, any case, a trailing comma");
            log.Check(LocalSchemaFile.IsWholeFileJson(File.ReadAllText(Path.Combine(folder, "dbxschemas-v2.json"), Encoding.UTF8)),
                "a dbxschemas file copied as it is");
            log.Check(ParseThrows("[]") && ParseThrows("not json") && ParseThrows("{\"tables\":[1]}"), "reading something else throws");
            log.Check(LocalSchemaStore.ToJson(d) == before, "D is not changed");
        }

        // X.6 Export all writes what Save writes; importing it into an empty file of the same catalog gives the same file
        private static void TestExportAllRoundTrip(LocalSchemaLog log)
        {
            LocalSchemaFile d = ShopD();
            d.ExcludedRelations = new List<LocalRelationRef> { NewEntry("ORDERS", "CUSTOMER_ID", "CUSTOMERS", "ID") };
            LocalSubschema sales = LocalSchemaStore.FindSubschema(d, "Sales");
            sales.Description = "D sales";
            sales.Columns = new Dictionary<string, List<string>> { { "ORDERS", new List<string> { "ID", "STATUS" } } };
            sales.ExcludedRelations = new List<LocalRelationRef> { NewEntry("ORDERS", "X", "PRODUCTS", "ID") };
            // A relation by hand being written (no columns yet): not saved, so not exported either; the screen keeps it
            LocalSchemaEditing.FindTable(d, "PRODUCTS").ForeignKeys.Add(new LocalSchemaForeignKey { ConstraintName = "", TargetTable = "ORDERS" });
            string onScreen = LocalSchemaStore.ToJson(d);
            string exported = LocalSchemaEditing.ExportAllJson(d);
            log.Check(LocalSchemaStore.ToJson(d) == onScreen, "exporting does not change the screen");
            log.Check(LocalSchemaEditing.WholeFileName(d.Alias) == "SHOP.json" && LocalSchemaEditing.WholeFileName("a/b") == "A_B.json",
                "the name proposed, the one of the file: " + LocalSchemaEditing.WholeFileName(d.Alias));
            log.Check(LocalSchemaFile.IsWholeFileJson(exported), "it is a whole file");

            string dir = Path.Combine(Path.GetTempPath(), "rplocalschema-" + Guid.NewGuid().ToString("N"));
            try
            {
                LocalSchemaFile saved = LocalSchemaFile.Parse(onScreen);
                foreach (KeyValuePair<LocalSchemaTable, LocalSchemaForeignKey> pair in LocalSchemaEditing.IncompleteWrittenRelations(saved))
                    pair.Key.ForeignKeys.Remove(pair.Value);
                string path = LocalSchemaStore.PathFor(dir, "SHOP");
                LocalSchemaStore.Save(saved, path);
                log.Check(File.ReadAllText(path, Encoding.UTF8) == exported, "what Save writes");
            }
            finally
            {
                try { Directory.Delete(dir, true); } catch { }
            }

            LocalSchemaFile fresh = ShopCatalog();
            log.Check(!fresh.HasContent(), "an empty file of the same catalog");
            LocalSchemaImportAllResult result = fresh.ImportAll(LocalSchemaFile.Parse(exported), false);
            log.Check(result.Added == 2 && result.Replaced == 0 && result.Skipped.Count == 0, "two subschemas, nothing skipped: " +
                result.Added.ToString() + ", " + result.Replaced.ToString() + ", " + Joined(result.Skipped));
            log.Check(LocalSchemaStore.ToJson(fresh) == exported, "the same subschemas and dictionary: the same file");
        }

        // X.3 step 4: a relation of the database is found by its constraint name (any case), else by its ends; its empty
        // description leaves the one here; one that is not here is ignored. Step 5: a relation by hand with an end that is
        // not here is ignored, and not said
        private static void TestImportAllDatabaseRelations(LocalSchemaLog log)
        {
            Func<LocalSchemaForeignKey, LocalSchemaFile> import = fk =>
            {
                LocalSchemaFile f = ShopCatalog();
                LocalSchemaTable orders = LocalSchemaEditing.FindTable(f, "ORDERS");
                orders.ForeignKeys.Clear();
                orders.ForeignKeys.Add(fk);
                LocalSchemaFile d = ShopCatalog();
                LocalSchemaEditing.FindTable(d, "ORDERS").ForeignKeys[0].RelationshipContext = "D: who";
                LocalSchemaImportAllResult result = d.ImportAll(LocalSchemaFile.Parse(LocalSchemaStore.ToJson(f)), false);
                log.Check(result.Skipped.Count == 0 && Catalog(d) == ShopCatalogText, fk.ConstraintName + ": nothing skipped, the catalog the same: " +
                    Joined(result.Skipped) + " " + Catalog(d));
                return d;
            };
            LocalSchemaFile file = import(NewRelation("fk_orders_customers", "CUSTOMERS", "CUSTOMER_ID", "ID", "By name"));
            log.Check(RelationContext(file, "ORDERS", "FK_ORDERS_CUSTOMERS") == "By name", "by its constraint name, any case");
            file = import(NewRelation("OTHER_NAME", "customers", "customer_id", "id", "By ends"));
            log.Check(RelationContext(file, "ORDERS", "FK_ORDERS_CUSTOMERS") == "By ends", "else by its ends");
            file = import(NewRelation("FK_ORDERS_CUSTOMERS", "CUSTOMERS", "CUSTOMER_ID", "ID", ""));
            log.Check(RelationContext(file, "ORDERS", "FK_ORDERS_CUSTOMERS") == "D: who", "an empty description leaves the one here");
            file = import(NewRelation("FK_GONE", "PRODUCTS", "X", "ID", "Nowhere"));
            log.Check(RelationContext(file, "ORDERS", "FK_ORDERS_CUSTOMERS") == "D: who" && Written(file, "ORDERS") == "",
                "one that is not here is ignored");
            file = import(NewRelation("", "CUSTOMERS", "STATUS", "NOPE", "Half here"));
            log.Check(Written(file, "ORDERS") == "", "a relation by hand with an end that is not here is ignored");
            file = import(NewRelation("", "customers", "status", "y", "Spelled here"));
            log.Check(Written(file, "ORDERS") == "STATUS>CUSTOMERS.Y=Spelled here", "a relation by hand, as this file spells it: " + Written(file, "ORDERS"));
        }

        // X.2 Large catalog: the tables of the file whose columns this one has not read are read first; one the file did not
        // read either (in no subschema) is not
        private static void TestImportAllLargeCatalog(LocalSchemaLog log)
        {
            LocalSchemaFile f = LocalSchemaFile.Parse(ShopF());
            Func<LocalSchemaFile> large = () =>
            {
                LocalSchemaFile file = ShopCatalog();
                foreach (LocalSchemaTable t in file.Tables)
                {
                    if (t.Name == "ORDERS")
                        continue;
                    t.Columns.Clear();
                    t.ForeignKeys.Clear();
                    t.ColumnsRead = false;
                }
                return file;
            };
            LocalSchemaFile d = large();
            string before = LocalSchemaStore.ToJson(d);
            log.Check(Joined(d.UnreadTablesOf(f)) == "CUSTOMERS", "CUSTOMERS, not read here: " + Joined(d.UnreadTablesOf(f)));
            log.Check(LocalSchemaStore.ToJson(d) == before, "finding them changes nothing");
            log.Check(ShopCatalog().UnreadTablesOf(f).Count == 0 && d.UnreadTablesOf(null).Count == 0, "none when every table was read");

            // The file did not read CUSTOMERS either: nothing to read for it, unless a subschema of the file has it
            LocalSchemaFile notRead = LocalSchemaFile.Parse(ShopF());
            LocalSchemaTable customers = LocalSchemaEditing.FindTable(notRead, "CUSTOMERS");
            customers.Columns.Clear();
            customers.ForeignKeys.Clear();
            customers.ColumnsRead = false;
            log.Check(Joined(d.UnreadTablesOf(notRead)) == "CUSTOMERS", "a table of a subschema of the file is read");
            notRead.Schemas.RemoveAll(s => s.Name == "New");
            log.Check(d.UnreadTablesOf(notRead).Count == 0, "one the file did not read and no subschema has, not: " + Joined(d.UnreadTablesOf(notRead)));
            // The target of a relation by hand of the file is read
            notRead = LocalSchemaFile.Parse(ShopF());
            notRead.Schemas.Clear();
            LocalSchemaEditing.FindTable(notRead, "ORDERS").ForeignKeys.Add(NewRelation("", "products", "X", "ID", ""));
            LocalSchemaEditing.FindTable(notRead, "CUSTOMERS").ColumnsRead = false;
            LocalSchemaEditing.FindTable(notRead, "CUSTOMERS").ForeignKeys.Clear();
            log.Check(Joined(d.UnreadTablesOf(notRead)) == "PRODUCTS", "the target of a relation by hand: " + Joined(d.UnreadTablesOf(notRead)));

            // Read (the catalog's columns merged), the import is the one over the whole catalog
            LocalSchemaFile catalog = ShopCatalog();
            var read = new List<LocalSchemaTable>();
            foreach (string name in d.UnreadTablesOf(f))
                read.Add(LocalSchemaEditing.FindTable(catalog, name));
            log.Check(Joined(LocalSchemaStore.MergeColumns(d, read)) == "CUSTOMERS", "CUSTOMERS is read");
            LocalSchemaImportAllResult result = d.ImportAll(f, false);
            LocalSchemaFile whole = ShopCatalog();
            LocalSchemaImportAllResult expected = whole.ImportAll(LocalSchemaFile.Parse(ShopF()), false);
            log.Check(Sorted(result.Skipped) == Sorted(expected.Skipped) && Written(d, "CUSTOMERS") == Written(whole, "CUSTOMERS") &&
                SchemaNames(d) == SchemaNames(whole), "the same import: " + Joined(result.Skipped) + " / " + Written(d, "CUSTOMERS"));
            log.Check(!LocalSchemaStore.IsRead(LocalSchemaEditing.FindTable(d, "PRODUCTS")), "a table it does not use stays unread");
        }

        // X.5: the strings of the buttons, the question and the result
        private static void TestImportAllStrings(LocalSchemaLog log)
        {
            for (int i = 2043; i <= 2053; i++)
            {
                string text = DesignerText.Tr(i);
                log.Check(text.Length > 0 && text != "XXXXXXX", "the string " + i.ToString() + ": " + text);
            }
            log.Check(DesignerText.Format(2047, "3", "5").Contains("3") && DesignerText.Format(2047, "3", "5").Contains("5") &&
                !DesignerText.Format(2047, "3", "5").Contains("%"), "the question with its two numbers: " + DesignerText.Format(2047, "3", "5"));
            log.Check(!DesignerText.Format(2052, "2", "1").Contains("%"), "the result with its two numbers: " + DesignerText.Format(2052, "2", "1"));
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
