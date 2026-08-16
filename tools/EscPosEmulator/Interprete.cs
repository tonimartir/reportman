using System.Drawing;
using System.Text;
using Reportman.Drawing;
using SkiaSharp;
using ZXing;
using ZXing.Common;

namespace Reportman.EscPosEmulator;

/// <summary>Lo que el emulador sabe de la impresora que finge.</summary>
public sealed class ConfiguracionImpresora
{
    /// <summary>Ancho del papel en mm: 80 (576 puntos a 203 ppp) o 58 (384 puntos).</summary>
    public int PapelMm { get; set; } = 80;
    /// <summary>Puntos por pulgada del cabezal (TM-T88 y clones: 203; algunos 180).</summary>
    public int Dpi { get; set; } = 203;
    /// <summary>Página de códigos con la que arranca la impresora (Epson de fábrica: 437; Reportman escribe cp850).</summary>
    public int PaginaCodigosInicial { get; set; } = 850;
    /// <summary>La familia monoespaciada con la que se pinta el texto.</summary>
    public string Fuente { get; set; } = OperatingSystem.IsWindows() ? "Consolas" : "DejaVu Sans Mono";
    /// <summary>`escpos` (unidades de tique: ESC 3 en 1/360") o `escp` (matricial: ESC 3 en 1/216", ESC $ en 1/60").</summary>
    public string Modo { get; set; } = "escpos";
    /// <summary>Margen izquierdo del área imprimible en puntos (las TM dejan ~ 4 mm; aquí 0 para ver todo).</summary>
    public int MargenIzquierdoPuntos { get; set; } = 0;

    public int AnchoPuntos => (int)Math.Round(PapelMm / 25.4 * Dpi);
    public double TwipsPorPunto => 1440.0 / Dpi;
    public bool EsEscP => string.Equals(Modo, "escp", StringComparison.OrdinalIgnoreCase);
}

/// <summary>Un suceso del trabajo que no es texto: corte, cajón, código de barras, comando raro…</summary>
public sealed record Suceso(int Offset, string Tipo, string Detalle);

/// <summary>El resultado de interpretar un trabajo: el metafile con sus páginas y el diario.</summary>
public sealed class Trabajo
{
    public MetaFile Metafile { get; } = new MetaFile();
    public List<Suceso> Sucesos { get; } = new();
    public int Bytes { get; set; }
    public int Paginas => Metafile.Pages.CurrentCount;
    public bool Cortes => Sucesos.Any(s => s.Tipo == "corte");
    public bool Cajon => Sucesos.Any(s => s.Tipo == "cajon");
}

/// <summary>
/// EL INTÉRPRETE: bytes ESC/POS (y el subconjunto ESC/P de los drivers de texto de Reportman) →
/// un MetaFile del motor. Un renglón de texto es un objeto de texto por tramo de estilo; el QR y
/// los códigos de barras se dibujan como rectángulos (los módulos que devuelve ZXing, igual que
/// hace BarcodeItem); las imágenes ráster (GS v 0, ESC *) como imagen; el corte cierra la página
/// y abre otra; el cajón, los cambios de página de códigos y lo que no se entiende van al diario.
///
/// Es un emulador para VER lo que la impresora recibiría, no una impresora: donde una TM haría
/// algo sutil (unidades de movimiento configurables, fuentes internacionales) aquí se elige lo
/// habitual y se apunta.
/// </summary>
public sealed class Interprete
{
    private readonly ConfiguracionImpresora cfg;
    private readonly int anchoArea;

    // La medida real del avance de la fuente elegida, para que el tamaño de letra llene la celda.
    private readonly double avancePorPunto;    // píxeles de avance por punto de tamaño de fuente
    private readonly double altoPorPunto;      // alto de línea (ascent+descent) por punto de tamaño

    public Interprete(ConfiguracionImpresora configuracion)
    {
        cfg = configuracion;
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        anchoArea = cfg.AnchoPuntos - cfg.MargenIzquierdoPuntos;
        using var face = SKTypeface.FromFamilyName(cfg.Fuente) ?? SKTypeface.Default;
        using var font = new SKFont(face, 100f);
        avancePorPunto = font.MeasureText("M") / 100.0;
        font.GetFontMetrics(out var m);
        altoPorPunto = (m.Descent - m.Ascent) / 100.0;
    }

    // ------------------------------------------------------------------ estado
    private sealed class Estilo
    {
        public bool FuenteB, Negrita, Subrayado, Cursiva, Inverso, Rojo;
        public int MultAncho = 1, MultAlto = 1;
        public Estilo Copia() => (Estilo)MemberwiseClone();
    }
    private sealed record Tramo(string Texto, Estilo Estilo, int XPuntos);

    private Trabajo trabajo = null!;
    private MetaPage? paginaActual;
    // La pagina se abre con el PRIMER contenido: tras el ultimo corte suele venir solo el reset
    // y el pulso del cajon, y esa pagina en blanco no es un tique.
    private MetaPage pagina => paginaActual ??= NuevaPagina();
    private Estilo estilo = new();
    private int alineacion;                 // 0 izq, 1 centro, 2 der
    private int interlineadoPuntos;
    private int margenIzq, anchoImpresion;
    private Encoding codificacion = null!;
    private int y;                          // puntos desde el borde superior de la página
    private int cursorX;                    // puntos dentro del área, para HT / ESC $
    private readonly List<Tramo> linea = new();
    private readonly StringBuilder tramoActual = new();
    private Estilo estiloTramo = new();
    private int xTramo;
    private bool anchoDobleUnaLinea;
    private readonly List<int> tabulaciones = new();
    // QR (GS ( k cn=49)
    private int qrModulo = 3; private int qrEcc = 48; private byte[] qrDatos = Array.Empty<byte>();
    // 1D (GS h/w)
    private int barAlto = 162, barModulo = 3;
    // PDF417 (GS ( k cn=48)
    private int pdfColumnas, pdfFilas, pdfModulo = 3, pdfAltoFila = 3, pdfEcc = 1; private bool pdfTruncado; private byte[] pdfDatos = Array.Empty<byte>();
    // Imagen descargada (GS *) por si luego piden GS /
    private SKBitmap? imagenDescargada;

    private int Punto(double puntos) => (int)Math.Round(puntos * cfg.TwipsPorPunto);
    private int AnchoCelda(Estilo e) => (e.FuenteB ? 9 : 12) * e.MultAncho;
    private int AltoCelda(Estilo e) => (e.FuenteB ? 17 : 24) * e.MultAlto;

    // ------------------------------------------------------------------ entrada
    public Trabajo Interpretar(byte[] datos)
    {
        trabajo = new Trabajo { Bytes = datos.Length };
        Reiniciar(todo: true);
        int i = 0;
        while (i < datos.Length)
        {
            byte b = datos[i];
            switch (b)
            {
                case 0x0A: i++; SaltoDeLinea(); break;
                case 0x0D: i++; break;                          // CR: la TM lo ignora
                case 0x0C: i++; Cortar(i, "FF (avance de página)"); break;
                case 0x09: i++; Tabular(); break;
                case 0x0E: i++; anchoDobleUnaLinea = true; CerrarTramo(); break;
                case 0x14: i++; anchoDobleUnaLinea = false; CerrarTramo(); break;
                case 0x0F: i++; CerrarTramo(); estilo.FuenteB = true; break;      // SI condensada (ESC/P)
                case 0x12: i++; CerrarTramo(); estilo.FuenteB = false; break;     // DC2 fin condensada
                case 0x18: i++; linea.Clear(); tramoActual.Clear(); cursorX = 0; break;   // CAN
                case 0x1B: i = Escape(datos, i); break;
                case 0x1D: i = Gs(datos, i); break;
                case 0x1C: i = Fs(datos, i); break;
                case 0x10: i = Dle(datos, i); break;
                case 0x1F: // US: «select logo» de algunos firmwares (0x1F 0x30 n) y otros ajustes; se salta con su parámetro
                    Anotar(i, "comando", $"US {Hex(datos, i + 1, 2)}: se ignora");
                    i += 3; break;
                default:
                    if (b >= 0x20) { i = Texto(datos, i); }
                    else { Anotar(i, "comando", $"control 0x{b:X2} desconocido: se ignora"); i++; }
                    break;
            }
        }
        CerrarLinea(avanzar: false);
        CerrarPagina();
        trabajo.Metafile.Finish();
        return trabajo;
    }

    private static string Hex(byte[] d, int desde, int n)
    {
        var sb = new StringBuilder();
        for (int k = desde; k < Math.Min(d.Length, desde + n); k++) sb.Append(d[k].ToString("X2")).Append(' ');
        return sb.ToString().TrimEnd();
    }

    private void Anotar(int offset, string tipo, string detalle) => trabajo.Sucesos.Add(new Suceso(offset, tipo, detalle));

    private void Reiniciar(bool todo)
    {
        estilo = new Estilo();
        alineacion = 0;
        interlineadoPuntos = (int)Math.Round(30.0 * cfg.Dpi / 203);
        margenIzq = cfg.MargenIzquierdoPuntos;
        anchoImpresion = anchoArea;
        codificacion = Encoding.GetEncoding(cfg.PaginaCodigosInicial);
        cursorX = 0;
        anchoDobleUnaLinea = false;
        tabulaciones.Clear();
        for (int t = 8; t < 200; t += 8) tabulaciones.Add(t);
        qrModulo = 3; qrEcc = 48; qrDatos = Array.Empty<byte>();
        barAlto = 162; barModulo = 3;
        if (todo) y = 0;
    }
    // ------------------------------------------------------------------ páginas
    private MetaPage NuevaPagina()
    {
        var meta = trabajo.Metafile;
        meta.CustomX = Punto(cfg.AnchoPuntos);
        var p = new MetaPage(meta);
        p.PageDetail.Custom = true;
        p.PageDetail.CustomWidth = meta.CustomX;
        p.PageDetail.PhysicWidth = meta.CustomX;
        p.PageDetail.PaperSource = 0;
        p.PageDetail.ForcePaperName = "";
        p.Orientation = OrientationType.Portrait;
        meta.Pages.Add(p);
        return p;
    }

    private void CerrarPagina()
    {
        if (paginaActual is null) { y = 0; return; }
        // La página mide lo que se imprimió, más un respiro: es un rollo, no un folio.
        int alto = Punto(Math.Max(y, interlineadoPuntos) + 2 * interlineadoPuntos);
        paginaActual.PageDetail.CustomHeight = alto;
        paginaActual.PageDetail.PhysicHeight = alto;
        if (alto > trabajo.Metafile.CustomY) trabajo.Metafile.CustomY = alto;
        paginaActual = null;
        y = 0;
    }

    private void Cortar(int offset, string como)
    {
        CerrarLinea(avanzar: true);
        Anotar(offset, "corte", como);
        CerrarPagina();
    }

    // ------------------------------------------------------------------ texto
    private int Texto(byte[] d, int i)
    {
        // Un tramo de bytes imprimibles seguidos, decodificados con la página de códigos vigente.
        int j = i;
        while (j < d.Length && d[j] >= 0x20 && d[j] != 0x7F) j++;
        string s = codificacion.GetString(d, i, j - i);
        Escribir(s);
        return j;
    }

    private void Escribir(string s)
    {
        var e = EstiloEfectivo();
        if (tramoActual.Length > 0 && !MismoEstilo(estiloTramo, e)) CerrarTramo();
        if (tramoActual.Length == 0) { estiloTramo = e; xTramo = cursorX; }
        tramoActual.Append(s);
        cursorX += s.Length * AnchoCelda(e);
    }

    private Estilo EstiloEfectivo()
    {
        var e = estilo.Copia();
        if (anchoDobleUnaLinea) e.MultAncho = Math.Max(2, e.MultAncho);
        return e;
    }

    private static bool MismoEstilo(Estilo a, Estilo b) =>
        a.FuenteB == b.FuenteB && a.Negrita == b.Negrita && a.Subrayado == b.Subrayado && a.Cursiva == b.Cursiva
        && a.Inverso == b.Inverso && a.Rojo == b.Rojo && a.MultAncho == b.MultAncho && a.MultAlto == b.MultAlto;

    private void CerrarTramo()
    {
        if (tramoActual.Length == 0) return;
        linea.Add(new Tramo(tramoActual.ToString(), estiloTramo, xTramo));
        tramoActual.Clear();
    }

    private void Tabular()
    {
        CerrarTramo();
        int col = cursorX / 12;
        int destino = tabulaciones.FirstOrDefault(t => t > col, col + 1);
        cursorX = destino * 12;
    }

    private void SaltoDeLinea()
    {
        CerrarLinea(avanzar: true);
        anchoDobleUnaLinea = false;
    }

    /// <summary>Vuelca la línea en curso al metafile y (si se pide) avanza el papel.</summary>
    private void CerrarLinea(bool avanzar)
    {
        CerrarTramo();
        int altoLinea = interlineadoPuntos;
        if (linea.Count > 0)
        {
            int anchoTotal = linea.Sum(t => t.Texto.Length * AnchoCelda(t.Estilo));
            int fin = linea.Max(t => t.XPuntos + t.Texto.Length * AnchoCelda(t.Estilo));
            int desplazamiento = alineacion switch
            {
                1 => Math.Max(0, (anchoImpresion - fin) / 2),
                2 => Math.Max(0, anchoImpresion - fin),
                _ => 0,
            };
            int altoMax = linea.Max(t => AltoCelda(t.Estilo));
            if (altoMax > altoLinea) altoLinea = altoMax + (interlineadoPuntos - 24 * cfg.Dpi / 203);
            foreach (var t in linea)
            {
                var e = t.Estilo;
                int celda = AnchoCelda(e);
                int x = margenIzq + desplazamiento + t.XPuntos;
                int anchoT = t.Texto.Length * celda;
                // El tamaño de letra sale del ALTO de la celda (24 ó 17 puntos, por el multiplicador
                // de altura): así el glifo cabe en su renglón como en la impresora, que nunca crece
                // hacia abajo por ensanchar. El ancho lo pone la fuente monoespaciada (~0,55 em):
                // a doble ancho no se estira el glifo —el metafile no sabe— sino que se ESPACIA,
                // carácter a carácter en su celda, que es lo que se ve en el papel de una TM.
                double altoPt = AltoCelda(e) * 72.0 / cfg.Dpi;
                short tam = (short)Math.Max(4, Math.Round(altoPt / altoPorPunto));
                int altoObj = Math.Max(AltoCelda(e), (int)Math.Round(tam * altoPorPunto * cfg.Dpi / 72.0));
                int estiloFuente = (e.Negrita ? 1 : 0) | (e.Cursiva ? 2 : 0) | (e.Subrayado ? 4 : 0);
                int color = e.Rojo ? GraphicUtils.IntegerFromColor(Color.Red) : GraphicUtils.IntegerFromColor(Color.Black);
                int fondo = GraphicUtils.IntegerFromColor(Color.White);
                if (e.Inverso) { color = GraphicUtils.IntegerFromColor(Color.White); fondo = GraphicUtils.IntegerFromColor(Color.Black); }
                bool espaciar = e.MultAncho > e.MultAlto;
                if (!espaciar)
                {
                    var obj = pagina.DrawText(Punto(x), Punto(y), Punto(anchoT), Punto(altoObj), t.Texto,
                        cfg.Fuente, cfg.Fuente, tam, 0, color, fondo, !e.Inverso, estiloFuente, PDFFontType.Linked,
                        TextAlignType.Left, TextAlignVerticalType.Top, true, false, false, PrintStepType.BySize);
                    obj.Alignment |= MetaFile.AlignmentFlags_SingleLine;
                }
                else
                {
                    for (int c = 0; c < t.Texto.Length; c++)
                    {
                        var obj = pagina.DrawText(Punto(x + c * celda), Punto(y), Punto(celda), Punto(altoObj), t.Texto[c].ToString(),
                            cfg.Fuente, cfg.Fuente, tam, 0, color, fondo, !e.Inverso, estiloFuente, PDFFontType.Linked,
                            TextAlignType.Center, TextAlignVerticalType.Top, true, false, false, PrintStepType.BySize);
                        obj.Alignment |= MetaFile.AlignmentFlags_SingleLine;
                    }
                }
            }
            linea.Clear();
        }
        cursorX = 0;
        if (avanzar) y += altoLinea;
    }

    // ------------------------------------------------------------------ ESC
    private int Escape(byte[] d, int i)
    {
        if (i + 1 >= d.Length) return i + 1;
        byte c = d[i + 1];
        int j = i + 2;                       // primer parámetro
        switch (c)
        {
            case (byte)'@':
                CerrarLinea(avanzar: linea.Count > 0);
                Reiniciar(todo: false);
                Anotar(i, "init", "ESC @");
                return j;
            case (byte)'!':                  // maestro
            {
                CerrarTramo();
                byte n = Byte(d, j);
                estilo.FuenteB = (n & 1) != 0;
                estilo.Negrita = (n & 8) != 0;
                estilo.MultAlto = (n & 16) != 0 ? 2 : 1;
                estilo.MultAncho = (n & 32) != 0 ? 2 : 1;
                estilo.Subrayado = (n & 128) != 0;
                return j + 1;
            }
            case (byte)'-': CerrarTramo(); estilo.Subrayado = Bit(Byte(d, j)); return j + 1;
            case (byte)'E':                  // ESC/POS: ESC E n · ESC/P: ESC E (sin parámetro)
                CerrarTramo();
                if (EsParametroBinario(d, j)) { estilo.Negrita = Bit(d[j]); return j + 1; }
                estilo.Negrita = true; return j;
            case (byte)'F': CerrarTramo(); estilo.Negrita = false; return j;
            case (byte)'G':                  // doble golpe = negrita
                CerrarTramo();
                if (EsParametroBinario(d, j)) { estilo.Negrita = Bit(d[j]); return j + 1; }
                estilo.Negrita = true; return j;
            case (byte)'H': CerrarTramo(); estilo.Negrita = false; return j;
            case (byte)'4': CerrarTramo(); estilo.Cursiva = true; return j;
            case (byte)'5': CerrarTramo(); estilo.Cursiva = false; return j;
            case (byte)'a':
            {
                CerrarLinea(avanzar: linea.Count > 0);
                byte n = Byte(d, j);
                alineacion = n switch { 0 or 48 => 0, 1 or 49 => 1, 2 or 50 => 2, _ => alineacion };
                return j + 1;
            }
            case (byte)'2': interlineadoPuntos = (int)Math.Round(30.0 * cfg.Dpi / 203); return j;
            case (byte)'0': interlineadoPuntos = cfg.Dpi / 8; return j;
            case (byte)'1': interlineadoPuntos = (int)Math.Round(7.0 * cfg.Dpi / 72); return j;
            case (byte)'3':
            {
                byte n = Byte(d, j);
                interlineadoPuntos = (int)Math.Round(n * cfg.Dpi / (cfg.EsEscP ? 216.0 : 360.0));
                if (interlineadoPuntos < 1) interlineadoPuntos = 1;
                return j + 1;
            }
            case (byte)'A': interlineadoPuntos = (int)Math.Round(Byte(d, j) * cfg.Dpi / 72.0); return j + 1;
            case (byte)'+': interlineadoPuntos = (int)Math.Round(Byte(d, j) * cfg.Dpi / 360.0); return j + 1;
            case (byte)'J':                  // imprime y avanza n unidades
                CerrarLinea(avanzar: false);
                y += (int)Math.Round(Byte(d, j) * cfg.Dpi / 180.0);
                return j + 1;
            case (byte)'d':                  // imprime y avanza n líneas
                CerrarLinea(avanzar: false);
                y += Byte(d, j) * interlineadoPuntos;
                return j + 1;
            case (byte)'C':                  // largo de página (ESC/P): se apunta y no cambia nada en un rollo
                if (Byte(d, j) == 0) { Anotar(i, "comando", $"ESC C NUL {Byte(d, j + 1)}: largo de página en pulgadas, sin efecto en el rollo"); return j + 2; }
                Anotar(i, "comando", $"ESC C {Byte(d, j)}: largo de página en líneas, sin efecto en el rollo"); return j + 1;
            case (byte)'p':
            {
                byte m = Byte(d, j), t1 = Byte(d, j + 1), t2 = Byte(d, j + 2);
                CerrarLinea(avanzar: linea.Count > 0);
                Anotar(i, "cajon", $"ESC p {m} {t1} {t2}: pulso al cajón por el conector {(m == 0 || m == 48 ? "1" : "2")}, {t1 * 2} ms on / {t2 * 2} ms off");
                return j + 3;
            }
            case (byte)'m': Cortar(i, "ESC m (corte parcial)"); return j;
            case (byte)'i': Cortar(i, "ESC i (corte total)"); return j;
            case (byte)'t':
            {
                byte n = Byte(d, j);
                if (codificacion.CodePage == 65001) { Anotar(i, "codigos", $"ESC t {n}: ignorado, la impresora esta en UTF-8 (FS ( C)"); return j + 1; }
                int cp = n switch
                {
                    0 => 437, 1 => 932, 2 => 850, 3 => 860, 4 => 863, 5 => 865, 11 => 851, 13 => 857, 14 => 737,
                    15 => 28597, 16 => 1252, 17 => 866, 18 => 852, 19 => 858, 40 => 1255, 45 => 1250, 46 => 1251,
                    47 => 1253, 48 => 1254, 49 => 1256, 50 => 1257, 51 => 1258, _ => -1,
                };
                if (cp > 0) { codificacion = Encoding.GetEncoding(cp); Anotar(i, "codigos", $"ESC t {n}: página de códigos {cp}"); }
                else Anotar(i, "comando", $"ESC t {n}: página de códigos que el emulador no conoce; se sigue con {codificacion.CodePage}");
                return j + 1;
            }
            case (byte)'R': Anotar(i, "comando", $"ESC R {Byte(d, j)}: juego internacional, se ignora"); return j + 1;
            case (byte)'M':                  // ESC/POS: fuente A/B/C · ESC/P: 12 cpi (sin parámetro)
                CerrarTramo();
                if (EsParametroFuente(d, j)) { estilo.FuenteB = d[j] is 1 or 49 or 2 or 50; return j + 1; }
                estilo.FuenteB = true; return j;
            case (byte)'P': CerrarTramo(); estilo.FuenteB = false; return j;          // 10 cpi
            case (byte)'g': CerrarTramo(); estilo.FuenteB = true; return j;           // 15 cpi
            case (byte)'W': CerrarTramo(); estilo.MultAncho = Bit(Byte(d, j)) ? 2 : 1; return j + 1;
            case (byte)'w': CerrarTramo(); estilo.MultAlto = Bit(Byte(d, j)) ? 2 : 1; return j + 1;
            case (byte)'x': return j + 1;    // calidad
            case (byte)'U': return j + 1;    // unidireccional
            case (byte)'k': return j + 1;    // tipo de letra
            case (byte)'l': return j + 1;    // margen izquierdo en columnas
            case (byte)'Q': return j + 1;    // margen derecho
            case (byte)'S': return j + 1;    // super/subíndice
            case (byte)'T': return j;
            case (byte)'{': return j + 1;    // boca abajo
            case (byte)'V': return j + 1;    // rotación 90º
            case (byte)'=': return j + 1;    // periférico
            case (byte)'e': return j + 1;    // retroceso
            case (byte)'c': return j + 2;    // sensores de papel: ESC c 3/4/5 n
            case (byte)'r': CerrarTramo(); estilo.Rojo = Bit(Byte(d, j)); return j + 1;
            case (byte)'$':
            {
                CerrarTramo();
                int n = Byte(d, j) + Byte(d, j + 1) * 256;
                cursorX = (int)Math.Round(n * cfg.Dpi / (cfg.EsEscP ? 60.0 : 180.0));
                return j + 2;
            }
            case (byte)'\\':
            {
                CerrarTramo();
                short n = (short)(Byte(d, j) + Byte(d, j + 1) * 256);
                cursorX = Math.Max(0, cursorX + (int)Math.Round(n * cfg.Dpi / (cfg.EsEscP ? 120.0 : 180.0)));
                return j + 2;
            }
            case (byte)'D':                  // tabuladores hasta NUL
            {
                tabulaciones.Clear();
                while (j < d.Length && d[j] != 0) { tabulaciones.Add(d[j]); j++; }
                if (tabulaciones.Count == 0) for (int t = 8; t < 200; t += 8) tabulaciones.Add(t);
                return j + 1;
            }
            case (byte)'B':                  // tabuladores verticales hasta NUL: se saltan
                while (j < d.Length && d[j] != 0) j++;
                return j + 1;
            case (byte)'*': return ImagenEscP(d, i, j);
            case (byte)'K': return ImagenEscP8(d, i, j, 60);
            case (byte)'L': return ImagenEscP8(d, i, j, 120);
            case (byte)'Y': return ImagenEscP8(d, i, j, 120);
            case (byte)'Z': return ImagenEscP8(d, i, j, 240);
            case (byte)'N': return j + 1;
            case (byte)'O': return j;
            default:
                Anotar(i, "comando", $"ESC 0x{c:X2} ('{(char)c}') desconocido: se ignora");
                return j;
        }
    }

    private static byte Byte(byte[] d, int k) => k < d.Length ? d[k] : (byte)0;
    private static bool Bit(byte n) => n == 1 || n == 49 || n == 2 || n == 50;
    private static bool EsParametroBinario(byte[] d, int k) => k < d.Length && (d[k] is 0 or 1 or 48 or 49);
    private static bool EsParametroFuente(byte[] d, int k) => k < d.Length && (d[k] is 0 or 1 or 2 or 48 or 49 or 50);

    // ------------------------------------------------------------------ GS
    private int Gs(byte[] d, int i)
    {
        if (i + 1 >= d.Length) return i + 1;
        byte c = d[i + 1];
        int j = i + 2;
        switch (c)
        {
            case (byte)'!':
            {
                CerrarTramo();
                byte n = Byte(d, j);
                estilo.MultAncho = ((n >> 4) & 7) + 1;
                estilo.MultAlto = (n & 7) + 1;
                return j + 1;
            }
            case (byte)'B': CerrarTramo(); estilo.Inverso = Bit(Byte(d, j)); return j + 1;
            case (byte)'V':
            {
                byte m = Byte(d, j);
                if (m is 65 or 66 or 97 or 98)
                {
                    int n = Byte(d, j + 1);
                    CerrarLinea(avanzar: linea.Count > 0);
                    y += (int)Math.Round(n * cfg.Dpi / 180.0);
                    Cortar(i, $"GS V {m} {n} (avance y corte {(m is 65 or 97 ? "total" : "parcial")})");
                    return j + 2;
                }
                Cortar(i, $"GS V {m} (corte {(m is 0 or 48 ? "total" : "parcial")})");
                return j + 1;
            }
            case (byte)'L': margenIzq = cfg.MargenIzquierdoPuntos + (int)Math.Round((Byte(d, j) + Byte(d, j + 1) * 256) * cfg.Dpi / 180.0); return j + 2;
            case (byte)'W':
            {
                int n = (int)Math.Round((Byte(d, j) + Byte(d, j + 1) * 256) * cfg.Dpi / 180.0);
                anchoImpresion = n > 0 ? Math.Min(n, anchoArea) : anchoArea;
                return j + 2;
            }
            case (byte)'H': return j + 1;    // HRI posición
            case (byte)'f': return j + 1;    // HRI fuente
            case (byte)'h': barAlto = Math.Max(1, (int)Byte(d, j)); return j + 1;
            case (byte)'w': barModulo = Math.Clamp((int)Byte(d, j), 1, 6); return j + 1;
            case (byte)'k': return Barras1D(d, i, j);
            case (byte)'(': return GsParentesis(d, i, j);
            case (byte)'v': return RasterGsV0(d, i, j);
            case (byte)'*': return DefinirImagen(d, i, j);
            case (byte)'/':
            {
                byte m = Byte(d, j);
                if (imagenDescargada is not null) PintarImagen(imagenDescargada, m == 1 || m == 3 ? 2 : 1, m == 2 || m == 3 ? 2 : 1, i, "GS / (imagen descargada)");
                else { Anotar(i, "logo", $"GS / {m}: imprimir la imagen descargada, que no hay; se pinta un hueco"); PintarHueco("[LOGO]"); }
                return j + 1;
            }
            case (byte)'a': Anotar(i, "estado", $"GS a {Byte(d, j)}: estado automático (sin respuesta)"); return j + 1;
            case (byte)'r': Anotar(i, "estado", $"GS r {Byte(d, j)}: petición de estado"); return j + 1;
            case (byte)'I': Anotar(i, "estado", $"GS I {Byte(d, j)}: identificación de impresora"); return j + 1;
            case (byte)'E': return j + 1;
            case (byte)'P': Anotar(i, "comando", $"GS P {Byte(d, j)} {Byte(d, j + 1)}: unidades de movimiento; el emulador sigue en 1/180\" y 1/360\""); return j + 2;
            case (byte)'T': return j + 1;
            case (byte)'$': return j + 2;
            case (byte)'\\': return j + 2;
            case (byte)'b': return j + 1;    // suavizado
            case (byte)'g': return j + 3;    // contadores
            case (byte)'z': return j + 2;
            default:
                Anotar(i, "comando", $"GS 0x{c:X2} ('{(char)c}') desconocido: se ignora");
                return j;
        }
    }

    private int GsParentesis(byte[] d, int i, int j)
    {
        byte fnLetra = Byte(d, j);
        int pL = Byte(d, j + 1), pH = Byte(d, j + 2);
        int largo = pL + pH * 256;
        int datosDesde = j + 3;
        int fin = Math.Min(d.Length, datosDesde + largo);
        if (fnLetra == (byte)'k')
        {
            byte cn = Byte(d, datosDesde), fn = Byte(d, datosDesde + 1);
            if (cn == 49)                     // QR
            {
                switch (fn)
                {
                    case 65: break;                                                    // modelo
                    case 67: qrModulo = Math.Clamp((int)Byte(d, datosDesde + 2), 1, 16); break;
                    case 69: qrEcc = Byte(d, datosDesde + 2); break;
                    case 80:
                        qrDatos = d[(datosDesde + 3)..fin];
                        break;
                    case 81: PintarQr(i); break;
                    case 82: Anotar(i, "estado", "GS ( k 49 82: transmitir tamaño del QR"); break;
                    default: Anotar(i, "comando", $"GS ( k 49 fn {fn}: se ignora"); break;
                }
            }
            else if (cn == 48)                // PDF417
            {
                switch (fn)
                {
                    case 65: pdfColumnas = Byte(d, datosDesde + 2); break;
                    case 66: pdfFilas = Byte(d, datosDesde + 2); break;
                    case 67: pdfModulo = Math.Clamp((int)Byte(d, datosDesde + 2), 2, 8); break;
                    case 68: pdfAltoFila = Math.Clamp((int)Byte(d, datosDesde + 2), 2, 8); break;
                    case 69: pdfEcc = Byte(d, datosDesde + 2) == 48 ? Math.Clamp(Byte(d, datosDesde + 3) - 48, 0, 8) : pdfEcc; break;
                    case 70: pdfTruncado = (Byte(d, datosDesde + 2) & 1) != 0; break;
                    case 80: pdfDatos = d[(datosDesde + 3)..fin]; break;
                    case 81: PintarPdf417(i); break;
                    default: Anotar(i, "comando", $"GS ( k 48 fn {fn}: se ignora"); break;
                }
            }
            else
                Anotar(i, "comando", $"GS ( k cn {cn} fn {fn}: simbología 2D que el emulador no dibuja");
            return fin;
        }
        if (fnLetra == (byte)'L' || fnLetra == (byte)'8')
        {
            Anotar(i, "imagen", $"GS ( {(char)fnLetra}: gráficos por función ({largo} bytes) — el emulador sólo pinta GS v 0 y ESC *");
            return fin;
        }
        Anotar(i, "comando", $"GS ( {(char)fnLetra} con {largo} bytes: se salta");
        return fin;
    }

    // ------------------------------------------------------------------ códigos de barras
    private void PintarQr(int offset)
    {
        CerrarLinea(avanzar: linea.Count > 0);
        string texto = Encoding.Latin1.GetString(qrDatos);
        var ecc = qrEcc switch
        {
            49 or 1 => ZXing.QrCode.Internal.ErrorCorrectionLevel.M,
            50 or 2 => ZXing.QrCode.Internal.ErrorCorrectionLevel.Q,
            51 or 3 => ZXing.QrCode.Internal.ErrorCorrectionLevel.H,
            _ => ZXing.QrCode.Internal.ErrorCorrectionLevel.L,
        };
        BitMatrix m;
        try
        {
            m = new ZXing.QrCode.QRCodeWriter().encode(texto, BarcodeFormat.QR_CODE, 0, 0,
                new Dictionary<EncodeHintType, object> { [EncodeHintType.ERROR_CORRECTION] = ecc, [EncodeHintType.MARGIN] = 0 });
        }
        catch (Exception ex)
        {
            Anotar(offset, "barras", $"QR: no se pudo codificar «{texto}»: {ex.Message}");
            return;
        }
        int lado = m.Width * qrModulo;
        int x = margenIzq + alineacion switch { 1 => (anchoImpresion - lado) / 2, 2 => anchoImpresion - lado, _ => 0 };
        PintarMatriz(m, x, y, qrModulo, qrModulo);
        Anotar(offset, "barras", $"QR modelo 2, módulo {qrModulo} puntos, ECC {(char)Math.Max(48, qrEcc)}, {m.Width}×{m.Width} módulos = {lado} puntos ({lado * 25.4 / cfg.Dpi:0.0} mm): {texto}");
        y += lado;
    }

    private void PintarPdf417(int offset)
    {
        CerrarLinea(avanzar: linea.Count > 0);
        string texto = Encoding.Latin1.GetString(pdfDatos);
        BitMatrix m;
        try
        {
            var hints = new Dictionary<EncodeHintType, object>
            {
                [EncodeHintType.MARGIN] = 0,
                [EncodeHintType.ERROR_CORRECTION] = ZXing.PDF417.Internal.PDF417ErrorCorrectionLevel.L0 + pdfEcc,
            };
            if (pdfColumnas > 0) hints[EncodeHintType.PDF417_DIMENSIONS] = new ZXing.PDF417.Internal.Dimensions(pdfColumnas, pdfColumnas, 3, 90);
            if (pdfTruncado) hints[EncodeHintType.PDF417_COMPACT] = true;
            m = new ZXing.PDF417.PDF417Writer().encode(texto, BarcodeFormat.PDF_417, 0, 0, hints);
        }
        catch (Exception ex) { Anotar(offset, "barras", $"PDF417: no se pudo codificar «{texto}»: {ex.Message}"); return; }
        int ancho = m.Width * pdfModulo, alto = m.Height * pdfAltoFila;
        int x = margenIzq + alineacion switch { 1 => Math.Max(0, (anchoImpresion - ancho) / 2), 2 => Math.Max(0, anchoImpresion - ancho), _ => 0 };
        PintarMatriz(m, x, y, pdfModulo, pdfAltoFila);
        Anotar(offset, "barras", $"PDF417 {m.Width}×{m.Height} módulos, módulo {pdfModulo}, fila {pdfAltoFila}, ECC {pdfEcc}{(pdfTruncado ? ", truncado" : "")}: {texto}");
        y += alto;
    }

    private int Barras1D(byte[] d, int i, int j)
    {
        byte m = Byte(d, j);
        string datos; int fin;
        if (m <= 6)
        {
            int k = j + 1; while (k < d.Length && d[k] != 0) k++;
            datos = Encoding.Latin1.GetString(d, j + 1, k - j - 1); fin = k + 1;
        }
        else
        {
            int n = Byte(d, j + 1);
            datos = Encoding.Latin1.GetString(d, Math.Min(d.Length, j + 2), Math.Max(0, Math.Min(n, d.Length - j - 2))); fin = j + 2 + n;
        }
        BarcodeFormat? formato = m switch
        {
            0 or 65 => BarcodeFormat.UPC_A, 1 or 66 => BarcodeFormat.UPC_E, 2 or 67 => BarcodeFormat.EAN_13, 3 or 68 => BarcodeFormat.EAN_8,
            4 or 69 => BarcodeFormat.CODE_39, 5 or 70 => BarcodeFormat.ITF, 6 or 71 => BarcodeFormat.CODABAR, 72 => BarcodeFormat.CODE_93,
            73 => BarcodeFormat.CODE_128, _ => null,
        };
        if (formato is null) { Anotar(i, "barras", $"GS k {m}: simbología que el emulador no dibuja ({datos})"); return fin; }
        try
        {
            CerrarLinea(avanzar: linea.Count > 0);
            string limpio = formato == BarcodeFormat.CODE_128 && datos.Length > 0 && datos[0] == '{' ? datos[2..] : datos;
            var mat = new MultiFormatWriter().encode(limpio, formato.Value, 0, 1,
                new Dictionary<EncodeHintType, object> { [EncodeHintType.MARGIN] = 0 });
            int ancho = mat.Width * barModulo;
            int x = margenIzq + alineacion switch { 1 => (anchoImpresion - ancho) / 2, 2 => anchoImpresion - ancho, _ => 0 };
            PintarMatriz(mat, x, y, barModulo, barAlto);
            Anotar(i, "barras", $"{formato} módulo {barModulo}, alto {barAlto}: {limpio}");
            y += barAlto;
        }
        catch (Exception ex) { Anotar(i, "barras", $"{formato}: no se pudo codificar «{datos}»: {ex.Message}"); }
        return fin;
    }

    /// <summary>Los módulos oscuros como rectángulos rellenos, como hace el motor con el QR de un informe.</summary>
    private void PintarMatriz(BitMatrix m, int x0, int y0, int anchoModulo, int altoModulo)
    {
        int negro = GraphicUtils.IntegerFromColor(Color.Black);
        for (int fila = 0; fila < m.Height; fila++)
        {
            // Los módulos contiguos de una fila se funden en un solo rectángulo: menos objetos y sin costuras.
            int col = 0;
            while (col < m.Width)
            {
                if (!m[col, fila]) { col++; continue; }
                int desde = col;
                while (col < m.Width && m[col, fila]) col++;
                pagina.DrawShape(Punto(x0 + desde * anchoModulo), Punto(y0 + fila * altoModulo),
                    Punto((col - desde) * anchoModulo), Punto(altoModulo), ShapeType.Rectangle,
                    BrushType.Solid, PenType.Clear, 0, negro, negro);
            }
        }
    }

    // ------------------------------------------------------------------ imágenes
    private int RasterGsV0(byte[] d, int i, int j)
    {
        if (Byte(d, j) != (byte)'0' && Byte(d, j) != 0) { Anotar(i, "comando", $"GS v {Byte(d, j)}: se ignora"); return j + 1; }
        byte m = Byte(d, j + 1);
        int xBytes = Byte(d, j + 2) + Byte(d, j + 3) * 256;
        int alto = Byte(d, j + 4) + Byte(d, j + 5) * 256;
        int desde = j + 6;
        int total = xBytes * alto;
        var bmp = Bitmap1bpp(d, desde, xBytes, alto);
        PintarImagen(bmp, m is 1 or 3 ? 2 : 1, m is 2 or 3 ? 2 : 1, i, $"GS v 0 ({xBytes * 8}×{alto} puntos)");
        return Math.Min(d.Length, desde + total);
    }

    private int DefinirImagen(byte[] d, int i, int j)
    {
        int xBytes = Byte(d, j), yBytes = Byte(d, j + 1);
        int desde = j + 2;
        // Formato por columnas de 8 puntos: yBytes bytes por columna, xBytes*8 columnas.
        int ancho = xBytes * 8, alto = yBytes * 8;
        var bmp = new SKBitmap(Math.Max(1, ancho), Math.Max(1, alto), SKColorType.Rgba8888, SKAlphaType.Premul);
        bmp.Erase(SKColors.White);
        int k = desde;
        for (int col = 0; col < ancho; col++)
            for (int fila8 = 0; fila8 < yBytes; fila8++, k++)
            {
                byte b = Byte(d, k);
                for (int bit = 0; bit < 8; bit++)
                    if ((b & (0x80 >> bit)) != 0) bmp.SetPixel(col, fila8 * 8 + bit, SKColors.Black);
            }
        imagenDescargada?.Dispose();
        imagenDescargada = bmp;
        Anotar(i, "imagen", $"GS * : imagen descargada de {ancho}×{alto} puntos");
        return Math.Min(d.Length, desde + xBytes * 8 * yBytes);
    }

    private int ImagenEscP(byte[] d, int i, int j)
    {
        byte m = Byte(d, j);
        int columnas = Byte(d, j + 1) + Byte(d, j + 2) * 256;
        int desde = j + 3;
        (int densidad, int bytesPorColumna) = m switch
        {
            0 => (60, 1), 1 => (120, 1), 2 => (120, 1), 3 => (240, 1), 4 => (80, 1), 5 => (72, 1), 6 => (90, 1), 7 => (144, 1),
            32 => (60, 3), 33 => (120, 3), 38 => (90, 3), 39 => (180, 3), 40 => (360, 3), 71 => (180, 6), 72 => (360, 6), 73 => (360, 6),
            _ => (60, 1),
        };
        return ImagenColumnas(d, i, desde, columnas, bytesPorColumna, densidad, $"ESC * {m}");
    }

    private int ImagenEscP8(byte[] d, int i, int j, int densidad)
    {
        int columnas = Byte(d, j) + Byte(d, j + 1) * 256;
        return ImagenColumnas(d, i, j + 2, columnas, 1, densidad, $"ESC K/L/Y/Z");
    }

    private int ImagenColumnas(byte[] d, int i, int desde, int columnas, int bytesPorColumna, int densidad, string nombre)
    {
        int alto = bytesPorColumna * 8;
        var bmp = new SKBitmap(Math.Max(1, columnas), Math.Max(1, alto), SKColorType.Rgba8888, SKAlphaType.Premul);
        bmp.Erase(SKColors.White);
        int k = desde;
        for (int col = 0; col < columnas; col++)
            for (int b8 = 0; b8 < bytesPorColumna; b8++, k++)
            {
                byte b = Byte(d, k);
                for (int bit = 0; bit < 8; bit++)
                    if ((b & (0x80 >> bit)) != 0) bmp.SetPixel(col, b8 * 8 + bit, SKColors.Black);
            }
        // Cada columna vale 1/densidad de pulgada de ancho; los 8 o 24 puntos, 1/72" ó 1/60"·… se
        // aproxima a la altura de la agujas: 1/72" por punto (matricial de 9 agujas) y 1/180" (24).
        double anchoPuntos = columnas * (double)cfg.Dpi / densidad;
        double altoPuntos = alto * (double)cfg.Dpi / (bytesPorColumna == 1 ? 72.0 : 180.0);
        CerrarTramo();
        int x = margenIzq + cursorX;
        pagina.DrawImage(Punto(x), Punto(y), Punto(anchoPuntos), Punto(altoPuntos), ImageDrawStyleType.Stretch, cfg.Dpi, Png(bmp));
        cursorX += (int)Math.Round(anchoPuntos);
        Anotar(i, "imagen", $"{nombre}: {columnas} columnas × {alto} puntos a {densidad} ppp");
        bmp.Dispose();
        return Math.Min(d.Length, desde + columnas * bytesPorColumna);
    }

    private static SKBitmap Bitmap1bpp(byte[] d, int desde, int xBytes, int alto)
    {
        var bmp = new SKBitmap(Math.Max(1, xBytes * 8), Math.Max(1, alto), SKColorType.Rgba8888, SKAlphaType.Premul);
        bmp.Erase(SKColors.White);
        int k = desde;
        for (int fila = 0; fila < alto; fila++)
            for (int xb = 0; xb < xBytes; xb++, k++)
            {
                byte b = Byte(d, k);
                for (int bit = 0; bit < 8; bit++)
                    if ((b & (0x80 >> bit)) != 0) bmp.SetPixel(xb * 8 + bit, fila, SKColors.Black);
            }
        return bmp;
    }

    private void PintarImagen(SKBitmap bmp, int escalaX, int escalaY, int offset, string nombre)
    {
        CerrarLinea(avanzar: linea.Count > 0);
        int ancho = bmp.Width * escalaX, alto = bmp.Height * escalaY;
        int x = margenIzq + alineacion switch { 1 => Math.Max(0, (anchoImpresion - ancho) / 2), 2 => Math.Max(0, anchoImpresion - ancho), _ => 0 };
        pagina.DrawImage(Punto(x), Punto(y), Punto(ancho), Punto(alto), ImageDrawStyleType.Stretch, cfg.Dpi, Png(bmp));
        Anotar(offset, "imagen", $"{nombre} pintada en {ancho}×{alto} puntos");
        y += alto;
    }

    private void PintarHueco(string etiqueta)
    {
        CerrarLinea(avanzar: linea.Count > 0);
        int alto = 24 * cfg.Dpi / 203 * 3, ancho = anchoImpresion / 2;
        int x = margenIzq + (anchoImpresion - ancho) / 2;
        int gris = GraphicUtils.IntegerFromColor(Color.Gray);
        pagina.DrawShape(Punto(x), Punto(y), Punto(ancho), Punto(alto), ShapeType.Rectangle, BrushType.Clear, PenType.Dash, 15, gris, gris);
        pagina.DrawText(Punto(x), Punto(y), Punto(ancho), Punto(alto), etiqueta, cfg.Fuente, cfg.Fuente, 8, 0, gris,
            GraphicUtils.IntegerFromColor(Color.White), true, 0, PDFFontType.Linked, TextAlignType.Center, TextAlignVerticalType.Center, true, false, false, PrintStepType.BySize);
        y += alto;
    }

    private static MemoryStream Png(SKBitmap bmp)
    {
        using var img = SKImage.FromBitmap(bmp);
        using var data = img.Encode(SKEncodedImageFormat.Png, 100);
        return new MemoryStream(data.ToArray());
    }

    // ------------------------------------------------------------------ FS y DLE
    private int Fs(byte[] d, int i)
    {
        byte c = Byte(d, i + 1);
        int j = i + 2;
        switch (c)
        {
            case (byte)'p': { byte n = Byte(d, j), m = Byte(d, j + 1); Anotar(i, "logo", $"FS p {n} {m}: logo NV {n} de la impresora, que el emulador no tiene; se pinta un hueco"); PintarHueco($"[LOGO NV {n}]"); return j + 2; }
            case (byte)'q': Anotar(i, "logo", "FS q: definición de logos NV — no se guarda; el resto del trabajo puede desalinearse"); return j + 1;
            case (byte)'.': case (byte)'&': return j;            // Kanji
            case (byte)'C': return j + 1;
            case (byte)'-': return j + 1;
            case (byte)'!': return j + 1;
            case (byte)'S': return j + 2;
            case (byte)'W': return j + 1;
            case (byte)'(':
            {
                int largo = Byte(d, j + 1) + Byte(d, j + 2) * 256;
                int fin = Math.Min(d.Length, j + 3 + largo);
                // FS ( C fn 48: el sistema de codificacion (1/49 un byte por caracter con ESC t;
                // 2/50 UTF-8, y entonces ESC t se ignora). Es lo que envia EPSONTM88UTF8.
                if (Byte(d, j) == (byte)'C' && Byte(d, j + 3) == 48)
                {
                    byte m = Byte(d, j + 4);
                    if (m is 2 or 50) { codificacion = Encoding.UTF8; Anotar(i, "codigos", "FS ( C 48 2: UTF-8"); }
                    else if (m is 1 or 49) { codificacion = Encoding.GetEncoding(cfg.PaginaCodigosInicial); Anotar(i, "codigos", "FS ( C 48 1: un byte por caracter (vuelve la pagina de codigos)"); }
                    return fin;
                }
                Anotar(i, "comando", $"FS ( {(char)Byte(d, j)} con {largo} bytes: se salta");
                return fin;
            }
            default: Anotar(i, "comando", $"FS 0x{c:X2} desconocido: se ignora"); return j;
        }
    }

    private int Dle(byte[] d, int i)
    {
        byte c = Byte(d, i + 1);
        switch (c)
        {
            case 0x04: Anotar(i, "estado", $"DLE EOT {Byte(d, i + 2)}: estado en tiempo real"); return i + 3;
            case 0x05: Anotar(i, "estado", $"DLE ENQ {Byte(d, i + 2)}"); return i + 3;
            case 0x14: Anotar(i, "estado", $"DLE DC4 {Byte(d, i + 2)}: generación de pulso / reset en tiempo real"); return i + 3 + (Byte(d, i + 2) == 1 ? 2 : 0);
            default: Anotar(i, "comando", $"DLE 0x{c:X2} desconocido"); return i + 2;
        }
    }
}
