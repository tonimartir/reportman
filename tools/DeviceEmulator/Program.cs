using Reportman.DeviceEmulator;

// =====================================================================================
// EL EMULADOR DE DISPOSITIVOS DEL TPV. Levanta los aparatos que el punto de venta espera
// encontrar —lector, Magellan (lector y balanza a la vez), balanza, visor de puerto y visor
// de segunda pantalla— cada uno escuchando en su puerto, y sirve una rejilla web donde estan
// TODOS a la vez, cada uno con sus acciones, sus ajustes y el diario de bytes que de verdad
// se depura.
//
//   device-emulator                             la rejilla en 8080 y los cinco aparatos
//   device-emulator --puerto 8090               otra rejilla
//   device-emulator --lector 9300               otro puerto para un aparato
//   device-emulator --lector-serie COM3         el lector TAMBIEN por un COM (par com0com)
//   device-emulator --sin-navegador             no abrir el navegador (servidores, CI)
//   device-emulator --solo lector,magellan      levantar unos pocos
//
// El hermano de este programa es `escpos-emulator`, que hace lo mismo con la impresora
// termica (TCP 9100).
// =====================================================================================

string? Valor(string bandera)
{
    var i = Array.IndexOf(args, bandera);
    return i >= 0 && i + 1 < args.Length && !args[i + 1].StartsWith("--") ? args[i + 1] : null;
}
int Puerto(string bandera, int porDefecto) =>
    int.TryParse(Valor(bandera), out var n) ? n : porDefecto;

if (args.Contains("--help") || args.Contains("-h"))
{
    Console.WriteLine("""
        Emulador de dispositivos del TPV

          --puerto <n>          puerto de la rejilla web (8080)
          --lector <n>          puerto del lector de codigos (9201)
          --magellan <n>        puerto del Magellan, lector y balanza (9202)
          --balanza <n>         puerto de la balanza Baxtran (9203)
          --visor <n>           puerto del visor de cliente (9204)
          --segunda <n>         puerto del visor de segunda pantalla (9205)
          --impresora <n>       puerto de la impresora de tiques (9206; el papel lo
                                pinta el hermano escpos-emulator, en el 9100)
          --<aparato>-serie <p> ademas, por un puerto serie (COM3, /dev/ttyS0)
          --baudios <n>         velocidad de los puertos serie (9600)
          --solo a,b,c          levantar solo esos aparatos
          --sin-navegador       no abrir el navegador al arrancar
        """);
    return 0;
}

// «--solo lector,magellan» para cuando estorban los demas. Sin la bandera, van todos: el
// emulador existe justamente para tener el mostrador entero delante.
var soloTexto = Valor("--solo");
var solo = soloTexto?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
bool Levantar(string id) => solo is null || solo.Contains(id, StringComparer.OrdinalIgnoreCase);

var baudios = Puerto("--baudios", 9600);
var emulador = new Emulador();

void Montar(string bandera, int puertoPorDefecto, IDispositivo dispositivo)
{
    if (!Levantar(dispositivo.Id)) return;
    var puesto = emulador.Montar(dispositivo, Puerto(bandera, puertoPorDefecto));
    // El serie es OPCIONAL y va ADEMAS del TCP, no en su lugar: asi la misma sesion sirve para
    // probar el camino de red y, si hay un par com0com montado, el de COM — sin reiniciar nada.
    if (Valor($"{bandera}-serie") is { } com) emulador.Anadir(puesto, new PuertoSerie(com, baudios));
}

Montar("--lector", 9201, new LectorSimple());
Montar("--magellan", 9202, new Magellan());
Montar("--balanza", 9203, new BalanzaBaxtran());
Montar("--visor", 9204, new VisorPuerto());
// Con su identificador explicito: los dos visores nacen llamandose «visor» y el id es la clave
// de la API y del diario — dos aparatos con el mismo id serian el mismo aparato.
Montar("--segunda", 9205, new VisorSegundaPantalla("segunda", "Visor de segunda pantalla"));
// La impresora NO va en el 9100 por defecto: ese puerto es del hermano `escpos-emulator`, que
// es quien pinta el papel de verdad. Esta cuenta lo que llega y lo pone EN EL MISMO DIARIO que
// el escaneo que lo provoco, que es lo que aqui aporta.
Montar("--impresora", 9206, new ImpresoraEscPos());

if (emulador.Puestos.Count == 0)
{
    Console.Error.WriteLine($"«--solo {soloTexto}» no deja ningun aparato en pie.");
    return 2;
}

await emulador.IniciarAsync();

var host = new HostEmulador(emulador);
await host.IniciarAsync(Puerto("--puerto", 8080));

Console.WriteLine($"Rejilla en {host.Url}");
foreach (var p in emulador.Puestos)
    Console.WriteLine($"  {p.Dispositivo.Nombre,-26} {string.Join("  ·  ", p.Transportes.Select(t => t.Descripcion))}");
Console.WriteLine("Ctrl+C para parar.");

if (!args.Contains("--sin-navegador"))
{
    // Abrir el navegador es el gesto que convierte esto en una herramienta y no en un servicio.
    // Si falla —no hay escritorio, es un servidor— no pasa nada: la URL esta impresa arriba.
    try
    {
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(host.Url)
        { UseShellExecute = true });
    }
    catch { /* sin navegador: la URL ya esta en pantalla */ }
}

var parar = new TaskCompletionSource();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; parar.TrySetResult(); };
AppDomain.CurrentDomain.ProcessExit += (_, _) => parar.TrySetResult();
await parar.Task;

await host.PararAsync();
await emulador.DisposeAsync();
Console.WriteLine("Parado.");
return 0;
