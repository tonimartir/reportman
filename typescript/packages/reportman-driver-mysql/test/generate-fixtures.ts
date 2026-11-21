// Reference outputs of the C# engine on MySQL (MySqlConnector 2.5, golden-cs) for the tests:
//
//   1. the report copies whose SQL is adapted to MySQL (fixtures/reports/): the sample SQL is written
//      for SQLite with Delphi placeholders (:NAME), which MySqlConnector does not take; only the SQL
//      of a dataset changes, the rest of the report is the same;
//   2. for each report case of cases.json, the metafile JSON and the uncompressed PDF golden-cs writes
//      (fixtures/run/), or the error of the run (NAME.error.json), and the statements MySqlConnector
//      sent to the server (NAME.statements.json, from the general log of the server);
//   3. for each query of cases.json, the columns and values MySqlConnector reads (fixtures/sql/), or
//      its error.
//
//   node test/generate-fixtures.ts [name...]      (from packages/reportman-driver-mysql, with the
//                                                   test database running)
//
// The general log is read as root (RM_MYSQL_ROOT_PASSWORD, rmtest_root by default).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql2 from 'mysql2';
import { connectionString, loadDatabase, mysqlTest, serverVersion } from './database.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const exe = path.join(root, 'typescript/tools/golden-cs/bin/Release/net10.0/golden-cs.exe');
const engineRun = path.join(root, 'typescript/packages/reportman-engine/test/fixtures/run');
const samples = path.join(root, 'samples');
const fixtures = path.join(here, 'fixtures');
const provider = 'MySQLConnector';

// ---------------------------------------------------------------------------------------------
// The adapted reports

/** ReportWriter's encoding of a string: every character but letters, digits and spaces as #code#. */
function enc(value: string): string {
  let r = '';
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 32) r += value.charAt(i);
    else r += '#' + String(c) + '#';
  }
  return r;
}

/** The report with the SQL of the given datasets replaced (nothing else changes). */
function withSql(xml: string, sql: Record<string, string>): string {
  let found = 0;
  const out = xml.replace(/<DATAINFO>[\s\S]*?<\/DATAINFO>/g, (block) => {
    const alias = /<ALIAS type="(?:Wide)?String">([^<]*)<\/ALIAS>/.exec(block)?.[1];
    if (alias === undefined || sql[alias] === undefined) return block;
    found++;
    return block.replace(/<SQL type="WideString">[\s\S]*?<\/SQL>/, '<SQL type="WideString">' + enc(sql[alias]) + '</SQL>');
  });
  if (found !== Object.keys(sql).length) throw new Error('A dataset to adapt was not found');
  return out;
}

/**
 * The report with the given datasets on report connections of their own, copies of SAMPLES: a
 * MySqlConnection takes one open reader at a time, so the C# engine cannot run on one connection the
 * datasets it keeps open together ("This MySqlConnection is already in use").
 */
function withConnections(xml: string, datasets: Record<string, string>): string {
  const original = /<DATABASEINFO>[\s\S]*?<\/DATABASEINFO>/.exec(xml);
  if (original === null) throw new Error('The report has no connection');
  const copies = [...new Set(Object.values(datasets))].map((alias, i) =>
    original[0]
      .replace(/<ALIAS type="((?:Wide)?String)">[^<]*<\/ALIAS>/, (_m, t: string) => `<ALIAS type="${t}">${alias}</ALIAS>`)
      .replace(/<NAME type="((?:Wide)?String)">[^<]*<\/NAME>/, (_m, t: string) => `<NAME type="${t}">TRpDatabaseInfoItem${i + 1}</NAME>`),
  );
  let out = xml.replace(original[0], [original[0], ...copies].join('\n'));
  let found = 0;
  out = out.replace(/<DATAINFO>[\s\S]*?<\/DATAINFO>/g, (block) => {
    const alias = /<ALIAS type="(?:Wide)?String">([^<]*)<\/ALIAS>/.exec(block)?.[1];
    if (alias === undefined || datasets[alias] === undefined) return block;
    found++;
    return block.replace(
      /<DATABASEALIAS type="((?:Wide)?String)">[^<]*<\/DATABASEALIAS>/,
      (_m, t: string) => `<DATABASEALIAS type="${t}">${datasets[alias]}</DATABASEALIAS>`,
    );
  });
  if (found !== Object.keys(datasets).length) throw new Error('A dataset to move was not found');
  return out;
}

const SALES = 'SUM(L.QUANTITY*L.UNIT_PRICE*(1-L.DISCOUNT/100.0))';
const ADAPTED: { name: string; source: string; sql: Record<string, string>; split?: Record<string, string> }[] = [
  {
    name: 'invoices',
    source: path.join(samples, 'invoices.rep'),
    sql: {
      INV:
        'SELECT O.ORDER_ID, O.ORDER_NUMBER, O.ORDER_DATE, O.STATUS, O.VAT_RATE, C.CODE AS CUSTOMER_CODE, C.COMPANY_NAME, ' +
        'C.CONTACT_NAME, C.ADDRESS, C.POSTAL_CODE, C.CITY, C.COUNTRY, E.FIRST_NAME, E.LAST_NAME, L.LINE_NO, P.SKU, ' +
        'P.NAME AS PRODUCT, P.UNIT, L.QUANTITY, L.UNIT_PRICE, L.DISCOUNT FROM ORDERS O JOIN CUSTOMERS C ON C.CUSTOMER_ID = O.CUSTOMER_ID ' +
        'JOIN EMPLOYEES E ON E.EMPLOYEE_ID = O.EMPLOYEE_ID JOIN ORDER_LINES L ON L.ORDER_ID = O.ORDER_ID ' +
        'JOIN PRODUCTS P ON P.PRODUCT_ID = L.PRODUCT_ID WHERE O.ORDER_ID BETWEEN @FIRST_ORDER AND @LAST_ORDER ' +
        'ORDER BY O.ORDER_ID, L.LINE_NO',
    },
  },
  {
    name: 'monthly-sales',
    source: path.join(samples, 'monthly-sales.rep'),
    sql: {
      MON:
        "SELECT DATE_FORMAT(O.ORDER_DATE, '%Y-%m') AS PERIOD, " +
        "CONCAT(SUBSTRING('JanFebMarAprMayJunJulAugSepOctNovDec', (MONTH(O.ORDER_DATE) - 1) * 3 + 1, 3), ' ', YEAR(O.ORDER_DATE)) AS MONTH_NAME, " +
        'COUNT(DISTINCT O.ORDER_ID) AS ORDERS, SUM(L.QUANTITY) AS UNITS, ' +
        SALES + ' AS SALES FROM ORDERS O JOIN ORDER_LINES L ON L.ORDER_ID = O.ORDER_ID ' +
        'WHERE O.ORDER_DATE BETWEEN DATE(@FROM_DATE) AND DATE(@TO_DATE) GROUP BY 1, 2 ORDER BY 1',
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
    split: { CATS: 'SAMPLES2' },
  },
  {
    name: 'syn-params',
    source: path.join(engineRun, 'syn-params.rep'),
    sql: {
      // LIMIT takes no expression ({LIM} is 2+18): the rows are numbered instead
      D1:
        'SELECT ORDER_ID, ORDER_NUMBER, ORDER_DATE, VAT_RATE FROM (SELECT ORDER_ID, ORDER_NUMBER, ORDER_DATE, VAT_RATE, ' +
        'ROW_NUMBER() OVER (ORDER BY {ORDERBY}) AS RN FROM ORDERS WHERE ORDER_ID BETWEEN @FROMID AND @TOID AND ' +
        'ORDER_DATE >= @FROMDATE AND VAT_RATE <= @MAXVAT AND (@FLAG = 1 OR VAT_RATE > 0) AND ORDER_ID <> @EXB AND ' +
        'ORDER_ID NOT IN ({IDS}) {COND}) T WHERE RN <= {LIM} ORDER BY RN',
      D2: 'SELECT COMPANY_NAME, COUNTRY FROM CUSTOMERS WHERE COUNTRY = @COUNTRY AND COMPANY_NAME LIKE @PATTERN ORDER BY COMPANY_NAME',
    },
    split: { D2: 'SAMPLES2' },
  },
  {
    name: 'syn-masterdetail',
    source: path.join(engineRun, 'syn-masterdetail.rep'),
    sql: {
      ORD: "SELECT ORDER_ID, ORDER_NUMBER, ORDER_DATE, CUSTOMER_ID FROM ORDERS WHERE CUSTOMER_ID = @CUSTOMER_ID AND ORDER_DATE >= '2025-10-01' ORDER BY ORDER_ID",
      LIN: 'SELECT ORDER_ID, LINE_NO, PRODUCT_ID, QUANTITY, UNIT_PRICE FROM ORDER_LINES WHERE ORDER_ID = @ORDER_ID ORDER BY LINE_NO',
      TOT: 'SELECT COUNT(*) AS N, SUM(VAT_RATE) AS VAT FROM ORDERS WHERE CUSTOMER_ID = @CID',
    },
    split: { ORD: 'SAMPLES2', LIN: 'SAMPLES3', TOT: 'SAMPLES4' },
  },
  {
    // Runs unchanged; copied so the report cases live in one place
    name: 'syn-getvalue',
    source: path.join(engineRun, 'syn-getvalue.rep'),
    sql: {},
  },
  {
    // A dataset opened while an expression is evaluated: runs unchanged
    name: 'syn-ondemand',
    source: path.join(engineRun, 'syn-ondemand.rep'),
    sql: {},
  },
];

// ---------------------------------------------------------------------------------------------
// The general log of the server: the statements MySqlConnector sends

function rootQuery<T>(c: mysql2.Connection, sql: string): Promise<T> {
  return new Promise((resolve, reject) => c.query(sql, (err, rows) => (err ? reject(err) : resolve(rows as T))));
}

async function openRoot(): Promise<{ c: mysql2.Connection; id: number }> {
  const c = await new Promise<mysql2.Connection>((resolve, reject) => {
    const conn = mysql2.createConnection({
      host: mysqlTest.host,
      port: mysqlTest.port,
      user: 'root',
      password: process.env.RM_MYSQL_ROOT_PASSWORD ?? 'rmtest_root',
      charset: 'UTF8MB4_GENERAL_CI',
    });
    conn.connect((err) => (err ? reject(err) : resolve(conn)));
  });
  const rows = await rootQuery<{ ID: number }[]>(c, 'SELECT CONNECTION_ID() AS ID');
  await rootQuery(c, "SET GLOBAL log_output = 'TABLE'");
  await rootQuery(c, "SET GLOBAL general_log = 'ON'");
  return { c, id: rows[0]!.ID };
}

/** A statement of the log: its text, or its bytes when they are not UTF-8. */
export type LoggedStatement = string | { base64: string };

async function loggedStatements(log: { c: mysql2.Connection; id: number }): Promise<LoggedStatement[]> {
  const rows = await rootQuery<{ argument: Buffer }[]>(
    log.c,
    `SELECT argument FROM mysql.general_log WHERE command_type = 'Query' AND thread_id <> ${log.id} ORDER BY event_time`,
  );
  return rows.map((r) => {
    const text = r.argument.toString('utf8');
    return Buffer.from(text, 'utf8').equals(r.argument) ? text : { base64: r.argument.toString('base64') };
  });
}

// ---------------------------------------------------------------------------------------------

interface Cases {
  reports: { name: string; report: string; golden?: string; connections?: string[]; params?: Record<string, string>; culture?: string }[];
  queries: { name: string; sql: string; options?: string }[];
}

/** The error golden-cs prints: its .NET type and message (without the stack trace, lines in \n). */
function goldenError(output: string): { error: string; message: string } {
  const text = output.replace(/\r\n/g, '\n');
  const m = /^ERROR ([\w.]+): ([\s\S]*?)(?=\n {3}at |\s*$)/.exec(text);
  if (m === null) return { error: 'unknown', message: text.trim() };
  return { error: m[1]!.split('.').pop()!, message: m[2]! };
}

async function main(): Promise<void> {
  const only = process.argv.slice(2);
  const wanted = (name: string): boolean => only.length === 0 || only.includes(name);
  await loadDatabase();
  const connection = provider + '|' + connectionString();
  fs.writeFileSync(path.join(fixtures, 'server.json'), JSON.stringify({ version: await serverVersion() }) + '\n');

  fs.mkdirSync(path.join(fixtures, 'reports'), { recursive: true });
  for (const a of ADAPTED) {
    const xml = fs.readFileSync(a.source, 'latin1');
    const adapted = withSql(xml, a.sql);
    fs.writeFileSync(path.join(fixtures, 'reports', a.name + '.rep'), adapted, 'latin1');
    if (a.split !== undefined) fs.writeFileSync(path.join(fixtures, 'reports', a.name + '.split.rep'), withConnections(adapted, a.split), 'latin1');
  }

  const cases = JSON.parse(fs.readFileSync(path.join(here, 'cases.json'), 'utf8')) as Cases;
  const runDir = path.join(fixtures, 'run');
  fs.mkdirSync(runDir, { recursive: true });
  const log = await openRoot();
  try {
    for (const c of cases.reports) {
      if (!wanted(c.name)) continue;
      const meta = path.join(runDir, c.name + '.meta.json');
      const pdf = path.join(runDir, c.name + '.cs.pdf');
      const errFile = path.join(runDir, c.name + '.error.json');
      const statementsFile = path.join(runDir, c.name + '.statements.json');
      for (const f of [meta, pdf, errFile, statementsFile]) if (fs.existsSync(f)) fs.unlinkSync(f);
      const args = ['run', path.resolve(here, c.golden ?? c.report), meta, '--pdf', pdf];
      for (const alias of ['SAMPLES', ...(c.connections ?? [])]) args.push('--connection', alias + '=' + connection);
      for (const [k, v] of Object.entries(c.params ?? {})) args.push('--param', k + '=' + v);
      if (c.culture !== undefined) args.push('--culture', c.culture);
      await rootQuery(log.c, 'TRUNCATE TABLE mysql.general_log');
      const r = spawnSync(exe, args, { encoding: 'utf8' });
      fs.writeFileSync(statementsFile, JSON.stringify(await loggedStatements(log), null, 2) + '\n');
      if (r.status !== 0) {
        for (const f of [meta, pdf]) if (fs.existsSync(f)) fs.unlinkSync(f);
        const e = goldenError(r.stderr || r.stdout);
        fs.writeFileSync(errFile, JSON.stringify(e, null, 2) + '\n');
        console.log(c.name + ': ' + e.error + ': ' + e.message.split('\n')[0]);
      } else {
        fs.writeFileSync(meta, JSON.stringify(JSON.parse(fs.readFileSync(meta, 'utf8'))));
        console.log(c.name + ': ' + r.stdout.trim());
      }
    }
  } finally {
    await rootQuery(log.c, "SET GLOBAL general_log = 'OFF'");
    log.c.end();
  }

  const sqlDir = path.join(fixtures, 'sql');
  fs.mkdirSync(sqlDir, { recursive: true });
  for (const q of cases.queries) {
    if (!wanted(q.name)) continue;
    const out = path.join(sqlDir, q.name + '.json');
    if (fs.existsSync(out)) fs.unlinkSync(out);
    const r = spawnSync(exe, ['sql', provider + '|' + connectionString(q.options ?? ''), q.sql, out], { encoding: 'utf8' });
    if (r.status !== 0) {
      if (fs.existsSync(out)) fs.unlinkSync(out);
      const e = goldenError(r.stderr || r.stdout);
      fs.writeFileSync(out, JSON.stringify(e, null, 2) + '\n');
      console.log(q.name + ': ' + e.error + ': ' + e.message.split('\n')[0]);
    } else {
      fs.writeFileSync(out, JSON.stringify(JSON.parse(fs.readFileSync(out, 'utf8')), null, 2) + '\n');
      console.log(q.name + ': ok');
    }
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
