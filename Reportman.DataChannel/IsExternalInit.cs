#if NETFRAMEWORK
using System.ComponentModel;

namespace System.Runtime.CompilerServices
{
    /// <summary>
    /// Polyfill so C# 9 <c>init</c>-only setters and positional records compile
    /// on the .NET Framework target — the BCL there doesn't ship this marker
    /// type. net8.0/net9.0 provide it in-box, so the file is excluded on those
    /// targets via the <c>NETFRAMEWORK</c> guard.
    /// </summary>
    [EditorBrowsable(EditorBrowsableState.Never)]
    internal static class IsExternalInit
    {
    }
}
#endif
