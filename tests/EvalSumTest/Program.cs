using System.Globalization;
using System.Text;
using Reportman.Reporting;

// A NUMBER PLUS A TEXT IN AN EXPRESSION (18-11-2026).
//
// POSTEN+UPOS (POSTEN a number, UPOS a text such as 'a') raised "Variant+ Integer-String" here,
// and even 10+'7' raised it, which the Delphi engine adds (17). Now the + of an expression
// (Variant.ExpressionSum, as SumTRpValue in Delphi) gives the sum when the text is a number, read
// as Delphi reads it, and otherwise both texts joined, the number written as STR() writes it:
// POSTEN+UPOS is '10a', as STR(POSTEN)+UPOS. Booleans and dates with a text, and the other
// operators, still raise the error, and so does the + of two variants that the aggregates use, as
// in Delphi.
//
// The same rule and checks are in the Delphi engine (rptypeval.pas, tests/eval_sum_test).

namespace EvalSumTest
{
    static class Program
    {
        static int failures;

        static void Check(bool ok, string name, string detail = "")
        {
            if (ok) Console.WriteLine("[PASS] " + name);
            else { Console.WriteLine("[FAIL] " + name + (detail.Length > 0 ? " -> " + detail : "")); failures++; }
        }

        static string Describe(Variant v)
        {
            return v.VarType == VariantType.Null ? "Null" : v.VarType + " " + v.ToString();
        }

        static void CheckText(string name, Variant v, string expected)
        {
            Check(v.VarType == VariantType.String && v.ToString() == expected, name,
                Describe(v) + ", expected the text '" + expected + "'");
        }

        static void CheckNumber(string name, Variant v, double expected)
        {
            Check(v.IsNumber() && Math.Abs(v.AsDouble - expected) < 1E-9, name,
                Describe(v) + ", expected the number " + expected.ToString(CultureInfo.InvariantCulture));
        }

        static void CheckRaises(string name, Func<Variant> action)
        {
            try
            {
                Variant v = action();
                Check(false, name, "gave " + Describe(v) + ", expected an error");
            }
            catch (Exception e)
            {
                Check(true, name + " raises: " + e.Message);
            }
        }

        static void TestSum()
        {
            // A number plus a text that is not a number: both texts joined
            CheckText("Double+text", Variant.ExpressionSum(10.0, "a"), "10a");
            CheckText("text+Double", Variant.ExpressionSum("a", 10.0), "a10");
            CheckText("Integer+text", Variant.ExpressionSum(10, "a"), "10a");
            CheckText("Long+text", Variant.ExpressionSum(10L, "a"), "10a");
            CheckText("Decimal+text", Variant.ExpressionSum(10m, "a"), "10a");
            CheckText("Byte+text", Variant.ExpressionSum((byte)10, "a"), "10a");
            CheckText("Double+empty text", Variant.ExpressionSum(10.0, ""), "10");
            CheckText("empty text+Double", Variant.ExpressionSum("", 10.0), "10");
            // The number is written as STR() writes it (the current culture)
            CheckText("Double with decimals+text", Variant.ExpressionSum(10.5, "a"), "10,5a");

            // A text that is a number is added, as in Delphi
            CheckNumber("Double+text number", Variant.ExpressionSum(10.0, "7"), 17);
            CheckNumber("text number+Double", Variant.ExpressionSum("7", 10.0), 17);
            CheckNumber("Integer+text number", Variant.ExpressionSum(10, "7"), 17);
            CheckNumber("text number+Integer", Variant.ExpressionSum("7", 10), 17);

            // Unchanged: numbers, texts and nulls
            CheckNumber("Double+Integer", Variant.ExpressionSum(10.0, 5), 15);
            CheckText("text+text", Variant.ExpressionSum("a", "b"), "ab");
            CheckText("Null+text", Variant.ExpressionSum(new Variant(), "a"), "a");
            CheckNumber("Double+Null", Variant.ExpressionSum(10.0, new Variant()), 10);

            // Booleans and dates with a text still raise the error
            CheckRaises("Boolean+text", () => Variant.ExpressionSum(true, "a"));
            CheckRaises("text+Boolean", () => Variant.ExpressionSum("a", true));
            CheckRaises("Date+text", () => Variant.ExpressionSum(new DateTime(2026, 11, 18), "a"));

            // The + of two variants, which the aggregates use, is unchanged
            Variant zero = 0;
            Variant text = "abc";
            CheckRaises("aggregate 0+'abc'", () => zero + text);
        }

        // What 10 + text gave in the Delphi engine (Double + AnsiString, Spanish locale: decimal
        // comma, thousands dot), measured on 18-11-2026: the text is read as the same number
        static void TestDelphiParity()
        {
            (string text, object expected)[] cases =
            {
                ("7", 17.0), (" 7", 17.0), ("7 ", 17.0), ("+7", 17.0), ("-7", 3.0),
                ("1,5", 11.5), ("1.5", 25.0), ("1.000", 1010.0), ("1.000,5", 1010.5),
                ("1e3", 1010.0), ("1E3", 1010.0), ("7 \t", 17.0), ("(7)", 3.0),
                ("7a", "107a"), ("0x10", "100x10"), ("$10", "10$10"), ("7€", "107€"),
                ("1 000", "101 000"),
            };
            foreach (var c in cases)
            {
                Variant v = Variant.ExpressionSum(10.0, c.text);
                string name = "as Delphi: 10+'" + c.text.Replace("\t", "\\t") + "'";
                if (c.expected is string s)
                    CheckText(name, v, s);
                else
                    CheckNumber(name, v, (double)c.expected);
            }
        }

        static void TestExpressions()
        {
            var eval = new Evaluator();
            CheckText("10+'a'", eval.EvaluateText("10+'a'"), "10a");
            CheckText("'Pos '+10", eval.EvaluateText("'Pos '+10"), "Pos 10");
            CheckText("10+''", eval.EvaluateText("10+''"), "10");
            CheckText("10+'a'+' Stk'", eval.EvaluateText("10+'a'+' Stk'"), "10a Stk");
            CheckText("(10+'a')", eval.EvaluateText("(10+'a')"), "10a");
            CheckText("TRIM(10+'a')", eval.EvaluateText("TRIM(10+'a')"), "10a");
            CheckText("IIF(1>0,10+'a','')", eval.EvaluateText("IIF(1>0,10+'a','')"), "10a");
            CheckText("'Pos '+10+'a'", eval.EvaluateText("'Pos '+10+'a'"), "Pos 10a");
            // From the left: 10+5 is added first
            CheckText("10+5+'a'", eval.EvaluateText("10+5+'a'"), "15a");
            CheckText("'a'+10+5", eval.EvaluateText("'a'+10+5"), "a105");
            // The same text as STR()
            string str = eval.EvaluateText("STR(10.5)+'a'").ToString();
            CheckText("10.5+'a' as STR(10.5)+'a'", eval.EvaluateText("10.5+'a'"), str);
            // A text that is a number is added
            CheckNumber("10+'7'", eval.EvaluateText("10+'7'"), 17);
            CheckNumber("'7'+10", eval.EvaluateText("'7'+10"), 17);
            // Only +: the other operators, and Booleans with a text, still raise
            CheckRaises("10-'a'", () => eval.EvaluateText("10-'a'"));
            CheckRaises("10*'a'", () => eval.EvaluateText("10*'a'"));
            CheckRaises("TRUE+'a'", () => eval.EvaluateText("TRUE+'a'"));
        }

        static int Main()
        {
            Console.OutputEncoding = Encoding.UTF8;
            // The Spanish culture of the Delphi measures (decimal comma, thousands dot)
            CultureInfo.CurrentCulture = new CultureInfo("es-ES");
            try
            {
                TestSum();
                TestDelphiParity();
                TestExpressions();
            }
            catch (Exception e)
            {
                Console.WriteLine("[FAIL] unexpected " + e.GetType().Name + ": " + e.Message);
                failures++;
            }
            Console.WriteLine(failures == 0 ? "All checks passed" : failures + " check(s) failed");
            return failures == 0 ? 0 : 1;
        }
    }
}
