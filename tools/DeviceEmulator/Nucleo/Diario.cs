using System.Text;

namespace Reportman.DeviceEmulator;

/// <summary>Una línea del diario: quién, en qué dirección y qué bytes.</summary>
/// <param name="Sentido">`emite` = del aparato al TPV · `recibe` = del TPV al aparato.</param>
public sealed record Apunte(long Numero, string Momento, string Dispositivo, string Sentido,
                            string Hex, string Texto);

/// <summary>
/// EL DIARIO DE BYTES, que es lo que de verdad se depura.
///
/// Cuando un lector «no funciona» la pregunta nunca es qué pensaba el programa: es qué bytes
/// salieron y en qué orden. Por eso se guarda el crudo en hexadecimal y, al lado, su lectura
/// imprimible — con los no imprimibles como `·`, porque un `0x1D` pintado como carácter no se ve
/// y es justo el que importa (el separador de GS1).
///
/// Es un anillo: en una tarde de pruebas caben miles de tramas y no hay ninguna razón para
/// guardarlas todas. Y es seguro entre hilos porque escriben los transportes —uno por conexión— y
/// lee la pantalla.
/// </summary>
public sealed class Diario(int capacidad = 500)
{
    private readonly Queue<Apunte> apuntes = new();
    private readonly Lock cerrojo = new();
    private long siguiente;

    /// <summary>Se dispara con cada apunte: la pantalla se suscribe y pinta en vivo.</summary>
    public event Action<Apunte>? Anotado;

    public void Anotar(string dispositivo, string sentido, ReadOnlySpan<byte> bytes)
    {
        Apunte apunte;
        lock (cerrojo)
        {
            apunte = new Apunte(++siguiente,
                DateTime.Now.ToString("HH:mm:ss.fff"), dispositivo, sentido,
                Convert.ToHexString(bytes), Imprimible(bytes));
            apuntes.Enqueue(apunte);
            while (apuntes.Count > capacidad) apuntes.Dequeue();
        }
        Anotado?.Invoke(apunte);
    }

    public IReadOnlyList<Apunte> Ultimos(int cuantos = 100)
    {
        lock (cerrojo) return apuntes.TakeLast(cuantos).ToList();
    }

    public void Vaciar()
    {
        lock (cerrojo) apuntes.Clear();
    }

    /// <summary>
    /// El crudo en legible. Los caracteres de control se marcan con `·` PORQUE SON LOS QUE
    /// IMPORTAN: el `0x1D` de GS1, el CR del sufijo, el ESC del visor. Verlos como un hueco es
    /// verlos; pintarlos «tal cual» es perderlos.
    /// </summary>
    private static string Imprimible(ReadOnlySpan<byte> bytes)
    {
        var sb = new StringBuilder(bytes.Length);
        foreach (var b in bytes) sb.Append(b is >= 0x20 and < 0x7F ? (char)b : '·');
        return sb.ToString();
    }
}
