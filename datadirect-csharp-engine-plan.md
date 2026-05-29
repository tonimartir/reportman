# DataDirect in the C# Reportman engine — implementation plan

> **Owner:** Toni Martir (`toni.martir@gmail.com`)
> **Date written:** 2026-05-29
> **Status:** planned, not started. Resume from here.

## Why this exists

Three transports have shipped DataDirect (Web, WPF Reportman.AI.Desktop,
Delphi). The C# port of the Delphi engine that lives in this repo
(`danzai/comunnt/reportman`) still talks to the Agent only over HTTP via
`HttpAgentExecutor` + `ReportmanAgentClient`. That C# engine powers
`Reportman.Designer` (Winforms) and `Reportman.WPF`. Both inherit DataDirect
the moment this plan is executed.

The infrastructure to share is already in place after commit `157a510`:
`Reportman.DataChannel` lives in this repo and exposes
`WebRtcDataChannelSession`, `WebRtcChannelPool` and `DirectChannelTypes`
self-contained (SIPSorcery only — no Reportman.Core / no AI suite dep).

## Two parts

### Part A — Wire DataDirect into `Reportman.Reporting`

Composite-executor pattern. The existing `HttpAgentExecutor` becomes the
fallback inside a new `DirectAgentExecutor` that tries WebRTC first.

```
       DatabaseInfo (Driver=HttpAgent)
                │ creates
                ▼
   ┌────────────────────────────────┐
   │  DirectAgentExecutor           │  ◄── NEW, implements IDbCommandExecuter
   │  - WebRtcChannelPool (warm)    │
   │  - inner HttpAgentExecutor     │
   │                                │
   │  Open(cmd):                    │
   │    try pool.AcquireAsync       │
   │    if session opened:          │
   │      send execute_sql over DC  │
   │      deserialize FastSerializer│
   │      LastConnectionMode = …    │
   │      return DataTable          │
   │    else: inner.Open(cmd)       │
   └──────────────┬─────────────────┘
                  │ fall back to
                  ▼
       HttpAgentExecutor (unchanged)
```

#### Files to create

1. **`Reportman.Reporting/DirectAgentExecutor.cs`** (~250 lines).
   - Implements `IDbCommandExecuter`.
   - Owns one `WebRtcChannelPool` instance per executor (per-DatabaseInfo).
   - Owns one inner `HttpAgentExecutor` for fallback.
   - Exposes `ConnectionMode LastConnectionMode { get; }` + an event so the
     UI can render a chip.
   - Auth wiring: reuses the `ApiKey` / `Token` / `HubDatabaseId` properties
     of `HttpAgentExecutor` (and forwards them to the pool's opener).

2. **`Reportman.Reporting/Signaling/DataSessionSignalingClient.cs`** (~150
   lines).
   - Wraps `POST /api/data-session/start` and the signaling WebSocket open.
   - Designed as a thin helper so the pool's `opener` lambda doesn't depend
     on `ReportmanAgentClient` directly (keeps the executor testable).
   - Reuses an `HttpClient` injected from `ReportmanAgentClient.GetHttpClient()`
     (need to expose that statically; trivial).

#### Files to modify

3. **`Reportman.Reporting/Reportman.Reporting.csproj`** — add
   `ProjectReference` to `..\Reportman.DataChannel\Reportman.DataChannel.csproj`.

4. **`Reportman.Reporting/DatabaseInfo.cs`** — at the spot where
   `HttpAgentExecutor` is constructed for `Driver == HttpAgent`, wrap it in
   `DirectAgentExecutor` instead. Add a static `EnableDirectChannel = true`
   so the build / config can opt out without recompiling each consumer.

#### Behavioural contract

- `Open(cmd)` is synchronous (the engine calls it from sync code paths).
  Inside, the DC path uses `Task.GetAwaiter().GetResult()` *only* with
  bounded timeouts (5 s open, ~30 s execute) — same pattern as the WPF
  `HubDatabaseExecutor` in `ReportmanAI/Reportman.Hub.Client`.
- Any exception from the DC path is caught and converted to a silent fall-
  back to the inner `HttpAgentExecutor.Open`. The user never sees a
  "WebRTC failed" error — they see the data, just over HTTP. The chip
  reports the truth ("API (HTTP fallback)").
- `LastConnectionMode` is updated after every `Open`, fires `ConnectionModeChanged`.

#### Auth alignment

`DataSessionController` in `ReportmanAI/Reportman.AI.Api` already accepts
both Bearer + `hubDatabaseId` and ApiKey-only (the Delphi commit
`e220710` taught it the second path). The Designer C# uses the user's
JWT (Bearer) when present, otherwise the per-connection ApiKey — same
logic as the existing `ReportmanAgentClient`. Nothing to add server-side.

#### NAT-aware detection

Inherited free from `Reportman.DataChannel/WebRtcDataChannelSession.cs`:
the `DetectMode()` method already includes the three fixes that shipped
this week — address mismatch (private↔public), mDNS `.local` and srflx-
gathered fallback.

#### Tests to ship

- Unit: a `Reportman.DataChannel.Tests` smoke that opens a loopback
  session against a stub signaling server (cf. the existing
  rpdchub-loopback test in the Delphi repo). New project,
  `Reportman.DataChannel.Tests.csproj`.
- Integration smoke: hit `api.reportman.es` with an ApiKey for the
  `cloud-17` database from a CLI runner. The runner asserts that
  `LastConnectionMode != ConnectionMode.Api` (meaning DC opened).

### Part B — Verify and extend the Delphi showdata chip

#### Current state (already shipped)

- The Sample Data form `rpmdfsampledatavcl.pas` creates a `TPanel`
  chip in `FormCreate` and re-applies it in the `HubDatabaseId` property
  setter so the assignment in `ShowDataset(data, hubDatabaseId)` after
  `Create()` is honoured.
- `rpdcintegration.pas` keeps a per-database cache populated inside
  `TryDirectImpl` right after `Execute`. `GetLastTransportForDatabase`
  prefers that cache over the pool's `PeekConnectionMode`.
- The NAT-aware detection includes mDNS .local and srflx fallback (commit
  `81e5d17`).

#### What the user asked

> "en el editor sql de delphi en el showdata debes indicar qué tipo de
> conexión se ha producido"

Reading this literally: when the dataset frame's `BShowData` button is
clicked, the resulting Sample Data form should show the transport used
for that execution. That **is** the chip — but the user worded it as
"indicar qué tipo de conexión", which suggests they may not consider a
panel chip enough or that something is currently wrong.

#### Two concrete checks

1. **Live verification** — open the Designer, connect to `cloud-17` via the
   `Reportman Agent` driver, build a dataset, click "Show data". Confirm
   the chip displays `Hole-Punch (NAT/STUN)` (teal) and not `Unknown`
   (pale). If it does — done; no code change needed for Part B beyond
   maybe nicer label.
2. **Auth-log entry** — `rpdcintegration.TryDirectImpl` already calls
   `TRpAuthManager.Instance.Log` after every Execute with the transport,
   row count and SQL head. Open the Designer's auth-log diagnostics
   window during ShowData and confirm a matching line appears.

#### Optional ampliación if the user wants more

- Add the transport string to the form caption:
  `Caption := TranslateStr(735, '…') + '  ·  ' + FormatTransportMode(...)`
  so it shows in the title bar as well as the chip.
- Add the same chip to the Monaco SQL editor footer
  (`rpfrmmonacoeditorvcl.pas`) so the user sees transport without
  opening Show Data.
- Add a tooltip on the chip explaining what the colors mean.

These are 5-30 minutes each; pick zero, some or all only if the user
confirms after step (1) that the chip alone isn't enough.

## Order of execution

| # | Step | Output | Estimated |
|---|---|---|---|
| 1 | Live check the Delphi chip during ShowData (Part B step 1) — guarantees Part B is OK or surfaces a regression we missed | — | 5 min |
| 2 | Reportman.Reporting.csproj adds Reportman.DataChannel project reference | csproj diff | 5 min |
| 3 | `DataSessionSignalingClient.cs` — extract the REST/WS open helpers from the existing ReportmanAI HubApiClient.DataChannel.cs as a guide | new file | 1 h |
| 4 | `DirectAgentExecutor.cs` — composite executor with pool + fallback. Borrow heavily from `HubDatabaseExecutor.cs` in ReportmanAI as the reference; it does the same thing one level higher | new file | 3 h |
| 5 | `DatabaseInfo.cs` — switch `HttpAgent` driver path to construct `DirectAgentExecutor` | small diff | 30 min |
| 6 | Smoke test: `Reportman.Designer` opens a dataset against cloud-17 over the Agent driver; LastConnectionMode != Api; log line appears | manual | 1 h |
| 7 | Optional: Delphi chip ampliación if the user wants caption + tooltip + Monaco footer | — | 1 h |
| 8 | Commit + update memory `project_direct_data_channel_plan.md` to mark C# engine done | — | 5 min |

Total: ~6 hours of focused work. The DC plumbing is mechanical because
the proven WPF version in `ReportmanAI/Reportman.Hub.Client/HubDatabaseExecutor.cs`
is a working template — the C# engine wrapper essentially mirrors it with
fewer DI dependencies.

## What is intentionally NOT in scope

- **No TURN/coturn**. Phase 7 is discarded — same rationale as the rest of
  the stack: SQL is already visible at the endpoints and the HTTP fallback
  covers the symmetric-NAT minority at zero infra cost.
- **No new auth flow**. The existing JWT + ApiKey paths cover the C#
  engine just like they cover the WPF and Delphi clients.
- **No new wire protocol**. The Agent side already speaks `execute_sql`
  with FastSerializer payloads and 1 Hz progress pulses; the C# port is a
  pure consumer.

## Reference points

- `c:\desarrollo\ReportmanAI\Reportman.Hub.Client\HubDatabaseExecutor.cs` —
  the proven template, one level above the executor we are building.
- `c:\desarrollo\ReportmanAI\Reportman.Hub.Client\HubApiClient.DataChannel.cs` —
  the signaling/start-session/pool orchestration (some logic moves into
  `DataSessionSignalingClient`).
- `c:\desarrollo\prog\toni\reportman\rpdcintegration.pas` — the Delphi
  equivalent of `DirectAgentExecutor` (hook installed onto `rpdatahttp`).
- `c:\desarrollo\prog\toni\reportman\rpdatadirect.pas` — Pascal binding to
  libdatachannel; the C# pool reaches similar concurrency invariants but
  on top of SIPSorcery.
- `c:\desarrollo\ReportmanAI\Reportman.AI.Api\Controllers\DataSessionController.cs` —
  the server side already accepts both auth modes.
