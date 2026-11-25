using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Reportman.Drawing;
using Reportman.Drawing.CrossPlatform;
using Reportman.Reporting;
using Reportman.Reporting.Design.Json;

// Reference outputs of the C# engine for the TypeScript port.
//
//   golden-cs model-json <report.rep> [out.json]
//       The report as read by ReportReader (no ConvertToDotNet), serialised with the designer's
//       camelCase JSON settings (ReportBatchJsonAdapter.ReportJsonSettings).
//
//   golden-cs eval <cases.json> [out.json] [--culture en-US] [--delphi]
//       cases.json: [{ "expr": "1+2", "format": "#,##0.00" }, ...]. For each case: the result
//       type, ToString(), the formatted text when a format is given, or the error.
//       --delphi evaluates and formats as in a report converted from Delphi
//       (Evaluator.DelphiMasks, set from BaseReport.ConvertedFromDelphi).
//
//   golden-cs run <report.rep> <out.metafile.json> [--pdf out.pdf] [--sqlite db]
//                 [--param NAME=value]... [--culture xx-XX] [--driver standard|freetype] [--fonts dir]
//                 [--rpmf out.rpmf] [--rpmfz out.rpmf] [--csv out.csv]
//                 [--text out.txt [--text-driver NAME] [--text-oem true|false] [--text-fullplain true]]
//       Runs the report measured and printed with PrintOutPDFStandard (standard 14 fonts, no
//       FreeType) and writes the metafile as JSON. Connections without a provider factory are
//       opened as SQLite (SQLiteCore) on the --sqlite file, read only.
//       --rpmf saves the metafile of the run in the binary .rpmf format (SaveToStream, not
//       compressed), --rpmfz the same compressed (zlib).
//       --csv out.csv writes PrintOutCSV.ExportToCSV of all the pages (',' and '"'; the line
//       ending is Environment.NewLine).
//       --text out.txt runs it with PrintOutText as the device instead (measured and written on
//       its character grid, no PDF) and saves the bytes it writes; --text-driver NAME forces the
//       printer driver (PLAIN by default: PLAINFULL, EPSON, IBMPROPRINTER, HP-PCL...) and
//       --text-oem true|false the OEM (cp850) conversion, else the printer configuration says;
//       --text-fullplain true sets FullPlain.
//       It prints the clock of the run (clock=yyyy-MM-ddTHH:mm:ss) for the dates of the report.
//       --connection ALIAS=Provider|ConnectionString opens that report connection with an
//       ADO.NET provider instead (Provider: SQLiteCore, PostgreSQL, FirebirdSql.Data.FirebirdClient,
//       MySQLConnector or SQLServer, the names Reportman.Server registers); it wins over --sqlite.
//
//   golden-cs encoding <codepage> [out.json]
//       How .NET writes text in a code page (Encoding.GetEncoding with CodePagesEncodingProvider),
//       the bytes of PrintOutText: every UTF-16 code unit that does not become '?', and the
//       strings of a few cases written directly (the code page of a driver) and through
//       Encoding.Convert from UTF-8 (the OEMConvert path).
//
//   golden-cs sql <Provider|ConnectionString> <sql> [out.json]
//       Runs a query with the provider and writes its schema (ColumnName, DataType name,
//       ColumnSize, DataTypeName) and rows as JSON: how the C# engine sees a database's types.
//
//   golden-cs barcode <cases.json> <out.json>
//       What the barcode item encodes for each case, without a report: the PDF417 codewords or
//       the bar pattern of a linear symbology (see Barcode below).
//
//   golden-cs write-xml <report.rep> <out.xml> [out.json]
//       The report read by ReportReader and written back as the designer's server saves it
//       (ReportBatchJsonAdapter.SerializeReport(report, Xml): EnsureComponentNames, StreamFormat
//       XML, BaseReport.SaveToStream, the bytes as a UTF-8 string). out.json: the model after the
//       save (the writer changes some parameter values), as model-json writes it.
//
//   golden-cs json-to-xml <report.json> <out.xml>
//       The designer's JSON document saved as the server does (JsonConvert.DeserializeObject with
//       ReportBatchJsonAdapter.ReportJsonSettings, Report.UpdateReferences, then
//       SerializeReport(report, Xml)).
//
//   golden-cs export-subreport <report.rep|report.json> <subreport index> <out.rep>
//       ExternalReport.ExportSubReport of that subreport, the bytes of its stream (XML, or zlib
//       when the report's stream format is XMLZlib). A .rep is read as the designer's server
//       reads one (LoadFromStream, UpdateReferences), a .json as json-to-xml reads it.
//
//   golden-cs import-report <target.rep|target.json> <source.rep> <out.json> <out.xml>
//       ExternalReport.ImportReport(target, source) as the designer's server imports a report: the
//       source read from its XML (LoadFromStream, UpdateReferences), the target from its XML or
//       from the designer's JSON (as json-to-xml reads it). out.json: the target after the import
//       with the designer's camelCase JSON settings (no EnsureComponentNames); out.xml: the target
//       then saved as write-xml saves. A target "-" is a new Report (the server's ImportEmpty).
//
//   golden-cs write-components <report.rep> <out.xml>
//       ReportWriter.WriteComponents of every component of the report (the designer's copy of
//       components), the report read by ReportReader.
//
//   golden-cs batch <jobs.json> <results.json>
//       Runs many of the commands above (model-json, write-xml, json-to-xml, export-subreport,
//       import-report, write-components) in one process: jobs.json is an array of argument arrays, results.json an
//       array with null for each job that succeeded or { type, message } of its exception.
class Program
{
    static int Main(string[] args)
    {
        try
        {
            if (args.Length < 2)
            {
                Console.Error.WriteLine("usage: golden-cs model-json|eval|run ...");
                return 2;
            }
            switch (args[0])
            {
                case "model-json": return ModelJson(args);
                case "eval": return Eval(args);
                case "run": return Run(args);
                case "culture-json": return CultureJson(args);
                case "sql": return Sql(args);
                case "text-extent": return TextExtent(args);
                case "encoding": return EncodingTable(args);
                case "shape": return Shape(args);
                case "lcmap": return LcMap(args);
                case "zxing-width": return ZxingWidth(args);
                case "delphi-dates": return DelphiDates(args);
                case "barcode": return Barcode(args);
                case "write-xml": return WriteXml(args);
                case "json-to-xml": return JsonToXml(args);
                case "export-subreport": return ExportSubReport(args);
                case "import-report": return ImportReport(args);
                case "batch": return Batch(args);
                case "write-components": return WriteComponents(args);
                default:
                    Console.Error.WriteLine("unknown command " + args[0]);
                    return 2;
            }
        }
        catch (Exception e)
        {
            Console.Error.WriteLine("ERROR " + e.GetType().FullName + ": " + e.Message);
            Console.Error.WriteLine(e.StackTrace);
            return 1;
        }
    }

    static string Option(string[] args, string name)
    {
        for (int i = 0; i < args.Length - 1; i++)
            if (args[i] == name)
                return args[i + 1];
        return null;
    }

    static void SetCulture(string[] args)
    {
        string culture = Option(args, "--culture") ?? "en-US";
        CultureInfo ci = CultureInfo.GetCultureInfo(culture);
        Thread.CurrentThread.CurrentCulture = ci;
        Thread.CurrentThread.CurrentUICulture = ci;
        CultureInfo.DefaultThreadCurrentCulture = ci;
        CultureInfo.DefaultThreadCurrentUICulture = ci;
    }

    static void Output(string text, string path)
    {
        if (path == null || path.StartsWith("--"))
            Console.Out.Write(text);
        else
            File.WriteAllText(path, text, new UTF8Encoding(false));
    }

    static int ModelJson(string[] args)
    {
        SetCulture(args);
        var report = new Report();
        report.LoadFromFile(args[1]);
        report.EnsureComponentNames();
        string json = JsonConvert.SerializeObject(report, Formatting.Indented,
            ReportBatchJsonAdapter.ReportJsonSettings);
        Output(json, args.Length > 2 ? args[2] : null);
        return 0;
    }

    // ---- The .rep XML writer ----

    static readonly ReportBatchJsonAdapter Adapter = new ReportBatchJsonAdapter();

    /// <summary>A .rep as the designer's server reads it (ReportDocumentService.FromXml: not converted to .Net).</summary>
    static Report ReportFromXml(string path)
    {
        var report = new Report();
        using (var stream = new MemoryStream(File.ReadAllBytes(path), false))
        {
            report.LoadFromStream(stream, false);
        }
        report.UpdateReferences();
        return report;
    }

    /// <summary>The designer's JSON document as the server's controller reads a request.</summary>
    static Report ReportFromJson(string path)
    {
        string json = File.ReadAllText(path, new UTF8Encoding(false));
        Report report = JsonConvert.DeserializeObject<Report>(json, ReportBatchJsonAdapter.ReportJsonSettings);
        report.UpdateReferences();
        return report;
    }

    static Report ReportFromFile(string path)
    {
        return path.EndsWith(".json", StringComparison.OrdinalIgnoreCase) ? ReportFromJson(path) : ReportFromXml(path);
    }

    /// <summary>The XML string SerializeReport gives, written as its UTF-8 bytes (no BOM).</summary>
    static void SaveXml(Report report, string path)
    {
        string xml = Adapter.SerializeReport(report, ReportDocumentFormat.Xml);
        File.WriteAllBytes(path, Encoding.UTF8.GetBytes(xml));
    }

    static int WriteXml(string[] args)
    {
        SetCulture(args);
        var report = new Report();
        report.LoadFromFile(args[1]);
        SaveXml(report, args[2]);
        if (args.Length > 3 && !args[3].StartsWith("--"))
        {
            string json = JsonConvert.SerializeObject(report, Formatting.Indented, ReportBatchJsonAdapter.ReportJsonSettings);
            Output(json, args[3]);
        }
        return 0;
    }

    static int JsonToXml(string[] args)
    {
        SetCulture(args);
        SaveXml(ReportFromJson(args[1]), args[2]);
        return 0;
    }

    static int WriteComponents(string[] args)
    {
        SetCulture(args);
        var report = new Report();
        report.LoadFromFile(args[1]);
        var items = new List<PrintPosItem>();
        foreach (SubReport subrep in report.SubReports)
            foreach (Section sec in subrep.Sections)
                items.AddRange(sec.Components);
        File.WriteAllBytes(args[2], Encoding.ASCII.GetBytes(ReportWriter.WriteComponents(items)));
        return 0;
    }

    static int ExportSubReport(string[] args)
    {
        SetCulture(args);
        Report report = ReportFromFile(args[1]);
        SubReport subreport = report.SubReports[int.Parse(args[2], CultureInfo.InvariantCulture)];
        using (var stream = new MemoryStream())
        {
            ExternalReport.ExportSubReport(subreport, stream);
            File.WriteAllBytes(args[3], stream.ToArray());
        }
        return 0;
    }

    static int Batch(string[] args)
    {
        JArray jobs = JArray.Parse(File.ReadAllText(args[1]));
        var results = new JArray();
        foreach (JArray job in jobs)
        {
            string[] jobArgs = job.ToObject<string[]>();
            try
            {
                switch (jobArgs[0])
                {
                    case "model-json": ModelJson(jobArgs); break;
                    case "write-xml": WriteXml(jobArgs); break;
                    case "json-to-xml": JsonToXml(jobArgs); break;
                    case "export-subreport": ExportSubReport(jobArgs); break;
                    case "import-report": ImportReport(jobArgs); break;
                    case "write-components": WriteComponents(jobArgs); break;
                    default: throw new ArgumentException("command not allowed in a batch: " + jobArgs[0]);
                }
                results.Add(JValue.CreateNull());
            }
            catch (Exception e)
            {
                results.Add(new JObject { ["type"] = e.GetType().FullName, ["message"] = e.Message });
            }
        }
        File.WriteAllText(args[2], results.ToString(Formatting.None), new UTF8Encoding(false));
        return 0;
    }

    static int ImportReport(string[] args)
    {
        SetCulture(args);
        Report target = args[1] == "-" ? new Report() : ReportFromFile(args[1]);
        Report source = ReportFromXml(args[2]);
        ExternalReport.ImportReport(target, source);
        string json = JsonConvert.SerializeObject(target, Formatting.Indented, ReportBatchJsonAdapter.ReportJsonSettings);
        Output(json, args[3]);
        SaveXml(target, args[4]);
        return 0;
    }

    static int Eval(string[] args)
    {
        SetCulture(args);
        // The cases of LOADFILE and GETINIVALUE read the files of the fixtures
        Evaluator.AllowFileFunctions = true;
        // As in a report converted from Delphi
        bool delphi = Array.IndexOf(args, "--delphi") >= 0;
        JArray cases = JArray.Parse(File.ReadAllText(args[1]));
        var results = new JArray();
        foreach (JObject c in cases)
        {
            var r = new JObject();
            string expr = (string)c["expr"];
            r["expr"] = expr;
            string format = (string)c["format"];
            if (format != null)
                r["format"] = format;
            try
            {
                var ev = new Evaluator();
                ev.DelphiMasks = delphi;
                ev.Expression = expr;
                Variant v = ev.Evaluate();
                r["type"] = v.VarType.ToString();
                r["text"] = v.ToString();
                if (format != null)
                    r["formatted"] = v.ToString(format, ParamType.Unknown, true, delphi);
            }
            catch (Exception e)
            {
                r["error"] = e.GetType().Name;
                r["message"] = e.Message;
            }
            results.Add(r);
        }
        Output(results.ToString(Formatting.Indented), args.Length > 2 ? args[2] : null);
        return 0;
    }

    static int Run(string[] args)
    {
        SetCulture(args);
        string sqlite = Option(args, "--sqlite");
        RegisterProviders();
        var connections = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (args[i] != "--connection")
                continue;
            string[] pair = args[i + 1].Split(new[] { '=' }, 2);
            connections[pair[0]] = pair[1].Split(new[] { '|' }, 2);
        }

        var report = new Report();
        report.LoadFromFile(args[1]);
        report.ConvertToDotNet();
        foreach (DatabaseInfo db in report.DatabaseInfo)
        {
            if (connections.TryGetValue(db.Alias, out string[] conn))
            {
                db.Driver = DriverType.DotNet2;
                db.LoadParams = false;
                db.ProviderFactory = conn[0];
                db.ConnectionString = conn[1];
            }
            // A MyBase connection (in-memory datasets, unions) opens no database
            else if (string.IsNullOrEmpty(db.ProviderFactory) && sqlite != null && db.Driver != DriverType.Mybase)
            {
                db.Driver = DriverType.DotNet2;
                db.LoadParams = false;
                db.ProviderFactory = "SQLiteCore";
                db.ConnectionString = "Data Source=" + Path.GetFullPath(sqlite) + ";Mode=ReadOnly";
            }
        }
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (args[i] != "--param")
                continue;
            string[] pair = args[i + 1].Split(new[] { '=' }, 2);
            Param p = report.Params[pair[0]];
            if (p == null)
                throw new Exception("Unknown parameter " + pair[0]);
            p.Value = pair[1];
        }
        report.AsyncExecution = false;

        string textPath = Option(args, "--text");
        if (textPath != null)
        {
            // PrintOutText is then the device of the run: the report is measured on its character
            // grid, so the layout (the metafile JSON) is not the one of the PDF. The driver is
            // forced, as the OEM conversion when asked, so no reportman.ini of the computer decides.
            var text = new PrintOutText();
            text.ForceDriverName = Option(args, "--text-driver") ?? "PLAIN";
            string oem = Option(args, "--text-oem");
            if (oem != null)
                text.OverrideOemConvert = oem == "true" ? PrintOutText.OemConvertOverride.True : PrintOutText.OemConvertOverride.False;
            text.FullPlain = Option(args, "--text-fullplain") == "true";
            // There is no PDF to take the creation date from: the clock of the run, for the dates
            // the report prints
            Console.WriteLine("clock=" + DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture));
            text.Print(report.MetaFile);
            File.WriteAllBytes(textPath, text.PrintResultStream.ToArray());
        }
        else
        {
            string pdfPath = Option(args, "--pdf");
            PrintOutPDFBase printer = CreatePrinter(args);
            printer.FileName = pdfPath ?? "";
            printer.Compressed = false;
            printer.Print(report.MetaFile);
        }

        Output(MetaFileJson(report.MetaFile).ToString(Formatting.Indented), args[2]);
        // After the JSON, so the options do not change it: saving gives every page the version
        // of the file and raises it for PrinterFonts = Recalculate
        SaveRpmf(report.MetaFile, Option(args, "--rpmf"), false);
        SaveRpmf(report.MetaFile, Option(args, "--rpmfz"), true);
        string csvPath = Option(args, "--csv");
        if (csvPath != null)
            File.WriteAllText(csvPath, PrintOutCSV.ExportToCSV(report.MetaFile, true, 1, 1, ",", '"'), new UTF8Encoding(false));
        Console.WriteLine("pages=" + report.MetaFile.Pages.Count);
        return 0;
    }

    static void SaveRpmf(MetaFile meta, string path, bool compressed)
    {
        if (path == null)
            return;
        using (var file = new FileStream(path, FileMode.Create, FileAccess.Write))
        {
            meta.SaveToStream(file, compressed);
        }
    }

    // --driver standard (default): PrintOutPDFStandard, the 14 standard fonts, no font provider.
    // --driver freetype: PrintOutPDFFreeType, the cross-platform driver of the C# engine (FreeType,
    // HarfBuzz, ICU; fonts from the system font folders and --fonts <dir>), the one Reportman.Server
    // uses: TrueType fonts embedded and subset, shaping, bidi, HTML text, PDF/A.
    static PrintOutPDFBase CreatePrinter(string[] args)
    {
        string driver = Option(args, "--driver") ?? "standard";
        string fonts = Option(args, "--fonts");
        if (fonts != null)
            FontInfoFt.ExtraFontDirectories.Add(Path.GetFullPath(fonts));
        switch (driver)
        {
            case "standard": return new PrintOutPDFStandard();
            case "freetype": return new PrintOutPDFFreeType();
            default: throw new Exception("Unknown driver " + driver);
        }
    }

    // The ADO.NET providers of Reportman.Server (DirectProviders.cs), by the same invariant names.
    static void RegisterProviders()
    {
        DatabaseInfo.CustomProviderFactories["SQLiteCore"] = Microsoft.Data.Sqlite.SqliteFactory.Instance;
        DatabaseInfo.CustomProviderFactories["PostgreSQL"] = Npgsql.NpgsqlFactory.Instance;
        DatabaseInfo.CustomProviderFactories["FirebirdSql.Data.FirebirdClient"] = FirebirdSql.Data.FirebirdClient.FirebirdClientFactory.Instance;
        DatabaseInfo.CustomProviderFactories["MySQLConnector"] = MySqlConnector.MySqlConnectorFactory.Instance;
        DatabaseInfo.CustomProviderFactories["SQLServer"] = Microsoft.Data.SqlClient.SqlClientFactory.Instance;
    }

    static int Sql(string[] args)
    {
        SetCulture(args);
        RegisterProviders();
        string[] conn = args[1].Split(new[] { '|' }, 2);
        System.Data.Common.DbProviderFactory factory = DatabaseInfo.CustomProviderFactories[conn[0]];
        using (System.Data.Common.DbConnection connection = factory.CreateConnection())
        {
            connection.ConnectionString = conn[1];
            connection.Open();
            using (System.Data.Common.DbCommand command = connection.CreateCommand())
            {
                command.CommandText = args[2];
                using (System.Data.Common.DbDataReader reader = command.ExecuteReader())
                {
                    var result = new JObject();
                    var columns = new JArray();
                    System.Data.DataTable schema = reader.GetSchemaTable();
                    foreach (System.Data.DataRow row in schema.Rows)
                    {
                        columns.Add(new JObject
                        {
                            ["columnName"] = row["ColumnName"]?.ToString(),
                            ["dataType"] = (row["DataType"] as Type)?.Name,
                            ["columnSize"] = row["ColumnSize"] == DBNull.Value ? null : JToken.FromObject(row["ColumnSize"]),
                            ["dataTypeName"] = schema.Columns.Contains("DataTypeName") ? row["DataTypeName"]?.ToString() : null,
                        });
                    }
                    result["columns"] = columns;
                    var rows = new JArray();
                    while (reader.Read())
                    {
                        var jr = new JArray();
                        for (int i = 0; i < reader.FieldCount; i++)
                        {
                            object v = reader.GetValue(i);
                            if (v == DBNull.Value) jr.Add(JValue.CreateNull());
                            else if (v is byte[] b) jr.Add(Convert.ToBase64String(b));
                            else if (v is DateTime d) jr.Add(d.ToString("yyyy-MM-ddTHH:mm:ss.fffffff", CultureInfo.InvariantCulture));
                            else if (v is decimal m) jr.Add(m.ToString(CultureInfo.InvariantCulture));
                            else jr.Add(new JValue(v.GetType().Name + ":" + Convert.ToString(v, CultureInfo.InvariantCulture)));
                        }
                        rows.Add(jr);
                    }
                    result["rows"] = rows;
                    Output(result.ToString(Formatting.Indented), args.Length > 3 ? args[3] : null);
                }
            }
        }
        return 0;
    }

    // golden-cs culture-json <culture>[,<culture>...] [out.json]
    //     The .NET number and date format data of each culture, so the TypeScript port can format
    //     exactly as the C# engine does under Thread.CurrentCulture.
    static int CultureJson(string[] args)
    {
        var result = new JObject();
        foreach (string name in args[1].Split(','))
        {
            CultureInfo ci = CultureInfo.GetCultureInfo(name);
            NumberFormatInfo nf = ci.NumberFormat;
            DateTimeFormatInfo df = ci.DateTimeFormat;
            var j = new JObject();
            j["name"] = ci.Name;
            j["twoLetterISOLanguageName"] = ci.TwoLetterISOLanguageName;
            j["number"] = JObject.FromObject(new
            {
                nf.NumberDecimalSeparator, nf.NumberGroupSeparator, nf.NumberGroupSizes,
                nf.NumberDecimalDigits, nf.NumberNegativePattern,
                nf.CurrencyDecimalSeparator, nf.CurrencyGroupSeparator, nf.CurrencyGroupSizes,
                nf.CurrencyDecimalDigits, nf.CurrencySymbol, nf.CurrencyPositivePattern,
                nf.CurrencyNegativePattern,
                nf.PercentDecimalSeparator, nf.PercentGroupSeparator, nf.PercentGroupSizes,
                nf.PercentDecimalDigits, nf.PercentSymbol, nf.PerMilleSymbol,
                nf.PercentPositivePattern, nf.PercentNegativePattern,
                nf.NegativeSign, nf.PositiveSign, nf.NaNSymbol,
                nf.PositiveInfinitySymbol, nf.NegativeInfinitySymbol
            });
            j["date"] = JObject.FromObject(new
            {
                df.ShortDatePattern, df.LongDatePattern, df.ShortTimePattern, df.LongTimePattern,
                df.FullDateTimePattern, df.MonthDayPattern, df.YearMonthPattern,
                df.DateSeparator, df.TimeSeparator, df.AMDesignator, df.PMDesignator,
                df.FirstDayOfWeek, df.DayNames, df.AbbreviatedDayNames, df.MonthNames,
                df.AbbreviatedMonthNames, df.MonthGenitiveNames, df.AbbreviatedMonthGenitiveNames
            });
            result[ci.Name] = j;
        }
        Output(result.ToString(Formatting.Indented), args.Length > 2 ? args[2] : null);
        return 0;
    }

    // golden-cs text-extent <cases.json> [out.json]
    //     cases.json: [{ "text": "...", "fontSize": 10, "fontStyle": 0, "type1Font": 0,
    //     "wordWrap": true, "alignment": 0, "cutText": false, "width": 2000, "height": 0 }, ...]
    //     For each case, PrintOutPDFStandard.TextExtent (twips) and the LineInfo list.
    // golden-cs shape <font file> <rtl 0|1> <script|-> <text file, UTF-8> [face index] [scale]
    //   The glyphs HarfBuzz gives for a text as FontInfoFt.DarForma shapes it (the scale in units
    //   per em, or the scale given, the OpenType functions, the language "ar" for Arab), one line per glyph:
    //   codepoint xAdvance xOffset yOffset cluster, at the scale.
    static int Shape(string[] args)
    {
        bool rightToLeft = args[2] == "1";
        string script = args[3];
        string text = File.ReadAllText(args[4], new UTF8Encoding(false));
        int faceIndex = args.Length > 5 ? int.Parse(args[5], CultureInfo.InvariantCulture) : 0;
        using (var blob = HarfBuzzSharp.Blob.FromFile(args[1]))
        using (var face = new HarfBuzzSharp.Face(blob, faceIndex))
        using (var font = new HarfBuzzSharp.Font(face))
        using (var buffer = new HarfBuzzSharp.Buffer())
        {
            int scale = args.Length > 6 ? int.Parse(args[6], CultureInfo.InvariantCulture) : face.UnitsPerEm;
            font.SetScale(scale, scale);
            font.SetFunctionsOpenType();
            buffer.Direction = rightToLeft ? HarfBuzzSharp.Direction.RightToLeft : HarfBuzzSharp.Direction.LeftToRight;
            if (script != "-")
            {
                buffer.Script = HarfBuzzSharp.Script.Parse(script);
                if (script == "Arab")
                    buffer.Language = new HarfBuzzSharp.Language("ar");
            }
            buffer.AddUtf16(text);
            font.Shape(buffer);
            var infos = buffer.GlyphInfos;
            var positions = buffer.GlyphPositions;
            for (int i = 0; i < infos.Length; i++)
                Console.WriteLine(string.Join(" ", infos[i].Codepoint, positions[i].XAdvance, positions[i].XOffset, positions[i].YOffset, infos[i].Cluster));
        }
        return 0;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern int LCMapStringEx(string locale, uint flags, string source, int sourceLength, [Out] char[] destination,
        int destinationLength, IntPtr version, IntPtr reserved, IntPtr sortHandle);

    static string MapChinese(string text, uint flags)
    {
        // LCMapStringEx refuses an empty text (ERROR_INVALID_PARAMETER); LCMapString with -1 gives ""
        if (text.Length == 0) return text;
        int n = LCMapStringEx("zh-CN", flags, text, text.Length, null, 0, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
        if (n <= 0) throw new Exception("LCMapStringEx failed: " + Marshal.GetLastWin32Error());
        var buffer = new char[n];
        LCMapStringEx("zh-CN", flags, text, text.Length, buffer, n, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
        return new string(buffer, 0, n);
    }

    // golden-cs lcmap <out.json> [text...]
    //   What Windows gives the Delphi functions CHSTOCHT and CHTTOCHS (LCMapString of the locale
    //   zh-CN with LCMAP_TRADITIONAL_CHINESE and LCMAP_SIMPLIFIED_CHINESE): every UTF-16 code unit
    //   but the surrogates that one of the two changes, as { "traditional": { code: text },
    //   "simplified": { code: text } }, and the texts given mapped whole ("texts").
    /// <summary>
    /// zxing-width CASES.json OUT.json: the modules of a linear barcode as BarcodeItem.EmitNativeBarcode
    /// takes them from ZXing.Net (MultiFormatWriter, no margin: the width of the symbol), or null
    /// where the writer refuses the text and the item draws its bars. CASES is an array of
    /// { "symbology": a MetaBarcodeSymbology name, "text" }.
    /// </summary>
    static int ZxingWidth(string[] args)
    {
        JArray cases = JArray.Parse(File.ReadAllText(args[1]));
        var results = new JArray();
        foreach (JObject c in cases)
        {
            ZXing.BarcodeFormat format;
            switch ((string)c["symbology"])
            {
                case "Code128": format = ZXing.BarcodeFormat.CODE_128; break;
                case "EAN13": format = ZXing.BarcodeFormat.EAN_13; break;
                case "EAN8": format = ZXing.BarcodeFormat.EAN_8; break;
                case "Code39": format = ZXing.BarcodeFormat.CODE_39; break;
                case "Code93": format = ZXing.BarcodeFormat.CODE_93; break;
                case "ITF": format = ZXing.BarcodeFormat.ITF; break;
                case "Codabar": format = ZXing.BarcodeFormat.CODABAR; break;
                default: throw new ArgumentException("symbology " + (string)c["symbology"]);
            }
            var hints = new Dictionary<ZXing.EncodeHintType, object> { { ZXing.EncodeHintType.MARGIN, 0 } };
            try
            {
                ZXing.Common.BitMatrix m = new ZXing.MultiFormatWriter().encode((string)c["text"], format, 0, 0, hints);
                results.Add(m.Width);
            }
            catch
            {
                results.Add(JValue.CreateNull());
            }
        }
        File.WriteAllText(args[2], results.ToString(Formatting.None), new UTF8Encoding(false));
        return 0;
    }

    /// <summary>
    /// barcode CASES.json OUT.json: what the barcode item encodes, without running a report. CASES
    /// is an array of { "type": a BarcodeType name, "text", "checksum", "ratio", "ecc", "rows",
    /// "cols" } (all but type and text optional). For CodePDF417 the result is { "rows", "cols",
    /// "data" (the count of data codewords, the first one), "codewords" (data, padding and error
    /// correction) }; for the linear symbologies { "pattern" }, the bars and spaces of
    /// BarcodeItem.CalculateBarcode ('5'-'8' bars, '0'-'3' spaces, 'A'-'D' short bars); or { "error" }.
    /// </summary>
    static int Barcode(string[] args)
    {
        JArray cases = JArray.Parse(File.ReadAllText(args[1]));
        var results = new JArray();
        Type encoder = typeof(BarcodeItem).Assembly.GetType("Reportman.Reporting.PDF417Encoder", true);
        System.Reflection.MethodInfo generate = encoder.GetMethod("GenerateCodewords",
            System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
        foreach (JObject c in cases)
        {
            var r = new JObject();
            try
            {
                BarcodeType type = (BarcodeType)Enum.Parse(typeof(BarcodeType), (string)c["type"]);
                string text = (string)c["text"];
                if (type == BarcodeType.CodePDF417)
                {
                    object[] p = { text, (int?)c["ecc"] ?? -1, (int?)c["rows"] ?? 0, (int?)c["cols"] ?? 0, null, 0, 0, 0, 0, 0 };
                    generate.Invoke(null, p);
                    int[] codewords = (int[])p[4];
                    int xSize = (int)p[5], ySize = (int)p[6];
                    r["rows"] = ySize;
                    r["cols"] = xSize;
                    r["data"] = codewords[0];
                    var list = new JArray();
                    for (int i = 0; i < xSize * ySize; i++)
                        list.Add(codewords[i]);
                    r["codewords"] = list;
                }
                else
                {
                    var item = new BarcodeItem();
                    item.BarType = type;
                    item.Checksum = (bool?)c["checksum"] ?? false;
                    item.Ratio = (double?)c["ratio"] ?? 2.0;
                    item.CurrentText = text;
                    r["pattern"] = item.CalculateBarcode();
                }
            }
            catch (Exception e)
            {
                Exception inner = e is System.Reflection.TargetInvocationException && e.InnerException != null ? e.InnerException : e;
                r["error"] = inner.Message;
            }
            results.Add(r);
        }
        File.WriteAllText(args[2], results.ToString(Formatting.None), new UTF8Encoding(false));
        return 0;
    }

    /// <summary>
    /// delphi-dates CASES.json OUT.json: the date masks of a report converted from Delphi, as the C#
    /// engine formats them (DelphiDateFormat with the format settings of the culture). CASES is an
    /// array of { "culture" ('' the invariant one), "mask", "value" (an OLE date) }.
    /// </summary>
    static int DelphiDates(string[] args)
    {
        JArray cases = JArray.Parse(File.ReadAllText(args[1]));
        var results = new JArray();
        foreach (JObject c in cases)
        {
            string name = (string)c["culture"];
            CultureInfo culture = name.Length == 0 ? CultureInfo.InvariantCulture : CultureInfo.GetCultureInfo(name);
            DateTime value = DateTime.FromOADate((double)c["value"]);
            results.Add(DelphiDateFormat.Format(value, (string)c["mask"], DelphiDateFormat.SettingsFor(culture)));
        }
        File.WriteAllText(args[2], results.ToString(Formatting.None), new UTF8Encoding(false));
        return 0;
    }

    static int LcMap(string[] args)
    {
        const uint TRADITIONAL = 0x04000000;
        const uint SIMPLIFIED = 0x02000000;
        var result = new JObject();
        foreach (var (name, flags) in new[] { ("traditional", TRADITIONAL), ("simplified", SIMPLIFIED) })
        {
            var map = new JObject();
            for (int c = 1; c < 0x10000; c++)
            {
                if (c >= 0xD800 && c < 0xE000) continue;
                string one = ((char)c).ToString();
                string mapped = MapChinese(one, flags);
                if (mapped != one) map[c.ToString(CultureInfo.InvariantCulture)] = mapped;
            }
            result[name] = map;
        }
        var texts = new JArray();
        for (int i = 2; i < args.Length; i++)
            texts.Add(new JObject { ["text"] = args[i], ["traditional"] = MapChinese(args[i], TRADITIONAL), ["simplified"] = MapChinese(args[i], SIMPLIFIED) });
        result["texts"] = texts;
        File.WriteAllText(args[1], result.ToString(Formatting.None), new UTF8Encoding(false));
        return 0;
    }

    static int TextExtent(string[] args)
    {
        SetCulture(args);
        JArray cases = JArray.Parse(File.ReadAllText(args[1]));
        PrintOutPDFBase printer = CreatePrinter(args);
        printer.FileName = "";
        var meta = new MetaFile();
        printer.NewDocument(meta);
        var results = new JArray();
        foreach (JObject c in cases)
        {
            var t = new TextObjectStruct();
            t.Text = (string)c["text"];
            t.LFontName = (string)c["lFontName"] ?? "Helvetica";
            t.WFontName = (string)c["wFontName"] ?? "Arial";
            t.FontSize = (short)((int?)c["fontSize"] ?? 10);
            t.FontStyle = (short)((int?)c["fontStyle"] ?? 0);
            t.FontRotation = (short)((int?)c["fontRotation"] ?? 0);
            t.Type1Font = (PDFFontType)((int?)c["type1Font"] ?? 0);
            t.WordWrap = (bool?)c["wordWrap"] ?? false;
            t.CutText = (bool?)c["cutText"] ?? false;
            t.Alignment = (int?)c["alignment"] ?? 0;
            t.RightToLeft = false;
            t.IsHtml = false;
            var extent = new System.Drawing.Point((int?)c["width"] ?? 0, (int?)c["height"] ?? 0);
            var r = new JObject();
            r["case"] = c;
            try
            {
                var extent2 = extent;
                List<LineInfo> lines = printer.TextExtentLineInfo(t, ref extent2);
                var extent1 = printer.TextExtent(t, extent);
                r["extent"] = new JArray(extent1.X, extent1.Y);
                r["lineExtent"] = new JArray(extent2.X, extent2.Y);
                var jl = new JArray();
                if (lines != null)
                    foreach (LineInfo li in lines)
                        jl.Add(new JObject
                        {
                            ["position"] = li.Position, ["size"] = li.Size, ["width"] = li.Width,
                            ["height"] = li.Height, ["topPos"] = li.TopPos,
                            ["lastLine"] = li.LastLine, ["lineHeight"] = li.LineHeight,
                            ["text"] = li.Text
                        });
                r["lines"] = jl;
            }
            catch (Exception e)
            {
                r["error"] = e.GetType().Name + ": " + e.Message;
            }
            results.Add(r);
        }
        Output(results.ToString(Formatting.Indented), args.Length > 2 ? args[2] : null);
        return 0;
    }

    static int EncodingTable(string[] args)
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        int codepage = int.Parse(args[1], CultureInfo.InvariantCulture);
        Encoding encoding = Encoding.GetEncoding(codepage);
        var result = new JObject();
        result["codepage"] = codepage;
        // [code unit, byte, byte...] for each code unit outside the surrogates that is not '?'
        var map = new JArray();
        for (int c = 0; c < 0x10000; c++)
        {
            if (c >= 0xD800 && c <= 0xDFFF)
                continue;
            byte[] b = encoding.GetBytes(new string((char)c, 1));
            if (c != '?' && b.Length == 1 && b[0] == '?')
                continue;
            var entry = new JArray(c);
            foreach (byte x in b)
                entry.Add(x);
            map.Add(entry);
        }
        result["map"] = map;
        // The other way: the code units GetString gives for each byte alone
        var decode = new JArray();
        for (int b = 0; b < 256; b++)
        {
            var units = new JArray();
            foreach (char ch in encoding.GetString(new byte[] { (byte)b }))
                units.Add((int)ch);
            decode.Add(units);
        }
        result["decode"] = decode;
        // Surrogates, alone and in pairs, and a mix: what each path writes
        string[] samples = { "A😀B", "A\uD83DB", "A\uDE00B", "\uD83D", "á€ā中�", "é" };
        var cases = new JArray();
        foreach (string s in samples)
        {
            var units = new JArray();
            foreach (char ch in s)
                units.Add((int)ch);
            cases.Add(new JObject
            {
                ["units"] = units,
                ["direct"] = ByteArray(encoding.GetBytes(s)),
                ["convert"] = ByteArray(Encoding.Convert(Encoding.UTF8, encoding, Encoding.UTF8.GetBytes(s))),
                ["utf8"] = ByteArray(Encoding.UTF8.GetBytes(s)),
            });
        }
        result["cases"] = cases;
        Output(result.ToString(Formatting.None), args.Length > 2 ? args[2] : null);
        return 0;
    }

    static JArray ByteArray(byte[] bytes)
    {
        var result = new JArray();
        foreach (byte b in bytes)
            result.Add((int)b);
        return result;
    }

    static JObject MetaFileJson(MetaFile meta)
    {
        var result = new JObject();
        result["pageSizeIndex"] = meta.PageSizeIndex;
        result["customX"] = meta.CustomX;
        result["customY"] = meta.CustomY;
        result["orientation"] = meta.Orientation.ToString();
        result["backColor"] = meta.BackColor;
        result["docAuthor"] = meta.DocAuthor;
        result["docTitle"] = meta.DocTitle;
        result["docSubject"] = meta.DocSubject;
        result["docProducer"] = meta.DocProducer;
        result["docCreator"] = meta.DocCreator;
        result["docKeywords"] = meta.DocKeywords;
        result["docXMPContent"] = meta.DocXMPContent;
        result["docCreationDate"] = meta.DocCreationDate;
        result["docModificationDate"] = meta.DocModificationDate;
        result["pdfConformance"] = meta.PDFConformance.ToString();
        result["pdfCompressed"] = meta.PDFCompressed;
        var pages = new JArray();
        for (int i = 0; i < meta.Pages.Count; i++)
        {
            MetaPage page = meta.Pages[i];
            var jpage = new JObject();
            jpage["orientation"] = page.Orientation.ToString();
            jpage["updatedPageSize"] = page.UpdatedPageSize;
            jpage["pageDetail"] = JObject.FromObject(page.PageDetail);
            var objects = new JArray();
            foreach (MetaObject obj in page.Objects)
            {
                JObject jo = JObject.FromObject(obj);
                jo.AddFirst(new JProperty("class", obj.GetType().Name));
                if (obj is MetaObjectText text)
                {
                    jo["text"] = page.GetText(text);
                    jo["lFontName"] = PoolString(page, text.LFontNameP, text.LFontNameS);
                    jo["wFontName"] = PoolString(page, text.WFontNameP, text.WFontNameS);
                }
                if (obj is MetaObjectExport export)
                    jo["textExp"] = PoolString(page, export.TextExpP, export.TextExpS);
                if (obj.AnnotationS > 0)
                    jo["annotation"] = PoolString(page, obj.AnnotationP, obj.AnnotationS);
                objects.Add(jo);
            }
            jpage["objects"] = objects;
            pages.Add(jpage);
        }
        result["pages"] = pages;
        return result;
    }

    static string PoolString(MetaPage page, int position, int size)
    {
        if (size <= 0)
            return "";
        return new string(page.Pool, position - 1, size);
    }
}
