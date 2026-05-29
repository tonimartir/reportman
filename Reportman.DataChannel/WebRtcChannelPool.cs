using System.Collections.Concurrent;

namespace Reportman.Hub.Client.DataChannel;

/// <summary>
/// Caches one open <see cref="WebRtcDataChannelSession"/> per Hub database so
/// successive SQL queries on the same database reuse the negotiated peer
/// connection. Without the pool every query pays the full ~1–3s setup cost
/// (STUN gather + signaling + ICE checks + DTLS + SCTP). With the pool the
/// first query is unchanged, all subsequent queries cost ~50–100 ms (just
/// one DataChannel message round-trip).
///
/// Lifecycle of a pooled session (three concurrent timers — none of them
/// holds the channel open "forever"):
///
///   - <b>Idle timeout</b> (default 60 s): closes when no <c>ExecuteAsync</c>
///     has been issued for that long. Matches typical residential NAT UDP
///     binding TTL — past this point the warm channel wouldn't be useful
///     even if we kept it.
///   - <b>Max lifetime</b> (default 10 min): absolute cap regardless of use.
///     Prevents stale DTLS state and rotates the channel periodically.
///   - <b>Keepalive ping</b> (default every 25 s): sends a tiny "ping"
///     message on the DataChannel. The Agent ack'es with "pong"; the
///     outbound UDP packet alone refreshes the NAT mapping so the channel
///     keeps working past the router's idle binding TTL.
///
/// Also evicts when the channel is observed dead (DTLS failure, Agent
/// closed it, peer state change). The next caller gets a freshly negotiated
/// session transparently.
/// </summary>
public sealed class WebRtcChannelPool : IAsyncDisposable
{
    private static readonly TimeSpan DefaultIdleTimeout = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan DefaultMaxLifetime = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan DefaultKeepaliveInterval = TimeSpan.FromSeconds(25);

    private readonly TimeSpan _idleTimeout;
    private readonly TimeSpan _maxLifetime;
    private readonly TimeSpan _keepaliveInterval;

    private readonly ConcurrentDictionary<long, PooledEntry> _pool = new();
    private int _disposed; // 0 = alive

    public WebRtcChannelPool() : this(DefaultIdleTimeout, DefaultMaxLifetime, DefaultKeepaliveInterval) { }

    public WebRtcChannelPool(TimeSpan idleTimeout, TimeSpan maxLifetime, TimeSpan keepaliveInterval)
    {
        _idleTimeout = idleTimeout;
        _maxLifetime = maxLifetime;
        _keepaliveInterval = keepaliveInterval;
    }

    /// <summary>
    /// Returns a live session for <paramref name="hubDatabaseId"/>, either
    /// from cache or by negotiating a new one via the supplied opener. The
    /// opener is the same delegate the caller used to call
    /// <see cref="WebRtcDataChannelSession.TryOpenAsync"/> — passing it
    /// keeps this class free of HttpClient/Uri/bearer plumbing details.
    /// Returns <c>null</c> when opening fails (caller falls back to HTTP).
    /// </summary>
    public async Task<WebRtcDataChannelSession?> GetOrOpenAsync(
        long hubDatabaseId,
        Func<CancellationToken, Task<WebRtcDataChannelSession?>> opener,
        CancellationToken ct)
    {
        if (_disposed != 0) return null;

        // Fast path — return cached live session.
        if (_pool.TryGetValue(hubDatabaseId, out var existing))
        {
            if (existing.IsAlive)
            {
                existing.Touch();
                return existing.Session;
            }
            // Dead entry — evict and continue to open a fresh one. We don't
            // want a permanently stale entry blocking the slot.
            if (_pool.TryRemove(hubDatabaseId, out var dead))
                _ = dead.DisposeAsync().AsTask();
        }

        // Slow path — open a new session under a per-key lock so two parallel
        // queries on the same database don't negotiate two channels.
        var gate = _gates.GetOrAdd(hubDatabaseId, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            // Re-check: another waiter may have just opened it.
            if (_pool.TryGetValue(hubDatabaseId, out var raced) && raced.IsAlive)
            {
                raced.Touch();
                return raced.Session;
            }

            var session = await opener(ct).ConfigureAwait(false);
            if (session == null) return null;

            var entry = new PooledEntry(this, hubDatabaseId, session);
            _pool[hubDatabaseId] = entry;
            entry.StartTimers();
            return session;
        }
        finally
        {
            gate.Release();
        }
    }

    private readonly ConcurrentDictionary<long, SemaphoreSlim> _gates = new();

    internal void OnEntryDead(long hubDatabaseId, PooledEntry entry)
    {
        // Only remove if the dictionary still points at THIS entry — avoids
        // the race where a newer entry has already replaced the dead one.
        _pool.TryGetValue(hubDatabaseId, out var current);
        if (ReferenceEquals(current, entry))
            _pool.TryRemove(hubDatabaseId, out _);
    }

    /// <summary>
    /// Closes every cached session but keeps the pool itself usable. Call on
    /// logout / identity change — pooled sessions hold JWTs tied to the
    /// previous identity and shouldn't be reused under a new one. Subsequent
    /// <see cref="GetOrOpenAsync"/> calls will negotiate fresh sessions.
    /// </summary>
    public async Task EvictAllAsync()
    {
        if (_disposed != 0) return;
        var entries = _pool.Values.ToArray();
        _pool.Clear();
        foreach (var e in entries)
        {
            try { await e.DisposeAsync(); } catch { /* best effort */ }
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (System.Threading.Interlocked.Exchange(ref _disposed, 1) != 0) return;
        var entries = _pool.Values.ToArray();
        _pool.Clear();
        foreach (var e in entries)
        {
            try { await e.DisposeAsync(); } catch { /* best effort */ }
        }
        foreach (var g in _gates.Values)
        {
            try { g.Dispose(); } catch { }
        }
        _gates.Clear();
    }

    internal sealed class PooledEntry : IAsyncDisposable
    {
        private readonly WebRtcChannelPool _pool;
        private readonly long _hubDatabaseId;
        private readonly DateTimeOffset _openedAt;
        private DateTimeOffset _lastUse;
        private Timer? _idleTimer;
        private Timer? _keepaliveTimer;
        private int _disposed;

        public WebRtcDataChannelSession Session { get; }

        public bool IsAlive => _disposed == 0 && Session.IsAlive;

        public PooledEntry(WebRtcChannelPool pool, long hubDatabaseId, WebRtcDataChannelSession session)
        {
            _pool = pool;
            _hubDatabaseId = hubDatabaseId;
            Session = session;
            _openedAt = DateTimeOffset.UtcNow;
            _lastUse = _openedAt;
        }

        public void Touch() => _lastUse = DateTimeOffset.UtcNow;

        public void StartTimers()
        {
            // One periodic check covers BOTH idle and max-life, each gated by
            // a Session.IsBusy guard so neither evicts a session whose query
            // is still running. Previous version had a one-shot _maxLifeTimer
            // that would fire mid-query for any SQL longer than 10 min.
            _idleTimer = new Timer(_ => CheckIdle(), null, TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(10));
            _keepaliveTimer = new Timer(_ => _ = SendKeepaliveAsync(), null, _pool._keepaliveInterval, _pool._keepaliveInterval);
        }

        private void CheckIdle()
        {
            try
            {
                if (_disposed != 0) return;
                if (!Session.IsAlive) { _ = EvictAsync("channel dead"); return; }
                // While at least one ExecuteAsync is in flight the session
                // is healthy by definition (pulses arriving, watchdog
                // refreshed). Skip every eviction path AND refresh _lastUse
                // so the idle countdown restarts only after the query ends.
                if (Session.IsBusy)
                {
                    _lastUse = DateTimeOffset.UtcNow;
                    return;
                }
                if (DateTimeOffset.UtcNow - _openedAt > _pool._maxLifetime)
                {
                    _ = EvictAsync("max-life");
                    return;
                }
                if (DateTimeOffset.UtcNow - _lastUse > _pool._idleTimeout)
                    _ = EvictAsync("idle timeout");
            }
            catch { }
        }

        private async Task SendKeepaliveAsync()
        {
            try
            {
                if (_disposed != 0 || !Session.IsAlive) { _ = EvictAsync("dead at keepalive"); return; }
                await Session.SendKeepaliveAsync();
            }
            catch { }
        }

        private async Task EvictAsync(string reason)
        {
            if (System.Threading.Interlocked.Exchange(ref _disposed, 1) != 0) return;
            _pool.OnEntryDead(_hubDatabaseId, this);
            try { _idleTimer?.Dispose(); } catch { }
            try { _keepaliveTimer?.Dispose(); } catch { }
            try { await Session.DisposeAsync(); } catch { }
        }

        public ValueTask DisposeAsync() => new ValueTask(EvictAsync("disposed"));
    }
}
