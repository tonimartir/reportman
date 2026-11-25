export class Texto {
  /** CR+LF and CR become LF, so the SQL editor and the engine see the same text. */
  public static normalizarSaltosLinea(input: string): string {
    if (!input) return '';
    return input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }
}
