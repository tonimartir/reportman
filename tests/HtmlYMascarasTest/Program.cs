using System.Globalization;
using System.Text;
using Reportman.Drawing;
using Reportman.Drawing.CrossPlatform;
using Reportman.Reporting;
using UglyToad.PdfPig;

// TEXTO HTML ALINEADO, INTERPOLACIÓN {{ }} Y MÁSCARAS DE FECHA DE DELPHI (03-10-2026).
//
// Tres cosas que un informe diseñado en el diseñador web dejó a la vista:
//
//  1. Una etiqueta HTML (`IsHtml`) alineada a la izquierda salía desplazada hacia el centro de su
//     caja, y alineada a la derecha empezaba donde tenía que terminar, cortándose. El texto sin
//     HTML se alineaba bien. Aquí se pinta la misma frase con y sin HTML, en las tres alineaciones,
//     y se exige que las letras caigan en el mismo sitio.
//  2. `{{expresión}}` dentro de una etiqueta HTML tiene que evaluarse (ReportItem.EvaluateHtmlExpressions).
//  3. `FORMATSTR('dd/mm/yyyy', fecha)` es la máscara de SIEMPRE en Report Manager (FormatDateTime
//     de Delphi); en .NET `mm` son minutos y salía «03/00/2026». Variant.DateFormatMask la traduce.
//
// Se mide con el motor .NET (PrintOutPDFFreeType) y PdfPig lee las palabras con su posición.

namespace HtmlYMascarasTest
{
    static class Program
    {
        static int fallos;
        const int AnchoCaja = 11000; // twips, desde PosX = 0 en una página con margen izquierdo 0

        static void Comprueba(bool bien, string nombre, string detalle = "")
        {
            if (bien) Console.WriteLine("[PASS] " + nombre);
            else { Console.WriteLine("[FAIL] " + nombre + (detalle.Length > 0 ? " -> " + detalle : "")); fallos++; }
        }

        static int Main()
        {
            Console.OutputEncoding = Encoding.UTF8;
            try
            {
                // 3. Máscaras: directo contra la función, sin PDF de por medio.
                Comprueba(Variant.DateFormatMask("dd/mm/yyyy") == "dd/MM/yyyy", "máscara dd/mm/yyyy -> mes");
                Comprueba(Variant.DateFormatMask("hh:mm:ss") == "HH:mm:ss", "máscara hh:mm:ss -> minutos tras la hora, reloj de 24 h");
                Comprueba(Variant.DateFormatMask("dd/mm/yyyy hh:nn") == "dd/MM/yyyy HH:mm", "máscara con nn -> minutos");
                Comprueba(Variant.DateFormatMask("hh:nn am/pm") == "hh:mm tt", "am/pm -> reloj de 12 h y tt");
                Comprueba(Variant.DateFormatMask("dd/MM/yyyy HH:mm") == "dd/MM/yyyy HH:mm", "una máscara .NET se queda como está");
                Comprueba(Variant.DateFormatMask("d 'de' mmmm 'de' yyyy") == "d 'de' MMMM 'de' yyyy", "literales entre comillas no se tocan");
                Comprueba(Variant.DateFormatMask("ss.zzz") == "ss.fff", "milisegundos z -> f");
                var fecha = new DateTime(2026, 10, 3, 14, 5, 9);
                Comprueba(fecha.ToString(Variant.DateFormatMask("dd/mm/yyyy hh:nn:ss")) == "03/10/2026 14:05:09", "fecha formateada con la máscara Delphi");

                // Y por el evaluador, como lo escribe un informe.
                var r = Informe();
                var s = Detalle(r);
                var e = new ExpressionItem
                {
                    Report = r, Section = s, PosX = 0, PosY = 0, Width = AnchoCaja, Height = 400,
                    WFontName = "Arial", LFontName = "Arial", FontSize = 10, Type1Font = PDFFontType.Embedded,
                    Transparent = true, Expression = "FORMATSTR('dd/mm/yyyy', TODAY)",
                };
                r.GenerateNewName(e);
                s.Components.Add(e);
                string texto = TextoDelPdf(Pdf(r));
                Comprueba(texto.Contains(DateTime.Today.ToString("dd/MM/yyyy")), "FORMATSTR con máscara Delphi en un informe", "salió «" + texto + "»");

                // 2. Interpolación dentro de una etiqueta HTML.
                r = Informe(); s = Detalle(r);
                Etiqueta(r, s, "<b>Total:</b> {{2+3}} unidades {{UPPERCASE('ok')}}", true, TextAlignType.Left);
                texto = TextoDelPdf(Pdf(r));
                Comprueba(texto.Contains("Total: 5 unidades OK"), "{{ }} evaluado en etiqueta HTML", "salió «" + texto + "»");

                // 1. Alineación del HTML igual que la del texto plano.
                const string frase = "Fecha: 03/10/2026 Pagina 1";
                const string fraseHtml = "<b>Fecha:</b> 03/10/2026 <i>Pagina 1</i>";
                foreach (var (variante, embebida, ajuste) in new[] { ("embebida", true, false), ("estandar", false, false), ("estandar+wordwrap", false, true) })
                foreach (var (nombre, alineacion) in new[] { ("izquierda", TextAlignType.Left), ("centrada", TextAlignType.Center), ("derecha", TextAlignType.Right) })
                {
                    r = Informe(); s = Detalle(r);
                    Etiqueta(r, s, frase, false, alineacion, embebida, ajuste);
                    var plano = PalabrasDelPdf(Pdf(r));
                    r = Informe(); s = Detalle(r);
                    Etiqueta(r, s, fraseHtml, true, alineacion, embebida, ajuste);
                    var html = PalabrasDelPdf(Pdf(r));
                    double iniPlano = plano.Min(p => p.x), finPlano = plano.Max(p => p.fin);
                    double iniHtml = html.Min(p => p.x), finHtml = html.Max(p => p.fin);
                    // La negrita ensancha un poco «Fecha:», así que se admiten unos puntos.
                    Comprueba(Math.Abs(iniPlano - iniHtml) < 6 && Math.Abs(finPlano - finHtml) < 6,
                        "HTML alineado a la " + nombre + " cae donde el texto plano (" + variante + ")",
                        $"plano {iniPlano:0.0}..{finPlano:0.0} pt, html {iniHtml:0.0}..{finHtml:0.0} pt; palabras html: {string.Join(" ", html.Select(p => p.palabra + "@" + p.x.ToString("0")))}");
                    double anchoPt = AnchoCaja / 20.0;
                    if (alineacion == TextAlignType.Left) Comprueba(iniHtml < 3, "HTML a la izquierda empieza en el borde (" + variante + ")", iniHtml.ToString("0.0"));
                    if (alineacion == TextAlignType.Right) Comprueba(Math.Abs(finHtml - anchoPt) < 4, "HTML a la derecha termina en el borde (" + variante + ")", $"{finHtml:0.0} de {anchoPt:0.0}");
                }

                // Con una entidad: el informe real llevaba «&nbsp;» y la etiqueta salía corrida.
                foreach (var (nombre, alineacion) in new[] { ("izquierda", TextAlignType.Left), ("derecha", TextAlignType.Right) })
                {
                    r = Informe(); s = Detalle(r);
                    Etiqueta(r, s, "<b>Fecha:</b> 03/10/2026 &nbsp; <i>Pagina 1</i>", true, alineacion, false, false);
                    var html = PalabrasDelPdf(Pdf(r));
                    double ini = html.Min(p => p.x), fin = html.Max(p => p.fin);
                    string detalle = $"{ini:0.0}..{fin:0.0} pt; palabras: {string.Join(" ", html.Select(p => p.palabra + "@" + p.x.ToString("0")))}";
                    if (alineacion == TextAlignType.Left) Comprueba(ini < 3, "HTML con &nbsp; a la izquierda empieza en el borde", detalle);
                    else Comprueba(Math.Abs(fin - AnchoCaja / 20.0) < 4, "HTML con &nbsp; a la derecha termina en el borde", detalle);
                }

                Console.WriteLine(fallos == 0 ? "ALL PASSED" : fallos + " FAILED");
                return fallos == 0 ? 0 : 1;
            }
            catch (Exception ex)
            {
                Console.WriteLine("EXCEPTION: " + ex);
                return 2;
            }
        }

        static Report Informe()
        {
            var r = new Report();
            r.CreateNew();
            r.PageSize = PageSizeType.User;
            r.CustomPageWidth = 11906;
            r.CustomPageHeight = 16838;
            r.LeftMargin = 0; r.TopMargin = 0; r.RightMargin = 0; r.BottomMargin = 0;
            return r;
        }

        static Section Detalle(Report r)
        {
            var s = r.SubReports[0].Sections[r.SubReports[0].FirstDetail];
            s.Height = 2000;
            return s;
        }

        static LabelItem Etiqueta(Report r, Section s, string texto, bool html, TextAlignType alineacion, bool embebida = true, bool ajuste = false)
        {
            var l = new LabelItem
            {
                Report = r, Section = s, PosX = 0, PosY = 0, Width = AnchoCaja, Height = 500,
                WFontName = "Arial", LFontName = "Arial", FontSize = 10,
                Type1Font = embebida ? PDFFontType.Embedded : PDFFontType.Helvetica, Transparent = true, WordWrap = ajuste,
                CutText = true, IsHtml = html, Alignment = alineacion,
            };
            r.GenerateNewName(l);
            l.Text = texto;
            s.Components.Add(l);
            return l;
        }

        static byte[] Pdf(Report r)
        {
            r.AsyncExecution = false;
            r.MetaFile.Clear();
            using var d = new PrintOutPDFFreeType { FileName = "", Compressed = false };
            d.Print(r.MetaFile);
            using var ms = new MemoryStream();
            d.PDFStream.Position = 0;
            d.PDFStream.CopyTo(ms);
            return ms.ToArray();
        }

        static string TextoDelPdf(byte[] bytes)
        {
            using var doc = PdfDocument.Open(new MemoryStream(bytes));
            return string.Join(" ", doc.GetPages().Select(p => p.Text));
        }

        static List<(string palabra, double x, double fin)> PalabrasDelPdf(byte[] bytes)
        {
            using var doc = PdfDocument.Open(new MemoryStream(bytes));
            var page = doc.GetPage(1);
            return page.GetWords().Select(w => (w.Text, w.BoundingBox.Left, w.BoundingBox.Right)).ToList();
        }
    }
}
