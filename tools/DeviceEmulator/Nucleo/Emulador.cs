using System.Net;

namespace Reportman.DeviceEmulator;

/// <summary>
/// UN APARATO MONTADO SOBRE SUS CABLES: el dispositivo, sus transportes y el diario en medio.
///
/// SON VARIOS CABLES A PROPÓSITO, no uno. Un aparato de verdad tiene un puerto y ya, pero el
/// emulador tiene que servir para las dos pruebas de la misma sesión: la de red —que funciona en
/// cualquier máquina y en el CI— y la de COM, cuando hay un par de puertos virtuales montado. Si
/// eligiera uno, cambiar de camino obligaría a reiniciar y a reconfigurar, que es justo la
/// fricción por la que las pruebas del camino serie no se hacen nunca.
///
/// Todo lo que cruza se anota, en los dos sentidos, ANTES de entregarse. Es deliberado: cuando algo
/// va mal, lo primero que hace falta saber es si los bytes salieron — y si se anotaran después de
/// procesarlos, la trama que hace reventar al dispositivo sería justo la que no aparece.
/// </summary>
public sealed class Puesto(IDispositivo dispositivo, Diario diario) : IAsyncDisposable
{
    private readonly List<ITransporte> transportes = [];

    public IDispositivo Dispositivo => dispositivo;
    public IReadOnlyList<ITransporte> Transportes => transportes;
    /// <summary>Cuántos hablan con este aparato ahora mismo, por todos sus cables.</summary>
    public int Clientes => transportes.Sum(t => t.Clientes);

    public void Anadir(ITransporte transporte)
    {
        transporte.Recibido += bytes =>
        {
            diario.Anotar(dispositivo.Id, "recibe", bytes);
            byte[]? respuesta;
            try { respuesta = dispositivo.Recibir(bytes); }
            catch (Exception e)
            {
                // Un aparato real no se apaga porque le llegue basura por el cable. Se anota y se
                // sigue escuchando: si esto tirara el puesto, una trama mala mataría la sesión.
                diario.Anotar(dispositivo.Id, "error", System.Text.Encoding.Latin1.GetBytes(e.Message));
                return;
            }
            if (respuesta is { Length: > 0 }) _ = EmitirAsync(respuesta, CancellationToken.None);
        };
        transportes.Add(transporte);
    }

    public async Task IniciarAsync(CancellationToken ct)
    {
        foreach (var t in transportes) await t.IniciarAsync(ct);
    }

    /// <summary>
    /// Los bytes que el aparato manda al TPV, POR TODOS SUS CABLES. Se anotan aunque no haya nadie
    /// escuchando: «escaneé y no llegó» y «escaneé y no salió» son dos averías distintas, y sin el
    /// apunte no hay forma de saber cuál de las dos es.
    /// </summary>
    public async Task EmitirAsync(byte[] bytes, CancellationToken ct)
    {
        diario.Anotar(dispositivo.Id, "emite", bytes);
        foreach (var t in transportes) await t.EnviarAsync(bytes, ct);
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var t in transportes) await t.DisposeAsync();
        transportes.Clear();
    }
}

/// <summary>
/// EL EMULADOR: la lista de puestos y lo que se les puede pedir.
///
/// Es una BIBLIOTECA, no un programa: el host web lo usa, y las pruebas lo usan igual sin levantar
/// una sola ventana. Ésa es la razón entera de que la tecnología elegida fuera un host .NET y no
/// una aplicación de escritorio — el objetivo no es mirar tramas bonitas, es que una prueba pueda
/// decir «escanea esto» y comprobar el ticket que sale al otro lado.
/// </summary>
public sealed class Emulador : IAsyncDisposable
{
    private readonly List<Puesto> puestos = [];
    public Diario Diario { get; } = new();
    public IReadOnlyList<Puesto> Puestos => puestos;

    /// <summary>Monta un dispositivo con una escucha TCP. Puerto 0 = lo elige el sistema, que es
    /// como lo abren las pruebas para poder correr varias a la vez sin chocar.</summary>
    public Puesto Montar(IDispositivo dispositivo, int puerto)
    {
        var puesto = new Puesto(dispositivo, Diario);
        puesto.Anadir(new TcpEscucha(IPAddress.Any, puerto));
        puestos.Add(puesto);
        return puesto;
    }

    /// <summary>Otro cable para el mismo aparato (un COM, además del TCP).</summary>
    public void Anadir(Puesto puesto, ITransporte transporte) => puesto.Anadir(transporte);

    public async Task IniciarAsync(CancellationToken ct = default)
    {
        foreach (var p in puestos) await p.IniciarAsync(ct);
    }

    public Puesto? Buscar(string id) =>
        puestos.FirstOrDefault(p => p.Dispositivo.Id.Equals(id, StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// Ejecuta una acción de la ficha y emite lo que salga. Devuelve los bytes emitidos —o vacío si
    /// la acción no manda nada— para que la prueba pueda afirmar sobre ellos sin abrir un socket.
    /// </summary>
    public async Task<byte[]> EjecutarAsync(string dispositivo, string accion,
        IReadOnlyDictionary<string, string> parametros, CancellationToken ct = default)
    {
        var puesto = Buscar(dispositivo)
            ?? throw new ArgumentException($"No hay ningún dispositivo «{dispositivo}».");
        var bytes = puesto.Dispositivo.Ejecutar(accion, parametros);
        if (bytes is { Length: > 0 }) await puesto.EmitirAsync(bytes, ct);
        return bytes ?? [];
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var p in puestos) await p.DisposeAsync();
        puestos.Clear();
    }
}
