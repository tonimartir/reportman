using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;

namespace Reportman.DeviceEmulator;

/// <summary>
/// EL APARATO COMO SERVIDOR DE RED. Escucha un puerto, admite a quien llegue y reparte a todos.
///
/// Es el transporte por defecto por lo que dice el plan: funciona sin administrador, sin driver y
/// dentro del CI, y es además lo que hace un conversor serie-LAN de verdad — que es el camino
/// profesional cuando el aparato es serie y el TPV está en otra sala.
///
/// REPARTE A TODOS los conectados a propósito. En el mostrador hay un TPV y un aparato, pero en la
/// mesa de desarrollo hay a menudo dos ventanas mirando lo mismo, y que una robe las tramas de la
/// otra convierte una prueba en un misterio. Un cliente que se cae no se lleva a los demás ni al
/// emulador: se le retira y la escucha sigue.
/// </summary>
public sealed class TcpEscucha(IPAddress direccion, int puerto) : ITransporte
{
    private readonly ConcurrentDictionary<Guid, TcpClient> clientes = new();
    private TcpListener? escucha;
    private CancellationTokenSource? propia;
    private Task? bucle;

    /// <summary>El puerto REAL. Con 0 lo elige el sistema, que es como lo abren las pruebas.</summary>
    public int Puerto { get; private set; } = puerto;
    public string Descripcion => $"TCP {direccion}:{Puerto}";
    public int Clientes => clientes.Count;
    public event Action<byte[]>? Recibido;

    public Task IniciarAsync(CancellationToken ct)
    {
        escucha = new TcpListener(direccion, Puerto);
        escucha.Start();
        // Con puerto 0 el sistema elige uno libre: hay que preguntar cuál, o las pruebas no
        // sabrían a dónde conectarse (y dos pruebas a la vez chocarían en un puerto fijo).
        Puerto = ((IPEndPoint)escucha.LocalEndpoint).Port;

        propia = CancellationTokenSource.CreateLinkedTokenSource(ct);
        bucle = AceptarAsync(propia.Token);
        return Task.CompletedTask;
    }

    private async Task AceptarAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            TcpClient cliente;
            try { cliente = await escucha!.AcceptTcpClientAsync(ct); }
            catch (OperationCanceledException) { break; }
            catch (SocketException) { break; }   // la escucha se cerró: se sale sin ruido

            var id = Guid.NewGuid();
            clientes[id] = cliente;
            _ = LeerAsync(id, cliente, ct);
        }
    }

    private async Task LeerAsync(Guid id, TcpClient cliente, CancellationToken ct)
    {
        var buffer = new byte[4096];
        try
        {
            var flujo = cliente.GetStream();
            while (!ct.IsCancellationRequested)
            {
                var leidos = await flujo.ReadAsync(buffer, ct);
                if (leidos == 0) break;   // el otro extremo cerró
                Recibido?.Invoke(buffer[..leidos]);
            }
        }
        catch (OperationCanceledException) { }
        catch (IOException) { }           // se cayó la conexión: no es un error del emulador
        catch (SocketException) { }
        finally
        {
            clientes.TryRemove(id, out _);
            try { cliente.Dispose(); } catch { /* ya estaba cerrado */ }
        }
    }

    public async Task EnviarAsync(byte[] bytes, CancellationToken ct)
    {
        foreach (var (id, cliente) in clientes)
        {
            try { await cliente.GetStream().WriteAsync(bytes, ct); }
            catch (Exception e) when (e is IOException or ObjectDisposedException or SocketException)
            {
                // Se cayó mientras se le escribía. Se retira y se sigue con los demás: un aparato
                // real no deja de emitir porque un cliente se haya desenchufado.
                clientes.TryRemove(id, out _);
                try { cliente.Dispose(); } catch { /* ya estaba cerrado */ }
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        try { propia?.Cancel(); } catch { /* ya cancelado */ }
        try { escucha?.Stop(); } catch { /* ya parado */ }
        foreach (var (_, c) in clientes) { try { c.Dispose(); } catch { /* ya cerrado */ } }
        clientes.Clear();
        if (bucle is not null) { try { await bucle; } catch { /* el bucle sale por cancelación */ } }
        propia?.Dispose();
    }
}
