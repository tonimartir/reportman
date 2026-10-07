using System.Text;
using Reportman.Reporting;

// REPORT PARAMETERS: INITIAL EXPRESSIONS AND VALIDATION (07-10-2026).
//
// Two differences with the Delphi engine that a parameters form outside Report Manager (a web form)
// runs into:
//
//  1. An initial-expression parameter (ParamType.InitialValue) was never evaluated: the report
//     bound the expression TEXT as the parameter's value. Delphi evaluates it before showing the
//     parameters form and before printing, turns the parameter into one of the result's type, and
//     puts the expression back when the report is saved.
//  2. CheckParameters evaluated each Validation against LastValue, which is the previous run's
//     value: the values the user had just entered were never validated.

namespace ParamsTest
{
    static class Program
    {
        static int failures;

        static void Check(bool ok, string name, string detail = "")
        {
            if (ok) Console.WriteLine("[PASS] " + name);
            else { Console.WriteLine("[FAIL] " + name + (detail.Length > 0 ? " -> " + detail : "")); failures++; }
        }

        static Param AddParam(Report report, string alias, ParamType type, Variant value)
        {
            var p = new Param
            {
                Report = report,
                Name = "TRPPARAM" + (report.Params.Count + 1),
                Alias = alias,
                ParamType = type,
                Visible = true,
            };
            p.Value = value;
            report.Params.Add(p);
            return p;
        }

        static int Main()
        {
            Console.OutputEncoding = Encoding.UTF8;
            try
            {
                // 0. The type an initial expression turns into, as Delphi's VariantTypeToParamType.
                Check(Param.ParamTypeOf(new DateTime(2026, 10, 7)) == ParamType.Date, "whole date -> Date");
                Check(Param.ParamTypeOf(new DateTime(2026, 10, 7, 9, 30, 0)) == ParamType.DateTime, "date with a time of day -> DateTime");
                Check(Param.ParamTypeOf(new DateTime(1899, 12, 30, 9, 30, 0)) == ParamType.Time, "time of day only -> Time");
                Check(Param.ParamTypeOf(5) == ParamType.Integer, "int -> Integer");
                Check(Param.ParamTypeOf(5L) == ParamType.Integer, "long -> Integer");
                Check(Param.ParamTypeOf(2.5) == ParamType.Double, "double -> Double");
                Check(Param.ParamTypeOf(2.5m) == ParamType.Currency, "decimal -> Currency");
                Check(Param.ParamTypeOf(true) == ParamType.Bool, "bool -> Bool");
                Check(Param.ParamTypeOf("abc") == ParamType.String, "string -> String");
                Check(Param.ParamTypeOf(new Variant()) == ParamType.Unknown, "null -> Unknown");

                // 1. Initial expressions.
                var report = new Report();
                Param today = AddParam(report, "FROMDATE", ParamType.InitialValue, "TODAY");
                Param sum = AddParam(report, "COUNT", ParamType.InitialValue, "2+3");
                report.UpdateInitialValues();
                Check(today.ParamType == ParamType.Date, "TODAY becomes a Date parameter", today.ParamType.ToString());
                Check(today.Value.VarType == VariantType.DateTime && ((DateTime)today.Value).Date == DateTime.Today,
                    "TODAY holds today's date", today.Value.ToString());
                Check(sum.ParamType == ParamType.Integer || sum.ParamType == ParamType.Double,
                    "2+3 becomes a number parameter", sum.ParamType.ToString());
                Check(Convert.ToDouble(sum.Value.AsObject()) == 5, "2+3 holds 5", sum.Value.ToString());

                // …and saving keeps the expression, not today's date.
                byte[] saved;
                using (var ms = new MemoryStream())
                {
                    report.SaveToStream(ms);
                    saved = ms.ToArray();
                }
                Check(today.ParamType == ParamType.InitialValue && today.Value.AsString == "TODAY",
                    "saving restores the expression in memory", today.ParamType + " " + today.Value);
                var reloaded = new Report();
                using (var ms = new MemoryStream(saved))
                    reloaded.LoadFromStream(ms);
                Param reloadedToday = reloaded.Params["FROMDATE"];
                Check(reloadedToday.ParamType == ParamType.InitialValue && reloadedToday.Value.AsString == "TODAY",
                    "the saved report keeps the initial expression", reloadedToday.ParamType + " " + reloadedToday.Value);

                // Printing without a parameters form: the value bound is the date, not the text "TODAY".
                reloaded.InitEvaluator();
                reloaded.InitializeParams();
                Check(reloadedToday.LastValue.VarType == VariantType.DateTime && ((DateTime)reloadedToday.LastValue).Date == DateTime.Today,
                    "InitializeParams binds the expression's result", reloadedToday.LastValue.ToString());

                // 2. Validation sees the values just entered.
                var validated = new Report();
                Param amount = AddParam(validated, "AMOUNT", ParamType.Integer, 5);
                amount.Validation = "AMOUNT>10";
                amount.ErrorMessage = "The amount must be greater than 10";
                Check(validated.CheckParameters() == "AMOUNT", "5 fails AMOUNT>10");
                amount.Value = 20;
                Check(validated.CheckParameters() == "", "20 passes AMOUNT>10 (the previous run's 5 is not what is checked)");
                amount.Value = 3;
                Check(validated.CheckParameters() == "AMOUNT", "3 fails again");

                // A list parameter is validated with the value it will bind.
                Param kind = AddParam(validated, "KIND", ParamType.List, "'B'");
                kind.Items.Add("Sales"); kind.Values.Add("'S'");
                kind.Items.Add("Purchases"); kind.Values.Add("'B'");
                kind.Validation = "KIND='S'";
                amount.Value = 20;
                Check(validated.CheckParameters() == "KIND", "list value 'B' fails KIND='S'");
                kind.Value = "'S'";
                Check(validated.CheckParameters() == "", "list value 'S' passes KIND='S'");
            }
            catch (Exception ex)
            {
                Console.WriteLine("[FAIL] unexpected exception: " + ex);
                failures++;
            }
            Console.WriteLine(failures == 0 ? "ALL PASSED" : failures + " FAILED");
            return failures == 0 ? 0 : 1;
        }
    }
}
