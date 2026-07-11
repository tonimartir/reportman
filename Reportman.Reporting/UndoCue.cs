using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Reportman.Drawing;

namespace Reportman.Reporting
{
    /// <summary>
    /// Undo/redo history for a report, holding queues of grouped change operations and
    /// applying them to a <see cref="Report"/> to step backward or forward through edits.
    /// </summary>
    public class UndoCue
    {
        /// <summary>
        /// Gets the identifier of the most recently used operation group. Related change
        /// operations share a group id so they are undone and redone together as one step.
        /// </summary>
        public int GroupId { get; private set; } = 0;
        /// <summary>
        /// Gets the stack of change operations available to undo, ordered oldest first with the
        /// most recent operation at the end.
        /// </summary>
        public List<ChangeObjectOperation> UndoOperations { get; } = new List<ChangeObjectOperation>();
        /// <summary>
        /// Gets the stack of change operations available to redo, populated as operations are undone.
        /// </summary>
        public List<ChangeObjectOperation> RedoOperations { get; } = new List<ChangeObjectOperation>();

        /// <summary>
        /// Pushes a change operation onto the undo stack, marks the report as modified and clears
        /// the redo stack because a new edit invalidates any previously undone operations.
        /// </summary>
        /// <param name="op">The change operation to record.</param>
        /// <param name="report">The report being edited, whose modified flag is set.</param>
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

        /// <summary>
        /// Elimina del histórico las operaciones de deshacer (y rehacer) anteriores a <paramref name="date"/>,
        /// según su marca de tiempo <see cref="ChangeObjectOperation.Date"/>. Las operaciones sin fecha se
        /// conservan (no se pueden datar). Sirve para que el histórico persistido del informe no crezca sin
        /// límite. Devuelve el número de operaciones de deshacer eliminadas.
        /// </summary>
        public int RemoveOperationsOlderThan(DateTime date)
        {
            int removed = UndoOperations.RemoveAll(op => op.Date.HasValue && op.Date.Value < date);
            RedoOperations.RemoveAll(op => op.Date.HasValue && op.Date.Value < date);
            return removed;
        }

        /// <summary>
        /// Synchronizes the group id with the current queues, advances it to the next value and
        /// returns it, so a new batch of related operations can share a fresh group id.
        /// </summary>
        /// <returns>The newly allocated group identifier.</returns>
        public int GetGroupId()
        {
            SynchronizeGroupIdFromQueues();
            GroupId++;
            return GroupId;
        }

        /// <summary>
        /// Recomputes the current group id from the undo and redo queues, keeping it consistent
        /// after operations have been loaded from a persisted report.
        /// </summary>
        public void EnsureGroupIdIsSynchronized()
        {
            SynchronizeGroupIdFromQueues();
        }

        private void SynchronizeGroupIdFromQueues()
        {
            if (UndoOperations.Count > 0 || (RedoOperations.Count > 0 && GroupId == 0))
            {
                if (UndoOperations.Count > 0)
                {
                    GroupId = UndoOperations[UndoOperations.Count - 1].GroupId;
                }

                if (RedoOperations.Count > 0)
                {
                    int redoGroupId = RedoOperations[0].GroupId;
                    GroupId = Math.Max(GroupId, redoGroupId);
                }
            }
        }

        /// <summary>
        /// Undoes the most recent group of operations, reverting them on the report and moving them
        /// to the redo stack.
        /// </summary>
        /// <param name="report">The report to revert the operations on.</param>
        /// <returns>The list of operations that were undone, or <c>null</c> if there was nothing to undo.</returns>
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

            if (operations.Count > 0)
            {
                report.Modified = true;
            }

            return operations;
        }

        /// <summary>
        /// Reapplies the most recent group of undone operations, restoring them on the report and
        /// moving them back to the undo stack.
        /// </summary>
        /// <param name="report">The report to reapply the operations on.</param>
        /// <returns>The list of operations that were redone, or <c>null</c> if there was nothing to redo.</returns>
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

            if (operations.Count > 0)
            {
                report.Modified = true;
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
                    if (!report.Components.TryGetValue(name.ToUpper(), out item))
                    {
                        throw new Exception("Item not found at apply Operation undo/redo cue: " + name);
                    }
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

                case OperationType.Rename:
                    {
                        var oldName = isUndo ? operation.OldParentName : operation.ComponentName;
                        var newName = isUndo ? operation.ComponentName : operation.OldParentName;
                        var compo = GetComponentByName(newName, report);
                        compo.Name = oldName;
                        report.Components.Remove(newName);
                        report.Components[oldName] = compo;
                    }
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
                                var printPosItem = (PrintPosItem)target;
                                printPosItem.Section = parentSec;
                                parentSec.Components.Insert(operation.OldItemIndex ?? 0, printPosItem);
                            }
                            else
                            {
                                var parentSub = GetComponentByName(operation.ParentName, report) as SubReport;
                                if (parentSub == null)
                                    throw new Exception("Parent section name not found: " + operation.ParentName);
                                if (target.ClassName == "TRPSECTION")
                                {
                                    ((Section)target).SubReport = parentSub;
                                }
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
                                case "TRPSUBREPORT":
                                    report.SubReports.Insert(operation.OldItemIndex ?? 0, (SubReport)target);
                                    break;
                            }
                        }
                        report.Components[target.Name.ToUpper()] = target;
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
                                operation.OldItemIndex = idx;
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
                                        operation.OldItemIndex = i;
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
                                        operation.OldItemIndex = i;
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
                                        operation.OldItemIndex = i;
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
                                        operation.OldItemIndex = i;
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
                            parentSubreport.Sections.Insert(operation.OldItemIndex ?? 0, (Section)target);
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
                                case "TRPSUBREPORT":
                                    report.SubReports.Insert(operation.OldItemIndex ?? 0, (SubReport)target);
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

        /// <summary>
        /// Applies the recorded property changes of an operation to the given report item, using the
        /// old values when undoing and the new values when redoing, by reflection over properties and fields.
        /// </summary>
        /// <param name="operation">The operation whose property changes are applied.</param>
        /// <param name="item">The report item to modify.</param>
        /// <param name="isUndo"><c>true</c> to apply the old values (undo); <c>false</c> to apply the new values (redo).</param>
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

            // Listas de cadenas (p.ej. AllStrings de LabelItem): tras el viaje por JSON
            // llegan como JArray y la conversión genérica fallaba, dejando el deshacer
            // sin efecto para esas propiedades.
            if (targetType == typeof(Strings))
            {
                Strings nstrings = new Strings();
                if (value is Newtonsoft.Json.Linq.JArray jarray)
                {
                    foreach (var token in jarray)
                        nstrings.Add(token?.ToString() ?? "");
                    return nstrings;
                }
                if (value is string joined)
                {
                    nstrings.Text = joined;
                    return nstrings;
                }
                if (value is System.Collections.IEnumerable enumerable)
                {
                    foreach (object element in enumerable)
                        nstrings.Add(element?.ToString() ?? "");
                    return nstrings;
                }
            }

            // Handle Variant type specially (like TypeScript any type)
            if (targetType == typeof(Variant))
            {
                if (value is Variant v) return v;
                if (value is string strVal) return (Variant)strVal;
                if (value is int intVal) return (Variant)intVal;
                if (value is long longVal) return (Variant)longVal;
                if (value is double doubleVal) return (Variant)doubleVal;
                if (value is decimal decVal) return (Variant)decVal;
                if (value is bool boolVal) return (Variant)boolVal;
                if (value is DateTime dtVal) return (Variant)dtVal;
                if (value is byte byteVal) return (Variant)byteVal;
                if (value is char charVal) return (Variant)charVal;
                // fallback: convert to string then to Variant
                return (Variant)(value?.ToString() ?? "");
            }

            // Handle conversion from Variant to other types
            if (valueType == typeof(Variant))
            {
                var variant = (Variant)value;
                if (targetType == typeof(string)) return variant.AsString;
                if (targetType == typeof(int)) return variant.AsInteger;
                if (targetType == typeof(long)) return variant.AsLong;
                if (targetType == typeof(double)) return variant.AsDouble;
                if (targetType == typeof(decimal)) return variant.AsDecimal;
                if (targetType == typeof(bool)) return (bool)variant;
                if (targetType == typeof(DateTime)) return variant.AsDateTime;
            }

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

    /// <summary>
    /// A single undoable change to a report component (add, remove, modify, rename or swap),
    /// recording the affected component, its parent/index context and the list of property changes.
    /// </summary>
    public class ChangeObjectOperation
    {
        /// <summary>
        /// Creates a change operation of the given kind, assigns it to the given group and
        /// timestamps it with the current date and time.
        /// </summary>
        /// <param name="operation">The kind of edit this operation represents.</param>
        /// <param name="groupId">The group identifier that bundles related operations together.</param>
        public ChangeObjectOperation(OperationType operation, int groupId)
        {
            Operation = operation;
            GroupId = groupId;
            Date = DateTime.Now;
        }

        /// <summary>
        /// Gets or sets the kind of edit this operation represents (add, modify, remove, swap or rename).
        /// </summary>
        public OperationType Operation { get; set; }
        /// <summary>
        /// Gets or sets the group identifier used to bundle related operations so they undo and redo together.
        /// </summary>
        public int GroupId { get; set; }
        /// <summary>
        /// Gets or sets the name of the report component affected by this operation.
        /// </summary>
        public string ComponentName { get; set; }
        /// <summary>
        /// Gets or sets the class name (e.g. TRPSECTION, TRPSUBREPORT) of the affected component.
        /// </summary>
        public string ComponentClass { get; set; }
        /// <summary>
        /// Gets or sets the name of the component's parent (section or subreport) when applicable.
        /// </summary>
        public string ParentName { get; set; }
        /// <summary>
        /// Gets or sets the index the component had within its parent collection, used to restore
        /// its original position when undoing a removal or reordering.
        /// </summary>
        public int? OldItemIndex { get; set; }
        /// <summary>
        /// Gets or sets the previous parent name or previous component name, used when moving between
        /// parents or renaming a component.
        /// </summary>
        public string OldParentName { get; set; }
        /// <summary>
        /// Gets or sets the timestamp of when the operation was recorded, or <c>null</c> if it has no date.
        /// </summary>
        public DateTime? Date { get; set; }
        /// <summary>
        /// Gets or sets a value indicating whether the operation's individual property changes are
        /// expanded (stored one by one) rather than serialized as a whole object.
        /// </summary>
        public bool ExpandedProperties { get; set; } = true;
        /// <summary>
        /// Gets the list of individual property changes recorded for this operation.
        /// </summary>
        public List<ChangeOperationItem> Properties { get; } = new List<ChangeOperationItem>();

        /// <summary>
        /// Records a single property change with its type and its old and new values.
        /// </summary>
        /// <param name="propName">The name of the changed property.</param>
        /// <param name="propType">The data type of the property value.</param>
        /// <param name="oldValue">The value before the change.</param>
        /// <param name="newValue">The value after the change.</param>
        public void AddProperty(string propName, PropertyType propType, object oldValue, object newValue)
        {
            Properties.Add(new ChangeOperationItem(propName, propType, oldValue, newValue));
        }
    }

    /// <summary>
    /// Records the change of a single property within a <see cref="ChangeObjectOperation"/>,
    /// keeping its name, type and the old and new values for undo and redo.
    /// </summary>
    public class ChangeOperationItem
    {
        /// <summary>
        /// Creates a property change record with the property's name, type and its old and new values.
        /// </summary>
        /// <param name="propertyName">The name of the changed property.</param>
        /// <param name="propertyType">The data type of the property value.</param>
        /// <param name="oldValue">The value before the change.</param>
        /// <param name="newValue">The value after the change.</param>
        public ChangeOperationItem(string propertyName, PropertyType propertyType, object oldValue = null, object newValue = null)
        {
            PropertyName = propertyName;
            PropertyType = propertyType;
            OldValue = oldValue;
            NewValue = newValue;
        }

        /// <summary>
        /// Gets or sets the name of the changed property.
        /// </summary>
        public string PropertyName { get; set; }
        /// <summary>
        /// Gets or sets the data type of the property value.
        /// </summary>
        public PropertyType PropertyType { get; set; }
        /// <summary>
        /// Gets or sets the property value before the change, applied when undoing.
        /// </summary>
        public object OldValue { get; set; }
        /// <summary>
        /// Gets or sets the property value after the change, applied when redoing.
        /// </summary>
        public object NewValue { get; set; }
    }

    /// <summary>
    /// Identifies the data type of a property value tracked in an undo/redo operation,
    /// used to convert the stored value back to the correct type when applied.
    /// </summary>
    public enum PropertyType
    {
        /// <summary>An integer value.</summary>
        Integer = 1,
        /// <summary>A floating-point number value.</summary>
        Number = 2,
        /// <summary>A text string value.</summary>
        String = 3,
        /// <summary>A date/time value.</summary>
        Date = 4,
        /// <summary>A binary (byte array) value.</summary>
        Binary = 5,
        /// <summary>A boolean value.</summary>
        Boolean = 6,
        /// <summary>A variant value whose concrete type is resolved at runtime.</summary>
        Variant = 7,
        /// <summary>A list of strings.</summary>
        StringArray = 8
    }

    /// <summary>
    /// The kind of edit recorded by a <see cref="ChangeObjectOperation"/>: adding, modifying,
    /// removing, reordering (swap up/down) or renaming a report component.
    /// </summary>
    public enum OperationType
    {
        /// <summary>A component was added to the report.</summary>
        Add,
        /// <summary>One or more properties of a component were changed.</summary>
        Modify,
        /// <summary>A component was removed from the report.</summary>
        Remove,
        /// <summary>A component was moved down within its parent collection.</summary>
        SwapDown,
        /// <summary>A component was moved up within its parent collection.</summary>
        SwapUp,
        /// <summary>A component was renamed.</summary>
        Rename
    }
}
