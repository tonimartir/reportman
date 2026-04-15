using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Newtonsoft.Json;
using Reportman.Reporting;
using SystemTextJsonSerializer = System.Text.Json.JsonSerializer;

namespace Reportman.Reporting.Design.Json
{
    public class ReportBatchJsonAdapter : IReportBatchJsonAdapter
    {
        private static readonly JsonSerializerOptions SerializerOptions = CreateSerializerOptions();
        private static readonly JsonSerializerSettings ReportSerializerSettings = CreateReportSerializerSettings();

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

            var request = SystemTextJsonSerializer.Deserialize<ReportBatchJsonRequest>(json, SerializerOptions);
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

            var normalizedRequest = new ReportBatchJsonRequest
            {
                Version = request.Version,
                Operations = new List<ReportBatchJsonOperation>()
            };

            if (request.Operations != null)
            {
                foreach (var operation in request.Operations)
                {
                    if (operation == null)
                    {
                        normalizedRequest.Operations.Add(null);
                        continue;
                    }

                    normalizedRequest.Operations.Add(new ReportBatchJsonOperation
                    {
                        OperationId = operation.OperationId,
                        Type = operation.Type,
                        TargetName = operation.TargetName,
                        ObjectClass = operation.ObjectClass,
                        ParentName = operation.ParentName,
                        Index = ResolveExternalIndex(operation),
                        Properties = operation.Properties,
                        ParentSubreportName = operation.ParentSubreportName,
                        SectionName = operation.SectionName,
                        PageHeaderName = operation.PageHeaderName,
                        PageFooterName = operation.PageFooterName,
                        DetailName = operation.DetailName,
                        GroupHeaderSectionName = operation.GroupHeaderSectionName,
                        GroupFooterSectionName = operation.GroupFooterSectionName,
                        GroupName = operation.GroupName,
                        ChangeExpression = operation.ChangeExpression,
                        InsertIndexRelativeToFirstPageHeader = operation.InsertIndexRelativeToFirstPageHeader,
                        InsertIndexRelativeToFirstPageFooter = operation.InsertIndexRelativeToFirstPageFooter,
                        InsertIndexRelativeToFirstDetail = operation.InsertIndexRelativeToFirstDetail,
                        InsertIndexRelativeToFirstGroupHeader = operation.InsertIndexRelativeToFirstGroupHeader,
                        GroupHeaderProperties = operation.GroupHeaderProperties,
                        GroupFooterProperties = operation.GroupFooterProperties,
                    });
                }
            }

            return SystemTextJsonSerializer.Serialize(normalizedRequest, SerializerOptions);
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
                    Properties = new List<ReportBatchProperty>()
                };

                mapped.InsertIndex = mapped.Type == ReportBatchOperationType.AddObject
                    ? (operation.Index ?? operation.InsertIndex)
                    : operation.InsertIndex;
                mapped.NewIndex = mapped.Type == ReportBatchOperationType.ReorderObject
                    ? (operation.Index ?? operation.NewIndex)
                    : operation.NewIndex;

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

        public Report DeserializeReport(string reportJson)
        {
            return DeserializeReport(reportJson, ReportDocumentFormat.Json);
        }

        public Report DeserializeReport(string reportDocument, ReportDocumentFormat format)
        {
            if (string.IsNullOrWhiteSpace(reportDocument))
            {
                throw new ArgumentException("Report document payload is required.", nameof(reportDocument));
            }

            Report report;
            switch (format)
            {
                case ReportDocumentFormat.Json:
                    report = JsonConvert.DeserializeObject<Report>(reportDocument, ReportSerializerSettings);
                    break;
                case ReportDocumentFormat.Xml:
                    report = DeserializeXmlReport(reportDocument);
                    break;
                default:
                    throw new InvalidOperationException("Unsupported report document format: " + format);
            }

            if (report == null)
            {
                throw new InvalidOperationException("Unable to deserialize report document.");
            }

            report.EnsureComponentNames();
            report.UndoCue = report.UndoCue ?? new UndoCue();
            return report;
        }

        public Report DeserializeReportDocument(string reportDocument)
        {
            return DeserializeReport(reportDocument, DetectFormat(reportDocument));
        }

        public string SerializeReport(Report report)
        {
            return SerializeReport(report, ReportDocumentFormat.Json);
        }

        public string SerializeReport(Report report, ReportDocumentFormat format)
        {
            if (report == null)
            {
                throw new ArgumentNullException(nameof(report));
            }

            report.EnsureComponentNames();

            switch (format)
            {
                case ReportDocumentFormat.Json:
                    return JsonConvert.SerializeObject(report, Formatting.Indented, ReportSerializerSettings);
                case ReportDocumentFormat.Xml:
                    return SerializeXmlReport(report);
                default:
                    throw new InvalidOperationException("Unsupported report document format: " + format);
            }
        }

        public ReportBatchValidationResult Validate(Report report, string json)
        {
            return Validate(report, DeserializeRequest(json));
        }

        public ReportBatchValidationResult Validate(Report report, ReportBatchJsonRequest request)
        {
            return editor.Validate(report, ToOperations(request));
        }

        public ReportBatchValidationResult ValidateReportJson(string reportJson, string operationsJson)
        {
            return Validate(DeserializeReport(reportJson), operationsJson);
        }

        public ReportBatchValidationResult ValidateReportDocument(string reportDocument, string operationsJson, ReportDocumentFormat format)
        {
            return Validate(DeserializeReport(reportDocument, format), operationsJson);
        }

        public ReportBatchValidationResult ValidateReportDocument(string reportDocument, string operationsJson)
        {
            return Validate(DeserializeReportDocument(reportDocument), operationsJson);
        }

        public ReportBatchApplyResult Apply(Report report, string json)
        {
            return Apply(report, DeserializeRequest(json));
        }

        public ReportBatchApplyResult Apply(Report report, ReportBatchJsonRequest request)
        {
            return editor.Apply(report, ToOperations(request));
        }

        public ReportBatchJsonDocumentApplyResponse ApplyReportJson(string reportJson, string operationsJson)
        {
            return ApplyReportDocument(reportJson, operationsJson, ReportDocumentFormat.Json);
        }

        public ReportBatchJsonDocumentApplyResponse ApplyReportDocument(string reportDocument, string operationsJson, ReportDocumentFormat format)
        {
            var report = DeserializeReport(reportDocument, format);
            var applyResult = Apply(report, operationsJson);

            var response = new ReportBatchJsonDocumentApplyResponse
            {
                Format = format,
                UndoGroupId = applyResult.UndoGroupId,
                AppliedOperations = applyResult.AppliedOperations,
                ReportDocument = SerializeReport(report, format)
            };

            CopyIssues(response.Issues, applyResult.Issues);
            return response;
        }

        public ReportBatchJsonDocumentApplyResponse ApplyReportDocument(string reportDocument, string operationsJson)
        {
            var format = DetectFormat(reportDocument);
            return ApplyReportDocument(reportDocument, operationsJson, format);
        }

        public string ApplyReportJsonToReportJson(string reportJson, string operationsJson)
        {
            return ApplyReportJson(reportJson, operationsJson).ReportJson;
        }

        public string ApplyReportDocumentToReportDocument(string reportDocument, string operationsJson, ReportDocumentFormat format)
        {
            return ApplyReportDocument(reportDocument, operationsJson, format).ReportDocument;
        }

        public string ApplyReportDocumentToReportDocument(string reportDocument, string operationsJson)
        {
            return ApplyReportDocument(reportDocument, operationsJson).ReportDocument;
        }

        public string SerializeValidationResult(ReportBatchValidationResult result)
        {
            if (result == null)
            {
                throw new ArgumentNullException(nameof(result));
            }

            var response = new ReportBatchJsonValidationResponse();
            CopyIssues(response.Issues, result.Issues);
            return SystemTextJsonSerializer.Serialize(response, SerializerOptions);
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
            return SystemTextJsonSerializer.Serialize(response, SerializerOptions);
        }

        public string SerializeDocumentApplyResult(ReportBatchJsonDocumentApplyResponse result)
        {
            if (result == null)
            {
                throw new ArgumentNullException(nameof(result));
            }

            return SystemTextJsonSerializer.Serialize(result, SerializerOptions);
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

        private static JsonSerializerSettings CreateReportSerializerSettings()
        {
            return new JsonSerializerSettings
            {
                NullValueHandling = NullValueHandling.Ignore,
                MissingMemberHandling = MissingMemberHandling.Ignore,
                ReferenceLoopHandling = ReferenceLoopHandling.Ignore,
            };
        }

        private static Report DeserializeXmlReport(string reportXml)
        {
            var report = new Report();
            using (var stream = new MemoryStream(Encoding.UTF8.GetBytes(reportXml)))
            {
                report.LoadFromStream(stream);
            }
            return report;
        }

        private static string SerializeXmlReport(Report report)
        {
            var originalFormat = report.StreamFormat;
            try
            {
                report.StreamFormat = StreamFormatType.XML;
                using (var stream = new MemoryStream())
                {
                    report.SaveToStream(stream);
                    return Encoding.UTF8.GetString(stream.ToArray());
                }
            }
            finally
            {
                report.StreamFormat = originalFormat;
            }
        }

        private static ReportDocumentFormat DetectFormat(string reportDocument)
        {
            if (string.IsNullOrWhiteSpace(reportDocument))
            {
                throw new ArgumentException("Report document payload is required.", nameof(reportDocument));
            }

            foreach (var character in reportDocument)
            {
                if (char.IsWhiteSpace(character))
                {
                    continue;
                }

                return character == '<' ? ReportDocumentFormat.Xml : ReportDocumentFormat.Json;
            }

            throw new ArgumentException("Report document payload is empty.", nameof(reportDocument));
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

        private static int? ResolveExternalIndex(ReportBatchJsonOperation operation)
        {
            if (operation == null)
            {
                return null;
            }

            if (!string.IsNullOrWhiteSpace(operation.Type) && Enum.TryParse(operation.Type, true, out ReportBatchOperationType parsedType))
            {
                if (parsedType == ReportBatchOperationType.AddObject)
                {
                    return operation.Index ?? operation.InsertIndex;
                }

                if (parsedType == ReportBatchOperationType.ReorderObject)
                {
                    return operation.Index ?? operation.NewIndex;
                }
            }

            return operation.Index;
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