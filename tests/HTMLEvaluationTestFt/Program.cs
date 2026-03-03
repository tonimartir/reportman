using System;
using System.IO;
using Reportman.Drawing;
using Reportman.Drawing.CrossPlatform;
using Reportman.Reporting;

namespace HTMLEvaluationTestFt
{
    class Program
    {
        static void Main(string[] args)
        {
            try
            {
                Console.WriteLine("Creating report with {{expression}} evaluation (FreeType)...");

                // Create a new report programmatically
                Report report = new Report();
                report.PageSize = PageSizeType.User;
                report.CustomPageWidth = 11906;
                report.CustomPageHeight = 16838;
                report.PageOrientation = OrientationType.Portrait;

                // Create a subreport with a detail section
                SubReport subrep = new SubReport();
                subrep.Report = report;
                report.GenerateNewName(subrep);
                report.SubReports.Add(subrep);

                Section detail = subrep.AddDetail();
                detail.Height = 14500;

                // --- Label 1: HTML with {{expression}} ---
                LabelItem label1 = new LabelItem();
                label1.Report = report;
                report.GenerateNewName(label1);
                label1.Section = detail;
                label1.PosX = 0;
                label1.PosY = 0;
                label1.Width = 10000;
                label1.Height = 2000;
                label1.WFontName = "Arial";
                label1.LFontName = "Arial";
                label1.FontSize = 14;
                label1.IsHtml = true;
                label1.WordWrap = true;
                label1.Transparent = true;
                label1.AllStrings.Add("<b>Test HTML Label con expresiones:</b><br/>2+2: {{2+2}}, Suma de cadenas ABC: {{'A'+'B'+'C'}}");
                detail.Components.Add(label1);

                // --- Label 2: HTML with more complex expressions ---
                LabelItem label2 = new LabelItem();
                label2.Report = report;
                report.GenerateNewName(label2);
                label2.Section = detail;
                label2.PosX = 0;
                label2.PosY = 2200;
                label2.Width = 10000;
                label2.Height = 2000;
                label2.WFontName = "Arial";
                label2.LFontName = "Arial";
                label2.FontSize = 14;
                label2.IsHtml = true;
                label2.WordWrap = true;
                label2.Transparent = true;
                label2.AllStrings.Add("<i>Expresiones aritméticas:</i> 10*5={{10*5}}, 100/4={{100/4}}<br/><b>Texto concatenado:</b> {{'Hello'+' '+'World'}}");
                detail.Components.Add(label2);

                // --- Label 3: plain HTML without expressions (control) ---
                LabelItem label3 = new LabelItem();
                label3.Report = report;
                report.GenerateNewName(label3);
                label3.Section = detail;
                label3.PosX = 0;
                label3.PosY = 4400;
                label3.Width = 10000;
                label3.Height = 1500;
                label3.WFontName = "Arial";
                label3.LFontName = "Arial";
                label3.FontSize = 14;
                label3.IsHtml = true;
                label3.WordWrap = true;
                label3.Transparent = true;
                label3.AllStrings.Add("<b>Control:</b> Este label HTML <u>no tiene expresiones</u>, debe renderizarse normalmente.");
                detail.Components.Add(label3);

                // --- Label 4: non-HTML label (control, should NOT evaluate) ---
                LabelItem label4 = new LabelItem();
                label4.Report = report;
                report.GenerateNewName(label4);
                label4.Section = detail;
                label4.PosX = 0;
                label4.PosY = 6200;
                label4.Width = 10000;
                label4.Height = 1500;
                label4.WFontName = "Arial";
                label4.LFontName = "Arial";
                label4.FontSize = 14;
                label4.IsHtml = false;
                label4.WordWrap = true;
                label4.Transparent = true;
                label4.AllStrings.Add("Control NO HTML: {{2+2}} debe aparecer literal, sin evaluar.");
                detail.Components.Add(label4);

                // --- Label 5: HTML underline test ---
                LabelItem label5 = new LabelItem();
                label5.Report = report;
                report.GenerateNewName(label5);
                label5.Section = detail;
                label5.PosX = 0;
                label5.PosY = 7800;
                label5.Width = 10000;
                label5.Height = 1500;
                label5.WFontName = "Arial";
                label5.LFontName = "Arial";
                label5.FontSize = 14;
                label5.IsHtml = true;
                label5.WordWrap = true;
                label5.Transparent = true;
                label5.AllStrings.Add("Normal, <u>texto subrayado</u>, normal de nuevo.");
                detail.Components.Add(label5);

                // --- Label 6: HTML strikethrough test ---
                LabelItem label6 = new LabelItem();
                label6.Report = report;
                report.GenerateNewName(label6);
                label6.Section = detail;
                label6.PosX = 0;
                label6.PosY = 9400;
                label6.Width = 10000;
                label6.Height = 1500;
                label6.WFontName = "Arial";
                label6.LFontName = "Arial";
                label6.FontSize = 14;
                label6.IsHtml = true;
                label6.WordWrap = true;
                label6.Transparent = true;
                label6.AllStrings.Add("<b><u>negrita+subrayado</u></b>, <i><s>cursiva+tachado</s></i>, normal.");
                detail.Components.Add(label6);

                // --- Label 7: Comprehensive font family/size test ---
                LabelItem label7 = new LabelItem();
                label7.Report = report;
                report.GenerateNewName(label7);
                label7.Section = detail;
                label7.PosX = 0;
                label7.PosY = 11000;
                label7.Width = 10000;
                label7.Height = 3000;
                label7.WFontName = "Arial";
                label7.LFontName = "Arial";
                label7.FontSize = 12;
                label7.IsHtml = true;
                label7.WordWrap = true;
                label7.Transparent = true;
                label7.AllStrings.Add("El nuevo motor de Reportman.AI {{'1'+'.0'}} permite una optimización avanzada. Gracias a la <i>inferencia local</i>, los datos nunca abandonan el PC. Es fundamental asegurar la <u>privacidad total</u> de los informes directivos. <span style=\"font-family: 'Courier New'; font-size: 6pt;\">[LOG: 0x80040154 - TensorCore_Initialized_DirectX12_Mode]</span> La arquitectura en <b>C#</b> aprovecha los <b>Tensor Cores</b> de las nuevas CPU. <span style=\"font-family: 'Times New Roman'; font-size: 24pt;\">Este avance marca el inicio de una nueva era en el análisis de <i>SQL</i>.</span> <s>La era de la nube ha terminado para los datos sensibles.</s>");
                detail.Components.Add(label7);

                // --- Label 8: HTML color test ---
                LabelItem label8 = new LabelItem();
                label8.Report = report;
                report.GenerateNewName(label8);
                label8.Section = detail;
                label8.PosX = 0;
                label8.PosY = 14200;
                label8.Width = 10000;
                label8.Height = 1500;
                label8.WFontName = "Arial";
                label8.LFontName = "Arial";
                label8.FontSize = 14;
                label8.IsHtml = true;
                label8.WordWrap = true;
                label8.Transparent = true;
                label8.AllStrings.Add("Texto normal, <span style=\"color: #FF0000\">texto rojo</span>, normal de nuevo, <span style=\"color: #0000FF\">texto azul</span>, y <b><span style=\"color: green\">verde negrita</span></b>.");
                detail.Components.Add(label8);

                // Generate FreeType PDF
                string pdfPath = Path.GetFullPath("test_evaluation_ft.pdf");
                Console.WriteLine("Generating FreeType PDF: " + pdfPath);
                using (PrintOutPDFFreeType pdfDriver = new PrintOutPDFFreeType())
                {
                    pdfDriver.FileName = pdfPath;
                    pdfDriver.Compressed = false;
                    pdfDriver.Print(report.MetaFile);
                }

                Console.WriteLine("Success!");
            }
            catch (Exception ex)
            {
                Console.WriteLine("Error: " + ex.Message);
                Console.WriteLine(ex.StackTrace);
            }
        }
    }
}
