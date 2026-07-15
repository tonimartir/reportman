using Reportman.Drawing;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Data;
using System.Net.Http;
using System.Text;
using System.Text.Json;

namespace Reportman.Reporting
{
    /// <summary>
    /// Executes SQL commands via HTTP Agent API.
    /// Implements IDbCommandExecuter to integrate with the reporting engine.
    /// </summary>
    public class HttpAgentExecutor : IDbCommandExecuter
    {
        private readonly HttpClient _httpClient;
        private readonly JsonSerializerOptions _jsonOptions;

        /// <summary>
        /// Base URL for the API (e.g., "https://api.reportman.es")
        /// </summary>
        public string BaseUrl { get; set; }

        /// <summary>
        /// API Key for authentication (alternative to Token)
        /// </summary>
        public string ApiKey { get; set; }

        /// <summary>
        /// Bearer token for authentication (alternative to ApiKey)
        /// </summary>
        public string Token { get; set; }

        /// <summary>
        /// Hub Database Id - identifies the database on the remote agent
        /// </summary>
        public long HubDatabaseId { get; set; }

        /// <summary>
        /// Initializes a new executor with an internal HttpClient and default JSON options.
        /// </summary>
        public HttpAgentExecutor()
        {
#if DEBUG
            var handler = new HttpClientHandler();
            handler.ServerCertificateCustomValidationCallback = (message, cert, chain, errors) => true;
            _httpClient = new HttpClient(handler);
#else
            _httpClient = new HttpClient();
#endif
            _jsonOptions = new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase
            };
        }

        /// <summary>
        /// Initializes a new executor with the base URL, API key and hub database identifier.
        /// </summary>
        /// <param name="baseUrl">Base URL of the HTTP Agent API.</param>
        /// <param name="apiKey">API key used for authentication.</param>
        /// <param name="hubDatabaseId">Hub database identifier of the target database.</param>
        public HttpAgentExecutor(string baseUrl, string apiKey, long hubDatabaseId) : this()
        {
            BaseUrl = baseUrl;
            ApiKey = apiKey;
            HubDatabaseId = hubDatabaseId;
        }

        /// <summary>
        /// Creates a new HttpAgentCommand for building SQL queries.
        /// </summary>
        public IDbCommand CreateCommand()
        {
            return new HttpAgentCommand(this);
        }

        /// <summary>
        /// Executes the command and returns the result as a DataTable.
        /// </summary>
        public DataTable Open(IDbCommand ncommand)
        {
            if (!(ncommand is HttpAgentCommand cmd))
                throw new ArgumentException("Command must be HttpAgentCommand");

            return ExecuteSql(cmd.CommandText, cmd.GetParameterInfos());
        }

        /// <summary>
        /// Executes SQL and returns a DataTable.
        /// </summary>
        private DataTable ExecuteSql(string sql, List<DbParameterInfo> parameters)
        {
            if (string.IsNullOrEmpty(BaseUrl))
                throw new InvalidOperationException("BaseUrl is not configured for HttpAgent");

            var request = new
            {
                hubDatabaseId = HubDatabaseId,
                sql = sql,
                parameters = parameters
            };

            var jsonContent = JsonSerializer.Serialize(request, _jsonOptions);
            var content = new StringContent(jsonContent, Encoding.UTF8, "application/json");

            // Set authentication headers
            _httpClient.DefaultRequestHeaders.Clear();
            if (!string.IsNullOrEmpty(ApiKey))
            {
                _httpClient.DefaultRequestHeaders.Add("X-Reportman-ApiKey", ApiKey);
            }
            else if (!string.IsNullOrEmpty(Token))
            {
                _httpClient.DefaultRequestHeaders.Authorization =
                    new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", Token);
            }

            var url = BaseUrl.TrimEnd('/') + "/api/agent/execute";
            var response = _httpClient.PostAsync(url, content).GetAwaiter().GetResult();

            if (!response.IsSuccessStatusCode)
            {
                var error = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                throw new Exception($"HttpAgent error {response.StatusCode}: {error}");
            }

            var json = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
            return DeserializeDataTable(json);
        }

        /// <summary>
        /// Deserializes the Agent's { data: { columns: [...], rows: [...] } } format into a DataTable.
        /// </summary>
        private DataTable DeserializeDataTable(string json)
        {
            using (var doc = JsonDocument.Parse(json))
            {
                // Navigate to "data" if Hub routing wraps the response
                JsonElement root = doc.RootElement;
                if (root.TryGetProperty("data", out var dataProp))
                    root = dataProp;

                // Check for error
                if (root.TryGetProperty("success", out var successProp) && !successProp.GetBoolean())
                {
                    var errorMsg = root.TryGetProperty("error", out var errorProp)
                        ? errorProp.GetString()
                        : "Unknown error";
                    throw new Exception($"HttpAgent execution failed: {errorMsg}");
                }

                if (!root.TryGetProperty("columns", out var colsProp) ||
                    !root.TryGetProperty("rows", out var rowsProp))
                {
                    throw new Exception("Invalid response format: missing columns or rows");
                }

                var dt = new DataTable();

                // Add columns
                foreach (var col in colsProp.EnumerateArray())
                {
                    var name = col.GetProperty("name").GetString() ?? "";
                    var typeName = col.GetProperty("dataType").GetString() ?? "String";
                    var type = MapTypeName(typeName);
                    dt.Columns.Add(name, type);
                }

                // Add rows
                foreach (var row in rowsProp.EnumerateArray())
                {
                    var values = new object[dt.Columns.Count];
                    int i = 0;
                    foreach (var cell in row.EnumerateArray())
                    {
                        if (i < dt.Columns.Count)
                        {
                            values[i] = cell.ValueKind == JsonValueKind.Null
                                ? DBNull.Value
                                : ConvertJsonValue(cell, dt.Columns[i].DataType);
                        }
                        i++;
                    }
                    dt.Rows.Add(values);
                }

                return dt;
            }
        }

        private static Type MapTypeName(string typeName)
        {
            switch (typeName)
            {
                case "Int32": return typeof(int);
                case "Int64": return typeof(long);
                case "Int16": return typeof(short);
                case "Decimal": return typeof(decimal);
                case "Double": return typeof(double);
                case "Single": return typeof(float);
                case "Boolean": return typeof(bool);
                case "DateTime": return typeof(DateTime);
                case "Byte[]": return typeof(byte[]);
                default: return typeof(string);
            }
        }

        private static object ConvertJsonValue(JsonElement element, Type targetType)
        {
            try
            {
                if (targetType == typeof(int)) return element.GetInt32();
                if (targetType == typeof(long)) return element.GetInt64();
                if (targetType == typeof(short)) return element.GetInt16();
                if (targetType == typeof(decimal)) return element.GetDecimal();
                if (targetType == typeof(double)) return element.GetDouble();
                if (targetType == typeof(float)) return element.GetSingle();
                if (targetType == typeof(bool)) return element.GetBoolean();
                if (targetType == typeof(DateTime)) return element.GetDateTime();
                if (targetType == typeof(byte[]))
                {
                    if (element.ValueKind == JsonValueKind.String)
                    {
                        var base64 = element.GetString() ?? string.Empty;
                        return base64.Length == 0 ? Array.Empty<byte>() : Convert.FromBase64String(base64);
                    }
                    return Array.Empty<byte>();
                }
                return element.GetString() ?? "";
            }
            catch
            {
                // Fallback to string representation
                return element.ToString();
            }
        }
    }

    /// <summary>
    /// IDbCommand implementation for HttpAgent that stores SQL and parameters
    /// for later execution by HttpAgentExecutor.
    /// </summary>
    public class HttpAgentCommand : IDbCommand
    {
        private readonly HttpAgentExecutor _executor;
        private readonly HttpAgentParameterCollection _parameters;

        /// <summary>
        /// Initializes a new command bound to the executor that will run it.
        /// </summary>
        /// <param name="executor">The executor used to send this command to the HTTP Agent.</param>
        public HttpAgentCommand(HttpAgentExecutor executor)
        {
            _executor = executor;
            _parameters = new HttpAgentParameterCollection();
        }

        /// <summary>
        /// Gets or sets the SQL text to execute.
        /// </summary>
        public string CommandText { get; set; } = "";

        /// <summary>
        /// Gets or sets the wait time, in seconds, before terminating the command.
        /// </summary>
        public int CommandTimeout { get; set; } = 30;

        /// <summary>
        /// Gets or sets how the <see cref="CommandText"/> is interpreted.
        /// </summary>
        public CommandType CommandType { get; set; } = CommandType.Text;

        /// <summary>
        /// Gets or sets the connection associated with the command. Not used by the HTTP Agent path.
        /// </summary>
        public IDbConnection Connection { get; set; }

        /// <summary>
        /// Gets or sets the transaction associated with the command. Not used by the HTTP Agent path.
        /// </summary>
        public IDbTransaction Transaction { get; set; }

        /// <summary>
        /// Gets or sets how command results are applied to the source row when used by a DataAdapter.
        /// </summary>
        public UpdateRowSource UpdatedRowSource { get; set; }

        /// <summary>
        /// Gets the collection of parameters bound to this command.
        /// </summary>
        public IDataParameterCollection Parameters => _parameters;

        /// <summary>
        /// Creates a new parameter for use with this command.
        /// </summary>
        /// <returns>A new <see cref="HttpAgentParameter"/> instance.</returns>
        public IDbDataParameter CreateParameter()
        {
            return new HttpAgentParameter();
        }

        /// <summary>
        /// Executes the command against the HTTP Agent.
        /// </summary>
        /// <returns>Always zero; the Agent does not report an affected-row count.</returns>
        public int ExecuteNonQuery()
        {
            _executor.Open(this);
            return 0;
        }

        /// <summary>
        /// Executes the command and returns a reader over the resulting rows.
        /// </summary>
        /// <returns>An <see cref="IDataReader"/> over the returned DataTable.</returns>
        public IDataReader ExecuteReader()
        {
            var dt = _executor.Open(this);
            return dt.CreateDataReader();
        }

        /// <summary>
        /// Executes the command and returns a reader over the resulting rows. The behavior is ignored.
        /// </summary>
        /// <param name="behavior">Command behavior flags (not honored by the HTTP Agent path).</param>
        /// <returns>An <see cref="IDataReader"/> over the returned DataTable.</returns>
        public IDataReader ExecuteReader(CommandBehavior behavior)
        {
            return ExecuteReader();
        }

        /// <summary>
        /// Executes the command and returns the value of the first column of the first row.
        /// </summary>
        /// <returns>The first cell of the result, or null when no rows are returned.</returns>
        public object ExecuteScalar()
        {
            var dt = _executor.Open(this);
            if (dt.Rows.Count > 0 && dt.Columns.Count > 0)
                return dt.Rows[0][0];
            return null;
        }

        /// <summary>
        /// Prepares the command. No-op for the HTTP Agent path.
        /// </summary>
        public void Prepare() { }

        /// <summary>
        /// Attempts to cancel execution. No-op for the HTTP Agent path.
        /// </summary>
        public void Cancel() { }

        /// <summary>
        /// Releases resources used by the command. No-op for the HTTP Agent path.
        /// </summary>
        public void Dispose() { }

        /// <summary>
        /// Converts all parameters to DbParameterInfo list for API call.
        /// </summary>
        internal List<DbParameterInfo> GetParameterInfos()
        {
            var list = new List<DbParameterInfo>();
            foreach (IDataParameter p in _parameters)
            {
                list.Add(DbParameterInfo.FromDataParameter(p));
            }
            return list;
        }
    }

    /// <summary>
    /// IDataParameter implementation for HttpAgent.
    /// </summary>
    public class HttpAgentParameter : IDbDataParameter
    {
        /// <summary>
        /// Gets or sets the <see cref="System.Data.DbType"/> of the parameter.
        /// </summary>
        public DbType DbType { get; set; } = DbType.String;

        /// <summary>
        /// Gets or sets whether the parameter is input-only, output-only, bidirectional, or a return value.
        /// </summary>
        public ParameterDirection Direction { get; set; } = ParameterDirection.Input;

        /// <summary>
        /// Gets or sets whether the parameter accepts null values.
        /// </summary>
        public bool IsNullable { get; set; } = true;

        /// <summary>
        /// Gets or sets the name of the parameter.
        /// </summary>
        public string ParameterName { get; set; } = "";

        /// <summary>
        /// Gets or sets the source column mapped to the parameter.
        /// </summary>
        public string SourceColumn { get; set; } = "";

        /// <summary>
        /// Gets or sets the DataRow version to use when loading the parameter value.
        /// </summary>
        public DataRowVersion SourceVersion { get; set; } = DataRowVersion.Current;

        /// <summary>
        /// Gets or sets the value of the parameter.
        /// </summary>
        public object Value { get; set; }

        /// <summary>
        /// Gets or sets the maximum number of digits used to represent the value.
        /// </summary>
        public byte Precision { get; set; }

        /// <summary>
        /// Gets or sets the number of decimal places to which the value is resolved.
        /// </summary>
        public byte Scale { get; set; }

        /// <summary>
        /// Gets or sets the maximum size, in bytes, of the parameter value.
        /// </summary>
        public int Size { get; set; }
    }

    /// <summary>
    /// IDataParameterCollection implementation for HttpAgent.
    /// </summary>
    public class HttpAgentParameterCollection : IDataParameterCollection
    {
        private readonly List<IDataParameter> _parameters = new();

        /// <summary>
        /// Gets or sets the parameter with the specified name.
        /// </summary>
        /// <param name="parameterName">The name of the parameter to access.</param>
        /// <returns>The matching parameter, or null when no parameter has that name.</returns>
        public object this[string parameterName]
        {
            get
            {
                int idx = IndexOf(parameterName);
                return idx >= 0 ? _parameters[idx] : null;
            }
            set
            {
                int idx = IndexOf(parameterName);
                if (idx >= 0)
                    _parameters[idx] = (IDataParameter)value;
            }
        }

        /// <summary>
        /// Gets or sets the parameter at the specified index.
        /// </summary>
        /// <param name="index">The zero-based index of the parameter.</param>
        /// <returns>The parameter at the given index.</returns>
        public object this[int index]
        {
            get => _parameters[index];
            set => _parameters[index] = (IDataParameter)value;
        }

        /// <summary>
        /// Gets a value indicating whether the collection has a fixed size. Always false.
        /// </summary>
        public bool IsFixedSize => false;

        /// <summary>
        /// Gets a value indicating whether the collection is read-only. Always false.
        /// </summary>
        public bool IsReadOnly => false;

        /// <summary>
        /// Gets a value indicating whether access to the collection is synchronized. Always false.
        /// </summary>
        public bool IsSynchronized => false;

        /// <summary>
        /// Gets the number of parameters in the collection.
        /// </summary>
        public int Count => _parameters.Count;

        /// <summary>
        /// Gets an object that can be used to synchronize access to the collection.
        /// </summary>
        public object SyncRoot => this;

        /// <summary>
        /// Adds a parameter to the collection.
        /// </summary>
        /// <param name="value">The parameter to add.</param>
        /// <returns>The zero-based index at which the parameter was added.</returns>
        public int Add(object value)
        {
            _parameters.Add((IDataParameter)value);
            return _parameters.Count - 1;
        }

        /// <summary>
        /// Removes all parameters from the collection.
        /// </summary>
        public void Clear() => _parameters.Clear();

        /// <summary>
        /// Determines whether the collection contains a parameter with the specified name.
        /// </summary>
        /// <param name="parameterName">The parameter name to locate.</param>
        /// <returns>True if a parameter with that name exists; otherwise false.</returns>
        public bool Contains(string parameterName) => IndexOf(parameterName) >= 0;

        /// <summary>
        /// Determines whether the collection contains the specified parameter.
        /// </summary>
        /// <param name="value">The parameter to locate.</param>
        /// <returns>True if the parameter is found; otherwise false.</returns>
        public bool Contains(object value) => _parameters.Contains((IDataParameter)value);

        /// <summary>
        /// Copies the parameters to the specified array, starting at the given index.
        /// </summary>
        /// <param name="array">The destination array.</param>
        /// <param name="index">The zero-based index in the array at which copying begins.</param>
        public void CopyTo(Array array, int index)
        {
            for (int i = 0; i < _parameters.Count; i++)
                array.SetValue(_parameters[i], index + i);
        }

        /// <summary>
        /// Returns an enumerator that iterates over the parameters.
        /// </summary>
        /// <returns>An enumerator for the collection.</returns>
        public IEnumerator GetEnumerator() => _parameters.GetEnumerator();

        /// <summary>
        /// Returns the index of the parameter with the specified name.
        /// </summary>
        /// <param name="parameterName">The parameter name to locate.</param>
        /// <returns>The zero-based index of the parameter, or -1 if not found.</returns>
        public int IndexOf(string parameterName)
        {
            for (int i = 0; i < _parameters.Count; i++)
            {
                if (_parameters[i].ParameterName == parameterName)
                    return i;
            }
            return -1;
        }

        /// <summary>
        /// Returns the index of the specified parameter.
        /// </summary>
        /// <param name="value">The parameter to locate.</param>
        /// <returns>The zero-based index of the parameter, or -1 if not found.</returns>
        public int IndexOf(object value) => _parameters.IndexOf((IDataParameter)value);

        /// <summary>
        /// Inserts a parameter into the collection at the specified index.
        /// </summary>
        /// <param name="index">The zero-based index at which to insert the parameter.</param>
        /// <param name="value">The parameter to insert.</param>
        public void Insert(int index, object value) => _parameters.Insert(index, (IDataParameter)value);

        /// <summary>
        /// Removes the specified parameter from the collection.
        /// </summary>
        /// <param name="value">The parameter to remove.</param>
        public void Remove(object value) => _parameters.Remove((IDataParameter)value);

        /// <summary>
        /// Removes the parameter with the specified name from the collection.
        /// </summary>
        /// <param name="parameterName">The name of the parameter to remove.</param>
        public void RemoveAt(string parameterName)
        {
            int idx = IndexOf(parameterName);
            if (idx >= 0)
                _parameters.RemoveAt(idx);
        }

        /// <summary>
        /// Removes the parameter at the specified index from the collection.
        /// </summary>
        /// <param name="index">The zero-based index of the parameter to remove.</param>
        public void RemoveAt(int index) => _parameters.RemoveAt(index);
    }
}
