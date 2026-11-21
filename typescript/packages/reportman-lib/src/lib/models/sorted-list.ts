// Map para emular SortedList de C#
export class SortedList<K, V> extends Map<K, V> {
  public Values(): V[] {
    return Array.from(this.values());
  }
  public Keys(): K[] {
    return Array.from(this.keys());
  }
  public IndexOfValue(value: V): number {
    const values = this.Values();
    return values.indexOf(value);
  }
}
