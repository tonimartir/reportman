using System.Collections.Generic;

namespace Reportman.Reporting.Design
{
    /// <summary>
    /// Identifies the kind of editing action a <see cref="ReportBatchOperation"/> performs,
    /// such as creating a report, adding or removing objects, modifying properties, or reordering.
    /// </summary>
    public enum ReportBatchOperationType
    {
        /// <summary>Creates a new, empty report as the target of the batch.</summary>
        CreateNewReport,
        /// <summary>Adds a new object of the specified class to a parent container.</summary>
        AddObject,
        /// <summary>Removes an existing object from the report.</summary>
        RemoveObject,
        /// <summary>Assigns one or more property values to an existing object.</summary>
        ModifyProperties,
        /// <summary>Moves an object to a different position within its parent.</summary>
        ReorderObject,
        /// <summary>Moves an item to the back of the drawing order within its parent.</summary>
        SendToBackItem,
        /// <summary>Moves an item to the front of the drawing order within its parent.</summary>
        BringToFrontItem
    }

    /// <summary>
    /// A single property name/value pair to assign to a target report object as part of a batch operation.
    /// </summary>
    public class ReportBatchProperty
    {
        /// <summary>Gets or sets the name of the target object's property to assign.</summary>
        public string PropertyName { get; set; }
        /// <summary>Gets or sets the value to assign to the named property.</summary>
        public object Value { get; set; }
    }

    /// <summary>
    /// Describes one editing action within a batch, including its type, the target and parent objects,
    /// optional positioning indices, and the set of properties to apply.
    /// </summary>
    public class ReportBatchOperation
    {
        /// <summary>Gets or sets a caller-supplied identifier used to correlate this operation with issues and results.</summary>
        public string OperationId { get; set; }
        /// <summary>Gets or sets the kind of editing action this operation performs.</summary>
        public ReportBatchOperationType Type { get; set; }
        /// <summary>Gets or sets the name of the object the operation acts upon.</summary>
        public string TargetName { get; set; }
        /// <summary>Gets or sets the class name of the object to create, used by add operations.</summary>
        public string ObjectClass { get; set; }
        /// <summary>Gets or sets the name of the parent container the target object belongs to.</summary>
        public string ParentName { get; set; }
        /// <summary>Gets or sets the position at which a newly added object is inserted, or null to append.</summary>
        public int? InsertIndex { get; set; }
        /// <summary>Gets or sets the target position for a reorder operation, or null when not applicable.</summary>
        public int? NewIndex { get; set; }
        /// <summary>Gets or sets the property assignments to apply to the target object.</summary>
        public List<ReportBatchProperty> Properties { get; set; } = new List<ReportBatchProperty>();
    }

    /// <summary>
    /// A validation or application problem reported for a batch, carrying a diagnostic code, a message,
    /// and a reference to the offending operation by index or id.
    /// </summary>
    public class ReportBatchIssue
    {
        /// <summary>Gets or sets the diagnostic code that classifies the issue.</summary>
        public string Code { get; set; }
        /// <summary>Gets or sets the human-readable description of the issue.</summary>
        public string Message { get; set; }
        /// <summary>Gets or sets the zero-based index of the operation that caused the issue, or null if not tied to one.</summary>
        public int? OperationIndex { get; set; }
        /// <summary>Gets or sets the identifier of the operation that caused the issue, or null if not tied to one.</summary>
        public string OperationId { get; set; }
    }

    /// <summary>
    /// Outcome of validating a batch of operations, exposing the collected issues and whether the batch is valid.
    /// </summary>
    public class ReportBatchValidationResult
    {
        /// <summary>Gets the collection of issues found while validating the batch.</summary>
        public List<ReportBatchIssue> Issues { get; } = new List<ReportBatchIssue>();

        /// <summary>Gets a value indicating whether the batch is valid, that is, no issues were reported.</summary>
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
        /// <summary>Gets or sets the report the batch was applied to.</summary>
        public Report Report { get; set; }
        /// <summary>Gets or sets the identifier of the undo group that bundles the applied changes.</summary>
        public int UndoGroupId { get; set; }
        /// <summary>Gets or sets the number of operations that were successfully applied.</summary>
        public int AppliedOperations { get; set; }
        /// <summary>Gets the inverse operations that can be used to undo the applied changes.</summary>
        public List<ChangeObjectOperation> UndoOperations { get; } = new List<ChangeObjectOperation>();
        /// <summary>Gets any issues encountered while applying the batch.</summary>
        public List<ReportBatchIssue> Issues { get; } = new List<ReportBatchIssue>();
    }

    /// <summary>
    /// Implemented by services that check whether a sequence of batch operations can be applied to a report,
    /// returning the validation result without modifying the report.
    /// </summary>
    public interface IReportBatchValidator
    {
        /// <summary>
        /// Validates the given operations against the report without modifying it.
        /// </summary>
        /// <param name="report">The report the operations would be applied to.</param>
        /// <param name="operations">The batch of operations to validate.</param>
        /// <returns>The validation result describing any issues and whether the batch is valid.</returns>
        ReportBatchValidationResult Validate(Report report, IReadOnlyList<ReportBatchOperation> operations);
    }

    /// <summary>
    /// Implemented by services that both validate and apply batches of operations to a report,
    /// producing the resulting changes together with any undo information.
    /// </summary>
    public interface IReportBatchEditor
    {
        /// <summary>
        /// Validates the given operations against the report without modifying it.
        /// </summary>
        /// <param name="report">The report the operations would be applied to.</param>
        /// <param name="operations">The batch of operations to validate.</param>
        /// <returns>The validation result describing any issues and whether the batch is valid.</returns>
        ReportBatchValidationResult Validate(Report report, IReadOnlyList<ReportBatchOperation> operations);
        /// <summary>
        /// Applies the given operations to the report and returns the outcome.
        /// </summary>
        /// <param name="report">The report to modify.</param>
        /// <param name="operations">The batch of operations to apply.</param>
        /// <returns>The apply result, including the modified report, undo information, and any issues.</returns>
        ReportBatchApplyResult Apply(Report report, IReadOnlyList<ReportBatchOperation> operations);
    }
}
