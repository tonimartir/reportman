#region Copyright
/*
 *  Report Manager:  Database Reporting tool for .Net and Mono
 *
 *     The contents of this file are subject to the MPL License
 *     with optional use of GPL or LGPL licenses.
 *     You may not use this file except in compliance with the
 *     Licenses. You may obtain copies of the Licenses at:
 *     http://reportman.sourceforge.net/license
 *
 *  Copyright (c) 1994 - 2026 Toni Martir (toni@reportman.es)
 *  All Rights Reserved.
*/
#endregion

using System;
using System.Collections;
using System.Collections.Generic;
using System.Data;
using System.Data.Common;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Reportman.Reporting
{
    /// <summary>
    /// An ADO.NET connection over a Reportman AI Agent connection (<see cref="DriverType.HttpAgent"/>): its SQL goes
    /// through the API (api/agent/execute) as the reports run it, and <see cref="DatabaseCatalogReader"/> reads its
    /// catalog through api/agent/readtables, readcolumns and readforeignkeys, as app.reportman.es/database-config does.
    /// It is what <see cref="DatabaseInfo.CreateDbConnection"/> gives for an Agent connection: the local schemas of the
    /// connection are read, generated and previewed with it as with any other one. Without an API key nor a session the
    /// example databases of the Hub still answer. There are no transactions.
    /// </summary>
    public sealed class HubAgentConnection : DbConnection
    {
        private readonly HttpAgentExecutor _executor = new HttpAgentExecutor();
        private ConnectionState _state = ConnectionState.Closed;
        private string _dialect;

        /// <summary>Gets or sets the base URL of the API (as <see cref="DatabaseInfo.HttpAgentBaseUrl"/>).</summary>
        public string BaseUrl { get; set; } = "";

        /// <summary>Gets or sets the API key of the connection, or "".</summary>
        public string ApiKey { get; set; } = "";

        /// <summary>Gets or sets the Bearer token of the session when there is no API key, or "".</summary>
        public string Token { get; set; } = "";

        /// <summary>Gets or sets the install id the token is bound to, or "".</summary>
        public string InstallId { get; set; } = "";

        /// <summary>Gets or sets the Hub database of the connection.</summary>
        public long HubDatabaseId { get; set; }

        /// <summary>Gets or sets the connection (alias) of the report, for the errors that name it.</summary>
        public string ConnectionName { get; set; } = "";

        /// <summary>Not used: the connection is the Hub database of <see cref="HubDatabaseId"/>.</summary>
        public override string ConnectionString { get; set; } = "";

        /// <summary>The Hub database, as text.</summary>
        public override string Database
        {
            get { return HubDatabaseId.ToString(System.Globalization.CultureInfo.InvariantCulture); }
        }

        /// <summary>The API.</summary>
        public override string DataSource
        {
            get { return BaseUrl ?? ""; }
        }

        /// <summary>The dialect of the Hub database.</summary>
        public override string ServerVersion
        {
            get { return Dialect; }
        }

        /// <summary>Open after <see cref="Open"/>, closed after <see cref="Close"/>.</summary>
        public override ConnectionState State
        {
            get { return _state; }
        }

        /// <summary>
        /// The Reportman AI dialect of the Hub database ("dialect" of its item of GET api/agent/databases, as
        /// "Firebird5"); "Default" when the Hub does not say it. Read once.
        /// </summary>
        public string Dialect
        {
            get
            {
                if (_dialect == null)
                {
                    string dialect = "";
                    try
                    {
                        Configure();
                        dialect = Task.Run(() => _executor.ReadDialectAsync(CancellationToken.None)).GetAwaiter().GetResult();
                    }
                    catch (Exception)
                    {
                        dialect = "";
                    }
                    _dialect = string.IsNullOrWhiteSpace(dialect) ? "Default" : dialect.Trim();
                }
                return _dialect;
            }
        }

        /// <summary>Not supported: a connection is one Hub database.</summary>
        public override void ChangeDatabase(string databaseName)
        {
            throw new NotSupportedException("A Reportman AI Agent connection can not change its database");
        }

        /// <summary>Closes it (nothing is kept open: every command is a request).</summary>
        public override void Close()
        {
            _state = ConnectionState.Closed;
        }

        /// <summary>
        /// Opens it: nothing is sent; without a Hub database the clear error of the engine (the commands and the
        /// catalog check it again).
        /// </summary>
        public override void Open()
        {
            if (HubDatabaseId <= 0)
                throw HttpAgentExecutor.NotConfiguredException(ConnectionName);
            _state = ConnectionState.Open;
        }

        /// <summary>Not supported: the API runs each SQL by itself.</summary>
        protected override DbTransaction BeginDbTransaction(IsolationLevel isolationLevel)
        {
            throw new NotSupportedException("A Reportman AI Agent connection has no transactions");
        }

        /// <summary>A command that runs its SQL through api/agent/execute.</summary>
        protected override DbCommand CreateDbCommand()
        {
            return new HubAgentCommand(this);
        }

        /// <summary>The executor with the credentials of the connection now.</summary>
        internal HttpAgentExecutor Executor
        {
            get
            {
                Configure();
                return _executor;
            }
        }

        private void Configure()
        {
            _executor.BaseUrl = BaseUrl ?? "";
            _executor.ApiKey = ApiKey ?? "";
            _executor.Token = string.IsNullOrEmpty(ApiKey) ? Token ?? "" : "";
            _executor.InstallId = InstallId ?? "";
            _executor.HubDatabaseId = HubDatabaseId;
            _executor.ConnectionName = ConnectionName ?? "";
        }

        /// <summary>The names of the tables of the Hub database (api/agent/readtables).</summary>
        internal async Task<List<string>> ReadTableNamesAsync(CancellationToken cancellationToken)
        {
            JsonElement tables = await Executor.ReadCatalogAsync("api/agent/readtables", null, "tables", cancellationToken)
                .ConfigureAwait(false);
            var result = new List<string>();
            foreach (JsonElement item in tables.EnumerateArray())
            {
                string name = item.ValueKind == JsonValueKind.String ? (item.GetString() ?? "").Trim() : "";
                if (name.Length > 0)
                    result.Add(name);
            }
            return result;
        }

        /// <summary>The columns of a table (api/agent/readcolumns), as the Agent describes them.</summary>
        internal Task<JsonElement> ReadColumnsAsync(string table, CancellationToken cancellationToken)
        {
            return Executor.ReadCatalogAsync("api/agent/readcolumns", table, "columns", cancellationToken);
        }

        /// <summary>The foreign keys of a table (api/agent/readforeignkeys).</summary>
        internal Task<JsonElement> ReadForeignKeysAsync(string table, CancellationToken cancellationToken)
        {
            return Executor.ReadCatalogAsync("api/agent/readforeignkeys", table, "foreignKeys", cancellationToken);
        }
    }

    /// <summary>A command of a <see cref="HubAgentConnection"/>: its SQL and parameters go through api/agent/execute.</summary>
    public sealed class HubAgentCommand : DbCommand
    {
        private HubAgentConnection _connection;
        private readonly HubAgentParameterCollection _parameters = new HubAgentParameterCollection();

        /// <summary>A command of <paramref name="connection"/>.</summary>
        public HubAgentCommand(HubAgentConnection connection)
        {
            _connection = connection;
        }

        /// <summary>The SQL.</summary>
        public override string CommandText { get; set; } = "";

        /// <summary>Kept for the callers; the API applies its own.</summary>
        public override int CommandTimeout { get; set; } = 30;

        /// <summary>Text only.</summary>
        public override CommandType CommandType { get; set; } = CommandType.Text;

        /// <summary>Not used.</summary>
        public override bool DesignTimeVisible { get; set; }

        /// <summary>Not used.</summary>
        public override UpdateRowSource UpdatedRowSource { get; set; }

        /// <summary>The <see cref="HubAgentConnection"/>.</summary>
        protected override DbConnection DbConnection
        {
            get { return _connection; }
            set { _connection = value as HubAgentConnection; }
        }

        /// <summary>Its parameters.</summary>
        protected override DbParameterCollection DbParameterCollection
        {
            get { return _parameters; }
        }

        /// <summary>Ignored: there are no transactions.</summary>
        protected override DbTransaction DbTransaction { get; set; }

        /// <summary>Nothing to cancel here: the asynchronous forms take a cancellation token.</summary>
        public override void Cancel()
        {
        }

        /// <summary>A parameter.</summary>
        protected override DbParameter CreateDbParameter()
        {
            return new HubAgentParameter();
        }

        /// <summary>Runs the SQL and gives its rows.</summary>
        protected override DbDataReader ExecuteDbDataReader(CommandBehavior behavior)
        {
            return Run(CancellationToken.None).GetAwaiter().GetResult().CreateDataReader();
        }

        /// <summary>Runs the SQL and gives its rows, stopping when <paramref name="cancellationToken"/> is cancelled.</summary>
        protected override async Task<DbDataReader> ExecuteDbDataReaderAsync(CommandBehavior behavior, CancellationToken cancellationToken)
        {
            DataTable table = await Run(cancellationToken).ConfigureAwait(false);
            return table.CreateDataReader();
        }

        /// <summary>Runs the SQL; the Agent does not say the rows affected (-1).</summary>
        public override int ExecuteNonQuery()
        {
            Run(CancellationToken.None).GetAwaiter().GetResult();
            return -1;
        }

        /// <summary>The first value of the first row, or null.</summary>
        public override object ExecuteScalar()
        {
            DataTable table = Run(CancellationToken.None).GetAwaiter().GetResult();
            return table.Rows.Count > 0 && table.Columns.Count > 0 ? table.Rows[0][0] : null;
        }

        /// <summary>Nothing to prepare.</summary>
        public override void Prepare()
        {
        }

        private Task<DataTable> Run(CancellationToken cancellationToken)
        {
            if (_connection == null)
                throw new InvalidOperationException("The command has no connection");
            var parameters = new List<DbParameterInfo>();
            foreach (DbParameter p in _parameters)
                parameters.Add(DbParameterInfo.FromDataParameter(p));
            HttpAgentExecutor executor = _connection.Executor;
            string sql = CommandText ?? "";
            // Off the caller's synchronization context: the synchronous forms wait for it
            return Task.Run(() => executor.ExecuteSqlAsync(sql, parameters, cancellationToken), cancellationToken);
        }
    }

    /// <summary>A parameter of a <see cref="HubAgentCommand"/>.</summary>
    public sealed class HubAgentParameter : DbParameter
    {
        /// <summary>Its type.</summary>
        public override DbType DbType { get; set; } = DbType.String;

        /// <summary>Input only.</summary>
        public override ParameterDirection Direction { get; set; } = ParameterDirection.Input;

        /// <summary>Not used.</summary>
        public override bool IsNullable { get; set; } = true;

        /// <summary>Its name.</summary>
        public override string ParameterName { get; set; } = "";

        /// <summary>Not used.</summary>
        public override int Size { get; set; }

        /// <summary>Not used.</summary>
        public override string SourceColumn { get; set; } = "";

        /// <summary>Not used.</summary>
        public override bool SourceColumnNullMapping { get; set; }

        /// <summary>Its value.</summary>
        public override object Value { get; set; }

        /// <summary>Back to text.</summary>
        public override void ResetDbType()
        {
            DbType = DbType.String;
        }
    }

    /// <summary>The parameters of a <see cref="HubAgentCommand"/>.</summary>
    public sealed class HubAgentParameterCollection : DbParameterCollection
    {
        private readonly List<DbParameter> _items = new List<DbParameter>();

        /// <summary>Their number.</summary>
        public override int Count { get { return _items.Count; } }

        /// <summary>A lock object.</summary>
        public override object SyncRoot { get { return ((ICollection)_items).SyncRoot; } }

        /// <summary>It grows.</summary>
        public override bool IsFixedSize { get { return false; } }

        /// <summary>It can be changed.</summary>
        public override bool IsReadOnly { get { return false; } }

        /// <summary>Not synchronized.</summary>
        public override bool IsSynchronized { get { return false; } }

        /// <summary>Adds a parameter.</summary>
        public override int Add(object value)
        {
            _items.Add((DbParameter)value);
            return _items.Count - 1;
        }

        /// <summary>Adds parameters.</summary>
        public override void AddRange(Array values)
        {
            foreach (object value in values)
                Add(value);
        }

        /// <summary>Removes them all.</summary>
        public override void Clear()
        {
            _items.Clear();
        }

        /// <summary>True when it has <paramref name="value"/>.</summary>
        public override bool Contains(object value)
        {
            return _items.Contains(value as DbParameter);
        }

        /// <summary>True when it has a parameter named <paramref name="value"/>.</summary>
        public override bool Contains(string value)
        {
            return IndexOf(value) >= 0;
        }

        /// <summary>Copies them.</summary>
        public override void CopyTo(Array array, int index)
        {
            ((ICollection)_items).CopyTo(array, index);
        }

        /// <summary>Its parameters.</summary>
        public override IEnumerator GetEnumerator()
        {
            return _items.GetEnumerator();
        }

        /// <summary>The position of <paramref name="value"/>, or -1.</summary>
        public override int IndexOf(object value)
        {
            return _items.IndexOf(value as DbParameter);
        }

        /// <summary>The position of the parameter named <paramref name="parameterName"/>, or -1.</summary>
        public override int IndexOf(string parameterName)
        {
            return _items.FindIndex(p => string.Equals(p.ParameterName, parameterName, StringComparison.OrdinalIgnoreCase));
        }

        /// <summary>Inserts a parameter.</summary>
        public override void Insert(int index, object value)
        {
            _items.Insert(index, (DbParameter)value);
        }

        /// <summary>Removes a parameter.</summary>
        public override void Remove(object value)
        {
            _items.Remove(value as DbParameter);
        }

        /// <summary>Removes the parameter at <paramref name="index"/>.</summary>
        public override void RemoveAt(int index)
        {
            _items.RemoveAt(index);
        }

        /// <summary>Removes the parameter named <paramref name="parameterName"/>.</summary>
        public override void RemoveAt(string parameterName)
        {
            int index = IndexOf(parameterName);
            if (index >= 0)
                _items.RemoveAt(index);
        }

        /// <summary>The parameter at <paramref name="index"/>.</summary>
        protected override DbParameter GetParameter(int index)
        {
            return _items[index];
        }

        /// <summary>The parameter named <paramref name="parameterName"/>.</summary>
        protected override DbParameter GetParameter(string parameterName)
        {
            int index = IndexOf(parameterName);
            return index >= 0 ? _items[index] : null;
        }

        /// <summary>Replaces the parameter at <paramref name="index"/>.</summary>
        protected override void SetParameter(int index, DbParameter value)
        {
            _items[index] = value;
        }

        /// <summary>Replaces the parameter named <paramref name="parameterName"/>.</summary>
        protected override void SetParameter(string parameterName, DbParameter value)
        {
            int index = IndexOf(parameterName);
            if (index >= 0)
                _items[index] = value;
            else
                _items.Add(value);
        }
    }
}
