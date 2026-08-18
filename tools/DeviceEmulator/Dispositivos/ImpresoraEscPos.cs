using System.Text;

namespace Reportman.DeviceEmulator;

/// <summary>
/// LA IMPRESORA TÉRMICA, en la rejilla, PERO SIN PINTAR EL TIQUE.
///
/// Ya existe un programa que hace eso bien: `escpos-emulator`, que interpreta ESC/POS con el motor
/// delante y saca el PDF, el PNG y el `.rpmf`. La tentación era absorberlo aquí para tener «todo en
/// uno» de verdad, y se ha decidido NO hacerlo: arrastraría Skia, ICU y FreeType a una herramienta
/// cuya gracia es arrancar con un `dotnet run` en cualquier máquina y dentro del CI. Un emulador de
/// dispositivos que tarda en levantarse y que falla por una fuente nativa deja de usarse.
///
/// Lo que SÍ aporta estar aquí, y no es poco: **el tique aparece en el mismo diario que el escaneo
/// que lo provocó**. Depurar «he escaneado una caja y ha salido mal en el papel» con dos ventanas y
/// dos relojes es otra cosa distinta a leerlo en una sola lista por orden de llegada.
///
/// Así que este aparato RECIBE y CUENTA: acumula el trabajo, y traduce a lenguaje humano lo que no
/// es texto, que es exactamente lo que se pierde de vista en un volcado hexadecimal — el corte, el
/// cajón, la página de códigos, el ancho doble. Para ver el papel, `escpos-emulator` en el 9100.
/// </summary>
public sealed class ImpresoraEscPos(string id = "impresora", string nombre = "Impresora de tiques")
    : IDispositivo
{
    private readonly List<byte> trabajo = [];
    private readonly List<string> sucesos = [];
    private readonly Lock cerrojo = new();
    private int tiques;

    public string Id => id;
    public string Nombre => nombre;
    public string Tipo => "impresora";

    /// <summary>Una impresora no emite nada que el TPV escuche (el estado por DLE se deja fuera a
    /// propósito: nuestro camino de impresión no lo consulta).</summary>
    public IReadOnlyList<AccionDef> Acciones => [new("vaciar", "Olvidar el tique en curso")];

    public IReadOnlyList<AjusteDef> Ajustes
    {
        get
        {
            lock (cerrojo)
            {
                return
                [
                    new("tiques", "Tiques impresos", "numero", tiques.ToString(),
                        "Cuántos trabajos ha cerrado un corte desde que arrancó el emulador.",
                        SoloLectura: true),
                    new("bytes", "Bytes del tique en curso", "numero", trabajo.Count.ToString(),
                        "Lo que lleva recibido sin cortar todavía.", SoloLectura: true),
                    new("mandos", "Lo que no es texto", "texto",
                        sucesos.Count == 0 ? "" : string.Join(" · ", sucesos.TakeLast(6)),
                        "Traducido: el corte, el cajón, la página de códigos. Es lo que se pierde " +
                        "de vista en un volcado hexadecimal.", SoloLectura: true),
                    new("texto", "Últimas líneas", "texto", UltimasLineas(3),
                        "Lo imprimible del tique en curso, para reconocerlo de un vistazo.",
                        SoloLectura: true),
                ];
            }
        }
    }

    public void Ajustar(string clave, string valor) =>
        throw new ArgumentException($"«{clave}» lo escribe la impresora, no la ficha.");

    public byte[]? Ejecutar(string accion, IReadOnlyDictionary<string, string> parametros)
    {
        if (accion != "vaciar") throw new ArgumentException($"La impresora no sabe hacer «{accion}».");
        lock (cerrojo) { trabajo.Clear(); sucesos.Clear(); }
        return null;
    }

    /// <summary>
    /// Interpreta lo justo: los mandos que cambian lo que sale por el papel y que no se ven en el
    /// hexadecimal. NO es un intérprete de ESC/POS —ése es `escpos-emulator`— y por eso lo que no
    /// reconoce se deja pasar como texto en vez de intentar adivinarlo.
    /// </summary>
    public byte[]? Recibir(ReadOnlySpan<byte> bytes)
    {
        lock (cerrojo)
        {
            for (var i = 0; i < bytes.Length; i++)
            {
                trabajo.Add(bytes[i]);
                if (bytes[i] != 0x1B && bytes[i] != 0x1D) continue;

                var mando = bytes[i] == 0x1B ? "ESC" : "GS";
                var siguiente = i + 1 < bytes.Length ? bytes[i + 1] : (byte)0;
                var tercero = i + 2 < bytes.Length ? bytes[i + 2] : (byte)0;
                // Cuántos bytes MÁS come el mando, contando lo ya añadido. Se saltan de verdad
                // (avanzando `i` y quitándolos del trabajo) porque si no, la `V` de `GS V` acaba
                // pareciendo texto impreso y los dos bytes del corte se cuentan como el principio
                // del tique siguiente — que es justo lo que se vio en la ficha.
                var comidos = 0;

                switch (mando, siguiente)
                {
                    case ("ESC", 0x40): Anotar("inicializa (ESC @)"); comidos = 1; break;
                    case ("ESC", 0x70): Anotar("abre el cajón (ESC p)"); comidos = 3; break;
                    case ("ESC", 0x74): Anotar($"página de códigos {tercero} (ESC t)"); comidos = 2; break;
                    case ("ESC", 0x61): Anotar($"alineación {tercero} (ESC a)"); comidos = 2; break;
                    case ("GS", 0x56):
                        Anotar("CORTA el papel (GS V)");
                        tiques++;
                        // El corte cierra el tique: lo que venga después es otro. Sin esto, una
                        // tarde de pruebas sería un solo trabajo de cien metros.
                        trabajo.Clear();
                        comidos = 2;
                        break;
                    case ("GS", 0x28) when tercero == 0x6B: Anotar("imprime un código (GS ( k)"); comidos = 2; break;
                    case ("GS", 0x21): Anotar($"tamaño de letra 0x{tercero:X2} (GS !)"); comidos = 2; break;
                }

                for (var n = 0; n < comidos && i + 1 < bytes.Length; n++)
                {
                    i++;
                    // Sólo se apunta lo que sigue vivo: tras un corte el trabajo está vacío y los
                    // bytes que quedan del mando no pertenecen a nada.
                    if (trabajo.Count > 0) trabajo.Add(bytes[i]);
                }
                // Y los bytes del mando que ya estaban dentro se retiran del texto del tique.
                if (comidos > 0 && trabajo.Count >= comidos + 1)
                    trabajo.RemoveRange(trabajo.Count - comidos - 1, comidos + 1);
            }
        }
        return null;
    }

    private void Anotar(string suceso)
    {
        sucesos.Add(suceso);
        while (sucesos.Count > 40) sucesos.RemoveAt(0);
    }

    /// <summary>Lo imprimible de lo recibido, sin los mandos: para reconocer el tique de un vistazo.</summary>
    private string UltimasLineas(int cuantas)
    {
        var texto = new StringBuilder();
        foreach (var b in trabajo)
            if (b is >= 0x20 and < 0x7F) texto.Append((char)b);
            else if (b == 0x0A) texto.Append('\n');
        var lineas = texto.ToString().Split('\n', StringSplitOptions.RemoveEmptyEntries);
        return string.Join(" ⏎ ", lineas.TakeLast(cuantas).Select(l => l.Trim()));
    }
}
