using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using Reportman.Drawing;
using Reportman.Reporting;

namespace Reportman.Reporting.Design
{
    public class ReportBatchEditor : IReportBatchEditor, IReportBatchValidator
    {
        private const int DefaultSectionWidth = 10770;
        private const int DefaultSectionHeight = 1113;
        private const int ConstructorSectionWidth = 10700;
        private const int ConstructorSectionHeight = 1500;

        private static readonly HashSet<string> TopLevelClasses = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "TRPSUBREPORT",
            "TRPPARAM",
            "TRPDATAINFOITEM",
            "TRPDATABASEINFOITEM"
        };

        private static readonly HashSet<string> SectionChildClasses = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "TRPLABEL",
            "TRPEXPRESSION",
            "TRPSHAPE",
            "TRPIMAGE",
            "TRPBARCODE",
            "TRPCHART"
        };

        public ReportBatchValidationResult Validate(Report report, IReadOnlyList<ReportBatchOperation> operations)
        {
            var result = new ReportBatchValidationResult();

            if (report == null)
            {
                result.Issues.Add(new ReportBatchIssue
                {
                    Code = "null_report",
                    Message = "Report instance is required."
                });
                return result;
            }

            if (operations == null || operations.Count == 0)
            {
                result.Issues.Add(new ReportBatchIssue
                {
                    Code = "empty_operations",
                    Message = "At least one batch operation is required."
                });
                return result;
            }

            report.EnsureComponentNames();

            Report workingReport;
            try
            {
                workingReport = CloneReport(report);
            }
            catch (Exception ex)
            {
                result.Issues.Add(new ReportBatchIssue
                {
                    Code = "clone_failed",
                    Message = "Unable to create validation clone: " + ex.Message
                });
                return result;
            }

            workingReport.UndoCue = new UndoCue();
            workingReport.Modified = report.Modified;

            bool createNewReportSeen = false;
            for (int index = 0; index < operations.Count; index++)
            {
                var operation = operations[index];
                if (operation == null)
                {
                    result.Issues.Add(CreateIssue("null_operation", "Operation can not be null.", index, null));
                    continue;
                }

                if (operation.Type == ReportBatchOperationType.CreateNewReport)
                {
                    if (createNewReportSeen)
                    {
                        result.Issues.Add(CreateIssue("duplicate_create_new", "CreateNewReport can only appear once in a batch.", index, operation));
                    }
                    if (index != 0)
                    {
                        result.Issues.Add(CreateIssue("create_new_not_first", "CreateNewReport must be the first operation in the batch.", index, operation));
                    }
                    createNewReportSeen = true;

                    if (!HasIssuesForOperation(result, index))
                    {
                        try
                        {
                            ApplyOperation(workingReport, operation, 0);
                        }
                        catch (Exception ex)
                        {
                            result.Issues.Add(CreateIssue("validation_apply_failed", ex.Message, index, operation));
                        }
                    }
                    continue;
                }

                switch (operation.Type)
                {
                    case ReportBatchOperationType.AddObject:
                        ValidateAddObject(workingReport, operation, index, result);
                        break;
                    case ReportBatchOperationType.RemoveObject:
                        ValidateTargetExists(workingReport, operation, index, result);
                        break;
                    case ReportBatchOperationType.ModifyProperties:
                        ValidateModify(workingReport, operation, index, result);
                        break;
                    case ReportBatchOperationType.ReorderObject:
                        ValidateReorder(workingReport, operation, index, result);
                        break;
                    default:
                        result.Issues.Add(CreateIssue("unknown_operation", "Unsupported batch operation.", index, operation));
                        break;
                }

                if (!HasIssuesForOperation(result, index))
                {
                    try
                    {
                        ApplyOperation(workingReport, operation, 0);
                    }
                    catch (Exception ex)
                    {
                        result.Issues.Add(CreateIssue("validation_apply_failed", ex.Message, index, operation));
                    }
                }
            }

            ValidateReportStructureRules(workingReport, result);

            return result;
        }

        public ReportBatchApplyResult Apply(Report report, IReadOnlyList<ReportBatchOperation> operations)
        {
            var validation = Validate(report, operations);
            var result = new ReportBatchApplyResult
            {
                Report = report
            };

            if (!validation.IsValid)
            {
                result.Issues.AddRange(validation.Issues);
                return result;
            }

            report.UndoCue = report.UndoCue ?? new UndoCue();
            report.EnsureComponentNames();

            int initialUndoCount = report.UndoCue.UndoOperations.Count;

            int groupId = report.UndoCue.GetGroupId();
            result.UndoGroupId = groupId;

            for (int index = 0; index < operations.Count; index++)
            {
                var operation = operations[index];
                try
                {
                    ApplyOperation(report, operation, groupId);
                    result.AppliedOperations++;
                }
                catch (Exception ex)
                {
                    result.Issues.Add(CreateIssue("apply_failed", ex.Message, index, operation));
                    break;
                }
            }

            for (int index = initialUndoCount; index < report.UndoCue.UndoOperations.Count; index++)
            {
                result.UndoOperations.Add(report.UndoCue.UndoOperations[index]);
            }

            return result;
        }

        private static bool HasIssuesForOperation(ReportBatchValidationResult result, int operationIndex)
        {
            foreach (var issue in result.Issues)
            {
                if (issue != null && issue.OperationIndex == operationIndex)
                {
                    return true;
                }
            }

            return false;
        }

        private static Report CloneReport(Report report)
        {
            using (var stream = new MemoryStream())
            {
                report.SaveToStream(stream, StreamVersion.V2);
                stream.Position = 0;

                var clone = new Report();
                clone.LoadFromStream(stream);
                return clone;
            }
        }

        private static void ApplyOperation(Report report, ReportBatchOperation operation, int groupId)
        {
            switch (operation.Type)
            {
                case ReportBatchOperationType.CreateNewReport:
                    report.CreateNew();
                    report.EnsureComponentNames();
                    report.Modified = true;
                    break;
                case ReportBatchOperationType.AddObject:
                    ApplyAddObject(report, operation, groupId);
                    break;
                case ReportBatchOperationType.RemoveObject:
                    report.DeleteItem(GetComponentByName(report, operation.TargetName), groupId);
                    break;
                case ReportBatchOperationType.ModifyProperties:
                    ApplyModify(report, operation, groupId);
                    break;
                case ReportBatchOperationType.ReorderObject:
                    ApplyReorder(report, operation, groupId);
                    break;
                default:
                    throw new InvalidOperationException("Unsupported batch operation: " + operation.Type.ToString());
            }
        }

        private static void ValidateAddObject(Report report, ReportBatchOperation operation, int index, ReportBatchValidationResult result)
        {
            if (string.IsNullOrWhiteSpace(operation.ObjectClass))
            {
                result.Issues.Add(CreateIssue("missing_object_class", "AddObject requires ObjectClass.", index, operation));
                return;
            }

            if (!string.IsNullOrWhiteSpace(operation.TargetName) && TryGetComponentByName(report, operation.TargetName) != null)
            {
                result.Issues.Add(CreateIssue("duplicate_target_name", "TargetName already exists in report.", index, operation));
            }

            var objectClass = operation.ObjectClass.Trim();
            if (string.Equals(objectClass, "TRPSECTION", StringComparison.OrdinalIgnoreCase))
            {
                if (string.IsNullOrWhiteSpace(operation.ParentName))
                {
                    result.Issues.Add(CreateIssue("missing_parent", "TRPSECTION requires ParentName pointing to a subreport.", index, operation));
                    return;
                }

                var parent = TryGetComponentByName(report, operation.ParentName);
                if (!(parent is SubReport))
                {
                    result.Issues.Add(CreateIssue("invalid_parent", "TRPSECTION parent must be a subreport.", index, operation));
                }
                return;
            }

            if (SectionChildClasses.Contains(objectClass))
            {
                if (string.IsNullOrWhiteSpace(operation.ParentName))
                {
                    result.Issues.Add(CreateIssue("missing_parent", objectClass + " requires ParentName pointing to a section.", index, operation));
                    return;
                }

                var parent = TryGetComponentByName(report, operation.ParentName);
                if (!(parent is Section))
                {
                    result.Issues.Add(CreateIssue("invalid_parent", objectClass + " parent must be a section.", index, operation));
                }
                return;
            }

            if (!TopLevelClasses.Contains(objectClass))
            {
                result.Issues.Add(CreateIssue("unsupported_class", "Unsupported AddObject class: " + objectClass, index, operation));
            }
        }

        private static void ValidateTargetExists(Report report, ReportBatchOperation operation, int index, ReportBatchValidationResult result)
        {
            if (string.IsNullOrWhiteSpace(operation.TargetName))
            {
                result.Issues.Add(CreateIssue("missing_target", "TargetName is required.", index, operation));
                return;
            }

            if (TryGetComponentByName(report, operation.TargetName) == null)
            {
                result.Issues.Add(CreateIssue("target_not_found", "TargetName was not found in report.", index, operation));
            }
        }

        private static void ValidateModify(Report report, ReportBatchOperation operation, int index, ReportBatchValidationResult result)
        {
            ValidateTargetExists(report, operation, index, result);
            if (operation.Properties == null || operation.Properties.Count == 0)
            {
                result.Issues.Add(CreateIssue("missing_properties", "ModifyProperties requires at least one property change.", index, operation));
                return;
            }

            foreach (var property in operation.Properties)
            {
                if (property == null || string.IsNullOrWhiteSpace(property.PropertyName))
                {
                    result.Issues.Add(CreateIssue("missing_property_name", "Each modified property requires PropertyName.", index, operation));
                    continue;
                }

                if (string.Equals(property.PropertyName, "Name", StringComparison.OrdinalIgnoreCase))
                {
                    result.Issues.Add(CreateIssue("rename_not_supported", "Rename is not supported in ModifyProperties V1.", index, operation));
                }
            }
        }

        private static void ValidateReorder(Report report, ReportBatchOperation operation, int index, ReportBatchValidationResult result)
        {
            ValidateTargetExists(report, operation, index, result);
            if (operation.NewIndex == null)
            {
                result.Issues.Add(CreateIssue("missing_new_index", "ReorderObject requires NewIndex.", index, operation));
                return;
            }

            var target = TryGetComponentByName(report, operation.TargetName);
            if (target == null)
            {
                return;
            }

            if (target is PrintPosItem)
            {
                result.Issues.Add(CreateIssue("unsupported_reorder_target", "ReorderObject V1 only supports subreports, sections, params, data info and database info.", index, operation));
            }
        }

        private static void ApplyAddObject(Report report, ReportBatchOperation operation, int groupId)
        {
            var target = BaseReport.NewComponentByClassName(operation.ObjectClass.Trim());
            target.Report = report;

            if (string.IsNullOrWhiteSpace(operation.TargetName))
            {
                report.GenerateNewName(target);
            }
            else
            {
                target.Name = operation.TargetName;
            }

            InsertIntoParent(report, target, operation.InsertIndex, operation.ParentName);

            var undoOperation = new ChangeObjectOperation(OperationType.Add, groupId)
            {
                ComponentName = target.Name,
                ComponentClass = target.ClassName,
                ParentName = operation.ParentName,
                OldItemIndex = ResolveCurrentIndex(report, target)
            };

            ApplyProperties(target, operation.Properties, undoOperation, recordUndo: true);
            SynchronizeGroupSectionChangeExpression(report, target as Section, operation.Properties, undoOperation, groupId);
            report.UndoCue.AddOperation(undoOperation, report);
        }

        private static void ApplyModify(Report report, ReportBatchOperation operation, int groupId)
        {
            var target = GetComponentByName(report, operation.TargetName);
            var undoOperation = new ChangeObjectOperation(OperationType.Modify, groupId)
            {
                ComponentName = target.Name,
                ComponentClass = target.ClassName,
                ParentName = GetParentName(report, target)
            };

            ApplyProperties(target, operation.Properties, undoOperation, recordUndo: true);
            SynchronizeGroupSectionChangeExpression(report, target as Section, operation.Properties, undoOperation, groupId);
            report.UndoCue.AddOperation(undoOperation, report);
        }

        private static void ApplyReorder(Report report, ReportBatchOperation operation, int groupId)
        {
            var target = GetComponentByName(report, operation.TargetName);
            int currentIndex = ResolveCurrentIndex(report, target);
            int targetIndex = operation.NewIndex.Value;

            if (currentIndex == targetIndex)
            {
                return;
            }

            if (targetIndex < 0)
            {
                throw new InvalidOperationException("NewIndex must be zero or greater.");
            }

            while (currentIndex < targetIndex)
            {
                ApplySingleSwap(report, target, currentIndex, true, groupId);
                currentIndex++;
            }

            while (currentIndex > targetIndex)
            {
                ApplySingleSwap(report, target, currentIndex, false, groupId);
                currentIndex--;
            }
        }

        private static void ApplySingleSwap(Report report, ReportItem target, int currentIndex, bool moveDown, int groupId)
        {
            var operationType = moveDown ? OperationType.SwapDown : OperationType.SwapUp;
            var undoOperation = new ChangeObjectOperation(operationType, groupId)
            {
                ComponentName = target.Name,
                ComponentClass = target.ClassName,
                ParentName = target is Section ? ((Section)target).SubReport?.Name : GetParentName(report, target),
                OldItemIndex = currentIndex
            };

            if (target is SubReport)
            {
                Swap(report.SubReports, currentIndex, currentIndex + (moveDown ? 1 : -1));
            }
            else if (target is Section section)
            {
                Swap(section.SubReport.Sections, currentIndex, currentIndex + (moveDown ? 1 : -1));
            }
            else if (target is Param)
            {
                report.Params.Swap(currentIndex, currentIndex + (moveDown ? 1 : -1));
            }
            else if (target is DataInfo)
            {
                report.DataInfo.Swap(currentIndex, currentIndex + (moveDown ? 1 : -1));
            }
            else if (target is DatabaseInfo)
            {
                report.DatabaseInfo.Swap(currentIndex, currentIndex + (moveDown ? 1 : -1));
            }
            else
            {
                throw new InvalidOperationException("ReorderObject V1 does not support target class " + target.ClassName + ".");
            }

            report.UndoCue.AddOperation(undoOperation, report);
        }

        private static void InsertIntoParent(Report report, ReportItem target, int? insertIndex, string parentName)
        {
            int index;
            if (target is SubReport subReport)
            {
                index = NormalizeIndex(insertIndex, report.SubReports.Count);
                report.SubReports.Insert(index, subReport);
                return;
            }

            if (target is Param parameter)
            {
                index = NormalizeIndex(insertIndex, report.Params.Count);
                report.Params.Insert(index, parameter);
                return;
            }

            if (target is DataInfo dataInfo)
            {
                index = NormalizeIndex(insertIndex, report.DataInfo.Count);
                report.DataInfo.Insert(index, dataInfo);
                return;
            }

            if (target is DatabaseInfo databaseInfo)
            {
                index = NormalizeIndex(insertIndex, report.DatabaseInfo.Count);
                report.DatabaseInfo.Insert(index, databaseInfo);
                return;
            }

            if (target is Section section)
            {
                var parentSubReport = GetComponentByName(report, parentName) as SubReport;
                if (parentSubReport == null)
                {
                    throw new InvalidOperationException("Section parent subreport not found: " + parentName);
                }

                section.SubReport = parentSubReport;
                section.SubReportName = parentSubReport.Name;
                InitializeSectionDefaults(section, parentSubReport);
                index = NormalizeIndex(insertIndex, parentSubReport.Sections.Count);
                parentSubReport.Sections.Insert(index, section);
                return;
            }

            if (target is PrintPosItem printPosItem)
            {
                var parentSection = GetComponentByName(report, parentName) as Section;
                if (parentSection == null)
                {
                    throw new InvalidOperationException("Print item parent section not found: " + parentName);
                }

                printPosItem.Section = parentSection;
                index = NormalizeIndex(insertIndex, parentSection.Components.Count);
                parentSection.Components.Insert(index, printPosItem);
                return;
            }

            throw new InvalidOperationException("Unsupported AddObject target class: " + target.ClassName);
        }

        private static void InitializeSectionDefaults(Section section, SubReport parentSubReport)
        {
            if (section.Width == ConstructorSectionWidth)
            {
                section.Width = parentSubReport.Sections.Count > 0 ? parentSubReport.Sections[0].Width : DefaultSectionWidth;
            }

            if (section.Height == ConstructorSectionHeight)
            {
                section.Height = parentSubReport.Sections.Count > 0 ? parentSubReport.Sections[0].Height : DefaultSectionHeight;
            }
        }

        private static void SynchronizeGroupSectionChangeExpression(Report report, Section section, IList<ReportBatchProperty> properties, ChangeObjectOperation currentUndoOperation, int groupId)
        {
            if (section == null || section.SubReport == null)
            {
                return;
            }

            if (section.SectionType != SectionType.GroupHeader && section.SectionType != SectionType.GroupFooter)
            {
                return;
            }

            if (string.IsNullOrWhiteSpace(section.GroupName))
            {
                return;
            }

            var sibling = FindMatchingGroupSection(section);
            if (sibling == null)
            {
                return;
            }

            var explicitChangeExpression = HasProperty(properties, "ChangeExpression");
            var synchronizedExpression = ResolveSynchronizedChangeExpression(section, sibling, explicitChangeExpression);

            SetSectionChangeExpression(section, synchronizedExpression, currentUndoOperation, recordUndo: currentUndoOperation != null);

            ChangeObjectOperation siblingUndoOperation = null;
            if (groupId != 0)
            {
                siblingUndoOperation = new ChangeObjectOperation(OperationType.Modify, groupId)
                {
                    ComponentName = sibling.Name,
                    ComponentClass = sibling.ClassName,
                    ParentName = sibling.SubReport == null ? null : sibling.SubReport.Name
                };
            }

            if (SetSectionChangeExpression(sibling, synchronizedExpression, siblingUndoOperation, recordUndo: siblingUndoOperation != null) && siblingUndoOperation != null)
            {
                report.UndoCue.AddOperation(siblingUndoOperation, report);
            }
        }

        private static Section FindMatchingGroupSection(Section section)
        {
            if (section.SubReport == null || string.IsNullOrWhiteSpace(section.GroupName))
            {
                return null;
            }

            var targetType = section.SectionType == SectionType.GroupHeader ? SectionType.GroupFooter : SectionType.GroupHeader;
            foreach (var candidate in section.SubReport.Sections)
            {
                if (!ReferenceEquals(candidate, section)
                    && candidate.SectionType == targetType
                    && string.Equals(candidate.GroupName, section.GroupName, StringComparison.OrdinalIgnoreCase))
                {
                    return candidate;
                }
            }

            return null;
        }

        private static string ResolveSynchronizedChangeExpression(Section section, Section sibling, bool explicitChangeExpression)
        {
            if (explicitChangeExpression)
            {
                return section.ChangeExpression ?? string.Empty;
            }

            if (!string.IsNullOrWhiteSpace(sibling.ChangeExpression))
            {
                return sibling.ChangeExpression;
            }

            return section.ChangeExpression ?? string.Empty;
        }

        private static bool SetSectionChangeExpression(Section section, string newValue, ChangeObjectOperation undoOperation, bool recordUndo)
        {
            newValue = newValue ?? string.Empty;
            var oldValue = section.ChangeExpression ?? string.Empty;
            if (string.Equals(oldValue, newValue, StringComparison.Ordinal))
            {
                return false;
            }

            section.ChangeExpression = newValue;

            if (recordUndo && undoOperation != null && !HasUndoProperty(undoOperation, "ChangeExpression"))
            {
                undoOperation.AddProperty("ChangeExpression", PropertyType.String, oldValue, newValue);
            }

            return true;
        }

        private static bool HasProperty(IList<ReportBatchProperty> properties, string propertyName)
        {
            if (properties == null)
            {
                return false;
            }

            foreach (var property in properties)
            {
                if (property != null && string.Equals(property.PropertyName, propertyName, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }

            return false;
        }

        private static bool HasUndoProperty(ChangeObjectOperation undoOperation, string propertyName)
        {
            foreach (var property in undoOperation.Properties)
            {
                if (string.Equals(property.PropertyName, propertyName, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }

            return false;
        }

        private static void ValidateReportStructureRules(Report report, ReportBatchValidationResult result)
        {
            if (report.SubReports == null || report.SubReports.Count == 0)
            {
                result.Issues.Add(CreateIssue("no_subreports", "The report must contain at least one subreport.", null, null));
                return;
            }

            foreach (SubReport subReport in report.SubReports)
            {
                ValidateSubReportStructure(subReport, result);
            }
        }

        private static void ValidateSubReportStructure(SubReport subReport, ReportBatchValidationResult result)
        {
            var subReportName = string.IsNullOrWhiteSpace(subReport.Name) ? "(unnamed subreport)" : subReport.Name;
            if (subReport.Sections == null || subReport.Sections.Count == 0)
            {
                result.Issues.Add(CreateIssue("missing_sections", "Subreport '" + subReportName + "' must contain at least one section.", null, null));
                return;
            }

            ValidatePageHeadersAtStart(subReport, subReportName, result);
            ValidatePageFootersAtEnd(subReport, subReportName, result);

            var firstDetail = subReport.FirstDetail;
            var lastDetail = subReport.LastDetail;
            if (firstDetail < 0 || lastDetail < 0)
            {
                result.Issues.Add(CreateIssue("missing_detail", "Subreport '" + subReportName + "' must contain at least one detail section.", null, null));
                return;
            }

            for (int index = 0; index < subReport.Sections.Count; index++)
            {
                var section = subReport.Sections[index];
                if (section.SectionType == SectionType.GroupHeader && index >= firstDetail)
                {
                    result.Issues.Add(CreateIssue("group_header_after_detail", "Subreport '" + subReportName + "' has a group header after the first detail.", null, null));
                    break;
                }
            }

            for (int index = 0; index < subReport.Sections.Count; index++)
            {
                var section = subReport.Sections[index];
                if (section.SectionType == SectionType.GroupFooter && index <= lastDetail)
                {
                    result.Issues.Add(CreateIssue("group_footer_before_detail", "Subreport '" + subReportName + "' has a group footer before the last detail.", null, null));
                    break;
                }
            }

            for (int index = firstDetail; index <= lastDetail; index++)
            {
                if (subReport.Sections[index].SectionType != SectionType.Detail)
                {
                    result.Issues.Add(CreateIssue("detail_block_invalid", "Subreport '" + subReportName + "' must keep all detail sections in one continuous detail block.", null, null));
                    break;
                }
            }

            ValidateGroupRules(subReport, subReportName, firstDetail, lastDetail, result);
        }

        private static void ValidatePageHeadersAtStart(SubReport subReport, string subReportName, ReportBatchValidationResult result)
        {
            bool nonHeaderSeen = false;
            foreach (var section in subReport.Sections)
            {
                if (section.SectionType == SectionType.PageHeader)
                {
                    if (nonHeaderSeen)
                    {
                        result.Issues.Add(CreateIssue("page_header_not_first", "Subreport '" + subReportName + "' must keep page headers at the beginning.", null, null));
                        return;
                    }
                }
                else
                {
                    nonHeaderSeen = true;
                }
            }
        }

        private static void ValidatePageFootersAtEnd(SubReport subReport, string subReportName, ReportBatchValidationResult result)
        {
            bool nonFooterSeen = false;
            for (int index = subReport.Sections.Count - 1; index >= 0; index--)
            {
                var section = subReport.Sections[index];
                if (section.SectionType == SectionType.PageFooter)
                {
                    if (nonFooterSeen)
                    {
                        result.Issues.Add(CreateIssue("page_footer_not_last", "Subreport '" + subReportName + "' must keep page footers at the end.", null, null));
                        return;
                    }
                }
                else
                {
                    nonFooterSeen = true;
                }
            }
        }

        private static void ValidateGroupRules(SubReport subReport, string subReportName, int firstDetail, int lastDetail, ReportBatchValidationResult result)
        {
            var headerIndexes = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            var footerIndexes = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            var headerExpressions = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var footerExpressions = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            for (int index = 0; index < subReport.Sections.Count; index++)
            {
                var section = subReport.Sections[index];
                if (section.SectionType != SectionType.GroupHeader && section.SectionType != SectionType.GroupFooter)
                {
                    continue;
                }

                if (string.IsNullOrWhiteSpace(section.GroupName))
                {
                    result.Issues.Add(CreateIssue("missing_group_name", "Subreport '" + subReportName + "' has a group section without GroupName.", null, null));
                    continue;
                }

                var groupName = section.GroupName;
                if (section.SectionType == SectionType.GroupHeader)
                {
                    if (headerIndexes.ContainsKey(groupName))
                    {
                        result.Issues.Add(CreateIssue("duplicate_group_header", "Subreport '" + subReportName + "' has more than one group header for group '" + groupName + "'.", null, null));
                        continue;
                    }

                    headerIndexes[groupName] = index;
                    headerExpressions[groupName] = section.ChangeExpression ?? string.Empty;
                }
                else
                {
                    if (footerIndexes.ContainsKey(groupName))
                    {
                        result.Issues.Add(CreateIssue("duplicate_group_footer", "Subreport '" + subReportName + "' has more than one group footer for group '" + groupName + "'.", null, null));
                        continue;
                    }

                    footerIndexes[groupName] = index;
                    footerExpressions[groupName] = section.ChangeExpression ?? string.Empty;
                }
            }

            foreach (var pair in headerIndexes)
            {
                if (!footerIndexes.ContainsKey(pair.Key))
                {
                    result.Issues.Add(CreateIssue("group_pair_missing", "Subreport '" + subReportName + "' is missing the group footer for group '" + pair.Key + "'.", null, null));
                }
            }

            foreach (var pair in footerIndexes)
            {
                if (!headerIndexes.ContainsKey(pair.Key))
                {
                    result.Issues.Add(CreateIssue("group_pair_missing", "Subreport '" + subReportName + "' is missing the group header for group '" + pair.Key + "'.", null, null));
                }
            }

            foreach (var pair in headerIndexes)
            {
                if (!footerIndexes.TryGetValue(pair.Key, out var footerIndex))
                {
                    continue;
                }

                var headerIndex = pair.Value;
                var headerExpression = headerExpressions[pair.Key] ?? string.Empty;
                var footerExpression = footerExpressions[pair.Key] ?? string.Empty;

                if (!string.Equals(headerExpression, footerExpression, StringComparison.Ordinal))
                {
                    result.Issues.Add(CreateIssue("group_change_expression_mismatch", "Subreport '" + subReportName + "' must keep the same ChangeExpression in the group header and group footer for group '" + pair.Key + "'.", null, null));
                }

                if ((firstDetail - headerIndex) != (footerIndex - lastDetail))
                {
                    result.Issues.Add(CreateIssue("group_not_symmetric", "Subreport '" + subReportName + "' must keep group '" + pair.Key + "' symmetric relative to the first and last detail.", null, null));
                }
            }
        }

        private static void ApplyProperties(ReportItem target, IList<ReportBatchProperty> properties, ChangeObjectOperation undoOperation, bool recordUndo)
        {
            if (properties == null)
            {
                return;
            }

            foreach (var property in properties)
            {
                if (property == null || string.IsNullOrWhiteSpace(property.PropertyName))
                {
                    continue;
                }

                var member = GetWritableMember(target.GetType(), property.PropertyName);
                if (member == null)
                {
                    throw new InvalidOperationException("Property or field not found: " + property.PropertyName);
                }

                var oldValue = GetMemberValue(target, member);
                var newValue = ConvertValue(property.Value, GetMemberType(member));
                SetMemberValue(target, member, newValue);

                if (recordUndo)
                {
                    undoOperation.AddProperty(
                        property.PropertyName,
                        InferPropertyType(newValue, GetMemberType(member)),
                        oldValue,
                        newValue);
                }
            }
        }

        private static int ResolveCurrentIndex(Report report, ReportItem target)
        {
            if (target is SubReport subReport)
            {
                return report.SubReports.IndexOf(subReport);
            }

            if (target is Section section)
            {
                return section.SubReport.Sections.IndexOf(section);
            }

            if (target is PrintPosItem printPosItem)
            {
                return printPosItem.Section.Components.IndexOf(printPosItem);
            }

            if (target is Param parameter)
            {
                return report.Params.IndexOf(parameter);
            }

            if (target is DataInfo dataInfo)
            {
                return report.DataInfo.IndexOf(dataInfo);
            }

            if (target is DatabaseInfo databaseInfo)
            {
                return report.DatabaseInfo.IndexOf(databaseInfo);
            }

            throw new InvalidOperationException("Unsupported target class: " + target.ClassName);
        }

        private static string GetParentName(Report report, ReportItem item)
        {
            if (item is Section section)
            {
                return section.SubReport == null ? null : section.SubReport.Name;
            }

            if (item is PrintPosItem printPosItem)
            {
                return printPosItem.Section == null ? null : printPosItem.Section.Name;
            }

            if (item is SubReport || item is Param || item is DataInfo || item is DatabaseInfo)
            {
                return null;
            }

            var parentSection = report.GetParentSection((PrintPosItem)item);
            return parentSection == null ? null : parentSection.Name;
        }

        private static ReportItem GetComponentByName(Report report, string name)
        {
            var item = TryGetComponentByName(report, name);
            if (item == null)
            {
                throw new InvalidOperationException("Component not found: " + name);
            }
            return item;
        }

        private static ReportItem TryGetComponentByName(Report report, string name)
        {
            if (string.IsNullOrWhiteSpace(name))
            {
                return null;
            }

            if (string.Equals(name, "REPORT", StringComparison.OrdinalIgnoreCase))
            {
                return report;
            }

            if (report.Components.TryGetValue(name, out var item))
            {
                return item;
            }

            if (report.Components.TryGetValue(name.ToUpperInvariant(), out item))
            {
                return item;
            }

            return null;
        }

        private static ReportBatchIssue CreateIssue(string code, string message, int? operationIndex, ReportBatchOperation operation)
        {
            return new ReportBatchIssue
            {
                Code = code,
                Message = message,
                OperationIndex = operationIndex,
                OperationId = operation == null ? null : operation.OperationId
            };
        }

        private static int NormalizeIndex(int? requestedIndex, int count)
        {
            if (requestedIndex == null)
            {
                return count;
            }

            if (requestedIndex.Value < 0 || requestedIndex.Value > count)
            {
                throw new InvalidOperationException("InsertIndex out of range.");
            }

            return requestedIndex.Value;
        }

        private static MemberInfo GetWritableMember(Type type, string memberName)
        {
            var property = type.GetProperty(memberName, BindingFlags.Instance | BindingFlags.Public | BindingFlags.IgnoreCase);
            if (property != null && property.CanWrite)
            {
                return property;
            }

            var field = type.GetField(memberName, BindingFlags.Instance | BindingFlags.Public | BindingFlags.IgnoreCase);
            return field;
        }

        private static Type GetMemberType(MemberInfo member)
        {
            if (member is PropertyInfo property)
            {
                return property.PropertyType;
            }

            return ((FieldInfo)member).FieldType;
        }

        private static object GetMemberValue(object target, MemberInfo member)
        {
            if (member is PropertyInfo property)
            {
                return property.GetValue(target, null);
            }

            return ((FieldInfo)member).GetValue(target);
        }

        private static void SetMemberValue(object target, MemberInfo member, object value)
        {
            if (member is PropertyInfo property)
            {
                property.SetValue(target, value, null);
                return;
            }

            ((FieldInfo)member).SetValue(target, value);
        }

        private static object ConvertValue(object value, Type targetType)
        {
            if (value == null)
            {
                return null;
            }

            var nonNullableType = Nullable.GetUnderlyingType(targetType) ?? targetType;
            if (nonNullableType.IsInstanceOfType(value))
            {
                return value;
            }

            if (nonNullableType == typeof(string))
            {
                return Convert.ToString(value, CultureInfo.InvariantCulture);
            }

            if (nonNullableType == typeof(Variant))
            {
                return ConvertToVariant(value);
            }

            if (nonNullableType.IsEnum)
            {
                if (value is string stringValue)
                {
                    return Enum.Parse(nonNullableType, stringValue, true);
                }
                return Enum.ToObject(nonNullableType, Convert.ChangeType(value, Enum.GetUnderlyingType(nonNullableType), CultureInfo.InvariantCulture));
            }

            if (nonNullableType == typeof(bool) && value is string boolText)
            {
                return bool.Parse(boolText);
            }

            if (nonNullableType == typeof(int[]))
            {
                return ConvertArray<int>(value);
            }

            if (nonNullableType == typeof(string[]))
            {
                return ConvertArray<string>(value);
            }

            if (typeof(IList).IsAssignableFrom(nonNullableType) && value is IList listValue)
            {
                return listValue;
            }

            return Convert.ChangeType(value, nonNullableType, CultureInfo.InvariantCulture);
        }

        private static Variant ConvertToVariant(object value)
        {
            if (value is Variant variant)
            {
                return variant;
            }
            if (value is string stringValue)
            {
                return (Variant)stringValue;
            }
            if (value is bool boolValue)
            {
                return (Variant)boolValue;
            }
            if (value is int intValue)
            {
                return (Variant)intValue;
            }
            if (value is long longValue)
            {
                return (Variant)longValue;
            }
            if (value is double doubleValue)
            {
                return (Variant)doubleValue;
            }
            if (value is decimal decimalValue)
            {
                return (Variant)decimalValue;
            }
            if (value is DateTime dateTimeValue)
            {
                return (Variant)dateTimeValue;
            }
            return (Variant)Convert.ToString(value, CultureInfo.InvariantCulture);
        }

        private static T[] ConvertArray<T>(object value)
        {
            if (value is T[] typedArray)
            {
                return typedArray;
            }

            if (value is IEnumerable enumerable)
            {
                var list = new List<T>();
                foreach (var item in enumerable)
                {
                    list.Add((T)Convert.ChangeType(item, typeof(T), CultureInfo.InvariantCulture));
                }
                return list.ToArray();
            }

            throw new InvalidOperationException("Value can not be converted to " + typeof(T).Name + " array.");
        }

        private static PropertyType InferPropertyType(object value, Type targetType)
        {
            var type = Nullable.GetUnderlyingType(targetType) ?? targetType;
            if (type == typeof(string))
            {
                return PropertyType.String;
            }
            if (type == typeof(bool))
            {
                return PropertyType.Boolean;
            }
            if (type == typeof(DateTime))
            {
                return PropertyType.Date;
            }
            if (type == typeof(string[]))
            {
                return PropertyType.StringArray;
            }
            if (type == typeof(Variant))
            {
                return PropertyType.Variant;
            }
            if (type == typeof(float) || type == typeof(double) || type == typeof(decimal))
            {
                return PropertyType.Number;
            }
            if (type.IsEnum || type == typeof(byte) || type == typeof(short) || type == typeof(int) || type == typeof(long))
            {
                return PropertyType.Integer;
            }
            if (value is byte[])
            {
                return PropertyType.Binary;
            }
            return PropertyType.String;
        }

        private static void Swap<T>(IList<T> list, int index1, int index2)
        {
            if (index1 < 0 || index1 >= list.Count || index2 < 0 || index2 >= list.Count)
            {
                throw new InvalidOperationException("Swap indexes out of range.");
            }

            var temp = list[index1];
            list[index1] = list[index2];
            list[index2] = temp;
        }
    }
}