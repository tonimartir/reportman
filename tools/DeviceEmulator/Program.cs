using Reportman.DeviceEmulator;

// =====================================================================================
// EL EMULADOR DE DISPOSITIVOS DEL TPV. Levanta los aparatos que el punto de venta espera
// encontrar —de momento el lector de códigos— cada uno escuchando en su puerto, y sirve una
// rejilla web donde están TODOS a la vez, cada uno con sus acciones, sus ajustes y el diario
// de bytes que de verdad se depura.
//
//   device-emulator                                 rejilla en 8080, lector en 9201
//   device-emulator --puerto 8090 --lector 9300     otros puertos
//   device-emulator --sin-navegador                 no abre el navegador (servidores, CI)
//
// El hermano de este programa es `escpos-emulator`, que hace lo mismo con la impresora
// térmica (TCP 9100). Cuando la rejilla esté asentada, la impresora será una tarjeta más.
// =====================================================================================

int PuertoDe(string bandera, int porDefecto)
{
    var i = Array.IndexOf(args, bandera);
    return i >= 0 && i + 1 < args.Length && int.TryParse(args[i + 1], out var n) ? n : porDefecto;
}

if (args.Contains("--help") || args.Contains("-h"))
{
    Console.WriteLine("""
        Emulador de dispositivos del TPV

          --puerto <n>       puerto de la rejilla web (8080)
          --lector <n>       puerto del lector de códigos (9201)
          --sin-navegador    no abrir el navegador al arrancar
        """);
    return 0;
}

var emulador = new Emulador();
emulador.Montar(new LectorSimple(), PuertoDe("--lector", 9201));
await emulador.IniciarAsync();

var host = new HostEmulador(emulador);
await host.IniciarAsync(PuertoDe("--puerto", 8080));

Console.WriteLine($"Rejilla en {host.Url}");
foreach (var p in emulador.Puestos)
    Console.WriteLine($"  {p.Dispositivo.Nombre,-22} {p.Transporte.Descripcion}");
Console.WriteLine("Ctrl+C para parar.");

if (!args.Contains("--sin-navegador"))
{
    // Abrir el navegador es el gesto que convierte esto en una herramienta y no en un servicio.
    // Si falla —no hay escritorio, es un servidor— no pasa nada: la URL está impresa arriba.
    try
    {
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(host.Url)
        { UseShellExecute = true });
    }
    catch { /* sin navegador: la URL ya está en pantalla */ }
}

var parar = new TaskCompletionSource();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; parar.TrySetResult(); };
AppDomain.CurrentDomain.ProcessExit += (_, _) => parar.TrySetResult();
await parar.Task;

await host.PararAsync();
await emulador.DisposeAsync();
Console.WriteLine("Parado.");
return 0;
