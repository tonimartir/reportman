// The PostgreSQL types as Npgsql 10 reads them: for each type OID, the DataTypeName Npgsql shows in
// GetSchemaTable and how its values are read. The built-in types are known by OID; any other type
// (arrays, enums, ranges, extension types...) is looked up in pg_type the first time a result has
// it, as Npgsql loads the type catalog.

/** How the values of a type are read (the .NET type Npgsql gives, see values.ts). */
export type ValueKind =
  | 'int2'
  | 'int4'
  | 'int8'
  | 'float4'
  | 'float8'
  | 'numeric'
  | 'money'
  | 'bool'
  | 'text'
  | 'char1'
  | 'bytea'
  | 'date'
  | 'time'
  | 'timetz'
  | 'timestamp'
  | 'timestamptz'
  | 'interval'
  | 'uuid'
  | 'inet'
  | 'cidr'
  | 'macaddr'
  | 'bit'
  | 'varbit'
  | 'geometry'
  | 'cube'
  | 'range'
  | 'multirange'
  | 'array'
  | 'int2vector'
  | 'oidvector'
  | 'tsvector'
  | 'tsquery'
  | 'uint32'
  | 'uint64'
  | 'regtype'
  | 'pg_lsn'
  | 'tid'
  | 'record'
  | 'hstore'
  | 'void'
  | 'domain'
  | 'unsupported';

/** A PostgreSQL type. */
export interface PgType {
  oid: number;
  /** DataTypeName in Npgsql's schema ("integer", "character varying", "public.mood", "text[]"). */
  name: string;
  kind: ValueKind;
  /** The element (array), subtype (range) or range (multirange) type. */
  elem?: number;
  /** The CLR type name of a geometric value (NpgsqlPoint...). */
  clr?: string;
}

/** A built-in type: OID, DataTypeName, how it is read, its element / subtype and geometric CLR type. */
function B(oid: number, name: string, kind: ValueKind, elem?: number, clr?: string): PgType {
  const t: PgType = { oid, name, kind };
  if (elem !== undefined) t.elem = elem;
  if (clr !== undefined) t.clr = clr;
  return t;
}

/** The built-in types (their OIDs are fixed in every PostgreSQL version). */
const BUILTIN: PgType[] = [
  B(16, 'boolean', 'bool'),
  B(17, 'bytea', 'bytea'),
  B(18, 'char', 'char1'),
  B(19, 'name', 'text'),
  B(20, 'bigint', 'int8'),
  B(21, 'smallint', 'int2'),
  B(22, 'int2vector', 'int2vector'),
  B(23, 'integer', 'int4'),
  B(24, 'regproc', 'unsupported'),
  B(25, 'text', 'text'),
  B(26, 'oid', 'uint32'),
  B(27, 'tid', 'tid'),
  B(28, 'xid', 'uint32'),
  B(29, 'cid', 'uint32'),
  B(30, 'oidvector', 'oidvector'),
  B(114, 'json', 'text'),
  B(142, 'xml', 'text'),
  B(194, 'pg_node_tree', 'unsupported'),
  B(600, 'point', 'geometry', undefined, 'NpgsqlTypes.NpgsqlPoint'),
  B(601, 'lseg', 'geometry', undefined, 'NpgsqlTypes.NpgsqlLSeg'),
  B(602, 'path', 'geometry', undefined, 'NpgsqlTypes.NpgsqlPath'),
  B(603, 'box', 'geometry', undefined, 'NpgsqlTypes.NpgsqlBox'),
  B(604, 'polygon', 'geometry', undefined, 'NpgsqlTypes.NpgsqlPolygon'),
  B(628, 'line', 'geometry', undefined, 'NpgsqlTypes.NpgsqlLine'),
  B(650, 'cidr', 'cidr'),
  B(700, 'real', 'float4'),
  B(701, 'double precision', 'float8'),
  B(705, 'unknown', 'text'),
  B(718, 'circle', 'geometry', undefined, 'NpgsqlTypes.NpgsqlCircle'),
  B(774, 'macaddr8', 'macaddr'),
  B(790, 'money', 'money'),
  B(829, 'macaddr', 'macaddr'),
  B(869, 'inet', 'inet'),
  B(1033, 'aclitem', 'unsupported'),
  B(1042, 'character', 'text'),
  B(1043, 'character varying', 'text'),
  B(1082, 'date', 'date'),
  B(1083, 'time without time zone', 'time'),
  B(1114, 'timestamp without time zone', 'timestamp'),
  B(1184, 'timestamp with time zone', 'timestamptz'),
  B(1186, 'interval', 'interval'),
  B(1266, 'time with time zone', 'timetz'),
  B(1560, 'bit', 'bit'),
  B(1562, 'bit varying', 'varbit'),
  B(1700, 'numeric', 'numeric'),
  B(1790, 'refcursor', 'text'),
  B(2202, 'regprocedure', 'unsupported'),
  B(2203, 'regoper', 'unsupported'),
  B(2204, 'regoperator', 'unsupported'),
  B(2205, 'regclass', 'unsupported'),
  B(2206, 'regtype', 'regtype'),
  B(2249, 'record', 'record'),
  B(2275, 'cstring', 'unsupported'),
  B(2278, 'void', 'void'),
  B(2950, 'uuid', 'uuid'),
  B(2970, 'txid_snapshot', 'unsupported'),
  B(3220, 'pg_lsn', 'pg_lsn'),
  B(3614, 'tsvector', 'tsvector'),
  B(3615, 'tsquery', 'tsquery'),
  B(3642, 'gtsvector', 'unsupported'),
  B(3734, 'regconfig', 'unsupported'),
  B(3769, 'regdictionary', 'unsupported'),
  B(3802, 'jsonb', 'text'),
  B(3904, 'int4range', 'range', 23),
  B(3906, 'numrange', 'range', 1700),
  B(3908, 'tsrange', 'range', 1114),
  B(3910, 'tstzrange', 'range', 1184),
  B(3912, 'daterange', 'range', 1082),
  B(3926, 'int8range', 'range', 20),
  B(4072, 'jsonpath', 'text'),
  B(4089, 'regnamespace', 'unsupported'),
  B(4096, 'regrole', 'unsupported'),
  B(4191, 'regcollation', 'unsupported'),
  B(4451, 'int4multirange', 'multirange', 3904),
  B(4532, 'nummultirange', 'multirange', 3906),
  B(4533, 'tsmultirange', 'multirange', 3908),
  B(4534, 'tstzmultirange', 'multirange', 3910),
  B(4535, 'datemultirange', 'multirange', 3912),
  B(4536, 'int8multirange', 'multirange', 3926),
  B(5038, 'pg_snapshot', 'unsupported'),
  B(5069, 'xid8', 'uint64'),
];

/** The types of a connection: the built-in ones and those loaded from pg_type. */
export class TypeCatalog {
  private readonly types = new Map<number, PgType>();

  constructor() {
    for (const t of BUILTIN) this.types.set(t.oid, t);
  }

  get(oid: number): PgType | undefined {
    return this.types.get(oid);
  }

  /** The OIDs among these (and their element types) that are not known yet. */
  missing(oids: Iterable<number>): number[] {
    const out = new Set<number>();
    const visit = (oid: number): void => {
      const t = this.types.get(oid);
      if (t === undefined) out.add(oid);
      else if (t.elem !== undefined) visit(t.elem);
    };
    for (const oid of oids) visit(oid);
    return [...out];
  }

  /** Adds the types read from pg_type (see CATALOG_QUERY). */
  add(rows: readonly CatalogRow[]): void {
    for (const r of rows) this.types.set(r.oid, typeOfCatalogRow(r));
  }
}

/** A row of CATALOG_QUERY. */
export interface CatalogRow {
  oid: number;
  typname: string;
  nspname: string;
  /** typtype: b base, c composite, d domain, e enum, p pseudo, r range, m multirange. */
  typtype: string;
  typcategory: string;
  typelem: number;
  typbasetype: number;
  /** pg_range.rngsubtype of a range, the range of a multirange. */
  rangeElem: number;
}

/**
 * The types of some OIDs. $1 is an int8[] of OIDs; the multirange join needs PostgreSQL 14
 * (MULTIRANGE_JOIN is left out before).
 */
export function catalogQuery(multiranges: boolean): string {
  return (
    'SELECT t.oid::int8, t.typname::text, n.nspname::text, t.typtype::text, t.typcategory::text, t.typelem::int8, ' +
    't.typbasetype::int8, COALESCE(r.rngsubtype' +
    (multiranges ? ', mr.rngtypid' : '') +
    ', 0)::int8 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace ' +
    'LEFT JOIN pg_catalog.pg_range r ON r.rngtypid = t.oid ' +
    (multiranges ? 'LEFT JOIN pg_catalog.pg_range mr ON mr.rngmultitypid = t.oid ' : '') +
    'WHERE t.oid = ANY($1::int8[]::oid[])'
  );
}

/** Npgsql's name of a type: pg_catalog types by name, the others qualified by their schema. */
function qualified(r: CatalogRow): string {
  return r.nspname === 'pg_catalog' ? r.typname : r.nspname + '.' + r.typname;
}

/** Extension types Npgsql reads by name (in any schema). */
const EXTENSION_KINDS: Record<string, ValueKind> = {
  citext: 'text',
  ltree: 'text',
  lquery: 'text',
  ltxtquery: 'text',
  hstore: 'hstore',
  cube: 'cube',
};

function typeOfCatalogRow(r: CatalogRow): PgType {
  const name = qualified(r);
  switch (r.typtype) {
    case 'e':
      return { oid: r.oid, name, kind: 'text' };
    case 'r':
      return { oid: r.oid, name, kind: 'range', elem: r.rangeElem };
    case 'm':
      return { oid: r.oid, name, kind: 'multirange', elem: r.rangeElem };
    case 'd':
      // RowDescription gives the base type of a domain; a domain here is read as its base type
      return { oid: r.oid, name, kind: 'domain', elem: r.typbasetype };
  }
  if (r.typtype === 'b' && r.typcategory === 'A' && r.typelem !== 0) return { oid: r.oid, name, kind: 'array', elem: r.typelem };
  if (r.typtype === 'b') {
    const ext = EXTENSION_KINDS[r.typname];
    if (ext !== undefined) return { oid: r.oid, name, kind: ext };
  }
  return { oid: r.oid, name, kind: 'unsupported' };
}

/** DataTypeName of a column: arrays as their element's name followed by []. */
export function dataTypeName(catalog: TypeCatalog, oid: number): string {
  const t = catalog.get(oid);
  if (t === undefined) return '-.-';
  if (t.kind === 'domain') return dataTypeName(catalog, t.elem!);
  if (t.kind === 'array') return dataTypeName(catalog, t.elem!) + '[]';
  return t.name;
}

/** ColumnSize of a column (Npgsql: the length of character types, the bits of bit types). */
export function columnSize(catalog: TypeCatalog, oid: number, typmod: number): number {
  const t = catalog.get(oid);
  if (t === undefined) return -1;
  if (t.kind === 'domain' || t.kind === 'array') return columnSize(catalog, t.elem!, typmod);
  if (typmod < 0) return -1;
  if (t.oid === 1042 || t.oid === 1043) return typmod - 4;
  if (t.kind === 'bit' || t.kind === 'varbit') return typmod;
  return -1;
}
