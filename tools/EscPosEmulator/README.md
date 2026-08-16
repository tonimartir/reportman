# escpos-emulator — la impresora de tiques que no existe

Un emulador de impresora de red **ESC/POS** (y del subconjunto **ESC/P** que emiten los drivers de
texto de Reportman) que pinta con el propio motor: los bytes se interpretan a un `MetaFile` y de ahí
salen el **PDF** (`PrintOutPDFFreeType`), el **PNG** (`PrintOutBitmapSkia`, nuevo, SkiaSharp) y el
**`.rpmf`** que abre la vista previa. Con un diario de todo lo que no es texto: cortes, cajón, QR y
códigos de barras, páginas de códigos, imágenes y los comandos que no entiende.

Sirve para probar el TPV de ReportmanFiscal —o cualquier salida `PrintOutText`— **sin una térmica
delante**, en Windows y en Linux.

## Uso

```bash
# como impresora de red (0.0.0.0:9100), un fichero por tique en ./salida
dotnet run --project tools/EscPosEmulator

# con opciones
dotnet run --project tools/EscPosEmulator -- --port 9100 --out C:\tiques --paper 80 --dpi 203 --font Consolas --show

# un fichero de bytes (por ejemplo el que deja Terminal:Impresora:Transporte = "fichero")
dotnet run --project tools/EscPosEmulator -- --file tique.escpos --out ./salida
```

| Opción | Por defecto | Qué es |
|---|---|---|
| `--port` | 9100 | Puerto TCP (el de las impresoras de red) |
| `--out` | `salida` | Carpeta de salida (`nombre.pdf`, `.png`, `.rpmf`, `.log`) |
| `--file` | — | Interpreta un fichero y sale, en vez de escuchar |
| `--paper` | 80 | Ancho del papel en mm (80 = 576 puntos, 58 = 384) |
| `--dpi` | 203 | Resolución del cabezal (TM-T88 y clones 203; algunos 180) |
| `--codepage` | 850 | Página de códigos con la que arranca (Epson de fábrica 437; Reportman escribe cp850) |
| `--font` | Consolas / DejaVu Sans Mono | Familia monoespaciada con la que se pinta |
| `--mode` | escpos | `escp` cambia las unidades de `ESC 3` (1/216") y `ESC $` (1/60") a las matriciales |
| `--idle` | 800 | ms sin datos que cierran un trabajo en una conexión que sigue abierta |
| `--no-pdf` `--no-png` `--no-rpmf` | | Qué no generar |
| `--show` | | Abre el PDF (o el PNG) de cada trabajo |

Con ReportmanFiscal: en `terminal.json`, `"Impresora": { "Modo": "directa", "Transporte": "tcp",
"Host": "127.0.0.1", "Puerto": 9100 }` y el TPV imprime aquí.

## Qué interpreta

- Texto con la página de códigos vigente (`ESC t n`: 437, 850, 858, 852, 866, 1252…), `LF`, `HT`,
  `CR` (ignorado, como la TM), `FF` (corte), `CAN`.
- Estilos: `ESC !` (maestro: fuente A/B, negrita, doble alto/ancho, subrayado), `ESC E/F/G/H`,
  `ESC -`, `ESC 4/5`, `ESC r` (rojo), `SO/DC4` (doble ancho una línea), `SI/DC2` (condensada),
  `ESC P/M/g` (10/12/15 cpi), `ESC W/w`, `GS !` (multiplicadores), `GS B` (inverso).
- Posición: `ESC a` (alineación), `ESC 2/0/1/3/A/+` (interlineado), `ESC J/d` (avances),
  `ESC $` y `ESC \` (posición horizontal), `ESC D` (tabuladores), `GS L` / `GS W` (margen y área).
- Corte: `ESC m`, `ESC i`, `GS V m [n]`, `FF` → cierra la página y abre la siguiente con el
  primer contenido (la página tras el último corte, con solo reset y cajón, no se genera).
- Cajón: `ESC p m t1 t2` → al diario, con conector y tiempos.
- QR: `GS ( k` (modelo, módulo, ECC, almacenar, imprimir) → los módulos como rectángulos (ZXing,
  como `BarcodeItem`), con el tamaño en mm en el diario. 1D: `GS k` (UPC-A/E, EAN-13/8, CODE39,
  ITF, CODABAR, CODE93, CODE128) con `GS h`/`GS w`.
- Imágenes: `GS v 0` (ráster), `ESC *`, `ESC K/L/Y/Z` (matricial por columnas), `GS *` + `GS /`
  (imagen descargada). Los logos NV (`FS p`) y `GS ( L` no se pintan: se dibuja un hueco y se apunta.
- Estado: `DLE EOT n` se contesta con `0x12` (en línea, sin errores) para que el cliente no se
  quede colgado; `GS r/I/a` se apuntan.

Lo que no entiende no rompe nada: se salta y se anota en el `.log` con su offset.

## Cómo pinta

Un renglón es un objeto de texto por tramo de estilo, colocado por columnas (12 puntos la fuente A,
9 la B, por el multiplicador de anchura) y con el tamaño de letra sacado del **alto** de la celda
(24 ó 17 puntos), que es como se comporta la impresora: ensanchar no baja el renglón. A doble
ancho el glifo no se estira —el metafile no sabe— sino que se **espacia** carácter a carácter en su
celda. La página mide lo que se imprimió: es un rollo. El resultado no es la térmica al píxel; es
lo bastante fiel para ver que el tique dice lo que tiene que decir, que el QR mide lo que manda la
norma, y que el corte y el cajón llegan donde deben.
