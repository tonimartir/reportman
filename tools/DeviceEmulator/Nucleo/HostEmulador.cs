using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Reportman.DeviceEmulator;

/// <summary>
/// LA REJILLA: el host que enseña todos los aparatos a la vez y deja tocarlos.
///
/// Es Kestrel sirviendo una página sin compilar —HTML y JavaScript planos, sin npm— porque esto es
/// una HERRAMIENTA: tiene que arrancar con un `dotnet run` en cualquier máquina y en el CI, y meter
/// un paso de compilación de frontend para pintar seis tarjetas sería pagar mucho por poco.
///
/// La API es deliberadamente pequeña, y es la misma que usan la pantalla y las pruebas:
///   GET  /api/dispositivos              qué hay, qué sabe hacer cada uno y por dónde escucha
///   POST /api/dispositivos/{id}/accion  ejecutar («escanear» este código)
///   PUT  /api/dispositivos/{id}/ajuste  cambiar un ajuste en vivo (el sufijo, el AIM)
///   GET  /api/diario                    los últimos bytes, en los dos sentidos
///   GET  /api/diario/vivo               lo mismo según ocurre (SSE)
/// </summary>
public sealed class HostEmulador(Emulador emulador)
{
    private WebApplication? app;

    /// <summary>El puerto REAL de la rejilla. Con 0 lo elige el sistema (las pruebas).</summary>
    public int Puerto { get; private set; }
    public string Url => $"http://localhost:{Puerto}";

    public async Task IniciarAsync(int puerto, CancellationToken ct = default)
    {
        var constructor = WebApplication.CreateBuilder();
        constructor.Logging.ClearProviders();          // el ruido de Kestrel tapa el diario
        constructor.WebHost.UseUrls($"http://127.0.0.1:{puerto}");
        constructor.Services.AddSingleton(emulador);

        app = constructor.Build();
        app.UseDefaultFiles();
        app.UseStaticFiles();
        Rutas(app, emulador);

        await app.StartAsync(ct);
        Puerto = new Uri(app.Urls.First()).Port;
    }

    public async Task PararAsync()
    {
        if (app is null) return;
        await app.StopAsync();
        await app.DisposeAsync();
        app = null;
    }

    private static void Rutas(WebApplication app, Emulador emulador)
    {
        app.MapGet("/api/dispositivos", () => Results.Ok(emulador.Puestos.Select(p => new
        {
            id = p.Dispositivo.Id,
            nombre = p.Dispositivo.Nombre,
            tipo = p.Dispositivo.Tipo,
            // «Sin cable» y no una cadena vacía: un hueco en la tarjeta se lee como un fallo de la
            // rejilla, y el lector de teclado no tiene puerto A PROPÓSITO — teclea en el navegador.
            transporte = p.Transportes.Count == 0
                ? "sin cable"
                : string.Join("  ·  ", p.Transportes.Select(t => t.Descripcion)),
            clientes = p.Clientes,
            acciones = p.Dispositivo.Acciones,
            ajustes = p.Dispositivo.Ajustes,
        })));

        app.MapPost("/api/dispositivos/{id}/accion", async (string id, PeticionAccion p) =>
        {
            try
            {
                var bytes = await emulador.EjecutarAsync(id, p.Accion, p.Parametros ?? new());
                return Results.Ok(new { hex = Convert.ToHexString(bytes), bytes = bytes.Length });
            }
            // 400 y no 500: pedir un código vacío o una acción que no existe es un error de quien
            // llama, y la ficha tiene que poder enseñar el motivo tal cual.
            catch (ArgumentException e) { return Results.BadRequest(new { error = e.Message }); }
        });

        app.MapPut("/api/dispositivos/{id}/ajuste", (string id, PeticionAjuste p) =>
        {
            var puesto = emulador.Buscar(id);
            if (puesto is null) return Results.NotFound(new { error = $"No hay ningún «{id}»." });
            try
            {
                puesto.Dispositivo.Ajustar(p.Clave, p.Valor);
                return Results.Ok(new { ajustes = puesto.Dispositivo.Ajustes });
            }
            catch (ArgumentException e) { return Results.BadRequest(new { error = e.Message }); }
        });

        app.MapGet("/api/diario", (int? ultimos) => Results.Ok(emulador.Diario.Ultimos(ultimos ?? 100)));
        app.MapDelete("/api/diario", () => { emulador.Diario.Vaciar(); return Results.NoContent(); });

        // EL DIARIO EN VIVO. Por SSE y no por WebSocket: el flujo es de una sola dirección y con
        // SSE el navegador reconecta solo — que es lo que quieres cuando reinicias el emulador y
        // no quieres además refrescar la pestaña.
        app.MapGet("/api/diario/vivo", async (HttpContext ctx, CancellationToken ct) =>
        {
            ctx.Response.Headers.ContentType = "text/event-stream";
            ctx.Response.Headers.CacheControl = "no-cache";
            // SE ABRE EL FLUJO ANTES DE TENER NADA QUE CONTAR. Sin este vaciado, las cabeceras no
            // salen hasta el primer evento: quien se suscribe se queda colgado esperando —el
            // navegador sin dar por abierta la conexión, y un cliente HTTP hasta agotar su
            // tiempo— justo mientras no pasa nada, que es el estado normal de un emulador.
            // El `:` es un comentario de SSE: no dispara ningún mensaje.
            await ctx.Response.WriteAsync(": abierto\n\n", ct);
            await ctx.Response.Body.FlushAsync(ct);

            var cola = System.Threading.Channels.Channel.CreateUnbounded<Apunte>();
            void Escuchar(Apunte a) => cola.Writer.TryWrite(a);
            emulador.Diario.Anotado += Escuchar;
            try
            {
                await foreach (var apunte in cola.Reader.ReadAllAsync(ct))
                {
                    // `JsonSerializerOptions.Web` y no las de por defecto: los endpoints REST de
                    // arriba los serializa ASP.NET en minúscula inicial y éste iba en mayúscula,
                    // así que la pantalla leía `numero` de un objeto que traía `Numero` y pintaba
                    // una fila entera de «undefined». Los dos caminos tienen que hablar igual.
                    await ctx.Response.WriteAsync(
                        $"data: {JsonSerializer.Serialize(apunte, JsonSerializerOptions.Web)}\n\n", ct);
                    await ctx.Response.Body.FlushAsync(ct);
                }
            }
            catch (OperationCanceledException) { /* la pestaña se fue */ }
            finally { emulador.Diario.Anotado -= Escuchar; }
        });
    }

    public sealed record PeticionAccion(string Accion, Dictionary<string, string>? Parametros);
    public sealed record PeticionAjuste(string Clave, string Valor);
}
