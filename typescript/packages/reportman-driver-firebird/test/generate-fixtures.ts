// Reference outputs of the C# engine on Firebird (FirebirdClient 10.3, golden-cs) for the tests:
//
//   1. the report copies whose SQL is adapted to Firebird (fixtures/reports/): the sample SQL is
//      written for SQLite; only the SQL of a dataset changes, the rest of the report is the same;
//   2. for each report case of cases.json, the metafile JSON and the uncompressed PDF golden-cs
//      writes (fixtures/run/), or the error of the run (NAME.error.txt);
//   3. for each query of cases.json, the columns and values FirebirdClient reads (fixtures/sql/),
//      or its error.
//
//   node test/generate-fixtures.ts [name...]      (from packages/reportman-driver-firebird, with
//                                                   the test database running)

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectionString, loadDatabase } from './database.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const exe = path.join(root, 'typescript/tools/golden-cs/bin/Release/net10.0/golden-cs.exe');
const engineRun = path.join(root, 'typescript/packages/reportman-engine/test/fixtures/run');
const samples = path.join(root, 'samples');
const fixtures = path.join(here, 'fixtures');
const provider = 'FirebirdSql.Data.FirebirdClient';

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

const SALES = 'SUM(L.QUANTITY*L.UNIT_PRICE*(1-L.DISCOUNT/100.0))';
const ADAPTED: { name: string; source: string; sql: Record<string, string> }[] = [
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
        "SELECT EXTRACT(YEAR FROM O.ORDER_DATE) || '-' || LPAD(EXTRACT(MONTH FROM O.ORDER_DATE), 2, '0') AS PERIOD, " +
        "SUBSTRING('JanFebMarAprMayJunJulAugSepOctNovDec' FROM (EXTRACT(MONTH FROM O.ORDER_DATE) - 1) * 3 + 1 FOR 3) || ' ' || " +
        'EXTRACT(YEAR FROM O.ORDER_DATE) AS MONTH_NAME, COUNT(DISTINCT O.ORDER_ID) AS ORDERS, SUM(L.QUANTITY) AS UNITS, ' +
        SALES + ' AS SALES FROM ORDERS O JOIN ORDER_LINES L ON L.ORDER_ID = O.ORDER_ID ' +
        'WHERE O.ORDER_DATE BETWEEN CAST(@FROM_DATE AS DATE) AND CAST(@TO_DATE AS DATE) GROUP BY 1, 2 ORDER BY 1',
    },
  },
  {
    name: 'sales-by-category',
    source: path.join(samples, 'sales-by-category.rep'),
    sql: {
      PROD:
        'SELECT C.NAME AS CATEGORY, P.SKU, P.NAME AS PRODUCT, SUM(L.QUANTITY) AS UNITS, ' + SALES + ' AS SALES ' +
        'FROM ORDER_LINES L JOIN ORDERS O ON O.ORDER_ID = L.ORDER_ID JOIN PRODUCTS P ON P.PRODUCT_ID = L.PRODUCT_ID ' +
        'JOIN CATEGORIES C ON C.CATEGORY_ID = P.CATEGORY_ID WHERE EXTRACT(YEAR FROM O.ORDER_DATE) = @SALES_YEAR ' +
        'GROUP BY C.NAME, P.SKU, P.NAME ORDER BY C.NAME, SALES DESC',
      CATS:
        'SELECT C.NAME AS CATEGORY, SUM(L.QUANTITY) AS UNITS, ' + SALES + ' AS SALES, 100.0 * ' + SALES + ' / (SELECT ' + SALES + ' ' +
        'FROM ORDER_LINES L JOIN ORDERS O ON O.ORDER_ID = L.ORDER_ID JOIN PRODUCTS P ON P.PRODUCT_ID = L.PRODUCT_ID ' +
        'JOIN CATEGORIES C ON C.CATEGORY_ID = P.CATEGORY_ID WHERE EXTRACT(YEAR FROM O.ORDER_DATE) = @SALES_YEAR ) AS SHARE ' +
        'FROM ORDER_LINES L JOIN ORDERS O ON O.ORDER_ID = L.ORDER_ID JOIN PRODUCTS P ON P.PRODUCT_ID = L.PRODUCT_ID ' +
        'JOIN CATEGORIES C ON C.CATEGORY_ID = P.CATEGORY_ID WHERE EXTRACT(YEAR FROM O.ORDER_DATE) = @SALES_YEAR ' +
        'GROUP BY C.NAME ORDER BY SALES DESC',
    },
  },
  {
    name: 'syn-params',
    source: path.join(engineRun, 'syn-params.rep'),
    sql: {
      D1:
        'SELECT ORDER_ID, ORDER_NUMBER, ORDER_DATE, VAT_RATE FROM ORDERS WHERE ORDER_ID BETWEEN @FROMID AND @TOID AND ' +
        'ORDER_DATE >= @FROMDATE AND VAT_RATE <= @MAXVAT AND (@FLAG = 1 OR VAT_RATE > 0) AND ORDER_ID <> @EXB AND ' +
        'ORDER_ID NOT IN ({IDS}) {COND} ORDER BY {ORDERBY} ROWS {LIM}',
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

interface Cases {
  reports: { name: string; report: string; params?: Record<string, string>; culture?: string }[];
  queries: { name: string; sql: string }[];
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

  fs.mkdirSync(path.join(fixtures, 'reports'), { recursive: true });
  for (const a of ADAPTED) {
    const xml = fs.readFileSync(a.source, 'latin1');
    fs.writeFileSync(path.join(fixtures, 'reports', a.name + '.rep'), withSql(xml, a.sql), 'latin1');
  }

  const cases = JSON.parse(fs.readFileSync(path.join(here, 'cases.json'), 'utf8')) as Cases;
  const runDir = path.join(fixtures, 'run');
  fs.mkdirSync(runDir, { recursive: true });
  for (const c of cases.reports) {
    if (!wanted(c.name)) continue;
    const meta = path.join(runDir, c.name + '.meta.json');
    const pdf = path.join(runDir, c.name + '.cs.pdf');
    const errFile = path.join(runDir, c.name + '.error.json');
    for (const f of [meta, pdf, errFile]) if (fs.existsSync(f)) fs.unlinkSync(f);
    const args = ['run', path.resolve(here, c.report), meta, '--pdf', pdf, '--connection', 'SAMPLES=' + connection];
    for (const [k, v] of Object.entries(c.params ?? {})) args.push('--param', k + '=' + v);
    if (c.culture !== undefined) args.push('--culture', c.culture);
    const r = spawnSync(exe, args, { encoding: 'utf8' });
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

  const sqlDir = path.join(fixtures, 'sql');
  fs.mkdirSync(sqlDir, { recursive: true });
  for (const q of cases.queries) {
    if (!wanted(q.name)) continue;
    const out = path.join(sqlDir, q.name + '.json');
    if (fs.existsSync(out)) fs.unlinkSync(out);
    const r = spawnSync(exe, ['sql', connection, q.sql, out], { encoding: 'utf8' });
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
