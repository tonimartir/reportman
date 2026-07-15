using System;
using Reportman.Reporting;
using Reportman.Drawing;

// Minimal harness: reproduce the multi-page text pagination path using the
// Windows GDI PDF driver (no ICU/FreeType dependency), exercising the same
// MetaFile.CalcTextExtent + ExpressionItem.DoPrint/GetText engine.
class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        try
        {
            var rp = new Report();
            rp.LoadFromFile(args[0]);
            rp.AsyncExecution = false;
            var pdf = new PrintOutPDF();
            pdf.FileName = args[1];
            pdf.Compressed = false;
            pdf.Print(rp.MetaFile);
            Console.WriteLine("RESULT=OK pages=" + rp.MetaFile.Pages.Count);
            return 0;
        }
        catch (Exception e)
        {
            Console.WriteLine("RESULT=EXCEPTION " + e.GetType().FullName + ": " + e.Message);
            Console.WriteLine(e.StackTrace);
            return 1;
        }
    }
}
