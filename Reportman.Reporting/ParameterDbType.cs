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
            bool npgsql = IsNpgsql(command);
            // A value its type cannot take goes with the type of the value, as Delphi binds it: an evaluated
            // list or expression parameter typed String by the report gives an integer, and Npgsql refused it.
            // The values Npgsql takes keep their type (and its conversions)
            if (npgsql && (value != null) && !(value is DBNull) && !NpgsqlTakes(type, value))
            {
                DbType? own = TypeOf(value);
                if (own.HasValue)
                    type = own.Value;
            }
            if (type != DbType.DateTime || !npgsql)
                return type;
            if (value is DateTime && ((DateTime)value).Kind == DateTimeKind.Utc)
                return type;
            return DbType.DateTime2;
        }

        /// <summary>Whether Npgsql writes a value of that type to a parameter of that DbType.</summary>
        private static bool NpgsqlTakes(DbType type, object value)
        {
            switch (type)
            {
                case DbType.Byte:
                case DbType.SByte:
                case DbType.Int16:
                case DbType.Int32:
                case DbType.Int64:
                case DbType.Decimal:
                case DbType.VarNumeric:
                    return value is byte || value is short || value is int || value is long || value is decimal || value is double;
                case DbType.Double:
                case DbType.Single:
                    return value is double || value is float;
                case DbType.Boolean:
                    return value is bool;
                case DbType.String:
                case DbType.AnsiString:
                case DbType.StringFixedLength:
                case DbType.AnsiStringFixedLength:
                    return value is string || value is char || value is byte[];
                case DbType.Binary:
                    return value is byte[];
                case DbType.DateTime:
                case DbType.DateTime2:
                    return value is DateTime || value is long;
                default:
                    return true;
            }
        }

        /// <summary>The DbType Npgsql infers from a value.</summary>
        private static DbType? TypeOf(object value)
        {
            if (value is bool) return DbType.Boolean;
            if (value is byte) return DbType.Int16;
            if (value is short) return DbType.Int16;
            if (value is int) return DbType.Int32;
            if (value is long) return DbType.Int64;
            if (value is decimal) return DbType.Decimal;
            if (value is double) return DbType.Double;
            if (value is float) return DbType.Single;
            if (value is string || value is char) return DbType.String;
            if (value is DateTime) return DbType.DateTime;
            if (value is byte[]) return DbType.Binary;
            string name = value.GetType().FullName;
            if (name == "System.DateOnly") return DbType.Date;
            if (name == "System.TimeOnly") return DbType.Time;
            return null;
        }

        private static bool IsNpgsql(IDbCommand command)
        {
            string name = command == null ? null : command.GetType().FullName;
            return name != null && name.StartsWith("Npgsql.", StringComparison.Ordinal);
        }
    }
}
