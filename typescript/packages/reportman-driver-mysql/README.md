# @reportman/driver-mysql

MySQL and MariaDB for Report Manager in Node.js, through [mysql2](https://github.com/sidorares/node-mysql2)
(the wire protocol in plain JavaScript), with the behaviour of MySqlConnector 2.5, the provider the C# engine
and Reportman.Server open MySQL with (`MySQLConnector`): the same columns and .NET types, the same values, the
same statements on the wire (MySqlConnector does not prepare: it writes each parameter as an SQL literal in the
text of the command, and so does this driver), the same transactions and the same errors, so a report gives
the same metafile and the same PDF bytes in both engines.

```ts
import { openReport } from '@reportman/node';
import { mysql } from '@reportman/driver-mysql';

const report = await openReport('invoices.rep', {
  connections: { SAMPLES: mysql('Server=db.example.com;Database=sales;User ID=reports;Password=...') },
});
const pdf = await report.executeToPdf({ FIRST_ORDER: 7, LAST_ORDER: 9 });
```

`mysql(options)` returns a connection factory for `connections`. `options` is a MySqlConnector connection string
or an object with `connectionString`, `host` (a comma-separated list is tried in order), `port` (3306),
`database`, `user`, `password`, `connectionTimeout` (15 s), `ssl` (mysql2 TLS options instead of those of the
connection string), `culture` and `synchronous`. The connection string of the `.rep` is not used: the host says where the data
is.

The connection string is read as MySqlConnectionStringBuilder reads it: every key and synonym of MySqlConnector
2.5 (an unknown key fails with `Option 'x' not supported.`), `yes`/`no` booleans, and its defaults. The options
that change what a report reads are honoured: `TreatTinyAsBoolean` (true), `AllowZeroDateTime` and
`ConvertZeroDateTime` (false), `GuidFormat` (Default: `Char36`, or `LittleEndianBinary16` with `OldGuids`),
`DateTimeKind`, `AllowUserVariables`, `NoBackslashEscapes`, `SslMode` (Preferred:
TLS when the server offers it, without verifying it; `VerifyCA`/`VerifyFull` with `SslCa`, `SslCert`,
`SslKey`, `CertificateFile`), `AllowPublicKeyRetrieval` and `ServerRSAPublicKeyFile` (without TLS the RSA key of the server is asked for only on a loopback address or with AllowPublicKeyRetrieval, as in MySqlConnector), `Protocol=Unix` (a socket path in `Server`), `UseCompression`,
`ConnectionTimeout`. The pool, Kerberos and timeout-of-the-pool options, and `IgnoreCommandTransaction` (every
command of a report runs inside its transaction), are accepted and change nothing for a report; `Character Set`
is ignored, as in MySqlConnector (the session is always utf8mb4). Named pipes and shared memory are refused with
a NotSupportedException.

`culture` is the culture of the run (`'en-US'` by default, as in openReport): the C# engine prints the
MySqlDateTime of `AllowZeroDateTime=True` with its current culture.

## Examples

Eleven sample reports, with pictures of their pages, their `.rep` files and the PDFs
`@reportman/node` makes of them, are in the
[examples gallery](https://github.com/tonimartir/reportman/tree/main/typescript/examples). To see
them run: `npx @reportman/server --samples`.

## Types

| MySQL | MySqlConnector type | Engine column | Value |
|---|---|---|---|
| TINYINT(1) (TreatTinyAsBoolean) | Boolean | Boolean | boolean (`0` false, anything else true) |
| TINYINT / UNSIGNED | SByte / Byte | Int64 / Byte | bigint / number |
| SMALLINT / UNSIGNED | Int16 / UInt16 | Int16 / Int64 | number / bigint |
| MEDIUMINT, INT / UNSIGNED | Int32 / UInt32 | Int32 / Int64 | number / bigint |
| BIGINT / UNSIGNED, BIT(n) | Int64 / UInt64 | Int64 / Decimal | bigint / CsDecimal |
| DECIMAL | Decimal | Decimal | CsDecimal, rounded to 29 digits as .NET; beyond decimal: FormatException |
| FLOAT, DOUBLE | Single, Double | Single, Double | number |
| YEAR | Int32 | Int32 | number |
| CHAR, VARCHAR, TEXT, ENUM, SET, JSON (any charset) | String | String | string; ColumnSize: characters of the utf8mb4 result |
| CHAR(36) (GuidFormat Char36), CHAR(32) (Char32), BINARY(16) (Binary16...) | Guid | Object | its text, lower case; not a Guid: FormatException |
| BINARY, VARBINARY, BLOB, GEOMETRY | Byte[] | Binary | Uint8Array |
| DATE, DATETIME, TIMESTAMP | DateTime | DateTime | RpDateTime (microseconds, DateTimeKind); a zero date: InvalidCastException, or DateTime.MinValue (ConvertZeroDateTime) |
| DATE, DATETIME, TIMESTAMP with AllowZeroDateTime | MySqlDateTime | Object | its DateTime in the culture, or `0000-00-00` |
| TIME | TimeSpan | Object | `13:45:30.1234000`, `-34.22:59:59` |
| NULL | Object | Object | null |
| VECTOR (MySQL 9) | ReadOnlyMemory\`1 | Object | `System.ReadOnlyMemory<Single>[n]` |

The engine columns of the .NET types the engine has no column for are what Variant.AssignFromObject of the C#
engine makes of their values (SByte, UInt16, UInt32 a Long; UInt64 a Decimal; the rest their text). The schema
of MySqlConnector has no DataTypeName, so no column is a declared date.

## Parameters, transactions, errors

- Placeholders are found as MySqlConnector finds them (`@NAME`, `?NAME`, `` @`NAME` ``, positional `?`, outside
  quotes and comments, backslash escapes unless NoBackslashEscapes) and bound by name, case-insensitive. An
  `@NAME` that is no parameter fails as there (`Parameter '@X' must be defined...`) unless AllowUserVariables.
  `:NAME` of a parameter of the command (the Delphi form the sample reports keep) is bound too; MySqlConnector
  leaves it to the server, which rejects it.
- Each value is written as MySqlConnector writes it: `true`/`false`, integers, a decimal with its scale, a double
  in its "R" text (`0.1` is a DECIMAL literal for the server, `1E+300` a DOUBLE one), `timestamp('...')` with
  the microseconds truncated, quoted strings with `\0`, `''` and `\\`, `_binary'...'` bytes (sent as bytes), and
  the errors of the Variant GETVALUEFROMSQL passes.
- The session is set up as MySqlConnector sets it up (utf8mb4, `SET NAMES utf8mb4` unless the server says it is
  utf8mb4 already, as MariaDB 11.5 does; no IGNORE_SPACE), the implicit transaction begins with
  `set session transaction isolation level ...;` and `start transaction;` (`with consistent snapshot` for
  Snapshot; Chaos is not supported), `close(true)` sends `commit`, `close(false)` `rollback`. Every command runs
  inside it, the one of GETVALUEFROMSQL too.
- Every call returns a promise by default. A report that reads data while an expression is evaluated
  (GETVALUEFROMSQL, a dataset opened on demand, REOPEN) needs `synchronous: true`: mysql2 then runs in a worker
  thread and every call waits for it (this thread does nothing else meanwhile; `ssl` cannot hold functions
  then). Without it such a report fails with the `SynchronousDataRequiredError` of the engine.
- Server errors are MySqlException with the server's message, number and SQLSTATE; the client errors have
  MySqlConnector's messages.

Differences with C#, on purpose: a MySqlConnection keeps one open reader, so the C# engine fails with `This
MySqlConnection is already in use` when a report keeps two datasets of one connection open (master/detail, two
datasets of a section, or a GETVALUEFROMSQL while the dataset being printed is open); this driver reads each
result at once and those reports run (GETVALUEFROMSQL and a dataset opened on demand with `synchronous: true`). And MySqlConnector hands
out the same MySqlDataReader for every command of a connection, so C# sends a detail dataset twice when its
master moves (the second time to load it); this driver sends it once.

## Tests

The tests run against the official images, MySQL 8.4 on port 53306 (and MariaDB 11 on 53307):

```bash
docker run -d --name reportman-mysql-test -p 53306:3306 -e MYSQL_ROOT_PASSWORD=rmtest_root \
  -e MYSQL_DATABASE=samples -e MYSQL_USER=rmtest -e MYSQL_PASSWORD=rmtest_pw mysql:8.4
docker run -d --name reportman-mariadb-test -p 53307:3306 -e MARIADB_ROOT_PASSWORD=rmtest_root \
  -e MARIADB_DATABASE=samples -e MARIADB_USER=rmtest -e MARIADB_PASSWORD=rmtest_pw mariadb:11
```

`RM_MYSQL_HOST`, `RM_MYSQL_PORT`, `RM_MYSQL_DATABASE`, `RM_MYSQL_USER`, `RM_MYSQL_PASSWORD` and
`RM_MYSQL_ROOT_PASSWORD` point the tests elsewhere (`RM_MYSQL_REMOTE_HOST`, the same server at an address that is not a loopback one, such as the WSL address, tests the refusal of the RSA key); without a server the database tests are skipped. Root reads
the general log of the server, to compare the statements of both engines.

`test/database.ts` copies `samples/samples.db` into the database (prices and rates as DECIMAL, dates as DATE,
the fish notes and pictures as TEXT and LONGBLOB) with a TYPES table of every type and its edge values, and the
values MySqlConnector refuses by default (zero dates, a CHAR(36) that is not a Guid).
`node test/generate-fixtures.ts` (with golden-cs built) writes the reference outputs of the C# engine: the report
copies whose SQL is adapted to MySQL (and, for the reports C# cannot run on one connection, a copy with a
connection per dataset), the metafile, PDF and statements of each report case, and what MySqlConnector reads
for each query of `test/cases.json`, from the server of `fixtures/server.json`. On another server,
`RM_MYSQL_LIVE=1` compares with golden-cs run at that moment (`RM_MYSQL_LIVE=1 RM_MYSQL_PORT=53307` for MariaDB).
