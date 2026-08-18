using System.Text;

namespace Reportman.DeviceEmulator;

/// <summary>
/// EL LECTOR DE CÓDIGOS A SECAS: emite lo leído entre un prefijo y un sufijo, y nada más.
///
/// Es el más simple de los cuatro y por eso es el primero: si el armazón lo sostiene bien —ficha,
/// transporte, diario, ajustes en vivo—, los otros tres son ficheros nuevos y no una reforma.
///
/// SIRVE PARA LOS DOS CAMINOS que decidió el propietario, porque son el mismo protocolo:
///   * el lector de RED (o el serie por conversor), donde el sufijo suele ser CR;
///   * el lector en modo TECLADO, donde lo que hace posible distinguir una lectura de alguien
///     tecleando son unos caracteres de inicio y fin «raros» CONFIGURADOS EN EL PROPIO LECTOR
///     (nt2 los llama `letra_inicio`/`letra_fin`; `clientent` usa `~` y CR). Aquí son los mismos
///     dos ajustes: cambiarlos es configurar el lector.
///
/// Y EMITE EL IDENTIFICADOR AIM si se le pide, que es lo que nt2 tira. Merece la pena tenerlo:
/// `]C1` (GS1-128, con FNC1) y `]C0` (Code 128 plano) son la diferencia entre «esta cadena lleva
/// AIs dentro» y «esta cadena es un código», y sin el identificador hay que adivinarlo por la
/// longitud — que es justo el hueco por el que se cuelan las etiquetas de 12 y de 15 dígitos.
/// </summary>
public sealed class LectorSimple(string id = "lector", string nombre = "Lector de códigos") : IDispositivo
{
    /// <summary>El separador de GS1 (FNC1 transmitido), escrito como NÚMERO: un byte de control
    /// literal en el código fuente es invisible y sobrevive mal a editores y diffs.</summary>
    private static readonly string Gs = ((char)0x1D).ToString();

    /// <summary>Los identificadores AIM que un lector antepone cuando se le configura para ello.</summary>
    private static readonly Dictionary<string, string> Aim = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ean13"] = "]E0", ["ean8"] = "]E4", ["upc_a"] = "]E0", ["upc_e"] = "]E0",
        ["dun14"] = "]I1", ["itf14"] = "]I1",
        ["code128"] = "]C0", ["gs1_128"] = "]C1",
        ["qr"] = "]Q1", ["gs1_qr"] = "]Q3",
        ["datamatrix"] = "]d1", ["gs1_datamatrix"] = "]d2",
        ["databar"] = "]e0", ["interno"] = "]C0",
    };

    private int prefijo;          // 0 = ninguno. `clientent` usa 126 ('~') en modo teclado.
    private int sufijo = 13;      // CR, que es lo normal en serie y en teclado
    private bool emitirAim;

    public string Id => id;
    public string Nombre => nombre;
    public string Tipo => "lector";

    public IReadOnlyList<AccionDef> Acciones =>
    [
        new("escanear", "Escanear",
        [
            new CampoDef("codigo", "Código", "texto", "",
                "Lo que lleva la etiqueta. `{GS}` mete el separador 0x1D de GS1 — que no es una " +
                "tecla y por eso un lector en modo teclado no puede transmitirlo."),
            new CampoDef("simbologia", "Simbología", "texto", "ean13",
                "ean13 · ean8 · upc_a · dun14 · code128 · gs1_128 · qr · gs1_qr · datamatrix · " +
                "gs1_datamatrix · databar · interno"),
        ]),
    ];

    public IReadOnlyList<AjusteDef> Ajustes =>
    [
        new("prefijo", "Carácter de inicio", "numero", prefijo.ToString(),
            "Código decimal, 0 = ninguno. En modo teclado es el carácter «raro» que marca dónde " +
            "empieza una lectura: `clientent` usa 126 (~)."),
        new("sufijo", "Carácter de fin", "numero", sufijo.ToString(),
            "Código decimal, 0 = ninguno. 13 = CR, que es lo habitual."),
        new("aim", "Anteponer identificador AIM", "interruptor", emitirAim ? "1" : "0",
            "El lector dice QUÉ simbología ha leído: ]E0 EAN-13, ]C1 GS1-128 (con FNC1), ]C0 " +
            "Code 128 plano. Sin esto hay que adivinarlo por la longitud."),
    ];

    public void Ajustar(string clave, string valor)
    {
        switch (clave)
        {
            case "prefijo": prefijo = Entero(valor, prefijo); break;
            case "sufijo": sufijo = Entero(valor, sufijo); break;
            case "aim": emitirAim = valor is "1" or "true" or "on"; break;
            default: throw new ArgumentException($"El lector no tiene el ajuste «{clave}».");
        }
    }

    public byte[]? Ejecutar(string accion, IReadOnlyDictionary<string, string> parametros)
    {
        if (accion != "escanear")
            throw new ArgumentException($"El lector no sabe hacer «{accion}».");

        var codigo = parametros.GetValueOrDefault("codigo", "");
        if (string.IsNullOrEmpty(codigo))
            throw new ArgumentException("Un escaneo sin código no es un escaneo.");
        var simbologia = parametros.GetValueOrDefault("simbologia", "ean13");

        var cuerpo = new StringBuilder();
        if (emitirAim && Aim.TryGetValue(simbologia, out var marca)) cuerpo.Append(marca);
        cuerpo.Append(Desescapar(codigo));

        // La página de códigos es la 1252 y no UTF-8: un lector manda BYTES, y los que llevan
        // acento (que los hay en los códigos internos de algunas casas) viajan en UN byte, no en
        // dos. Emitirlos en UTF-8 haría pasar aquí una prueba que en el mostrador fallaría.
        var bytes = new List<byte>();
        if (prefijo > 0) bytes.Add((byte)prefijo);
        bytes.AddRange(Encoding.Latin1.GetBytes(cuerpo.ToString()));
        if (sufijo > 0) bytes.Add((byte)sufijo);
        return [.. bytes];
    }

    /// <summary>Un lector a secas no escucha: lo que le llegue se anota en el diario y se ignora.</summary>
    public byte[]? Recibir(ReadOnlySpan<byte> bytes) => null;

    /// <summary>
    /// `{GS}` y `{FNC1}` se vuelven 0x1D. Hace falta para poder probar GS1-128 de verdad: el
    /// separador de los AIs de longitud variable NO es una tecla, así que no se puede teclear en
    /// la ficha — y es exactamente el byte que decide si una etiqueta se lee entera o mutilada.
    /// </summary>
    private static string Desescapar(string s) =>
        s.Replace("{GS}", Gs, StringComparison.OrdinalIgnoreCase)
         .Replace("{FNC1}", Gs, StringComparison.OrdinalIgnoreCase);

    private static int Entero(string valor, int porDefecto) =>
        int.TryParse(valor, out var n) && n is >= 0 and <= 255 ? n : porDefecto;
}
