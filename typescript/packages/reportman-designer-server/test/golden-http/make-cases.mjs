// Writes cases.json: the requests of golden-http, the same for Reportman.Server (C#) and for
// @reportman/server (Node). Edit the list here and run `node make-cases.mjs`; then record the C#
// answers again (README.md).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const R = '/api/reports/INFORMES';
const D = '/api/designer/';
const samples = ['contacts', 'customers', 'fishes', 'international', 'invoices', 'labels', 'letter', 'monthly-sales', 'product-catalog', 'sales-by-category', 'year-over-year'];
const cases = [];
const add = (c) => cases.push(c);

// ---- The reports API (ReportsController, HealthController) ----
add({ name: 'health', method: 'GET', path: '/api/health', mask: ['version', 'engine', 'dataPath'] });
add({ name: 'aliases', method: 'GET', path: '/api/reports/aliases' });
add({ name: 'tree', method: 'GET', path: R + '/tree' });
for (const s of samples) add({ name: 'parameters-' + s, method: 'GET', path: R + '/parameters?path=Ejemplos/' + s + '.rep' });
for (const s of samples) add({ name: 'csv-' + s, method: 'GET', path: R + '/execute?path=Ejemplos/' + s + '.rep&format=csv', expect: 'text' });
for (const s of ['contacts', 'customers', 'invoices']) add({ name: 'text-' + s, method: 'GET', path: R + '/execute?path=Ejemplos/' + s + '.rep&format=text', expect: 'text' });
add({ name: 'pdf-customers', method: 'GET', path: R + '/execute?path=Ejemplos/customers.rep', expect: 'pdf' });
add({ name: 'pdf-customers-download', method: 'GET', path: R + '/execute?path=Ejemplos/customers.rep&format=pdf&download=1', expect: 'pdf' });
add({ name: 'pdf-customers-post', method: 'POST', path: R + '/execute?path=Ejemplos/customers.rep', expect: 'pdf' });
add({ name: 'metafile-customers', method: 'GET', path: R + '/execute?path=Ejemplos/customers.rep&format=metafile', expect: 'metafile' });
add({ name: 'csv-invoices-query', method: 'GET', path: R + '/execute?path=Ejemplos/invoices.rep&format=csv&FIRST_ORDER=7&LAST_ORDER=9', expect: 'text' });
add({ name: 'csv-invoices-json', method: 'POST', path: R + '/execute?path=Ejemplos/invoices.rep', json: { parameters: { FIRST_ORDER: 7, LAST_ORDER: 9 }, format: 'csv' }, expect: 'text' });
add({ name: 'csv-invoices-json-case', method: 'POST', path: R + '/execute?path=Ejemplos/invoices.rep', json: { Parameters: { first_order: '7', last_order: '9' }, FORMAT: 'csv' }, expect: 'text' });
add({ name: 'csv-invoices-form', method: 'POST', path: R + '/execute?path=Ejemplos/invoices.rep', form: { FIRST_ORDER: '7', LAST_ORDER: '9', format: 'csv' }, expect: 'text' });
add({ name: 'csv-invoices-query-and-body', method: 'POST', path: R + '/execute?path=Ejemplos/invoices.rep&format=csv&FIRST_ORDER=1&LAST_ORDER=9', json: { parameters: { FIRST_ORDER: 8 } }, expect: 'text' });
add({ name: 'error-unknown-alias-tree', method: 'GET', path: '/api/reports/NOPE/tree' });
add({ name: 'error-unknown-alias-execute', method: 'GET', path: '/api/reports/NOPE/execute?path=customers.rep' });
add({ name: 'error-missing-report', method: 'GET', path: R + '/execute?path=Ejemplos/nope.rep' });
add({ name: 'error-missing-report-parameters', method: 'GET', path: R + '/parameters?path=Ejemplos/nope.rep' });
add({ name: 'error-path-outside', method: 'GET', path: R + '/execute?path=../server.json' });
add({ name: 'error-unknown-format', method: 'GET', path: R + '/execute?path=Ejemplos/customers.rep&format=xls' });
add({ name: 'error-bad-parameter', method: 'GET', path: R + '/execute?path=Ejemplos/invoices.rep&format=csv&FIRST_ORDER=abc' });
add({ name: 'error-bad-json', method: 'POST', path: R + '/execute?path=Ejemplos/invoices.rep', raw: '{not json', contentType: 'application/json' });

// ---- The console routes both servers have ----
add({ name: 'samples-es', method: 'GET', path: '/api/reports/samples?lang=es' });
add({ name: 'samples-zh', method: 'GET', path: '/api/reports/samples?lang=zh' });
add({ name: 'thumbnail', method: 'GET', path: '/api/reports/samples/thumbnails/fishes.png', expect: 'binary' });
add({ name: 'thumbnail-outside', method: 'GET', path: '/api/reports/samples/thumbnails/..%2Fsamples.ini', expect: 'status' });
add({ name: 'connections', method: 'GET', path: '/api/connections' });
add({ name: 'connection-samples', method: 'GET', path: '/api/connections/SAMPLES' });
add({ name: 'connection-test-samples', method: 'POST', path: '/api/connections/SAMPLES/test', mask: ['serverVersion'] });
add({ name: 'console-aliases', method: 'GET', path: '/api/console/aliases' });
add({ name: 'console-keys', method: 'GET', path: '/api/console/keys' });

// ---- The designer protocol (Reportman.Designer.Server, DesignerController) ----
const read = (name, reportName) => add({ name, method: 'POST', path: D + 'ReadReport', json: { operation: 0, reportName }, mask: ['eTag'] });
read('designer-read-customers', 'INFORMES/Ejemplos/customers.rep');
read('designer-read-invoices', 'INFORMES/Ejemplos/invoices.rep');
read('designer-read-labels', 'INFORMES/Ejemplos/labels.rep');
read('designer-read-sales-by-category', 'INFORMES/Ejemplos/sales-by-category.rep');
read('designer-read-international', 'INFORMES/Ejemplos/international.rep');
add({ name: 'designer-read-base64', method: 'POST', path: D + 'ReadReport', json: { operation: 0, expression: { $base64file: 'customers.rep' } } });
add({ name: 'designer-read-no-name', method: 'POST', path: D + 'ReadReport', json: { operation: 0 } });
add({ name: 'designer-read-bad-name', method: 'POST', path: D + 'ReadReport', json: { operation: 0, reportName: 'customers.rep' } });
add({ name: 'designer-read-missing', method: 'POST', path: D + 'ReadReport', json: { operation: 0, reportName: 'INFORMES/Ejemplos/nope.rep' } });
add({ name: 'designer-read-unknown-alias', method: 'POST', path: D + 'ReadReport', json: { operation: 0, reportName: 'NOPE/customers.rep' } });
const inv = { $case: 'designer-read-invoices', $path: 'report' };
const cust = { $case: 'designer-read-customers', $path: 'report' };
const sbc = { $case: 'designer-read-sales-by-category', $path: 'report' };
const op = (name, json, extra = {}) => add({ name, method: 'POST', path: D + 'ReadReport', json, ...extra });
op('designer-functions', { operation: 1, report: inv });
op('designer-functions-columns', { operation: 3, report: inv });
op('designer-functions-columns-sbc', { operation: 3, report: sbc });
op('designer-functions-no-report', { operation: 1 });
op('designer-check-valid', { operation: 13, report: inv, expression: 'INV.QUANTITY*INV.UNIT_PRICE+1' });
op('designer-check-param', { operation: 13, report: inv, expression: 'FIRST_ORDER+LAST_ORDER' });
op('designer-check-unknown-field', { operation: 13, report: inv, expression: 'INV.NOPE+1' });
op('designer-check-syntax-error', { operation: 13, report: inv, expression: '1 +* (2' });
op('designer-check-second-line', { operation: 13, report: inv, expression: '1+\n2+)' });
op('designer-evaluate-constant', { operation: 4, report: inv, expression: '2*21' });
op('designer-evaluate-string', { operation: 4, report: inv, expression: "UPPERCASE('abc')+'d'" });
op('designer-evaluate-field', { operation: 4, report: inv, expression: 'INV.ORDER_NUMBER' });
op('designer-evaluate-unqualified-field', { operation: 4, report: inv, expression: 'COMPANY_NAME' });
op('designer-evaluate-param', { operation: 4, report: inv, expression: 'FIRST_ORDER' });
op('designer-evaluate-error', { operation: 4, report: inv, expression: '1/0' });
op('designer-evaluate-syntax-error', { operation: 4, report: inv, expression: '1+' });
op('designer-dataset', { operation: 6, report: cust, datasetName: 'CUST', expression: 'SELECT CUSTOMER_ID, CODE, COMPANY_NAME, VAT_RATE, CUSTOMER_SINCE FROM CUSTOMERS WHERE CUSTOMER_ID < 4 ORDER BY CUSTOMER_ID' });
op('designer-dataset-report-sql', { operation: 6, report: inv, datasetName: 'inv', expression: '' });
op('designer-dataset-bad-sql', { operation: 6, report: cust, datasetName: 'CUST', expression: 'SELECT NOPE FROM NOWHERE' });
op('designer-dataset-unknown', { operation: 6, report: cust, datasetName: 'NOPE', expression: 'SELECT 1' });
op('designer-all-table-columns', { operation: 5, report: cust });
op('designer-export-report', { operation: 8, report: cust }, { decode: ['evaluateResult.value'] });
op('designer-export-report-stored', { operation: 8, reportName: 'INFORMES/Ejemplos/labels.rep' }, { decode: ['evaluateResult.value'] });
op('designer-export-subreport', { operation: 7, report: sbc, expression: '0' }, { decode: ['evaluateResult.value'] });
op('designer-import', { operation: 9, report: cust, expression: { $base64file: 'labels.rep' } });
op('designer-import-empty', { operation: 10, expression: { $base64file: 'customers.rep' } });
op('designer-import-empty-with-report', { operation: 10, report: cust, expression: { $base64file: 'customers.rep' } });
op('designer-duplicate', { operation: 11, reportName: 'INFORMES/Ejemplos/customers.rep', expression: 'INFORMES/Copias/customers-copy.rep' });
read('designer-read-duplicated', 'INFORMES/Copias/customers-copy.rep');
op('designer-import-name', { operation: 12, reportName: 'INFORMES/Copias/imported.rep', expression: { $base64file: 'labels.rep' } });
read('designer-read-imported', 'INFORMES/Copias/imported.rep');
op('designer-unknown-operation', { operation: 2, report: cust });
const write = (name, json, extra = {}) => add({ name, method: 'POST', path: D + 'WriteReport', json, ...extra });
write('designer-write-new', { reportName: 'INFORMES/Copias/written.rep', report: inv }, { mask: ['eTag'] });
read('designer-read-written', 'INFORMES/Copias/written.rep');
op('designer-export-written', { operation: 8, reportName: 'INFORMES/Copias/written.rep' }, { decode: ['evaluateResult.value'] });
const writtenTag = [{ name: 'eTag', value: { $case: 'designer-read-written', $path: 'eTag' } }];
write('designer-write-current-etag', { reportName: 'INFORMES/Copias/written.rep', report: cust, properties: writtenTag }, { mask: ['eTag'] });
write('designer-write-stale-etag', { reportName: 'INFORMES/Copias/written.rep', report: inv, properties: writtenTag });
write('designer-write-report-json', { reportName: 'INFORMES/Copias/written-json.rep', reportJson: { $json: { $case: 'designer-read-labels', $path: 'report' } } }, { mask: ['eTag'] });
write('designer-write-no-report', { reportName: 'INFORMES/Copias/x.rep' });
write('designer-write-no-name', { report: cust });
write('designer-write-outside', { reportName: 'INFORMES/../x.rep', report: cust });
// The files written now: their times are of the run
add({ name: 'designer-tree-after-writes', method: 'GET', path: R + '/tree', mask: ['folders.*.reports.*.modifiedUtc'] });
const exec = (name, json) => add({ name, method: 'POST', path: D + 'ExecuteReport', json, pdf: ['result.base64Pdf'] });
exec('designer-execute-stored', { reportName: 'INFORMES/Ejemplos/customers.rep' });
exec('designer-execute-document', { report: inv });
exec('designer-execute-subreports', { report: sbc, subreportIndexes: [0] });
exec('designer-execute-missing', { reportName: 'INFORMES/Ejemplos/nope.rep' });
add({ name: 'designer-sql-schema', method: 'GET', path: D + 'SqlSchema?alias=SAMPLES' });
add({ name: 'designer-sql-schema-unknown', method: 'GET', path: D + 'SqlSchema?alias=NOPE' });
add({ name: 'designer-sql-schema-no-alias', method: 'GET', path: D + 'SqlSchema', expect: 'status' });

const doc = {
  description:
    'golden-http: the same requests to Reportman.Server (C#; its answers recorded into recorded.json, see README.md) and to @reportman/server (Node, test/golden-http.test.ts), in order, on a fresh data folder with the sample reports installed (alias INFORMES, folder Ejemplos, connection SAMPLES). In a body, {$case, $path} is a value of the answer to an earlier case, {$base64file} a sample report in base64, {$json} the JSON text of a value. In an answer, mask replaces values by "<masked>", decode turns base64 into text and pdf replaces a base64 PDF by its page count.',
  cases,
};
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'cases.json'), JSON.stringify(doc, null, 2) + '\n');
console.log(cases.length + ' cases');
