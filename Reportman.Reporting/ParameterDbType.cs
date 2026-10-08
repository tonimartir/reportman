using System;
using System.Data;

namespace Reportman.Reporting
{
    /// <summary>
    /// The DbType a report parameter is sent with: the one of its value (<see cref="Variant.GetDbType"/>),
    /// except a date and time on PostgreSQL.
    /// </summary>
    /// <remarks>
    /// Since Npgsql 6, <see cref="DbType.DateTime"/> means <c>timestamp with time zone</c>, which only takes UTC
    /// values, so a date the person typed (<see cref="DateTimeKind.Unspecified"/>) failed before reaching the
    /// database: «Cannot write DateTime with Kind=Unspecified to PostgreSQL type 'timestamp with time zone'».
    /// It goes as <see cref="DbType.DateTime2"/> (<c>timestamp</c>) instead; compared with a <c>timestamptz</c>
    /// column, PostgreSQL reads it in the session's time zone, which is what the person meant. A UTC value
    /// keeps <see cref="DbType.DateTime"/>, the only type Npgsql writes it to.
    /// </remarks>
    public static class ParameterDbType
    {
        /// <summary>The type for <paramref name="value"/>, typed by the report as <paramref name="type"/>, on <paramref name="command"/>.</summary>
        public static DbType For(IDbCommand command, DbType type, object value)
        {
            if (type != DbType.DateTime || !IsNpgsql(command))
                return type;
            if (value is DateTime && ((DateTime)value).Kind == DateTimeKind.Utc)
                return type;
            return DbType.DateTime2;
        }

        private static bool IsNpgsql(IDbCommand command)
        {
            string name = command == null ? null : command.GetType().FullName;
            return name != null && name.StartsWith("Npgsql.", StringComparison.Ordinal);
        }
    }
}
