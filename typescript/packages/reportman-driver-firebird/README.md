# @reportman/driver-firebird

Firebird for Report Manager in Node.js, through [node-firebird](https://github.com/hgourvest/node-firebird)
(the wire protocol in plain JavaScript), with the behaviour of FirebirdSql.Data.FirebirdClient 10.3, the
provider the C# engine and Reportman.Server open Firebird with: the same columns and .NET types, the same
values, the same parameter binding, the same transactions and the same errors, so a report gives the same
metafile and the same PDF bytes in both engines.

```ts
import { openReport } from '@reportman/node';
import { firebird } from '@reportman/driver-firebird';

const report = await openReport('invoices.rep', {
  connections: { SAMPLES: firebird('DataSource=db.example.com;Database=/data/sales.fdb;User=REPORTS;Password=...') },
});
const pdf = await report.executeToPdf({ FIRST_ORDER: 7, LAST_ORDER: 9 });
```

`firebird(options)` returns a connection factory for `connections`. `options` is a FirebirdClient
connection string (its keys and synonyms, `host/port:path` in the database...) or an object with
`connectionString`, `host`, `port`, `database`, `user`, `password`, `role`, `charset` (UTF8 by default),
`wireCrypt` (`Enabled` by default), `connectionTimeout` (15 s), `culture` and `synchronous`. The connection string of the
`.rep` is not used: the host says where the data is.

`culture` is the culture of the run (`'en-US'` by default, as in openReport): FirebirdClient formats a few
values with the current culture of the C# engine (the date of a TIMESTAMP WITH TIME ZONE, a number or date
sent to a text parameter).

## Types

| Firebird | FirebirdClient type | Engine column | Value |
|---|---|---|---|
| SMALLINT, INTEGER, BIGINT | Int16, Int32, Int64 | Int16, Int32, Int64 | number, number, bigint |
| INT128 | BigInteger | Int64 | bigint (beyond Int64: OverflowException, as the C# engine when it prints it) |
| NUMERIC, DECIMAL (any storage) | Decimal | Decimal | CsDecimal, scaled as FirebirdClient (12.30 reads 12.3); beyond decimal: OverflowException |
| FLOAT, DOUBLE PRECISION | Single, Double | Single, Double | number |
| DECFLOAT(16), DECFLOAT(34) | FbDecFloat | Object | its text: `12345E-2`, `-0`, `inf`, `nan` |
| CHAR, VARCHAR | String | String | string, CHAR padding kept (ColumnSize: characters) |
| CHAR/VARCHAR OCTETS | String | String | Uint8Array (the engine stores `System.Byte[]`, as C#) |
| CHAR(16)/VARCHAR(16) OCTETS | Guid | Object | `00112233-4455-...` |
| BLOB SUB_TYPE TEXT / BINARY | String / Byte[] | String / Binary | string / Uint8Array |
| DATE, TIMESTAMP | DateTime | DateTime | RpDateTime (1/10000 s) |
| TIME | TimeSpan | Object | `13:45:30.1234000` |
| TIME / TIMESTAMP WITH TIME ZONE | FbZonedTime / FbZonedDateTime | Object | `12:45:30.1234000 Europe/Madrid` / `7/1/2024 2:00:00 PM America/New_York` (UTC, the culture's date); an offset zone fails with "Unknown time zone ID." as in FirebirdClient |
| BOOLEAN | Boolean | Boolean | boolean |
| ARRAY | — | — | a NotSupportedException naming the column |

## Parameters, transactions, errors

- Placeholders are found as FirebirdClient finds them (`@NAME` outside quotes) and bound by name,
  case-insensitive. `:NAME` of a command parameter (the Delphi form a report keeps on an engine SQLite
  connection) is bound too, except in the body of an EXECUTE BLOCK; FirebirdClient leaves it to the
  server, which rejects it.
- A value is converted to the type the server describes for its placeholder, as FirebirdClient converts
  it (`Convert.ToInt32` and the like, a decimal truncated to the scale, the text of a value under the
  current culture), and fails with the same exception and message.
- The implicit transaction begins with the TPB FirebirdClient builds for the isolation level of the
  report connection (no wait, write); `close(true)` commits, `close(false)` rolls back. Every command
  runs inside it, the one of GETVALUEFROMSQL too.
- Every call returns a promise by default. A report that reads data while an expression is evaluated
  (GETVALUEFROMSQL, a dataset opened on demand, REOPEN), which the C# engine runs, needs
  `synchronous: true`: node-firebird then runs in a worker thread and every call waits for it (this
  thread does nothing else meanwhile). Without it such a report fails with the
  `SynchronousDataRequiredError` of the engine.
- Server errors are FbException with FirebirdClient's lines (`Dynamic SQL Error\nSQL error code = -204\n...`).

## Tests

The tests run against the official image, Firebird 5, on port 53050:

```bash
docker run -d --name reportman-fb-test -p 53050:3050 -e FIREBIRD_ROOT_PASSWORD=rmtest_root \
  -e FIREBIRD_USER=RMTEST -e FIREBIRD_PASSWORD=rmtest_pw -e FIREBIRD_DATABASE=samples.fdb \
  -e FIREBIRD_DATABASE_DEFAULT_CHARSET=UTF8 firebirdsql/firebird:5
```

The image's defaults suit both clients: Srp256 authentication and wire encryption required (node-firebird
negotiates Arc4 or ChaCha, FirebirdClient encrypts with `WireCrypt=Enabled`, its default); no
`firebird.conf` change is needed. `RM_FB_HOST`, `RM_FB_PORT`, `RM_FB_DATABASE`, `RM_FB_USER` and
`RM_FB_PASSWORD` point the tests elsewhere; without a server the database tests are skipped.

`test/database.ts` copies `samples/samples.db` into the database (prices and rates as NUMERIC, dates as
DATE, the fish notes and pictures as blobs) with a TYPES table of every type and its edge values.
`node test/generate-fixtures.ts` (with golden-cs built) writes the reference outputs of the C# engine:
the report copies whose SQL is adapted to Firebird, the metafile and PDF of each report case, and what
FirebirdClient reads for each query of `test/cases.json`.
