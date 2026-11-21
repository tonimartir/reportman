// What the host gives the TrueType provider: the font files, read on demand. The core does no I/O:
// a Node host reads them from the system font folders (reportman-node), a browser host from what
// it fetched.

/** A font file: where it is and its bytes, read on demand. */
export interface FontFileSource {
  /**
   * The full path of the file. It names the face in the PDF writer ("path|faceIndex") and, as in
   * the C# engine, a "Bold" or "Italic" in it marks the style of a face that does not say it.
   */
  readonly path: string;
  /** Reads `length` bytes at `offset` (fewer, or none, past the end of the file). */
  read(offset: number, length: number): Uint8Array;
  /** The whole file. */
  readAll(): Uint8Array;
}

/** A font file whose bytes are already in memory. */
export function memoryFontFile(path: string, bytes: Uint8Array): FontFileSource {
  return {
    path,
    read: (offset, length) => bytes.subarray(Math.min(offset, bytes.length), Math.min(offset + length, bytes.length)),
    readAll: () => bytes,
  };
}

/** The platform whose family names and font folders the provider follows. */
export type FontPlatform = 'windows' | 'unix' | 'macos';
