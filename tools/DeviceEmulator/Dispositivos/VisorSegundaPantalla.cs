using System.Text;

namespace Reportman.DeviceEmulator;

/// <summary>
/// EL VISOR DE SEGUNDA PANTALLA: lo que el cliente ve desde el otro lado del mostrador.
///
/// EN nt2 ESTE APARATO NO TIENE CABLE. Es el `VisorCliente` modelo 4 y no habla ningún protocolo:
/// la aplicación abre una ventana en el segundo monitor y la mueve por llamadas en proceso
/// —`CrearInterfaceSecondary`, `PantallaSecundariaDividida`, `PantallaSecundariaSoloImagen`,
/// `ImagenGracias`— (Dispositivos.cs:295-424; el montaje de la ventana, en DBClient.cs:389-412).
/// Lo que pinta son dos bandas: arriba, fondo negro, la FOTO DEL ARTÍCULO recién escaneado y a su
/// lado el texto en Courier New verde sobre negro a cuerpo 40 (Dispositivos.cs:302-305 y 353-363);
/// abajo, el LOGO de la tienda, que sale de TIENDAS.LOGO (Dispositivos.cs:365-375 y 431-437).
///
/// ASÍ QUE EL PROTOCOLO ES NUESTRO, por decisión del propietario: no hay aparato heredado que
/// respetar, y sin aparato heredado no hay ninguna razón para inventarse números mágicos ni para
/// pelearse con la cp1252. Es texto, UNA ORDEN POR LÍNEA terminada en LF (0x0A), en UTF-8.
///
/// PROTOCOLO
///
///   LINEA 1 Total:        12,34      el renglón de arriba
///   LINEA 2 Entregado:    20,00      el de abajo
///   LINEA 1                          lo deja vacío
///   IMAGEN ID 791196812              foto del artículo por ARTICULO.ID64 (TPV.cs:18626-18633)
///   IMAGEN URL http://tienda/a.jpg   foto por dirección
///   IMAGEN NINGUNA                   quita la foto
///   LOGO ID 7                        logo por código de tienda (Dispositivos.cs:431-437)
///   LOGO URL http://tienda/logo.png
///   LOGO NINGUNO
///   ESTADO DIVIDIDA                  foto y texto arriba, logo abajo   (Dispositivos.cs:382-393)
///   ESTADO SOLO_IMAGEN               sólo el logo, en reposo           (Dispositivos.cs:394-402)
///   ESTADO GRACIAS                   la despedida al acabar la venta   (Dispositivos.cs:403-424)
///   BORRAR                           vacía texto y foto y vuelve a SOLO_IMAGEN, como hace el
///                                    modelo 4 al borrar (Dispositivos.cs:270-276): el logo se
///                                    queda, que es lo que se ve en reposo
///   CONSULTA                         contesta el estado visible entero
///
/// Los verbos no distinguen mayúsculas de minúsculas; en mayúsculas se leen mejor en el diario.
/// El texto de LINEA va CRUDO hasta el LF —ni se recorta por los lados ni se trunca—, porque el
/// TPV alinea los importes rellenando de espacios (CobroFactura.cs:2670-2690) y un Trim() aquí
/// descuadraría la columna allí. Un renglón vacío se ignora, y un CR antes del LF también, para
/// poder hablar con esto desde un telnet a mano.
///
/// LO QUE CONTESTA. En marcha normal, NADA: un visor es un aparato que sólo escucha, y un «OK»
/// por orden doblaría el diario justo cuando más apretado va (un artículo escaneado son tres o
/// cuatro órdenes). Habla en dos casos:
///
///   CONSULTA  ->  ESTADO DIVIDIDA
///                 LINEA 1 Total:        12,34
///                 LINEA 2 Entregado:    20,00
///                 IMAGEN ID 791196812
///                 LOGO NINGUNO
///
///   una orden que no se entiende  ->  ERROR MOTIVO detalle
///
///                 ERROR ORDEN_DESCONOCIDA PINTA
///                 ERROR ESTADO_DESCONOCIDO ROJA
///                 ERROR NUMERO_DE_LINEA 3
///                 ERROR FALTAN_ARGUMENTOS IMAGEN
///                 ERROR ORIGEN_DESCONOCIDO FICHERO
///                 ERROR ID_NO_NUMERICO 12a
///                 ERROR URL_INVALIDA logo.png
///                 ERROR SOBRAN_ARGUMENTOS BORRAR
///                 ERROR LINEA_DEMASIADO_LARGA 4096
///
/// Lo que contesta CONSULTA son ÓRDENES VÁLIDAS: se pegan de vuelta por el mismo socket y la
/// pantalla queda igual. Y los motivos van SIN ACENTOS a propósito, porque el diario pinta como
/// «·» todo byte que no sea ASCII imprimible (Diario.cs:60-65) y una respuesta con tildes se
/// leería peor justo en el hexadecimal, que es donde se depura esto.
///
/// DOS LÍNEAS, no cuatro: nt2 mete hasta cuatro renglones en una sola etiqueta separados por LF
/// (TPV.cs:18625, CobroFactura.cs:2717), pero el propietario ha fijado que el contenido no tiene
/// que ser el de nt2, y aquí son dos.
///
/// EL BORRADO DIFERIDO del modelo 4 —un temporizador que apaga el texto un rato después, para que
/// la pantalla no se quede a oscuras de golpe (Dispositivos.cs:207-235; el TPV lo pide con 1000 ms
/// en CobroFactura.cs:2657-2664)— NO corre aquí: `retardo_borrado` guarda y enseña los
/// milisegundos que usaría la pantalla de verdad, y nada más. Un temporizador propio cambiaría el
/// estado de la ficha él solo y convertiría cualquier prueba en una carrera.
/// </summary>
public sealed class VisorSegundaPantalla(string id = "visor", string nombre = "Visor de segunda pantalla")
    : IDispositivo
{
    private const string Dividida = "DIVIDIDA";
    private const string SoloImagen = "SOLO_IMAGEN";
    private const string Gracias = "GRACIAS";

    /// <summary>Más de esto no es una orden: es ruido, o un TPV que nunca manda el LF. Se corta y
    /// se contesta, en vez de dejar crecer el buffer hasta quedarse sin memoria.</summary>
    private const int MaximoLinea = 4096;

    /// <summary>La ficha lee <see cref="Ajustes"/> desde el hilo del servidor web mientras el
    /// socket escribe el estado; y el transporte reparte cada conexión en su propia tarea.</summary>
    private readonly Lock cerrojo = new();

    /// <summary>El renglón a medias entre dos lecturas del socket. Se acumulan BYTES y no
    /// caracteres porque TCP parte por donde quiere: una «ó» son dos bytes y pueden llegar en
    /// lecturas distintas, así que decodificar cada trozo suelto la rompería.</summary>
    private readonly List<byte> pendiente = [];
    private bool descartando;

    private string linea1 = "";
    private string linea2 = "";
    private string estado = SoloImagen;
    private string imagen = "";
    private string logo = "";
    private int retardoBorrado = 3000;

    public string Id => id;
    public string Nombre => nombre;
    public string Tipo => "visor";

    public IReadOnlyList<AccionDef> Acciones => [new("reiniciar", "Reiniciar")];

    /// <summary>
    /// EL ESTADO VISIBLE, COLADO POR LA PUERTA DE LOS AJUSTES. <see cref="IDispositivo"/> no tiene
    /// hueco para «lo que se está viendo» (Contratos.cs:16-42) y la pantalla sólo sabe pintar
    /// acciones y ajustes, así que las cinco entradas de estado viajan como ajustes de SÓLO
    /// LECTURA: se enseñan, y <see cref="Ajustar"/> las rechaza. El valor es LITERALMENTE el trozo
    /// de orden que lo puso, de modo que se puede copiar de la ficha a un telnet y repetirlo.
    /// </summary>
    public IReadOnlyList<AjusteDef> Ajustes
    {
        get
        {
            lock (cerrojo)
                return
                [
                    new("linea1", "Línea 1", "texto", linea1,
                        "La escribe el TPV con «LINEA 1 …».", SoloLectura: true),
                    new("linea2", "Línea 2", "texto", linea2,
                        "La escribe el TPV con «LINEA 2 …».", SoloLectura: true),
                    new("estado", "Estado", "texto", estado,
                        "DIVIDIDA · SOLO_IMAGEN · GRACIAS. Lo cambia el TPV con «ESTADO …».",
                        SoloLectura: true),
                    new("imagen", "Imagen del artículo", "texto", imagen,
                        "«ID 791196812» (ARTICULO.ID64) o «URL …», vacío si no hay foto.",
                        SoloLectura: true),
                    new("logo", "Logo de la tienda", "texto", logo,
                        "«ID 7» (código de tienda) o «URL …», vacío si no hay logo.", SoloLectura: true),
                    new("retardo_borrado", "Retardo de borrado (ms)", "numero", retardoBorrado.ToString(),
                        "Lo que el modelo 4 espera antes de apagar el texto. Aquí sólo se guarda: " +
                        "el borrado lo hace la pantalla."),
                ];
        }
    }

    public void Ajustar(string clave, string valor)
    {
        switch (clave)
        {
            case "retardo_borrado":
                if (!int.TryParse(valor, out var ms) || ms < 0)
                    throw new ArgumentException($"El retardo de borrado son milisegundos, y «{valor}» no lo es.");
                lock (cerrojo) retardoBorrado = ms;
                break;
            case "linea1" or "linea2" or "estado" or "imagen" or "logo":
                throw new ArgumentException(
                    $"«{clave}» no se escribe desde la ficha: lo escribe el TPV por el cable, con la orden " +
                    "correspondiente (LINEA, ESTADO, IMAGEN o LOGO). Para vaciarlo, «Reiniciar».");
            default:
                throw new ArgumentException($"El visor no tiene el ajuste «{clave}».");
        }
    }

    public byte[]? Ejecutar(string accion, IReadOnlyDictionary<string, string> parametros)
    {
        if (accion != "reiniciar")
            throw new ArgumentException($"El visor no sabe hacer «{accion}».");

        lock (cerrojo)
        {
            linea1 = linea2 = imagen = logo = "";
            estado = SoloImagen;
            // También el renglón a medias: si el TPV se cayó en mitad de una orden, ese trozo
            // huérfano se pegaría a la siguiente y daría un error que no es del TPV nuevo.
            pendiente.Clear();
            descartando = false;
        }
        // El retardo NO se toca: es configuración del aparato, no estado visible.
        return null;
    }

    public byte[]? Recibir(ReadOnlySpan<byte> bytes)
    {
        var respuesta = new StringBuilder();
        lock (cerrojo)
        {
            foreach (var b in bytes)
            {
                if (b == 0x0A)
                {
                    if (descartando) { descartando = false; continue; }
                    var linea = Encoding.UTF8.GetString(pendiente.ToArray());
                    pendiente.Clear();
                    Responder(respuesta, Procesar(linea));
                    continue;
                }
                if (descartando) continue;

                pendiente.Add(b);
                if (pendiente.Count <= MaximoLinea) continue;
                pendiente.Clear();
                descartando = true;
                Responder(respuesta, $"ERROR LINEA_DEMASIADO_LARGA {MaximoLinea}");
            }
        }
        return respuesta.Length == 0 ? null : Encoding.UTF8.GetBytes(respuesta.ToString());
    }

    /// <summary>El terminador se pone a mano: `AppendLine` metería CRLF en Windows, y aquí la
    /// especificación dice LF.</summary>
    private static void Responder(StringBuilder respuesta, string? texto)
    {
        if (texto is not null) respuesta.Append(texto).Append('\n');
    }

    /// <summary>Ejecuta una orden ya entera. Devuelve la respuesta, o `null` si no hay que decir
    /// nada — que es el caso normal.</summary>
    private string? Procesar(string linea)
    {
        linea = linea.TrimEnd('\r');
        if (linea.Length == 0) return null;

        var (verbo, resto) = Partir(linea);
        switch (verbo.ToUpperInvariant())
        {
            case "LINEA":
                {
                    var (numero, texto) = Partir(resto);
                    if (numero.Length == 0) return "ERROR FALTAN_ARGUMENTOS LINEA";
                    if (numero == "1") linea1 = texto;
                    else if (numero == "2") linea2 = texto;
                    else return $"ERROR NUMERO_DE_LINEA {numero}";
                    return null;
                }

            case "IMAGEN":
                {
                    var (error, valor) = Fuente("IMAGEN", resto);
                    if (error is not null) return error;
                    imagen = valor;
                    return null;
                }

            case "LOGO":
                {
                    var (error, valor) = Fuente("LOGO", resto);
                    if (error is not null) return error;
                    logo = valor;
                    return null;
                }

            case "ESTADO":
                {
                    var nuevo = resto.Trim().ToUpperInvariant();
                    if (nuevo.Length == 0) return "ERROR FALTAN_ARGUMENTOS ESTADO";
                    if (nuevo is not (Dividida or SoloImagen or Gracias))
                        return $"ERROR ESTADO_DESCONOCIDO {nuevo}";
                    estado = nuevo;
                    return null;
                }

            case "BORRAR":
                if (resto.Length > 0) return "ERROR SOBRAN_ARGUMENTOS BORRAR";
                linea1 = linea2 = imagen = "";
                estado = SoloImagen;
                return null;

            case "CONSULTA":
                if (resto.Length > 0) return "ERROR SOBRAN_ARGUMENTOS CONSULTA";
                return $"ESTADO {estado}\nLINEA 1 {linea1}\nLINEA 2 {linea2}\n" +
                       $"IMAGEN {(imagen.Length == 0 ? "NINGUNA" : imagen)}\n" +
                       $"LOGO {(logo.Length == 0 ? "NINGUNO" : logo)}";

            default:
                return $"ERROR ORDEN_DESCONOCIDA {verbo}";
        }
    }

    /// <summary>
    /// El origen de una imagen: `ID 791196812`, `URL http://…` o `NINGUNA`. Devuelve el descriptor
    /// tal y como viajó por el cable —que es lo que enseña la ficha— o la línea de error.
    /// </summary>
    private static (string? Error, string Valor) Fuente(string orden, string resto)
    {
        var (clase, dato) = Partir(resto);
        dato = dato.Trim();
        switch (clase.ToUpperInvariant())
        {
            // Los dos géneros valen para las dos órdenes: acordarse de si toca «NINGUNA» o
            // «NINGUNO» no puede ser la diferencia entre que se borre la foto y que no.
            case "NINGUNA" or "NINGUNO":
                return (null, "");
            case "URL":
                if (dato.Length == 0) return ($"ERROR FALTAN_ARGUMENTOS {orden}", "");
                // Se comprueba que sea una dirección entera, pero no se descarga: este emulador no
                // sale a la red, sólo apunta lo que la pantalla de verdad tendría que ir a buscar.
                return Uri.TryCreate(dato, UriKind.Absolute, out _)
                    ? (null, $"URL {dato}")
                    : ($"ERROR URL_INVALIDA {dato}", "");
            case "ID":
                return long.TryParse(dato, out var n) && n >= 0
                    ? (null, $"ID {n}")
                    : ($"ERROR ID_NO_NUMERICO {dato}", "");
            case "":
                return ($"ERROR FALTAN_ARGUMENTOS {orden}", "");
            default:
                return ($"ERROR ORIGEN_DESCONOCIDO {clase}", "");
        }
    }

    /// <summary>Corta por el PRIMER espacio y no toca el resto: el resto puede ser el texto de una
    /// línea, y ahí los espacios son la alineación.</summary>
    private static (string Cabeza, string Cola) Partir(string s)
    {
        var espacio = s.IndexOf(' ');
        return espacio < 0 ? (s, "") : (s[..espacio], s[(espacio + 1)..]);
    }
}
