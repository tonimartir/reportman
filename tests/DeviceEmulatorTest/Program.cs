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
            var pMagellan = emulador.Montar(new Magellan(), 0);
            var pBalanza = emulador.Montar(new Balanza(), 0);
            var pVisor = emulador.Montar(new VisorPuerto(), 0);
            var pSegunda = emulador.Montar(new VisorSegundaPantalla("segunda", "Segunda pantalla"), 0);
            var pImpresora = emulador.Montar(new ImpresoraEscPos(), 0);
            await emulador.IniciarAsync();
            var host = new HostEmulador(emulador);
            await host.IniciarAsync(0);

            var puertoLector = ((TcpEscucha)puesto.Transportes[0]).Puerto;
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

            // ==========================================================================
            //  EL MAGELLAN: lector Y balanza por el mismo cable, que es lo que justifica
            //  que el emulador sea todo-en-uno.
            // ==========================================================================
            using var tpvM = new TcpClient();
            await tpvM.ConnectAsync("127.0.0.1", ((TcpEscucha)pMagellan.Transportes[0]).Puerto);
            var fM = tpvM.GetStream();
            await EsperarClientes(api, 1, "magellan");

            await Accion(api, "magellan", "escanear",
                new() { ["codigo"] = "8412345678905", ["simbologia"] = "F" });
            recibido = await Leer(fM, 18);
            Check(Encoding.Latin1.GetString(recibido) == "S08F8412345678905\r",
                "el Magellan emite el codigo como S08 + simbologia + datos",
                "llego «" + Visible(recibido) + "»");

            // 2,450 kg -> "S11" + 02 enteros + 450 milesimas. nt2 lo lee con Substring(3,2) y (5,3).
            await Accion(api, "magellan", "pesar", new() { ["peso"] = "2,450" });
            recibido = await Leer(fM, 9);
            Check(Encoding.Latin1.GetString(recibido) == "S1102450\r",
                "y el peso como S11 + 2 enteros + 3 decimales, por el MISMO cable",
                "llego «" + Visible(recibido) + "»");

            await Accion(api, "magellan", "pedir_habilitacion", []);
            recibido = await Leer(fM, 4);
            Check(Encoding.Latin1.GetString(recibido) == "S00\r",
                "el aparato sabe pedir habilitacion (S00), que es lo que nt2 contesta con S01");

            // DESACTIVADO NO EMITE. Es lo que hace el aparato de verdad y lo que hay que poder
            // probar: si el TPV lo desactiva y el emulador siguiera escupiendo, la prueba del
            // TPV pasaria y el mostrador no.
            await fM.WriteAsync("D"u8.ToArray());
            await EsperarApunte(api, "recibe", "magellan");
            var antes = (await api.GetFromJsonAsync<List<Apunte>>("/api/diario?ultimos=200") ?? [])
                .Count(x => x.Dispositivo == "magellan" && x.Sentido == "emite");
            await Accion(api, "magellan", "escanear", new() { ["codigo"] = "111", ["simbologia"] = "F" });
            var despues = (await api.GetFromJsonAsync<List<Apunte>>("/api/diario?ultimos=200") ?? [])
                .Count(x => x.Dispositivo == "magellan" && x.Sentido == "emite");
            Check(antes == despues, "desactivado con «D», el Magellan NO emite aunque se le pulse escanear");

            await fM.WriteAsync("E"u8.ToArray());
            await EsperarApuntes(api, "recibe", "magellan", 2);
            await Accion(api, "magellan", "escanear", new() { ["codigo"] = "222", ["simbologia"] = "F" });
            recibido = await Leer(fM, 8);
            Check(Encoding.Latin1.GetString(recibido) == "S08F222\r",
                "y con «E» vuelve a emitir", "llego «" + Visible(recibido) + "»");

            // ==========================================================================
            //  LA BALANZA BAXTRAN
            // ==========================================================================
            using var tpvB = new TcpClient();
            await tpvB.ConnectAsync("127.0.0.1", ((TcpEscucha)pBalanza.Transportes[0]).Puerto);
            var fB = tpvB.GetStream();
            await EsperarClientes(api, 1, "balanza");

            await Accion(api, "balanza", "pesar", new() { ["peso"] = "2,5" });
            var trama = Encoding.Latin1.GetString(await LeerHasta(fB, (byte)'\r'));
            Check(trama.StartsWith('') && trama.EndsWith('\r'),
                "la balanza trama entre STX y el caracter de fin", "llego «" + trama + "»");
            // LO QUE nt2 LEE: parte por espacios y se queda con EL ULTIMO trozo.
            Check(trama.TrimEnd('\r').Split(' ')[^1] == "+2.500",
                "y el PESO es el ultimo campo separado por espacios, que es lo unico que nt2 mira",
                "el ultimo campo es «" + trama.TrimEnd('\r').Split(' ')[^1] + "»");

            await Ajuste(api, "balanza", "inestable", "1");
            await Accion(api, "balanza", "pesar", new() { ["peso"] = "2,5" });
            trama = Encoding.Latin1.GetString(await LeerHasta(fB, (byte)'\r'));
            Check(trama.Contains('!'),
                "con el peso inestable la trama lleva «!», que nt2 traduce a peso 0",
                "llego «" + trama + "»");
            await Ajuste(api, "balanza", "inestable", "0");

            // ---- EL OTRO MODELO: la Toledo 9550, que se pregunta con «W» y trama distinto ----
            // Aqui lo que importa no es que conteste sino QUE CONTESTA A SU PREGUNTA Y NO A LA OTRA:
            // el sintoma de tener el modelo mal puesto en el TPV es la balanza muda, y sin las dos
            // mitades no se puede demostrar.
            await Ajuste(api, "balanza", "modelo", "2");
            // La P71 pone el ETX DESPUES del caracter de fin, asi que de la trama anterior queda un
            // byte sin leer que encabezaria la siguiente. Se vacia el cable antes de cambiar de
            // aparato, que es lo que hace el terminal al reconectar.
            await Task.Delay(100);
            while (fB.DataAvailable) fB.ReadByte();

            await fB.WriteAsync(new byte[] { (byte)'$' });    // la pregunta de la P71: no va con esta
            await fB.WriteAsync(new byte[] { (byte)'W' });
            trama = Encoding.Latin1.GetString(await LeerHasta(fB, (byte)'\r'));
            Check(trama == (char)0x02 + "+2.500\r",
                "la 9550 contesta al «W» con STX + peso + CR, sin unidad",
                "llego «" + Visible(Encoding.Latin1.GetBytes(trama)) + "»");
            await Task.Delay(150);
            Check(!fB.DataAvailable,
                "y al «$» de la otra balanza no contesta: el modelo mal puesto se ve como silencio");

            // LO QUE nt2 LEE en la 9550: parte por el PRIMER CARACTER de la trama y se queda con el
            // ultimo trozo (Dispositivos.cs:621-622). Sin el STX de cabecera, «12.345» se partiria
            // por el «1» y el peso saldria «2.345»: menor, creible y equivocado.
            Check(trama.TrimEnd('\r').Split(trama[0])[^1] == "+2.500",
                "y el peso es lo que queda tras partir por el primer caracter, que es como lee nt2");
            await Ajuste(api, "balanza", "modelo", "1");

            // ==========================================================================
            //  EL VISOR DE PUERTO: casi no emite, RECIBE. Lo que se prueba es la pantalla.
            // ==========================================================================
            using var tpvV = new TcpClient();
            await tpvV.ConnectAsync("127.0.0.1", ((TcpEscucha)pVisor.Transportes[0]).Puerto);
            var fV = tpvV.GetStream();
            await EsperarClientes(api, 1, "visor");

            await fV.WriteAsync(new byte[] { 0x1B, 0x5B, 0x32, 0x4A });          // ESC [ 2 J
            await fV.WriteAsync(Encoding.Latin1.GetBytes("TOTAL 19,98"));
            await EsperarAjuste(api, "visor", "linea1", "TOTAL 19,98");
            Check(await Ajustes(api, "visor", "linea1") == "TOTAL 19,98",
                "el visor pinta en su primera linea lo que el TPV le escribe",
                "pone «" + await Ajustes(api, "visor", "linea1") + "»");

            // ESC [ 2 ; 1 H = fila 2, columna 1 (nt2 manda fila y columna como BYTES crudos).
            await fV.WriteAsync(new byte[] { 0x1B, 0x5B, 2, 0x3B, 1, 0x48 });
            await fV.WriteAsync(Encoding.Latin1.GetBytes("Gracias"));
            await EsperarAjuste(api, "visor", "linea2", "Gracias");
            Check(await Ajustes(api, "visor", "linea2") == "Gracias",
                "y obedece el posicionado ESC [ Py ; Px H",
                "pone «" + await Ajustes(api, "visor", "linea2") + "»");

            // Un comando que no entiende NO puede tirar la pantalla: un visor real lo ignora.
            await fV.WriteAsync(new byte[] { 0x1B, 0x5B, 0x39, 0x39, 0x6D });
            await fV.WriteAsync(Encoding.Latin1.GetBytes("!"));
            await Task.Delay(150);
            Check(await Ajustes(api, "visor", "linea2") is { } l2 && l2.Contains("Gracias"),
                "un comando desconocido se ignora y la pantalla sigue en pie");

            var noSeEscribe = await api.PutAsJsonAsync("/api/dispositivos/visor/ajuste",
                new { clave = "linea1", valor = "a mano" });
            Check((int)noSeEscribe.StatusCode == 400,
                "las lineas del visor no se escriben desde la ficha: las escribe el TPV");

            // ---- EL MODELO 3, EL EPSON DM-D: borra con ESC @ y FF, y POSICIONA con US $ ----
            // Es el juego de comandos que manda el VISOR_EPSON del terminal, y el unico que nt2 no
            // usa: nt2 borra y escribe seguido, fiandose de que el aparato rompa en la columna 20.
            await Ajuste(api, "visor", "modelo", "3");
            await fV.WriteAsync(new byte[] { 0x1B, 0x40, 0x0C });        // ESC @ + FF = borra
            await fV.WriteAsync(new byte[] { 0x1F, 0x24, 1, 1 });        // US $ columna 1 fila 1
            await fV.WriteAsync(Encoding.Latin1.GetBytes("Fanta naranja"));
            await fV.WriteAsync(new byte[] { 0x1F, 0x24, 1, 2 });        // US $ columna 1 fila 2
            await fV.WriteAsync(Encoding.Latin1.GetBytes("TOTAL 19,98"));
            await EsperarAjuste(api, "visor", "linea2", "TOTAL 19,98");
            Check(await Ajustes(api, "visor", "linea1") == "Fanta naranja"
               && await Ajustes(api, "visor", "linea2") == "TOTAL 19,98",
                "el Epson obedece el US $ COLUMNA FILA (al reves que el ESC [ fila ; columna H)",
                "pone «" + await Ajustes(api, "visor", "linea1") + "» / «"
                         + await Ajustes(api, "visor", "linea2") + "»");

            // Y EN EL MODELO EQUIVOCADO SE VE, que es para lo que sirve tener modelos: un visor que
            // no conoce el US se come el 0x1F como control suelto, PINTA EL «$» y sigue escribiendo
            // donde estuviera. Es el sintoma que hay que saber reconocer delante del mostrador.
            await Ajuste(api, "visor", "modelo", "1");
            await fV.WriteAsync(new byte[] { 0x1B, 0x5B, 0x32, 0x4A });  // ESC [ 2 J = borra
            await fV.WriteAsync(new byte[] { 0x1F, 0x24, 1, 1 });
            await fV.WriteAsync(Encoding.Latin1.GetBytes("Fanta"));
            await EsperarAjuste(api, "visor", "linea1", "$Fanta");
            Check(await Ajustes(api, "visor", "linea1") == "$Fanta",
                "y con el modelo mal puesto el «$» del comando acaba pintado en la pantalla",
                "pone «" + await Ajustes(api, "visor", "linea1") + "»");

            // ==========================================================================
            //  EL VISOR DE SEGUNDA PANTALLA: protocolo inventado (decision del propietario),
            //  en texto claro para que se pueda leer en el diario de bytes.
            // ==========================================================================
            using var tpvS = new TcpClient();
            await tpvS.ConnectAsync("127.0.0.1", ((TcpEscucha)pSegunda.Transportes[0]).Puerto);
            var fS = tpvS.GetStream();
            await EsperarClientes(api, 1, "segunda");

            await fS.WriteAsync("LINEA 1 Fanta naranja\nLINEA 2 2 cajas de 12\nESTADO GRACIAS\n"u8.ToArray());
            await EsperarAjuste(api, "segunda", "estado", "GRACIAS");
            Check(await Ajustes(api, "segunda", "linea1") == "Fanta naranja"
               && await Ajustes(api, "segunda", "linea2") == "2 cajas de 12",
                "la segunda pantalla escribe sus dos lineas con ordenes en texto claro");
            Check(await Ajustes(api, "segunda", "estado") == "GRACIAS",
                "y cambia de estado", "esta en «" + await Ajustes(api, "segunda", "estado") + "»");

            // UN PROTOCOLO INVENTADO QUE NO CONTESTA NO SE PUEDE DEPURAR.
            await fS.WriteAsync("BAILA UN POCO\n"u8.ToArray());
            var queja = Encoding.UTF8.GetString(await LeerHasta(fS, (byte)'\n'));
            Check(queja.StartsWith("ERROR"),
                "y una orden que no entiende se queja en voz alta, no en silencio",
                "contesto «" + queja.TrimEnd() + "»");

            // ==========================================================================
            //  LA IMPRESORA: no pinta el papel (eso es escpos-emulator), pero pone el tique
            //  EN EL MISMO DIARIO que el escaneo que lo provoco.
            // ==========================================================================
            using var tpvI = new TcpClient();
            await tpvI.ConnectAsync("127.0.0.1", ((TcpEscucha)pImpresora.Transportes[0]).Puerto);
            var fI = tpvI.GetStream();
            await EsperarClientes(api, 1, "impresora");

            // Un tique de verdad en miniatura: inicializa, declara cp850, imprime, corta y abre cajon.
            await fI.WriteAsync(new byte[] { 0x1B, 0x40 });
            await fI.WriteAsync(new byte[] { 0x1B, 0x74, 2 });
            await fI.WriteAsync(Encoding.Latin1.GetBytes("Fanta naranja  19,98\n"));
            await fI.WriteAsync(new byte[] { 0x1D, 0x56, 0x00 });
            await EsperarAjuste(api, "impresora", "tiques", "1");

            Check(await Ajustes(api, "impresora", "tiques") == "1",
                "el corte cierra el tique y lo cuenta",
                "cuenta «" + await Ajustes(api, "impresora", "tiques") + "»");
            var mandos = await Ajustes(api, "impresora", "mandos") ?? "";
            Check(mandos.Contains("inicializa") && mandos.Contains("página de códigos 2")
               && mandos.Contains("CORTA"),
                "y traduce a lenguaje humano lo que no es texto (init, cp, corte)",
                "dice «" + mandos + "»");
            // TRAS EL CORTE, EL TIQUE SIGUIENTE EMPIEZA VACIO. Se vio en la ficha: los dos bytes
            // que le quedaban al «GS V» se contaban como el principio del tique siguiente, y la
            // «V» del mando aparecia como si fuera texto impreso.
            Check(await Ajustes(api, "impresora", "bytes") == "0",
                "y tras el corte el tique siguiente empieza a cero, sin los bytes del mando",
                "quedan «" + await Ajustes(api, "impresora", "bytes") + "» bytes");
            Check(!(await Ajustes(api, "impresora", "texto") ?? "").Contains('V'),
                "y la «V» del GS V no se cuela como texto impreso",
                "el texto es «" + await Ajustes(api, "impresora", "texto") + "»");

            // Un segundo tique: el contador sube y el texto es el nuevo, no el anterior.
            await fI.WriteAsync(Encoding.Latin1.GetBytes("Segundo tique\n"));
            await EsperarAjuste(api, "impresora", "texto", "Segundo tique");
            Check(await Ajustes(api, "impresora", "texto") == "Segundo tique",
                "y lo que se imprime despues es del tique nuevo",
                "dice «" + await Ajustes(api, "impresora", "texto") + "»");

            // ==========================================================================
            //  EL CABLE SERIE: opcional de verdad. Sin puerto, el emulador sigue entero.
            // ==========================================================================
            var fantasma = new PuertoSerie("COM_QUE_NO_EXISTE_99");
            await using (fantasma)
            {
                await fantasma.IniciarAsync(CancellationToken.None);
                await Task.Delay(200);
                Check(fantasma.Clientes == 0 && fantasma.Descripcion.Length > 0,
                    "un puerto serie que no existe deja el emulador en pie y dice por que",
                    "dice «" + fantasma.Descripcion + "»");
                // Y no revienta al escribirle: el aparato sigue emitiendo por sus otros cables.
                await fantasma.EnviarAsync("hola"u8.ToArray(), CancellationToken.None);
                Check(true, "y escribirle sin puerto abierto no lanza");
            }

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

    private static Task Accion(HttpClient api, string dispositivo, string accion,
        Dictionary<string, string> parametros) =>
        api.PostAsJsonAsync($"/api/dispositivos/{dispositivo}/accion",
            new { accion, parametros });

    private static Task Ajuste(HttpClient api, string dispositivo, string clave, string valor) =>
        api.PutAsJsonAsync($"/api/dispositivos/{dispositivo}/ajuste", new { clave, valor });

    /// <summary>El valor de un ajuste tal como lo enseña la ficha (es como se mira un visor).</summary>
    private static async Task<string?> Ajustes(HttpClient api, string dispositivo, string clave)
    {
        var lista = await api.GetFromJsonAsync<List<Ficha>>("/api/dispositivos") ?? [];
        return lista.FirstOrDefault(d => d.Id == dispositivo)?
            .Ajustes?.FirstOrDefault(a => a.Id == clave)?.Valor;
    }

    private static async Task EsperarAjuste(HttpClient api, string dispositivo, string clave, string valor)
    {
        for (var i = 0; i < 100; i++)
        {
            if (await Ajustes(api, dispositivo, clave) == valor) return;
            await Task.Delay(20);
        }
        // No se lanza: que falle la comprobación de al lado, que dice QUE se esperaba y qué hay.
    }

    /// <summary>Lee hasta el byte de fin incluido. Las tramas de la balanza y las respuestas del
    /// protocolo de la segunda pantalla son de longitud variable: contar bytes no vale.</summary>
    private static async Task<byte[]> LeerHasta(NetworkStream flujo, byte fin)
    {
        var salida = new List<byte>();
        var uno = new byte[1];
        using var reloj = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        while (salida.Count < 4096)
        {
            var leidos = await flujo.ReadAsync(uno.AsMemory(), reloj.Token);
            if (leidos == 0) break;
            salida.Add(uno[0]);
            if (uno[0] == fin) break;
        }
        return [.. salida];
    }

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
    private static async Task EsperarClientes(HttpClient api, int cuantos, string dispositivo = "lector")
    {
        for (var i = 0; i < 100; i++)
        {
            var lista = await api.GetFromJsonAsync<List<Ficha>>("/api/dispositivos") ?? [];
            if (lista.FirstOrDefault(d => d.Id == dispositivo)?.Clientes >= cuantos) return;
            await Task.Delay(20);
        }
        throw new TimeoutException($"El emulador no llego a ver {cuantos} cliente(s) en «{dispositivo}».");
    }

    private static Task EsperarApunte(HttpClient api, string sentido, string dispositivo = "lector") =>
        EsperarApuntes(api, sentido, dispositivo, 1);

    private static async Task EsperarApuntes(HttpClient api, string sentido, string dispositivo, int cuantos)
    {
        for (var i = 0; i < 100; i++)
        {
            var diario = await api.GetFromJsonAsync<List<Apunte>>("/api/diario?ultimos=200") ?? [];
            if (diario.Count(x => x.Sentido == sentido && x.Dispositivo == dispositivo) >= cuantos) return;
            await Task.Delay(20);
        }
        throw new TimeoutException($"No llegaron {cuantos} apunte(s) «{sentido}» de «{dispositivo}».");
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

    private sealed record Ficha(string Id, string Nombre, string Tipo, string Transporte, int Clientes,
                                List<AjusteFicha>? Ajustes);
    private sealed record AjusteFicha(string Id, string Etiqueta, string Tipo, string Valor,
                                      string? Ayuda, bool SoloLectura);
}
