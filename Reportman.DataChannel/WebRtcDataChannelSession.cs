using System.Collections.Concurrent;
using System.Net.Http; // not in the .NET Framework target's implicit usings
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using SIPSorcery.Net;

namespace Reportman.Hub.Client.DataChannel;

/// <summary>
/// One-shot WebRTC peer for a single SQL operation against an Agent.
///
/// Lifecycle (per the per-SQL token decision):
///   1. POST /api/data-session/start (Bearer + agentApiKey) → sessionId + JWT + iceServers.
///   2. Open WS /api/data-session/{sessionId}/signal?token=jwt.
///   3. Build RTCPeerConnection, create a DataChannel, generate offer,
///      wait for ICE gather complete, forward offer over the signaling WS.
///      The Hub routes it to the Agent and the answer comes back wrapped
///      in {"source":"hub","body":"&lt;agent reply json&gt;"}.
///   4. setRemoteDescription(answer), wait DC open (≤10s).
///   5. Send {requestId, action, data} on the DC, collect executing /
///      fetching / data / done messages, return the deserialized payload.
///   6. Close the DC + peer + signaling WS; the session dies with the SQL.
///
/// If anything fails before <see cref="DataChannelReadyAsync"/> returns true,
/// the caller falls back to the existing HTTP path.
/// </summary>
public sealed class WebRtcDataChannelSession : IAsyncDisposable
{
    /// <summary>
    /// DataChannel open watchdog. STUN gather is fast (<500 ms locally,
    /// <1.5 s over the public internet) and DTLS another ~500 ms — 5 s is
    /// the practical upper bound for any legitimate path including NAT
    /// hole-punching and TURN relay. 10 s was too generous and made
    /// UDP-blocked corporate networks feel sluggish before the per-database
    /// cooldown cache in <see cref="HubApiClient"/> kicked in.
    ///
    /// Belt-and-braces: we ALSO subscribe to peer connectionState to fail
    /// fast (typically 1-2 s) when ICE concludes no candidate pair worked,
    /// instead of waiting the full cap.
    /// </summary>
    private const int OpenTimeoutSeconds = 5;
    /// <summary>
    /// Per-request rolling timeout. The Agent emits a 1Hz pulse during the
    /// entire request lifetime, so a 15s gap without any message proves the
    /// Agent is gone (process dead, network died, channel torn down).
    /// </summary>
    private static readonly TimeSpan RequestPulseTimeout = TimeSpan.FromSeconds(15);
    // Lowered from 5s — Google STUN responds in <500ms typically. Anything
    // taking longer than 1.5s indicates the path is broken; sending the
    // offer with whatever candidates we have lets the answer trickle in
    // candidates that show up later. ICE itself doesn't depend on this
    // strict timeout, only on the initial offer's candidate set.
    private static readonly TimeSpan IceGatherTimeout = TimeSpan.FromSeconds(1.5);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    private readonly HttpClient _http;
    private readonly Uri _apiBaseUri;
    private readonly string? _bearer;
    private readonly Action<QueryProgress>? _onProgress;

    private RTCPeerConnection? _peer;
    private RTCDataChannel? _channel;
    private ClientWebSocket? _signalingWs;
    private string? _sessionId;
    private string? _token;
    private ConnectionMode _mode = ConnectionMode.Connecting;
    // Stored so DisposeAsync can observe its completion/exception cleanly
    // instead of leaving it as a fire-and-forget that surfaces as an
    // UnobservedTaskException when the WS closes during teardown.
    private Task? _signalingLoopTask;
    private readonly CancellationTokenSource _signalingLoopCts = new();

    private readonly ConcurrentDictionary<string, RequestState> _requests = new();

    /// <summary>
    /// RequestId currently owning the binary lane. Set by a
    /// <c>progress phase=delivering binary=true</c> text frame and cleared
    /// by the matching <c>done</c>. While set, incoming binary frames are
    /// appended to that request's buffer. SIPSorcery delivers messages in
    /// order on a single thread per channel, so no lock is required.
    /// </summary>
    private string? _currentBinaryDestRequestId;

    private int _disposed; // 0 = alive, 1 = disposed (Interlocked guard).

    public ConnectionMode Mode => _mode;

    /// <summary>
    /// True when the negotiated DataChannel is open and the session hasn't
    /// been disposed. The pool reads this to decide whether to reuse the
    /// cached session or evict it and open a fresh one.
    /// </summary>
    public bool IsAlive =>
        _disposed == 0
        && _channel != null
        && _channel.readyState == RTCDataChannelState.open;

    /// <summary>
    /// True while at least one <see cref="ExecuteAsync"/> is in flight. The
    /// pool reads this in its idle/max-life check to avoid evicting a session
    /// whose query is still running — without this guard a query lasting
    /// longer than the pool's idle window (60s) or max-lifetime (10min)
    /// would be killed mid-flight as the timer fires against a session
    /// whose <c>Touch()</c> only ran at the start of the request.
    /// </summary>
    public bool IsBusy => !_requests.IsEmpty;

    /// <summary>
    /// Sends a tiny ping over the DataChannel and waits briefly for the pong.
    /// Used by the pool to keep the NAT mapping warm during idle windows so
    /// the next real query doesn't pay the full STUN/ICE/DTLS setup cost.
    /// Returns true if the channel was alive at send time (pong arrival is
    /// not strictly required — the outbound UDP packet alone refreshes the
    /// router's binding).
    /// </summary>
    public Task<bool> SendKeepaliveAsync(CancellationToken ct = default)
    {
        try
        {
            if (!IsAlive) return Task.FromResult(false);
            var msg = JsonSerializer.Serialize(new
            {
                requestId = Guid.NewGuid().ToString(),
                action = "ping"
            }, JsonOptions);
            _channel!.send(msg);
            // The Agent answers with type=pong+matching requestId but we don't
            // track it via _requests; the message goes through HandleDcMessage
            // which filters by known requestId and silently drops the pong.
            return Task.FromResult(true);
        }
        catch
        {
            return Task.FromResult(false);
        }
    }

    private WebRtcDataChannelSession(HttpClient http, Uri apiBaseUri, string? bearer, Action<QueryProgress>? onProgress)
    {
        _http = http;
        _apiBaseUri = apiBaseUri;
        _bearer = bearer;
        _onProgress = onProgress;
    }

    /// <summary>
    /// Attempts to negotiate a fresh DataChannel. <paramref name="startBody"/>
    /// is the JSON body for <c>POST /api/data-session/start</c>; accepts either
    /// <c>new { agentApiKey }</c> or <c>new { hubDatabaseId }</c>. Returns null
    /// on any failure; the caller should then fall back to the HTTP path.
    /// </summary>
    public static async Task<WebRtcDataChannelSession?> TryOpenAsync(
        HttpClient http,
        Uri apiBaseUri,
        string? bearer,
        object startBody,
        Action<QueryProgress>? onProgress,
        CancellationToken ct)
    {
        var session = new WebRtcDataChannelSession(http, apiBaseUri, bearer, onProgress);
        try
        {
            onProgress?.Invoke(QueryProgress.Connecting("starting session"));
            if (!await session.StartSessionAsync(startBody, ct))
            {
                await session.DisposeAsync();
                return null;
            }
            onProgress?.Invoke(QueryProgress.Connecting("opening signaling"));
            if (!await session.OpenSignalingAsync(ct))
            {
                await session.DisposeAsync();
                return null;
            }
            onProgress?.Invoke(QueryProgress.Connecting("negotiating peer"));
            if (!await session.NegotiateAsync(ct))
            {
                await session.DisposeAsync();
                return null;
            }
            return session;
        }
        catch
        {
            await session.DisposeAsync();
            return null;
        }
    }

    // --------------- Negotiation ---------------

    private async Task<bool> StartSessionAsync(object startBody, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, new Uri(_apiBaseUri, "api/data-session/start"));
        if (!string.IsNullOrEmpty(_bearer))
            req.Headers.TryAddWithoutValidation("Authorization", $"Bearer {_bearer}");
        // StringContent instead of JsonContent.Create so we don't drag in the
        // System.Net.Http.Json package on the .NET Framework target.
        var startJson = JsonSerializer.Serialize(startBody, JsonOptions);
        req.Content = new StringContent(startJson, Encoding.UTF8, "application/json");

        using var resp = await _http.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode) return false;

#if NETFRAMEWORK
        var body = await resp.Content.ReadAsStringAsync();
#else
        var body = await resp.Content.ReadAsStringAsync(ct);
#endif
        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        _sessionId = root.GetProperty("sessionId").GetString();
        _token = root.GetProperty("token").GetString();
        if (string.IsNullOrEmpty(_sessionId) || string.IsNullOrEmpty(_token)) return false;

        var iceServers = new List<RTCIceServer>();
        if (root.TryGetProperty("iceServers", out var iceArr))
        {
            foreach (var ice in iceArr.EnumerateArray())
            {
                var urls = ice.GetProperty("urls").GetString();
                if (!string.IsNullOrEmpty(urls))
                    iceServers.Add(new RTCIceServer { urls = urls });
            }
        }
        if (iceServers.Count == 0)
            iceServers.Add(new RTCIceServer { urls = "stun:stun.l.google.com:19302" });

        _peer = new RTCPeerConnection(new RTCConfiguration { iceServers = iceServers });
        _channel = await _peer.createDataChannel("data");
        return true;
    }

    private async Task<bool> OpenSignalingAsync(CancellationToken ct)
    {
        var wsScheme = _apiBaseUri.Scheme == "https" ? "wss" : "ws";
        var wsUri = new UriBuilder(_apiBaseUri)
        {
            Scheme = wsScheme,
            Path = $"/api/data-session/{_sessionId}/signal",
            Query = $"token={Uri.EscapeDataString(_token!)}"
        }.Uri;

        _signalingWs = new ClientWebSocket();
#if DEBUG
        // Match the HubApiClient HttpClient policy in Debug builds — self-signed
        // certs in local dev (Kestrel, IIS Express, debug IIS sites with cert
        // bound to a different SAN) would otherwise abort the TLS handshake
        // with RemoteCertificateNameMismatch / ChainErrors.
#if NETFRAMEWORK
        // net48's ClientWebSocketOptions has no RemoteCertificateValidationCallback;
        // the .NET Framework ClientWebSocket honours the process-wide hook instead.
        System.Net.ServicePointManager.ServerCertificateValidationCallback = (_, _, _, _) => true;
#else
        _signalingWs.Options.RemoteCertificateValidationCallback = (_, _, _, _) => true;
#endif
#endif
        await _signalingWs.ConnectAsync(wsUri, ct);
        return _signalingWs.State == WebSocketState.Open;
    }

    private async Task<bool> NegotiateAsync(CancellationToken ct)
    {
        // Build offer + wait for ICE gather complete (non-trickle path).
        var offer = _peer!.createOffer();
        await _peer.setLocalDescription(offer);
        await WaitIceGatherAsync(_peer, IceGatherTimeout);
        var offerSdp = _peer.localDescription!.sdp.ToString();

        // Send the offer through the signaling WS and read the wrapped reply
        // from the Hub. The middleware echoes the Hub response as
        // {"source":"hub","body":"{\"requestId\":..,\"success\":..,\"data\":..}"}.
        await SendSignalAsync(new { type = "offer", sdp = offerSdp }, ct);

        var answer = await ReadSignalUntilAnswerAsync(ct);
        if (answer == null) return false;
        _peer.setRemoteDescription(answer);

        // From here on, keep the signaling WS open just to receive Agent-
        // originated ICE candidates (Fase 3 already works with non-trickle,
        // but trickle is still valid). The task is stored so DisposeAsync
        // observes its completion instead of letting it surface as an
        // unobserved exception when the WS is torn down.
        _signalingLoopTask = Task.Run(() => SignalingReceiveLoopAsync(_signalingLoopCts.Token));

        // Wait until either the data channel opens, the peer signals
        // a terminal connection state, or we time out. Three concurrent
        // fail paths means we don't sit on the 5 s cap when the ICE
        // state machine has already concluded no candidate pair will
        // work — peer.onconnectionstatechange typically fires 'failed'
        // a couple of seconds after gathering finishes in that case.
        var openTcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        _channel!.onopen += () => openTcs.TrySetResult(true);
        _channel.onclose += () => openTcs.TrySetResult(false);
        _channel.onerror += _ => openTcs.TrySetResult(false);
        _peer!.onconnectionstatechange += state =>
        {
            if (state == RTCPeerConnectionState.failed || state == RTCPeerConnectionState.closed)
                openTcs.TrySetResult(false);
        };

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(TimeSpan.FromSeconds(OpenTimeoutSeconds));
        timeoutCts.Token.Register(() => openTcs.TrySetResult(false));

        var opened = await openTcs.Task;
        if (!opened) return false;

        // Plug the DC inbound handler now that we know it's live. The proto
        // arg discriminates text frames (control + small inline JSON payload)
        // from binary frames (chunks of the FastSerialized DataTable that
        // SQL queries return).
        _channel.onmessage += (ch, proto, data) => HandleDcMessage(proto, data);

        _mode = DetectMode();
        return true;
    }

    private static bool IsBinaryFrame(DataChannelPayloadProtocols proto) =>
        proto == DataChannelPayloadProtocols.WebRTC_Binary;

    /// <summary>
    /// Inflates a zlib (RFC 1950) stream that the Agent produced over the
    /// FastSerializer output. <see cref="System.IO.Compression.ZLibStream"/>
    /// only exists on .NET 6+, so on the .NET Framework target we strip the
    /// 2-byte zlib header and raw-inflate the RFC 1951 deflate payload with
    /// <see cref="System.IO.Compression.DeflateStream"/> (the trailing 4-byte
    /// Adler-32 is simply ignored once the deflate block ends).
    /// </summary>
    private static byte[] InflateZlib(byte[] buffer, int length)
    {
#if NETFRAMEWORK
        using var src = new MemoryStream(buffer, 2, length - 2, writable: false);
        using var inflate = new System.IO.Compression.DeflateStream(src, System.IO.Compression.CompressionMode.Decompress);
#else
        using var src = new MemoryStream(buffer, 0, length, writable: false);
        using var inflate = new System.IO.Compression.ZLibStream(src, System.IO.Compression.CompressionMode.Decompress);
#endif
        using var dst = new MemoryStream();
        inflate.CopyTo(dst);
        return dst.ToArray();
    }

    private ConnectionMode DetectMode()
    {
        // SIPSorcery 8.x doesn't expose getStats() nor the nominated ICE pair
        // publicly, so we can't read the actual selected candidate. Instead we
        // combine signals from BOTH sides of the negotiation:
        //
        //   1. Look at the REMOTE description (the Agent's candidates) — its
        //      nominated IP class tells us roughly where the Agent lives.
        //   2. Cross-reference with the LOCAL gathered types.
        //
        // Decision table (only what the heuristic can prove):
        //   - Remote has only private-range hosts (10/8, 172.16/12, 192.168/16,
        //     169.254/16) → we're on the same LAN as the Agent → P2P.
        //   - Local gathered a relay candidate → TURN was the chosen fallback
        //     when neither direct nor srflx worked → Relay.
        //   - Local gathered srflx (STUN succeeded) AND remote is public →
        //     hole-punched through NAT → HolePunched.
        //   - Local only gathered host AND remote is public → P2P (you have a
        //     public IP yourself, e.g. running on the same VPS as the Agent).
        try
        {
            var localSdp = _peer?.localDescription?.sdp?.ToString() ?? "";
            var remoteSdp = _peer?.remoteDescription?.sdp?.ToString() ?? "";

            var localTypes = ExtractCandidateTypes(localSdp);
            var localCandidates = ExtractCandidateAddresses(localSdp);
            var remoteCandidates = ExtractCandidateAddresses(remoteSdp);

            bool remoteAllPrivate = remoteCandidates.Count > 0
                && remoteCandidates.All(IsPrivateIp);

            if (remoteAllPrivate) return ConnectionMode.P2P;
            if (localTypes.Contains("relay")) return ConnectionMode.Relay;
            if (localTypes.Contains("srflx") || localTypes.Contains("prflx"))
                return ConnectionMode.HolePunched;
            // Defensive: when STUN didn't succeed (or was filtered) but the
            // host pairing still works, the gathered candidates are only
            // host-typed. If our local hosts are all RFC1918 private and the
            // remote announced any public address, the packets necessarily
            // traverse NAT — that's hole-punching, not LAN-direct.
            if (localCandidates.Count > 0 && localCandidates.All(IsPrivateIp)
                && remoteCandidates.Any(a => !IsPrivateIp(a)))
                return ConnectionMode.HolePunched;
            return ConnectionMode.P2P;
        }
        catch { return ConnectionMode.P2P; }
    }

    private static HashSet<string> ExtractCandidateTypes(string sdp)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrEmpty(sdp)) return set;
        foreach (var raw in sdp.Split('\n'))
        {
            var line = raw.TrimEnd('\r');
            if (line.IndexOf("a=candidate:", StringComparison.OrdinalIgnoreCase) < 0) continue;
            var typIdx = line.IndexOf(" typ ", StringComparison.Ordinal);
            if (typIdx < 0) continue;
            var rest = line.Substring(typIdx + 5);
            var sp = rest.IndexOf(' ');
            var typ = sp > 0 ? rest.Substring(0, sp) : rest;
            set.Add(typ.ToLowerInvariant());
        }
        return set;
    }

    private static List<string> ExtractCandidateAddresses(string sdp)
    {
        var list = new List<string>();
        if (string.IsNullOrEmpty(sdp)) return list;
        foreach (var raw in sdp.Split('\n'))
        {
            var line = raw.TrimEnd('\r');
            if (line.IndexOf("a=candidate:", StringComparison.OrdinalIgnoreCase) < 0) continue;
            // RFC 5245 format: candidate:<foundation> <component> <transport>
            // <priority> <connection-address> <port> typ <type> ...
            var parts = line.Split(' ');
            if (parts.Length >= 5) list.Add(parts[4]);
        }
        return list;
    }

    private static bool IsPrivateIp(string addr)
    {
        if (string.IsNullOrEmpty(addr)) return false;
        // mDNS-obfuscated host candidates (Chrome 76+ privacy default):
        // `<uuid>.local`. RFC 6762 .local names are link-local only, so
        // they are by definition private — and a peer using mDNS for its
        // host candidate is always behind whatever NAT/firewall it has.
        if (addr.EndsWith(".local", StringComparison.OrdinalIgnoreCase)) return true;
        if (!System.Net.IPAddress.TryParse(addr, out var ip)) return false;
        if (System.Net.IPAddress.IsLoopback(ip)) return true;
        var bytes = ip.GetAddressBytes();
        if (ip.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork && bytes.Length == 4)
        {
            // 10.0.0.0/8
            if (bytes[0] == 10) return true;
            // 172.16.0.0/12
            if (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31) return true;
            // 192.168.0.0/16
            if (bytes[0] == 192 && bytes[1] == 168) return true;
            // 169.254.0.0/16 (link-local)
            if (bytes[0] == 169 && bytes[1] == 254) return true;
        }
        if (ip.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6)
        {
            // fe80::/10 link-local, fc00::/7 ULA
            if (bytes.Length >= 2)
            {
                if (bytes[0] == 0xfe && (bytes[1] & 0xc0) == 0x80) return true;
                if ((bytes[0] & 0xfe) == 0xfc) return true;
            }
        }
        return false;
    }

    private static async Task WaitIceGatherAsync(RTCPeerConnection peer, TimeSpan timeout)
    {
        if (peer.iceGatheringState == RTCIceGatheringState.complete) return;
        var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        void H(RTCIceGatheringState s) { if (s == RTCIceGatheringState.complete) tcs.TrySetResult(true); }
        peer.onicegatheringstatechange += H;
        try
        {
            using var cts = new CancellationTokenSource(timeout);
            cts.Token.Register(() => tcs.TrySetResult(false));
            await tcs.Task;
        }
        finally
        {
            peer.onicegatheringstatechange -= H;
        }
    }

    private async Task SendSignalAsync(object payload, CancellationToken ct)
    {
        var json = JsonSerializer.Serialize(payload, JsonOptions);
        var bytes = Encoding.UTF8.GetBytes(json);
        // ArraySegment overload — the Memory<byte> overload doesn't exist on net48.
        await _signalingWs!.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct);
    }

    private async Task<RTCSessionDescriptionInit?> ReadSignalUntilAnswerAsync(CancellationToken ct)
    {
        var buf = new byte[64 * 1024];
        var ms = new MemoryStream();
        while (_signalingWs!.State == WebSocketState.Open)
        {
            var res = await _signalingWs.ReceiveAsync(new ArraySegment<byte>(buf), ct);
            if (res.MessageType == WebSocketMessageType.Close) return null;
            ms.Write(buf, 0, res.Count);
            if (!res.EndOfMessage) continue;

            var msgBytes = ms.ToArray();
            ms.SetLength(0);
            if (res.MessageType != WebSocketMessageType.Text) continue;

            try
            {
                using var doc = JsonDocument.Parse(msgBytes);
                var root = doc.RootElement;
                if (!root.TryGetProperty("source", out var src)) continue;
                if (src.GetString() != "hub") continue;
                var body = root.GetProperty("body").GetString();
                if (string.IsNullOrEmpty(body)) continue;
                using var inner = JsonDocument.Parse(body);
                var inRoot = inner.RootElement;
                if (!inRoot.GetProperty("success").GetBoolean()) return null;
                var data = inRoot.GetProperty("data");
                if (data.TryGetProperty("type", out var t) && t.GetString() == "answer")
                {
                    return new RTCSessionDescriptionInit
                    {
                        type = RTCSdpType.answer,
                        sdp = data.GetProperty("sdp").GetString()
                    };
                }
            }
            catch { /* ignore malformed; keep reading */ }
        }
        return null;
    }

    private async Task SignalingReceiveLoopAsync(CancellationToken ct)
    {
        // Drain any further messages from the API — primarily Agent-originated
        // ICE candidates wrapped as {"source":"agent","payload":{...}}.
        var buf = new byte[64 * 1024];
        var ms = new MemoryStream();
        try
        {
            while (_signalingWs!.State == WebSocketState.Open)
            {
                var res = await _signalingWs.ReceiveAsync(new ArraySegment<byte>(buf), ct);
                if (res.MessageType == WebSocketMessageType.Close) return;
                ms.Write(buf, 0, res.Count);
                if (!res.EndOfMessage) continue;
                var data = ms.ToArray();
                ms.SetLength(0);
                if (res.MessageType != WebSocketMessageType.Text) continue;
                try
                {
                    using var doc = JsonDocument.Parse(data);
                    var root = doc.RootElement;
                    if (root.TryGetProperty("source", out var src) && src.GetString() == "agent" &&
                        root.TryGetProperty("payload", out var payload) &&
                        payload.TryGetProperty("type", out var t) && t.GetString() == "ice" &&
                        payload.TryGetProperty("candidate", out var cand))
                    {
                        var init = JsonSerializer.Deserialize<RTCIceCandidateInit>(cand.GetRawText(), JsonOptions);
                        if (init != null) _peer?.addIceCandidate(init);
                    }
                }
                catch { /* ignore */ }
            }
        }
        catch { /* socket closed */ }
    }

    // --------------- DataChannel request/response ---------------

    /// <summary>
    /// Sends a single <c>{requestId, action, data}</c> request on the live
    /// DataChannel and returns the fully reassembled payload bytes. The
    /// caller decodes them per action: SQL-shaped actions get
    /// FastSerializer-binary bytes; metadata actions get UTF-8 JSON bytes.
    /// Progress messages from the Agent are surfaced via the constructor's
    /// onProgress callback. A 15s gap without any message from the Agent
    /// throws — the request is considered dead.
    /// </summary>
    public async Task<byte[]> ExecuteAsync(string action, object data, CancellationToken ct)
    {
        if (_channel == null || _channel.readyState != RTCDataChannelState.open)
            throw new InvalidOperationException("DataChannel not open");

        var requestId = Guid.NewGuid().ToString();
        var state = new RequestState();
        _requests[requestId] = state;
        ct.Register(() =>
        {
            // Best-effort cancel to the Agent so it stops emitting rows.
            try
            {
                var cancelMsg = JsonSerializer.Serialize(new { requestId, action = "cancel" }, JsonOptions);
                _channel?.send(cancelMsg);
            }
            catch { /* ignore */ }
            state.Completion.TrySetCanceled(ct);
        });

        // Rolling pulse watchdog: any message from the Agent (progress, done,
        // even the eventual error) refreshes LastSeenAt. If the gap exceeds
        // RequestPulseTimeout the request is failed locally; the caller
        // falls back to HTTP via the standard catch in TryRunDirectAsync.
        state.LastSeenAt = DateTimeOffset.UtcNow;
        state.PulseWatchdog = new Timer(_ => CheckPulse(requestId, state), null,
            TimeSpan.FromSeconds(3), TimeSpan.FromSeconds(3));

        var reqJson = JsonSerializer.Serialize(new { requestId, action, data }, JsonOptions);
        _channel.send(reqJson);

        try
        {
            return await state.Completion.Task.ConfigureAwait(false);
        }
        finally
        {
            state.PulseWatchdog?.Dispose();
            state.PulseWatchdog = null;
        }
    }

    private static void CheckPulse(string requestId, RequestState state)
    {
        try
        {
            if (state.Completion.Task.IsCompleted) return;
            var idle = DateTimeOffset.UtcNow - state.LastSeenAt;
            if (idle > RequestPulseTimeout)
            {
                state.Completion.TrySetException(new TimeoutException(
                    $"Agent stopped pulsing for {idle.TotalSeconds:N0}s — channel unresponsive"));
            }
        }
        catch { }
    }

    private void HandleDcMessage(DataChannelPayloadProtocols proto, byte[] raw)
    {
        // Binary frames carry FastSerializer-encoded result bytes for the
        // request currently holding the binary lane (set by a preceding
        // "progress phase=delivering binary=true" text frame). We only
        // bump the watchdog and append to the buffer — emitting a UI
        // progress event from EACH chunk would flood the WPF dispatcher
        // with thousands of layout invalidations per query. The Agent
        // already emits a 1Hz text "progress phase=delivering" pulse with
        // the authoritative bytesSent/bytesTotal, which is what drives
        // the UI counter at a sustainable cadence.
        if (IsBinaryFrame(proto))
        {
            var dest = _currentBinaryDestRequestId;
            if (dest != null && _requests.TryGetValue(dest, out var bstate))
            {
                bstate.Buffer.Write(raw, 0, raw.Length);
                bstate.LastSeenAt = DateTimeOffset.UtcNow;
            }
            return;
        }

        try
        {
            using var doc = JsonDocument.Parse(raw);
            var root = doc.RootElement;
            if (!root.TryGetProperty("requestId", out var rp)) return;
            var requestId = rp.GetString();
            if (string.IsNullOrEmpty(requestId) || !_requests.TryGetValue(requestId, out var state))
                return;

            // Any message bumps the rolling pulse — that's the whole
            // contract: 1Hz from the Agent ≡ liveness.
            state.LastSeenAt = DateTimeOffset.UtcNow;

            var type = root.GetProperty("type").GetString();
            switch (type)
            {
                case "progress":
                {
                    var phase = root.TryGetProperty("phase", out var pp) ? pp.GetString() : null;
                    var elapsedSec = root.TryGetProperty("elapsedSec", out var ep0) ? ep0.GetInt32() : 0;
                    state.LastElapsedSec = elapsedSec;
                    switch (phase)
                    {
                        case "connecting":
                            _onProgress?.Invoke(QueryProgress.Connecting());
                            break;
                        case "preparing":
                            _onProgress?.Invoke(QueryProgress.Preparing(elapsedSec));
                            break;
                        case "serializing":
                            _onProgress?.Invoke(QueryProgress.Serializing(elapsedSec));
                            break;
                        case "compressing":
                            _onProgress?.Invoke(QueryProgress.Compressing(elapsedSec));
                            break;
                        case "executing":
                            _onProgress?.Invoke(QueryProgress.Executing(elapsedSec));
                            break;
                        case "fetching":
                            var rows = root.TryGetProperty("rowsRead", out var rr) ? rr.GetInt32() : 0;
                            var cols = root.TryGetProperty("columnCount", out var cc) ? cc.GetInt32() : 0;
                            _onProgress?.Invoke(QueryProgress.Fetching(elapsedSec, rows, cols));
                            break;
                        case "delivering":
                            var bs = root.TryGetProperty("bytesSent", out var bsp) ? bsp.GetInt64() : 0;
                            var bt = root.TryGetProperty("bytesTotal", out var btp) ? btp.GetInt64() : 0;
                            state.LastBytesTotal = bt;
                            // First delivering frame for a binary payload claims the binary lane.
                            if (root.TryGetProperty("binary", out var bp) && bp.ValueKind == JsonValueKind.True)
                            {
                                _currentBinaryDestRequestId = requestId;
                                // The Agent compresses the FastSerializer output
                                // with zlib before chunking it; remember the flag
                                // so the done handler runs ZLibStream over the
                                // accumulated buffer before returning it.
                                state.IsCompressed = root.TryGetProperty("compressed", out var cp)
                                    && cp.ValueKind == JsonValueKind.True;
                            }
                            _onProgress?.Invoke(QueryProgress.Delivering(elapsedSec, bs, bt));
                            break;
                    }
                    break;
                }
                case "payload":
                {
                    // Small JSON payloads (test_connection, read_tables, …)
                    // arrive inline as a single text frame.
                    var json = root.TryGetProperty("json", out var jp) ? jp.GetString() ?? "" : "";
                    var bytes = Encoding.UTF8.GetBytes(json);
                    state.Buffer.Write(bytes, 0, bytes.Length);
                    break;
                }
                case "done":
                    if (_currentBinaryDestRequestId == requestId)
                        _currentBinaryDestRequestId = null;
                    _requests.TryRemove(requestId, out _);
                    if (root.GetProperty("success").GetBoolean())
                    {
                        if (state.IsCompressed)
                        {
                            // Inflate off the SCTP receive thread (zlib of a
                            // 30 MB buffer takes ~3-5 s and we don't want to
                            // block further channel I/O) AND surface a
                            // "Descomprimiendo" status so the user knows the
                            // app isn't frozen during those seconds.
                            var ticker = new System.Threading.CancellationTokenSource();
                            _ = Task.Run(async () =>
                            {
                                var startedUtc = DateTimeOffset.UtcNow;
                                _onProgress?.Invoke(QueryProgress.Decompressing(0));
                                var tickerTask = Task.Run(async () =>
                                {
                                    try
                                    {
                                        while (!ticker.Token.IsCancellationRequested)
                                        {
                                            await Task.Delay(1000, ticker.Token);
                                            var elapsed = (int)(DateTimeOffset.UtcNow - startedUtc).TotalSeconds;
                                            _onProgress?.Invoke(QueryProgress.Decompressing(elapsed));
                                        }
                                    }
                                    catch (OperationCanceledException) { /* normal */ }
                                });
                                try
                                {
                                    var inflated = InflateZlib(state.Buffer.GetBuffer(), (int)state.Buffer.Length);
                                    _onProgress?.Invoke(QueryProgress.Done());
                                    state.Completion.TrySetResult(inflated);
                                }
                                catch (Exception decompressEx)
                                {
                                    state.Completion.TrySetException(decompressEx);
                                }
                                finally
                                {
                                    ticker.Cancel();
                                    try { await tickerTask; } catch { }
                                    ticker.Dispose();
                                }
                            });
                        }
                        else
                        {
                            _onProgress?.Invoke(QueryProgress.Done());
                            state.Completion.TrySetResult(state.Buffer.ToArray());
                        }
                    }
                    else
                    {
                        var err = root.TryGetProperty("error", out var ep) ? ep.GetString() : "Agent reported failure";
                        state.Completion.TrySetException(new InvalidOperationException(err ?? "Agent reported failure"));
                    }
                    break;
                case "pong":
                    // Keepalive response — LastSeenAt already bumped above.
                    break;
            }
        }
        catch
        {
            // Don't fail the request for a bad progress frame; only 'done' completes it.
        }
    }

    // --------------- Disposal ---------------

    public async ValueTask DisposeAsync()
    {
        // Idempotent — the pool may call Dispose from multiple eviction paths
        // (idle timer, max-life timer, manual close), and the user-driven
        // teardown can race with any of them.
        if (System.Threading.Interlocked.Exchange(ref _disposed, 1) != 0) return;

        foreach (var kv in _requests)
            kv.Value.Completion.TrySetCanceled();
        _requests.Clear();

        // Signal the receive loop to stop and OBSERVE its task so any
        // exception thrown when the WS gets torn down doesn't surface as
        // an UnobservedTaskException popup.
        try { _signalingLoopCts.Cancel(); } catch { }

        try { _channel?.close(); } catch { }
        try { _peer?.close(); } catch { }
        if (_signalingWs != null)
        {
            try
            {
                if (_signalingWs.State == WebSocketState.Open)
                    await _signalingWs.CloseAsync(WebSocketCloseStatus.NormalClosure, "done", CancellationToken.None);
            }
            catch { }
            _signalingWs.Dispose();
        }

        if (_signalingLoopTask != null)
        {
            try
            {
                // Bounded wait — Task.WaitAsync is net6+, so use WhenAny for the
                // net48 target. If the loop finished we await it to observe any
                // exception; if it timed out, SignalingReceiveLoopAsync swallows
                // everything internally so nothing surfaces unobserved.
                var finished = await Task.WhenAny(_signalingLoopTask, Task.Delay(TimeSpan.FromSeconds(2)));
                if (finished == _signalingLoopTask)
                    await _signalingLoopTask;
            }
            catch { /* observed and intentionally swallowed */ }
        }

        try { _signalingLoopCts.Dispose(); } catch { }
        GC.SuppressFinalize(this);
    }

    private sealed class RequestState
    {
        public TaskCompletionSource<byte[]> Completion { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public MemoryStream Buffer { get; } = new();
        /// <summary>Last time we received ANY frame for this request. Bumped on every progress/done.</summary>
        public DateTimeOffset LastSeenAt { get; set; } = DateTimeOffset.UtcNow;
        /// <summary>Last elapsedSec the Agent reported — used to colour binary chunk progress.</summary>
        public int LastElapsedSec { get; set; }
        /// <summary>Last bytesTotal reported by the Agent — used to colour binary chunk progress.</summary>
        public long LastBytesTotal { get; set; }
        /// <summary>
        /// True when the Agent announced the binary payload is zlib-compressed
        /// (RFC 1950). The done handler decompresses the buffer before
        /// completing the task. Set by the first "delivering binary=true"
        /// progress frame.
        /// </summary>
        public bool IsCompressed { get; set; }
        /// <summary>Per-request rolling-pulse watchdog timer (15s gap → channel unresponsive).</summary>
        public Timer? PulseWatchdog { get; set; }
    }
}
