using System.Net.Http.Json;
using System.Net.Sockets;
using System.Text;
using Reportman.DeviceEmulator;

namespace DeviceEmulatorTest;

// LA PRUEBA DEL ARMAZON del emulador de dispositivos (fase 1).
//
// Se prueba con un TPV de mentira: un TcpClient que se conecta al puerto del lector y espera los
// bytes, que es exactamente lo que hara el terminal. Y la orden de escanear entra POR LA API, la
// misma que usa la rejilla — asi lo que se prueba es el camino entero, no un metodo suelto.
//
// Lo que se afirma:
//  1. Un escaneo llega al cliente TCP TRAMADO: prefijo + datos + sufijo.
//  2. Los ajustes son EN VIVO: cambiar el sufijo cambia la siguiente trama, sin reiniciar nada.
//  3. El identificador AIM se antepone cuando se pide (]E0 para EAN-13). Es lo que nt2 tira.
//  4. `{GS}` se convierte en el byte 0x1D, que no es una tecla y es el que decide si una etiqueta
//     GS1 se lee entera o mutilada.
//  5. Emite a TODOS los conectados: dos ventanas mirando no se roban las tramas.
//  6. El diario anota lo emitido, con su hexadecimal.
//  7. Un cliente que se cae no se lleva al emulador: el siguiente escaneo sigue saliendo.
//  8. La API rechaza lo que no es una accion, y lo hace con un 400 y un motivo legible.
//  9. Lo que el TPV escribe al lector se ANOTA aunque el lector no conteste.
internal static class Program
{
    private static int fallos;

    private static void Check(bool condicion, string nombre, string detalle = "")
    {
        if (condicion) Console.WriteLine("[PASS] " + nombre);
        else
        {
            fallos++;
            Console.WriteLine("[FAIL] " + nombre + (detalle.Length > 0 ? " — " + detalle : ""));
        }
    }

    private static async Task<int> Main()
    {
        try
        {
            await using var emulador = new Emulador();
            var puesto = emulador.Montar(new LectorSimple(), 0);   // 0 = puerto libre: dos pruebas a la vez no chocan
            await emulador.IniciarAsync();
            var host = new HostEmulador(emulador);
            await host.IniciarAsync(0);

            var puertoLector = ((TcpEscucha)puesto.Transporte).Puerto;
            using var api = new HttpClient { BaseAddress = new Uri(host.Url) };

            // ---- 1. el escaneo llega tramado ----
            using var tpv = new TcpClient();
            await tpv.ConnectAsync("127.0.0.1", puertoLector);
            var flujo = tpv.GetStream();
            await EsperarClientes(api, 1);

            await Escanear(api, "8412345678905");
            var recibido = await Leer(flujo, 14);
            Check(Encoding.Latin1.GetString(recibido) == "8412345678905\r",
                "un escaneo llega al TPV tramado (datos + CR)",
                "llego «" + Visible(recibido) + "»");

            // ---- 2. los ajustes son en vivo ----
            await Ajustar(api, "prefijo", "126");   // '~', el de clientent en modo teclado
            await Ajustar(api, "sufijo", "3");      // ETX
            await Escanear(api, "1234");
            recibido = await Leer(flujo, 6);
            Check(recibido.Length == 6 && recibido[0] == 126 && recibido[5] == 3,
                "cambiar prefijo y sufijo cambia la SIGUIENTE trama, sin reiniciar",
                "llego «" + Visible(recibido) + "»");

            // ---- 3. el identificador AIM ----
            await Ajustar(api, "prefijo", "0");
            await Ajustar(api, "sufijo", "13");
            await Ajustar(api, "aim", "1");
            await Escanear(api, "8412345678905", "ean13");
            recibido = await Leer(flujo, 17);
            Check(Encoding.Latin1.GetString(recibido) == "]E08412345678905\r",
                "con AIM puesto, el lector dice QUE simbologia leyo (]E0 = EAN-13)",
                "llego «" + Visible(recibido) + "»");

            await Ajustar(api, "aim", "0");

            // ---- 4. el separador de GS1, que no es una tecla ----
            // «01» + GTIN(14) = 16, el separador, «10LOTE» = 6, y el CR: 24 bytes con el 0x1D en 16.
            await Escanear(api, "0109506000134352{GS}10LOTE", "gs1_128");
            recibido = await Leer(flujo, 24);
            Check(recibido.Length == 24 && Array.IndexOf(recibido, (byte)0x1D) == 16,
                "{GS} se convierte en el byte 0x1D en su sitio",
                "hex " + Convert.ToHexString(recibido));

            // ---- 5. emite a TODOS los conectados ----
            using var segundo = new TcpClient();
            await segundo.ConnectAsync("127.0.0.1", puertoLector);
            var flujo2 = segundo.GetStream();
            await EsperarClientes(api, 2);

            await Escanear(api, "999");
            var a = await Leer(flujo, 4);
            var b = await Leer(flujo2, 4);
            Check(Encoding.Latin1.GetString(a) == "999\r" && Encoding.Latin1.GetString(b) == "999\r",
                "los dos conectados reciben la misma trama (nadie roba tramas)",
                "uno «" + Visible(a) + "», otro «" + Visible(b) + "»");

            // ---- 6. el diario anota lo emitido ----
            var diario = await api.GetFromJsonAsync<List<Apunte>>("/api/diario?ultimos=50") ?? [];
            var emitidos = diario.Where(x => x.Sentido == "emite").ToList();
            Check(emitidos.Count == 5, "el diario anota los cinco escaneos hasta aqui", "anoto " + emitidos.Count);
            Check(emitidos[^1].Hex == "3939390D",
                "y guarda el hexadecimal crudo, que es lo que se depura",
                "guardo " + emitidos[^1].Hex);

            // ---- 7. un cliente que se cae no se lleva al emulador ----
            segundo.Close();
            await Escanear(api, "888");
            var tras = await Leer(flujo, 4);
            Check(Encoding.Latin1.GetString(tras) == "888\r",
                "si un cliente se cae, el que queda sigue recibiendo",
                "llego «" + Visible(tras) + "»");

            // ---- 8. la API rechaza lo que no es una accion, con motivo ----
            var mala = await api.PostAsJsonAsync("/api/dispositivos/lector/accion",
                new { accion = "escanear", parametros = new Dictionary<string, string> { ["codigo"] = "" } });
            Check((int)mala.StatusCode == 400,
                "un escaneo sin codigo es un 400 y no un 500", "devolvio " + (int)mala.StatusCode);
            Check((await mala.Content.ReadAsStringAsync()).Contains("no es un escaneo"),
                "y el motivo se puede leer en la ficha");

            var inventada = await api.PostAsJsonAsync("/api/dispositivos/lector/accion",
                new { accion = "bailar", parametros = new Dictionary<string, string>() });
            Check((int)inventada.StatusCode == 400, "una accion que no existe tambien es un 400");

            // ---- 9. el diario EN VIVO habla igual que el diario en reposo ----
            // No es un capricho: los endpoints REST los serializa ASP.NET en minuscula inicial y
            // el SSE lo serializaba a mano en mayuscula, asi que la pantalla leia `numero` de un
            // objeto que traia `Numero` y pintaba filas enteras de «undefined». El diario llegaba
            // bien y no se veia, que es la peor clase de averia. Se mira EL TEXTO del evento.
            using (var vivo = new HttpClient { BaseAddress = new Uri(host.Url) })
            {
                // `ResponseHeadersRead` es obligatorio con SSE: por defecto HttpClient espera a que
                // la respuesta TERMINE, y esta no termina nunca — se queda colgado hasta el timeout.
                using var respuesta = await vivo.SendAsync(
                    new HttpRequestMessage(HttpMethod.Get, "/api/diario/vivo"),
                    HttpCompletionOption.ResponseHeadersRead);
                using var flujoSse = await respuesta.Content.ReadAsStreamAsync();
                using var lector = new StreamReader(flujoSse);
                // La primera linea es el comentario de apertura: llega SIN que haya pasado nada, y
                // que llegue es media prueba — es lo que dice que el flujo esta abierto.
                var apertura = await lector.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(5));
                Check(apertura is not null && apertura.StartsWith(':'),
                    "el diario en vivo se declara abierto antes de tener nada que contar",
                    "llego «" + apertura + "»");

                var leyendo = LeerDato(lector);
                await Escanear(api, "555");
                var linea = await leyendo.WaitAsync(TimeSpan.FromSeconds(5)) ?? "";
                Check(linea.Contains("\"numero\"") && linea.Contains("\"hex\":\"3535350D\""),
                    "el diario en vivo manda los mismos nombres que el REST",
                    "llego «" + linea + "»");
            }

            // ---- 10. lo que el TPV escribe se anota aunque el lector no conteste ----
            await flujo.WriteAsync("E"u8.ToArray());
            await flujo.FlushAsync();
            await EsperarApunte(api, "recibe");
            diario = await api.GetFromJsonAsync<List<Apunte>>("/api/diario?ultimos=50") ?? [];
            Check(diario.Any(x => x.Sentido == "recibe" && x.Hex == "45"),
                "lo que el TPV manda al aparato se anota aunque no haya respuesta");

            await host.PararAsync();
        }
        catch (Exception e)
        {
            Console.WriteLine("[ERROR] " + e);
            return 2;
        }

        Console.WriteLine(fallos == 0 ? "\nTodo correcto." : $"\n{fallos} fallo(s).");
        return fallos == 0 ? 0 : 1;
    }

    // ---- utilidades ----

    private static Task Escanear(HttpClient api, string codigo, string simbologia = "ean13") =>
        api.PostAsJsonAsync("/api/dispositivos/lector/accion", new
        {
            accion = "escanear",
            parametros = new Dictionary<string, string> { ["codigo"] = codigo, ["simbologia"] = simbologia },
        });

    private static Task Ajustar(HttpClient api, string clave, string valor) =>
        api.PutAsJsonAsync("/api/dispositivos/lector/ajuste", new { clave, valor });

    /// <summary>Lee EXACTAMENTE n bytes o se rinde: sin esto, una trama partida en dos paquetes
    /// haria fallar la prueba por un motivo que no es el que se esta probando.</summary>
    private static async Task<byte[]> Leer(NetworkStream flujo, int cuantos)
    {
        var buffer = new byte[cuantos];
        var total = 0;
        using var reloj = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        while (total < cuantos)
        {
            var leidos = await flujo.ReadAsync(buffer.AsMemory(total), reloj.Token);
            if (leidos == 0) break;
            total += leidos;
        }
        return buffer[..total];
    }

    /// <summary>La conexion TCP se acepta en otro hilo: hay que esperar a que el emulador la cuente
    /// o el primer escaneo saldria antes de que hubiera nadie escuchando.</summary>
    private static async Task EsperarClientes(HttpClient api, int cuantos)
    {
        for (var i = 0; i < 100; i++)
        {
            var lista = await api.GetFromJsonAsync<List<Ficha>>("/api/dispositivos") ?? [];
            if (lista.Count > 0 && lista[0].Clientes >= cuantos) return;
            await Task.Delay(20);
        }
        throw new TimeoutException($"El emulador no llego a ver {cuantos} cliente(s).");
    }

    private static async Task EsperarApunte(HttpClient api, string sentido)
    {
        for (var i = 0; i < 100; i++)
        {
            var diario = await api.GetFromJsonAsync<List<Apunte>>("/api/diario?ultimos=50") ?? [];
            if (diario.Any(x => x.Sentido == sentido)) return;
            await Task.Delay(20);
        }
        throw new TimeoutException($"No llego ningun apunte «{sentido}».");
    }

    /// <summary>La siguiente linea `data:` del flujo, saltando lineas en blanco y comentarios.</summary>
    private static async Task<string?> LeerDato(StreamReader lector)
    {
        while (await lector.ReadLineAsync() is { } linea)
            if (linea.StartsWith("data:")) return linea;
        return null;
    }

    private static string Visible(byte[] bytes)
    {
        var sb = new StringBuilder();
        foreach (var b in bytes) sb.Append(b is >= 0x20 and < 0x7F ? (char)b : '·');
        return sb.ToString();
    }

    private sealed record Ficha(string Id, string Nombre, string Tipo, string Transporte, int Clientes);
}
