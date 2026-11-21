using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
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
//   golden-cs eval <cases.json> [out.json] [--culture en-US]
//       cases.json: [{ "expr": "1+2", "format": "#,##0.00" }, ...]. For each case: the result
//       type, ToString(), the formatted text when a format is given, or the error.
//
//   golden-cs run <report.rep> <out.metafile.json> [--pdf out.pdf] [--sqlite db]
//                 [--param NAME=value]... [--culture xx-XX]
//       Runs the report measured and printed with PrintOutPDFStandard (standard 14 fonts, no
//       FreeType) and writes the metafile as JSON. Connections without a provider factory are
//       opened as SQLite (SQLiteCore) on the --sqlite file, read only.
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
                case "text-extent": return TextExtent(args);
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

    static int Eval(string[] args)
    {
        SetCulture(args);
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
                ev.Expression = expr;
                Variant v = ev.Evaluate();
                r["type"] = v.VarType.ToString();
                r["text"] = v.ToString();
                if (format != null)
                    r["formatted"] = v.ToString(format, ParamType.Unknown, true);
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
        DatabaseInfo.CustomProviderFactories["SQLiteCore"] = Microsoft.Data.Sqlite.SqliteFactory.Instance;

        var report = new Report();
        report.LoadFromFile(args[1]);
        report.ConvertToDotNet();
        foreach (DatabaseInfo db in report.DatabaseInfo)
        {
            if (string.IsNullOrEmpty(db.ProviderFactory) && sqlite != null)
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

        string pdfPath = Option(args, "--pdf");
        var printer = new PrintOutPDFStandard();
        printer.FileName = pdfPath ?? "";
        printer.Compressed = false;
        printer.Print(report.MetaFile);

        Output(MetaFileJson(report.MetaFile).ToString(Formatting.Indented), args[2]);
        Console.WriteLine("pages=" + report.MetaFile.Pages.Count);
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
    static int TextExtent(string[] args)
    {
        SetCulture(args);
        JArray cases = JArray.Parse(File.ReadAllText(args[1]));
        var printer = new PrintOutPDFStandard();
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

    static JObject MetaFileJson(MetaFile meta)
    {
        var result = new JObject();
        result["pageSizeIndex"] = meta.PageSizeIndex;
        result["customX"] = meta.CustomX;
        result["customY"] = meta.CustomY;
        result["orientation"] = meta.Orientation.ToString();
        result["backColor"] = meta.BackColor;
        var pages = new JArray();
        for (int i = 0; i < meta.Pages.Count; i++)
        {
            MetaPage page = meta.Pages[i];
            var jpage = new JObject();
            jpage["orientation"] = page.Orientation.ToString();
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
