// The probes of the comparison of the Delphi evaluator with the C# one, beyond the fixtures of
// @reportman/engine: edge inputs of every function of rpevalfunc.pas that needs no report, the
// semantics of the operators, rounding, conversions, IIF and the constants. None depends on the
// clock (dates come from FLOATTODATETIME), so both engines can run them at any time.
//
//   node probes.mjs probes.json        then: node compare.mjs cases <culture> <outdir> probes.json
import fs from 'node:fs';

const cases = [];
const add = (expr, format) => cases.push(format === undefined ? { expr } : { expr, format });
const all = (list, format) => list.forEach((e) => add(e, format));

// --- Number literals -----------------------------------------------------------------------------
all(['1.5E3', '1e-3', '0x10', '$10', '1_000', '1,5', '.5', '5.', '00012', '1.50', '2147483647', '2147483648', '4294967295', '9999999999',
  '123456789012', '9223372036854775807', '9223372036854775808', '1E308', '1E309', '1E-324', '0.1D', '1E2D', '1.5F', '-2147483648', '-2147483649',
  '1000000000000', '0.1', '0.10', '1.0', '100000000000000000000.5', '0.00000000000000000001', '1.23456789012345678901234567890']);
// --- String literals -----------------------------------------------------------------------------
all(["'a'", "'a''b'", '"a"', '"a""b"', "'a'+#13+#10+'b'", "#65+#66", "'a' #66 'c'", "''''", "'á€😀'", "'a\\nb'", "' '", "'\t'", "LENGTH('a'#13#10'b')", "'a\r\nb'",
  "LENGTH('a\r\nb')", "LENGTH('a\nb')", "#0", "LENGTH(#0)", "#255", "#256", "#8364", "#65536", "#-1", "#$41"]);

// --- Operator semantics ---------------------------------------------------------------------------
// integer and float division
all(['7/2', '6/3', '1/3', '10/4', '7/2*2', '-7/2', '2147483647/2', '1/3*3', '6/3=2', '7/2=3.5', '1/3*3=1', '10/5', '0/5', '5/0', '5.5/0', '5/0.0', '0/0', '5.0/2', '5/2.0',
  '1/3+1/3+1/3', '1/3+1/3+1/3=1', '2/3', '100/3', '1/7', '22/7', '1/8', '3/4', '1E10/3', '9/3', '10/3*3', '(1/3)*3=1', '1/1', '4/2', '1000000/1000']);
// integer overflow
all(['2147483647+1', '46341*46341', '100000*100000', '65536*65536', '2000000000+2000000000', '-2147483647-10', '1000000*1000000', '99999*99999', '50000*50000',
  '2147483647*2', '2147483647-(-1)', '-2147483648-1', '1000*1000*1000*1000', '300000*10000', '2147483647+0.5', '2147483647+1.0', '65535*65537', '46340*46340',
  '123456*100000', '1500000*2000', '1500000*2000.0', '1500000*2000/1000', '12345678*100/100']);
// decimals against binary doubles
all(['0.1+0.2', '0.1+0.2=0.3', '1.1*1.1', '1.1*1.1=1.21', '100*1.1', '100*1.1=110', '2.675*100', '0.1*3', '0.1*3=0.3', '1.15*100', '4.35*100', '0.7+0.1', '0.7+0.1=0.8',
  '1.005*1000', '19.99*100', '19.99*100=1999', '0.57*100', '3*1.1', '3*1.1=3.3', '1-0.9', '1-0.9=0.1', '0.3-0.1', '8.2-0.2=8', '1.4*3', '33.33*3', '1.1+2.2=3.3',
  '10.0/3*3=10', '0.1+0.7', '1234.5678*100', '0.1D+0.2D=0.3D', '1.1D*1.1D']);
// string with number
all(["'a'+1", "1+'a'", "'1'+1", "1+'1'", "'1'+'1'", "'1.5'+1", "1.5+'1'", "'a'+1.5", "'a'+TRUE", "TRUE+'a'", "'a'+NULL", "NULL+'a'", "'2'*'3'", "'2'*3", "3*'2'",
  "'6'/'2'", "'6'/2", "6/'2'", "'6'-'2'", "'6'-2", "6-'2'", "'a'-1", "1-'a'", "'a'*2", "2*'a'", "'a'/2", "''+1", "1+''", "' 1 '+1", "'1e2'+1", "'1,5'+1", "'1.5'+1.5",
  "'a'+'b'+1", "1+2+'a'", "'a'+1+2", "'a'+(1+2)", "1+'a'+2", "'Total: '+10", "'Total: '+10.50", "'Total: '+1/3", "10+' units'", "'x'+1.0", "'x'+1.10", "'x'+100000000000",
  "'x'+1E20", "'x'+0.000001", "'x'+(0.1+0.2)", "'x'+7/2", "'x'+2/3", "'x'+FLOATTODATETIME(45000)", "'x'+FLOATTODATETIME(45000.5)", "FLOATTODATETIME(45000)+'x'",
  "'x'+INT(5)", "'x'+(1=1)", "'12'+'34'", "'12'+34", "12+'34'", "''+''", "'a'+''", "'1'+1+1", "1+1+'1'", "'5'+5.5", "'-1'+1", "'+1'+1", "'0x10'+1", "'$10'+1", "'1 2'+1"]);
// comparisons of mixed types
all(["1='1'", "'1'=1", "1='a'", "'a'=1", "1<'2'", "'10'<9", "9<'10'", "1.0=1", "1='1.0'", "'1.0'=1", "TRUE=1", "1=TRUE", "TRUE='True'", "TRUE='TRUE'", "TRUE=-1", "FALSE=0",
  'NULL=NULL', 'NULL<>NULL', '1=NULL', 'NULL=1', 'NULL<1', 'NULL>1', '1<NULL', '1>NULL', 'NULL<=1', 'NULL>=1', '1<=NULL', '1>=NULL', '1<>NULL', 'NULL<>1', "''=NULL", "NULL=''",
  "'a'<NULL", "'a'>NULL", "'a'=NULL", "'a'<>NULL", "NULL<'a'", "NULL>'a'", 'FLOATTODATETIME(45000)=NULL', 'FLOATTODATETIME(45000)>NULL', 'FLOATTODATETIME(45000)<NULL',
  'NULL<FLOATTODATETIME(45000)', 'TRUE=NULL', 'NULL=TRUE', 'FALSE=NULL', 'NULL=FALSE', 'TRUE>NULL', '0=NULL', '0<NULL', '0>NULL', '-1<NULL', '-1>NULL', "''<NULL", "''>NULL",
  'NULL<NULL', 'NULL>NULL', 'NULL<=NULL', 'NULL>=NULL', '0.0=NULL', '0D=NULL',
  "'abc'='ABC'", "'abc'<'ABD'", "'a '='a'", "'a'='a '", "''=''", "' '=''", "'abc'<>'ABC'", "'a'<'B'", "'B'<'a'", "'a'>'B'", "'abc'<'abd'", "'abc'<'abcd'", "'Z'<'a'", "'z'<'A'",
  "'é'='e'", "'É'='é'", "'ñ'='Ñ'", "'ñ'>'n'", "'ñ'<'o'", "'ä'='Ä'", "'ß'='SS'", "'a'<'_'", "'a'<'1'", "'A'<'1'", "'-a'<'b'", "'co-op'<'coop'", "'a b'<'ab'", "'10'<'9'", "'10'<'2'",
  "'abc'>='ABC'", "'abc'<='ABC'", "'b'>'A'", "'a'='á'",
  '1=1.0', '1<1.5', '2>1.5', '1.5=1.5D', '0.1=0.1D', '1=INT(1)', '0.1+0.2=0.3D', '1/3=0.333333333333333', '2147483647<2147483648', '1E10>1', '1.0=1.00', '0.30=0.3',
  'FLOATTODATETIME(45000)=45000', '45000=FLOATTODATETIME(45000)', 'FLOATTODATETIME(45000)>44999', 'FLOATTODATETIME(45000)<45000.5', 'FLOATTODATETIME(45000.5)>45000',
  'FLOATTODATETIME(45000)=FLOATTODATETIME(45000.0)', 'FLOATTODATETIME(45000)<FLOATTODATETIME(45001)', 'FLOATTODATETIME(45000)<>FLOATTODATETIME(45000)',
  "FLOATTODATETIME(45000)='15/03/2023'", "FLOATTODATETIME(45000)='3/15/2023'", "FLOATTODATETIME(45000)='2023-03-15'", "FLOATTODATETIME(45000)>'1/1/2020'", "FLOATTODATETIME(45000)<'1/1/2030'",
  "'1/1/2030'>FLOATTODATETIME(45000)", "FLOATTODATETIME(45000)='abc'", "FLOATTODATETIME(45000)>'abc'", "FLOATTODATETIME(45000)=TRUE", '1=1=1', '1=1=TRUE', '(1=1)=(2=2)',
  '1<2<3', '3>2>1', '1<>2<>3']);
// NULL propagation
all(['NULL+1', '1+NULL', 'NULL*2', '2*NULL', 'NULL/2', '2/NULL', 'NULL-1', '1-NULL', '-NULL', 'NULL+NULL', 'NULL-NULL', 'NULL*NULL', 'NULL/NULL', 'NULL+1.5', '1.5+NULL', 'NULL-1.5',
  '1.5-NULL', 'NULL*1.5', '1.5*NULL', 'NULL/1.5', '1.5/NULL', "NULL+''", "''+NULL", "NULL-'a'", "'a'-NULL", "NULL*'a'", "'2'*NULL", 'NULL+TRUE', 'TRUE+NULL', 'NULL AND FALSE', 'NULL AND TRUE',
  'FALSE AND NULL', 'TRUE AND NULL', 'NULL OR TRUE', 'NULL OR FALSE', 'TRUE OR NULL', 'FALSE OR NULL', 'NULL AND NULL', 'NULL OR NULL', 'NOT NULL', 'IIF(NULL,1,2)', 'IIF(NULL=NULL,1,2)',
  'IIF(NULL<>NULL,1,2)', 'IIF(1=NULL,1,2)', 'IIF(NULL=1,1,2)', 'IIF(NOT NULL,1,2)', 'NULL+FLOATTODATETIME(45000)', 'FLOATTODATETIME(45000)+NULL', 'FLOATTODATETIME(45000)-NULL',
  'NULL-FLOATTODATETIME(45000)', 'NULL*0', '0*NULL', 'NULL+0', 'NULL+0.0', 'NULL+0D', 'NULL+INT(1)', '(NULL+1)*2', '(NULL+1)+2', '1+NULL+2', "NULL+1+'a'", "'a'+NULL+1", '10-NULL-1',
  '10*NULL*2', '10/NULL/2', 'NULL/0', '0/NULL']);
all(['NULL', '-NULL', 'NULL+1', '1+NULL', "NULL+'a'", 'NULL*2', 'NULL+NULL'], '');
// boolean operators
all(['TRUE AND FALSE', 'TRUE OR FALSE', 'NOT TRUE', 'NOT FALSE', '1 AND 1', '1 OR 2', '3 AND 5', '3 OR 5', 'NOT 5', 'NOT -1', 'NOT 0', 'TRUE AND 1', '1 AND TRUE', 'TRUE OR 0', '0 OR TRUE',
  '1=1 AND 2=2', '1=1 OR 1/0=1', 'FALSE AND (1/0=1)', 'TRUE OR (1/0=1)', '(1/0=1) AND FALSE', 'TRUE=TRUE', 'TRUE<>FALSE', 'TRUE>FALSE', 'TRUE<FALSE', 'TRUE+TRUE', 'TRUE*2', 'TRUE-TRUE',
  'TRUE/2', '-TRUE', '-FALSE', 'TRUE+1', 'FALSE+1', 'TRUE AND TRUE AND FALSE', 'TRUE OR TRUE AND FALSE', 'NOT TRUE AND FALSE', 'NOT (TRUE AND FALSE)', 'NOT TRUE OR TRUE', '1 AND 0',
  '2 AND 1', '2 AND 2', '4 OR 1', '1.5 AND 1', '1 OR 1.5', "'a' AND TRUE", "TRUE AND 'a'", "'True' AND TRUE", "'a' OR FALSE", "NOT 'a'", "NOT 'True'", 'NOT 1.5', 'NOT 0.0', 'NOT 0D',
  'NOT INT(0)', 'TRUE AND FLOATTODATETIME(45000)', 'NOT FLOATTODATETIME(45000)', '1>0 AND 2>1', '1>0 OR 2<1', 'NOT 1>0', 'NOT (1>0)', '(1>0) AND NOT (2<1)', 'TRUE AND NOT FALSE',
  'TRUE XOR FALSE', 'TRUE && FALSE', 'TRUE || FALSE', '!TRUE', '1 AND 3', '6 AND 3', '6 OR 3', '0 OR 0', '0 AND 0', '255 AND 15', '256 OR 1', '$FF AND $0F', '-1 AND 255',
  'INT(6) AND INT(3)', '6.0 AND 3.0', 'IIF(1 AND 2,1,0)', 'IIF(2 AND 1,1,0)', 'IIF(1 AND 3,1,0)', 'IIF(6 AND 3,1,0)', 'IIF(4 AND 3,1,0)', 'IIF(1 OR 0,1,0)', 'IIF(NOT 0,1,0)', 'IIF(NOT 1,1,0)',
  'IIF(NOT 2,1,0)', 'IIF(NOT -1,1,0)']);
// date arithmetic (no clock)
const dt = 'FLOATTODATETIME(45000)';
all([`${dt}+1`, `${dt}-1`, `${dt}-${dt}`, `(${dt}+1)-${dt}`, `${dt}+0.5`, `${dt}+1.5`, `${dt}*2`, `${dt}/2`, `1+${dt}`, `${dt}+${dt}`, `${dt}>${dt}-1`, `${dt}=${dt}`, `${dt}<${dt}+0.0001`,
  `${dt}+'1'`, `${dt}-'1'`, `'1'+${dt}`, `1-${dt}`, `0.5+${dt}`, `${dt}+INT(1)`, `${dt}+1D`, `${dt}-0.25`, `${dt}-${dt}=0`, `(${dt}+1.5)-${dt}`, `${dt}-(${dt}-7)`, `-${dt}`, `${dt}+TRUE`,
  `${dt}+1E6`, `${dt}-1E6`, `${dt}+0.99999999`, `${dt}+1/86400`, `${dt}+1/3`, `${dt}+0.000011574`, `(${dt}+0.5)-(${dt}+0.25)`, `(${dt}-${dt})+1`, `(${dt}-${dt})*2`,
  `${dt}-FLOATTODATETIME(44000)`, `(${dt}-FLOATTODATETIME(44000))/365`, `${dt}-FLOATTODATETIME(44000)>999`, `FLOATTODATETIME(45000.75)-${dt}`, `FLOATTODATETIME(0)`, `FLOATTODATETIME(1)`,
  'FLOATTODATETIME(-1)', 'FLOATTODATETIME(-1.5)', 'FLOATTODATETIME(-1.25)', 'FLOATTODATETIME(0.5)', 'FLOATTODATETIME(-0.5)', 'FLOATTODATETIME(2)', 'FLOATTODATETIME(61)', 'FLOATTODATETIME(60)',
  'FLOATTODATETIME(1E10)', 'FLOATTODATETIME(2958465)', 'FLOATTODATETIME(2958466)', 'FLOATTODATETIME(-657434)', 'FLOATTODATETIME(-657435)', "FLOATTODATETIME('45000')",
  'FLOATTODATETIME(45000.123456)', 'FLOATTODATETIME(TRUE)', 'FLOATTODATETIME(45000.5)', 'FLOATTODATETIME(45000.999999)', 'FLOATTODATETIME(45000.9999999999)', 'FLOATTODATETIME(INT(45000))',
  'FLOATTODATETIME(45000D)', 'FLOATTODATETIME(FLOATTODATETIME(45000))', "FLOATTODATETIME('1/2/2024')", 'FLOATTODATETIME()', 'FLOATTODATETIME(1,2)', 'FLOATTODATETIME(36526)', 'FLOATTODATETIME(109205)'],
  'yyyy-mm-dd hh:nn:ss');
all([`DAY(${dt})`, `MONTH(${dt})`, `YEAR(${dt})`, 'DAY(45000)', 'MONTH(45000)', 'YEAR(45000)', 'DAY(45000.9)', "DAY('1/2/2024')", "MONTH('1/2/2024')", "YEAR('1/2/2024')", "DAY('2024-03-05')",
  "MONTH('2024-03-05')", "YEAR('2024-03-05')", "DAY('abc')", 'DAY(NULL)', 'MONTH(NULL)', 'YEAR(NULL)', 'DAY(TRUE)', 'DAY(0)', 'MONTH(0)', 'YEAR(0)', 'DAY(-1)', 'YEAR(-1)', 'DAY(1.5)',
  'DAY(FLOATTODATETIME(45000.99))', 'YEAR(FLOATTODATETIME(2958465))', 'DAY(INT(45000))', 'DAY(45000D)', "DAY('')", 'DAY()', 'DAY(1,2)', "YEAR('15/03/2023')", "YEAR('3/15/2023')",
  'MONTHNAME(1)', 'MONTHNAME(2)', 'MONTHNAME(3)', 'MONTHNAME(9)', 'MONTHNAME(12)', 'MONTHNAME(0)', 'MONTHNAME(13)', 'MONTHNAME(-1)', 'MONTHNAME(1.5)', 'MONTHNAME(1.4)', "MONTHNAME('1')",
  `MONTHNAME(${dt})`, 'MONTHNAME(45000)', 'MONTHNAME(NULL)', 'MONTHNAME(TRUE)', 'MONTHNAME(INT(3))', 'MONTHNAME(3D)', 'MONTHNAME(FLOATTODATETIME(3))', 'MONTHNAME(100)',
  "ISVALIDDATETIME('1/2/2024')", "ISVALIDDATETIME('31/12/2024')", "ISVALIDDATETIME('12/31/2024')", "ISVALIDDATETIME('2024-12-31')", "ISVALIDDATETIME('abc')", "ISVALIDDATETIME('')",
  'ISVALIDDATETIME(NULL)', 'ISVALIDDATETIME(45000)', `ISVALIDDATETIME(${dt})`, "ISVALIDDATETIME('10:30')", "ISVALIDDATETIME('32/1/2024')", 'ISVALIDDATETIME(TRUE)', 'ISVALIDDATETIME(1.5)']);
// STR of dates and booleans
all([`STR(${dt})`, 'STR(FLOATTODATETIME(45000.5))', 'STR(FLOATTODATETIME(45000.75))', 'STR(FLOATTODATETIME(0))', 'STR(FLOATTODATETIME(0.5))', `'x'+STR(${dt})`, `LENGTH(STR(${dt}))`,
  `LEFT(${dt},2)`, `UPPERCASE(${dt})`, `TRIM(${dt})`, `LENGTH(${dt})`, `VAL(${dt})`]);

// --- Precedence and syntax ------------------------------------------------------------------------
all(['2+3*4', '(2+3)*4', '2*3+4', '10-2-3', '100/10/2', '2*-3', '-2*3', '2--3', '2-+3', '2+-3', '2++3', '1+2=3', 'NOT 1=2', 'NOT (1=2)', '1<2=TRUE', '1+1>1 AND 2>1', '-2*-2', '- -2',
  '-(2)', '-(-2)', '+2', '+(2)', '2^3', '5 MOD 2', '5 DIV 2', '7 % 2', "'a' || 'b'", "'a' & 'b'", '1 <> 2', '1 != 2', '1 == 1', '1 >< 2', '2 >= 2', '2 => 2', '2 =< 2', '2 <= 2',
  "'a' IN ('a','b')", "'abc' LIKE 'a%'", '1 // c', '1 { c }', '1 /* c */', '{ c } 1', '1 -- c', 'iif(1=1,1,2)', 'Iif(1=1,1,2)', 'true', 'True', 'tRuE', "uppercase('a')", "UpperCase('a')",
  '1 +\r\n 2', '1+\n2', '1+\t2', "IIF(1=1,\r\n 'a',\r\n 'b')", '\r\n1', '1\r\n', '\n1', '1\n', '1;', '1;2', '1;2;3', "1;'a'", '1+2;3+4', '(1+2', '1+2)', '1+', '+', '*2', '1 1', '1 +', '()', '(())',
  '1+(2*(3+(4)))', '((((1))))', '2*(3)', '(2)*(3)', '(2)(3)', '2(3)', 'MAX(1,2)MAX(3,4)', 'MAX (1,2)', 'MAX( 1 , 2 )', 'MAX(1,2,3)', 'MAX(1)', 'MAX()', 'MAX', 'MAX(1,)', 'MAX(,1)', 'ABS(-1)',
  'ABS (-1)', 'ABS(- 1)', '1E', '1.2.3', '1..2', "'a' 'b'", "'a'+", 'A', 'A.B', 'A B', '[A]', '[A B]', 'M.A', '1 AND', 'AND 1', 'NOT', 'NOT NOT TRUE', 'NOT NOT NOT TRUE', '1=', '=1', '<1',
  '1<', '1<>', '1<=>2', '1<<2', '1>>2', '1=>2', '5-3-1', '5-(3-1)', '2*3*4', '24/4/3', '24/(4/3)', '2+3-4+5', '1-2*3-4', '10/2*5', '10*2/5', '7-7/7', '-3+5', '-3*-5', '3*-5+2',
  '1+2*3=7', '1+2*3=7 AND 2*2=4', '5>3=TRUE', '5>3 = 3<5', '1+1=2=TRUE', '2=1+1', '(2=1)+1', 'TRUE=1+0']);

// --- IIF ---------------------------------------------------------------------------------------------
all(["IIF(1>0,'a','b')", "IIF(0,'a','b')", "IIF(1,'a','b')", "IIF(2,'a','b')", "IIF(-1,'a','b')", "IIF('a','x','y')", "IIF('True','x','y')", "IIF('False','x','y')", "IIF('1','x','y')",
  "IIF('0','x','y')", "IIF('','x','y')", "IIF(NULL,'x','y')", "IIF(1.5,'x','y')", "IIF(0.0,'x','y')", "IIF(0.5,'x','y')", "IIF(0D,'x','y')", "IIF(1D,'x','y')", `IIF(${dt},'x','y')`,
  "IIF(INT(0),'x','y')", "IIF(INT(1),'x','y')", 'IIF(TRUE,1,2)+1', "IIF(TRUE,1,'a')+1", "IIF(FALSE,1,'a')+1", 'IIF(1=1,NULL,1)', 'IIF(1=2,NULL,1)', 'IIF(TRUE,1,1/0)', 'IIF(FALSE,1/0,1)',
  'IIF(TRUE,1,UNKNOWNVAR)', 'IIF(FALSE,UNKNOWNVAR,1)', 'IIF(TRUE,UNKNOWNVAR,1)', 'IIF(TRUE,1,LEFT(1,2))', 'IIF((1=1) AND (2=2),1,2)', 'IIF(1=1 AND 2=2,1,2)', 'IIF(1=1,IIF(2=2,1,2),3)',
  'IIF(1=2,1,IIF(2=2,2,3))', 'IIF(1=2,1,IIF(2=3,2,3))', 'IIF(TRUE,1,2)*IIF(FALSE,1,2)', 'IIF(TRUE,1.5,2)', 'IIF(FALSE,1.5,2)', "IIF(TRUE,'a',1)+'b'", 'IIF(TRUE,TRUE,FALSE)', 'IIF(NOT TRUE,1,2)',
  'IIF(1,2,3)', 'IIF(0,2,3)', 'IIF(1=1,1,2', 'IIF(1=1,1)', 'IIF(1=1)', 'IIF()', 'IIF', 'IIF(1=1,1,2,3)', 'IIF (1=1,1,2)', 'IIF(TRUE,MAX(1,2),MAX(3,4))', 'IIF(FALSE,MAX(1,2),MAX(3,4))',
  'MAX(IIF(TRUE,1,2),IIF(FALSE,1,2))', 'IIF(TRUE,1,2)=1', '1+IIF(TRUE,1,2)', 'IIF(TRUE,1,2)+IIF(TRUE,10,20)', "IIF(1=1,'yes','no')+'!'", "LENGTH(IIF(1=1,'yes','no'))",
  'IIF(TRUE,;1,2)', 'IIF(TRUE,1;2,3)', 'IIF(1=1,(1),(2))', 'IIF((1=1),1,2)', 'IIF(((1=1)),1,2)', "IIF(1<2,'a'+'b','c'+'d')", "IIF(1>2,'a'+'b','c'+'d')", 'IIF(TRUE,1,2)3']);

// --- Constants ---------------------------------------------------------------------------------------
all(['TRUE', 'FALSE', 'CIERTO', 'FALSO', 'NULL', 'TODAY=TODAY', 'NOW>=TODAY', 'TIME>=0', 'TIME<1', 'NOW-TODAY<1', 'NOW-TODAY>=0', 'TODAY+TIME<=NOW+0.001', 'TODAY-INT(TODAY)', 'MODOGRAFICO',
  'PI', 'E', 'EMPTY', 'NIL', 'YES', 'NO', 'DATE', 'TRUE+0', 'FALSE+0', 'TRUE*1', 'CIERTO=TRUE', 'FALSO=FALSE', 'NOT CIERTO', 'TODAY>FLOATTODATETIME(45000)', 'YEAR(TODAY)>2020', 'TODAY-TODAY',
  'NOW-NOW<0.001', 'TIME-TIME<0.001', 'INT(TODAY)=TODAY', 'INT(NOW)=TODAY', 'TODAY+0=TODAY', 'NOW>TODAY-1', 'YEAR(NOW)=YEAR(TODAY)', 'MONTH(NOW)=MONTH(TODAY)', 'DAY(NOW)=DAY(TODAY)',
  'TODAY()', 'TRUE()', 'NULL()', 'TODAY(1)', 'ISNULL(NULL)', 'NVL(NULL,1)', 'COALESCE(NULL,1)']);
all(['TRUE', 'FALSE', 'CIERTO', 'FALSO', '1=1', '1=2'], '');

// ROUND(1E15,0.01) and ROUND(1E20,1) are left out: Roundfloat of rptypes.pas never returns when the
// number does not fit a Currency (a Delphi 12+ program masks the floating point exceptions).
// --- Rounding -----------------------------------------------------------------------------------------
const xs = ['0.5', '1.5', '2.5', '3.5', '-0.5', '-1.5', '-2.5', '1.005', '1.015', '1.025', '2.675', '1.255', '0.125', '0.135', '0.145', '1234.5678', '-1234.5678', '0', '5', '15', '25', '-15',
  '1E10', '0.0001', '2.5D', '1.005D', '0.615', '1.115', '8.345', '10.235', '0.285', '1.45', '1.55', '2.345', '2.355', '1.0049999', '0.5000001', '0.4999999', "'2.5'", 'NULL', 'TRUE'];
for (const x of xs) for (const r of ['1', '0.1', '0.01', '0.001', '10', '5', '0.5', '0.25', '0.05']) add(`ROUND(${x},${r})`);
all(['ROUND(2.5,0)', 'ROUND(2.5,-1)', 'ROUND(25,-10)', 'ROUND(2.5,NULL)', "ROUND(2.5,'1')", "ROUND(2.5,'a')", 'ROUND(2.5)', 'ROUND(2.5,1,1)', 'ROUND()', 'ROUND(2.5,TRUE)', 'ROUND(2.5,100)',
  'ROUND(149,100)', 'ROUND(150,100)', 'ROUND(151,100)', 'ROUND(-150,100)', 'ROUND(1.5,2)', 'ROUND(3,2)', 'ROUND(2.5,3)', 'ROUND(123456789.125,0.01)',
  'ROUND(0.1+0.2,0.01)', 'ROUND(1/3,0.01)', 'ROUND(2/3,0.01)', 'ROUND(2/3,0.0001)', 'ROUND(10/4,1)', 'ROUND(7/2,1)', 'ROUND(5/2,1)', 'ROUND(3/2,1)', 'ROUND(1/2,1)', 'ROUND(-1/2,1)',
  'ROUND(1.005*100,1)', 'ROUND(2.675*100,1)/100', 'ROUND(100*1.1,1)', 'ROUND(INT(5),2)', 'ROUND(5D,2)', 'ROUND(2.5,INT(1))', 'ROUND(2.5,1D)', 'ROUND(2.5,0.1D)', 'ROUND(1.25,0.1)',
  'ROUND(1.35,0.1)', 'ROUND(1.45,0.1)', 'ROUND(-1.25,0.1)', 'ROUND(-1.35,0.1)', 'ROUND(0.05,0.1)', 'ROUND(0.15,0.1)', 'ROUND(0.25,0.1)', 'ROUND(0.35,0.1)', 'ROUND(0.45,0.1)',
  'ROUND(0.55,0.1)', 'ROUND(0.65,0.1)', 'ROUND(0.75,0.1)', 'ROUND(0.85,0.1)', 'ROUND(0.95,0.1)', 'ROUND(0.005,0.01)', 'ROUND(0.015,0.01)', 'ROUND(0.025,0.01)', 'ROUND(0.035,0.01)',
  'ROUND(0.045,0.01)', 'ROUND(0.055,0.01)', 'ROUND(0.065,0.01)', 'ROUND(0.075,0.01)', 'ROUND(0.085,0.01)', 'ROUND(0.095,0.01)', 'ROUND(1.105,0.01)', 'ROUND(1.115,0.01)', 'ROUND(1.125,0.01)',
  'ROUND(1.135,0.01)', 'ROUND(1.145,0.01)', 'ROUND(1.155,0.01)', 'ROUND(1.165,0.01)', 'ROUND(1.175,0.01)', 'ROUND(1.185,0.01)', 'ROUND(1.195,0.01)', 'ROUND(21.5*1.21,0.01)',
  'ROUND(33.33*0.21,0.01)', 'ROUND(19.99*0.21,0.01)', 'ROUND(12.345*3,0.01)', 'ROUND(100*0.07,1)', 'ROUND(1234.5*0.21,0.01)', 'ROUND(0.5*3,1)', 'ROUND(4.5,1)', 'ROUND(5.5,1)', 'ROUND(6.5,1)',
  'ROUND(-3.5,1)', 'ROUND(-4.5,1)', 'ROUND(0.4999999999999999,1)', 'ROUND(2.4999999999999996,1)', 'ROUND(1E-10,1)', 'ROUND(-1E-10,1)', 'ROUND(-0.4,1)', 'ROUND(-0.0,1)']);
all(['ROUND(1.255,0.01)', 'ROUND(2.5,1)', 'ROUND(1234.5678,0.01)', 'ROUND(2/3,0.01)', 'ROUND(10,3)', 'ROUNDTOINTEGER(2.5)', 'INT(2.7)', 'ABS(-2.50)', '2/3', '10/4', '1.50', '7/2'], '');
const ys = ['0.5', '1.5', '2.5', '3.5', '-0.5', '-1.5', '-2.5', '0.49999', '2.4999999999', '2.5000000001', '1E10', '2147483647.5', '2147483648.5', '-0.4', "'a'", "'2.5'", 'NULL', 'TRUE', '0',
  '7', '-7', '2.7', '-2.7', '2.2', '-2.2', '0.9999999999', '-0.9999999999', '1E15', '1E18', '1E19', '1E20', '-1E20', '9223372036854775807', '4.5', '5.5', '6.5', '0.5D', '2.5D', '-2.5D',
  '1E300', 'INT(5)', '1/2', '5/2', '7/2', '-7/2', '99.5', '100.5', '0.1+0.2+0.2', '2.675*100', '1.005*1000', '4.35*100', "''", "'abc'", 'FLOATTODATETIME(45000.6)', '2147483647', '2147483648',
  '123456789012.6', '-123456789012.6', '0.0', '-0.0', '1.0', '2.50', '3.9999999999999999'];
for (const y of ys) for (const f of ['ROUNDTOINTEGER', 'INT', 'ABS', 'SQRT', 'SIN']) add(`${f}(${y})`);
all(['INT()', 'INT(1,2)', 'ABS()', 'ROUNDTOINTEGER()', 'SQRT(-1)', 'SQRT(-0.0)', 'SQRT(1E-300)', 'SQRT(4)=2', 'SQRT(2)*SQRT(2)=2', 'ABS(-2147483648)', 'ABS(-2147483647)', 'ABS(-1.50)',
  'ABS(-0.1D)', 'ABS(1-2)', 'ABS(1.5-2)', 'INT(7/2)', 'INT(-7/2)', 'INT(7/2)*2', 'INT(10/3)', 'INT(2.5)+INT(2.5)', 'INT(2.9)=2', 'INT(5)/2', 'INT(5)/INT(2)', 'INT(7)*INT(3)', 'INT(7)+0.5',
  'INT(1E10)*INT(1E10)', 'INT(3000000000)', 'INT(3000000000)+1', 'INT(2147483647)+1', 'INT(100000)*INT(100000)', 'INT(100000)*100000', 'ROUNDTOINTEGER(2.5)+ROUNDTOINTEGER(3.5)',
  'ROUNDTOINTEGER(2.5)/2', 'ROUNDTOINTEGER(3000000000.5)', 'ROUNDTOINTEGER(1.5)*ROUNDTOINTEGER(2.5)']);
// MOD, MAX, COMPAREVALUE
all(['MOD(7,3)', 'MOD(-7,3)', 'MOD(7,-3)', 'MOD(-7,-3)', 'MOD(7,0)', 'MOD(7.5,2)', 'MOD(7,2.5)', 'MOD(7.9,2.9)', "MOD('7',3)", "MOD(7,'3')", 'MOD(NULL,3)', 'MOD(7,NULL)', 'MOD(2147483648,3)',
  'MOD(10,3)=1', 'MOD(0,3)', 'MOD(3,3)', 'MOD(1E10,7)', 'MOD(INT(1E10),7)', 'MOD(7)', 'MOD()', 'MOD(7,3,1)', 'MOD(TRUE,2)', 'MOD(7D,3D)', 'MOD(8.5,3)', 'MOD(-8.5,3)', 'MOD(2.5,1)', 'MOD(3.5,1)',
  "MOD('a',2)", 'MOD(100,7)', 'MOD(7,1)', 'MOD(123456789012,1000)',
  'MAX(1,2)', 'MAX(2.5,1)', 'MAX(1,1.0)', 'MAX(1.0,1)', 'MAX(-1,-2)', "MAX('a','b')", "MAX(1,'2')", "MAX('10','9')", 'MAX(NULL,NULL)', 'MAX(NULL,1)', 'MAX(1,NULL)', `MAX(${dt},1)`,
  `MAX(${dt},${dt}+1)`, 'MAX(1.5D,2)', 'MAX(INT(3),2)', 'MAX(TRUE,FALSE)', 'MAX(1)', 'MAX(1,2,3)', 'MAX()', 'MAX(1,2)+1', 'MAX(0.1+0.2,0.3)', 'MAX(1/3,0.33)', 'MAX(2,2.0)', 'MAX(-0.0,0)',
  'MAX(1E20,1)', 'MAX(MAX(1,2),MAX(3,4))', 'MAX(1,MAX(2,3))', 'MAX(MAX(1,5),2)', 'MAX(1,MAX(2,MAX(3,4)))', 'MAX(4,MAX(3,MAX(2,1)))', 'MAX(ABS(-5),ABS(-3))', 'MAX(ABS(-3),ABS(-5))',
  "LEFT('abcdef',LENGTH(LEFT('abc',2)))", "LEFT(LEFT('abcdef',4),2)", "SUBSTR('abcdef',2,LENGTH(SUBSTR('abc',2,2)))", "REPLACESTR('abc','b',REPLACESTR('xyz','y','Q'))",
  "REPLACESTR(REPLACESTR('abc','a','1'),'b','2')", "REPLACESTR('abc',REPLACESTR('b','b','c'),REPLACESTR('x','x','y'))", "POS('c',REPLACESTR('abc','a','z'))",
  "POS(LEFT('cd',1),'abcd')", "POS('b','a'+LEFT('bc',1))", 'ROUND(ROUND(2.555,0.01),0.1)', 'ROUND(2.55,ROUND(0.14,0.1))', 'MOD(MOD(17,10),MOD(13,10))', 'MOD(17,MOD(13,10))',
  "FORMATSTR('0.00',MAX(1,2))", "IIF(MAX(1,2)=2,MAX(3,4),MAX(5,6))", "COMPAREVALUE(1,COMPAREVALUE(1,1,0),0)", "COMPAREVALUE(MAX(1,2),MAX(2,1),0)",
  'COMPAREVALUE(1,1,0)', 'COMPAREVALUE(1,2,0)', 'COMPAREVALUE(2,1,0)', 'COMPAREVALUE(1,1.0001,0.001)', 'COMPAREVALUE(1,1.001,0.001)', 'COMPAREVALUE(1,1.002,0.001)', 'COMPAREVALUE(1.002,1,0.001)',
  'COMPAREVALUE(0.1+0.2,0.3,0)', 'COMPAREVALUE(0.1+0.2,0.3,0.0000001)', 'COMPAREVALUE(NULL,1,0)', 'COMPAREVALUE(1,NULL,0)', 'COMPAREVALUE(1,1,NULL)', "COMPAREVALUE('1',1,0)", "COMPAREVALUE('a',1,0)",
  'COMPAREVALUE(1,2)', 'COMPAREVALUE()', 'COMPAREVALUE(1,2,-1)', 'COMPAREVALUE(1,2,10)', 'COMPAREVALUE(TRUE,1,0)', 'COMPAREVALUE(1D,1,0)', 'COMPAREVALUE(1E20,1E20+1,0)', `COMPAREVALUE(${dt},45000,0)`]);

// --- String functions ----------------------------------------------------------------------------------
for (const s of ["'abcdef'", "''", "' a '", '12345', '1.50', 'NULL', 'TRUE'])
  for (const n of ['0', '1', '3', '6', '7', '100', '-1', '-100', '2.5', '2.4', '2.6', "'2'", 'NULL', 'TRUE', '3D', 'INT(3)', "'a'", "''", '1E10']) {
    add(`LEFT(${s},${n})`);
    add(`RIGHT(${s},${n})`);
  }
for (const s of ["'abcdef'", "''", '12345', 'NULL'])
  for (const i of ['-1', '0', '1', '2', '6', '7', '100', '2.5', "'2'", 'NULL'])
    for (const n of ['-1', '0', '1', '3', '100', '2.5', "'2'", 'NULL']) add(`SUBSTR(${s},${i},${n})`);
all(["LEFT()", "LEFT('a')", "LEFT('a',1,2)", "RIGHT('a')", "SUBSTR('a')", "SUBSTR('a',1)", "SUBSTR('a',1,1,1)", "MID('abc',2,1)", "COPY('abc',2,1)", "LEN('abc')", "UPPER('a')", "LOWER('A')",
  "FILLSTR('a',3)", "REPLICATE('a',3)", "SPACE(3)", "CHR(65)", "ASC('A')", "LTRIM(' a')", "RTRIM('a ')", "PADL('a',3)", "CONCAT('a','b')",
  "POS('b','abc')", "POS('B','abc')", "POS('bc','abc')", "POS('abc','abc')", "POS('abcd','abc')", "POS('','abc')", "POS('a','')", "POS('','')", "POS('c','abcabc')", 'POS(1,123)', "POS('2',123)",
  "POS(2,'123')", 'POS(NULL,NULL)', "POS('a',NULL)", "POS(NULL,'a')", "POS(TRUE,'True')", "POS('.',1.5)", "POS(',',1.5)", "POS('a')", "POS()", "POS('a','b','c')", "POS(' ','a b')",
  "POS('é','cafe')", "POS('e','café')", "POS('É','café')", "POS('ss','straße')", "POS('ß','strasse')", "POS('A','abc')", "POS('a','ABC')", "POS(#13,'a'#13#10)", "POS('ab','ab')",
  "POS('ab','b')", "POS('😀','a😀')", "POS('b','a😀b')",
  "LENGTH('abc')", "LENGTH('')", "LENGTH(' ')", 'LENGTH(NULL)', 'LENGTH(123)', 'LENGTH(1.5)', 'LENGTH(1.50)', 'LENGTH(TRUE)', "LENGTH('a😀')", "LENGTH('é')", "LENGTH('e'#769)", 'LENGTH()',
  "LENGTH('a','b')", 'LENGTH(1E20)', 'LENGTH(1/3)', 'LENGTH(100000000000)', 'LENGTH(-1)', 'LENGTH(0.1+0.2)', 'LENGTH(1.0)', 'LENGTH(INT(5))', 'LENGTH(5D)',
  "UPPERCASE('abc')", "UPPERCASE('áéíóúñç')", "UPPERCASE('ß')", "UPPERCASE('ÿ')", "UPPERCASE('i')", "UPPERCASE('ı')", "UPPERCASE('ǆ')", "UPPERCASE('ﬁ')", "UPPERCASE('αβγ')", "UPPERCASE('абв')",
  "UPPERCASE('')", 'UPPERCASE(NULL)', 'UPPERCASE(123)', 'UPPERCASE(1.5)', 'UPPERCASE(TRUE)', "UPPERCASE()", "UPPERCASE('a1b2')", "UPPERCASE('ς')", "UPPERCASE('µ')", "UPPERCASE('ŉ')",
  "LOWERCASE('ABC')", "LOWERCASE('ÁÉÍÓÚÑÇ')", "LOWERCASE('SS')", "LOWERCASE('I')", "LOWERCASE('İ')", "LOWERCASE('ΑΒΓΣ')", "LOWERCASE('АБВ')", "LOWERCASE('')", 'LOWERCASE(NULL)',
  'LOWERCASE(123)', 'LOWERCASE(TRUE)', "LOWERCASE('Ǆ')", "LOWERCASE('K')",
  "TRIM(' a ')", "TRIM('a')", "TRIM('')", "TRIM('   ')", "TRIM(#9'a'#9)", "TRIM(#13#10'a'#13#10)", "TRIM(#160'a'#160)", "TRIM(#0'a'#0)", "TRIM(#1'a'#31)", "TRIM(' a b ')", 'TRIM(NULL)',
  'TRIM(123)', 'TRIM(1.5)', 'TRIM(TRUE)', "TRIM()", "TRIM(#12288'a')", "TRIM(#8195'a')", "TRIM(#127'a')", "TRIM(#133'a')", "LENGTH(TRIM('  a  '))", "TRIM(' a ')+'|'", "TRIM(#8203'a')",
  "REPLACESTR('abcabc','b','X')", "REPLACESTR('abcabc','B','X')", "REPLACESTR('abc','','X')", "REPLACESTR('abc','b','')", "REPLACESTR('','a','b')", "REPLACESTR('aaa','a','aa')",
  "REPLACESTR('aaa','aa','a')", "REPLACESTR('abc','abc','')", "REPLACESTR('abc','abcd','x')", "REPLACESTR(NULL,'a','b')", "REPLACESTR('a',NULL,'b')", "REPLACESTR('a','a',NULL)",
  "REPLACESTR(123,'2','x')", "REPLACESTR('123',2,'x')", "REPLACESTR('123','2',9)", "REPLACESTR(1.5,'.',',')", "REPLACESTR('a.b','.',',')", "REPLACESTR('a b c',' ','')",
  "REPLACESTR('ABC','b','x')", "REPLACESTR('Straße','ss','x')", "REPLACESTR('café','E','x')", "REPLACESTR('a')", "REPLACESTR('a','b')", "REPLACESTR()", "REPLACESTR('a','b','c','d')",
  "REPLACESTR('a'#13#10'b',#13#10,' ')", "REPLACESTR('a''b','''','\"')", "REPLACESTR('aXbxc','x','-')", "REPLACESTR('ÁB','á','x')", "REPLACESTR(TRUE,'T','x')",
  "ASC2('áéí')", "ASC2('')", "ASC2('abc')", "ASC2('ñÑ')", "ASC2('€')", "ASC2(TRUE)", "ASC2('ü')", "ASC2('ß')", "ASC2('œ')"]);

// --- Conversions -----------------------------------------------------------------------------------------
all(['STR(1)', 'STR(-1)', 'STR(1.5)', 'STR(1.50)', 'STR(0.1+0.2)', 'STR(1/3)', 'STR(2/3)', 'STR(1E10)', 'STR(1E15)', 'STR(1E16)', 'STR(123456789012345678)', 'STR(0.000001)', 'STR(1E-5)',
  'STR(TRUE)', 'STR(FALSE)', 'STR(NULL)', "STR('a')", "STR('')", 'STR(100)', 'STR(1000000)', 'STR(1234567.891)', 'STR(-0.5)', 'STR(10/4)', 'STR(10/5)', 'STR(7/2)', 'STR(1.10)', 'STR(2.50*2)',
  'STR(1.0)', 'STR(0.0)', 'STR(-0.0)', 'STR(1D)', 'STR(1.5D)', 'STR(0.1D+0.2D)', 'STR(1E20D)', 'STR(INT(5))', 'STR(INT(2.7))', 'STR(123456789012)', 'STR(1E100)', 'STR(1.23456789012345678)',
  'STR(12345678.12345678)', 'STR(0.1)', 'STR(100.0)', 'STR(1E3)', 'STR(1.5E3)', 'STR()', 'STR(1,2)', 'STR(2147483647)', 'STR(2147483648)', 'STR(1/7)', 'STR(100/3)', 'STR(1000000/3)',
  'STR(1E15/3)', 'STR(5/2)', 'STR(ROUND(2/3,0.01))', 'STR(ROUND(1.005,0.01))', 'STR(MAX(1,2.5))', 'STR(ABS(-1.50))', 'STR(SQRT(2))', 'STR(SIN(1))', 'STR(MOD(7,3))', "STR(1)+'a'",
  "STR(1.5)+'a'", 'LENGTH(STR(1/3))', "'['+STR(12.5)+']'", 'STR(1.5)+1', 'STR(2)*2',
  "VAL('1')", "VAL('1.5')", "VAL('1,5')", "VAL('-1')", "VAL(' 1 ')", "VAL('1e3')", "VAL('abc')", "VAL('')", "VAL('1 000')", "VAL('1.000,5')", "VAL('1,000.5')", "VAL('$5')", "VAL('0x10')",
  "VAL('1.5.5')", "VAL('+5')", "VAL('--5')", "VAL('.5')", "VAL('5.')", 'VAL(TRUE)', 'VAL(FALSE)', 'VAL(NULL)', 'VAL(5)', 'VAL(5.5)', "VAL('1/2')", "VAL('12abc')", "VAL('abc12')",
  "VAL('1E400')", "VAL('∞')", "VAL('1.50')", "VAL('007')", "VAL('1.0')", "VAL('2147483648')", "VAL('123456789012345678901234567890')", "VAL('0.1')+VAL('0.2')", "VAL('0.1')+VAL('0.2')=0.3",
  "VAL('5')+1", "VAL('5')*2", "VAL('5.5')*2", "VAL('1')/2", "VAL('5')=5", "VAL()", "VAL('1','2')", "VAL('1E2')", "VAL('1e-2')", "VAL('  ')", "VAL('-')", "VAL('.')", "VAL('1,5')+1", "VAL('1.5')+1",
  "VAL('TRUE')", "VAL('1 ')", "VAL(' 1')", "VAL('1'+'2')", "VAL('-0')", "VAL('0')", "VAL(1.50)", 'VAL(5D)', 'VAL(INT(5))', "VAL('١٢')", "VAL('1.234.567')", "VAL('1,234,567')", "VAL('(5)')", "VAL('5-')", "VAL('5%')", "VAL('€5')",
  "ISINTEGER('5')", "ISINTEGER('5.0')", "ISINTEGER('-5')", "ISINTEGER('abc')", "ISINTEGER('')", 'ISINTEGER(5)', 'ISINTEGER(5.5)', 'ISINTEGER(NULL)', 'ISINTEGER(TRUE)', "ISINTEGER(' 5')",
  "ISINTEGER('5 ')", "ISINTEGER('0x10')", "ISINTEGER('$10')", "ISINTEGER('99999999999')", "ISINTEGER('1e2')", "ISINTEGER('+5')", "ISINTEGER('5.')", 'ISINTEGER(5.0)', 'ISINTEGER(5D)',
  "ISNUMERIC('5')", "ISNUMERIC('5.5')", "ISNUMERIC('5,5')", "ISNUMERIC('abc')", "ISNUMERIC('')", 'ISNUMERIC(5)', 'ISNUMERIC(5.5)', 'ISNUMERIC(NULL)', 'ISNUMERIC(TRUE)', "ISNUMERIC(' 5 ')",
  "ISNUMERIC('1e5')", "ISNUMERIC('$5')", "ISNUMERIC('0x10')", "ISNUMERIC('1.5.5')", "ISNUMERIC('-')", "ISNUMERIC('.')", "ISNUMERIC('+5')", "ISNUMERIC('1E400')", "ISNUMERIC('1 000')",
  "ISNUMERIC('5-')", "ISNUMERIC('(5)')", "ISNUMERIC('5%')", `ISNUMERIC(${dt})`, "ISNUMERIC('١٢')", "ISNUMERIC('1,234,567')", "ISNUMERIC('1.234.567')",
  "EVALTEXT('1+1')", "EVALTEXT('''a''+''b''')", "EVALTEXT('')", "EVALTEXT(' ')", "EVALTEXT('1+')", "EVALTEXT(1)", "EVALTEXT(NULL)", "EVALTEXT('NULL')", "EVALTEXT('IIF(1=1,1,2)')",
  "EVALTEXT('1')+1", "EVALTEXT('1;2')", "EVALTEXT('7/2')", "EVALTEXT()", "EVALTEXT('1','2')", "EVALTEXT('EVALTEXT(''1+1'')')", "EVALTEXT('UNKNOWN')", "EVALTEXT('1.5')", "EVALTEXT('1,5')",
  "EVALTEXT('TRUE')", "EVALTEXT('MAX(1,2)')+MAX(3,4)", "MAX(EVALTEXT('1'),EVALTEXT('2'))",
  "CHECKEXPRESSION('1=1','m')", "CHECKEXPRESSION('1=2','m')", "CHECKEXPRESSION('1','m')", "CHECKEXPRESSION('0','m')", "CHECKEXPRESSION('','m')", "CHECKEXPRESSION('abc','m')",
  "CHECKEXPRESSION('TRUE','m')", "CHECKEXPRESSION('FALSE','')", "CHECKEXPRESSION(TRUE,'m')", "CHECKEXPRESSION('1=1')", "CHECKEXPRESSION()", "CHECKEXPRESSION('1+','m')",
  "CHECKEXPRESSION('''a''','m')", "CHECKEXPRESSION('2','m')", "CHECKEXPRESSION('1.5','m')", "CHECKEXPRESSION('1=1',NULL)", "CHECKEXPRESSION(NULL,'m')",
  "STRINGTOBIN('QUJD')", "STRINGTOBIN('')", "STRINGTOBIN('QUJ')", "STRINGTOBIN('QU JD')", "STRINGTOBIN('QUJD'#13#10'QUJD')", "STRINGTOBIN('!!!!')", 'STRINGTOBIN(NULL)', 'STRINGTOBIN(1)',
  "STRINGTOBIN()", "LENGTH(STRINGTOBIN('QUJD'))", "STR(STRINGTOBIN('QUJD'))", "STRINGTOBIN('QUJD')+'a'", "'a'+STRINGTOBIN('QUJD')", "STRINGTOBIN('QUJD')=STRINGTOBIN('QUJD')",
  "IDENTEXISTS('TRUE')", "IDENTEXISTS('MAX')", "IDENTEXISTS('NOPE')", "IDENTEXISTS('')", 'IDENTEXISTS(NULL)', "IDENTEXISTS('M.X')", "IDENTEXISTS('true')", "IDENTEXISTS('IIF')",
  "IDENTEXISTS('MODOGRAFICO')", "IDENTEXISTS(' TRUE')", "IDENTEXISTS('PAGE')", "IDENTEXISTS('PAGINA')", "IDENTEXISTS('FREE_SPACE')", "IDENTEXISTS('LANGUAGE')",
  "FILEEXISTS('C:\\Windows\\win.ini')", "FILEEXISTS('C:\\Windows')", "FILEEXISTS('C:\\nope\\nope.txt')", "FILEEXISTS('')", 'FILEEXISTS(NULL)', 'FILEEXISTS(1)', 'FILEEXISTS()',
  'NUMTOTEXT(1,FALSE)', 'NUMTOTEXT(1,TRUE)', 'NUMTOTEXT(21,FALSE)', 'NUMTOTEXT(21,TRUE)', 'NUMTOTEXT(100,FALSE)', 'NUMTOTEXT(101,FALSE)', 'NUMTOTEXT(1000,FALSE)', 'NUMTOTEXT(1000000,FALSE)',
  'NUMTOTEXT(2000000,FALSE)', 'NUMTOTEXT(1.5,FALSE)', 'NUMTOTEXT(0.01,FALSE)', 'NUMTOTEXT(-1,FALSE)', 'NUMTOTEXT(1234567.89,FALSE)', 'NUMTOTEXT(1E15,FALSE)', 'NUMTOTEXT(0,FALSE)',
  'NUMTOTEXT(0.5,FALSE)', 'NUMTOTEXT(0.999,FALSE)', 'NUMTOTEXT(0.995,FALSE)', 'NUMTOTEXT(1.005,FALSE)', 'NUMTOTEXT(200,TRUE)', 'NUMTOTEXT(500,TRUE)', 'NUMTOTEXT(1001,TRUE)',
  'NUMTOTEXT(15,FALSE)', 'NUMTOTEXT(16,FALSE)', 'NUMTOTEXT(22,FALSE)', 'NUMTOTEXT(30,FALSE)', 'NUMTOTEXT(31,TRUE)', 'NUMTOTEXT(99,FALSE)', 'NUMTOTEXT(110,FALSE)', 'NUMTOTEXT(999999,FALSE)',
  'NUMTOTEXT(1000001,FALSE)', 'NUMTOTEXT(1E9,FALSE)', 'NUMTOTEXT(1E12,FALSE)', 'NUMTOTEXT(123.45,FALSE)', 'NUMTOTEXT(123.4,FALSE)', 'NUMTOTEXT(123.456,FALSE)', "NUMTOTEXT('5',FALSE)",
  'NUMTOTEXT(NULL,FALSE)', 'NUMTOTEXT(5,NULL)', 'NUMTOTEXT(5)', 'NUMTOTEXT()', 'NUMTOTEXT(5,0)', 'NUMTOTEXT(5,1)', "NUMTOTEXT(5,'a')", 'NUMTOTEXT(TRUE,FALSE)', 'NUMTOTEXT(1D,FALSE)',
  'NUMTOTEXT(INT(7),FALSE)', 'NUMTOTEXT(2147483648,FALSE)', 'NUMTOTEXT(922337203685477,FALSE)', 'NUMTOTEXT(1E18,FALSE)', 'NUMTOTEXT(-0.5,FALSE)', 'NUMTOTEXT(1.999,FALSE)', 'NUMTOTEXT(1.994,FALSE)',
  "HOURMINSEC(1.5,'h','m','s')", "HOURMINSEC(NULL,'h','m','s')", "HOURMINSEC('a','h','m','s')", "HOURMINSEC(1.5)", "HOURMINSEC(1.5,NULL,'m','s')", "HOURMINSEC(TRUE,'h','m','s')",
  "FORMATSTR('0.00',1.5)", "FORMATSTR('',1.5)", "FORMATSTR('',1/3)", "FORMATSTR('','a')", "FORMATSTR('',TRUE)", "FORMATSTR('',NULL)", "FORMATSTR('0.00',NULL)", "FORMATSTR('0.00','a')",
  "FORMATSTR('0.00','1.5')", "FORMATSTR('0.00',TRUE)", "FORMATSTR(NULL,1)", "FORMATSTR(1,1)", "FORMATSTR('0.00')", "FORMATSTR()", `FORMATSTR('yyyy-mm-dd',${dt})`, "FORMATSTR('yyyy-mm-dd',45000)",
  "FORMATSTR('yyyy-mm-dd','15/03/2023')", "FORMATSTR('0',2.5)", "FORMATSTR('0',3.5)", "FORMATSTR('0.00',1.005)", "FORMATSTR('0.00',2.675)", "FORMATSTR('0.0',0.25)", "FORMATSTR('0.0',0.35)",
  "FORMATSTR('#,##0.00',1234567.891)", "FORMATSTR('0.00',-0.001)", "FORMATSTR('0',0.5)", "FORMATSTR('0',1.5)", "FORMATSTR('0',-0.5)", "FORMATSTR('0.00',1.255)", "FORMATSTR('0.00',1.245)",
  "FORMATNUM('0.00',1.5)", "FORMATNUM('#,##0.00',1234567.891)", "FORMATNUM('',1.5)", "FORMATNUM('0.00',NULL)", "FORMATNUM('0.00','a')", "FORMATNUM('0.00','1.5')", "FORMATNUM('0.00',TRUE)",
  "FORMATNUM('0',2.5)", "FORMATNUM('0.00',1.005)", "FORMATNUM('0.00')", "FORMATNUM()", "FORMATNUM(NULL,1)", "FORMATNUM('##,##',1234567)", "FORMATNUM('0.00',-1.5)", "FORMATNUM('000',5)",
  "FORMATNUM('0.0',0.25)", "FORMATNUM('0.00',1.255)", "FORMATNUM('#',0)", "FORMATNUM('0.00',1E20)", "FORMATNUM('#.##',1.5)", "FORMATNUM('#,##0',-1234.5)", "FORMATNUM('0.00',INT(5))",
  `FORMATNUM('0.00',${dt})`, "FORMATNUM('$0.00',5)", "FORMATNUM('0.00 €',5)", "FORMATNUM('00:00',1234)", "FORMATNUM('0.000',1/3)", "FORMATNUM('0.00;(0.00)',-5)", "FORMATNUM('#,###',0)",
  "FORMATNUM('0.00%',0.5)", "FORMATNUM('0E0',1234)", "FORMATNUM('abc',5)", "FORMATNUM('0.00',5)+1", "LENGTH(FORMATNUM('0.00',5))",
  "FORMATMASK('000-000','123456')", "FORMATMASK(NULL,'1')", "FORMATMASK('000')", "DECODE64('QUJD')", "DECODE64(NULL)", "UTF8TOWIDESTRING('Ã¡')", "GETINIVALUE('nope.ini','a','b','c')",
  "LOADFILE('nope.txt')", "CHSTOCHT('简体')", "CHTTOCHS('繁體')", 'SETLANGUAGE(1)', "PARAMINFO('x')", "GETVALUEFROMSQL('a','b')", "REOPEN('a','b')", 'GRAPHICCLEAR()', "TEXTHEIGHT('a','Arial',10,100)",
  "SETPAGEORIENTATION(1)", "SETPAGESOURCE(1,'a',1)", 'PAGE', 'PAGINA', 'PAGENUM', 'NUMPAGE', 'LANGUAGE', 'FREE_SPACE', 'CURRENTGROUP', 'FIRSTSECTION', 'PAGECOUNT', 'EOF', 'M.EOF']);

fs.writeFileSync(process.argv[2], '[\n' + cases.map((c) => JSON.stringify(c)).join(',\n') + '\n]\n');
console.log(cases.length, 'cases');
