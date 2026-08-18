namespace Reportman.DeviceEmulator;

/// <summary>
/// UN DISPOSITIVO EMULADO. Es la pieza que hace que esto sea UN programa y no cinco.
///
/// La frontera es estricta y es toda la arquitectura: **el dispositivo no sabe de sockets y el
/// transporte no sabe de tramas**. El dispositivo dice qué bytes salen cuando alguien «escanea» y
/// qué contesta cuando le hablan; por dónde viajan esos bytes —TCP hoy, un COM mañana— no es asunto
/// suyo. Es como está hecho nt2, donde `SerialConfiguration` lleva dentro `HostName` y
/// `HostPortNumber`: serie y serie-por-red son el mismo protocolo con distinto cable. Y es lo que
/// hace un conversor serie-LAN de verdad.
///
/// La pantalla tampoco conoce a ningún dispositivo en concreto: pinta lo que cada uno DECLARA en
/// <see cref="Acciones"/> y <see cref="Ajustes"/>. Añadir el Magellan será añadir un fichero.
/// </summary>
public interface IDispositivo
{
    /// <summary>Identificador estable, el que usa la API y el diario: `lector1`, `magellan`.</summary>
    string Id { get; }
    string Nombre { get; }
    /// <summary>Familia, para el icono y para agrupar: `lector`, `balanza`, `visor`.</summary>
    string Tipo { get; }

    /// <summary>Lo que se le puede HACER desde la pantalla. Un «escanear» tiene que ser un clic.</summary>
    IReadOnlyList<AccionDef> Acciones { get; }

    /// <summary>
    /// Los bytes que el aparato EMITE al ejecutar una acción, ya tramados. `null` = la acción no
    /// manda nada por el cable (cambia un estado interno y ya).
    /// </summary>
    byte[]? Ejecutar(string accion, IReadOnlyDictionary<string, string> parametros);

    /// <summary>
    /// Lo que el TPV le MANDA al aparato. Devuelve la respuesta si la hay — el Magellan contesta
    /// `S01` a un `S00`, y esa conversación es la mitad de lo que hay que emular bien.
    /// </summary>
    byte[]? Recibir(ReadOnlySpan<byte> bytes);

    /// <summary>Lo que se configura en su ficha: sufijo, prefijo, modelo…</summary>
    IReadOnlyList<AjusteDef> Ajustes { get; }
    void Ajustar(string clave, string valor);
}

/// <summary>Una acción de la ficha: un botón con sus campos.</summary>
public sealed record AccionDef(string Id, string Etiqueta, IReadOnlyList<CampoDef> Campos)
{
    public AccionDef(string id, string etiqueta) : this(id, etiqueta, []) { }
}

/// <summary>Un campo de una acción o de un ajuste. `Tipo`: texto · numero · interruptor.</summary>
public sealed record CampoDef(string Id, string Etiqueta, string Tipo = "texto", string Valor = "",
                              string? Ayuda = null);

/// <summary>
/// Un ajuste vivo del aparato: se cambia y afecta a la siguiente trama.
///
/// `SoloLectura` es para lo que NO se configura sino que se MIRA: las dos líneas que el TPV ha
/// escrito en el visor, el estado de la segunda pantalla. Un visor casi no emite —recibe— y sin
/// esto no habría forma de ver en la ficha lo que le han pintado. Se cuela por aquí a propósito
/// en vez de ensanchar <see cref="IDispositivo"/> con un «estado» que sólo usarían dos aparatos.
/// </summary>
public sealed record AjusteDef(string Id, string Etiqueta, string Tipo, string Valor,
                               string? Ayuda = null, bool SoloLectura = false);

/// <summary>
/// POR DÓNDE VIAJAN LOS BYTES. Una escucha TCP hoy; un puerto COM en la fase 4.
///
/// Emite a TODOS los conectados: en el mostrador hay un aparato y un TPV, pero en la mesa de
/// desarrollo hay a menudo dos ventanas mirando lo mismo, y que una robe las tramas de la otra
/// convierte una prueba en un misterio.
/// </summary>
public interface ITransporte : IAsyncDisposable
{
    /// <summary>Lo que se enseña en la ficha: «TCP 0.0.0.0:9201» o «COM3 9600 8N1».</summary>
    string Descripcion { get; }
    /// <summary>Cuántos hablan con este aparato ahora mismo.</summary>
    int Clientes { get; }
    Task IniciarAsync(CancellationToken ct);
    Task EnviarAsync(byte[] bytes, CancellationToken ct);
    /// <summary>Lo que llega del TPV. Lo trama el dispositivo, no el transporte.</summary>
    event Action<byte[]>? Recibido;
}
