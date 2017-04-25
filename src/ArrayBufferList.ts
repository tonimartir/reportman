export class ArrayBufferList {
    private buffers: { [id: number]: ArrayBuffer } = {};
    private totalLength: number = 0;
    public getBuffer(id: number): ArrayBuffer {
        const result: ArrayBuffer = this.buffers[id];
        if (this.buffers === undefined)
            throw Error("Buffer number not found in metafile: " + id.toString());
        return result;
    }
    public clear(): void {
        this.buffers = {};
    }
    public addBuffer(buf: ArrayBuffer): number {
        const position = this.totalLength;
        this.setBuffer(buf, this.totalLength);
        this.totalLength = this.totalLength + buf.byteLength;
        return position;
    }
    private setBuffer(buf: ArrayBuffer, id: number): void {
        this.buffers[id] = buf;
    }
}
