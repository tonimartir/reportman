using System.Globalization;
using System.Text;

namespace Reportman.DeviceEmulator;

/// <summary>
/// LA BALANZA DEL MOSTRADOR: pesa, y sobre todo DUDA.
///
/// Lo que hay que emular de este aparato no es el número —eso lo hace cualquiera— sino el rato en
/// que el número todavía no vale. Una balanza real pasa la mayor parte del tiempo INESTABLE
/// mientras el género se posa, y en ese rato manda tramas con un `!` dentro. nt2 las lee y las da
/// por peso CERO (Dispositivos.cs:616-617), no por «no hay lectura»: para el TPV una pesada
/// inestable es un cero perfectamente creíble. De ahí el ajuste `inestable`, que deja el aparato
/// clavado en «me estoy moviendo» para poder demostrar que el punto de venta espera y vuelve a
/// preguntar en vez de tragarse medio kilo de aire.
///
/// Y CONTESTA CUANDO LE PREGUNTAN, que es la otra mitad. El TPV no escucha a la balanza: le manda
/// un solo byte y espera una trama (Dispositivos.cs:1037-1042, AskWeight; la lectura síncrona con
/// su timeout está en 1353-1391, y el mismo `$` en clientent/nt/Base/Datos.cs:5544-5546).
///
/// DOS MODELOS, QUE ES UN APARATO Y NO DOS FICHEROS: la Baxtran P71 (Giropes) y la Toledo 9550 se
/// diferencian en el byte con el que se les pregunta y en la forma de la trama, no en lo que hacen.
/// nt2 las distingue con el mismo `modelo` que el resto (`AskWeight` manda `W` en la 9550 y `$` en
/// las demás, Dispositivos.cs:1031-1041; al leer, la 9550 entra por el mismo camino pero PARTE LA
/// TRAMA POR SU PRIMER CARÁCTER en vez de por espacios, Dispositivos.cs:611-628). Cambiar el modelo
/// en la ficha es lo que permite ver el síntoma de tenerlo mal: se pregunta y no contesta nadie.
///
/// El formato de las dos tramas va explicado en <see cref="Tramar"/>: sale de lo que nt2 sabe leer,
/// no de un catálogo, y hay una parte SUPUESTA que está marcada allí.
/// </summary>
public sealed class Balanza(string id = "balanza", string? nombre = null) : IDispositivo
{
    private const byte Stx = 0x02;
    private const byte Etx = 0x03;

    /// <summary>Baxtran P71 (Giropes): se le pregunta con `$`.</summary>
    private const int P71 = 1;
    /// <summary>Toledo 9550: se le pregunta con `W` (Dispositivos.cs:1031-1036).</summary>
    private const int Toledo = 2;

    private int modelo = P71;
    private decimal peso;
    private int letraFin = 13;
    private bool inestable;
    private string unidad = "kg";

    public string Id => id;
    /// <summary>El nombre SIGUE AL MODELO cuando nadie lo ha fijado: en la rejilla se ve una tarjeta
    /// por aparato, y una «Baxtran P71» que contestara al `W` sería un aparato mintiendo.</summary>
    public string Nombre => nombre ?? (modelo == Toledo ? "Balanza Toledo 9550" : "Balanza Baxtran P71");
    public string Tipo => "balanza";

    public IReadOnlyList<AccionDef> Acciones =>
    [
        new("pesar", "Pesar",
        [
            new CampoDef("peso", "Peso (kg)", "numero", "0,500",
                "Lo que queda encima del plato. Se admite «0,5» y «0.5»."),
        ]),
        new("tarar", "Tarar"),
        new("quitar", "Quitar el peso"),
    ];

    public IReadOnlyList<AjusteDef> Ajustes =>
    [
        new("modelo", "Modelo", "numero", modelo.ToString(),
            "1 = Baxtran P71 (Giropes): pregunta `$`, trama con la unidad delante del número · " +
            "2 = Toledo 9550: pregunta `W` y la trama va SIN unidad. Cada modelo contesta a SU " +
            "pregunta y calla ante la del otro, que es como se ve que el TPV lo tiene mal puesto."),
        new("letra_fin", "Carácter de fin", "numero", letraFin.ToString(),
            "Código decimal. 13 = CR, que es lo que nt2 trae por defecto (Dispositivos.cs:81) y " +
            "donde corta la trama (545)."),
        new("inestable", "Peso inestable", "interruptor", inestable ? "1" : "0",
            "Mientras esté puesto, TODA trama sale con el «!» de peso moviéndose. nt2 lo busca en " +
            "la trama entera y devuelve 0 (Dispositivos.cs:616-617), en los DOS modelos."),
        new("unidad", "Unidad", "texto", unidad,
            "kg · g · lb. Va DELANTE del número, ver Tramar. SÓLO en la P71: en la 9550 nt2 parte " +
            "la trama por su primer carácter y se queda con el resto entero, así que una unidad " +
            "ahí dentro le reventaría la conversión."),
    ];

    public void Ajustar(string clave, string valor)
    {
        switch (clave)
        {
            case "modelo":
                if (!int.TryParse(valor, out var m) || m is < P71 or > Toledo)
                    throw new ArgumentException("El modelo es 1 (Baxtran P71) o 2 (Toledo 9550).");
                modelo = m;
                break;
            case "letra_fin":
                if (!int.TryParse(valor, out var fin) || fin is < 1 or > 255)
                    throw new ArgumentException("El carácter de fin es un código de 1 a 255; 13 es CR.");
                letraFin = fin;
                break;
            case "inestable":
                inestable = valor is "1" or "true" or "on";
                break;
            case "unidad":
                // nt2 busca el «!» en TODA la trama (Dispositivos.cs:616): una unidad que lo
                // llevara dejaría el aparato inestable para siempre y sin que se note por qué.
                if (valor.Contains('!'))
                    throw new ArgumentException("La unidad no puede llevar «!»: nt2 lo lee como peso inestable.");
                unidad = valor;
                break;
            default:
                throw new ArgumentException($"La balanza no tiene el ajuste «{clave}».");
        }
    }

    public byte[]? Ejecutar(string accion, IReadOnlyDictionary<string, string> parametros)
    {
        switch (accion)
        {
            case "pesar":
                peso = Kilos(parametros.GetValueOrDefault("peso", ""));
                break;
            // Tarar y quitar acaban en el mismo cero pero no son lo mismo y por eso son dos
            // botones: tarar es el envase puesto —el neto se va a cero con género encima— y
            // quitar es el plato vacío. La tara en sí no se emite: nt2 sólo mira el último campo
            // (Dispositivos.cs:626), así que un campo de tara le pasaría por delante sin leerse.
            case "tarar":
            case "quitar":
                peso = 0;
                break;
            default:
                throw new ArgumentException($"La balanza no sabe hacer «{accion}».");
        }
        return Tramar(peso);
    }

    /// <summary>
    /// La balanza sólo abre la boca cuando le preguntan: `$` la P71 (Dispositivos.cs:1039-1041),
    /// `W` la 9550 (1031-1036). La pregunta DEL OTRO MODELO se deja sin respuesta a propósito: en
    /// el diario se ve la pregunta y el silencio, que es el síntoma de tener mal el modelo.
    /// </summary>
    public byte[]? Recibir(ReadOnlySpan<byte> bytes) =>
        bytes.IndexOf(modelo == Toledo ? (byte)'W' : (byte)'$') >= 0 ? Tramar(peso) : null;

    /// <summary>
    /// LA TRAMA. El orden de los campos SALE DE LO QUE nt2 SABE LEER, no de un catálogo.
    ///
    /// LA P71 (modelo 1):
    ///   * empieza por STX porque nt2 sólo entra en el camino de esta balanza si el primer
    ///     carácter es STX o ETX (Dispositivos.cs:611), y `letra_inicio` viene a -1, o sea que no
    ///     se descarta ningún carácter de cabecera (Dispositivos.cs:80, 681-687);
    ///   * el PESO es el ÚLTIMO campo separado por espacios, porque nt2 parte por espacios y se
    ///     queda con el trozo final (Dispositivos.cs:620-628). Por eso la unidad va DELANTE del
    ///     número: detrás, el `Convert.ToDecimal` de la 628 reventaría y se llevaría por delante el
    ///     hilo de lectura entero (696-723). Cuántos campos hay antes del peso nt2 no lo dice, y
    ///     tampoco importa: sólo lee el último;
    ///   * el ETX va DESPUÉS del carácter de fin, no antes. Es la única colocación que cuadra: con
    ///     `letra_fin`=13 nt2 corta en el CR (545), así que un ETX puesto antes se quedaría pegado
    ///     al número y lo haría impresentable; puesto detrás encabeza el buffer de la trama
    ///     SIGUIENTE, que es exactamente el caso «primer carácter ETX» que nt2 contempla (611) y
    ///     que el Trim de la 608 deja limpio de CR/LF sobrantes. Si alguien pone `letra_fin`=3, el
    ///     propio fin ya es el ETX y no se añade otro.
    ///
    /// LA 9550 (modelo 2) es MÁS CORTA Y POR UNA RAZÓN MEDIDA: nt2 la parte por su PROPIO PRIMER
    /// CARÁCTER —`nlectura.Split(nlectura[0])`, Dispositivos.cs:621-622— y se queda con el último
    /// trozo. Eso obliga a dos cosas y prohíbe una tercera:
    ///   * el STX de cabecera SIGUE HACIENDO FALTA, y aquí no por el `if` de la 611 sino por el
    ///     propio Split: sin él, una trama «12.345» se partiría por el «1» y el último trozo sería
    ///     «2.345» — un peso menor, creíble y equivocado;
    ///   * el peso va SOLO detrás del STX, sin unidad y sin más campos: lo que quede después del
    ///     último separador entra tal cual en el `Convert.ToDecimal` de la 628;
    ///   * y no se añade ETX, que sería un carácter más pegado al número de la trama siguiente.
    ///
    /// El número va con PUNTO decimal porque nt2 lo cambia por coma antes de convertir (628) — y
    /// de paso queda dicho que esa conversión da por hecha una máquina en español.
    ///
    /// SUPUESTO (nt2 no permite deducirlo): que el peso lleve SIGNO, que la unidad viaje en la
    /// trama de la P71 y que sean tres decimales. Es la forma corriente de la P71 en kg; si el
    /// aparato de verdad manda otra cosa, cambia aquí y nt2 seguirá leyéndolo mientras el número
    /// sea el último campo y el `!` marque la inestabilidad.
    /// </summary>
    private byte[] Tramar(decimal kilos)
    {
        var texto = new StringBuilder();
        texto.Append((char)Stx);
        if (inestable) texto.Append('!');
        if (modelo != Toledo)
            texto.Append(' ').Append(unidad).Append(' ');
        texto.Append(kilos < 0 ? '-' : '+');
        // Tres decimales SIEMPRE, también para el cero. Además de ser lo que enseña el visor,
        // mantiene la trama por encima de los 5 caracteres que nt2 exige para mirarla siquiera
        // (Dispositivos.cs:606): por debajo la da por peso 0 sin leer nada, y un cero por no
        // haber mirado se parece demasiado a un cero de verdad.
        texto.Append(Math.Abs(kilos).ToString("0.000", CultureInfo.InvariantCulture));

        // Latin1 y no UTF-8: por el cable van BYTES, y una unidad con acento o un símbolo de más
        // allá del ASCII tiene que ocupar uno, como en el aparato.
        var bytes = new List<byte>(Encoding.Latin1.GetBytes(texto.ToString())) { (byte)letraFin };
        if (modelo != Toledo && letraFin != Etx) bytes.Add(Etx);
        return [.. bytes];
    }

    /// <summary>La ficha se teclea en español: «0,500» y «0.500» son el mismo medio kilo.</summary>
    private static decimal Kilos(string valor) =>
        decimal.TryParse(valor.Replace(',', '.'), NumberStyles.Number, CultureInfo.InvariantCulture,
                         out var kilos)
            ? kilos
            : throw new ArgumentException($"«{valor}» no es un peso en kilos.");
}
