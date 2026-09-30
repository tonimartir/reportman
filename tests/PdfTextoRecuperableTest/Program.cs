using System.Text;
using Reportman.Drawing;
using Reportman.Drawing.CrossPlatform;
using Reportman.Reporting;
using UglyToad.PdfPig;

// EL TEXTO DE UN PDF TIENE QUE PODER RECUPERARSE, en los DOS motores (30-09-2026).
//
// Por qué existe. El conformado no dibuja siempre el glifo «nominal» de un carácter: una ligadura
// junta «fi», «fl» o «ti» en UNO, y una alternativa contextual cambia la forma de una letra según
// sus vecinas —en árabe eso es la norma, no la excepción—. A esos glifos no les corresponde ningún
// carácter, así que si el CMap de /ToUnicode no los declara, el PDF se ve perfecto y el texto que
// se extrae de él está mal:
//
//     «año de gestión»   salía   «año de gesƟón»     (Calibri, la ligadura «ti»)
//     «oficina eficaz»   salía   «oĮcina eĮcaz»      (Calibri, «fi» y «fl»)
//     «oficina»          salía   «oϐicina»           (Cambria, la «f» delante de la «i»)
//     «الفاتورة رقم»       perdía cinco de sus once letras
//
// Y cambiar una letra por otra es PEOR que perderla, porque no se nota. En una factura significa
// que el identificativo fiscal no se puede leer del documento.
//
// CÓMO SE USA
//
//   PdfTextoRecuperableTest                 pinta con el motor .NET y comprueba
//   PdfTextoRecuperableTest --rep <dir>     escribe un .rep por caso, para el motor Delphi
//   PdfTextoRecuperableTest --check <dir>   comprueba los PDF de un directorio, sean de quien sean
//
// El de Delphi se mide así, con `printreptopdf` de `repman/utils`:
//
//   PdfTextoRecuperableTest --rep /tmp/casos
//   for f in /tmp/casos/*.rep; do printreptopdf -q -u "$f" "${f%.rep}-delphi.pdf"; done
//   PdfTextoRecuperableTest --check /tmp/casos
//
// LO QUE SE MIDE ES UNA COSA: que cada carácter del original esté en el texto extraído, con la
// misma cuenta. NO se compara el orden, porque el PDF escribe el texto de derecha a izquierda en
// orden VISUAL —en los dos motores— y eso es otra cosa, no este fallo.

namespace PdfTextoRecuperableTest
{
    record Caso(string Nombre, string Texto, string Familia, bool Html, bool Rtl);

    static class Program
    {
        // Las fuentes se prueban MUCHAS porque cuál sustituye depende de la máquina: en Linux liga
        // DejaVu, y en Windows no lo hacen ni Arial ni Times —pero Cambria, Calibri y Constantia
        // sí—. Si en la máquina no sustituyera ninguna, esto no mediría nada, y eso se dice.
        static readonly Caso[] Casos =
        [
            new("latino-cambria",        "oficina eficaz, inflar el aforo: cc9fiV6qbWqwP", "Cambria", false, false),
            new("latino-cambria-html",   "oficina eficaz, inflar el aforo: cc9fiV6qbWqwP", "Cambria", true, false),
            new("latino-calibri-html",   "oficina eficaz, inflar el aforo: cc9fiV6qbWqwP", "Calibri", true, false),
            new("latino-times-html",     "oficina eficaz, inflar el aforo: cc9fiV6qbWqwP", "Times New Roman", true, false),
            new("latino-constantia-html","oficina eficaz, inflar el aforo: cc9fiV6qbWqwP", "Constantia", true, false),
            new("latino-dejavu-html",    "oficina eficaz, inflar el aforo: cc9fiV6qbWqwP", "DejaVu Sans", true, false),
            new("acentos-html",          "año de gestión: áéíóúüÇ", "Calibri", true, false),
            new("arabe",                 "الفاتورة رقم", "Arial", false, true),
            new("arabe-segoe",           "الفاتورة رقم", "Segoe UI", false, true),
            new("hebreo",                "חשבונית", "Arial", false, true),
            new("griego-html",           "Ευχαριστώ", "Arial", true, false),
        ];

        static int fallos;

        static void Comprueba(bool bien, string nombre, string detalle = "")
        {
            if (bien)
                Console.WriteLine("[PASS] " + nombre);
            else
            {
                Console.WriteLine("[FAIL] " + nombre + (detalle.Length > 0 ? " -> " + detalle : ""));
                fallos++;
            }
        }

        static int Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            try
            {
                if (args.Length == 2 && args[0] == "--rep")
                {
                    Directory.CreateDirectory(args[1]);
                    foreach (var c in Casos)
                        Informe(c).SaveToFile(Path.Combine(args[1], c.Nombre + ".rep"));
                    Console.WriteLine($"{Casos.Length} informes escritos en {args[1]}");
                    return 0;
                }

                string dir = args.Length == 2 && args[0] == "--check"
                    ? args[1]
                    : Path.Combine(Path.GetTempPath(), "PdfTextoRecuperableTest");
                Directory.CreateDirectory(dir);

                if (!(args.Length == 2 && args[0] == "--check"))
                    foreach (var c in Casos)
                        File.WriteAllBytes(Path.Combine(dir, c.Nombre + "-net.pdf"), PdfDeFreeType(c));

                int mirados = 0, sustituyeron = 0;
                foreach (var c in Casos)
                {
                    // Por nombre EXACTO y no por comodín: «latino-cambria-*» casaría también con
                    // los PDF de «latino-cambria-html» y los miraría con el original del otro.
                    foreach (var f in Directory.GetFiles(dir, "*.pdf").OrderBy(x => x)
                             .Where(x => Path.GetFileNameWithoutExtension(x) == c.Nombre + "-net"
                                      || Path.GetFileNameWithoutExtension(x) == c.Nombre + "-delphi"))
                    {
                        mirados++;
                        var bytes = File.ReadAllBytes(f);
                        // Una ligadura bien declarada es una entrada del CMap cuyo destino son dos
                        // caracteres, o sea ocho dígitos hexadecimales en vez de cuatro. Que haya
                        // alguna es la prueba de que esto ha medido algo.
                        if (System.Text.RegularExpressions.Regex.IsMatch(
                                Encoding.Latin1.GetString(bytes), @"<[0-9A-Fa-f]{4}>\s+<[0-9A-Fa-f]{8,}>"))
                            sustituyeron++;
                        string texto;
                        try
                        {
                            using var doc = PdfDocument.Open(new MemoryStream(bytes));
                            texto = string.Join(" ", doc.GetPages().Select(p => p.Text));
                        }
                        catch (Exception ex) { texto = "NO SE PUDO ABRIR: " + ex.Message; }
                        var faltan = Faltan(c, texto);
                        var privados = texto.Where(ch => ch >= '' && ch <= '')
                            .Distinct().Select(ch => "U+" + ((int)ch).ToString("X4")).ToArray();
                        Comprueba(faltan.Length == 0 && privados.Length == 0,
                            Path.GetFileNameWithoutExtension(f),
                            (faltan.Length > 0 ? "faltan " + faltan + "; " : "")
                            + (privados.Length > 0 ? "de uso privado: " + string.Join(" ", privados) + "; " : "")
                            + "salió «" + texto + "»");
                    }
                }

                Comprueba(mirados > 0, "hay PDF que mirar en " + dir);
                // EL GUARDIÁN DE «¿HE MEDIDO ALGO?». Sin él, en una máquina cuyas fuentes no ligan
                // esto pasaría en verde sin ejercitar el camino que existe para vigilar — y así fue
                // como se encontró el fallo de Cambria: la prueba se quedó roja diciéndolo.
                Comprueba(sustituyeron > 0,
                    "alguna fuente ha formado una ligadura declarada con dos caracteres",
                    "ninguna de las " + Casos.Length + " lo ha hecho: esto NO ha medido nada");

                Console.WriteLine("PDFs en " + dir);
                Console.WriteLine(fallos == 0 ? "ALL PASSED" : fallos + " FAILED");
                return fallos == 0 ? 0 : 1;
            }
            catch (Exception ex)
            {
                Console.WriteLine("EXCEPTION: " + ex);
                return 2;
            }
        }

        // Lo que falta del original en el texto extraído, sin mirar el orden ni los espacios.
        static string Faltan(Caso c, string texto)
        {
            var quedan = new List<char>(texto.Where(ch => ch != ' '));
            var faltan = new List<string>();
            foreach (var ch in c.Texto.Where(x => x != ' '))
                if (!quedan.Remove(ch))
                    faltan.Add($"{ch} (U+{(int)ch:X4})");
            return string.Join(" ", faltan);
        }

        static byte[] PdfDeFreeType(Caso c)
        {
            var r = Informe(c);
            r.AsyncExecution = false;
            r.MetaFile.Clear();
            using var d = new PrintOutPDFFreeType { FileName = "", Compressed = false };
            d.Print(r.MetaFile);
            using var ms = new MemoryStream();
            d.PDFStream.Position = 0;
            d.PDFStream.CopyTo(ms);
            return ms.ToArray();
        }

        // Un informe de una etiqueta, lo más pequeño que pinta texto. `Type1Font = Embedded` porque
        // es el único camino que conforma e incrusta: con una fuente estándar del PDF no hay glifos,
        // no hay sustituciones y no habría nada que medir.
        static Report Informe(Caso c)
        {
            var r = new Report();
            r.CreateNew();
            r.PageSize = PageSizeType.User;
            r.CustomPageWidth = 11906;
            r.CustomPageHeight = 16838;
            var s = r.SubReports[0].Sections[r.SubReports[0].FirstDetail];
            s.Height = 2000;
            var l = new LabelItem
            {
                Report = r, Section = s, PosX = 0, PosY = 0, Width = 11000, Height = 500,
                WFontName = c.Familia, LFontName = c.Familia, FontSize = 12,
                Type1Font = PDFFontType.Embedded, Transparent = true, WordWrap = false,
                CutText = false, IsHtml = c.Html, RightToLeft = c.Rtl,
            };
            r.GenerateNewName(l);
            l.Text = c.Texto;
            s.Components.Add(l);
            return r;
        }
    }
}
