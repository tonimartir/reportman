export interface Variant {
  type: VariantType;
  value: any;
}

export enum VariantType {
  /** Null value type */
  Null = "Null",

  /** Internally stores a byte value */
  Byte = "Byte",

  /** Internally stores a boolean value */
  Boolean = "Boolean",

  /** Internally stores a byte Char */
  Char = "Char",

  /** Internally stores an integer value */
  Integer = "Integer",

  /** Internally stores a string value */
  String = "String",

  /** Internally stores a double value */
  Double = "Double",

  /** Internally stores a decimal value */
  Decimal = "Decimal",

  /** Internally stores a DateTime value */
  DateTime = "DateTime",

  /** Internally stores a binary byte[] value */
  Binary = "Binary",

  /** Internally stores a long value */
  Long = "Long",
}
