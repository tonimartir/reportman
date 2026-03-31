using System.Collections.Generic;
using System.Text.Json;

namespace Reportman.Reporting.Design.Json
{
    public class ReportBatchJsonRequest
    {
        public int Version { get; set; } = 1;
        public List<ReportBatchJsonOperation> Operations { get; set; } = new List<ReportBatchJsonOperation>();
    }

    public class ReportBatchJsonOperation
    {
        public string OperationId { get; set; }
        public string Type { get; set; }
        public string TargetName { get; set; }
        public string ObjectClass { get; set; }
        public string ParentName { get; set; }
        public int? InsertIndex { get; set; }
        public int? NewIndex { get; set; }
        public List<ReportBatchJsonProperty> Properties { get; set; } = new List<ReportBatchJsonProperty>();
    }

    public class ReportBatchJsonProperty
    {
        public string PropertyName { get; set; }
        public JsonElement Value { get; set; }
    }

    public class ReportBatchJsonIssue
    {
        public string Code { get; set; }
        public string Message { get; set; }
        public int? OperationIndex { get; set; }
        public string OperationId { get; set; }
    }

    public class ReportBatchJsonValidationResponse
    {
        public int Version { get; set; } = 1;
        public List<ReportBatchJsonIssue> Issues { get; set; } = new List<ReportBatchJsonIssue>();

        public bool IsValid
        {
            get { return Issues.Count == 0; }
        }
    }

    public class ReportBatchJsonApplyResponse : ReportBatchJsonValidationResponse
    {
        public int UndoGroupId { get; set; }
        public int AppliedOperations { get; set; }
    }

    public interface IReportBatchJsonAdapter
    {
        ReportBatchJsonRequest DeserializeRequest(string json);
        string SerializeRequest(ReportBatchJsonRequest request);
        IReadOnlyList<ReportBatchOperation> ToOperations(ReportBatchJsonRequest request);
        ReportBatchValidationResult Validate(Report report, string json);
        ReportBatchValidationResult Validate(Report report, ReportBatchJsonRequest request);
        ReportBatchApplyResult Apply(Report report, string json);
        ReportBatchApplyResult Apply(Report report, ReportBatchJsonRequest request);
        string SerializeValidationResult(ReportBatchValidationResult result);
        string SerializeApplyResult(ReportBatchApplyResult result);
    }
}