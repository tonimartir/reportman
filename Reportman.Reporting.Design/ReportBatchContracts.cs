using System.Collections.Generic;
using Reportman.Reporting;

namespace Reportman.Reporting.Design
{
    public enum ReportBatchOperationType
    {
        CreateNewReport,
        AddObject,
        RemoveObject,
        ModifyProperties,
        ReorderObject
    }

    public class ReportBatchProperty
    {
        public string PropertyName { get; set; }
        public object Value { get; set; }
    }

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

    public class ReportBatchIssue
    {
        public string Code { get; set; }
        public string Message { get; set; }
        public int? OperationIndex { get; set; }
        public string OperationId { get; set; }
    }

    public class ReportBatchValidationResult
    {
        public List<ReportBatchIssue> Issues { get; } = new List<ReportBatchIssue>();

        public bool IsValid
        {
            get { return Issues.Count == 0; }
        }
    }

    public class ReportBatchApplyResult
    {
        public Report Report { get; set; }
        public int UndoGroupId { get; set; }
        public int AppliedOperations { get; set; }
        public List<ChangeObjectOperation> UndoOperations { get; } = new List<ChangeObjectOperation>();
        public List<ReportBatchIssue> Issues { get; } = new List<ReportBatchIssue>();
    }

    public interface IReportBatchValidator
    {
        ReportBatchValidationResult Validate(Report report, IReadOnlyList<ReportBatchOperation> operations);
    }

    public interface IReportBatchEditor
    {
        ReportBatchValidationResult Validate(Report report, IReadOnlyList<ReportBatchOperation> operations);
        ReportBatchApplyResult Apply(Report report, IReadOnlyList<ReportBatchOperation> operations);
    }
}