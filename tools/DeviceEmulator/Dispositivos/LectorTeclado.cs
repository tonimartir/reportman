using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace Reportman.DeviceEmulator;

/// <summary>
/// EL LECTOR DE TECLADO (wedge): el lector más común del mercado y el único aparato del mostrador
/// QUE NO TIENE CABLE. Se enchufa por USB, el sistema lo ve como un teclado y escribe el código
/// donde esté el cursor, muy rápido y terminando con una tecla.
///
/// POR QUÉ NO PUEDE SER UN APARATO CORRIENTE DEL EMULADOR: los demás emiten bytes por un
/// transporte y al otro lado hay un socket. Aquí no hay socket que valga — lo que hay que emular
/// es que **el navegador reciba pulsaciones**, porque quien oye a este lector es la pantalla del
/// TPV (`tpv.ts`, `@HostListener('document:keydown')`) y no el host. Un aparato que mandara el
/// código por TCP probaría el endpoint de escaneo, que ya se prueba con el cable, y no probaría
/// nada del wedge: ni la ráfaga por velocidad, ni el campo enfocado, ni que la tecla de fin se
/// trague (que es lo que evita que un Enter vuelva a pulsar «Cobrar»).
///
/// ASÍ QUE TECLEA DE VERDAD, por el protocolo de depuración de Chrome (CDP): `Input.dispatchKeyEvent`
/// entrega pulsaciones **de confianza** —insertan texto en el campo que tenga el foco y disparan
/// los manejadores igual que un dedo—, cosa que un `KeyboardEvent` despachado desde la propia
/// página no hace (`isTrusted:false`). Sólo hace falta abrir el Chrome del TPV con
/// `--remote-debugging-port=9222`; no hay dependencias nuevas: `ClientWebSocket` y `JsonSerializer`
/// vienen con .NET, y el emulador sigue sin un solo P/Invoke ni requisito de sistema.
///
/// LO QUE NO SE EJERCITA con este camino, dicho sin adornos: la distribución de teclado del sistema
/// y el driver HID. El navegador recibe el carácter ya resuelto, así que un lector configurado en
/// QWERTY contra una máquina en AZERTY seguiría dando otra cosa. Eso pide hierro.
/// </summary>
public sealed class LectorTeclado(string id = "teclado", string nombre = "Lector de teclado (HID)")
    : IDispositivo
{
    private string depuracion = "http://127.0.0.1:9222";
    private string objetivo = "localhost:5180";
    private int prefijo;            // 0 = ninguno
    private int sufijo = 13;        // 13 = Enter · 9 = Tab
    private int msEntreTeclas = 8;  // lo que tarda un lector de verdad entre tecla y tecla
    private bool aim;
    private string ultimo = "";

    public string Id => id;
    public string Nombre => nombre;
    public string Tipo => "lector";

    public IReadOnlyList<AccionDef> Acciones =>
    [
        new("escanear", "Escanear",
        [
            new CampoDef("codigo", "Código", "texto", "8412345678905",
                "Lo que el lector teclea. Sale carácter a carácter, con su prefijo y su tecla de fin."),
            new CampoDef("simbologia", "Simbología", "texto", "",
                "ean13 · ean8 · code128 · gs1_128 · itf14 · code39. Sólo se usa si «AIM» está puesto."),
        ]),
    ];

    public IReadOnlyList<AjusteDef> Ajustes =>
    [
        new("depuracion", "Chrome (depuración)", "texto", depuracion,
            "Dónde escucha el Chrome del TPV. Hay que abrirlo con «--remote-debugging-port=9222»: " +
            "sin eso no hay forma de teclear DE VERDAD en una página, y un evento inventado desde " +
            "dentro no vale (llega con isTrusted:false y no escribe en los campos)."),
        new("objetivo", "Pestaña", "texto", objetivo,
            "Un trozo de la URL de la pestaña donde teclear. Con varias abiertas se coge la primera " +
            "que lo contenga."),
        new("prefijo", "Carácter de inicio", "numero", prefijo.ToString(),
            "Código decimal del carácter con el que el lector se anuncia. 0 = ninguno; 126 es el «~» " +
            "de clientent. Si la pantalla lo tiene declarado y no llega, la ráfaga NO cuenta como lectura."),
        new("sufijo", "Tecla de fin", "numero", sufijo.ToString(),
            "13 = Enter (lo normal) · 9 = Tab (hay lectores que vienen así de fábrica). Es la tecla " +
            "que la pantalla tiene que TRAGARSE: en un TPV todo son botones y el último tocado " +
            "conserva el foco."),
        new("ms_entre_teclas", "Milisegundos entre teclas", "numero", msEntreTeclas.ToString(),
            "Un lector corriente va entre 5 y 15 ms. Subirlo por encima del umbral de la pantalla " +
            "(50 ms de fábrica) es la forma de comprobar que una ráfaga lenta se descarta: es lo " +
            "que distingue al lector de una persona."),
        new("aim", "Anteponer identificador AIM", "interruptor", aim ? "1" : "0",
            "«]E0» para EAN-13, «]C1» para GS1-128… Es lo que dice QUÉ se ha leído; sin él hay que " +
            "adivinar la simbología por la longitud."),
        new("ultimo", "Último tecleado", "texto", ultimo,
            "Lo que se tecleó la última vez, o el motivo de no haber podido. Un lector no recibe " +
            "nada: esto es todo lo suyo que hay que mirar.", SoloLectura: true),
    ];

    public void Ajustar(string clave, string valor)
    {
        switch (clave)
        {
            case "depuracion": depuracion = valor.Trim().TrimEnd('/'); break;
            case "objetivo": objetivo = valor.Trim(); break;
            case "prefijo": prefijo = Entero(valor, 0, 255); break;
            case "sufijo": sufijo = Entero(valor, 1, 255); break;
            case "ms_entre_teclas": msEntreTeclas = Entero(valor, 0, 1000); break;
            case "aim": aim = valor is "1" or "true" or "on"; break;
            case "ultimo":
                throw new ArgumentException("«Último tecleado» lo escribe el aparato, no la ficha.");
            default:
                throw new ArgumentException($"El lector de teclado no tiene el ajuste «{clave}».");
        }
    }

    /// <summary>
    /// Teclea en el navegador y devuelve lo tecleado. LOS BYTES QUE DEVUELVE NO SALEN POR NINGÚN
    /// CABLE —este aparato se monta sin transporte— pero sí van al DIARIO, que es lo que hace falta
    /// para distinguir «tecleé y no llegó» de «tecleé y no salió».
    /// </summary>
    public byte[]? Ejecutar(string accion, IReadOnlyDictionary<string, string> parametros)
    {
        if (accion != "escanear")
            throw new ArgumentException($"El lector de teclado no sabe hacer «{accion}».");

        var codigo = parametros.GetValueOrDefault("codigo", "").Trim();
        if (codigo.Length == 0)
            throw new ArgumentException("Un escaneo sin código no es un escaneo.");

        var texto = new StringBuilder();
        if (prefijo > 0) texto.Append((char)prefijo);
        if (aim && Aim(parametros.GetValueOrDefault("simbologia", "")) is { } id2) texto.Append(id2);
        texto.Append(codigo);

        try
        {
            TeclearAsync(texto.ToString()).GetAwaiter().GetResult();
            ultimo = texto.ToString();
        }
        catch (Exception e)
        {
            // El motivo se guarda EN LA FICHA y además se lanza: sin Chrome abierto en modo
            // depuración esto no puede funcionar, y un aparato que falla en silencio es peor que
            // uno que no está.
            ultimo = "no se pudo teclear: " + e.Message;
            throw new ArgumentException(ultimo);
        }
        return Encoding.Latin1.GetBytes(texto.ToString());
    }

    /// <summary>Un lector no recibe nada. Ni por cable —no tiene— ni de ninguna otra forma.</summary>
    public byte[]? Recibir(ReadOnlySpan<byte> bytes) => null;

    // ================= EL TECLEO =================

    private async Task TeclearAsync(string texto)
    {
        var ws = await PestanaAsync();
        using var socket = new ClientWebSocket();
        using var reloj = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        await socket.ConnectAsync(new Uri(ws), reloj.Token);

        var n = 0;
        foreach (var c in texto)
        {
            await TeclaAsync(socket, ++n, c.ToString(), c.ToString(), 0, reloj.Token);
            if (msEntreTeclas > 0) await Task.Delay(msEntreTeclas, reloj.Token);
        }
        // LA TECLA DE FIN, con su código: es la que la pantalla usa para cerrar la lectura y la
        // que tiene que tragarse. Va con `text` porque sin él Chrome no genera el keypress.
        if (sufijo == 9) await TeclaAsync(socket, ++n, "Tab", "\t", 9, reloj.Token);
        else await TeclaAsync(socket, ++n, "Enter", "\r", 13, reloj.Token);

        await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "", reloj.Token);
    }

    private static async Task TeclaAsync(ClientWebSocket socket, int id, string key, string texto,
                                         int codigoVirtual, CancellationToken ct)
    {
        await MandarAsync(socket, id * 2 - 1, new
        {
            type = "keyDown", key, text = texto,
            windowsVirtualKeyCode = codigoVirtual, nativeVirtualKeyCode = codigoVirtual,
        }, ct);
        await MandarAsync(socket, id * 2, new
        {
            type = "keyUp", key,
            windowsVirtualKeyCode = codigoVirtual, nativeVirtualKeyCode = codigoVirtual,
        }, ct);
    }

    private static async Task MandarAsync(ClientWebSocket socket, int id, object parametros, CancellationToken ct)
    {
        var orden = JsonSerializer.SerializeToUtf8Bytes(new
        {
            id, method = "Input.dispatchKeyEvent", @params = parametros,
        });
        await socket.SendAsync(orden, WebSocketMessageType.Text, endOfMessage: true, ct);
    }

    /// <summary>
    /// La pestaña donde teclear. Chrome publica sus objetivos en `/json/list`; se coge la primera
    /// PÁGINA cuya URL contenga <see cref="objetivo"/> — con el TPV y la rejilla del emulador
    /// abiertos a la vez, teclear en la que no es sería un misterio entretenido.
    /// </summary>
    private async Task<string> PestanaAsync()
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
        string json;
        try { json = await http.GetStringAsync($"{depuracion}/json/list"); }
        catch (Exception e)
        {
            throw new InvalidOperationException(
                $"no contesta el Chrome de depuración en {depuracion} ({e.GetType().Name}). " +
                "Hay que abrirlo con «--remote-debugging-port=9222».");
        }

        using var doc = JsonDocument.Parse(json);
        foreach (var t in doc.RootElement.EnumerateArray())
        {
            if (t.TryGetProperty("type", out var tipo) && tipo.GetString() != "page") continue;
            if (!t.TryGetProperty("url", out var url)) continue;
            if (objetivo.Length > 0 && !(url.GetString() ?? "").Contains(objetivo, StringComparison.OrdinalIgnoreCase))
                continue;
            if (t.TryGetProperty("webSocketDebuggerUrl", out var ws) && ws.GetString() is { Length: > 0 } d)
                return d;
        }
        throw new InvalidOperationException(
            $"no hay ninguna pestaña abierta cuya dirección contenga «{objetivo}».");
    }

    /// <summary>Los identificadores AIM, los mismos que entiende el terminal.</summary>
    private static string? Aim(string simbologia) => simbologia.Trim().ToLowerInvariant() switch
    {
        "ean13" => "]E0",
        "ean8" => "]E4",
        "code128" => "]C0",
        "gs1_128" => "]C1",
        "itf14" => "]I1",
        "code39" => "]A0",
        "" => null,
        var otra => throw new ArgumentException($"«{otra}» no es una simbología que el lector sepa anunciar."),
    };

    private static int Entero(string valor, int minimo, int maximo)
    {
        if (!int.TryParse(valor, out var n))
            throw new ArgumentException($"«{valor}» no es un número.");
        if (n < minimo || n > maximo)
            throw new ArgumentException($"El valor tiene que estar entre {minimo} y {maximo}.");
        return n;
    }
}
