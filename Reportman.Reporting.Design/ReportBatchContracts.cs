using System.Collections.Generic;
using Reportman.Reporting;

namespace Reportman.Reporting.Design
{
    /// <summary>
    /// Identifies the kind of editing action a <see cref="ReportBatchOperation"/> performs,
    /// such as creating a report, adding or removing objects, modifying properties, or reordering.
    /// </summary>
    public enum ReportBatchOperationType
    {
        CreateNewReport,
        AddObject,
        RemoveObject,
        ModifyProperties,
        ReorderObject,
        SendToBackItem,
        BringToFrontItem
    }

    /// <summary>
    /// A single property name/value pair to assign to a target report object as part of a batch operation.
    /// </summary>
    public class ReportBatchProperty
    {
        public string PropertyName { get; set; }
        public object Value { get; set; }
    }

    /// <summary>
    /// Describes one editing action within a batch, including its type, the target and parent objects,
    /// optional positioning indices, and the set of properties to apply.
    /// </summary>
    public class ReportBatchOperation
    {
        public string OperationId { get; set; }
        public ReportBatchOperationType Type { get; set; }
        public string TargetName { get; set; }
        public string ObjectClass { get; set; }
        public string ParentName { get; set; }
        public int? InsertIndex { get; set; }
        public int? NewIndex { get; set; }
        public List<ReportBatchProperty> Properties { get; set; } = new List<ReportBatchProperty>();
    }

    /// <summary>
    /// A validation or application problem reported for a batch, carrying a diagnostic code, a message,
    /// and a reference to the offending operation by index or id.
    /// </summary>
    public class ReportBatchIssue
    {
        public string Code { get; set; }
        public string Message { get; set; }
        public int? OperationIndex { get; set; }
        public string OperationId { get; set; }
    }

    /// <summary>
    /// Outcome of validating a batch of operations, exposing the collected issues and whether the batch is valid.
    /// </summary>
    public class ReportBatchValidationResult
    {
        public List<ReportBatchIssue> Issues { get; } = new List<ReportBatchIssue>();

        public bool IsValid
        {
            get { return Issues.Count == 0; }
        }
    }

    /// <summary>
    /// Result of applying a batch of operations to a report, including the modified report, the undo group id,
    /// the count of applied operations, the inverse undo operations, and any issues encountered.
    /// </summary>
    public class ReportBatchApplyResult
    {
        public Report Report { get; set; }
        public int UndoGroupId { get; set; }
        public int AppliedOperations { get; set; }
        public List<ChangeObjectOperation> UndoOperations { get; } = new List<ChangeObjectOperation>();
        public List<ReportBatchIssue> Issues { get; } = new List<ReportBatchIssue>();
    }

    /// <summary>
    /// Implemented by services that check whether a sequence of batch operations can be applied to a report,
    /// returning the validation result without modifying the report.
    /// </summary>
    public interface IReportBatchValidator
    {
        ReportBatchValidationResult Validate(Report report, IReadOnlyList<ReportBatchOperation> operations);
    }

    /// <summary>
    /// Implemented by services that both validate and apply batches of operations to a report,
    /// producing the resulting changes together with any undo information.
    /// </summary>
    public interface IReportBatchEditor
    {
        ReportBatchValidationResult Validate(Report report, IReadOnlyList<ReportBatchOperation> operations);
        ReportBatchApplyResult Apply(Report report, IReadOnlyList<ReportBatchOperation> operations);
    }
}