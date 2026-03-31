using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;
using Reportman.Reporting;

namespace Reportman.Reporting.Design.Json
{
    public class ReportBatchJsonAdapter : IReportBatchJsonAdapter
    {
        private static readonly JsonSerializerOptions SerializerOptions = CreateSerializerOptions();

        private readonly IReportBatchEditor editor;

        public ReportBatchJsonAdapter()
            : this(new ReportBatchEditor())
        {
        }

        public ReportBatchJsonAdapter(IReportBatchEditor editor)
        {
            this.editor = editor ?? throw new ArgumentNullException(nameof(editor));
        }

        public ReportBatchJsonRequest DeserializeRequest(string json)
        {
            if (string.IsNullOrWhiteSpace(json))
            {
                throw new ArgumentException("JSON payload is required.", nameof(json));
            }

            var request = JsonSerializer.Deserialize<ReportBatchJsonRequest>(json, SerializerOptions);
            if (request == null)
            {
                throw new InvalidOperationException("Unable to deserialize batch request.");
            }

            return request;
        }

        public string SerializeRequest(ReportBatchJsonRequest request)
        {
            if (request == null)
            {
                throw new ArgumentNullException(nameof(request));
            }

            return JsonSerializer.Serialize(request, SerializerOptions);
        }

        public IReadOnlyList<ReportBatchOperation> ToOperations(ReportBatchJsonRequest request)
        {
            if (request == null)
            {
                throw new ArgumentNullException(nameof(request));
            }

            if (request.Version > 1)
            {
                throw new InvalidOperationException("Unsupported batch JSON version: " + request.Version);
            }

            var result = new List<ReportBatchOperation>();
            if (request.Operations == null)
            {
                return result;
            }

            foreach (var operation in request.Operations)
            {
                if (operation == null)
                {
                    result.Add(null);
                    continue;
                }

                var mapped = new ReportBatchOperation
                {
                    OperationId = operation.OperationId,
                    Type = ParseOperationType(operation.Type),
                    TargetName = operation.TargetName,
                    ObjectClass = operation.ObjectClass,
                    ParentName = operation.ParentName,
                    InsertIndex = operation.InsertIndex,
                    NewIndex = operation.NewIndex,
                    Properties = new List<ReportBatchProperty>()
                };

                if (operation.Properties != null)
                {
                    foreach (var property in operation.Properties)
                    {
                        if (property == null)
                        {
                            mapped.Properties.Add(null);
                            continue;
                        }

                        mapped.Properties.Add(new ReportBatchProperty
                        {
                            PropertyName = property.PropertyName,
                            Value = ConvertJsonElement(property.Value)
                        });
                    }
                }

                result.Add(mapped);
            }

            return result;
        }

        public ReportBatchValidationResult Validate(Report report, string json)
        {
            return Validate(report, DeserializeRequest(json));
        }

        public ReportBatchValidationResult Validate(Report report, ReportBatchJsonRequest request)
        {
            return editor.Validate(report, ToOperations(request));
        }

        public ReportBatchApplyResult Apply(Report report, string json)
        {
            return Apply(report, DeserializeRequest(json));
        }

        public ReportBatchApplyResult Apply(Report report, ReportBatchJsonRequest request)
        {
            return editor.Apply(report, ToOperations(request));
        }

        public string SerializeValidationResult(ReportBatchValidationResult result)
        {
            if (result == null)
            {
                throw new ArgumentNullException(nameof(result));
            }

            var response = new ReportBatchJsonValidationResponse();
            CopyIssues(response.Issues, result.Issues);
            return JsonSerializer.Serialize(response, SerializerOptions);
        }

        public string SerializeApplyResult(ReportBatchApplyResult result)
        {
            if (result == null)
            {
                throw new ArgumentNullException(nameof(result));
            }

            var response = new ReportBatchJsonApplyResponse
            {
                UndoGroupId = result.UndoGroupId,
                AppliedOperations = result.AppliedOperations
            };
            CopyIssues(response.Issues, result.Issues);
            return JsonSerializer.Serialize(response, SerializerOptions);
        }

        private static JsonSerializerOptions CreateSerializerOptions()
        {
            return new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
            };
        }

        private static void CopyIssues(List<ReportBatchJsonIssue> destination, IList<ReportBatchIssue> source)
        {
            if (source == null)
            {
                return;
            }

            foreach (var issue in source)
            {
                destination.Add(new ReportBatchJsonIssue
                {
                    Code = issue == null ? null : issue.Code,
                    Message = issue == null ? null : issue.Message,
                    OperationIndex = issue == null ? null : issue.OperationIndex,
                    OperationId = issue == null ? null : issue.OperationId
                });
            }
        }

        private static ReportBatchOperationType ParseOperationType(string type)
        {
            if (string.IsNullOrWhiteSpace(type))
            {
                throw new InvalidOperationException("Operation type is required.");
            }

            if (!Enum.TryParse(type, true, out ReportBatchOperationType parsed))
            {
                throw new InvalidOperationException("Unsupported operation type: " + type);
            }

            return parsed;
        }

        private static object ConvertJsonElement(JsonElement element)
        {
            switch (element.ValueKind)
            {
                case JsonValueKind.Undefined:
                case JsonValueKind.Null:
                    return null;
                case JsonValueKind.False:
                    return false;
                case JsonValueKind.True:
                    return true;
                case JsonValueKind.String:
                    return element.GetString();
                case JsonValueKind.Number:
                    return ConvertNumber(element);
                case JsonValueKind.Array:
                    return ConvertArray(element);
                case JsonValueKind.Object:
                    if (TryConvertVariant(element, out var variant))
                    {
                        return variant;
                    }
                    return ConvertObject(element);
                default:
                    throw new InvalidOperationException("Unsupported JSON value kind: " + element.ValueKind);
            }
        }

        private static object ConvertNumber(JsonElement element)
        {
            if (element.TryGetInt32(out var intValue))
            {
                return intValue;
            }

            if (element.TryGetInt64(out var longValue))
            {
                return longValue;
            }

            if (element.TryGetDecimal(out var decimalValue))
            {
                return decimalValue;
            }

            return element.GetDouble();
        }

        private static object ConvertArray(JsonElement element)
        {
            var list = new List<object>();
            foreach (var item in element.EnumerateArray())
            {
                list.Add(ConvertJsonElement(item));
            }
            return list;
        }

        private static object ConvertObject(JsonElement element)
        {
            var dictionary = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            foreach (var property in element.EnumerateObject())
            {
                dictionary[property.Name] = ConvertJsonElement(property.Value);
            }
            return dictionary;
        }

        private static bool TryConvertVariant(JsonElement element, out Variant variant)
        {
            variant = null;
            if (!TryGetProperty(element, "Type", out var typeElement) || !TryGetProperty(element, "Value", out var valueElement))
            {
                return false;
            }

            var typeName = typeElement.GetString();
            if (string.IsNullOrWhiteSpace(typeName))
            {
                variant = new Variant();
                return true;
            }

            if (!Enum.TryParse(typeName, true, out VariantType variantType))
            {
                return false;
            }

            object value = null;
            if (variantType != VariantType.Null)
            {
                value = ConvertJsonElement(valueElement);
            }

            variant = new Variant();
            variant.AssignFromObject(value);
            return true;
        }

        private static bool TryGetProperty(JsonElement element, string propertyName, out JsonElement propertyValue)
        {
            foreach (var property in element.EnumerateObject())
            {
                if (string.Equals(property.Name, propertyName, StringComparison.OrdinalIgnoreCase))
                {
                    propertyValue = property.Value;
                    return true;
                }
            }

            propertyValue = default(JsonElement);
            return false;
        }
    }
}