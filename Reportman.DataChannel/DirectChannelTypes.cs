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
    /// <summary>Current phase of the in-flight SQL operation.</summary>
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
    /// <summary>Number of columns in the result set once known while <see cref="QueryPhase.Fetching"/>.</summary>
    public int ColumnCount { get; init; }
    /// <summary>Bytes received / total during <see cref="QueryPhase.Delivering"/>.</summary>
    public long BytesReceived { get; init; }
    /// <summary>Total bytes expected during <see cref="QueryPhase.Delivering"/>, or 0 when unknown.</summary>
    public long BytesTotal { get; init; }
    /// <summary>Free-form short status localized at the consumer site.</summary>
    public string? Note { get; init; }

    /// <summary>Shared instance representing no active query.</summary>
    public static readonly QueryProgress Idle = new();
    /// <summary>Creates a snapshot for the channel-negotiation phase, with an optional status note.</summary>
    public static QueryProgress Connecting(string? note = null) => new() { Phase = QueryPhase.Connecting, Note = note };
    /// <summary>Creates a snapshot for the query-preparation phase at the given elapsed seconds.</summary>
    public static QueryProgress Preparing(int elapsedSec) => new() { Phase = QueryPhase.Preparing, ElapsedSec = elapsedSec };
    /// <summary>Creates a snapshot for the server-side execution phase at the given elapsed seconds.</summary>
    public static QueryProgress Executing(int elapsedSec) => new() { Phase = QueryPhase.Executing, ElapsedSec = elapsedSec };
    /// <summary>Creates a snapshot for the row-fetching phase with the current row and column counts.</summary>
    public static QueryProgress Fetching(int elapsedSec, int rows, int cols) => new() { Phase = QueryPhase.Fetching, ElapsedSec = elapsedSec, RowsRead = rows, ColumnCount = cols };
    /// <summary>Creates a snapshot for the result-serialization phase at the given elapsed seconds.</summary>
    public static QueryProgress Serializing(int elapsedSec) => new() { Phase = QueryPhase.Serializing, ElapsedSec = elapsedSec };
    /// <summary>Creates a snapshot for the compression phase at the given elapsed seconds.</summary>
    public static QueryProgress Compressing(int elapsedSec) => new() { Phase = QueryPhase.Compressing, ElapsedSec = elapsedSec };
    /// <summary>Creates a snapshot for the delivery phase with bytes received so far and the total expected.</summary>
    public static QueryProgress Delivering(int elapsedSec, long bytes, long total) => new() { Phase = QueryPhase.Delivering, ElapsedSec = elapsedSec, BytesReceived = bytes, BytesTotal = total };
    /// <summary>Creates a snapshot for the decompression phase at the given elapsed seconds.</summary>
    public static QueryProgress Decompressing(int elapsedSec) => new() { Phase = QueryPhase.Decompressing, ElapsedSec = elapsedSec };
    /// <summary>Creates a snapshot for the client-side deserialization phase at the given elapsed seconds.</summary>
    public static QueryProgress Deserializing(int elapsedSec) => new() { Phase = QueryPhase.Deserializing, ElapsedSec = elapsedSec };
    /// <summary>Creates a snapshot marking the query as complete.</summary>
    public static QueryProgress Done() => new() { Phase = QueryPhase.Done };
}

/// <summary>
/// The sequential stages a single SQL operation passes through, from connecting and
/// preparing through fetching, transfer and decoding to completion.
/// </summary>
public enum QueryPhase
{
    /// <summary>No query is running.</summary>
    Idle,
    /// <summary>Negotiating the channel to the Agent.</summary>
    Connecting,
    /// <summary>The Agent is preparing the statement (parse/plan).</summary>
    Preparing,
    /// <summary>The database is executing the query.</summary>
    Executing,
    /// <summary>Reading result rows from the database.</summary>
    Fetching,
    /// <summary>Serializing the result set on the Agent.</summary>
    Serializing,
    /// <summary>Compressing the serialized payload.</summary>
    Compressing,
    /// <summary>Transferring the payload to the client.</summary>
    Delivering,
    /// <summary>Decompressing the received payload on the client.</summary>
    Decompressing,
    /// <summary>Deserializing the payload into rows on the client.</summary>
    Deserializing,
    /// <summary>The query has completed.</summary>
    Done
}
