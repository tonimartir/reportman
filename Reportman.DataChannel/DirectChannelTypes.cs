namespace Reportman.Hub.Client.DataChannel;

/// <summary>
/// Effective transport for the most recent SQL operation.
/// Surfaced to the UI as a chip next to the busy indicator.
/// </summary>
public enum ConnectionMode
{
    /// <summary>No SQL has run yet, or last mode unknown.</summary>
    Unknown,
    /// <summary>Negotiating the channel; SDP/ICE in flight.</summary>
    Connecting,
    /// <summary>LAN direct (ICE candidate type = host).</summary>
    P2P,
    /// <summary>NAT hole-punched (srflx / prflx via STUN).</summary>
    HolePunched,
    /// <summary>Relayed through TURN.</summary>
    Relay,
    /// <summary>Fallback to the existing HTTP/API path.</summary>
    Api
}

/// <summary>
/// Snapshot of the current phase of an in-flight SQL operation, suitable
/// for binding to UI text near the busy indicator. The Agent emits its own
/// 1Hz pulse over the DataChannel; this struct mirrors that into a single
/// observable shape.
/// </summary>
public sealed record QueryProgress
{
    public QueryPhase Phase { get; init; } = QueryPhase.Idle;
    /// <summary>
    /// Seconds elapsed since the Agent received the request. Increases
    /// monotonically across all phases of a single query. Used to surface
    /// "Preparing 23 s" so the user knows the query is still alive even
    /// during long Plan/Execute phases with no row progress yet.
    /// </summary>
    public int ElapsedSec { get; init; }
    /// <summary>Live row count while <see cref="QueryPhase.Fetching"/>.</summary>
    public int RowsRead { get; init; }
    public int ColumnCount { get; init; }
    /// <summary>Bytes received / total during <see cref="QueryPhase.Delivering"/>.</summary>
    public long BytesReceived { get; init; }
    public long BytesTotal { get; init; }
    /// <summary>Free-form short status localized at the consumer site.</summary>
    public string? Note { get; init; }

    public static readonly QueryProgress Idle = new();
    public static QueryProgress Connecting(string? note = null) => new() { Phase = QueryPhase.Connecting, Note = note };
    public static QueryProgress Preparing(int elapsedSec) => new() { Phase = QueryPhase.Preparing, ElapsedSec = elapsedSec };
    public static QueryProgress Executing(int elapsedSec) => new() { Phase = QueryPhase.Executing, ElapsedSec = elapsedSec };
    public static QueryProgress Fetching(int elapsedSec, int rows, int cols) => new() { Phase = QueryPhase.Fetching, ElapsedSec = elapsedSec, RowsRead = rows, ColumnCount = cols };
    public static QueryProgress Serializing(int elapsedSec) => new() { Phase = QueryPhase.Serializing, ElapsedSec = elapsedSec };
    public static QueryProgress Compressing(int elapsedSec) => new() { Phase = QueryPhase.Compressing, ElapsedSec = elapsedSec };
    public static QueryProgress Delivering(int elapsedSec, long bytes, long total) => new() { Phase = QueryPhase.Delivering, ElapsedSec = elapsedSec, BytesReceived = bytes, BytesTotal = total };
    public static QueryProgress Decompressing(int elapsedSec) => new() { Phase = QueryPhase.Decompressing, ElapsedSec = elapsedSec };
    public static QueryProgress Deserializing(int elapsedSec) => new() { Phase = QueryPhase.Deserializing, ElapsedSec = elapsedSec };
    public static QueryProgress Done() => new() { Phase = QueryPhase.Done };
}

public enum QueryPhase
{
    Idle,
    Connecting,
    Preparing,
    Executing,
    Fetching,
    Serializing,
    Compressing,
    Delivering,
    Decompressing,
    Deserializing,
    Done
}
