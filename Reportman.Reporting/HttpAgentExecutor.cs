using System;
using System.Collections;
using System.Collections.Generic;
using System.Data;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using Reportman.Drawing;

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

        public HttpAgentCommand(HttpAgentExecutor executor)
        {
            _executor = executor;
            _parameters = new HttpAgentParameterCollection();
        }

        public string CommandText { get; set; } = "";
        public int CommandTimeout { get; set; } = 30;
        public CommandType CommandType { get; set; } = CommandType.Text;
        public IDbConnection Connection { get; set; }
        public IDbTransaction Transaction { get; set; }
        public UpdateRowSource UpdatedRowSource { get; set; }

        public IDataParameterCollection Parameters => _parameters;

        public IDbDataParameter CreateParameter()
        {
            return new HttpAgentParameter();
        }

        public int ExecuteNonQuery()
        {
            _executor.Open(this);
            return 0;
        }

        public IDataReader ExecuteReader()
        {
            var dt = _executor.Open(this);
            return dt.CreateDataReader();
        }

        public IDataReader ExecuteReader(CommandBehavior behavior)
        {
            return ExecuteReader();
        }

        public object ExecuteScalar()
        {
            var dt = _executor.Open(this);
            if (dt.Rows.Count > 0 && dt.Columns.Count > 0)
                return dt.Rows[0][0];
            return null;
        }

        public void Prepare() { }
        public void Cancel() { }

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
        public DbType DbType { get; set; } = DbType.String;
        public ParameterDirection Direction { get; set; } = ParameterDirection.Input;
        public bool IsNullable { get; set; } = true;
        public string ParameterName { get; set; } = "";
        public string SourceColumn { get; set; } = "";
        public DataRowVersion SourceVersion { get; set; } = DataRowVersion.Current;
        public object Value { get; set; }
        public byte Precision { get; set; }
        public byte Scale { get; set; }
        public int Size { get; set; }
    }

    /// <summary>
    /// IDataParameterCollection implementation for HttpAgent.
    /// </summary>
    public class HttpAgentParameterCollection : IDataParameterCollection
    {
        private readonly List<IDataParameter> _parameters = new List<IDataParameter>();

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

        public object this[int index]
        {
            get => _parameters[index];
            set => _parameters[index] = (IDataParameter)value;
        }

        public bool IsFixedSize => false;
        public bool IsReadOnly => false;
        public bool IsSynchronized => false;
        public int Count => _parameters.Count;
        public object SyncRoot => this;

        public int Add(object value)
        {
            _parameters.Add((IDataParameter)value);
            return _parameters.Count - 1;
        }

        public void Clear() => _parameters.Clear();

        public bool Contains(string parameterName) => IndexOf(parameterName) >= 0;

        public bool Contains(object value) => _parameters.Contains((IDataParameter)value);

        public void CopyTo(Array array, int index)
        {
            for (int i = 0; i < _parameters.Count; i++)
                array.SetValue(_parameters[i], index + i);
        }

        public IEnumerator GetEnumerator() => _parameters.GetEnumerator();

        public int IndexOf(string parameterName)
        {
            for (int i = 0; i < _parameters.Count; i++)
            {
                if (_parameters[i].ParameterName == parameterName)
                    return i;
            }
            return -1;
        }

        public int IndexOf(object value) => _parameters.IndexOf((IDataParameter)value);

        public void Insert(int index, object value) => _parameters.Insert(index, (IDataParameter)value);

        public void Remove(object value) => _parameters.Remove((IDataParameter)value);

        public void RemoveAt(string parameterName)
        {
            int idx = IndexOf(parameterName);
            if (idx >= 0)
                _parameters.RemoveAt(idx);
        }

        public void RemoveAt(int index) => _parameters.RemoveAt(index);
    }
}
