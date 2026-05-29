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
        private readonly WebRtcChannelPool _pool;
        private readonly HttpClient _httpClient;
        private DateTimeOffset _negotiationFailedUntil = DateTimeOffset.MinValue;

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
        /// Open-channel timeout. STUN gather is fast (&lt;500ms locally,
        /// &lt;1.5s over the public internet) and DTLS another ~500ms — 5s is
        /// the practical upper bound for any legitimate path including NAT
        /// hole-punching. Matches the Web/WPF clients exactly.
        /// </summary>
        private static readonly TimeSpan OpenTimeout = TimeSpan.FromSeconds(5);

        /// <summary>
        /// Per-Execute timeout. The Agent emits a 1 Hz progress pulse so any
        /// longer silence means the Agent died — let the rolling watchdog
        /// inside <see cref="WebRtcDataChannelSession"/> raise. This outer
        /// cap stops a runaway query from blocking the engine thread forever.
        /// </summary>
        private static readonly TimeSpan ExecuteTimeout = TimeSpan.FromMinutes(5);

        // ─────────────── construction ───────────────

        public DirectAgentExecutor()
        {
            _inner = new HttpAgentExecutor();
            _httpClient = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
            _pool = new WebRtcChannelPool();
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
                session = await _pool.GetOrOpenAsync(HubDatabaseId, async tokn =>
                {
                    using var openCts = CancellationTokenSource.CreateLinkedTokenSource(tokn);
                    openCts.CancelAfter(OpenTimeout);
                    var startBody = BuildStartBody();
                    return await WebRtcDataChannelSession.TryOpenAsync(
                        _httpClient,
                        new Uri(BaseUrl),
                        Token,
                        startBody,
                        onProgress: null,
                        ct: openCts.Token);
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
            if (_negotiationFailedUntil > DateTimeOffset.UtcNow) return false;
            return true;
        }

        private void MarkNegotiationFailed()
        {
            _negotiationFailedUntil = DateTimeOffset.UtcNow + NegotiationFailureCooldown;
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
            try { _pool.DisposeAsync().AsTask().GetAwaiter().GetResult(); }
            catch { /* swallow */ }
            try { _httpClient.Dispose(); }
            catch { /* swallow */ }
        }
    }
}
#endif
