using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Reportman.Drawing;

namespace Reportman.Reporting
{
    public class UndoCue
    {
        public int GroupId { get; private set; } = 0;
        public List<ChangeObjectOperation> UndoOperations { get; } = new List<ChangeObjectOperation>();
        public List<ChangeObjectOperation> RedoOperations { get; } = new List<ChangeObjectOperation>();

        public void AddOperation(ChangeObjectOperation op, BaseReport report)
        {
            if (!report.Modified)
            {
                report.Modified = true;
            }
            UndoOperations.Add(op);
            // se pierde el redo al hacer una nueva operación
            RedoOperations.Clear();
        }

        public int GetGroupId()
        {
            GroupId++;
            return GroupId;
        }

        public List<ChangeObjectOperation> Undo(Report report)
        {
            if (UndoOperations.Count == 0) return null;

            var operations = new List<ChangeObjectOperation>();
            var gId = UndoOperations[UndoOperations.Count - 1].GroupId;
            int newGroupId = gId;

            while (newGroupId == gId)
            {
                var op = UndoOperations.LastOrDefault();
                if (op == null) break;
                // pop
                UndoOperations.RemoveAt(UndoOperations.Count - 1);

                operations.Add(op);
                ApplyOperation(op, true, report);
                RedoOperations.Add(op);

                if (UndoOperations.Count == 0) break;
                newGroupId = UndoOperations[UndoOperations.Count - 1].GroupId;
            }

            return operations;
        }

        public List<ChangeObjectOperation> Redo(Report report)
        {
            if (RedoOperations.Count == 0) return null;

            var operations = new List<ChangeObjectOperation>();
            var gId = RedoOperations[RedoOperations.Count - 1].GroupId;
            int newGroupId = gId;

            while (newGroupId == gId)
            {
                var op = RedoOperations.LastOrDefault();
                if (op == null) break;
                RedoOperations.RemoveAt(RedoOperations.Count - 1);

                operations.Add(op);
                ApplyOperation(op, false, report);
                UndoOperations.Add(op);

                if (RedoOperations.Count == 0) break;
                newGroupId = RedoOperations[RedoOperations.Count - 1].GroupId;
            }

            return operations;
        }

        private ReportItem GetComponentByName(string name, Report report)
        {
            if (name == "REPORT")
            {
                return report;
            }
            else
            {
                if (!report.Components.TryGetValue(name, out var item))
                {
                    throw new Exception("Item not found at apply Operation undo/redo cue: " + name);
                }
                return item;
            }
        }

        private void ApplySwapOperation(string className, bool down, int oldIndex, Report report, string parentName = null)
        {
            int increment = down ? 1 : -1;
            // determine array
            switch (className)
            {
                case "TRPSUBREPORT":
                    report.SubReports.Swap(oldIndex, oldIndex + increment);
                    break;
                case "TRPSECTION":
                    {
                        if (string.IsNullOrEmpty(parentName))
                            throw new Exception("Parent name required for TRPSECTION swap.");
                        var subreport = GetComponentByName(parentName, report) as SubReport;
                        if (subreport == null)
                            throw new Exception("Parent subreport not found for swap: " + parentName);
                        subreport.Sections.Swap(oldIndex, oldIndex + increment);
                    }
                    break;
                case "TRPPARAM":
                    report.Params.Swap(oldIndex, oldIndex + increment);
                    break;
                case "TRPDATAINFOITEM":
                    report.DataInfo.Swap(oldIndex, oldIndex + increment);
                    break;
                case "TRPDATABASEINFOITEM":
                    report.DatabaseInfo.Swap(oldIndex, oldIndex + increment);
                    break;
                default:
                    throw new Exception("Swap not supported for className: " + className);
            }
        }

        private void ApplyOperation(ChangeObjectOperation operation, bool isUndo, Report report)
        {
            ReportItem target = null;
            bool loadTarget = true;

            switch (operation.Operation)
            {
                case OperationType.Add:
                    if (!isUndo)
                    {
                        loadTarget = false;
                    }
                    break;

                case OperationType.SwapDown:
                case OperationType.SwapUp:
                    if (operation.OldItemIndex == null)
                    {
                        throw new Exception("OldItemIndex required for swap");
                    }
                    ApplySwapOperation(
                        operation.ComponentClass,
                        operation.Operation == OperationType.SwapDown,
                        Convert.ToInt32(operation.OldItemIndex),
                        report,
                        operation.ParentName
                    );
                    return;

                case OperationType.Remove:
                    if (isUndo)
                    {
                        loadTarget = false;
                        // Undo remove must create the new element
                        target = BaseReport.NewComponentByClassName(operation.ComponentClass);
                        target.Report = report;
                        target.Name = operation.ComponentName;
                        if (!string.IsNullOrEmpty(operation.ParentName))
                        {
                            var parentCompo = GetComponentByName(operation.ParentName, report) as ReportItem;
                            if (parentCompo == null)
                                throw new Exception("Parent section name not found: " + operation.ParentName);
                            if (parentCompo.ClassName == "TRPSECTION")
                            {
                                var parentSec = parentCompo as Section;
                                parentSec.Components.Insert(operation.OldItemIndex ?? 0, (PrintPosItem)target);
                            }
                            else
                            {
                                var parentSub = GetComponentByName(operation.ParentName, report) as SubReport;
                                if (parentSub == null)
                                    throw new Exception("Parent section name not found: " + operation.ParentName);
                                parentSub.Sections.Insert(operation.OldItemIndex ?? 0, (Section)target);
                            }
                        }
                        else
                        {
                            // Add to report element array
                            switch (target.ClassName)
                            {
                                case "TRPDATAINFOITEM":
                                    report.DataInfo.Insert(operation.OldItemIndex ?? 0, (DataInfo)target);
                                    break;
                                case "TRPDATABASEINFOITEM":
                                    report.DatabaseInfo.Insert(operation.OldItemIndex ?? 0, (DatabaseInfo)target);
                                    break;
                                case "TRPPARAM":
                                    report.Params.Insert(operation.OldItemIndex ?? 0, (Param)target);
                                    break;
                            }
                        }
                        report.Components[target.Name] = target;
                    }
                    else
                    {
                        // Redo remove operation
                        target = GetComponentByName(operation.ComponentName, report);
                        if (target == null) throw new Exception("Error target not assigned redo operation");
                        report.DeleteItem((ReportItem)target, 0);
                        return;
                    }
                    break;

                default:
                    loadTarget = true;
                    break;
            }

            if (loadTarget)
            {
                target = GetComponentByName(operation.ComponentName, report);
            }

            Section parentSection = null;
            SubReport parentSubreport = null;

            if (operation.Operation == OperationType.Add)
            {
                if (!string.IsNullOrEmpty(operation.ParentName))
                {
                    var parentItem = GetComponentByName(operation.ParentName, report) as ReportItem;
                    if (parentItem == null) throw new Exception("Parent item not found: " + operation.ParentName);
                    if (parentItem.ClassName == "TRPSECTION")
                    {
                        parentSection = parentItem as Section;
                    }
                    else
                    {
                        parentSubreport = parentItem as SubReport;
                    }
                }

                if (isUndo)
                {
                    if (target == null) return;
                    var targetReportItem = target;
                    if (parentSection != null)
                    {
                        for (int idx = 0; idx < parentSection.Components.Count; idx++)
                        {
                            var componentToRemove = parentSection.Components[idx];
                            if (componentToRemove.Name == operation.ComponentName)
                            {
                                parentSection.Components.RemoveAt(idx);
                                report.Components.Remove(componentToRemove.Name);
                                return;
                            }
                        }
                        throw new Exception("Component not found");
                    }
                    else
                    {
                        switch (targetReportItem.ClassName)
                        {
                            case "TRPSECTION":
                                if (parentSubreport == null) throw new Exception("No parentSubreport");
                                for (int i = 0; i < parentSubreport.Sections.Count; i++)
                                {
                                    if (parentSubreport.Sections[i].Name == targetReportItem.Name)
                                    {
                                        parentSubreport.Sections.RemoveAt(i);
                                        report.Components.Remove(targetReportItem.Name);
                                        return;
                                    }
                                }
                                throw new Exception("Section not found");

                            case "TRPSUBREPORT":
                                for (int i = 0; i < report.SubReports.Count; i++)
                                {
                                    if (report.SubReports[i].Name == targetReportItem.Name)
                                    {
                                        report.SubReports.RemoveAt(i);
                                        report.Components.Remove(targetReportItem.Name);
                                        return;
                                    }
                                }
                                throw new Exception("Subreport not found");

                            case "TRPDATAINFOITEM":
                                for (int i = 0; i < report.DataInfo.Count; i++)
                                {
                                    if (report.DataInfo[i].Name == targetReportItem.Name)
                                    {
                                        report.DataInfo.RemoveAt(i);
                                        report.Components.Remove(targetReportItem.Name);
                                        return;
                                    }
                                }
                                throw new Exception("DataInfo not found");

                            case "TRPDATABASEINFOITEM":
                                for (int i = 0; i < report.DatabaseInfo.Count; i++)
                                {
                                    if (report.DatabaseInfo[i].Name == targetReportItem.Name)
                                    {
                                        report.DatabaseInfo.RemoveAt(i);
                                        report.Components.Remove(targetReportItem.Name);
                                        return;
                                    }
                                }
                                throw new Exception("Database info not found");

                            case "TRPPARAM":
                                for (int i = 0; i < report.Params.Count; i++)
                                {
                                    if (report.Params[i].Name == targetReportItem.Name)
                                    {
                                        report.Params.RemoveAt(i);
                                        report.Components.Remove(targetReportItem.Name);
                                        return;
                                    }
                                }
                                throw new Exception("Param not found");
                        }
                    }
                }
                else
                {
                    target = BaseReport.NewComponentByClassName(operation.ComponentClass);
                    target.Report = report;
                    target.Name = operation.ComponentName;
                    report.Components[target.Name] = target;
                    if (parentSection != null)
                    {
                        var targetPrintPosItem = (PrintPosItem)target;
                        parentSection.Components.Insert(operation.OldItemIndex ?? 0, targetPrintPosItem);
                    }
                    else
                    {
                        if (parentSubreport != null)
                        {
                            report.SubReports.Insert(operation.OldItemIndex ?? 0, (SubReport)target);
                        }
                        else
                        {
                            switch (target.ClassName)
                            {
                                case "TRPPARAM":
                                    report.Params.Insert(operation.OldItemIndex ?? 0, (Param)target);
                                    break;
                                case "TRPDATAINFOITEM":
                                    report.DataInfo.Insert(operation.OldItemIndex ?? 0, (DataInfo)target);
                                    break;
                                case "TRPDATABASEINFOITEM":
                                    report.DatabaseInfo.Insert(operation.OldItemIndex ?? 0, (DatabaseInfo)target);
                                    break;
                                default:
                                    throw new Exception("Class not found: " + target.ClassName);
                            }
                        }
                    }
                }
            }

            if (!string.IsNullOrEmpty(operation.ParentName) && !string.IsNullOrEmpty(operation.OldParentName))
            {
                var newParentName = isUndo ? operation.OldParentName : operation.ParentName;
                var oldParentName = isUndo ? operation.ParentName : operation.OldParentName;
                var oldParentSection = GetComponentByName(oldParentName, report) as Section;
                var newParentSection = GetComponentByName(newParentName, report) as Section;
                if (oldParentSection == null || newParentSection == null) throw new Exception("Can not undo/redo");
                var indexOld = oldParentSection.Components.IndexOf((PrintPosItem)target);
                if (indexOld < 0) throw new Exception("Component not found");
                oldParentSection.Components.RemoveAt(indexOld);
                newParentSection.Components.Add((PrintPosItem)target);
            }

            ApplyPropertiesToObject(operation, (ReportItem)target, isUndo);
        }

        public void ApplyPropertiesToObject(ChangeObjectOperation operation, ReportItem item, bool isUndo)
        {
            foreach (var prop in operation.Properties)
            {
                object value = (isUndo && operation.Operation != OperationType.Remove) ? prop.OldValue : prop.NewValue;
                var propName = prop.PropertyName;
                // Try to set as property first
                var pi = item.GetType().GetProperty(propName, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
                if (pi != null && pi.CanWrite)
                {
                    // Attempt conversion if necessary (basic conversion)
                    try
                    {
                        var converted = ChangeTypeSafely(value, pi.PropertyType);
                        pi.SetValue(item, converted);
                        continue;
                    }
                    catch
                    {
                        // ignore conversion error and try field
                    }
                }

                // Try to set as field
                var fi = item.GetType().GetField(propName, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
                if (fi != null)
                {
                    var converted = ChangeTypeSafely(value, fi.FieldType);
                    fi.SetValue(item, converted);
                }
                else
                {
                    // If property/field not found, ignore or throw depending on your policy
                    // throw new Exception($"Property or field '{propName}' not found on {item.GetType().FullName}");
                }
            }
        }

        private static object ChangeTypeSafely(object value, Type targetType)
        {
            if (value == null) return null;

            var valueType = value.GetType();

            if (targetType.IsAssignableFrom(valueType)) return value;

            // handle common conversions
            try
            {
                if (targetType.IsEnum)
                {
                    if (value is string s)
                        return Enum.Parse(targetType, s, true);
                    return Enum.ToObject(targetType, value);
                }

                if (targetType == typeof(DateTime))
                {
                    if (value is DateTime dt) return dt;
                    if (value is string s)
                    {
                        if (DateTime.TryParse(s, out var parsed)) return parsed;
                    }
                }

                return Convert.ChangeType(value, targetType);
            }
            catch
            {
                // fallback: return original value if conversion fails
                return value;
            }
        }
    }

    public class ChangeObjectOperation
    {
        public ChangeObjectOperation(OperationType operation, int groupId)
        {
            Operation = operation;
            GroupId = groupId;
            Date = DateTime.Now;
        }

        public OperationType Operation { get; set; }
        public int GroupId { get; set; }
        public string ComponentName { get; set; }
        public string ComponentClass { get; set; }
        public string ParentName { get; set; }
        public int? OldItemIndex { get; set; }
        public string OldParentName { get; set; }
        public DateTime? Date { get; set; }
        public bool ExpandedProperties { get; set; } = true;
        public List<ChangeOperationItem> Properties { get; } = new List<ChangeOperationItem>();

        public void AddProperty(string propName, PropertyType propType, object oldValue, object newValue)
        {
            Properties.Add(new ChangeOperationItem(propName, propType, oldValue, newValue));
        }
    }

    public class ChangeOperationItem
    {
        public ChangeOperationItem(string propertyName, PropertyType propertyType, object oldValue = null, object newValue = null)
        {
            PropertyName = propertyName;
            PropertyType = propertyType;
            OldValue = oldValue;
            NewValue = newValue;
        }

        public string PropertyName { get; set; }
        public PropertyType PropertyType { get; set; }
        public object OldValue { get; set; }
        public object NewValue { get; set; }
    }

    public enum PropertyType
    {
        Integer = 1,
        Number = 2,
        String = 3,
        Date = 4,
        Binary = 5,
        Boolean = 6,
        Variant = 7,
        StringArray = 8
    }

    public enum OperationType
    {
        Add,
        Modify,
        Remove,
        SwapDown,
        SwapUp
    }
}
