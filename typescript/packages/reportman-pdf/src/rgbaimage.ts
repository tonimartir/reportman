// A decoded image in the form the C# engine reads it from SkiaSharp (SKBitmap.Decode and its
// Pixels): 8 bit RGBA, unpremultiplied, rows top down.

/** A decoded image: width x height pixels of 4 bytes (R, G, B, A), unpremultiplied, top down. */
export interface RgbaImage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

let roundTrip: Uint8Array | null = null;

/**
 * The value of a color component after SkiaSharp keeps it premultiplied and gives it back:
 * SKBitmap.Decode decodes a translucent image premultiplied ((c * a + 127) / 255, rounded) and
 * Pixels unpremultiplies it with SkUnPreMultiply (a 24 bit fixed point scale, round(255 * 2^24 / a)),
 * so a translucent pixel loses precision and a transparent one becomes black.
 */
export function skiaRoundTrip(c: number, a: number): number {
  if (roundTrip === null) {
    const t = new Uint8Array(65536);
    for (let alpha = 1; alpha < 256; alpha++) {
      const scale = Math.round(4278190080 / alpha);
      for (let comp = 0; comp < 256; comp++) {
        const premul = Math.floor((comp * alpha + 127) / 255);
        t[(alpha << 8) | comp] = Math.floor((scale * premul + 8388608) / 16777216);
      }
    }
    roundTrip = t;
  }
  return roundTrip[((a & 0xff) << 8) | (c & 0xff)] as number;
}
