const collator = new Intl.Collator('en-US');

/** The comparison of a SortedList with string keys in C# (the culture of the thread, en-US). */
export function compareCulture(a: string, b: string): number {
  return collator.compare(a, b);
}

/**
 * A map whose keys keep the order of a C# SortedList with string keys (the culture of the thread,
 * en-US): the font data of a canvas, written to the PDF in that order.
 */
export class CultureSortedMap<V> {
  private readonly map = new Map<string, V>();
  private readonly sortedKeys: string[] = [];

  get size(): number {
    return this.map.size;
  }

  get(key: string): V | undefined {
    return this.map.get(key);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  /** Adds an entry; fails when the key is there (SortedList.Add). */
  add(key: string, value: V): void {
    if (this.map.has(key)) throw new Error("Item has already been added. Key in dictionary: '" + key + "'");
    this.map.set(key, value);
    let lo = 0;
    let hi = this.sortedKeys.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (compareCulture(this.sortedKeys[mid] as string, key) < 0) lo = mid + 1;
      else hi = mid;
    }
    this.sortedKeys.splice(lo, 0, key);
  }

  /** The value at a position of the sorted keys (GetByIndex). */
  getByIndex(index: number): V {
    return this.map.get(this.sortedKeys[index] as string) as V;
  }

  /** The keys in order. */
  keys(): readonly string[] {
    return this.sortedKeys;
  }

  /** The values in the order of the keys. */
  values(): V[] {
    return this.sortedKeys.map((k) => this.map.get(k) as V);
  }

  clear(): void {
    this.map.clear();
    this.sortedKeys.length = 0;
  }
}
