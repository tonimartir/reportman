using System.Globalization;
using System.Text;

namespace Reportman.DeviceEmulator;

/// <summary>
/// EL MAGELLAN (Datalogic 9800i / 9550): UN SOLO APARATO QUE LEE Y PESA POR EL MISMO CABLE, y por
/// eso es un solo fichero y no dos. En nt2 tiene tipo propio —`LectorBalanza`, el 1 de la tabla
/// (BaseDatos.cs:626)— y las dos clases de trama llegan MEZCLADAS por el mismo puerto, distinguidas
/// por sus tres primeras letras (Dispositivos.cs:563-579): `S08` + simbología + código para lo
/// leído, `S11` + peso para lo pesado. Partirlo en dos emuladores sería emular otro aparato.
///
/// Y HABLA, que es lo que lo separa del lector a secas: pregunta con `S00` y el TPV le contesta
/// `S01` + CR para habilitarlo (Dispositivos.cs:584-602). Aquí están las dos caras —la acción que
/// pregunta y el reconocimiento de la respuesta—, porque esa conversación se rompe sola en el
/// mostrador y sin poder provocarla no hay forma de mirarla.
///
/// SE LE PUEDE DEJAR MUDO A PROPÓSITO, que es la otra mitad de lo que hay que poder probar: con
/// `S02` (Dispositivos.cs:1424-1429), con la `D` que nt2 usa en el 7820 (Dispositivos.cs:144-159) o
/// con el interruptor de la ficha. Mudo no emite NADA aunque se pulse escanear.
/// </summary>
public sealed class Magellan(string id = "magellan", string nombre = "Magellan 9800i") : IDispositivo
{
    private int letraFin = 13;
    private int modelo = 9800;
    private bool activo = true;

    /// <summary>Arranca habilitado porque el aparato del mostrador lo está: el `S00` es lo
    /// excepcional, no lo normal, y empezar mudo convertiría cada prueba en un ritual.</summary>
    private bool habilitado = true;

    /// <summary>Lo que el TPV lleva escrito y aún no ha cerrado con el carácter de fin. Es un campo
    /// y no una variable local porque una orden puede llegar partida en dos paquetes.</summary>
    private readonly StringBuilder recibido = new();

    public string Id => id;
    public string Nombre => nombre;
    public string Tipo => "lector-balanza";

    public IReadOnlyList<AccionDef> Acciones =>
    [
        new("escanear", "Escanear",
        [
            new CampoDef("codigo", "Código", "texto", "",
                "Lo que lleva la etiqueta. Viaja detrás de `S08` y del carácter de simbología."),
            new CampoDef("simbologia", "Simbología", "texto", "F",
                "UN carácter, el que el aparato antepone a los datos: `F` es EAN-13. nt2 se lo " +
                "salta entero (Substring(4)), así que para él cualquier letra vale igual."),
        ]),
        new("pesar", "Pesar",
        [
            new CampoDef("peso", "Peso (kg)", "texto", "2,450",
                "Con coma o con punto, hasta 99,999 kg. Va como texto y no como número porque en " +
                "la ficha se teclea «2,450» y un campo numérico del navegador puede devolverlo vacío."),
        ]),
        new("pedir_habilitacion", "Pedir habilitación (S00)"),
    ];

    public IReadOnlyList<AjusteDef> Ajustes =>
    [
        new("letra_fin", "Carácter de fin", "numero", letraFin.ToString(),
            "Código decimal del carácter que cierra TODAS las tramas. 13 = CR, que es con lo que " +
            "nace el dispositivo en nt2 (Dispositivos.cs:81) y lo que espera para darlas por buenas."),
        new("modelo", "Modelo", "numero", modelo.ToString(),
            "Informativo: el 9800i y el 9550 mandan estas mismas tramas. nt2 sólo cambia de " +
            "protocolo cuando el aparato es OTRO — el 7820 (Dispositivos.cs:1400) o un 9550 " +
            "configurado como balanza suelta (Dispositivos.cs:611-622)."),
        new("activo", "Activo", "interruptor", activo ? "1" : "0",
            "Lo mismo que la «E»/«D» del TPV. Desactivado no sale nada por el cable: ni códigos " +
            "ni pesos."),
    ];

    public void Ajustar(string clave, string valor)
    {
        switch (clave)
        {
            case "letra_fin": letraFin = Entero(valor, letraFin); break;
            case "modelo": modelo = int.TryParse(valor, out var m) ? m : modelo; break;
            case "activo": activo = Interruptor(valor); break;
            default: throw new ArgumentException($"El Magellan no tiene el ajuste «{clave}».");
        }
    }

    public byte[]? Ejecutar(string accion, IReadOnlyDictionary<string, string> parametros) =>
        Normalizar(accion) switch
        {
            "escanear" => Emitir("S08" + Simbologia(parametros) + Codigo(parametros)),
            "pesar" => Emitir("S11" + Milesimas(parametros)),
            // Emitir `S00` no habilita a nadie: quien habilita es el TPV con su `S01`
            // (Dispositivos.cs:584-602). Y sale aunque el aparato esté deshabilitado, porque pedirlo
            // es lo único que puede hacer estándolo — si esto callara, no habría vuelta atrás.
            "pedir_habilitacion" => Emitir("S00", peticion: true),
            _ => throw new ArgumentException($"El Magellan no sabe hacer «{accion}»."),
        };

    public byte[]? Recibir(ReadOnlySpan<byte> bytes)
    {
        foreach (var b in bytes)
        {
            // La «E» y la «D» llegan SUELTAS, un byte y nada más (Dispositivos.cs:144-159): no
            // pueden esperar al carácter de fin como el resto de las órdenes.
            if (b is (byte)'E' or (byte)'D') { activo = b == (byte)'E'; continue; }

            if (b == letraFin) { Interpretar(); recibido.Clear(); continue; }
            recibido.Append((char)b);
        }

        // nt2 cierra sus órdenes con el CR, pero el CR puede venir en el paquete siguiente: si lo
        // acumulado ya es una orden entera se atiende sin esperarlo, y el CR que llegue después se
        // encuentra el buffer vacío y no hace nada.
        if (Interpretar()) recibido.Clear();

        // El aparato no contesta a ninguna de estas: en esta conversación el que contesta es el TPV.
        return null;
    }

    /// <summary>Atiende lo acumulado si ya es una orden entera. Devuelve si la ha reconocido.</summary>
    private bool Interpretar()
    {
        switch (recibido.ToString())
        {
            case "S01": habilitado = true; return true;
            case "S02": habilitado = false; return true;
            // Pitido. Suena y no cambia nada, pero nt2 lo manda pegado al S02 al desactivar
            // (Dispositivos.cs:1411-1429) y reconocerlo evita leer un «S05» suelto como avería.
            case "S05": return true;
            // El TPV pide el peso con `S11` + CR (Dispositivos.cs:1013-1025). NO se contesta a
            // propósito: el peso lo pone quien prueba, con la acción «pesar», y así se puede probar
            // también el caso que de verdad atasca el mostrador — que la balanza no conteste nunca.
            case "S11": return true;
            default: return false;
        }
    }

    /// <summary>
    /// Cierra la trama con el carácter de fin y la calla si el aparato está mudo. Un Magellan
    /// deshabilitado no transmite aunque le pases el género por delante, y poder reproducir eso
    /// —«escanea y no pasa nada»— es media avería del mostrador explicada.
    /// </summary>
    private byte[]? Emitir(string trama, bool peticion = false)
    {
        if (!activo || (!habilitado && !peticion)) return null;

        // Latin1 y no UTF-8: un aparato manda BYTES, y los códigos internos con acento de algunas
        // casas viajan en uno y no en dos.
        byte[] bytes = [.. Encoding.Latin1.GetBytes(trama), (byte)letraFin];
        return bytes;
    }

    private static string Codigo(IReadOnlyDictionary<string, string> parametros)
    {
        var codigo = parametros.GetValueOrDefault("codigo", "");
        if (string.IsNullOrEmpty(codigo))
            throw new ArgumentException("Un escaneo sin código no es un escaneo.");

        // nt2 sólo despieza la trama si mide MÁS de 5 caracteres (Dispositivos.cs:564), así que un
        // código de un solo carácter le llega crudo, «S08F1», y se lee como si fuera la etiqueta.
        // Se emite igual: la trampa está en nt2 y taparla aquí sería esconder lo que hay que ver.
        return codigo;
    }

    private static string Simbologia(IReadOnlyDictionary<string, string> parametros)
    {
        var simbologia = parametros.GetValueOrDefault("simbologia", "");
        if (simbologia.Length == 0) return "F";

        // Tiene que ser UNO. nt2 corta por el carácter 4 a ciegas (Dispositivos.cs:569): con dos, el
        // primer dígito del código se pierde dentro de la simbología y el artículo leído es otro.
        if (simbologia.Length != 1)
            throw new ArgumentException(
                $"La simbología del Magellan es UN carácter («F» para EAN-13), no «{simbologia}».");
        return simbologia;
    }

    /// <summary>
    /// El peso de la trama: 2 dígitos de kilos y 3 de gramos, con ceros a la izquierda. Que son un
    /// solo número de milésimas de cinco cifras —2,45 kg → `02450`—, porque nt2 los vuelve a juntar
    /// dividiendo la parte decimal entre 1000 (Dispositivos.cs:576-578).
    /// </summary>
    private static string Milesimas(IReadOnlyDictionary<string, string> parametros)
    {
        var texto = parametros.GetValueOrDefault("peso", "").Trim();
        // Con coma o con punto: en la ficha se teclea como en el país, no como en el invariante.
        if (!decimal.TryParse(texto.Replace(',', '.'), NumberStyles.Number,
                              CultureInfo.InvariantCulture, out var kg))
            throw new ArgumentException($"«{texto}» no es un peso.");

        if (kg < 0)
            throw new ArgumentException($"Una balanza no pesa en negativo: {texto} kg.");
        if (kg > 99.999m)
            throw new ArgumentException(
                $"En la trama del Magellan el peso son 2+3 dígitos: {texto} kg no cabe en 99,999 kg.");

        // La balanza aprecia el gramo; lo que sobre se redondea, como haría el aparato.
        var milesimas = (int)decimal.Round(kg * 1000, MidpointRounding.AwayFromZero);
        return milesimas.ToString("D5", CultureInfo.InvariantCulture);
    }

    /// <summary>Una acción de dos palabras llega con espacio, con guion o con guion bajo según quién
    /// la escriba —la ficha, una prueba, un curl a mano—; ninguna de las tres merece un 400.</summary>
    private static string Normalizar(string accion) =>
        accion.Trim().ToLowerInvariant().Replace(' ', '_').Replace('-', '_');

    private static int Entero(string valor, int porDefecto) =>
        int.TryParse(valor, out var n) && n is >= 0 and <= 255 ? n : porDefecto;

    private static bool Interruptor(string valor) => valor is "1" or "true" or "on";
}
