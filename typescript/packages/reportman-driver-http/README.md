# reportman-driver-http

The Reportman AI Agent connections of Report Manager: the SQL of a report runs on a database behind a
Reportman DB Agent, through the Hub API (`https://aiapi.reportman.es` by default), with the behaviour of the
HttpAgent driver of the C# engine (`HttpAgentExecutor`): the same request, headers and credentials, the same
parameter values, the same columns and values from the answer, the same errors, so a report gives the same
metafile and the same PDF bytes in both engines. It needs only `fetch`: it runs in Node.js and in the
browser (no Node API, compiled without DOM or Node types).

```ts
import { openReport } from 'reportman-node';
import { reportmanAgent } from 'reportman-driver-http';

const report = await openReport('sales.rep', {
  connections: { SALES: reportmanAgent({ hubDatabaseId: 42, apiKey: process.env.RM_AGENT_KEY }) },
});
const pdf = await report.executeToPdf({ YEAR: 2025 });
```

## Options

`reportmanAgent(options)` returns a connection factory for `connections`. The options are the values a C#
host sets on the `DatabaseInfo` of the connection, and what the C# engine takes from its surroundings:

| Option | C# | |
|---|---|---|
| `hubDatabaseId` | `HttpAgentHubDatabaseId` | the Hub database (a long) |
| `apiKey` | `HttpAgentApiKey` | sent as `X-Reportman-ApiKey` |
| `token`, `installId` | `HttpAgentToken`, `HttpAgentInstallId` | a Bearer token (only without an API key) and the install id it is bound to (`X-Reportman-WebInstallId`) |
| `baseUrl` | `HttpAgentBaseUrl` | `https://aiapi.reportman.es` by default |
| `connectionsFile` | `ConfigFile` / the shared file | the `dbxconnections.ini` text (bytes: UTF-8 after a BOM, Windows-1252 otherwise), or a function that gets the `ConfigFile` of the report connection (`""` for the shared file of the computer) and returns its text, or `undefined` when there is none |
| `session` | `HttpAgentSessionToken`, `HttpAgentSessionInstallId` | the Reportman AI session of the host: `{ token: () => string, installId?: () => string }` |
| `timeout` | `HttpClient.Timeout` | milliseconds, 100 000 by default; 0 waits for ever |
| `culture` / `translator` | `Translator` | the language of the engine's messages (Spanish for `es`, English otherwise) |
| `fetch` | | another fetch (a test double, a proxy) |

The settings are resolved as `DatabaseInfo.Connect` resolves them: the values of the options (the default
base URL without one); when the report connection loads its parameters (`LoadParams`) and the connections
file has a section named as the connection, its `ApiKey`, `HubDatabaseId` and `Token` fill what the options
lack (a token only without an API key) and its `Url` (or `HttpAgentBaseUrl`) replaces the base URL; without
an API key or a token, the token of the session and its install id. A report connection whose driver is not
HttpAgent but whose section says `DriverName=Reportman AI Agent` (or `Reportman Agent`, `Http Agent`,
`HttpAgent`) is an Agent connection in C# too.

Without credentials the request goes as it is: the example databases of the Hub answer to everybody, and a
403 to a request without an API key and without a session is the clear error of the engine (text 1825:
*The connection "X" (Reportman AI Agent) has no API key and there is no Reportman AI session...*). A
connection without a Hub database fails before any request with text 1824 (*...is not configured on this
computer: it has no Hub database...*).

## The request

Each query is `POST {baseUrl without trailing /}/api/agent/execute` with
`content-type: application/json; charset=utf-8` and the body C# writes (`JsonSerializer`, camelCase,
`JavaScriptEncoder.Default`: ASCII only, `"`, `&`, `'`, `+`, `<`, `>` and `` ` `` as `"`...):

```json
{"hubDatabaseId":7,"sql":"SELECT ... WHERE ORDER_ID = @ID","parameters":[{"name":"ID","value":7,"dbType":11}]}
```

`name` is the alias of the report parameter; `dbType` the `System.Data.DbType` number of its type (the
value's type, as `Variant.GetDbType`: String 16, Int32 11, Int64 12, Double 8, Decimal 7, Boolean 3,
DateTime 6, Binary 1, Byte 2, SByte 14, Object 13); `value` the boxed .NET value: numbers as .NET writes them
(`1E-05`, `0.3333333333333333`, a decimal with its scale `12.50`), `true`/`false`, strings, a DateTime as
`2024-02-29T13:45:30.5` (`Z` for UTC, the local offset for a local one), bytes in base64, `{}` for DBNull,
`null` for no value (a detail whose master has no record). NaN and the infinities fail as in
System.Text.Json (`ArgumentException`). The command of `GETVALUEFROMSQL` goes the same way; a parameter of
it is named `@` + the alias and its value is the Variant itself, as C# writes one:
`{"Type":"Integer","Value":7}` (`{"Type":"Binary","Value":null}` for bytes).

## The answer

`{"success":true,"data":{"columns":[{"name","dataType"}],"rows":[[...]]}}` (or `columns` and `rows` at the
root) becomes the columns and values C# fills its DataTable with:

| `dataType` | Column | Value |
|---|---|---|
| `Int32`, `Int16` | Int32, Int16 | number |
| `Int64` | Int64 | bigint (read from its digits) |
| `Decimal` | Decimal | CsDecimal (read from its digits, with its scale) |
| `Double`, `Single` | Double, Single | number |
| `Boolean` | Boolean | boolean |
| `DateTime` | DateTime | RpDateTime (`yyyy-MM-dd`, `THH:mm`, `THH:mm:ss.fffffff`; with an offset, the local time of that instant) |
| `Byte[]` | Binary | Uint8Array from base64 (a cell that is not a string: no bytes) |
| anything else (`String`, `Guid`, `Byte`, `TimeSpan`, null) | String | string |

A `null` cell is DBNull, a missing cell too, and cells beyond the columns are ignored. A cell of another
JSON kind than its column (`"12"` in an Int32 column, `12.50` in a String one) is given as its text, as C#
does (`JsonElement.ToString()`), and the engine stores it as a DataTable does, with the same conversions
and errors (*Couldn't store <12.5> in N Column. Expected type is Int32.*). An empty column name becomes
`Column1`, `Column2`...; a repeated one is a `DuplicateNameException`. The body is read as
`ReadAsStringAsync` reads it (the charset of the content type, else a byte order mark, else UTF-8).

## Errors

The ones of C#, with their .NET type in `netType`:

- `{success:false, error}` from the Hub: `Exception` *HttpAgent execution failed: error*;
- an HTTP error: `Exception` *HttpAgent error InternalServerError: body* (the name of `HttpStatusCode`, or
  its number);
- an answer that is not JSON: the `JsonReaderException` of `JsonDocument.Parse`, with its line and byte
  position; one without `columns` or `rows`: *Invalid response format: missing columns or rows*; JSON of
  another shape: the `InvalidOperationException` / `KeyNotFoundException` of `JsonElement`;
- the timeout: `TaskCanceledException` *The request was canceled due to the configured HttpClient.Timeout of
  100 seconds elapsing.*;
- no answer: `HttpRequestException` with the reason and the endpoint (the texts of Windows sockets; C# shows
  the ones of its operating system, in its language).

## The executor

`createExecutor(request, options)` (or `connection.executor` of an `AgentConnection`) gives the rest of
`HttpAgentExecutor`: `testConnection()` (`api/agent/testconnection`, the message of the Hub), `readCatalog(action,
tableName, field)` (`api/agent/readtables`, `readcolumns`, `readforeignkeys`: the array of the answer) and
`readDialect()` (`GET api/agent/databases`: the dialect of the Hub database, or `""`).

## What is left out

- **The WebRTC direct channel.** On .NET 8+ the C# engine (`DirectAgentExecutor`) first asks the Hub for a
  DataChannel to the Agent (`api/data-session/start`) and falls back to this same HTTP path when it cannot
  open one. This package always uses HTTP, as the net48 build of the C# engine does: the data is the same,
  only the transport differs.
- **Data read from inside an expression** (`GETVALUEFROMSQL`, a field of a dataset not open yet, `REOPEN`):
  fetch is asynchronous, so the engine fails with its `SynchronousDataRequiredError` where C# sends the
  request and goes on; open the dataset before printing (OpenOnStart), as the reports of the designer do.
- A Single value of a master record sent to a detail goes with its double digits (the engine keeps Single
  values as doubles); C# writes its float digits.
- `fetch` adds its own headers (`user-agent`, `accept`...) and a browser sends a CORS preflight for the
  credentials headers: that is up to the Hub.

## Tests

The tests never call the real Hub: `test/hub.ts` is a mock Hub (`node:http`) with the routes the C#
executor calls, answering from `samples/samples.db` through `node:sqlite` (database 7 open to everybody, 17
with the credentials of the tests), canned answers for every column type, malformed answers and HTTP errors,
and a log of every request it receives. `node test/generate-fixtures.ts` (from this folder, golden-cs built)
writes the reports (`fixtures/reports/`: Agent copies of the samples and of the engine's synthetic reports,
and synthetic ones over the canned answers, with a relative connections file) and runs each case of
`test/cases.json` with golden-cs against the mock, pointed at it by the connections file of the run: the
metafile, the PDF or the error, and the requests the mock received (`fixtures/run/`). `--slow` adds the case
that waits for the 100 s timeout of HttpClient. The tests run each case in the TypeScript engine (as golden-cs
runs it, and through openReport) over the same mock: the same metafile, the same PDF bytes (C# clock), the
same requests of `api/agent/execute` (headers and body byte for byte), the same errors. The cases marked
`zone` (dates with an offset) compare only in the time zone the fixtures were made in (`fixtures/zone.json`);
`RM_AGENT_SLOW=1` waits for the real 100 s timeout.
