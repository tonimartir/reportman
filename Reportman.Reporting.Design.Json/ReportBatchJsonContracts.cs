using System.Collections.Generic;
using System.Text.Json;

namespace Reportman.Reporting.Design.Json
{
    /// <summary>
    /// JSON-serializable envelope for a batch of report edit operations, carrying a
    /// schema version and the ordered list of operations to apply.
    /// </summary>
    public class ReportBatchJsonRequest
    {
        /// <summary>
        /// Gets or sets the schema version of the batch request format.
        /// </summary>
        public int Version { get; set; } = 1;
        /// <summary>
        /// Gets or sets the ordered list of edit operations to apply.
        /// </summary>
        public List<ReportBatchJsonOperation> Operations { get; set; } = new List<ReportBatchJsonOperation>();
    }

    /// <summary>
    /// A single JSON-serializable report edit operation (add, modify, move, delete, etc.),
    /// including its target, properties, and the optional high-level semantic V1 fields the
    /// AI designer uses before they are expanded into low-level operations.
    /// </summary>
    public class ReportBatchJsonOperation
    {
        /// <summary>
        /// Gets or sets the caller-assigned identifier used to correlate this operation with
        /// validation issues and results.
        /// </summary>
        public string OperationId { get; set; }
        /// <summary>
        /// Gets or sets the operation kind (for example add, modify, move or delete).
        /// </summary>
        public string Type { get; set; }
        /// <summary>
        /// Gets or sets the name of the report object the operation acts on.
        /// </summary>
        public string TargetName { get; set; }
        /// <summary>
        /// Gets or sets the report object class name used when creating a new item.
        /// </summary>
        public string ObjectClass { get; set; }
        /// <summary>
        /// Gets or sets the name of the parent object that receives a newly created or moved item.
        /// </summary>
        public string ParentName { get; set; }
        /// <summary>
        /// Gets or sets the position of the target within its parent, when addressing an item by index.
        /// </summary>
        public int? Index { get; set; }
        /// <summary>
        /// Gets or sets the position at which a new item is inserted within its parent.
        /// </summary>
        public int? InsertIndex { get; set; }
        /// <summary>
        /// Gets or sets the destination position for a move operation.
        /// </summary>
        public int? NewIndex { get; set; }
        /// <summary>
        /// Gets or sets the property assignments applied to the target object.
        /// </summary>
        public List<ReportBatchJsonProperty> Properties { get; set; } = new List<ReportBatchJsonProperty>();

        // Optional semantic V1 fields used by the AI designer before expansion to low-level operations.
        /// <summary>
        /// Gets or sets the name of the subreport that contains the section addressed by the semantic fields.
        /// </summary>
        public string ParentSubreportName { get; set; }
        /// <summary>
        /// Gets or sets the name of the section the operation targets.
        /// </summary>
        public string SectionName { get; set; }
        /// <summary>
        /// Gets or sets the name of the page header section referenced by the operation.
        /// </summary>
        public string PageHeaderName { get; set; }
        /// <summary>
        /// Gets or sets the name of the page footer section referenced by the operation.
        /// </summary>
        public string PageFooterName { get; set; }
        /// <summary>
        /// Gets or sets the name of the detail section referenced by the operation.
        /// </summary>
        public string DetailName { get; set; }
        /// <summary>
        /// Gets or sets the name of the group header section referenced by the operation.
        /// </summary>
        public string GroupHeaderSectionName { get; set; }
        /// <summary>
        /// Gets or sets the name of the group footer section referenced by the operation.
        /// </summary>
        public string GroupFooterSectionName { get; set; }
        /// <summary>
        /// Gets or sets the name of the group referenced by the operation.
        /// </summary>
        public string GroupName { get; set; }
        /// <summary>
        /// Gets or sets the expression assigned to the target when the operation changes an expression.
        /// </summary>
        public string ChangeExpression { get; set; }
        /// <summary>
        /// Gets or sets the insert position expressed relative to the first page header section.
        /// </summary>
        public int? InsertIndexRelativeToFirstPageHeader { get; set; }
        /// <summary>
        /// Gets or sets the insert position expressed relative to the first page footer section.
        /// </summary>
        public int? InsertIndexRelativeToFirstPageFooter { get; set; }
        /// <summary>
        /// Gets or sets the insert position expressed relative to the first detail section.
        /// </summary>
        public int? InsertIndexRelativeToFirstDetail { get; set; }
        /// <summary>
        /// Gets or sets the insert position expressed relative to the first group header section.
        /// </summary>
        public int? InsertIndexRelativeToFirstGroupHeader { get; set; }
        /// <summary>
        /// Gets or sets the property assignments applied to the group header section created by the operation.
        /// </summary>
        public List<ReportBatchJsonProperty> GroupHeaderProperties { get; set; }
        /// <summary>
        /// Gets or sets the property assignments applied to the group footer section created by the operation.
        /// </summary>
        public List<ReportBatchJsonProperty> GroupFooterProperties { get; set; }
    }

    /// <summary>
    /// A single property assignment within an operation, pairing the property name with its
    /// raw JSON value to be applied to the target report object.
    /// </summary>
    public class ReportBatchJsonProperty
    {
        /// <summary>
        /// Gets or sets the name of the property to assign.
        /// </summary>
        public string PropertyName { get; set; }
        /// <summary>
        /// Gets or sets the raw JSON value to assign to the property.
        /// </summary>
        public JsonElement Value { get; set; }
    }

    /// <summary>
    /// A validation problem reported for a batch request, identifying the offending operation
    /// (by index and id) along with a diagnostic code and human-readable message.
    /// </summary>
    public class ReportBatchJsonIssue
    {
        /// <summary>
        /// Gets or sets the diagnostic code identifying the kind of problem.
        /// </summary>
        public string Code { get; set; }
        /// <summary>
        /// Gets or sets the human-readable description of the problem.
        /// </summary>
        public string Message { get; set; }
        /// <summary>
        /// Gets or sets the zero-based index of the operation that caused the issue, when applicable.
        /// </summary>
        public int? OperationIndex { get; set; }
        /// <summary>
        /// Gets or sets the identifier of the operation that caused the issue, when one was supplied.
        /// </summary>
        public string OperationId { get; set; }
    }

    /// <summary>
    /// Result of validating a batch request, exposing any issues found and an
    /// <see cref="IsValid"/> flag that is true when no issues were reported.
    /// </summary>
    public class ReportBatchJsonValidationResponse
    {
        /// <summary>
        /// Gets or sets the schema version of the response format.
        /// </summary>
        public int Version { get; set; } = 1;
        /// <summary>
        /// Gets or sets the list of validation issues found; empty when the request is valid.
        /// </summary>
        public List<ReportBatchJsonIssue> Issues { get; set; } = new List<ReportBatchJsonIssue>();

        /// <summary>
        /// Gets a value indicating whether the request is valid, that is, no issues were reported.
        /// </summary>
        public bool IsValid
        {
            get { return Issues.Count == 0; }
        }
    }

    /// <summary>
    /// Result of applying a batch request, extending the validation response with the undo
    /// group identifier and the number of operations that were applied.
    /// </summary>
    public class ReportBatchJsonApplyResponse : ReportBatchJsonValidationResponse
    {
        /// <summary>
        /// Gets or sets the identifier of the undo group that bundles the applied operations.
        /// </summary>
        public int UndoGroupId { get; set; }
        /// <summary>
        /// Gets or sets the number of operations that were applied.
        /// </summary>
        public int AppliedOperations { get; set; }
    }

    /// <summary>
    /// Apply result that also returns the resulting report document, serialized in the given
    /// <see cref="Format"/>; <see cref="ReportJson"/> is an alias for the document text.
    /// </summary>
    public class ReportBatchJsonDocumentApplyResponse : ReportBatchJsonApplyResponse
    {
        /// <summary>
        /// Gets or sets the document format used to serialize the resulting report.
        /// </summary>
        public ReportDocumentFormat Format { get; set; }
        /// <summary>
        /// Gets or sets the resulting report document text, serialized in the selected format.
        /// </summary>
        public string ReportDocument { get; set; }
        /// <summary>
        /// Gets or sets the resulting report document text; an alias for
        /// <see cref="ReportDocument"/> kept for backward compatibility.
        /// </summary>
        public string ReportJson
        {
            get { return ReportDocument; }
            set { ReportDocument = value; }
        }
    }

    /// <summary>
    /// Bridges JSON batch contracts and the in-memory report model: implementers deserialize
    /// requests and reports, validate and apply batches of operations, and serialize reports
    /// and result objects back to JSON in the supported document formats.
    /// </summary>
    public interface IReportBatchJsonAdapter
    {
        /// <summary>
        /// Deserializes a batch request from its JSON representation.
        /// </summary>
        ReportBatchJsonRequest DeserializeRequest(string json);
        /// <summary>
        /// Serializes a batch request to its JSON representation.
        /// </summary>
        string SerializeRequest(ReportBatchJsonRequest request);
        /// <summary>
        /// Converts a JSON batch request into the low-level report batch operations.
        /// </summary>
        IReadOnlyList<ReportBatchOperation> ToOperations(ReportBatchJsonRequest request);
        /// <summary>
        /// Deserializes a report from its JSON representation.
        /// </summary>
        Report DeserializeReport(string reportJson);
        /// <summary>
        /// Deserializes a report from the given document text using the specified format.
        /// </summary>
        Report DeserializeReport(string reportDocument, ReportDocumentFormat format);
        /// <summary>
        /// Deserializes a report from a document, auto-detecting its format.
        /// </summary>
        Report DeserializeReportDocument(string reportDocument);
        /// <summary>
        /// Serializes a report to its JSON representation.
        /// </summary>
        string SerializeReport(Report report);
        /// <summary>
        /// Serializes a report to a document using the specified format.
        /// </summary>
        string SerializeReport(Report report, ReportDocumentFormat format);
        /// <summary>
        /// Validates a JSON batch request against the given report without applying it.
        /// </summary>
        ReportBatchValidationResult Validate(Report report, string json);
        /// <summary>
        /// Validates a batch request against the given report without applying it.
        /// </summary>
        ReportBatchValidationResult Validate(Report report, ReportBatchJsonRequest request);
        /// <summary>
        /// Validates a batch of operations against a report supplied as JSON.
        /// </summary>
        ReportBatchValidationResult ValidateReportJson(string reportJson, string operationsJson);
        /// <summary>
        /// Validates a batch of operations against a report document in the specified format.
        /// </summary>
        ReportBatchValidationResult ValidateReportDocument(string reportDocument, string operationsJson, ReportDocumentFormat format);
        /// <summary>
        /// Validates a batch of operations against a report document, auto-detecting its format.
        /// </summary>
        ReportBatchValidationResult ValidateReportDocument(string reportDocument, string operationsJson);
        /// <summary>
        /// Applies a JSON batch request to the given report.
        /// </summary>
        ReportBatchApplyResult Apply(Report report, string json);
        /// <summary>
        /// Applies a batch request to the given report.
        /// </summary>
        ReportBatchApplyResult Apply(Report report, ReportBatchJsonRequest request);
        /// <summary>
        /// Applies a batch of operations to a report supplied as JSON and returns the resulting document.
        /// </summary>
        ReportBatchJsonDocumentApplyResponse ApplyReportJson(string reportJson, string operationsJson);
        /// <summary>
        /// Applies a batch of operations to a report document in the specified format and returns the result.
        /// </summary>
        ReportBatchJsonDocumentApplyResponse ApplyReportDocument(string reportDocument, string operationsJson, ReportDocumentFormat format);
        /// <summary>
        /// Applies a batch of operations to a report document, auto-detecting its format, and returns the result.
        /// </summary>
        ReportBatchJsonDocumentApplyResponse ApplyReportDocument(string reportDocument, string operationsJson);
        /// <summary>
        /// Applies a batch of operations to a JSON report and returns the updated report as JSON.
        /// </summary>
        string ApplyReportJsonToReportJson(string reportJson, string operationsJson);
        /// <summary>
        /// Applies a batch of operations to a report document and returns the updated document in the same format.
        /// </summary>
        string ApplyReportDocumentToReportDocument(string reportDocument, string operationsJson, ReportDocumentFormat format);
        /// <summary>
        /// Applies a batch of operations to a report document, auto-detecting its format, and returns the updated document.
        /// </summary>
        string ApplyReportDocumentToReportDocument(string reportDocument, string operationsJson);
        /// <summary>
        /// Serializes a validation result to its JSON representation.
        /// </summary>
        string SerializeValidationResult(ReportBatchValidationResult result);
        /// <summary>
        /// Serializes an apply result to its JSON representation.
        /// </summary>
        string SerializeApplyResult(ReportBatchApplyResult result);
        /// <summary>
        /// Serializes a document apply response to its JSON representation.
        /// </summary>
        string SerializeDocumentApplyResult(ReportBatchJsonDocumentApplyResponse result);
    }
}
