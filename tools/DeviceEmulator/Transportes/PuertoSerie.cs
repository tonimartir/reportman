using System.IO.Ports;

namespace Reportman.DeviceEmulator;

/// <summary>
/// EL APARATO POR EL CABLE DE VERDAD: un puerto COM. Es el transporte que demuestra que el camino
/// serie del TPV funciona, y no sólo el que va contra un socket.
///
/// Es OPCIONAL y va ADEMÁS del TCP, no en su lugar (Program.cs:61-63, Emulador.cs:88-94): el
/// emulador entero arranca y se usa sin instalar nada, y este transporte sólo aparece cuando
/// alguien da un nombre de puerto — un extremo de un par com0com, un conversor USB-serie o un COM
/// de la máquina.
///
/// LO PARTICULAR ES QUE NO SE PUEDE CAER, y de ahí sale casi todo lo demás. Un puerto que no
/// existe, que está ocupado o que alguien desenchufa a media trama no puede tirar el emulador ni
/// callar al aparato por su otro cable: se queda «sin conectar», con el motivo a la vista en
/// <see cref="Descripcion"/>, y VUELVE A INTENTARLO cada pocos segundos. El caso normal es
/// exactamente ése —el par virtual se crea, o el cable se enchufa, DESPUÉS de arrancar el
/// emulador—, y es también lo que hace nt2, que abre dentro del bucle del hilo de lectura
/// (Dispositivos.cs:491-497) y tras un fallo cierra y espera 30 s antes de reintentar (696-723, la
/// espera en 721). Aquí se espera mucho menos y el fallo NO saca un diálogo (nt2 lo hace en 702):
/// medio minuto en blanco delante de una herramienta se parece demasiado a una avería.
/// </summary>
public sealed class PuertoSerie(
    string puerto,
    int baudios = 9600,
    Parity paridad = Parity.None,
    int bitsDatos = 8,
    StopBits bitsParada = StopBits.One,
    Handshake control = Handshake.None,
    bool dtr = true,
    bool rts = true,
    int esperaEscrituraMs = 5000,
    TimeSpan? reintento = null) : ITransporte
{
    private readonly string nombre = string.IsNullOrWhiteSpace(puerto)
        ? throw new ArgumentException("Hace falta el nombre del puerto serie: «COM3», «/dev/ttyUSB0».")
        : puerto.Trim();

    private readonly int velocidad = baudios > 0
        ? baudios
        : throw new ArgumentException($"«{baudios}» no son baudios: la velocidad tiene que ser mayor que cero.");

    private readonly int datos = bitsDatos is >= 5 and <= 8
        ? bitsDatos
        : throw new ArgumentException($"«{bitsDatos}» no son bits de datos: van de 5 a 8.");

    private readonly StopBits parada = bitsParada is not StopBits.None
        ? bitsParada
        : throw new ArgumentException("Un puerto sin bits de parada no se puede abrir; lo corriente es 1.");

    /// <summary>Lo que nt2 configura como WRITE_TIMEOUT (Dispositivos.cs:941-942). Importa cuando
    /// el control de flujo es por hardware: sin espera, una escritura contra un aparato que no
    /// levanta CTS se queda colgada para siempre y el emulador deja de emitir por ese cable. El
    /// valor por defecto es el mismo que usa el terminal (ImpresionWindows.cs:166-168).</summary>
    private readonly int msEscritura = esperaEscrituraMs > 0
        ? esperaEscrituraMs
        : throw new ArgumentException("La espera de escritura va en milisegundos y tiene que ser mayor que cero.");

    private readonly TimeSpan espera = reintento ?? TimeSpan.FromSeconds(2);

    /// <summary>Un puerto serie es UN hilo de bytes: una acción de la ficha y una respuesta a lo
    /// que acaba de llegar pueden coincidir, y dos escrituras a la vez saldrían entrelazadas — el
    /// TPV leería una trama que nadie ha mandado.</summary>
    private readonly SemaphoreSlim turno = new(1, 1);

    private SerialPort? abierto;
    private volatile string? motivo;
    private CancellationTokenSource? propia;
    private Task? bucle;

    public string Descripcion
    {
        get
        {
            var cable = $"{nombre} {velocidad} {Trama}";
            // El motivo va aquí porque la ficha y el arranque (Program.cs:84-85) no enseñan otra
            // cosa de este transporte: sin él, un nombre mal escrito y un puerto ocupado por otro
            // programa son el mismo silencio.
            return abierto is not null ? cable : $"{cable} — sin conectar: {motivo ?? "abriendo"}";
        }
    }

    /// <summary>El cable es punto a punto: o hay alguien al otro extremo o no hay puerto.</summary>
    public int Clientes => abierto is not null ? 1 : 0;

    public event Action<byte[]>? Recibido;

    /// <summary>La forma corta de siempre: «8N1» es 8 bits de datos, sin paridad, 1 de parada.</summary>
    private string Trama => $"{datos}{Letra(paridad)}{Fin(parada)}";

    public Task IniciarAsync(CancellationToken ct)
    {
        propia = CancellationTokenSource.CreateLinkedTokenSource(ct);
        // El primer intento se hace AQUÍ, y no dentro del bucle, para que la línea que se imprime
        // nada más arrancar (Program.cs:84-85) diga ya la verdad. Falle o no, esto no lanza: el
        // aparato tiene que quedar en pie aunque el COM no exista.
        Abrir();
        bucle = EjecutarAsync(propia.Token);
        return Task.CompletedTask;
    }

    private async Task EjecutarAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            if ((abierto ?? Abrir()) is { } cable)
            {
                await LeerAsync(cable, ct);   // vuelve cuando el cable falla o se cancela
                Cerrar(cable);
            }
            // La espera es también DESPUÉS de una lectura caída: un adaptador medio suelto que
            // abre y se muere al instante haría girar este bucle sin descanso.
            try { await Task.Delay(espera, ct); }
            catch (OperationCanceledException) { break; }
        }
    }

    private SerialPort? Abrir()
    {
        SerialPort? nuevo = null;
        try
        {
            nuevo = new SerialPort(nombre, velocidad, paridad, datos, parada)
            {
                Handshake = control,

                // AVISO MEDIDO: nt2 CRUZA estas dos (Dispositivos.cs:938-939) — pone DtrEnable
                // con el valor de la columna RTSENABLE y RtsEnable con el de DTRENABLE. Aquí cada
                // una va a la suya. Si alguien compara el emulador con el terminal viejo y le
                // salen las líneas al revés, el fallo está allí; no se copia.
                DtrEnable = dtr,
                RtsEnable = rts,

                // Sin espera de lectura a propósito: el bucle vive dentro de ReadAsync, y un
                // timeout aquí sólo serviría para cerrar un puerto sano porque el aparato lleva
                // un rato callado, que es lo normal en un mostrador.
                ReadTimeout = SerialPort.InfiniteTimeout,
                WriteTimeout = msEscritura,
            };
            nuevo.Open();
            motivo = null;
            abierto = nuevo;
            return nuevo;
        }
        catch (Exception e)
        {
            // Se atrapa TODO, y no una lista de tipos, porque el tipo depende del sistema y del
            // driver: el mismo «no está» sale como IOException con com0com, como
            // FileNotFoundException en Linux y como ArgumentException si el nombre no le gusta a
            // Windows. Ninguno de esos es motivo para llevarse por delante al aparato.
            motivo = Motivo(e);
            try { nuevo?.Dispose(); } catch { /* ni llegó a abrirse */ }
            return null;
        }
    }

    private async Task LeerAsync(SerialPort cable, CancellationToken ct)
    {
        // Por bloques y esperando en el driver. nt2 lee byte a byte preguntando cuántos hay y
        // durmiendo 50 ms cuando no hay ninguno (Dispositivos.cs:521-541, 692-693); aquí no hace
        // falta ese sondeo, y el troceado de la trama es del dispositivo, no del cable.
        var buffer = new byte[4096];
        try
        {
            while (!ct.IsCancellationRequested)
            {
                var leidos = await cable.BaseStream.ReadAsync(buffer, ct);
                // Con espera infinita, leer 0 no es «todavía no hay datos» —eso se queda esperando
                // dentro— sino el puerto que ha dejado de existir.
                if (leidos == 0) break;
                Recibido?.Invoke(buffer[..leidos]);
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception e)
        {
            // El cable se fue a mitad: se anota el motivo, se cierra fuera y se vuelve a abrir. Un
            // USB que alguien saca del portátil no puede matar el proceso.
            motivo = Motivo(e);
        }
    }

    public async Task EnviarAsync(byte[] bytes, CancellationToken ct)
    {
        var cable = abierto;
        // Sin puerto no hay a quién emitir, y no es un error: el aparato sigue hablando por TCP y
        // el diario ya anotó la trama antes de llegar aquí (Emulador.cs:56-60), así que lo que no
        // salió por el COM se ve igual en pantalla.
        if (cable is null) return;

        await turno.WaitAsync(ct);
        try { await cable.BaseStream.WriteAsync(bytes, ct); }
        catch (OperationCanceledException) { }
        catch (Exception e)
        {
            motivo = Motivo(e);
            Cerrar(cable);   // el bucle lo reabrirá cuando el cable vuelva
        }
        finally { turno.Release(); }
    }

    public async ValueTask DisposeAsync()
    {
        try { propia?.Cancel(); } catch { /* ya cancelado */ }

        // El puerto se desecha ANTES de esperar al bucle, y el orden no es caprichoso: la lectura
        // pendiente espera dentro del driver y no se puede dar por cortada con el token; lo que la
        // despierta es que el manejador desaparezca. Al revés, este await se quedaría esperando a
        // un aparato que no piensa volver a hablar.
        Cerrar(abierto);

        if (bucle is not null) { try { await bucle; } catch { /* el bucle sale por cancelación */ } }
        propia?.Dispose();
        turno.Dispose();
    }

    private void Cerrar(SerialPort? cable)
    {
        if (cable is null) return;
        Interlocked.CompareExchange(ref abierto, null, cable);
        // Cerrar un puerto que ya no está —el USB recién sacado— puede volver a lanzar la misma
        // excepción que acaba de matar la lectura. Se traga: lo que importa es soltar el manejador
        // para que el siguiente intento encuentre el puerto libre.
        try { cable.Dispose(); } catch { /* ya no estaba */ }
    }

    /// <summary>El fallo, dicho para que se lea en la ficha y no haya que abrir un depurador.</summary>
    private static string Motivo(Exception e) => e switch
    {
        UnauthorizedAccessException => "ocupado por otro programa (o sin permiso)",
        FileNotFoundException => "no existe",
        // El nombre no se valida aquí: quien decide qué es un puerto válido es el sistema —COMx en
        // Windows, /dev/tty* en Linux, y com0com añade los suyos—, y un nombre imposible se
        // reintenta igual que los demás en vez de tirar el emulador por una regla nuestra.
        ArgumentException => $"nombre que el sistema no admite ({e.Message})",
        IOException => $"no existe o no responde ({e.Message})",
        _ => e.Message,
    };

    private static char Letra(Parity p) => p switch
    {
        Parity.None => 'N',
        Parity.Odd => 'O',
        Parity.Even => 'E',
        Parity.Mark => 'M',
        Parity.Space => 'S',
        _ => '?',
    };

    private static string Fin(StopBits b) => b switch
    {
        StopBits.One => "1",
        StopBits.OnePointFive => "1.5",
        StopBits.Two => "2",
        _ => "?",
    };
}
