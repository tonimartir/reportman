namespace Reportman.DeviceEmulator;

/// <summary>
/// EL VISOR DE CLIENTE DE PUERTO: el VFD de dos líneas que mira el cliente mientras se cobra.
///
/// ES EL RARO DE LOS CUATRO, Y AL REVÉS: los otros tres EMITEN (una lectura, un peso) y aquí no
/// sale nada por el cable. Un visor sólo RECIBE. Así que lo que hay que emular no es una trama de
/// salida sino la PANTALLA: dos líneas de caracteres en memoria, un cursor, y los comandos que las
/// mueven. `Ejecutar` no devuelve bytes nunca y `Recibir` tampoco: un visor no habla.
///
/// LO QUE LE MANDA nt2, que es de donde salen todas las tramas de aquí:
///   * borrar, `1B 5B 32 4A` = ESC [ 2 J          (Dispositivos.cs:181-191, Dispositivos.cs:277-285)
///   * borrar del modelo 2, ESC @ y luego FS 0x1C (Dispositivos.cs:248-258)
///   * borrar del modelo 3, ESC @ y luego FF 0x0C (Dispositivos.cs:259-269)
///   * posicionar, `1B 5B Py 3B Px 48` = ESC [ fila ; columna H, y el texto detrás en cp1252 sin
///     diacríticos —StringUtil.RemoveDiacritics—  (Dispositivos.cs:471-487)
///   * el modelo 4 NO es este aparato: es la segunda pantalla de la aplicación, se pinta por la
///     interfaz y no viaja un solo byte  (Dispositivos.cs:270-276)
///
/// EL ESTADO SE CONSULTA COMO AJUSTES DE SÓLO LECTURA, `linea1` y `linea2`. Es un apaño consciente:
/// `IDispositivo` no tiene hueco para «estado» y ensanchar el contrato de los cuatro aparatos por
/// el único que tiene algo que enseñar sale más caro que esta rareza, que además se ve gratis en la
/// ficha. Escribirlas desde la ficha es un error de uso: las escribe el TPV por el cable.
/// </summary>
public sealed class VisorPuerto(string id = "visor", string nombre = "Visor de cliente") : IDispositivo
{
    /// <summary>Los 32 huecos que cp1252 llena y Latin-1 deja vacíos (0x80-0x9F). Van como números
    /// y no como letras a propósito: son justo los caracteres que un editor o un diff descuidado
    /// convierte en interrogantes, y entonces el fallo sería del fichero, no del aparato. El 0
    /// marca los cinco códigos que cp1252 no define.</summary>
    private static readonly char[] Cp1252Altos =
    [
        (char)0x20AC, (char)0, (char)0x201A, (char)0x0192, (char)0x201E, (char)0x2026,
        (char)0x2020, (char)0x2021, (char)0x02C6, (char)0x2030, (char)0x0160, (char)0x2039,
        (char)0x0152, (char)0, (char)0x017D, (char)0,
        (char)0, (char)0x2018, (char)0x2019, (char)0x201C, (char)0x201D, (char)0x2022,
        (char)0x2013, (char)0x2014, (char)0x02DC, (char)0x2122, (char)0x0161, (char)0x203A,
        (char)0x0153, (char)0, (char)0x017E, (char)0x0178,
    ];

    /// <summary>Tope de lo que se guarda de una secuencia partida por la mitad. Si llega más basura
    /// que esto sin byte final, es basura y no una secuencia: se tira.</summary>
    private const int MaxPendiente = 16;

    private int modelo = 1;
    private int columnas = 20;
    private int filas = 2;
    private char[][] pantalla = Rejilla(2, 20);
    private int fila;
    private int columna;
    private readonly List<byte> pendiente = [];

    public string Id => id;
    public string Nombre => nombre;
    public string Tipo => "visor";

    public IReadOnlyList<AccionDef> Acciones =>
    [
        new("reiniciar", "Reiniciar (vaciar la pantalla)"),
    ];

    public IReadOnlyList<AjusteDef> Ajustes =>
    [
        new("modelo", "Modelo", "numero", modelo.ToString(),
            "1 = borra con ESC [ 2 J · 2 = borra con ESC @ y FS (0x1C) · 3 = borra con ESC @ y FF " +
            "(0x0C). Cada modelo entiende SU trama de borrado y no la de los otros: por eso nt2 " +
            "tiene el switch. El modelo 4 de nt2 no es un aparato de puerto, es la segunda pantalla."),
        new("columnas", "Columnas", "numero", columnas.ToString(),
            "Dónde parte el texto. 20 en el visor de dos líneas: el TPV manda las dos líneas " +
            "pegadas, 40 caracteres sin separador, y cuenta con que el visor rompa en la 20."),
        new("filas", "Filas", "numero", filas.ToString(),
            "2 en el visor de mostrador; el modelo 1 de nt2 recibe cuatro líneas separadas por CR LF."),
        // `SoloLectura`: la ficha las pinta como PANTALLA, no como campo. Un visor casi no emite
        // —recibe—, así que esto es lo único suyo que hay que poder ver.
        new("linea1", "Línea 1", "texto", Linea(0),
            $"Lo que se ve ahora. La escribe el TPV, no la ficha. Cursor en fila {fila + 1}, " +
            $"columna {columna + 1}.", SoloLectura: true),
        new("linea2", "Línea 2", "texto", Linea(1),
            "Lo que se ve ahora. La escribe el TPV, no la ficha.", SoloLectura: true),
    ];

    public void Ajustar(string clave, string valor)
    {
        switch (clave)
        {
            case "modelo":
                // El 4 se rechaza con su propio mensaje: no es un modelo fuera de rango, es que ese
                // visor de nt2 no existe por cable (Dispositivos.cs:270-276).
                if (valor.Trim() == "4")
                    throw new ArgumentException(
                        "El modelo 4 no es un visor de puerto: es la segunda pantalla de la " +
                        "aplicación, se pinta por la interfaz y no manda un solo byte.");
                modelo = Entero(valor, 1, 3);
                break;
            case "columnas":
                columnas = Entero(valor, 1, 80);
                Redimensionar();
                break;
            case "filas":
                filas = Entero(valor, 1, 8);
                Redimensionar();
                break;
            case "linea1" or "linea2":
                throw new ArgumentException(
                    "Las líneas del visor las escribe el TPV por el cable, no la ficha: aquí sólo " +
                    "se miran.");
            default:
                throw new ArgumentException($"El visor no tiene el ajuste «{clave}».");
        }
    }

    public byte[]? Ejecutar(string accion, IReadOnlyDictionary<string, string> parametros)
    {
        if (accion != "reiniciar")
            throw new ArgumentException($"El visor no sabe hacer «{accion}».");

        Borrar();
        pendiente.Clear();
        return null;
    }

    /// <summary>
    /// Interpreta el flujo del TPV: comandos y texto mezclados, que es como llega de verdad
    /// (el TPV borra y escribe seguido, sin posicionar — TPV.cs:18575-18605).
    /// </summary>
    public byte[]? Recibir(ReadOnlySpan<byte> bytes)
    {
        // Un envío de TCP puede partir un ESC [ 1 ; 1 H por la mitad. Lo que queda a medias espera
        // al siguiente trozo en vez de imprimirse como basura en la pantalla.
        var flujo = new List<byte>(pendiente.Count + bytes.Length);
        flujo.AddRange(pendiente);
        pendiente.Clear();
        foreach (var b in bytes)
            flujo.Add(b);

        var i = 0;
        while (i < flujo.Count)
        {
            var b = flujo[i];
            if (b == 0x1B)
            {
                var consumidos = Escape(flujo, i);
                if (consumidos == 0)
                {
                    var resto = flujo.Count - i;
                    if (resto <= MaxPendiente)
                        pendiente.AddRange(flujo.GetRange(i, resto));
                    break;
                }
                i += consumidos;
                continue;
            }

            i++;
            switch (b)
            {
                case 0x0D:
                    columna = 0;
                    break;
                case 0x0A:
                    SaltarLinea();
                    break;
                case 0x0C when modelo == 3:
                    Borrar();
                    break;
                case 0x1C when modelo == 2:
                    Borrar();
                    break;
                default:
                    // Todo lo imprimible se pinta; el resto de bytes de control se ignoran en
                    // silencio, que es lo que hace un visor de verdad con lo que no entiende.
                    if (b >= 0x20)
                        Escribir(Decodificar(b));
                    break;
            }
        }
        return null;
    }

    /// <summary>
    /// Devuelve cuántos bytes se ha comido la secuencia, o 0 si está incompleta y hay que esperar.
    /// </summary>
    private int Escape(List<byte> flujo, int inicio)
    {
        if (inicio + 1 >= flujo.Count)
            return 0;

        var segundo = flujo[inicio + 1];
        if (segundo == 0x40)
        {
            // ESC @ es «inicializa». Sólo los modelos 2 y 3 lo reciben (Dispositivos.cs:248-269);
            // mandárselo a un modelo 1 no borra nada, y esa diferencia es justo la razón de que
            // nt2 tenga un switch por modelo en vez de una sola trama.
            if (modelo is 2 or 3)
                Borrar();
            return 2;
        }
        // Lo que no es ESC @ ni ESC [ se traga entero de dos bytes: sin conocer el comando no hay
        // forma de saber su longitud, y comerse dos es lo único que no deja el ESC suelto para que
        // el byte siguiente acabe pintado en la pantalla.
        if (segundo != 0x5B)
            return 2;

        var j = inicio + 2;
        var parametros = new List<int>();
        var valor = -1;
        while (true)
        {
            if (j >= flujo.Count)
                return 0;

            var b = flujo[j];
            if (b is >= 0x30 and <= 0x39)
            {
                valor = (valor < 0 ? 0 : valor) * 10 + (b - 0x30);
                j++;
                continue;
            }
            if (b == 0x3B)
            {
                parametros.Add(valor);
                valor = -1;
                j++;
                continue;
            }
            if (b is >= 0x40 and <= 0x7E)
            {
                parametros.Add(valor);
                break;
            }
            // Un ESC dentro de la secuencia significa que la anterior venía truncada: se abandona y
            // se sigue por el ESC nuevo, que sí es un comando bueno y no hay por qué perderlo.
            if (b == 0x1B)
                return j - inicio;

            // TRAMPA MEDIDA: el posicionamiento de nt2 mete la fila y la columna como BYTES CRUDOS,
            // no como dígitos ASCII —`bufinit[2] = line` (Dispositivos.cs:475-481)—, así que la fila
            // 1 viaja como 0x01 y no como '1'. Se aceptan las dos formas: los dígitos porque son lo
            // estándar, y el byte suelto de control porque es lo que sale de nt2.
            parametros.Add(b);
            valor = -1;
            j++;
        }

        var final = flujo[j];
        var consumidos = j - inicio + 1;
        switch (final)
        {
            case 0x4A when modelo is not (2 or 3):
                // ESC [ Ps J. nt2 sólo manda Ps=2, «borra la pantalla entera» (Dispositivos.cs:186-189),
                // así que no se distinguen los borrados parciales: cualquier J borra todo.
                Borrar();
                break;
            case 0x48:
                Posicionar(Parametro(parametros, 0), Parametro(parametros, 1));
                break;
            // Cualquier otro comando se ignora entero y la pantalla sigue viva.
        }
        return consumidos;
    }

    private static int Parametro(List<int> parametros, int indice) =>
        indice < parametros.Count && parametros[indice] > 0 ? parametros[indice] : 1;

    /// <summary>Py y Px vienen en base 1, como en ANSI; fuera de la rejilla se pega al borde.</summary>
    private void Posicionar(int py, int px)
    {
        fila = Math.Clamp(py - 1, 0, filas - 1);
        columna = Math.Clamp(px - 1, 0, columnas - 1);
    }

    private void Escribir(char c)
    {
        if (columna >= columnas)
        {
            columna = 0;
            SaltarLinea();
        }
        pantalla[fila][columna] = c;
        columna++;
    }

    /// <summary>
    /// Al pasar de la última fila se vuelve a la primera. Un visor de mostrador no hace scroll, y
    /// esto no está medido en nt2 —el TPV nunca escribe más de lo que cabe—, pero envolver es lo
    /// que menos sorprende y no pierde el texto de golpe.
    /// </summary>
    private void SaltarLinea()
    {
        fila++;
        if (fila >= filas)
            fila = 0;
    }

    /// <summary>
    /// Borrar deja el cursor en el origen. Se deduce, y es la parte que más importa: el TPV llama a
    /// ClearDisplayAsync y escribe las líneas justo después SIN posicionar (TPV.cs:18575-18605), así
    /// que si el borrado no llevara el cursor a 1;1 el texto saldría donde estuviera el anterior.
    /// </summary>
    private void Borrar()
    {
        foreach (var linea in pantalla)
            Array.Fill(linea, ' ');
        fila = 0;
        columna = 0;
    }

    /// <summary>Cambiar el tamaño es cambiar de aparato: la pantalla se queda vacía.</summary>
    private void Redimensionar()
    {
        pantalla = Rejilla(filas, columnas);
        fila = 0;
        columna = 0;
    }

    /// <summary>Sin los espacios de la derecha: los de la izquierda son posición y significan algo,
    /// los del final son sólo el resto de la línea en blanco.</summary>
    private string Linea(int indice) =>
        indice < pantalla.Length ? new string(pantalla[indice]).TrimEnd() : "";

    /// <summary>
    /// cp1252, que es lo que manda nt2 (Dispositivos.cs:484-485). Otros modelos viajan en 437 o en
    /// 1251 (TPV.cs:10770, TPV.cs:18620), pero da igual una página u otra: nt2 pasa el texto por
    /// StringUtil.RemoveDiacritics antes de escribirlo, y lo que queda vive en 0x20-0x7E, donde las
    /// tres páginas dicen lo mismo. Se decodifica a mano para no depender del proveedor de páginas
    /// de códigos, que en .NET no viene puesto.
    /// </summary>
    private static char Decodificar(byte b)
    {
        if (b is < 0x80 or > 0x9F)
            return (char)b;
        var c = Cp1252Altos[b - 0x80];
        return c == '\0' ? '?' : c;
    }

    private static char[][] Rejilla(int filas, int columnas)
    {
        var rejilla = new char[filas][];
        for (var i = 0; i < filas; i++)
        {
            rejilla[i] = new char[columnas];
            Array.Fill(rejilla[i], ' ');
        }
        return rejilla;
    }

    private static int Entero(string valor, int minimo, int maximo)
    {
        if (!int.TryParse(valor, out var n))
            throw new ArgumentException($"«{valor}» no es un número.");
        if (n < minimo || n > maximo)
            throw new ArgumentException($"El valor tiene que estar entre {minimo} y {maximo}.");
        return n;
    }
}
