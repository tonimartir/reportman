// The parity cases of the SQL Server driver: the sample reports (their SQL adapted to SQL Server
// where SQLite's does not run there), the synthetic reports of the engine and of this package, run
// by golden-cs (C# engine, Microsoft.Data.SqlClient 6.1) and by the TypeScript engine on the same
// database; and the queries whose columns and values are compared with golden-cs sql.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TYPES_COLUMNS, repoRoot } from './database.ts';
import { database, datainfo, delphiDate, detail, expr, listReport, param, report, subreport, withSql } from './reports.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const fixtures = path.join(here, 'fixtures');
const engineRun = path.join(repoRoot, 'typescript/packages/reportman-engine/test/fixtures/run');
const samples = path.join(repoRoot, 'samples');

export interface ReportCase {
  name: string;
  /** The report the TypeScript engine runs: a sample (samples/NAME.rep) or fixtures/reports/NAME.rep. */
  report: string;
  /** The report golden-cs runs, when it is another one. */
  golden?: string;
  /** Options appended to the connection string of golden-cs (MultipleActiveResultSets=True). */
  csOptions?: string;
  /** Parameter values for golden-cs (--param NAME=value, assigned as strings). */
  params?: Record<string, string>;
  /** Parameter values given to step 2 of the TypeScript run (executeToPdf). */
  values?: Record<string, number | string>;
  culture?: string;
  /** Other report connections opened on the same database. */
  connections?: string[];
  /** The TypeScript run needs a synchronous driver (data read while an expression is evaluated). */
  synchronous?: boolean;
  /** Compare the statements both engines send (traced on the server); true by default. */
  statements?: boolean;
  /**
   * C# fails where the TypeScript driver runs the report (or fails with tsError): the text of the C#
   * error and why (a limitation of SqlClient or of the C# engine, not reproduced on purpose).
   */
  knownDifference?: { error: string; why: string; tsError?: string };
}

const sample = (name: string): string => 'samples/' + name + '.rep';
const fixture = (name: string): string => 'fixtures/reports/' + name + '.rep';

/**
 * SqlClient without MARS keeps one open reader per connection, and a report that keeps two datasets open needs it: the C# engine adds
 * MultipleActiveResultSets=True to a SQL Server connection string that does not set it (DatabaseInfo.WithMultipleActiveResultSets).
 * MARS sets it explicitly (kept as it is), NO_MARS turns it off (kept too: C# then fails).
 */
const MARS = 'MultipleActiveResultSets=True';
const NO_MARS = 'MultipleActiveResultSets=False';

const NO_MARS_WHY =
  'With MultipleActiveResultSets=False SqlClient keeps one open reader per connection, and the C# engine keeps the reader of each dataset ' +
  'open while it opens the next one on the same connection. The TypeScript engine reads each result whole.';

export const CASES: ReportCase[] = [
  { name: 'customers', report: sample('customers') },
  { name: 'customers-es', report: sample('customers'), culture: 'es-ES' },
  { name: 'invoices', report: fixture('invoices') },
  // golden-cs --param assigns strings (nvarchar parameters); step 2 of openReport types them (int)
  { name: 'invoices-range', report: fixture('invoices'), params: { FIRST_ORDER: '7', LAST_ORDER: '9' }, values: { FIRST_ORDER: 7, LAST_ORDER: 9 }, statements: false },
  // the sample as it is (:FIRST_ORDER): the driver writes the placeholders @FIRST_ORDER, the same statements as the adapted report
  { name: 'invoices-colon', report: sample('invoices'), golden: fixture('invoices') },
  { name: 'labels', report: sample('labels') },
  { name: 'product-catalog', report: sample('product-catalog') },
  { name: 'monthly-sales', report: fixture('monthly-sales') },
  // the connection string of the host as it is: the C# engine turns MARS on
  { name: 'sales-by-category', report: fixture('sales-by-category') },
  { name: 'sales-by-category-nomars', report: fixture('sales-by-category'), csOptions: NO_MARS, knownDifference: { error: 'There is already an open DataReader associated with this Connection which must be closed first.', why: NO_MARS_WHY } },
  { name: 'fishes', report: sample('fishes') },
  { name: 'syn-params', report: fixture('syn-params'), csOptions: MARS },
  { name: 'syn-masterdetail', report: fixture('syn-masterdetail') },
  { name: 'syn-masterdetail-nomars', report: fixture('syn-masterdetail'), csOptions: NO_MARS, knownDifference: { error: 'There is already an open DataReader associated with this Connection which must be closed first.', why: NO_MARS_WHY } },
  // a dataset opened while an expression is evaluated: the synchronous driver
  { name: 'syn-ondemand', report: fixture('syn-ondemand'), csOptions: MARS, synchronous: true },
  // GETVALUEFROMSQL: its command inside the implicit transaction, read while an expression is evaluated (the synchronous driver)
  { name: 'syn-getvalue', report: fixture('syn-getvalue'), synchronous: true },
  {
    name: 'syn-getvalue-nomars',
    report: fixture('syn-getvalue'),
    csOptions: NO_MARS,
    synchronous: true,
    knownDifference: {
      error: 'There is already an open DataReader associated with this Connection which must be closed first.',
      why: 'With MultipleActiveResultSets=False SqlClient keeps one open reader per connection, and the C# engine keeps the reader of the dataset being printed open while GETVALUEFROMSQL runs its command. The TypeScript engine has read that dataset whole.',
    },
  },
  { name: 'mssql-types', report: fixture('mssql-types') },
  { name: 'mssql-types-es', report: fixture('mssql-types'), culture: 'es-ES' },
  { name: 'mssql-variants', report: fixture('mssql-variants') },
  { name: 'mssql-params', report: fixture('mssql-params') },
  { name: 'mssql-masterdetail', report: fixture('mssql-masterdetail'), csOptions: MARS },
  { name: 'mssql-variantparams', report: fixture('mssql-variantparams'), csOptions: MARS },
  { name: 'mssql-multi', report: fixture('mssql-multi') },
  { name: 'mssql-session', report: fixture('mssql-session') },
  { name: 'err-nullparam', report: fixture('err-nullparam'), csOptions: MARS },
  { name: 'err-convertparam', report: fixture('err-convertparam'), csOptions: MARS },
  { name: 'err-dateparam', report: fixture('err-dateparam') },
  { name: 'err-udt', report: fixture('err-udt') },
  { name: 'err-decimal', report: fixture('err-decimal') },
  { name: 'err-syntax', report: fixture('err-syntax') },
  { name: 'err-twoerrors', report: fixture('err-twoerrors') },
  { name: 'err-midrows', report: fixture('err-midrows') },
  // an error that rolls the transaction back (a conversion error aborts the batch)
  { name: 'err-conversion', report: fixture('err-conversion') },
  // the SQL ends the transaction: SqlTransaction.Commit refuses the completed transaction
  { name: 'err-commit', report: fixture('err-commit') },
];

export interface QueryCase {
  name: string;
  sql: string;
  /** Options appended to the connection string. */
  options?: string;
  culture?: string;
}

const TYPE_SYSTEM_SQL =
  "SELECT CAST('2024-02-29' AS DATE) AS D, CAST('13:45:30.123' AS TIME) AS T, CAST('2024-02-29 13:45' AS DATETIME2) AS D2, " +
  "CAST('2024-02-29 13:45 +01:00' AS DATETIMEOFFSET) AS DO, CAST(N'x' AS NVARCHAR(MAX)) AS NM, CAST('y' AS VARCHAR(MAX)) AS VM, CAST('<a/>' AS XML) AS X, " +
  'CAST(0x01 AS VARBINARY(MAX)) AS VB, T_VARIANT AS V, T_NTEXT AS NT FROM TYPES WHERE ID = 1';

export const QUERIES: QueryCase[] = [
  { name: 'types', sql: 'SELECT * FROM TYPES ORDER BY ID' },
  { name: 'variants', sql: 'SELECT ID, V FROM VARIANTS ORDER BY ID' },
  { name: 'udt', sql: 'SELECT ID, H FROM UDTS ORDER BY ID' },
  { name: 'udt-null', sql: 'SELECT CAST(NULL AS GEOGRAPHY) AS G' },
  { name: 'udt-2012', sql: 'SELECT G FROM UDTS', options: 'Type System Version=SQL Server 2012' },
  { name: 'udt-as-text', sql: 'SELECT ID, H.ToString() AS H, G.STAsText() AS G, CAST(GG AS VARBINARY(MAX)) AS GG FROM UDTS ORDER BY ID' },
  { name: 'dec-38-30', sql: 'SELECT CAST(1.5 AS DECIMAL(38,30)) AS X' },
  { name: 'dec-zeros', sql: 'SELECT CAST(1234567890123456789012345678 AS DECIMAL(38,10)) AS X' },
  { name: 'dec-big-zero', sql: 'SELECT CAST(-79228162514264337593543950335.000000000 AS DECIMAL(38,9)) AS X' },
  { name: 'dec-scale-29', sql: 'SELECT CAST(0.1 AS DECIMAL(38,29)) AS X' },
  { name: 'dec-two', sql: 'SELECT CAST(7922816251426433759354395033.50 AS DECIMAL(38,2)) AS X, CAST(99999999999999999999999999.9900 AS DECIMAL(38,4)) AS Y' },
  { name: 'dec-overflow', sql: 'SELECT CAST(9.9 AS DECIMAL(38,37)) AS X' },
  { name: 'dec-overflow-big', sql: 'SELECT CAST(79228162514264337593543950336 AS DECIMAL(38,0)) AS X' },
  { name: 'dec-overflow-scale', sql: 'SELECT CAST(0.123456789012345678901234567890 AS DECIMAL(38,30)) AS X' },
  { name: 'dec-invalid-scale', sql: 'SELECT CAST(10000000000000000000000000000 AS DECIMAL(38,9)) AS X' },
  {
    name: 'expressions',
    sql:
      "SELECT 1 AS I, 1.5 AS D, 2.5E0 AS F, N'n' AS N, 'v' AS V, CAST(NULL AS INT) AS NI, NULL AS NU, 1/3.0 AS Q, CAST(1 AS BIT) AS B, " +
      "CAST('2024-01-02' AS DATETIME) - 1 AS ZD, TODATETIMEOFFSET('2024-02-29 13:45:00.5', '+01:00') AS SO, COUNT(*) AS C, SUM(T_INT) AS S, AVG(T_DEC5_2) AS A, " +
      "MAX(T_DATE) AS MD, MIN(T_TIME) AS MT, CAST('6F9619FF-8B86-D011-B42D-00C04FC964FF' AS UNIQUEIDENTIFIER) AS G0, CAST(12.3456 AS MONEY) * 2 AS M, CHECKSUM(1) AS CK, CAST('2024-02-29' AS DATE) AS DT, " +
      "CAST(N'x' AS NVARCHAR(MAX)) AS NM, CAST(0x01 AS VARBINARY(MAX)) AS BM, MAX(CAST(SQL_VARIANT_PROPERTY(T_VARIANT, 'BaseType') AS NVARCHAR(20))) AS VT FROM TYPES WHERE ID < 4",
  },
  {
    name: 'type-system-2005',
    sql: TYPE_SYSTEM_SQL,
    options: 'Type System Version=SQL Server 2005',
  },
  { name: 'type-system-2000', sql: TYPE_SYSTEM_SQL + '; SELECT H FROM UDTS', options: 'Type System Version=SQL Server 2000' },
  { name: 'type-system-2000-udt', sql: 'SELECT ID, H, G FROM UDTS ORDER BY ID', options: 'Type System Version=SQL Server 2000' },
  { name: 'multi-statement', sql: "SELECT 1 AS A; SELECT 'two' AS B" },
  { name: 'dml-then-select', sql: 'DECLARE @t TABLE (a INT); INSERT INTO @t VALUES (1), (2); SELECT a FROM @t ORDER BY a' },
  { name: 'no-result', sql: 'UPDATE RM_TX SET V = 1 WHERE 1 = 0' },
  { name: 'empty-first', sql: 'SELECT 1 AS A WHERE 1 = 0; SELECT 2 AS B' },
  { name: 'error-after-first', sql: 'SELECT ID FROM TYPES ORDER BY ID; SELECT 1/0 AS E' },
  { name: 'error-before-first', sql: "RAISERROR('first', 16, 1); SELECT 1 AS A; RAISERROR('second', 16, 2)" },
  { name: 'error-mid-rows', sql: 'SELECT ID, 10/(3-ID) AS Q FROM TYPES WHERE ID < 4 ORDER BY ID' },
  { name: 'messages', sql: "PRINT 'hello'; RAISERROR('info', 10, 1); SELECT 3 AS C" },
  { name: 'unknown-table', sql: 'SELECT * FROM NOSUCHTABLE' },
  { name: 'syntax-error', sql: 'SELECT FROM WHERE' },
  { name: 'conversion-error', sql: "SELECT CAST('abc' AS INT) AS X" },
  { name: 'unnamed-columns', sql: "SELECT 1, 'two', 3 AS C" },
  { name: 'colon-literal', sql: "SELECT ':X' AS A, '[:Y]' AS B, N'@Z' AS C -- :W\n, 4 AS D" },
  {
    name: 'session',
    sql:
      'SELECT @@OPTIONS AS O, @@TEXTSIZE AS T, @@DATEFIRST AS DF, @@LANGUAGE AS L, @@LOCK_TIMEOUT AS LT, s.date_format, s.deadlock_priority, ' +
      's.program_name, s.host_name, c.encrypt_option FROM sys.dm_exec_sessions s JOIN sys.dm_exec_connections c ON c.session_id = s.session_id WHERE s.session_id = @@SPID',
  },
  { name: 'session-language', sql: 'SELECT @@LANGUAGE AS L, @@DATEFIRST AS DF, (SELECT date_format FROM sys.dm_exec_sessions WHERE session_id = @@SPID) AS F', options: 'Current Language=Spanish' },
  { name: 'session-app', sql: 'SELECT APP_NAME() AS A, HOST_NAME() AS H', options: 'Application Name=Reports;Workstation ID=WS1' },
  { name: 'wrong-password', sql: 'SELECT 1 AS A', options: 'Password=not-the-password' },
  { name: 'unknown-database', sql: 'SELECT 1 AS A', options: 'Database=nosuchdb' },
  { name: 'unknown-keyword', sql: 'SELECT 1 AS A', options: 'Frobnicate=1' },
  { name: 'bad-bool', sql: 'SELECT 1 AS A', options: 'Multiple Active Result Sets=maybe' },
  { name: 'bad-int', sql: 'SELECT 1 AS A', options: 'Connect Timeout=abc' },
  { name: 'bad-encrypt', sql: 'SELECT 1 AS A', options: 'Encrypt=maybe' },
  { name: 'bad-packet', sql: 'SELECT 1 AS A', options: 'Packet Size=100' },
  { name: 'bad-authentication', sql: 'SELECT 1 AS A', options: 'Authentication=Foo' },
  { name: 'failover-no-catalog', sql: 'SELECT 1 AS A', options: 'Failover Partner=x;Initial Catalog=' },
  { name: 'encrypt-optional', sql: 'SELECT c.encrypt_option FROM sys.dm_exec_connections c WHERE c.session_id = @@SPID', options: 'Encrypt=False' },
  { name: 'untrusted-certificate', sql: 'SELECT 1 AS A', options: 'TrustServerCertificate=False' },
];

// ---------------------------------------------------------------------------------------------
// The reports

const SALES = 'SUM(L.QUANTITY*L.UNIT_PRICE*(1-L.DISCOUNT/100.0))';

/** The samples and engine fixtures whose SQL does not run on SQL Server as it is, adapted. */
const ADAPTED: { name: string; source: string; sql: Record<string, string> }[] = [
  {
    name: 'invoices',
    source: path.join(samples, 'invoices.rep'),
    sql: {
      INV:
        'SELECT O.ORDER_ID, O.ORDER_NUMBER, O.ORDER_DATE, O.STATUS, O.VAT_RATE, C.CODE AS CUSTOMER_CODE, C.COMPANY_NAME, C.CONTACT_NAME, ' +
        'C.ADDRESS, C.POSTAL_CODE, C.CITY, C.COUNTRY, E.FIRST_NAME, E.LAST_NAME, L.LINE_NO, P.SKU, P.NAME AS PRODUCT, P.UNIT, L.QUANTITY, ' +
        'L.UNIT_PRICE, L.DISCOUNT FROM ORDERS O JOIN CUSTOMERS C ON C.CUSTOMER_ID = O.CUSTOMER_ID JOIN EMPLOYEES E ON E.EMPLOYEE_ID = O.EMPLOYEE_ID ' +
        'JOIN ORDER_LINES L ON L.ORDER_ID = O.ORDER_ID JOIN PRODUCTS P ON P.PRODUCT_ID = L.PRODUCT_ID ' +
        'WHERE O.ORDER_ID BETWEEN @FIRST_ORDER AND @LAST_ORDER ORDER BY O.ORDER_ID, L.LINE_NO',
    },
  },
  {
    name: 'monthly-sales',
    source: path.join(samples, 'monthly-sales.rep'),
    sql: {
      MON:
        "SELECT CONVERT(CHAR(7), O.ORDER_DATE, 126) AS PERIOD, SUBSTRING('JanFebMarAprMayJunJulAugSepOctNovDec', (MONTH(O.ORDER_DATE) - 1) * 3 + 1, 3) " +
        "+ ' ' + CAST(YEAR(O.ORDER_DATE) AS VARCHAR(4)) AS MONTH_NAME, COUNT(DISTINCT O.ORDER_ID) AS ORDERS, SUM(L.QUANTITY) AS UNITS, " +
        SALES +
        ' AS SALES FROM ORDERS O JOIN ORDER_LINES L ON L.ORDER_ID = O.ORDER_ID WHERE O.ORDER_DATE BETWEEN CAST(@FROM_DATE AS DATE) AND CAST(@TO_DATE AS DATE) ' +
        'GROUP BY CONVERT(CHAR(7), O.ORDER_DATE, 126), MONTH(O.ORDER_DATE), YEAR(O.ORDER_DATE) ORDER BY 1',
    },
  },
  {
    name: 'sales-by-category',
    source: path.join(samples, 'sales-by-category.rep'),
    sql: {
      PROD:
        'SELECT C.NAME AS CATEGORY, P.SKU, P.NAME AS PRODUCT, SUM(L.QUANTITY) AS UNITS, ' + SALES + ' AS SALES ' +
        'FROM ORDER_LINES L JOIN ORDERS O ON O.ORDER_ID = L.ORDER_ID JOIN PRODUCTS P ON P.PRODUCT_ID = L.PRODUCT_ID ' +
        'JOIN CATEGORIES C ON C.CATEGORY_ID = P.CATEGORY_ID WHERE YEAR(O.ORDER_DATE) = @SALES_YEAR ' +
        'GROUP BY C.NAME, P.SKU, P.NAME ORDER BY C.NAME, SALES DESC',
      CATS:
        'SELECT C.NAME AS CATEGORY, SUM(L.QUANTITY) AS UNITS, ' + SALES + ' AS SALES, 100.0 * ' + SALES + ' / (SELECT ' + SALES + ' ' +
        'FROM ORDER_LINES L JOIN ORDERS O ON O.ORDER_ID = L.ORDER_ID JOIN PRODUCTS P ON P.PRODUCT_ID = L.PRODUCT_ID ' +
        'JOIN CATEGORIES C ON C.CATEGORY_ID = P.CATEGORY_ID WHERE YEAR(O.ORDER_DATE) = @SALES_YEAR ) AS SHARE ' +
        'FROM ORDER_LINES L JOIN ORDERS O ON O.ORDER_ID = L.ORDER_ID JOIN PRODUCTS P ON P.PRODUCT_ID = L.PRODUCT_ID ' +
        'JOIN CATEGORIES C ON C.CATEGORY_ID = P.CATEGORY_ID WHERE YEAR(O.ORDER_DATE) = @SALES_YEAR ' +
        'GROUP BY C.NAME ORDER BY SALES DESC',
    },
  },
  {
    name: 'syn-params',
    source: path.join(engineRun, 'syn-params.rep'),
    sql: {
      // LIMIT is TOP
      D1:
        'SELECT TOP ({LIM}) ORDER_ID, ORDER_NUMBER, ORDER_DATE, VAT_RATE FROM ORDERS WHERE ORDER_ID BETWEEN @FROMID AND @TOID AND ' +
        'ORDER_DATE >= @FROMDATE AND VAT_RATE <= @MAXVAT AND (@FLAG = 1 OR VAT_RATE > 0) AND ORDER_ID <> @EXB AND ' +
        'ORDER_ID NOT IN ({IDS}) {COND} ORDER BY {ORDERBY}',
      D2: 'SELECT COMPANY_NAME, COUNTRY FROM CUSTOMERS WHERE COUNTRY = @COUNTRY AND COMPANY_NAME LIKE @PATTERN ORDER BY COMPANY_NAME',
    },
  },
  {
    name: 'syn-masterdetail',
    source: path.join(engineRun, 'syn-masterdetail.rep'),
    sql: {
      ORD: "SELECT ORDER_ID, ORDER_NUMBER, ORDER_DATE, CUSTOMER_ID FROM ORDERS WHERE CUSTOMER_ID = @CUSTOMER_ID AND ORDER_DATE >= '2025-10-01' ORDER BY ORDER_ID",
      LIN: 'SELECT ORDER_ID, LINE_NO, PRODUCT_ID, QUANTITY, UNIT_PRICE FROM ORDER_LINES WHERE ORDER_ID = @ORDER_ID ORDER BY LINE_NO',
      TOT: 'SELECT COUNT(*) AS N, SUM(VAT_RATE) AS VAT FROM ORDERS WHERE CUSTOMER_ID = @CID',
    },
  },
  // run as they are; copied so the report cases live in one place
  { name: 'syn-getvalue', source: path.join(engineRun, 'syn-getvalue.rep'), sql: {} },
  { name: 'syn-ondemand', source: path.join(engineRun, 'syn-ondemand.rep'), sql: {} },
];

/** A detail section that prints expressions in a grid (n per line), each with its display format. */
function gridDetail(items: (string | [string, string])[], perLine: number): string {
  const width = Math.floor(10700 / perLine);
  const lineHeight = 190;
  const comps = items.map((item, i) => {
    const [e, format] = typeof item === 'string' ? [item, ''] : item;
    return expr(e, {
      POSX: (i % perLine) * width,
      POSY: Math.floor(i / perLine) * lineHeight,
      WIDTH: width - 40,
      HEIGHT: lineHeight,
      FONTSIZE: 6,
      DISPLAYFORMAT: format,
    });
  });
  return detail(comps, Math.ceil(items.length / perLine) * lineHeight + 120);
}

const DATE_FORMAT = 'yyyy-MM-dd HH:mm:ss.fffffff';

/** The synthetic reports of this package, by name. */
function syntheticReports(): Record<string, string> {
  const out: Record<string, string> = {};
  const errorReport = (sql: string, params: string[] = []): string => listReport(sql, ['D.A'], { params });

  // Every column of TYPES but the binary ones and the long texts, with its values on the four rows
  const printed = TYPES_COLUMNS.filter(([n, t]) => !/BINARY|IMAGE|ROWVERSION|MAX|^TEXT|NTEXT/.test(t) && n !== 'T_TEXT_GREEK').flatMap(([n, t]) => {
    const c = 'D.' + n;
    if (/^(DATE|DATETIME|DATETIME2|SMALLDATETIME|DATETIMEOFFSET)/.test(t)) return ["'" + n + "'", [c, DATE_FORMAT]] as (string | [string, string])[];
    return ["'" + n + "'", c];
  });
  out['mssql-types'] = report({
    data: [datainfo('D', 'SELECT * FROM TYPES ORDER BY ID')],
    subs: [subreport('D', [gridDetail(["'ID'", 'D.ID', ...printed], 8)])],
  });
  out['mssql-variants'] = report({
    data: [datainfo('D', "SELECT ID, V, CAST(SQL_VARIANT_PROPERTY(V, 'BaseType') AS NVARCHAR(30)) AS T FROM VARIANTS WHERE SQL_VARIANT_PROPERTY(V, 'BaseType') NOT IN ('binary', 'varbinary') ORDER BY ID")],
    subs: [subreport('D', [gridDetail(['D.ID', 'D.T', 'D.V'], 3)])],
  });

  // The parameters of each type, as SQL Server receives them: their sql_variant properties and value
  const typed: [string, number, string | number | boolean | { date: number }][] = [
    ['PSTR', 0, 'abc'],
    ['PEMPTY', 0, ''],
    ['PLONG', 0, 'x'.repeat(4500)],
    ['PINT', 1, 7],
    ['PDBL', 2, 21.5],
    ['PDATE', 3, delphiDate(2024, 2, 1)],
    ['PTIME', 4, delphiDate(1899, 12, 30, 9, 45, 30)],
    ['PDT', 5, delphiDate(2025, 6, 15, 18, 30, 0)],
    ['PCUR', 6, 1234.5],
    ['PBOOL', 7, true],
    ['PEXSTR', 8, "'x'+'y'"],
    ['PINDEC', 15, '1.5'],
    ['PSMALLDEC', 15, '0.05'],
    ['PINLONG', 15, 'INT(12345678901)'],
    ['PLIST', 11, "'France'"],
    ['PNULL', 15, 'NULL'],
  ];
  const describe = (name: string): string => {
    // nvarchar(max) cannot be a sql_variant: its length is enough
    if (name === 'PLONG') return `SELECT 'PLONG' AS N, NULL AS T, NULL AS P, NULL AS S, NULL AS L, LEFT(@PLONG, 40) AS V, DATALENGTH(@PLONG) AS DL`;
    const v = `CAST(@${name} AS SQL_VARIANT)`;
    return (
      `SELECT '${name}' AS N, CAST(SQL_VARIANT_PROPERTY(${v}, 'BaseType') AS NVARCHAR(30)) AS T, CAST(SQL_VARIANT_PROPERTY(${v}, 'Precision') AS INT) AS P, ` +
      `CAST(SQL_VARIANT_PROPERTY(${v}, 'Scale') AS INT) AS S, CAST(SQL_VARIANT_PROPERTY(${v}, 'MaxLength') AS INT) AS L, ` +
      `CASE WHEN SQL_VARIANT_PROPERTY(${v}, 'BaseType') IN ('datetime', 'date', 'datetime2') THEN CONVERT(NVARCHAR(40), ${v}, 121) ` +
      `ELSE LEFT(CONVERT(NVARCHAR(MAX), ${v}), 40) END AS V, DATALENGTH(@${name}) AS DL`
    );
  };
  out['mssql-params'] = report({
    data: [datainfo('D', typed.map(([n]) => describe(n)).join(' UNION ALL '))],
    params: typed.map(([n, t, v]) => param(n, t, v, { DATASETS: ['D'] })),
    subs: [subreport('D', [gridDetail(['D.N', 'D.T', 'D.P', 'D.S', 'D.L', 'D.V', 'D.DL'], 7)])],
  });

  // A master with columns of several types giving the parameters of its detail (the parameter
  // types are the report's: the master values are converted as SqlClient converts them)
  out['mssql-masterdetail'] = report({
    data: [
      datainfo('M', 'SELECT CUSTOMER_ID, CODE, VAT_RATE, CUSTOMER_SINCE FROM CUSTOMERS WHERE CUSTOMER_ID <= 6 ORDER BY CUSTOMER_ID'),
      datainfo(
        'L',
        'SELECT COUNT(*) AS N, MIN(ORDER_NUMBER) AS FIRST_ORDER, @CODE AS CODE, @VAT_RATE AS VAT, @CUSTOMER_SINCE AS SINCE, ' +
          'SQL_VARIANT_PROPERTY(CAST(@VAT_RATE AS SQL_VARIANT), \'BaseType\') AS VT FROM ORDERS ' +
          'WHERE CUSTOMER_ID = @CUSTOMER_ID AND VAT_RATE = @VAT_RATE AND ORDER_DATE >= @CUSTOMER_SINCE',
        { DATASOURCE: 'M' },
      ),
    ],
    params: [
      param('CUSTOMER_ID', 1, 0, { VISIBLE: false, DATASETS: ['L'] }),
      param('CODE', 0, '', { VISIBLE: false, DATASETS: ['L'] }),
      param('VAT_RATE', 2, 0, { VISIBLE: false, DATASETS: ['L'] }),
      param('CUSTOMER_SINCE', 5, delphiDate(2000, 1, 1), { VISIBLE: false, DATASETS: ['L'] }),
    ],
    subs: [
      subreport(
        'M',
        [
          detail([expr('M.CODE'), expr('M.VAT_RATE', { POSX: 1500 }), expr('M.CUSTOMER_SINCE', { POSX: 3000, DISPLAYFORMAT: DATE_FORMAT, WIDTH: 3000 })], 300, {
            CHILDSUBREPORT: 'TRPSUBREPORTL',
          }),
        ],
        { NAME: 'TRpSubReportM' },
      ),
      subreport(
        'L',
        [
          detail(
            [
              expr('L.N'),
              expr('L.FIRST_ORDER', { POSX: 1000 }),
              expr('L.CODE', { POSX: 2500 }),
              expr('L.VAT', { POSX: 4000 }),
              expr('L.SINCE', { POSX: 5500, WIDTH: 3000, DISPLAYFORMAT: DATE_FORMAT }),
              expr('L.VT', { POSX: 8600 }),
            ],
            300,
          ),
        ],
        { NAME: 'TRpSubReportL', PARENTSUBREPORT: 'TRpSubReportM' },
      ),
    ],
  });

  // Parameters without a value of their own (DbType Object: sql_variant) taking the values of a master
  const pv = ['PV_INT', 'PV_DEC', 'PV_STR', 'PV_DATE', 'PV_BIN', 'PV_BIT', 'PV_BIG', 'PV_FLT', 'PV_TINY'];
  out['mssql-variantparams'] = report({
    data: [
      datainfo(
        'M',
        'SELECT ID, T_INT AS PV_INT, T_DEC18_4 AS PV_DEC, T_NVARCHAR AS PV_STR, T_DATETIME AS PV_DATE, T_VARBINARY AS PV_BIN, T_BIT AS PV_BIT, ' +
          'T_BIGINT AS PV_BIG, T_FLOAT AS PV_FLT, T_TINYINT AS PV_TINY FROM TYPES ORDER BY ID',
      ),
      datainfo(
        'L',
        'SELECT ' +
          pv
            .map(
              (n) =>
                `CAST(SQL_VARIANT_PROPERTY(@${n}, 'BaseType') AS NVARCHAR(20)) + ' ' + ISNULL(CAST(SQL_VARIANT_PROPERTY(@${n}, 'Precision') AS NVARCHAR(5)), '-') + ' ' + ` +
                `ISNULL(CAST(SQL_VARIANT_PROPERTY(@${n}, 'Scale') AS NVARCHAR(5)), '-') + ' ' + ISNULL(CAST(SQL_VARIANT_PROPERTY(@${n}, 'MaxLength') AS NVARCHAR(5)), '-') + ' ' + ` +
                `ISNULL(CASE WHEN SQL_VARIANT_PROPERTY(@${n}, 'BaseType') = 'datetime' THEN CONVERT(NVARCHAR(40), @${n}, 121) WHEN SQL_VARIANT_PROPERTY(@${n}, 'BaseType') = 'varbinary' THEN CONVERT(NVARCHAR(40), CAST(@${n} AS VARBINARY(20)), 1) ELSE CONVERT(NVARCHAR(40), @${n}) END, 'null') AS ${n}`,
            )
            .join(', '),
        { DATASOURCE: 'M' },
      ),
    ],
    params: pv.map((n) => param(n, 15, 'NULL', { VISIBLE: false, DATASETS: ['L'] })),
    subs: [
      subreport('M', [detail([expr('M.ID')], 200, { CHILDSUBREPORT: 'TRPSUBREPORTL' })], { NAME: 'TRpSubReportM' }),
      subreport('L', [gridDetail(pv.map((n) => 'L.' + n), 3)], { NAME: 'TRpSubReportL', PARENTSUBREPORT: 'TRpSubReportM' }),
    ],
  });

  // The statements before the first result set are skipped, the error after it is left
  out['mssql-multi'] = listReport(
    'SET NOCOUNT ON; DECLARE @t TABLE (A INT); INSERT INTO @t VALUES (1), (2), (3); UPDATE @t SET A = A * 10; SELECT A FROM @t ORDER BY A; SELECT 1/0 AS E',
    ['D.A'],
  );
  // The session SqlClient opens: the ODBC defaults, the language of the login, RepeatableRead
  out['mssql-session'] = listReport(
    'SELECT @@OPTIONS AS O, @@TEXTSIZE AS T, @@DATEFIRST AS DF, @@LANGUAGE AS L, s.date_format AS F, s.transaction_isolation_level AS I, @@TRANCOUNT AS C ' +
      'FROM sys.dm_exec_sessions s WHERE s.session_id = @@SPID',
    ['D.O', 'D.T', 'D.DF', 'D.L', 'D.F', 'D.I', 'D.C'],
  );

  // A master without rows: the detail parameter is C# null (DEFAULT): "expects the parameter"
  out['err-nullparam'] = report({
    data: [datainfo('M', 'SELECT 1 AS A WHERE 1 = 0'), datainfo('D', 'SELECT CAST(@A AS NVARCHAR(10)) AS V', { DATASOURCE: 'M' })],
    params: [param('A', 1, 0, { DATASETS: ['D'] })],
    subs: [subreport('D', [detail([expr('D.V')])])],
  });
  // A master text given to an Integer parameter: Convert.ChangeType fails
  out['err-convertparam'] = report({
    data: [datainfo('M', "SELECT 'C001' AS A"), datainfo('D', 'SELECT @A AS V', { DATASOURCE: 'M' })],
    params: [param('A', 1, 0, { DATASETS: ['D'] })],
    subs: [subreport('D', [detail([expr('D.V')])])],
  });
  // A date before 1753 does not fit a datetime parameter
  out['err-dateparam'] = errorReport('SELECT @D AS A', [param('D', 3, delphiDate(1700, 1, 1), { DATASETS: ['D'] })]);
  out['err-udt'] = errorReport('SELECT G AS A FROM UDTS');
  out['err-decimal'] = errorReport('SELECT CAST(79228162514264337593543950336 AS DECIMAL(38,0)) AS A');
  out['err-syntax'] = errorReport('SELECT FROM WHERE');
  out['err-twoerrors'] = errorReport("RAISERROR('first', 16, 1); SELECT 1 AS A; RAISERROR('second', 16, 2)");
  out['err-midrows'] = errorReport('SELECT 10/(3-ID) AS A FROM TYPES WHERE ID < 4 ORDER BY ID');
  out['err-conversion'] = errorReport("SELECT CAST('abc' AS INT) AS A");
  out['err-commit'] = errorReport('COMMIT; SELECT 1 AS A');
  return out;
}

/** Writes the adapted and synthetic reports into fixtures/reports. */
export function writeReports(): void {
  const dir = path.join(fixtures, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  for (const a of ADAPTED) fs.writeFileSync(path.join(dir, a.name + '.rep'), withSql(fs.readFileSync(a.source, 'latin1'), a.sql), 'latin1');
  for (const [name, xml] of Object.entries(syntheticReports())) fs.writeFileSync(path.join(dir, name + '.rep'), xml, 'latin1');
}

/** The file of a report of a case. */
export function reportFile(report: string): string {
  return report.startsWith('samples/') ? path.join(repoRoot, report) : path.join(here, report);
}

export { database };
