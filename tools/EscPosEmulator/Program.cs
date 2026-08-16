using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Text;
using Reportman.Drawing;
using Reportman.Drawing.CrossPlatform;
using Reportman.EscPosEmulator;

// =====================================================================================
// EL EMULADOR DE IMPRESORA DE TIQUES. Escucha como una impresora de red (puerto 9100) o lee
// un fichero de bytes, interpreta ESC/POS (y el ESC/P de los drivers de texto de Reportman)
// con el motor delante —los bytes se vuelven un MetaFile— y pinta lo que una térmica habría
// impreso: PDF (PrintOutPDFFreeType), PNG (PrintOutBitmapSkia) y el .rpmf para la vista
// previa. Con el diario de lo que no es texto: cortes, cajón, códigos, páginas de códigos.
//
//   escpos-emulator                              escucha en 0.0.0.0:9100, salida en ./salida
//   escpos-emulator --port 9100 --out c:\tiques --paper 80 --dpi 203 --font "Consolas"
//   escpos-emulator --file tique.escpos          interpreta el fichero y sale
//   escpos-emulator --file tique.escpos --show   ...y abre el PDF
//
// Opciones: --paper 80|58 · --dpi 203|180 · --codepage 850 (con la que arranca la impresora;
// Reportman escribe cp850) · --font <familia monoespaciada> · --mode escpos|escp · --no-pdf ·
// --no-png · --no-rpmf · --idle 800 (ms sin datos que cierran un trabajo en una conexión abierta).
// =====================================================================================

var opciones = Opciones.Parsear(args);
if (opciones is null) return 1;

var cfg = new ConfiguracionImpresora
{
    PapelMm = opciones.Papel, Dpi = opciones.Dpi, PaginaCodigosInicial = opciones.CodePage,
    Fuente = opciones.Fuente, Modo = opciones.Modo,
};
Directory.CreateDirectory(opciones.Salida);
var salida = new Salida(opciones, cfg);

if (opciones.Fichero is not null)
{
    var bytes = File.ReadAllBytes(opciones.Fichero);
    var trabajo = new Interprete(cfg).Interpretar(bytes);
    var nombre = Path.GetFileNameWithoutExtension(opciones.Fichero);
    salida.Guardar(trabajo, nombre);
    Console.WriteLine(salida.Resumen(trabajo, nombre));
    if (opciones.Mostrar) salida.Abrir(nombre);
    return 0;
}

var listener = new TcpListener(IPAddress.Any, opciones.Puerto);
listener.Start();
Console.WriteLine($"Emulador de impresora escuchando en 0.0.0.0:{opciones.Puerto} — papel {cfg.PapelMm} mm, {cfg.Dpi} ppp, cp{cfg.PaginaCodigosInicial}, fuente «{cfg.Fuente}», modo {cfg.Modo}");
Console.WriteLine($"Salida en {Path.GetFullPath(opciones.Salida)}  (Ctrl+C para parar)");
int contador = 0;
using var parar = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; parar.Cancel(); listener.Stop(); };
try
{
    while (!parar.IsCancellationRequested)
    {
        TcpClient cliente;
        try { cliente = await listener.AcceptTcpClientAsync(parar.Token); }
        catch (OperationCanceledException) { break; }
        catch (SocketException) when (parar.IsCancellationRequested) { break; }
        _ = Task.Run(async () =>
        {
            using (cliente)
            {
                var remoto = cliente.Client.RemoteEndPoint?.ToString() ?? "?";
                try
                {
                    await foreach (var bytes in LeerTrabajosAsync(cliente, opciones.IdleMs, parar.Token))
                    {
                        int n = Interlocked.Increment(ref contador);
                        var nombre = $"tique-{DateTime.Now:yyyyMMdd-HHmmss}-{n:000}";
                        var trabajo = new Interprete(cfg).Interpretar(bytes);
                        salida.Guardar(trabajo, nombre);
                        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] {remoto}: {salida.Resumen(trabajo, nombre)}");
                        if (opciones.Mostrar) salida.Abrir(nombre);
                    }
                }
                catch (Exception ex) { Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] {remoto}: error {ex.Message}"); }
            }
        });
    }
}
finally { listener.Stop(); }
return 0;

// Un trabajo es lo que llega hasta que el cliente cierra la conexión, o hasta que pasa un
// silencio (idle) con datos ya recibidos: hay clientes que dejan el socket abierto entre tiques.
static async IAsyncEnumerable<byte[]> LeerTrabajosAsync(TcpClient cliente, int idleMs,
    [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct)
{
    var flujo = cliente.GetStream();
    var buffer = new byte[64 * 1024];
    var acumulado = new MemoryStream();
    while (!ct.IsCancellationRequested)
    {
        var lectura = flujo.ReadAsync(buffer, 0, buffer.Length, ct);
        var espera = acumulado.Length > 0 ? Task.Delay(idleMs, ct) : Task.Delay(Timeout.Infinite, ct);
        var primero = await Task.WhenAny(lectura, espera);
        if (primero == espera && acumulado.Length > 0)
        {
            yield return acumulado.ToArray();
            acumulado.SetLength(0);
            continue;
        }
        int leidos;
        try { leidos = await lectura; } catch (IOException) { leidos = 0; }
        if (leidos <= 0) break;
        acumulado.Write(buffer, 0, leidos);
        // Las peticiones de estado en tiempo real esperan un byte: se contesta «en línea, sin
        // errores» para que el cliente no se quede colgado (DLE EOT n → 0x12; GS r/I → 0x00).
        for (int k = 0; k < leidos - 2; k++)
            if (buffer[k] == 0x10 && buffer[k + 1] == 0x04) { try { await flujo.WriteAsync(new byte[] { 0x12 }, ct); } catch { } }
    }
    if (acumulado.Length > 0) yield return acumulado.ToArray();
}

sealed class Opciones
{
    public int Puerto = 9100;
    public string Salida = "salida";
    public string? Fichero;
    public int Papel = 80;
    public int Dpi = 203;
    public int CodePage = 850;
    public string Fuente = OperatingSystem.IsWindows() ? "Consolas" : "DejaVu Sans Mono";
    public string Modo = "escpos";
    public bool Pdf = true, Png = true, Rpmf = true, Mostrar = false;
    public int IdleMs = 800;

    public static Opciones? Parsear(string[] args)
    {
        var o = new Opciones();
        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i];
            string Val() => i + 1 < args.Length ? args[++i] : throw new ArgumentException($"Falta el valor de {a}");
            try
            {
                switch (a)
                {
                    case "--port": o.Puerto = int.Parse(Val(), CultureInfo.InvariantCulture); break;
                    case "--out": o.Salida = Val(); break;
                    case "--file": o.Fichero = Val(); break;
                    case "--paper": o.Papel = int.Parse(Val(), CultureInfo.InvariantCulture); break;
                    case "--dpi": o.Dpi = int.Parse(Val(), CultureInfo.InvariantCulture); break;
                    case "--codepage": o.CodePage = int.Parse(Val(), CultureInfo.InvariantCulture); break;
                    case "--font": o.Fuente = Val(); break;
                    case "--mode": o.Modo = Val(); break;
                    case "--idle": o.IdleMs = int.Parse(Val(), CultureInfo.InvariantCulture); break;
                    case "--no-pdf": o.Pdf = false; break;
                    case "--no-png": o.Png = false; break;
                    case "--no-rpmf": o.Rpmf = false; break;
                    case "--show": o.Mostrar = true; break;
                    case "-h": case "--help": case "-?":
                        Console.WriteLine("escpos-emulator [--port 9100] [--out dir] [--file bytes.escpos] [--paper 80|58] [--dpi 203] [--codepage 850] [--font familia] [--mode escpos|escp] [--idle ms] [--no-pdf] [--no-png] [--no-rpmf] [--show]");
                        return null;
                    default: Console.Error.WriteLine($"Opción desconocida: {a}"); return null;
                }
            }
            catch (Exception ex) { Console.Error.WriteLine(ex.Message); return null; }
        }
        return o;
    }
}

/// <summary>Los ficheros de un trabajo: PDF, PNG (una por página), .rpmf y el diario.</summary>
sealed class Salida(Opciones o, ConfiguracionImpresora cfg)
{
    public void Guardar(Trabajo t, string nombre)
    {
        var meta = t.Metafile;
        string ruta = Path.Combine(o.Salida, nombre);
        if (o.Rpmf) meta.SaveToFile(ruta + ".rpmf", true);
        if (o.Pdf)
        {
            using var pdf = new PrintOutPDFFreeType { FileName = ruta + ".pdf", Compressed = true };
            pdf.Print(meta);
        }
        if (o.Png)
        {
            using var png = new PrintOutBitmapSkia { Dpi = cfg.Dpi, FileName = ruta + ".png" };
            png.Print(meta);
        }
        var diario = new StringBuilder();
        diario.AppendLine($"{nombre}: {t.Bytes} bytes, {t.Paginas} página(s)");
        foreach (var s in t.Sucesos) diario.AppendLine($"  @{s.Offset,6}  {s.Tipo,-8} {s.Detalle}");
        File.WriteAllText(ruta + ".log", diario.ToString(), Encoding.UTF8);
    }

    public string Resumen(Trabajo t, string nombre)
    {
        var cortes = t.Sucesos.Count(s => s.Tipo == "corte");
        var extras = t.Sucesos.Where(s => s.Tipo is "cajon" or "barras" or "codigos" or "imagen" or "logo").Select(s => s.Tipo).Distinct();
        var raros = t.Sucesos.Count(s => s.Tipo == "comando");
        return $"{nombre}: {t.Bytes} B → {t.Paginas} pág., {cortes} corte(s)" +
               (extras.Any() ? ", " + string.Join("/", extras) : "") +
               (raros > 0 ? $", {raros} comando(s) sin interpretar (ver .log)" : "") +
               $"  [{(o.Pdf ? "pdf " : "")}{(o.Png ? "png " : "")}{(o.Rpmf ? "rpmf" : "")}]";
    }

    public void Abrir(string nombre)
    {
        try
        {
            string ruta = Path.Combine(o.Salida, nombre + (o.Pdf ? ".pdf" : ".png"));
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(ruta) { UseShellExecute = true });
        }
        catch (Exception ex) { Console.Error.WriteLine("No se pudo abrir: " + ex.Message); }
    }
}
