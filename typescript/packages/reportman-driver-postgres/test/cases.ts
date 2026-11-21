// The parity cases of the PostgreSQL driver: the sample reports and synthetic reports run by
// golden-cs (C# engine, Npgsql 10) and by the TypeScript engine (pg) on the same database.
// generate-fixtures.ts writes the synthetic reports and the C# results into fixtures/; the
// tests compare with them.

import fs from 'node:fs';
import path from 'node:path';
import { ALL_TYPES_COLUMNS, repoRoot } from './fixture.ts';
import { database, datainfo, delphiDate, detail, expr, listReport, param, report, subreport } from './reports.ts';

export interface PgCase {
  name: string;
  /** The report: a sample (samples/NAME.rep) or a synthetic report written to fixtures/NAME.rep. */
  report: string;
  /** Parameter values for golden-cs (--param NAME=value) and the TypeScript run (setParameterValue). */
  params?: Record<string, string>;
  culture?: string;
  /** Other report connections opened on the same database (alias). */
  connections?: string[];
  /** The TypeScript run needs a synchronous data host (data read while an expression is evaluated). */
  synchronous?: boolean;
  /**
   * C# fails where the TypeScript driver runs the report: the text the C# error contains, and
   * why (a limitation of Npgsql or the C# engine, not reproduced on purpose).
   */
  knownDifference?: { error: string; why: string };
}

const sample = (name: string): string => 'samples/' + name + '.rep';
const synthetic = (name: string): string => 'synthetic:' + name;

export const CASES: PgCase[] = [
  { name: 'customers', report: sample('customers') },
  { name: 'customers-es', report: sample('customers'), culture: 'es-ES' },
  { name: 'invoices', report: sample('invoices') },
  // golden-cs --param assigns a string (a text parameter in Npgsql): the range is the report's own values
  { name: 'invoices-range', report: synthetic('invoices-range') },
  { name: 'labels', report: sample('labels') },
  { name: 'product-catalog', report: sample('product-catalog') },
  { name: 'monthly-sales', report: sample('monthly-sales') },
  {
    name: 'sales-by-category',
    report: sample('sales-by-category'),
    knownDifference: {
      error: 'A command is already in progress',
      why:
        'Npgsql has no multiple active result sets: the C# engine keeps the reader of the first dataset open while it ' +
        'opens the second one on the same connection. The TypeScript engine reads each result whole.',
    },
  },
  { name: 'fishes', report: sample('fishes') },
  { name: 'pg-types', report: synthetic('pg-types') },
  { name: 'pg-types-es', report: synthetic('pg-types'), culture: 'es-ES' },
  { name: 'pg-params', report: synthetic('pg-params') },
  { name: 'pg-sql', report: synthetic('pg-sql') },
  { name: 'pg-session', report: synthetic('pg-session') },
  { name: 'pg-masterdetail', report: synthetic('pg-masterdetail'), connections: ['MASTERDB'] },
  // GETVALUEFROMSQL: its command inside the implicit transaction, read while an expression is evaluated
  { name: 'pg-getvalue', report: synthetic('pg-getvalue'), synchronous: true },
  {
    name: 'pg-getvalue-dataset',
    report: synthetic('pg-getvalue-dataset'),
    synchronous: true,
    knownDifference: {
      error: 'A command is already in progress',
      why:
        'Npgsql has no multiple active result sets: the C# engine keeps the reader of the dataset being printed open while ' +
        'GETVALUEFROMSQL runs its command on the same connection. The TypeScript engine reads each result whole.',
    },
  },
  { name: 'pg-ondemand', report: synthetic('pg-ondemand'), synchronous: true },
  // A parameter without value (DbType Object, DBNull): PostgreSQL infers its type
  { name: 'pg-nullobject', report: synthetic('pg-nullobject') },
  // Errors: the TypeScript run fails with the same message as C#
  { name: 'err-nan', report: synthetic('err-nan') },
  { name: 'err-infinity', report: synthetic('err-infinity') },
  { name: 'err-scale', report: synthetic('err-scale') },
  { name: 'err-big', report: synthetic('err-big') },
  { name: 'err-months', report: synthetic('err-months') },
  { name: 'err-composite', report: synthetic('err-composite') },
  { name: 'err-regclass', report: synthetic('err-regclass') },
  { name: 'err-noparam', report: synthetic('err-noparam') },
  { name: 'err-exprb', report: synthetic('err-exprb') },
  { name: 'err-unused', report: synthetic('err-unused') },
  { name: 'err-date-bc', report: synthetic('err-date-bc') },
  { name: 'err-timestamp', report: synthetic('err-timestamp') },
  { name: 'err-time24', report: synthetic('err-time24') },
  { name: 'err-timetz', report: synthetic('err-timetz') },
  { name: 'err-arrnull', report: synthetic('err-arrnull') },
  { name: 'err-arrnan', report: synthetic('err-arrnan') },
  { name: 'err-nocols', report: synthetic('err-nocols') },
  { name: 'err-ddl', report: synthetic('err-ddl') },
  { name: 'err-detail', report: synthetic('err-detail') },
  { name: 'err-nullparam', report: synthetic('err-nullparam'), connections: ['MASTERDB'] },
  { name: 'err-dateparam', report: synthetic('err-dateparam'), connections: ['MASTERDB'] },
];

/** A detail section that prints expressions in a grid (n per line), each with its display format. */
function gridDetail(items: (string | [string, string])[], perLine: number): string {
  const width = Math.floor(10700 / perLine);
  const lineHeight = 190;
  const comps = items.map((item, i) => {
    const [e, format] = typeof item === 'string' ? [item, ''] : item;
    return expr(e, {
      POSX: (i % perLine) * width, POSY: Math.floor(i / perLine) * lineHeight, WIDTH: width - 40, HEIGHT: lineHeight, FONTSIZE: 6, DISPLAYFORMAT: format,
    });
  });
  return detail(comps, Math.ceil(items.length / perLine) * lineHeight + 120);
}

/** The name of a column and its value (dates with their fraction of second). */
const printed = (column: string, type: string): (string | [string, string])[] => {
  const c = 'D.' + column.toUpperCase();
  if (/^(date|time|timetz|time\(3\)|timestamp|timestamptz)$/.test(type)) return ["'" + column + "'", [c, 'yyyy-MM-dd HH:mm:ss.fffffff']];
  return ["'" + column + "'", c];
};

/** The synthetic reports, by name. */
export function syntheticReports(): Record<string, string> {
  const out: Record<string, string> = {};
  const errorReport = (sql: string, params: string[] = []): string => listReport(sql, ['D.A'], { params });
  const masterdb = database({ ALIAS: 'MASTERDB', NAME: 'TRpDatabaseInfoItem1' });

  // Every column of all_types, with its values on the four rows
  // Not printed: a bytea (Type conversion error in both engines; fishes prints images) and the
  // "char" column, whose NUL character the C# metafile pool takes for the empty string (its
  // SortedList compares with the culture). types.test.ts checks both values.
  const columns = ALL_TYPES_COLUMNS.filter(([n]) => n !== 'c_bytea' && n !== 'c_char1').flatMap(([n, t]) => printed(n, t));
  // invoices.rep printing the orders 7 to 9
  out['invoices-range'] = fs
    .readFileSync(path.join(repoRoot, 'samples/invoices.rep'), 'latin1')
    .replace('<VALUE type="Integer">1</VALUE>', '<VALUE type="Integer">7</VALUE>')
    .replace('<VALUE type="Integer">4</VALUE>', '<VALUE type="Integer">9</VALUE>');

  out['pg-types'] = report({
    data: [datainfo('D', 'SELECT * FROM all_types ORDER BY id')],
    subs: [subreport('D', [gridDetail(["'id'", 'D.ID', ...columns], 8)])],
  });

  // The parameters of each type, as PostgreSQL receives them
  const typed: [string, number, string | number | boolean | { date: number }][] = [
    ['PSTR', 0, 'abc'],
    ['PINT', 1, 7],
    ['PDBL', 2, 21.5],
    ['PDATE', 3, delphiDate(2024, 2, 1)],
    ['PTIME', 4, delphiDate(1899, 12, 30, 9, 45, 30)],
    ['PDT', 5, delphiDate(2025, 6, 15, 18, 30, 0)],
    ['PCUR', 6, 1234.5],
    ['PBOOL', 7, true],
    ['PEXSTR', 8, "'x'+'y'"],
    ['PINDEC', 15, '1.5'],
    ['PINLONG', 15, 'INT(12345678901)'],
    ['PLIST', 11, "'France'"],
  ];
  const sel = typed.map(([n]) => `pg_typeof(:${n})::text AS T_${n}, (:${n})::text AS V_${n}`).join(', ');
  out['pg-params'] = report({
    data: [datainfo('D', 'SELECT ' + sel + ', :PINT + 1 AS SUM1, @pdbl * 2 AS DBL2')],
    params: typed.map(([n, t, v]) => param(n, t, v, { DATASETS: ['D'] })),
    subs: [
      subreport('D', [
        gridDetail([...typed.flatMap(([n]) => [`'${n}'`, `D.T_${n}`, `D.V_${n}`]), "'sum'", 'D.SUM1', 'D.SUM1', "'dbl'", 'D.DBL2', 'D.DBL2'], 6),
      ]),
    ],
  });

  // Npgsql's SQL rewriting: several statements, placeholders in literals and comments left alone
  out['pg-sql'] = report({
    data: [
      datainfo(
        'D',
        "SET LOCAL work_mem = '4MB'; SELECT ':P' AS S1, $$:P;$$ AS S2, E'\\':P' AS S3, \"customer_id\"::text AS S4, " +
          '/* :P */ :P::text || @p AS S5, ARRAY[:P, :P] AS S6, (SELECT count(*) FROM customers WHERE customer_id < :N) AS S7 -- :P\n' +
          'FROM customers WHERE customer_id = :N; SELECT 2 AS IGNORED',
      ),
    ],
    params: [param('P', 0, 'v', { DATASETS: ['D'] }), param('N', 1, 3, { DATASETS: ['D'] })],
    subs: [subreport('D', [gridDetail(['D.S1', 'D.S2', 'D.S3', 'D.S4', 'D.S5', 'D.S6', 'D.S7'], 4)])],
  });

  // The session: isolation level of the implicit transaction, the date and float settings
  out['pg-session'] = listReport(
    "SELECT current_setting('transaction_isolation') AS A, current_setting('DateStyle') AS B, current_setting('IntervalStyle') AS C, " +
      "'01/02/2024'::date AS D, (0.1::float8 + 0.2::float8) AS E, 1e300::float8 * 10 AS F",
    ['D.A', 'D.B', 'D.C', "FORMATSTR('yyyy-mm-dd', D.D)", 'D.E', 'D.F'],
  );

  // Master / detail on two connections (Npgsql runs one command at a time per connection)
  out['pg-masterdetail'] = report({
    databases: [database(), masterdb],
    data: [
      datainfo('M', 'SELECT order_id, order_number, order_date, vat_rate FROM orders WHERE order_id <= 4 ORDER BY order_id', {
        DATABASEALIAS: 'MASTERDB',
      }),
      datainfo('L', 'SELECT line_no, quantity, unit_price, quantity * unit_price AS amount FROM order_lines WHERE order_id = :ORDER_ID ORDER BY line_no', {
        DATASOURCE: 'M',
      }),
    ],
    params: [param('ORDER_ID', 1, 0, { VISIBLE: false, DATASETS: ['L'] })],
    subs: [
      subreport(
        'M',
        [
          detail(
            [expr('M.ORDER_NUMBER', { WIDTH: 2000 }), expr("FORMATSTR('dd/mm/yyyy', M.ORDER_DATE)", { POSX: 2100 }), expr('M.VAT_RATE', { POSX: 3700 })],
            300,
            { CHILDSUBREPORT: 'TRPSUBREPORTL' },
          ),
        ],
        { NAME: 'TRpSubReportM' },
      ),
      subreport(
        'L',
        [detail([expr('L.LINE_NO'), expr('L.QUANTITY', { POSX: 1500 }), expr('L.UNIT_PRICE', { POSX: 3000 }), expr('L.AMOUNT', { POSX: 4500 })])],
        { NAME: 'TRpSubReportL', PARENTSUBREPORT: 'TRpSubReportM' },
      ),
    ],
  });

  out['pg-getvalue'] = report({
    data: [],
    subs: [subreport('', [detail([expr("GETVALUEFROMSQL('SAMPLES','SELECT COUNT(*) FROM customers')", { WIDTH: 3000 })])])],
  });
  // GETVALUEFROMSQL while the dataset being printed is open
  out['pg-getvalue-dataset'] = report({
    data: [datainfo('ORD', 'SELECT order_id FROM orders WHERE order_id < 3 ORDER BY order_id')],
    subs: [
      subreport('ORD', [
        detail([expr('ORD.ORDER_ID', { WIDTH: 1000 }), expr("GETVALUEFROMSQL('SAMPLES','SELECT COUNT(*) FROM customers')", { POSX: 1100, WIDTH: 1000 })]),
      ]),
    ],
  });
  // A dataset opened by an expression (not on start): read while the expression is evaluated
  out['pg-ondemand'] = report({
    data: [datainfo('C', 'SELECT count(*) AS N, max(order_date) AS LAST FROM orders', { OPENONSTART: false })],
    subs: [subreport('', [detail([expr('C.N', { WIDTH: 2000 }), expr("FORMATSTR('dd/mm/yyyy', C.LAST)", { POSX: 2100 })])])],
  });

  out['err-nan'] = errorReport("SELECT 'NaN'::numeric AS A");
  out['err-infinity'] = errorReport("SELECT 'Infinity'::numeric AS A");
  out['err-scale'] = errorReport('SELECT 0.00000000000000000000000000001 AS A');
  out['err-big'] = errorReport('SELECT 1e30::numeric AS A');
  out['err-months'] = errorReport("SELECT interval '1 year 2 mons' AS A");
  out['err-composite'] = errorReport("SELECT row(1, 'x')::pair AS A");
  out['err-regclass'] = errorReport("SELECT 'pg_class'::regclass AS A WHERE false");
  out['err-noparam'] = errorReport('SELECT :Q AS A');
  out['err-exprb'] = errorReport('SELECT :P AS A', [param('P', 8, '10*4', { DATASETS: ['D'] })]);
  out['err-unused'] = errorReport('SELECT 1 AS A', [param('P', 8, '2.5', { DATASETS: ['D'] })]);
  out['err-date-bc'] = errorReport("SELECT '0044-03-15 BC'::date AS A");
  out['err-timestamp'] = errorReport("SELECT '10000-01-01'::timestamp AS A");
  out['err-time24'] = errorReport("SELECT '24:00:00'::time AS A");
  out['err-timetz'] = errorReport("SELECT '10:00:00+05:30:15'::timetz AS A");
  out['err-arrnull'] = errorReport('SELECT ARRAY[1, NULL] AS A');
  out['err-arrnan'] = errorReport("SELECT ARRAY['NaN'::numeric] AS A");
  out['err-nocols'] = errorReport('SELECT');
  out['err-ddl'] = errorReport('CREATE TEMP TABLE t_err (a int)');
  out['err-detail'] = errorReport("SELECT '{1'::int[] AS A");
  out['pg-nullobject'] = errorReport('SELECT :P AS A', [param('P', 15, 'NULL', { DATASETS: ['D'] })]);
  // A master without rows: the detail parameter is C# null
  out['err-nullparam'] = report({
    databases: [database(), masterdb],
    data: [
      datainfo('M', 'SELECT 1 AS A WHERE false', { DATABASEALIAS: 'MASTERDB' }),
      datainfo('D', 'SELECT (:A)::text AS V', { DATASOURCE: 'M' }),
    ],
    params: [param('A', 1, 0, { DATASETS: ['D'] })],
    subs: [subreport('D', [detail([expr('D.V')])])],
  });
  // A master date (DateOnly in Npgsql 10) given to a DateTime parameter (timestamp)
  out['err-dateparam'] = report({
    databases: [database(), masterdb],
    data: [
      datainfo('M', 'SELECT order_date AS D FROM orders WHERE order_id = 1', { DATABASEALIAS: 'MASTERDB' }),
      datainfo('L', 'SELECT count(*) AS N FROM orders WHERE order_date = :D', { DATASOURCE: 'M' }),
    ],
    params: [param('D', 5, delphiDate(2024, 1, 1), { DATASETS: ['L'] })],
    subs: [subreport('L', [detail([expr('L.N')])])],
  });
  return out;
}
