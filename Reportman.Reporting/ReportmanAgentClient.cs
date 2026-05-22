using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Reportman.Reporting
{
    public class ReportmanAgentClient
    {
    #if DEBUG
        public const string DefaultBaseUrl = "https://api.reportman.es:7006";
    #else
        public const string DefaultBaseUrl = "https://api.reportman.es:44568";
    #endif

        private static readonly HttpClient _httpClient;
        private readonly JsonSerializerOptions _jsonOptions;

        static ReportmanAgentClient()
        {
#if DEBUG
            var handler = new HttpClientHandler();
            handler.ServerCertificateCustomValidationCallback = (message, cert, chain, errors) => true;
            _httpClient = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
#else
            _httpClient = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
#endif
        }

        public ReportmanAgentClient()
        {
            _jsonOptions = new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase
            };
        }

        public string BaseUrl { get; set; } = DefaultBaseUrl;
        public string ApiKey { get; set; }
        public string Token { get; set; }
        public string InstallId { get; set; }
        public long HubDatabaseId { get; set; }
        public long HubSchemaId { get; set; }
        public string RuntimeDb { get; set; }
        public string AITier { get; set; } = "Standard";
        public string AgentSecret { get; set; }
        public long AgentAiId { get; set; }

        public event Action<string> LogMessage;

        public delegate void ProgressEventHandler(object sender, string actor, string stage, string chunkType, string chunk, int inputTokens, int outputTokens, string progressId, int prefillPercent);
        public delegate void ResultEventHandler(object sender, JsonDocument resultJson, string errorMessage);

        private void Log(string message)
        {
            Debug.WriteLine("ReportmanAgentClient: " + message);
            LogMessage?.Invoke(message);
        }

        private HttpRequestMessage CreateRequest(string endpoint, object body)
        {
            var url = BaseUrl.TrimEnd('/') + "/" + endpoint.TrimStart('/');
            var request = new HttpRequestMessage(HttpMethod.Post, url);
            
            var jsonContent = JsonSerializer.Serialize(body, _jsonOptions);
            request.Content = new StringContent(jsonContent, Encoding.UTF8, "application/json");
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));

            if (!string.IsNullOrEmpty(ApiKey))
                request.Headers.Add("X-Reportman-ApiKey", ApiKey);

            if (!string.IsNullOrEmpty(Token))
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);

            if (!string.IsNullOrEmpty(InstallId))
                request.Headers.Add("X-Reportman-WebInstallId", InstallId);

            Log("HTTP Request: POST " + url);

            return request;
        }

        private static bool TryGetJsonProperty(JsonElement element, string propertyName, out JsonElement value)
        {
            if (element.ValueKind == JsonValueKind.Object && element.TryGetProperty(propertyName, out value))
                return true;

            if (element.ValueKind == JsonValueKind.Object)
            {
                foreach (var property in element.EnumerateObject())
                {
                    if (string.Equals(property.Name, propertyName, StringComparison.OrdinalIgnoreCase))
                    {
                        value = property.Value;
                        return true;
                    }
                }
            }

            value = default(JsonElement);
            return false;
        }

        private static string JsonValueToString(JsonElement value)
        {
            switch (value.ValueKind)
            {
                case JsonValueKind.String:
                    return value.GetString() ?? "";
                case JsonValueKind.Number:
                    return value.GetRawText();
                case JsonValueKind.True:
                    return "true";
                case JsonValueKind.False:
                    return "false";
                case JsonValueKind.Null:
                case JsonValueKind.Undefined:
                    return "";
                default:
                    return value.GetRawText();
            }
        }

        private static string GetJsonString(JsonElement element, string propertyName)
        {
            return TryGetJsonProperty(element, propertyName, out var value) ? JsonValueToString(value) : "";
        }

        private static int GetJsonInt(JsonElement element, string propertyName)
        {
            if (!TryGetJsonProperty(element, propertyName, out var value) ||
                value.ValueKind == JsonValueKind.Null || value.ValueKind == JsonValueKind.Undefined)
                return 0;

            try
            {
                if (value.ValueKind == JsonValueKind.Number)
                {
                    if (value.TryGetInt32(out var intValue))
                        return intValue;
                    if (value.TryGetInt64(out var longValue))
                    {
                        if (longValue > int.MaxValue) return int.MaxValue;
                        if (longValue < int.MinValue) return int.MinValue;
                        return (int)longValue;
                    }

                    return (int)Math.Round(value.GetDouble());
                }

                if (int.TryParse(JsonValueToString(value), out var parsed))
                    return parsed;
            }
            catch
            {
                return 0;
            }

            return 0;
        }

        private static int GetPrefillPercent(JsonElement element)
        {
            if (!TryGetJsonProperty(element, "prefillPercentage", out var value) ||
                value.ValueKind == JsonValueKind.Null || value.ValueKind == JsonValueKind.Undefined)
                return 0;

            int percent = 0;
            try
            {
                if (value.ValueKind == JsonValueKind.Number)
                    percent = (int)Math.Round(value.GetDouble() * 100.0);
                else
                    int.TryParse(JsonValueToString(value), out percent);
            }
            catch
            {
                percent = 0;
            }

            if (percent < 0) return 0;
            if (percent > 100) return 100;
            return percent;
        }

        private async Task<JsonDocument> StreamJsonRequestAsync(string endpoint, object requestBody, object sender,
            ProgressEventHandler onProgress, CancellationToken cancellationToken)
        {
            var request = CreateRequest(endpoint, requestBody);
            var startedAt = Stopwatch.StartNew();
            var chunkedAIResponseIds = new HashSet<string>(StringComparer.Ordinal);
            
            using (var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false))
            {
                Log("HTTP Response Status: " + (int)response.StatusCode + " (" + startedAt.ElapsedMilliseconds + " ms)");
                if (!response.IsSuccessStatusCode)
                {
                    var errorBody = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                    var message = "HTTP Error " + (int)response.StatusCode + ": " + response.ReasonPhrase;
                    if (!string.IsNullOrWhiteSpace(errorBody))
                        message += " - " + errorBody;
                    throw new HttpRequestException(message);
                }

                using (var stream = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
                using (var reader = new StreamReader(stream, Encoding.UTF8))
                {
                    JsonDocument finalResult = null;
                    
                    while (!cancellationToken.IsCancellationRequested)
                    {
                        var line = await reader.ReadLineAsync().ConfigureAwait(false);
                        if (line == null)
                            break;

                        if (string.IsNullOrWhiteSpace(line)) continue;
                        
                        if (line.StartsWith("data: "))
                        {
                            var data = line.Substring(6).Trim();
                            if (data == "[DONE]")
                                break;
                                
                            try
                            {
                                var jsonDoc = JsonDocument.Parse(data);
                                try
                                {
                                    var root = jsonDoc.RootElement;

                                    if (TryGetJsonProperty(root, "actor", out _) && TryGetJsonProperty(root, "stage", out _))
                                    {
                                        string actor = GetJsonString(root, "actor");
                                        string stage = GetJsonString(root, "stage");
                                        string chunkType = GetJsonString(root, "chunkType");
                                        string id = GetJsonString(root, "id");
                                        string chunk = GetJsonString(root, "chunk");
                                        int inputTokens = GetJsonInt(root, "inputTokens");
                                        int outputTokens = GetJsonInt(root, "outputTokens");
                                        int prefillPercent = GetPrefillPercent(root);

                                        if (ShouldSkipRedundantAIResponse(actor, stage, chunkType, id, chunkedAIResponseIds))
                                            continue;

                                        onProgress?.Invoke(sender, actor, stage, chunkType, chunk, inputTokens, outputTokens, id, prefillPercent);
                                    }
                                    else if (TryGetJsonProperty(root, "result", out _) || TryGetJsonProperty(root, "errorMessage", out _))
                                    {
                                        if (finalResult != null)
                                            finalResult.Dispose();
                                        finalResult = jsonDoc;
                                        jsonDoc = null;
                                    }
                                }
                                finally
                                {
                                    if (jsonDoc != null)
                                        jsonDoc.Dispose();
                                }
                            }
                            catch (Exception ex)
                            {
                                Console.WriteLine("SSE JSON Parse error: " + ex.Message);
                            }
                        }
                    }

                    cancellationToken.ThrowIfCancellationRequested();
                    
                    return finalResult;
                }
            }
        }

        private static bool ShouldSkipRedundantAIResponse(string actor, string stage, string chunkType,
            string progressId, HashSet<string> chunkedAIResponseIds)
        {
            if (!string.Equals(actor, "AI", StringComparison.OrdinalIgnoreCase) ||
                !string.Equals(stage, "ReceivingResponse", StringComparison.OrdinalIgnoreCase) ||
                string.IsNullOrEmpty(progressId))
                return false;

            if (string.Equals(chunkType, "Start", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(chunkType, "Partial", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(chunkType, "End", StringComparison.OrdinalIgnoreCase))
            {
                chunkedAIResponseIds.Add(progressId);
                return false;
            }

            return string.Equals(chunkType, "Full", StringComparison.OrdinalIgnoreCase) &&
                chunkedAIResponseIds.Contains(progressId);
        }

        private object BuildBaseRequest(object customFields = null)
        {
            var dict = new Dictionary<string, object>
            {
                { "aiTier", AITier },
                { "config", new { hubDatabaseId = HubDatabaseId, hubSchemaId = HubSchemaId } }
            };

            if (!string.IsNullOrEmpty(AgentSecret)) dict["agentSecret"] = AgentSecret;
            if (AgentAiId != 0) dict["agentAiId"] = AgentAiId;
            if (!string.IsNullOrEmpty(ApiKey)) dict["apiKey"] = ApiKey;
            if (!string.IsNullOrEmpty(RuntimeDb)) dict["runtime"] = RuntimeDb;

            if (customFields != null)
            {
                foreach (var prop in customFields.GetType().GetProperties())
                {
                    dict[prop.Name] = prop.GetValue(customFields);
                }
            }
            return dict;
        }

        public async Task<JsonDocument> SuggestSqlAsync(string sql, int cursorPosition, string mode, object sender,
            ProgressEventHandler onProgress, CancellationToken cancellationToken)
        {
            var requestBody = BuildBaseRequest(new
            {
                sql = sql,
                cursorPosition = cursorPosition,
                mode = mode
            });

            return await StreamJsonRequestAsync("NlToSql/SuggestSqlCodeStream", requestBody, sender, onProgress, cancellationToken).ConfigureAwait(false);
        }

        public async Task<JsonDocument> TranslateToSqlAsync(string userPrompt, string sqlToRefine, string mode, string userLanguage, 
            object sender, ProgressEventHandler onProgress, CancellationToken cancellationToken)
        {
            var requestBody = BuildBaseRequest(new
            {
                userQuery = new[] { userPrompt },
                sqlToRefine = sqlToRefine,
                mode = mode,
                complex = false,
                transcribeLanguage = string.IsNullOrWhiteSpace(userLanguage) ? "Auto" : userLanguage
            });

            return await StreamJsonRequestAsync("NlToSql/TranslateToSQLStream", requestBody, sender, onProgress, cancellationToken).ConfigureAwait(false);
        }

        public async Task<JsonDocument> ModifyReportAsync(string userPrompt, string reportDocument, string mode, string userLanguage,
            string existingContextJson, object sender, ProgressEventHandler onProgress, CancellationToken cancellationToken)
        {
            var requestBody = BuildBaseRequest(new
            {
                mode = mode,
                simplifiedPrompt = false,
                reportDocument = reportDocument,
                reportFormat = "Xml",
                userInstructions = new[] { userPrompt },
                userLanguage = userLanguage,
                existingOperationsJson = "",
                existingContextJson = existingContextJson ?? "",
                returnModifiedDocument = true
            });

            return await StreamJsonRequestAsync("ReportDesigner/ModifyReportStream", requestBody, sender, onProgress, cancellationToken).ConfigureAwait(false);
        }

        public async Task<JsonDocument> SuggestExpressionAsync(string userPrompt, string currentExpression, bool fix,
            int cursorPosition, string mode, string semanticContextJson, object sender,
            ProgressEventHandler onProgress, CancellationToken cancellationToken)
        {
            var requestBody = BuildBaseRequest(new
            {
                userQuery = new[] { userPrompt },
                currentExpression = currentExpression ?? "",
                fix = fix,
                cursorPosition = cursorPosition,
                mode = mode,
                semanticContextJson = semanticContextJson ?? "",
                simplifiedPrompt = false
            });

            return await StreamJsonRequestAsync("ReportmanExpression/SuggestExpressionStream", requestBody, sender, onProgress, cancellationToken).ConfigureAwait(false);
        }

        // Additional endpoints (ExplainSql, ModifyReport, etc.) can be similarly implemented...
    }
}
