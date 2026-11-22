// Generates the expression parity fixtures:
//
//   test/fixtures/eval-cases.json            the cases: { expr, format? } (plus "tz": true for the
//                                            cases whose output depends on the host time zone)
//   test/fixtures/eval-golden.<culture>.json what the C# engine gives for them (golden-cs eval)
//                                            under en-US, es-ES and pt-BR
//
// Dates come from TODAY (the only date source of an expression), so the date the fixtures were
// generated on is recorded (the first case, TODAY formatted yyyy-mm-dd) and the test pins its
// clock to it. The value checks of the date parsing cases need the built package (the candidate
// value comes from the TypeScript parser; the C# result tells whether it is the same value):
//
//   npx tsc -b packages/reportman-engine
//   node packages/reportman-engine/test/generate-eval-fixtures.mjs     (from typescript/)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const golden = path.join(root, 'typescript/tools/golden-cs/bin/Release/net10.0/golden-cs.exe');
const fixtures = path.join(here, 'fixtures');
const E = await import(pathToFileURL(path.resolve(here, '../dist/index.js')).href);

const cultures = ['en-US', 'es-ES', 'pt-BR', 'de-DE', 'fr-FR'];
const cases = [];
const add = (expr, format, extra = {}) => cases.push(format === undefined ? { expr, ...extra } : { expr, format, ...extra });
const q = (s) => "'" + s.replace(/'/g, "''") + "'";

// The generation date: first case.
add('TODAY', 'yyyy-mm-dd');

// --- Literals and the tokenizer --------------------------------------------------------------
for (const e of [
  '0', '1', '12345678', '123456789', '99999999', '100000000', '007', '$0', '$FF', '$ff', '$7FFFFFFF', '$80000000', '$FFFFFFFF',
  '$123456789', '$', '$G', '1.5', '0.5', '.5', '1.', '1.0', '1.50', '0.000', '12345678901234567.8', '1234567890123456789.12',
  '123456789012345678901', '1.2.3', '1E5', '1e5', '1E', '2E3D', '1.5E2', '15D', '15d', '15C', '15c', '15S', '15s', '15F',
  '15f', '1.5D', '0.1D', "'abc'", "'it''s'", "''", "'", "'abc", "'a'+'b'", "'a''b'''", '#65', '#65#66', '#13#10', "'a'#65'b'",
  '#', "#'x'", '#65#', "'x'#", '[TRUE]', '[abc', '[]', 'TRUE', 'true', 'True', 'FALSE', 'FALSO', 'CIERTO', 'cierto', 'NULL',
  'null', ' 1', '1 ', '  1  ', '1  ', '\t1', '1\n+2', '1\r\n+\r\n2', '1 @ 2', '1 " 2', '1 ! 2', '1 { 2', '@', '"abc"', '1;2;3',
  ';;1', '1;;', ';', ';;', '', ' ', '  ', '(1)', '((1))', '(1', '1)', '()', '(', ')', 'M.X', 'X', 'x.y.z', '_A', '.', 'AND',
  'OR', 'NOT', 'IIF', '1 2', "1 'a'", 'TRUE FALSE', '1,2', '1:2', '1:=2', '1==1', '1=<2', '1=>2', '1><2', '1<>2', '1!=2',
]) add(e);

// --- Arithmetic over every pair of value kinds ------------------------------------------------
const values = {
  Integer: ['0', '7', '-3', '2147483647-0', '12345678'],
  Long: ['INT(5)', 'INT(-9)', 'INT(0)', 'INT(922337203685477.5807)'],
  Double: ['2.5D', '0D', '-1.5D', '1E300', '3D'],
  Decimal: ['2.5', '0.0', '-1.25', '0.1', '1.00'],
  String: ["'abc'", "'7'", "'2.5'", "'2,5'", "''", "' 3 '", "'(4)'", "'1e2'", "'True'", "'-1'"],
  Boolean: ['TRUE', 'FALSE'],
  Null: ['NULL'],
  DateTime: ['TODAY', '(TODAY+0.5)'],
  Binary: ["STRINGTOBIN('QUJD')"],
};
const kinds = Object.keys(values);
const pick = (k, i) => values[k][i % values[k].length];
for (const op of ['+', '-', '*', '/']) {
  for (const a of kinds) {
    for (const b of kinds) {
      for (let i = 0; i < 2; i++) add(`${pick(a, i)} ${op} ${pick(b, i + 1)}`);
    }
  }
}
for (const e of [
  '2147483647+1', '2147483647*2', '12345678*1000', '12345678*12345678', '-2147483647-2', '$7FFFFFFF+1', '$7FFFFFFF*$7FFFFFFF',
  '0-$80000000', '-$80000000', '1/0', '-1/0', '0/0', '1.0/0', '0.0/0', '1D/0', '1/3', '2/3', '10/3', '1/4', '1.0/4', '1.0/4.0',
  '1.00/2', '1/3.0', '2/3.0', '10/3.0', '80/3.0', '1.0/8', '1.0000/8', '4/0.4', '1/0.4', '1/0.3', '100/7.0', '1.5*1.5',
  '0.1*0.1', '0.0001*0.0001', '0.00000000000001*0.00000000000001', '123456789012.5*1000000000000', '12345678901234.5*12345678901234.5',
  '1.0-1', '1-1.0', '-1.0+1', '1.0+-1', '0.0-0.0', '0-0.0', '0.0*-1', '-0.0', '--1', '---1', '-(-1)', '+1', '++1', '-+1', '+-1',
  '- 1', '-NULL', '-(NULL)', '-TRUE', "-'a'", '-TODAY', '1+-2', '1--2', '1*-2', '2*-0.5', 'NOT NULL', 'NOT 0', 'NOT 1',
  'NOT TRUE', 'NOT FALSE', 'NOT 1.5', "NOT 'a'", 'NOT INT(3)', 'NOT NOT TRUE', 'NOT(TRUE)', 'NOT (1=1)', 'NOT 1=1',
  '0.1+0.2', '0.1D+0.2D', '1E308*10', '1E-300*1E-300', '0.1D*3', '3.0*0.1', '7.0/7', '2.5+2147483647', 'INT(5)+2147483647',
  'INT(5)*INT(5)', 'INT(922337203685477.5807)*10000', 'INT(-922337203685477.5807)*10000-5808', '79228162514264337593543950335',
  '7922816251426433759354395033.5*10', '7922816251426433.759354395033*10000000000000', '1.5+NULL', 'NULL+1.5', 'NULL+NULL',
  "NULL+'a'", "'a'+NULL", 'NULL-NULL', 'NULL*NULL', 'NULL/2', '2/NULL', 'NULL+TRUE', 'TODAY+NULL', 'NULL+TODAY', 'TODAY-NULL',
  '3+TODAY-TODAY', 'TODAY-(TODAY-1)', '(TODAY+0.75)-TODAY', 'TODAY-TODAY', '5-TODAY', 'INT(5)-TODAY', '2.5D-TODAY', '2.5-TODAY',
  'TODAY+0.1D', 'TODAY+1E7', 'TODAY+1E8', 'TODAY+(0D/0)', 'TODAY+3000000', 'TODAY-800000',
]) add(e);

// --- Comparisons and logic ----------------------------------------------------------------------
for (const op of ['=', '<>', '<', '>', '<=', '>=']) {
  for (const a of kinds) {
    for (const b of kinds) add(`${pick(a, 1)} ${op} ${pick(b, 0)}`);
  }
}
for (const e of [
  "'a'<'B'", "'a'<'b'", "'B'<'a'", "'a'='A'", "'abc'='abc'", "'ñ'<'o'", "'n'<'ñ'", "'á'<'b'", "'a'<'á'", "'Z'<'a'", "'10'<'9'",
  "'10'<9", "10<'9'", "'abc'<1", "1<'abc'", "'1,5'=1.5", "'1.5'=1.5", "'1.5'=1.5D", "'True'=TRUE", "'true'=TRUE", "'-1'=TRUE",
  "'0'=FALSE", "'yes'=TRUE", "1=TRUE", "-1=TRUE", "2=TRUE", "0=FALSE", "TRUE=1", "TRUE=-1", "TRUE>FALSE", "FALSE<TRUE",
  'NULL=NULL', 'NULL<>NULL', 'NULL<1', '1<NULL', 'NULL>1', '1>NULL', 'NULL=0', '0=NULL', 'NULL<>0', "NULL=''", 'NULL<=NULL',
  "TODAY='1/1/2020'", "TODAY>'1/1/2020'", "TODAY<'1/1/2020'", "TODAY>'abc'", 'TODAY>45000', 'TODAY>45000.5', 'TODAY>45000.5D',
  'TODAY>TRUE', '1E30>1.5', '1.5<1E30', '1.5D=1.5', '0.1D=0.1', '0.3=0.1+0.2', '0.3D=0.1D+0.2D', '1/3=1.0/3', 'INT(5)=5', '5=INT(5)',
  'INT(5)=5.0', "INT(5)='5'", "STRINGTOBIN('QQ==')=STRINGTOBIN('QQ==')", "STRINGTOBIN('QQ==')=STRINGTOBIN('Qg==')",
  "STRINGTOBIN('QQ==')=NULL", "STRINGTOBIN('QQ==')=1", "STRINGTOBIN('QQ==')<>NULL", '1=1=TRUE', '1<2<3', '3>2>1', '(1<2)=(2<3)',
  'TRUE AND TRUE', 'TRUE AND FALSE', 'FALSE AND 1.5', 'TRUE AND 1.5', '1.5 AND FALSE', '1 AND 2', '0 AND 1', 'NULL AND TRUE',
  'TRUE AND NULL', 'TRUE OR 1.5', 'FALSE OR 1.5', 'FALSE OR TRUE', '1 OR 0', '0 OR 0', 'TRUE and FALSE', 'TRUE And TRUE',
  'FALSE or TRUE', 'FALSE Or TRUE', 'TRUE OR FALSE AND FALSE', '(TRUE OR FALSE) AND FALSE', 'NOT TRUE OR TRUE', 'NOT (TRUE OR TRUE)',
  '1<2 AND 2<3', '1+1=2 OR 1/0D>0', "'a' AND TRUE", 'TODAY AND TRUE', 'INT(1) AND TRUE',
]) add(e);

// --- IIF, statements ---------------------------------------------------------------------------
for (const e of [
  'IIF(TRUE,1,2)', 'IIF(FALSE,1,2)', 'IIF(NULL,1,2)', 'IIF(1,1,2)', 'IIF(1=1,1,2)', 'IIF(1=2,1,2)', "IIF(TRUE,'a',2)",
  'IIF(TRUE,1,1/0)', 'IIF(FALSE,1/0,2)', 'IIF(TRUE,1,UNKNOWN)', 'IIF(FALSE,UNKNOWN,2)', 'IIF(TRUE,1,LEFT(5,1))',
  'IIF(TRUE,IIF(FALSE,1,2),3)', 'IIF(FALSE,1,IIF(TRUE,2,3))', 'IIF(TRUE,1)', 'IIF(TRUE)', 'IIF TRUE,1,2', 'IIF(TRUE;1,2)',
  'IIF(TRUE,1,2', 'IIF(TRUE,1,2)+1', '-IIF(TRUE,1,2)', 'NOT IIF(TRUE,FALSE,TRUE)', 'iif(TRUE,1,2)', '1+IIF(FALSE,1,2)*3',
  'IIF(TRUE,1;2,3)', 'IIF((1),2,3)', '1;2', ';1', '1;', '1;2;', 'TRUE;', "1;'a';2.5", '(1;2)', 'LEFT((1;2),1)',
]) add(e);

// --- Functions -----------------------------------------------------------------------------------
for (const e of [
  "UPPERCASE('abc')", "UPPERCASE('straße')", "UPPERCASE('ñandú ı i')", 'UPPERCASE(NULL)', 'UPPERCASE(1)', "UPPERCASE('a','b')",
  "LOWERCASE('ABC')", "LOWERCASE('İ')", "LOWERCASE('ÑANDÚ Σ')", 'LOWERCASE(NULL)', 'LOWERCASE(1)', "TRIM('  a b  ')", "TRIM(#9'a'#10)",
  'TRIM(NULL)', 'TRIM(1)', "LEFT('abc',2)", "LEFT('abc',0)", "LEFT('abc',5)", "LEFT('abc',-1)", "LEFT('abc','x')", "LEFT('abc',NULL)",
  "LEFT('abc',INT(2))", "LEFT('abc',2.5)", 'LEFT(NULL,2)', 'LEFT(5,1)', "LEFT('abc')", "RIGHT('abc',2)", "RIGHT('abc',5)",
  "RIGHT('abc',0)", "RIGHT('abc',-1)", 'RIGHT(NULL,1)', 'RIGHT(5,1)', "SUBSTR('abcdef',2,3)", "SUBSTR('abcdef',0,3)",
  "SUBSTR('abcdef',-1,3)", "SUBSTR('abcdef',5,10)", "SUBSTR('abcdef',7,2)", "SUBSTR('abcdef',2,0)", "SUBSTR('abcdef',2,-1)",
  "SUBSTR('',1,1)", 'SUBSTR(NULL,1,1)', 'SUBSTR(5,1,1)', "SUBSTR('abc','1',1)", "LENGTH('abc')", "LENGTH('')", 'LENGTH(NULL)',
  'LENGTH(5)', "LENGTH('😀')", "POS('b','abc')", "POS('z','abc')", "POS('','abc')", "POS('B','abc')", 'POS(NULL,1)', "POS(1,'abc')",
  "POS('a',1)", "POS(#10,'a'#13#10'b')", "POS(#13#10,'a'#13#10'b')", "POS('e','e'#769)", "POS(#0,'abc')", "POS('ab','a'#173'b')",
  "REPLACESTR('abcabc','b','X')", "REPLACESTR('abc','','X')", "REPLACESTR('abc','b','')", "REPLACESTR(1,'b','c')",
  "REPLACESTR('a',1,'c')", "REPLACESTR('a','b',1)", "REPLACESTR('aaa','aa','b')", 'STR(1.5)', 'STR(1.50)', 'STR(NULL)', 'STR(TRUE)',
  'STR(INT(5))', 'STR(2.5D)', 'STR(1E20)', "STR('a')", "STR(STRINGTOBIN('QQ=='))", 'ISINTEGER(\'12\')', "ISINTEGER(' 12 ')",
  "ISINTEGER('1.5')", "ISINTEGER('2147483648')", "ISINTEGER('-2147483648')", "ISINTEGER('+5')", "ISINTEGER('')", "ISINTEGER('1,000')",
  'ISINTEGER(12)', 'ISINTEGER(NULL)', "ISNUMERIC('1.5')", "ISNUMERIC('1,5')", "ISNUMERIC('1,000.5')", "ISNUMERIC('1.000,5')",
  "ISNUMERIC('abc')", "ISNUMERIC('')", "ISNUMERIC('NaN')", "ISNUMERIC('∞')", "ISNUMERIC('Infinity')", "ISNUMERIC('1e5')",
  "ISNUMERIC(' 1 ')", "ISNUMERIC('-1')", "ISNUMERIC('(1)')", "ISNUMERIC('$1')", 'ISNUMERIC(1)', "MAX(1,2)", 'MAX(2,1)', 'MAX(1,2.5)',
  "MAX('a','b')", "MAX('b','a')", 'MAX(NULL,1)', 'MAX(1,NULL)', "MAX(1,'a')", "MAX('2',10)", 'MAX(TODAY,TODAY+1)', 'MAX(TRUE,FALSE)',
  'SIN(0)', 'SIN(1)', 'SIN(1.5)', 'SIN(INT(2))', 'SIN(NULL)', "SIN('a')", 'SIN(1E10)', 'SIN(3.141592653589793D)', 'ABS(-5)',
  'ABS(5)', 'ABS(-5.5)', 'ABS(-2.5D)', 'ABS(INT(-7))', 'ABS(NULL)', "ABS('a')", 'ABS(-$80000000)', 'ABS(0.0-0.0)',
  'ROUND(1.255,0.01)', 'ROUND(2.5,1)', 'ROUND(-2.5,1)', 'ROUND(NULL,1)', "ROUND('a',1)", "ROUND(1,'a')", 'ROUND(7,2)', 'ROUND(1.5D,1)',
  'ROUNDTOINTEGER(2.5)', 'ROUNDTOINTEGER(3.5)', 'ROUNDTOINTEGER(-2.5)', 'ROUNDTOINTEGER(2.5D)', 'ROUNDTOINTEGER(1E30)',
  'ROUNDTOINTEGER(NULL)', 'ROUNDTOINTEGER(7)', 'INT(2.7)', 'INT(-2.7)', 'INT(2.7D)', 'INT(1E30)', 'INT(1E18)', 'INT(NULL)', "INT('5')",
  "VAL('123')", "VAL('')", 'VAL(5)', 'VAL(NULL)', 'VAL(TRUE)', 'MOD(7,3)', 'MOD(-7,3)', 'MOD(7,-3)', 'MOD(5,0)', 'MOD(INT(7),2)',
  'MOD(7.5,2)', 'MOD(NULL,2)', 'MOD(INT(-922337203685477.5807)*10000-5808,-1)', 'COMPAREVALUE(1,1.05,0.1)', 'COMPAREVALUE(1,2,0.1)',
  'COMPAREVALUE(2,1,0.1)', 'COMPAREVALUE(1,1.1,0.1)', 'COMPAREVALUE(1,1.1,-0.1)', 'COMPAREVALUE(1,2,NULL)', 'COMPAREVALUE(1.5D,1.5,0)',
  'NUMTOTEXT(0,FALSE)', 'NUMTOTEXT(1234.56,FALSE)', 'NUMTOTEXT(21,TRUE)', 'NUMTOTEXT(-15.5,FALSE)', 'NUMTOTEXT(1000000,FALSE)',
  'NUMTOTEXT(1234567891,FALSE)', 'NUMTOTEXT(18,FALSE)', 'NUMTOTEXT(99.999,FALSE)', 'NUMTOTEXT(1,1)', "NUMTOTEXT('1',FALSE)",
  'NUMTOTEXT(2.5D,FALSE)', 'MONTHNAME(1)', 'MONTHNAME(12)', 'MONTHNAME(13)', 'MONTHNAME(0)', 'MONTHNAME(TODAY)', 'MONTHNAME(NULL)',
  "MONTHNAME('a')", 'MONTHNAME(INT(3))', 'DAY(TODAY)', 'MONTH(TODAY)', 'YEAR(TODAY)', 'DAY(NULL)', 'DAY(5)', 'MONTH(5)', 'YEAR(5)',
  'YEAR(NULL)', "STRINGTOBIN('QQ==')", "STRINGTOBIN('')", "STRINGTOBIN('Q')", "STRINGTOBIN('QQ=')", "STRINGTOBIN('@@@@')",
  "STRINGTOBIN('QQ==QQ==')", 'STRINGTOBIN(NULL)', 'STRINGTOBIN(1)', 'FILEEXISTS(NULL)', "FILEEXISTS('Z:\\\\no\\\\such\\\\file.txt')",
  "FILEEXISTS('')", 'FILEEXISTS(1)', 'FLOATTODATETIME(45000)', 'FLOATTODATETIME(NULL)', "FLOATTODATETIME('a')", "EVALTEXT('1+2')",
  "EVALTEXT('')", "EVALTEXT('LEFT(''abc'',1)')", "EVALTEXT('UNKNOWN')", "EVALTEXT('1+')", 'EVALTEXT(1)', "EVALTEXT('EVALTEXT(''2*3'')')",
  "CHECKEXPRESSION('1=1','bad')", "CHECKEXPRESSION('1=2','bad')", "CHECKEXPRESSION('0','zero')", "CHECKEXPRESSION('NULL','n')",
  "CHECKEXPRESSION('''a''','s')", "CHECKEXPRESSION(1,'a')", "CHECKEXPRESSION('1=1',1)", "FORMATSTR('0.00',1.5)", "FORMATNUM('#,##0',1234567)",
  'FORMATSTR(5,1)', "FORMATSTR('x',NULL)", "FORMATSTR('',1.5)", "FORMATSTR('dd/mm/yyyy',TODAY)", "FORMATSTR('{0}','a')",
  "LEFT(LEFT('abc',2),1)", "LEFT('abc',LEFT('5',1))", "LEFT('abcdef',LENGTH('abc'))", "SUBSTR('abcdef',POS('c','abcdef'),2)",
  "NOT ISINTEGER('5')", '-ABS(5)', '-ABS(-5)', 'NOT ISNUMERIC(\'a\')', "UPPERCASE(LOWERCASE('AbC'))", 'MAX(MAX(1,2),3)',
  'TODAY()', 'NOW()', 'TRUE()', "LEFT 'abc',1", "LEFT('abc' 1)", "LEFT('abc',1", "LEFT('abc';1)", 'UNKNOWNFN(1)', "M.LEFT('a',1)",
  "[LEFT]('abc',1)", 'ABS', 'ABS 5', 'NULL(1)',
]) add(e);

// --- The functions of the Delphi engine (EvalFunctionsDelphi.cs) ---------------------------------
// The C# results of these were compared with the Delphi evaluator (TRpEvaluator) on 22-11-2026,
// these cases and 1,030 random ones in es-ES, en-US and de-DE, all the same. LOADFILE and
// GETINIVALUE read files: test/delphifunctions.test.ts.
for (const e of [
  "CHSTOCHT('简体中文测试')", "CHTTOCHS('繁體中文測試')", "CHSTOCHT('发 髮 發 abc')", "CHTTOCHS('發 髮 发')", "CHSTOCHT('')", 'CHSTOCHT(NULL)',
  'CHTTOCHS(1)', "chstocht('国际')", "CHTTOCHS(CHSTOCHT('汉字'))", "CHSTOCHT('Report Manager')",
  'SQRT(16)', 'SQRT(2)', 'SQRT(0)', 'SQRT(2.25)', "SQRT('4')", 'SQRT(NULL)', 'SQRT(1E300)',
  "HOURMINSEC(1.5,'h ','m ','s')", "HOURMINSEC(0,'h','m','s')", "HOURMINSEC(2.999999,':',':','')", "HOURMINSEC(1.0083333333,'h','m','s')",
  "HOURMINSEC(25.25,'h','m','s')", "HOURMINSEC(0.0125,'h','m','s')", "HOURMINSEC(0.999999999,'h','m','s')", "HOURMINSEC(-1.5,'h','m','s')",
  "HOURMINSEC(-0.25,'h','m','s')", "HOURMINSEC(10,'','','')", "HOURMINSEC('1','h','m','s')", "HOURMINSEC(1,1,'m','s')", "HOURMINSEC(NULL,'h','m','s')",
  "FORMATMASK('000-000;0;_','123456')", "FORMATMASK('000-000;1;_','123456')", "FORMATMASK('000-000;1;_','123-456')",
  "FORMATMASK('(999) 000-0000;1;_','5551234567')", "FORMATMASK('(999) 000-0000;0;_','5551234567')", "FORMATMASK('>L<ll;0;_','aBC')",
  "FORMATMASK('!99/99/9999;1;_','01022024')", "FORMATMASK('!99/99/9999;0;_','01022024')", "FORMATMASK('00.000.000/0000-00;0;_','12345678000195')",
  "FORMATMASK('000.000.000-00;0;_','12345678901')", "FORMATMASK('00000-000;0;_','88010100')", "FORMATMASK('!00000;0;_','12')",
  "FORMATMASK('\\(000\\);0;_','123')", "FORMATMASK('\\(000\\);1;_','123')", "FORMATMASK('000:00;1;_','12345')", "FORMATMASK('00/00/0000;1;_','1/2/2024')",
  "FORMATMASK('','abc')", "FORMATMASK('000',NULL)", "FORMATMASK('000-000;;_','123456')", "FORMATMASK(1,'a')", "FORMATMASK('000',123)",
  "ASC2('ÁÉÍÓÚáéíóúÇçÑñÀàÂâÃãÄäÜüÿ abc €')", "ASC2('ÈËÌÏÒÕÖÙÛÆæØøÅåÝýÐðÞþß')", 'ASC2(123)', 'ASC2(NULL)',
  "DECODE64('SGVsbG8=')", "DECODE64('w6E=')", "DECODE64('')", "DECODE64('SGVsbG8')", "DECODE64('SGVs bG8=')", "DECODE64('bad!')",
  "DECODE64('/w==')", "DECODE64('gIGCgw==')", 'DECODE64(5)', 'DECODE64(NULL)',
  "UTF8TOWIDESTRING('Ã¡Ã©')", 'UTF8TOWIDESTRING(NULL)', "UTF8TOWIDESTRING('€')", "UTF8TOWIDESTRING('Ã')", "UTF8TOWIDESTRING('â‚¬')",
  "UTF8TOWIDESTRING('ä½ å¥½')", 'UTF8TOWIDESTRING(12)', "UTF8TOWIDESTRING(DECODE64('w6E='))",
  "IDENTEXISTS('TODAY')", "IDENTEXISTS('today')", "IDENTEXISTS('NOPE')", "IDENTEXISTS('M.X')", "IDENTEXISTS('')", 'IDENTEXISTS(1)',
  'TIME>0', 'TIME<1', 'YEAR(TIME)', "LOADFILE('')", "GETINIVALUE('','a','b','c')",
]) add(e);
{
  // Random masks, base64 texts and hours (a fixed seed), as in the comparison with Delphi
  let seed = 12345;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const pick = (s) => s[rnd(s.length)];
  for (let i = 0; i < 200; i++) {
    let mask = '';
    const len = 1 + rnd(12);
    for (let j = 0; j < len; j++) mask += pick('0009#LlAaCc-().:/ \\!><');
    const tail = rnd(5);
    if (tail === 1) mask += ';0;_';
    else if (tail === 2) mask += ';1;_';
    else if (tail === 3) mask += ';0';
    else if (tail === 4) mask += pick([';1; ', ';;*', ';0;', ';1']);
    let value = '';
    const vlen = rnd(14);
    for (let j = 0; j < vlen; j++) value += pick('0123456789abcXYZ- /.:é');
    add(`FORMATMASK(${q(mask)},${q(value)})`);
  }
  for (let i = 0; i < 40; i++) {
    let s = '';
    const len = rnd(17);
    for (let j = 0; j < len; j++) s += pick('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/= !-_');
    add(`DECODE64(${q(s)})`);
  }
  for (let i = 0; i < 30; i++) add(`HOURMINSEC(${(rnd(2000000) - 200000) / (1 + rnd(7) * 1000)},'h','m','s')`);
}

// --- Formats ------------------------------------------------------------------------------------
const numberValues = ['0', '1', '-1', '5', '1234', '-1234', '1234567', 'INT(123456789012)', '0.5', '1.5', '2.5', '-2.5', '0.125', '0.375',
  '1.005', '-0.001', '-0.0', '1234.5678', '1234567.891', '0.000123', '12345.6789', '1.5D', '2.5D', '0.1D', '1E20', '1E-10D', '123.456',
  '1000000000000005', '1000000000000015', '0D/0', '1/0', '-1/0', '0.1+0.2', '1/3'];
const numberFormats = ['0', '0.00', '#,##0', '#,##0.00', '#.##', '#', '0.#', '00000', '#,#', '#,##0,', '#,##0,,', '0,0', '0.0;minus',
  '0.0;(0.0)', '0.0;(0.0);zero', '#;(#);zero', '0.0;', '0.0;;zero', '0%', '0.00%', '0‰', '0.00E+00', '0.0e-0', '0E0', '#E+0', '0.###E+000',
  "'abc'0", '\\#0', "0'.'00", '0.00 €', '$#,##0.00', '[0]', '{0}', '0x', 'x0', '0.0E', 'E0', 'N', 'N0', 'N2', 'N5', 'F', 'F0', 'F2',
  'F3', 'C', 'C0', 'C2', 'P', 'P0', 'P1', 'E', 'E0', 'E2', 'e3', 'G', 'G3', 'G10', 'G29', 'R', 'D', 'D5', 'X', 'x8', '*0.00', '*N2', '*',
  '0.00;-0.00;0', ';;', ';', '%0', '0.0\\%', "0.0'%'", 'Q', 'n1', 'f1', '#,##0.00;[#,##0.00]', ',0', '0,.00', '#0.0#', '00.00',
  '0.0000000000000000000', '#.##############'];
for (const v of numberValues) for (const f of numberFormats) add(v, f);

const dateOffsets = [0, 0.5, 0.75, 0.999988425925926, -100, -5000, 1000, 0.123456, 0.0000115740740740741, -30000, -270000];
const dateFormats = ['dd/mm/yyyy', 'd/m/yy', 'dd-mm-yyyy hh:nn:ss', 'dd/MM/yyyy HH:mm:ss', 'hh:nn', 'hh:nn am/pm', 'h:n a/p',
  'h:nn AMPM', 'hh:nn:ss.zzz', 'hh:nn:ss.z', 'yyyy-mm-dd', 'yyyymmdd', 'yy', 'yyyyy', 'y', 'ddd', 'dddd', 'mmm', 'mmmm', 'd mmmm yyyy',
  'dddd, d mmmm', 'mmmm yyyy', 'd', 'D', 'f', 'F', 'g', 'G', 'm', 'M', 's', 't', 'T', 'u', 'y', 'Y', 'c', 'cc', 'gg', 'z', 'zz', 'zzz',
  'HH:mm:ss.fffffff', 'HH:mm:ss.FFFFFFF', 'HH:mm:ss.FFF', 'HH:mm:ss.F', 'ss.fff', "'quoted' \"dq\" \\x", "dd 'de' mmmm 'de' yyyy",
  '%d', '%h', '%', "'", "dd 'abc", 'dd/mm/yyyy \\', 'q', 'X', 'hh mm', 'nn:ss', 'm/d', 'mm:ss', 'h:mm', 'hh:mm', 'tt', 't', 'hh:nn t',
  'yyyy-MM-ddTHH:mm:ss', 'MM', 'MMM', 'MMMM', 'M/d', 'd MMMM', 'dd MMM', 'HH', 'H', 'fffffffff', 'dd.MM.yyyy', 'dd/mm/yyyy hh:nn:ss am/pm', ''];
for (const off of dateOffsets) for (const f of dateFormats) add(`TODAY+${off}`, f);
for (const f of ['o', 'O', 'r', 'R', 'U', 'K', '%K', 'yyyy-MM-ddTHH:mm:ssK', 'zzz']) for (const off of [0, 0.75, -150]) add(`TODAY+${off}`, f, { tz: true });

const stringFormats = ['', '{0}', '>{0}<', '{0,6}', '{0,-6}|', '{{0}}', '{0:N2}', '{0} {0}', '{', '}', '{1}', '{0', '{a}', '{0,}', '{0,x}',
  '{ 0}', '{0 }', '{0 ,3}', '{0, 3}', '}}', 'abc', '{0:}', '{0:{', '{00}', '{0,30}', '{0,-12}'];
for (const v of ["'abc'", "''", 'TRUE', 'FALSE']) for (const f of stringFormats) add(v, f);
for (const f of ['', '0.00', 'dd/mm/yyyy', '{0}']) for (const v of ['NULL', "STRINGTOBIN('QQ==')"]) add(v, f);

// --- The sign of decimal zeros (visible through a double format) and string collation ----------
for (const e of ['1.0-1', '1-1.0', '-1.0+1', '1.0+-1', '0.0*-1', '-0.0*1', '0.00/-5', '-1.5+1.5', '1.5-1.5', '(-0.0)+0', '0+(-0.0)',
  '-123456789012.5*0', '123456789012.5*-0.0', '-1.5*0.00', '-0.0000000000000001*0.0000000000000001', '-0.00000000000001*0.0000000000001*0.001',
  '0.0/-1', '-(0.0)', '-(1.0-1)', '0-0.0', '-0.0-0', '(1.0-1)*-1', '-1/3.0+1/3.0', '1E-28D*-1', '-1E-300']) add(e, '0.0');
for (const e of ["'a'<'A'", "'A'<'a'", "'a'='a'#0", "'ab'<'a'#173'c'", "'résumé'<'resume'", "'resume'<'résumé'", "'Ä'<'B'", "'z'<'Å'",
  "'ch'<'d'", "'ll'<'m'", "'1'<'A'", "'-'<'a'", "' '<'a'", "'a b'<'ab'", "'Œ'<'oe'", "'ß'='ss'", "'Straße'<'Strasse'"]) add(e);

// --- Unicode in the tokenizer and the string functions (built from code points) ----------------
{
  const c = (...cps) => String.fromCodePoint(...cps);
  for (const e of [c(0xf1), c(0x663), '1' + c(0x663), "'a'#" + c(0x663), '$' + c(0xff41), c(0xff21), '1' + c(0xa0) + '+1',
    '1' + c(0x2028) + '+2', '1' + c(0x85) + '+2', '1' + c(0x3000) + '+2', c(0x2160), '_1', '__', 'A1.B2', '1' + c(0xfeff) + '+2',
    c(0x1d400), '1E' + c(0x663), '[a]' + c(0x663), "UPPERCASE('" + c(0x1f600) + "')", "LENGTH('" + c(0x1f600) + "')",
    "UPPERCASE('" + c(0x1f80) + "')", "LOWERCASE('" + c(0x1e9e) + "')", "UPPERCASE('" + c(0x149) + "')", "UPPERCASE('" + c(0x1c5) + "')",
    "TRIM('" + c(0x85) + 'a' + c(0x200b) + "')", "TRIM('" + c(0x180e) + "a')", "LEFT('" + c(0x1f600) + "',1)",
    "SUBSTR('a" + c(0x1f600) + "b',2,1)", "POS('" + c(0x1f600) + "','x" + c(0x1f600) + "')"]) add(e);
}

// --- Random decimals and doubles (a fixed seed): arithmetic and formatting ------------------------
let seed = 20261121;
const rnd = () => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return seed / 4294967296;
};
const digits = (n) => {
  let s = String(1 + Math.floor(rnd() * 9));
  for (let i = 1; i < n; i++) s += String(Math.floor(rnd() * 10));
  return s;
};
const randomDecimal = () => {
  const total = 1 + Math.floor(rnd() * 18);
  const scale = Math.floor(rnd() * Math.min(total, 10));
  const d = digits(total);
  const s = scale === 0 ? d + '.0' : d.slice(0, total - scale).padStart(1, '0') + '.' + d.slice(total - scale);
  return (rnd() < 0.3 ? '-' : '') + (s.startsWith('.') ? '0' + s : s);
};
for (let i = 0; i < 250; i++) {
  const op = ['+', '-', '*', '/'][i % 4];
  add(`(${randomDecimal()})${op}(${randomDecimal()})`, '');
}
for (let i = 0; i < 60; i++) add(`(${randomDecimal()})*(${randomDecimal()})*(${randomDecimal()})/(${randomDecimal()})`);
const doubleFormats = ['', 'G', 'G5', 'G17', 'R', 'E3', 'e10', 'F4', 'N2', 'F0', '0.000', '#,##0.##', '0.00E+00', '#.###############', 'P2', 'C'];
for (let i = 0; i < 150; i++) {
  const a = digits(1 + Math.floor(rnd() * 12));
  const b = digits(1 + Math.floor(rnd() * 6));
  const e = Math.floor(rnd() * 40) - 20;
  add(`${a}D/${b}*1E${e < 0 ? 0 : e}/1E${e < 0 ? -e : 0}`, doubleFormats[i % doubleFormats.length]);
}

// --- Date parsing: ISVALIDDATETIME and the parsed value -----------------------------------------
const dateTexts = [
  '2024-01-15', '2024-1-5', '2024/01/15', '2024.01.15', '2024-01-15 10:30', '2024-01-15T10:30:00', '2024-01-15T10:30:00Z',
  '2024-01-15T10:30:00.1234567', '2024-01-15T10:30:00+02:00', '2024-01-15T10:30:00-0530', '2024-01-15 10:30:45.123', '1/15/2024',
  '15/1/2024', '01/15/24', '15/01/24', '1/15', '15/1', '1/2', '13/13/2024', '2/30/2024', '2/29/2024', '2/29/2023', '15.01.2024',
  '15-01-2024', '01-15-2024', '15.1.24', '1.2.3', '1/2/3', '24/1/2', 'January 15, 2024', '15 January 2024', 'Jan 15 2024', '15-Jan-2024',
  'Monday, January 15, 2024', 'Tuesday, January 15, 2024', 'January 2024', '15 January', 'January 15', 'jan 15', 'JANUARY 15 2024',
  'enero 15 2024', '15 de enero de 2024', '15 enero 2024', 'lunes, 15 de enero de 2024', 'janeiro 15 2024', '15 de janeiro de 2024',
  '10:30', '10:30:45', '10:30 PM', '10:30PM', '10 PM', '10PM', '10 AM', '22:30', '22:30:45.123', '25:00', '10:61', '1/15/2024 10:30:00 AM',
  '1/15/2024 10:30 PM', '15/01/2024 22:30', '2024', '15', 'abc', '', '  ', '10:30:45 PM', '12:00 AM', '12:00 PM', '0:00', 'a.m.',
  '10 a. m.', '10:30 p. m.', '1/15/2024 25:00', '2024-13-01', '2024-00-10', '2024-01-00', '0001-01-01', '9999-12-31', '10000-01-01',
  '1/1/1', '1/1/0001', '1/1/99', '1/1/49', '1/1/50', '1/1/2049', '1/1/30', '2024-01-15 Z', 'T10:30', '2024-01-15T', '15:30 15/1/2024',
  '1/15/2024,10:30', '1/15/2024, 10:30', 'Jan 2024', '2024 Jan', '2024 Jan 15', '15 2024 Jan', '2024-Jan-15', 'Jan-15-2024', '1-Jan-24',
  '24-Jan-1', '45000', '1.5', '1,5', '1/10 5 AM', '10:30:00 GMT', '10:30 +01:00', '#1/15/2024#', '2024-01-15T10:30', '2024-01-15T1:30',
  '2024-01-15 10:30:45 +02:00', '15/1/2024 10:30:45.5', ' 2024-01-15 ', 'Mon 15 Jan 2024', 'dom., 14 ene. 2024', '14 ene 2024', 'sept 15',
  '15 févr. 2024', '1 PM 1/2', 'PM 10:30', '10:30 AM PM', '2024-01-15 2024-01-16', '10:30 11:30', '1/2/3/4', '30 February', '31 abr 2024',
];
const today = new Date();
const now = E.RpDateTime.create(today.getFullYear(), today.getMonth() + 1, today.getDate(), 12, 0, 0, 0, E.DateTimeKind.Local);
const tz = {
  utcOffsetMinutes: (dt) => -new Date(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second).getTimezoneOffset(),
  utcOffsetMinutesFromUtc: (dt) => -new Date(Date.UTC(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second)).getTimezoneOffset(),
};
const zoned = (s) => /Z|GMT|[+-]\d\d:?\d\d$|[+-]\d\d:\d\d /.test(s);
for (const s of dateTexts) add(`ISVALIDDATETIME(${q(s)})`, undefined, zoned(s) ? { tz: true } : {});
// The value checks: the TypeScript parse of each culture gives the candidate; both engines compare
// the text with a one millisecond window around it.
const rangeCases = {};
for (const culture of cultures) {
  const ci = E.CultureInfo.get(culture);
  for (const s of dateTexts) {
    const p = E.tryParseDateTime(s, ci, now, tz);
    if (p === undefined) continue;
    const days = Number(p.ticksSince(now.date)) / 864e9;
    const expr = `(${q(s)} >= TODAY + (${days - 0.5 / 86400000})) AND (${q(s)} <= TODAY + (${days + 0.5 / 86400000}))`;
    (rangeCases[culture] ??= []).push(zoned(s) ? { expr, tz: true } : { expr });
  }
}

fs.mkdirSync(fixtures, { recursive: true });
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-eval-'));
for (const culture of cultures) {
  const all = [...cases, ...(rangeCases[culture] ?? [])];
  const inFile = path.join(tmp, 'cases.json');
  const outFile = path.join(tmp, 'out.json');
  fs.writeFileSync(inFile, JSON.stringify(all.map(({ expr, format }) => (format === undefined ? { expr } : { expr, format }))));
  execFileSync(golden, ['eval', inFile, outFile, '--culture', culture]);
  const results = JSON.parse(fs.readFileSync(outFile, 'utf8').replace(/^\uFEFF/, ''));
  const dates = new Set([results[0].formatted]);
  // the date must not have changed during the run
  execFileSync(golden, ['eval', inFile, outFile, '--culture', culture]);
  const again = JSON.parse(fs.readFileSync(outFile, 'utf8').replace(/^\uFEFF/, ''));
  dates.add(again[0].formatted);
  if (dates.size !== 1) throw new Error('The date changed while generating; run again');
  // One line per result: [type, text] or [type, text, formatted]; an error is ["!", class, message].
  const rows = results.map((r) =>
    JSON.stringify(r.error !== undefined ? ['!', r.error, r.message] : r.formatted !== undefined ? [r.type, r.text, r.formatted] : [r.type, r.text]),
  );
  const extra = (rangeCases[culture] ?? []).map((c) => JSON.stringify(c));
  const head = { culture, today: results[0].formatted, timeZone };
  fs.writeFileSync(
    path.join(fixtures, `eval-golden.${culture}.json`),
    JSON.stringify(head).slice(0, -1) + ',\n"extra":[\n' + extra.join(',\n') + '\n],\n"results":[\n' + rows.join(',\n') + '\n]}\n',
  );
  console.log(culture, results.length, 'results');
}
fs.writeFileSync(path.join(fixtures, 'eval-cases.json'), '[\n' + cases.map((c) => JSON.stringify(c)).join(',\n') + '\n]\n');
fs.rmSync(tmp, { recursive: true, force: true });
console.log('cases', cases.length);
