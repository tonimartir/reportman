# @reportman/driver-mssql

SQL Server for Report Manager in Node.js, through [tedious](https://github.com/tediousjs/tedious) (the TDS
protocol in plain JavaScript), with the behaviour of Microsoft.Data.SqlClient 6.1, the provider the C# engine
and Reportman.Server open SQL Server with (`SQLServer`): the same session, the same columns and .NET types, the
same values, the same statements on the wire (a SQL batch without parameters, `sp_executesql` with the
declarations SqlClient writes otherwise), the same transactions and the same errors, so a report gives the same
metafile and the same PDF bytes in both engines.

```ts
import { openReport } from '@reportman/node';
import { mssql } from '@reportman/driver-mssql';

const report = await openReport('invoices.rep', {
  connections: { SAMPLES: mssql('Server=db.example.com;Database=sales;User ID=reports;Password=...') },
});
const pdf = await report.executeToPdf({ FIRST_ORDER: 7, LAST_ORDER: 9 });
```

`mssql(options)` returns a connection factory for `connections`. `options` is a SqlClient connection string or an
object with `connectionString`, `server` (Data Source), `database`, `user`, `password`, `connectTimeout`,
`authentication` (a tedious authentication: NTLM with a domain, Azure AD), `tls` (TLS options such as `ca`),
`culture` and `synchronous`. The connection string of the `.rep` is not used: the host says where the data is.

- The connection string is read as SqlConnectionString reads it: every keyword and synonym of SqlClient 6.1 (an
  unknown one fails with `Keyword not supported: 'x'.`), `true`/`yes`/`false`/`no`, its checks (`Invalid value
  for key 'Connect Timeout'.`, Packet Size, pool sizes, Failover Partner without Initial Catalog) and its
  defaults: **Encrypt=Mandatory** (TrustServerCertificate=False verifies the certificate), Application Name
  `Core Microsoft SqlClient Data Provider`, Workstation ID the machine name. Honoured: Data Source
  (`tcp:host\instance,port`, an instance through the SQL Server Browser), Initial Catalog, User ID, Password,
  Encrypt (Optional, Mandatory, Strict), TrustServerCertificate, HostNameInCertificate, ServerCertificate (as the
  trusted CA), Connect Timeout, Application Name, Workstation ID, Current Language, Packet Size,
  ApplicationIntent, MultiSubnetFailover, Type System Version (SQL Server 2000 and 2005: the dates and times as
  nvarchar, and with 2000 the max types and xml as text, ntext and image) and Authentication
  (SqlPassword, ActiveDirectoryManagedIdentity, ActiveDirectoryDefault). The pool, retry, failover, enclave and
  MultipleActiveResultSets keywords are accepted and change nothing for a report run.
- Left out, with a NotSupportedException that says so: Integrated Security (Windows authentication with the
  credentials of the process; give `authentication` instead), the other Azure AD methods, named pipes (`np:`),
  shared memory (`lpc:`), LocalDB, the dedicated administrator connection, User Instance, AttachDbFilename and
  Always Encrypted (Column Encryption Setting=Enabled).
- `culture` is the culture of the run (`'en-US'` by default, as in openReport): SqlClient converts a parameter
  value to text, or parses one, with the current culture of the C# engine.
- `synchronous: true` runs tedious in a worker thread and makes every call wait for it: the engine can then read
  data while it evaluates an expression (GETVALUEFROMSQL, a dataset opened on demand, REOPEN), as the C# engine
  does.

## The session

The login sets fODBC as SqlClient does, and nothing is sent after it: the session has the ODBC defaults of the
server (`@@OPTIONS` 5432: ANSI_NULLS, ANSI_PADDING, ANSI_WARNINGS, ANSI_NULL_DFLT_ON, CONCAT_NULL_YIELDS_NULL,
QUOTED_IDENTIFIER on, ARITHABORT off; `@@TEXTSIZE` -1), and the language, date format and first day of the week
of the login (or of Current Language).

## Types

| SQL Server | SqlClient type | Engine column | Value |
|---|---|---|---|
| tinyint, smallint, int, bigint | Byte, Int16, Int32, Int64 | Byte, Int16, Int32, Int64 | number, bigint |
| bit | Boolean | Boolean | boolean |
| decimal, numeric, money, smallmoney | Decimal | Decimal | CsDecimal (money with 4 decimals); beyond System.Decimal as SqlBuffer: trailing zeros dropped, else `Conversion overflows.` or `Invalid numeric precision/scale.` |
| float, real | Double, Single | Double, Single | number |
| char, varchar, text, nchar, nvarchar, ntext (any collation, UTF-8 too) | String | String | string, decoded with the code page of the collation |
| xml | String | String | the text of SqlXml.Value (`<c />`, line breaks Environment.NewLine) |
| binary, varbinary, image, timestamp/rowversion | Byte[] | Binary | Uint8Array |
| date, datetime, datetime2, smalldatetime | DateTime | DateTime | RpDateTime (datetime rounded to milliseconds as SqlClient) |
| time | TimeSpan | Object | its text, `13:45:30.1234567` |
| datetimeoffset | DateTimeOffset | Object | its LocalDateTime (the time zone of the process) |
| uniqueidentifier | Guid | Object | its text, lower case |
| sql_variant | Object | Object | the value of its base type |
| hierarchyid, geometry, geography | (no Microsoft.SqlServer.Types) | | fails as in the C# engine: `Unable to cast object of type 'System.DBNull' to type 'System.Type'.`, the cause `Could not load file or assembly 'Microsoft.SqlServer.Types, Version=10.0.0.0, ...'`; read them as `col.ToString()` or `CAST(col AS VARBINARY(MAX))` |

ColumnSize and DataTypeName are SqlClient's (decimal 17, nvarchar(30) 30, the max types 2147483647, ntext
1073741823, sql_variant 8009, `decimal` for numeric too, `timestamp` for rowversion).

## Parameters, results, transactions, errors

- A parameter goes as SqlClient sends the IDbDataParameter of the C# engine: its DbType chooses the SQL type
  (Object `sql_variant`, Boolean `bit`, Byte `tinyint`, Int32 `int`, Int64 `bigint`, Decimal `decimal(p,s)` of the
  value, Double `float`, DateTime `datetime`, String `nvarchar(n)` of the length or `nvarchar(4000)`,
  `nvarchar(max) ` beyond 4000 characters, Binary `varbinary`; SByte, the Char variant, fails with `No mapping
  exists from DbType SByte to a known SqlDbType.`); a value of another type is converted as Convert.ChangeType
  (`Failed to convert parameter value from a String to a Int32.`); a datetime before 1753 fails with
  `SqlDateTime overflow...`; a C# null (a master without rows) goes with the DEFAULT flag and the server answers
  `The parameterized query '(@A int)...' expects the parameter '@A', which was not supplied.`. The placeholders
  are SQL Server's `@NAME`; the Delphi form `:NAME` of a parameter of the command is written `@NAME` (outside
  literals, quoted identifiers and comments), which SqlClient leaves to the server.
- The result is the first result set with columns: the statements before it (DECLARE, INSERT, SET NOCOUNT) are
  skipped; an error before it raises every error of the batch (joined with a line break, as SqlException); an
  error inside it is raised; the errors after it are left, as SqlDataReader.Close leaves them.
- The implicit transaction begins with the isolation level of the report connection (Unspecified is
  ReadCommitted, Chaos fails as in SqlClient), `close(true)` commits and `close(false)` rolls back; a transaction
  the server ended (a COMMIT in the SQL, an error that rolls it back) fails as the completed SqlTransaction:
  `This SqlTransaction has completed; it is no longer usable.`. Every command runs inside it, the one of
  GETVALUEFROMSQL too.
- Server errors are SqlException with the messages, numbers, states and classes of the server; the client errors
  have SqlClient's messages (the ones of the operating system in English).

Differences with C#, on purpose: without MultipleActiveResultSets a SqlConnection keeps one open reader, and a
report that keeps two datasets of one connection open (master/detail, two datasets of a section) needs it. The C#
engine adds `MultipleActiveResultSets=True` to a connection string that does not set it, so both engines run those
reports with the same output; only with an explicit `MultipleActiveResultSets=False` the C# engine fails with
`There is already an open DataReader associated with this Connection which must be closed first.`, while this
driver, which reads each result at once, still runs them; the same goes for a GETVALUEFROMSQL while the dataset
being printed is open (it needs `synchronous: true`). The engine keeps no Int16, Single, Guid,
TimeSpan or DateTimeOffset value of a master: a detail parameter without a value of its own (sql_variant) takes
them as int, float or nvarchar. A DateTimeOffset before 1900 takes the standard offset of the local zone (.NET
applies the rules of Windows, JavaScript the local mean time).

## Tests

The tests run against the official image, SQL Server 2022 on port 51433 (the image needs `ACCEPT_EULA=Y`):

```bash
docker run -d --name reportman-mssql-test -p 51433:1433 -e ACCEPT_EULA=Y \
  -e 'MSSQL_SA_PASSWORD=RmTest_only1!' mcr.microsoft.com/mssql/server:2022-latest
```

`RM_MSSQL_HOST` (127.0.0.1: SqlClient does not reach a WSL port forward through localhost), `RM_MSSQL_PORT`,
`RM_MSSQL_DATABASE`, `RM_MSSQL_USER` and `RM_MSSQL_PASSWORD` point the tests elsewhere; without a server the
database tests are skipped.

`test/database.ts` copies `samples/samples.db` into the database (prices and rates as DECIMAL, dates as DATE,
the customers as VARCHAR, the fish notes and pictures as NVARCHAR(MAX) and VARBINARY(MAX)) with a TYPES table
of every type and its edge values (collations, UTF-8, xml, sql_variant), VARIANTS (a sql_variant of every base
type) and UDTS (hierarchyid, geometry, geography). `node test/generate-fixtures.ts` (with golden-cs built)
writes the reference outputs of the C# engine: the report copies whose SQL is adapted to SQL Server and the
synthetic reports of `test/cases.ts`, the metafile, PDF and statements of each report case, and what SqlClient
reads for each query. The statements are read from an Extended Events session (`rm_trace`, `test/trace.ts`):
both engines must send the server the same batches and the same `exec sp_executesql` calls.
