// Code 128 and GS1-128 in the .NET engine: every case is encoded with BarcodeItem and the bars
// are read back with ZXing, an independent reader ("before printing hundreds, read one").
// With --delphi <file> (written by tests/barcode128_test in the Delphi repository) it also reads
// the Delphi patterns and checks that both engines draw exactly the same bars.
// Exit code 0 when everything passes, 1 otherwise.
using Reportman.Reporting;
using ZXing;
using ZXing.Common;
using ZXing.OneD;

const char FNC1 = '¿';
const string Sscc = "376104250021234569";

var casos = new (string Nombre, BarcodeType Tipo, string Texto)[]
{
    ("sscc_auto", BarcodeType.Code128, FNC1 + "00" + Sscc),
    ("sscc_b", BarcodeType.Code128B, FNC1 + "00" + Sscc),
    ("sscc_c", BarcodeType.Code128C, FNC1 + "00" + Sscc),
    ("lote_auto", BarcodeType.Code128, FNC1 + "10L2511"),
    ("lote_b", BarcodeType.Code128B, FNC1 + "10L2511"),
    // (00) is fixed length: the lot follows without FNC1. One code set for all of it made L2511 "0051".
    ("sscc_lote_auto", BarcodeType.Code128, FNC1 + "00" + Sscc + "10L2511"),
    // Fixed length first, FNC1 after the variable (37) because (10) follows it.
    ("gtin_cantidad_lote_auto", BarcodeType.Code128, FNC1 + "0208412345678905" + "3724" + FNC1 + "10L2511"),
    ("impar_auto", BarcodeType.Code128, FNC1 + "10123"),
    ("impar_c", BarcodeType.Code128C, FNC1 + "10123"),
    ("numeros_impar_auto", BarcodeType.Code128, "12345"),
    ("coma_b", BarcodeType.Code128B, "A,B"),
    ("coma_auto", BarcodeType.Code128, "A,B"),
    ("texto_auto", BarcodeType.Code128, "Code-128 abc"),
    ("control_a", BarcodeType.Code128A, "AB\tC"),
    ("control_auto", BarcodeType.Code128, "ab\tcd"),
};

Dictionary<string, string> delphi = null;
int iDelphi = Array.IndexOf(args, "--delphi");
if (iDelphi >= 0 && iDelphi + 1 < args.Length)
    delphi = File.ReadAllLines(args[iDelphi + 1]).Where(l => l.Count(ch => ch == '|') == 2)
        .ToDictionary(l => l.Split('|')[0], l => l.Split('|')[2]);

int fallos = 0;
void Comprobar(bool ok, string que)
{
    Console.WriteLine((ok ? "OK   " : "MAL  ") + que);
    if (!ok) fallos++;
}

foreach (var (nombre, tipo, texto) in casos)
{
    var item = new BarcodeItem { BarType = tipo, Modul = 10 };
    item.CurrentText = texto;
    string pattern = item.CalculateBarcode();
    string esperado = (texto.StartsWith(FNC1) ? "]C1" + texto.Substring(1) : texto).Replace(FNC1, '\u001D');
    string leido = Leer(pattern, out int modulos);
    Comprobar(leido == esperado, $"{nombre} ({tipo}): ZXing lee «{Visible(leido)}», {modulos} módulos ({(modulos - 13) / 11 - 2} símbolos de datos)");
    if (delphi is not null)
    {
        if (!delphi.TryGetValue(nombre, out var dp))
            Comprobar(false, $"{nombre}: no está en el fichero de Delphi");
        else
        {
            string leidoDelphi = Leer(dp, out _);
            Comprobar(leidoDelphi == esperado && dp == pattern, $"{nombre}: Delphi lee «{Visible(leidoDelphi)}» y dibuja {(dp == pattern ? "las mismas barras" : "OTRAS barras")}");
        }
    }
}

// The widest bar of Code 128 is 4 modules whatever the Ratio.
var conRatio = new BarcodeItem { BarType = BarcodeType.Code128, Modul = 10, Ratio = 3.0 };
conRatio.CurrentText = FNC1 + "10L2511";
Comprobar(Leer(conRatio.CalculateBarcode(), out _) == "]C110L2511", "Con Ratio 3.0 las barras siguen siendo de 1 a 4 módulos");

Console.WriteLine(fallos == 0 ? "TODO BIEN" : $"{fallos} FALLOS");
return fallos == 0 ? 0 : 1;

// The pattern («5» to «8» bars of 1 to 4 modules, «0» to «3» spaces), with 10 modules of quiet
// zone on each side, read by ZXing as GS1.
static string Leer(string pattern, out int modulos)
{
    var anchos = pattern.Select(ch => ch >= '5' ? ch - '5' + 1 : ch - '0' + 1).ToArray();
    modulos = anchos.Sum();
    const int blanco = 10;
    var fila = new BitArray(modulos + 2 * blanco);
    int x = blanco;
    for (int i = 0; i < pattern.Length; i++)
    {
        if (pattern[i] >= '5') fila.setRange(x, x + anchos[i]);
        x += anchos[i];
    }
    var pistas = new Dictionary<DecodeHintType, object> { { DecodeHintType.ASSUME_GS1, true } };
    try { return new Code128Reader().decodeRow(0, fila, pistas)?.Text; }
    catch (Exception ex) { return "error: " + ex.Message; }
}

static string Visible(string s) => s is null ? "(no se lee)" : s.Replace("\u001D", "<GS>").Replace("\t", "<TAB>");
