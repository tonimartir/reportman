using System;
using System.Data;

namespace Reportman.Reporting
{
    /// <summary>
    /// Represents a structured parameter for remote SQL execution via HTTP Agent.
    /// Ensures type safety and prevents SQL injection.
    /// </summary>
    public class DbParameterInfo
    {
        /// <summary>
        /// Parameter name (e.g., "id" or "@id").
        /// </summary>
        public string Name { get; set; } = "";

        /// <summary>
        /// Parameter value. Passed as an object.
        /// </summary>
        public object Value { get; set; }

        /// <summary>
        /// Optional hint for the provider (maps to System.Data.DbType integer).
        /// </summary>
        public int? DbType { get; set; }

        public DbParameterInfo()
        {
        }

        public DbParameterInfo(string name, object value, int? dbType = null)
        {
            Name = name;
            Value = value;
            DbType = dbType;
        }

        /// <summary>
        /// Creates a DbParameterInfo from a report Param.
        /// </summary>
        public static DbParameterInfo FromParam(Param param)
        {
            return new DbParameterInfo
            {
                Name = param.Alias,
                Value = param.LastValue.AsObject(),
                DbType = (int)param.Value.GetDbType()
            };
        }

        /// <summary>
        /// Creates a DbParameterInfo from an IDataParameter.
        /// </summary>
        public static DbParameterInfo FromDataParameter(IDataParameter param)
        {
            return new DbParameterInfo
            {
                Name = param.ParameterName,
                Value = param.Value,
                DbType = (int)param.DbType
            };
        }
    }
}
