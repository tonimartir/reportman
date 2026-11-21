/**
 * A growable byte buffer, the MemoryStream the C# engine writes to (append only, with a read of
 * any range). Used for the image streams of the pages and by the PDF writer.
 */
export class ByteBuffer {
  private buf: Uint8Array;
  private len = 0;

  constructor(capacity = 256) {
    this.buf = new Uint8Array(Math.max(16, capacity));
  }

  /** Number of bytes written. */
  get length(): number {
    return this.len;
  }

  private ensure(extra: number): void {
    const needed = this.len + extra;
    if (needed <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < needed) cap *= 2;
    const n = new Uint8Array(cap);
    n.set(this.buf.subarray(0, this.len));
    this.buf = n;
  }

  /** Appends bytes. */
  write(bytes: Uint8Array, offset = 0, count = bytes.length - offset): void {
    this.ensure(count);
    this.buf.set(bytes.subarray(offset, offset + count), this.len);
    this.len += count;
  }

  /** Appends one byte. */
  writeByte(b: number): void {
    this.ensure(1);
    this.buf[this.len++] = b & 0xff;
  }

  /**
   * Appends a string as single byte characters: the low byte of each UTF-16 code unit, as the
   * C# StreamUtil.SWriteLine does with (byte)astring[i].
   */
  writeLatin1(text: string): void {
    this.ensure(text.length);
    for (let i = 0; i < text.length; i++) this.buf[this.len++] = text.charCodeAt(i) & 0xff;
  }

  /** Overwrites bytes at a position inside the written data (or extends it). */
  writeAt(position: number, bytes: Uint8Array): void {
    const end = position + bytes.length;
    if (end > this.len) {
      this.ensure(end - this.len);
      this.len = end;
    }
    this.buf.set(bytes, position);
  }

  /** Truncates (only to 0 or a smaller length, like MemoryStream.SetLength used by the engine). */
  setLength(length: number): void {
    if (length < 0) throw new RangeError('Negative length');
    if (length > this.len) {
      this.ensure(length - this.len);
      this.buf.fill(0, this.len, length);
    }
    this.len = length;
  }

  /** A copy of the bytes in [start, start + count). Reading past the end throws. */
  read(start: number, count: number): Uint8Array {
    if (start < 0 || count < 0 || start + count > this.len)
      throw new RangeError('Read outside the stream');
    return this.buf.slice(start, start + count);
  }

  /** A view of the written bytes (valid until the next write). */
  view(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }

  /** A copy of the written bytes. */
  toUint8Array(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}
