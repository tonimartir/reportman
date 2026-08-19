# Emulador de dispositivos del TPV

Los aparatos que un punto de venta espera encontrar en el mostrador, sin tenerlos delante: lector
de códigos, Magellan (lector **y** balanza), balanza, visor de cliente, visor de segunda pantalla e
impresora. Cada uno escuchando en su puerto, y una rejilla web donde están **todos a la vez**, con
sus acciones, sus ajustes y el diario de bytes.

```
dotnet run --project tools/DeviceEmulator
```

| Aparato | Puerto | Qué habla |
|---|---|---|
| Lector de códigos | 9201 | prefijo + datos + sufijo, con identificador AIM opcional |
| Lector de teclado (HID) | — | **sin cable**: teclea en el Chrome del TPV por CDP (`--remote-debugging-port=9222`) |
| Magellan 9800i | 9202 | `S08`+simbología+código · `S11`+peso · `S00`→`S01` · `E`/`D` |
| Balanza | 9203 | pregunta `$` (Baxtran P71) o `W` (Toledo 9550); STX … peso … CR, `!` si es inestable |
| Visor de cliente | 9204 | `ESC [ 2 J`, `ESC [ Py ; Px H`, texto cp1252; y `US $ columna fila` en el modelo 3 (Epson DM‑D) |
| Visor de segunda pantalla | 9205 | protocolo propio, en texto claro (ver la clase) |
| Impresora de tiques | 9206 | ESC/POS: cuenta y traduce; **el papel lo pinta `escpos-emulator`** |

Opciones: `--puerto` (rejilla, 8080) · `--<aparato> <n>` · `--<aparato>-serie COM3` · `--baudios`
· `--solo lector,magellan` · `--sin-navegador`. Con `--help`, la lista entera.

## Por qué está hecho así

**Todo en uno, y no por comodidad.** El Magellan 9800i *es* lector y balanza en el mismo puerto con
las dos tramas mezcladas: separarlos haría imposible emular con fidelidad justo el aparato que más
importa.

**Un protocolo, varios transportes.** El dispositivo no sabe de sockets y el transporte no sabe de
tramas. Es como está hecho nt2, donde `SerialConfiguration` lleva dentro `HostName` y
`HostPortNumber` — serie y serie‑por‑red son el mismo protocolo con distinto cable, que es lo que
hace un conversor serie‑LAN. Y los cables son **varios a la vez**: TCP siempre, y además un COM si
se le da uno, para no tener que reiniciar al cambiar de camino.

**Corre sin pantalla.** El objetivo no es mirar tramas bonitas: es que una prueba pueda decir
«escanea este código» y comprobar el ticket que sale al otro lado. Por eso los aparatos son
biblioteca antes que interfaz, y por eso la pantalla es HTML plano sin npm.

**La pantalla no conoce a ningún aparato.** Pinta lo que cada uno declara en `Acciones` y
`Ajustes`; los ajustes de sólo lectura se pintan como pantalla verde sobre negro, que es lo que
hace útil la ficha de un visor. Añadir un aparato es añadir un fichero.

## Añadir un aparato

Un fichero en `Dispositivos/` que implemente `IDispositivo` (ver `Nucleo/Contratos.cs`) y una línea
en `Program.cs`. Nada más: ni pantalla, ni API, ni transporte.

## Lo que no hace, y por qué

**No pinta el tique.** Eso es `escpos-emulator`, en el 9100, que interpreta ESC/POS con el motor
delante y saca PDF, PNG y `.rpmf`. Absorberlo aquí arrastraría Skia, ICU y FreeType a una
herramienta cuya gracia es arrancar en cualquier máquina y dentro del CI. Lo que sí aporta la
tarjeta de la impresora es que **el tique aparece en el mismo diario que el escaneo que lo
provocó**.

**No crea puertos serie virtuales.** Si hay un par montado (com0com o equivalente), se le apunta
con `--<aparato>-serie COM3` y la prueba es indistinguible de un aparato real; si no lo hay, todo
funciona por red. El driver de kernel no se exige porque no vale para CI.

## Probarlo

```
dotnet run --project tests/DeviceEmulatorTest
```

45 comprobaciones: levanta el emulador en proceso, se conecta con un `TcpClient` haciendo de TPV y
manda las órdenes por la misma API que usa la rejilla.

Del **lector de teclado** sólo se comprueba aquí el armazón y el fallo dicho en voz alta (un puesto
sin cable, y el motivo cuando no hay Chrome de depuración): teclear de verdad necesita un navegador,
y eso se hace a mano. Ver su clase.
