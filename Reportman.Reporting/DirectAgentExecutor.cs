#if NET8_0_OR_GREATER
using System;
using System.Data;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Reportman.Drawing;
using Reportman.Hub.Client.DataChannel;

namespace Reportman.Reporting
{
    /// <summary>
    /// <see cref="IDbCommandExecuter"/> that tries the direct WebRTC
    /// DataChannel transport first and falls back to <see cref="HttpAgentExecutor"/>
    /// transparently if the channel cannot be opened (corporate firewall,
    /// STUN unreachable, Agent that doesn't speak the protocol …).
    ///
    /// Pattern mirrors the proven path in
    /// <c>ReportmanAI/Reportman.Hub.Client/HubApiClient.DataChannel.cs</c>:
    ///   - <see cref="UseDirectChannel"/> master switch (default true).
    ///   - 10-minute cooldown after a failed negotiation, so subsequent
    ///     queries don't re-pay the open-timeout (~5 s) on each one.
    ///   - Per-database pool reuses the warm channel across calls.
    ///   - Effective transport surfaced via <see cref="LastConnectionMode"/>
    ///     and the <see cref="ConnectionModeChanged"/> event so a UI chip can
    ///     bind to it without having to know about WebRTC.
    ///
    /// .NET Framework (net48) builds compile this file out — Reportman.DataChannel
    /// requires .NET 6+ (SIPSorcery). On net48 consumers get only the HTTP
    /// path, identical to the Linux/FPC behaviour of the Delphi engine.
    /// </summary>
    public class DirectAgentExecutor : IDbCommandExecuter, IDisposable
    {
        // ─────────────── public configuration ───────────────

        /// <summary>API base URL (same as <see cref="HttpAgentExecutor.BaseUrl"/>).</summary>
        public string BaseUrl { get; set; }

        /// <summary>ApiKey for the database alias when no user is logged in.</summary>
        public string ApiKey { get; set; }

        /// <summary>Bearer JWT for logged-in user calls.</summary>
        public string Token { get; set; }

        /// <summary>Identifier of the database on the Hub side.</summary>
        public long HubDatabaseId { get; set; }

        /// <summary>
        /// Global kill-switch. Setting this to <c>false</c> at runtime makes
        /// every <see cref="Open"/> call go straight to HTTP, no negotiation
        /// attempt. Useful for diagnostics or forcibly-HTTP integration tests.
        /// </summary>
        public bool UseDirectChannel { get; set; } = true;

        /// <summary>
        /// Effective transport of the most recent <see cref="Open"/>.
        /// <see cref="ConnectionMode.Unknown"/> before any call.
        /// </summary>
        public ConnectionMode LastConnectionMode { get; private set; } = ConnectionMode.Unknown;

        /// <summary>Fired after every Open once the transport is decided.</summary>
        public event Action<ConnectionMode> ConnectionModeChanged;

        // ─────────────── internals ───────────────

        private readonly HttpAgentExecutor _inner;
        private readonly HttpClient _httpClient;

        // Pool and cooldown live on a shared static so they survive the
        // engine recreating DatabaseInfo (and therefore DirectAgentExecutor)
        // for every ShowData / preview / report run. Without this each
        // click would renegotiate from scratch, ignore the previous
        // failure's cooldown, and stack repeated 5 s open-timeouts back
        // to back. The pool keys sessions by hubDatabaseId which is
        // already the unit of Agent-side authentication, so two
        // executors with the same Id sharing a warm session is safe by
        // construction (the Hub validates each signaling request anyway).
        private static readonly WebRtcChannelPool s_pool = new();
        private static readonly System.Collections.Concurrent.ConcurrentDictionary<long, DateTimeOffset>
            s_negotiationFailedUntil = new();

        /// <summary>
        /// After a failed negotiation, suppress further direct attempts for
        /// this long. Matches the pool's max lifetime so a single first-query
        /// failure covers a whole warm window and we don't pay the ~5 s
        /// open-timeout on every follow-up. After it elapses we retry — the
        /// user may have left their VPN, the firewall whitelist may have
        /// changed, etc.
        /// </summary>
        private static readonly TimeSpan NegotiationFailureCooldown = TimeSpan.FromMinutes(10);

        /// <summary>
        /// Per-Execute timeout. The Agent emits a 1 Hz progress pulse so any
        /// longer silence means the Agent died — let the rolling watchdog
        /// inside <see cref="WebRtcDataChannelSession"/> raise. This outer
        /// cap stops a runaway query from blocking the engine thread forever.
        /// WebRtcDataChannelSession applies its own OpenTimeoutSeconds (5s)
        /// internally, so we don't add a second one here — wrapping the open
        /// in a linked CTS that gets disposed when the lambda returns can
        /// leave the session's background tasks observing a disposed token
        /// and surface as SocketException("operation aborted").
        /// </summary>
        private static readonly TimeSpan ExecuteTimeout = TimeSpan.FromMinutes(5);

        // ─────────────── construction ───────────────

        public DirectAgentExecutor()
        {
            _inner = new HttpAgentExecutor();
            _httpClient = CreateHttpClient();
            // s_pool is shared statically — see field declaration.
        }

        /// <summary>
        /// Builds the HttpClient used for the data-session signaling REST/WS
        /// calls. Debug builds accept any server certificate so a developer
        /// can hit a self-signed Kestrel (api.reportman.es:7006 dev) the same
        /// way HttpAgentExecutor and ReportmanAgentClient already do —
        /// keeping the three Agent-facing clients in lock-step.
        /// </summary>
        private static HttpClient CreateHttpClient()
        {
#if DEBUG
            var handler = new HttpClientHandler();
            handler.ServerCertificateCustomValidationCallback =
                (message, cert, chain, errors) => true;
            return new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
#else
            return new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
#endif
        }

        public DirectAgentExecutor(string baseUrl, string apiKey, long hubDatabaseId) : this()
        {
            BaseUrl = baseUrl;
            ApiKey = apiKey;
            HubDatabaseId = hubDatabaseId;
            _inner.BaseUrl = baseUrl;
            _inner.ApiKey = apiKey;
            _inner.HubDatabaseId = hubDatabaseId;
        }

        // ─────────────── IDbCommandExecuter ───────────────

        /// <summary>
        /// Delegates to the inner HTTP executor: both transports speak the
        /// same <see cref="HttpAgentCommand"/> for accumulated parameters,
        /// so callers don't need to know which one will execute.
        /// </summary>
        public IDbCommand CreateCommand()
        {
            SyncInnerConfig();
            return _inner.CreateCommand();
        }

        /// <summary>
        /// Try the direct channel first; on any failure (cooldown active,
        /// negotiation failed, channel error mid-query) silently fall back
        /// to the inner HTTP path. The caller never sees a "direct channel
        /// broke" exception — it sees the data, just over HTTP. The chip is
        /// the only visible difference.
        /// </summary>
        public DataTable Open(IDbCommand ncommand)
        {
            SyncInnerConfig();
            var direct = TryDirect(ncommand);
            if (direct != null) return direct;
            return _inner.Open(ncommand);
        }

        // ─────────────── direct path ───────────────

        private DataTable TryDirect(IDbCommand ncommand)
        {
            if (!ShouldTryDirect()) return null;
            if (!(ncommand is HttpAgentCommand cmd)) return null;
            if (string.IsNullOrEmpty(BaseUrl)) return null;
            if (HubDatabaseId <= 0) return null;

            try
            {
                using var cts = new CancellationTokenSource(ExecuteTimeout);
                // Detach from any captured SynchronizationContext (WPF UI
                // thread, Winforms message loop) before awaiting — TryOpenAsync
                // and ExecuteAsync inside Reportman.DataChannel use
                // ConfigureAwait(false) but I'd rather not rely on every
                // inner await staying that way over time.
                var ct = cts.Token;
                return Task.Run(() => TryDirectAsync(cmd, ct), ct)
                    .GetAwaiter().GetResult();
            }
            catch (Exception)
            {
                // Any unexpected synchronous failure: cool down, set Api,
                // let the outer caller go to HTTP. We never raise from here.
                MarkNegotiationFailed();
                UpdateMode(ConnectionMode.Api);
                return null;
            }
        }

        private async Task<DataTable> TryDirectAsync(HttpAgentCommand cmd, CancellationToken ct)
        {
            UpdateMode(ConnectionMode.Connecting);

            WebRtcDataChannelSession session;
            try
            {
                session = await s_pool.GetOrOpenAsync(HubDatabaseId, async tokn =>
                {
                    // Use the pool-supplied token directly. The session
                    // applies its own OpenTimeoutSeconds (5s) — wrapping
                    // this in a linked CTS that disposes when the lambda
                    // exits left the session's background workers
                    // observing a disposed token and surfaced as
                    // SocketException("operation aborted") on the next
                    // ShowData.
                    var startBody = BuildStartBody();
                    return await WebRtcDataChannelSession.TryOpenAsync(
                        _httpClient,
                        new Uri(BaseUrl),
                        Token,
                        startBody,
                        onProgress: null,
                        ct: tokn);
                }, ct);
            }
            catch
            {
                MarkNegotiationFailed();
                UpdateMode(ConnectionMode.Api);
                return null;
            }

            if (session == null)
            {
                MarkNegotiationFailed();
                UpdateMode(ConnectionMode.Api);
                return null;
            }

            UpdateMode(session.Mode);

            try
            {
                var executeData = new
                {
                    hubDatabaseId = HubDatabaseId,
                    sql = cmd.CommandText,
                    parameters = cmd.GetParameterInfos()
                };
                var bytes = await session.ExecuteAsync("execute_sql", executeData, ct);
                var dt = DeserializeFastSerializerDataTable(bytes);
                if (dt == null)
                {
                    // Agent answered with something other than FastSerializer
                    // (legacy or buggy build). Drop the session so the next
                    // call renegotiates fresh; fall through to HTTP for now.
                    try { await session.DisposeAsync(); } catch { /* swallow */ }
                    UpdateMode(ConnectionMode.Api);
                    return null;
                }
                return dt;
            }
            catch (OperationCanceledException)
            {
                // User-initiated cancel: keep the warm session and re-raise so
                // the engine surfaces Cancel instead of silently retrying HTTP.
                throw;
            }
            catch
            {
                try { await session.DisposeAsync(); } catch { /* swallow */ }
                UpdateMode(ConnectionMode.Api);
                return null;
            }
        }

        // ─────────────── helpers ───────────────

        private object BuildStartBody()
        {
            // DataSessionController accepts either:
            //   { agentApiKey, hubDatabaseId } — when there's no user JWT
            //     (headless tools or legacy ApiKey-authenticated clients), OR
            //   { hubDatabaseId } — when the call already carries a Bearer token.
            if (!string.IsNullOrEmpty(ApiKey))
                return new { agentApiKey = ApiKey, hubDatabaseId = HubDatabaseId };
            return new { hubDatabaseId = HubDatabaseId };
        }

        private bool ShouldTryDirect()
        {
            if (!UseDirectChannel) return false;
            if (s_negotiationFailedUntil.TryGetValue(HubDatabaseId, out var until)
                && until > DateTimeOffset.UtcNow) return false;
            return true;
        }

        private void MarkNegotiationFailed()
        {
            s_negotiationFailedUntil[HubDatabaseId] =
                DateTimeOffset.UtcNow + NegotiationFailureCooldown;
        }

        private void UpdateMode(ConnectionMode mode)
        {
            if (LastConnectionMode == mode) return;
            LastConnectionMode = mode;
            try { ConnectionModeChanged?.Invoke(mode); }
            catch { /* UI events must not crash the data path */ }
        }

        private void SyncInnerConfig()
        {
            // Keep the inner HTTP executor in lock-step. Callers may mutate
            // the public properties (ApiKey, Token, HubDatabaseId, BaseUrl)
            // at any moment; the inner needs to see those changes for the
            // fallback path to authenticate correctly.
            _inner.BaseUrl = BaseUrl;
            _inner.ApiKey = ApiKey;
            _inner.Token = Token;
            _inner.HubDatabaseId = HubDatabaseId;
        }

        private static DataTable DeserializeFastSerializerDataTable(byte[] payload)
        {
            if (payload == null || payload.Length == 0) return null;
            if (!Reportman.Drawing.FastSerializer.IsFastSerialized(payload)) return null;
            var ds = Reportman.Drawing.FastSerializer.DeSerializeDataSet(payload);
            if (ds == null || ds.Tables.Count == 0) return null;
            return ds.Tables[0];
        }

        // ─────────────── disposal ───────────────

        public void Dispose()
        {
            // s_pool is static + shared across executors; do not dispose it
            // when one executor goes away — the next one needs the warm
            // sessions. The pool's own idle/maxlife eviction handles staleness.
            try { _httpClient.Dispose(); }
            catch { /* swallow */ }
        }

        /// <summary>
        /// Drop every warm Direct Channel session and clear the negotiation
        /// cooldowns. Call after the user edits a connection (ApiKey /
        /// HubDatabaseId) so the next query renegotiates with the new
        /// credentials instead of reusing a session opened with the old ones.
        /// The warm pool keys sessions by HubDatabaseId, so an ApiKey change on
        /// the same database would otherwise keep hitting the stale session
        /// until the application is restarted. EvictAllAsync clears the pool
        /// synchronously (only the teardown of the old sessions is async), so a
        /// fire-and-forget call invalidates the cache immediately.
        /// </summary>
        public static void ResetChannelPool()
        {
            s_negotiationFailedUntil.Clear();
            try { _ = s_pool.EvictAllAsync(); }
            catch { /* best effort */ }
        }
    }
}
#endif
