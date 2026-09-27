using System;
using System.Collections.Generic;
using System.Globalization;
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
        /// Name of the property of a <see cref="OperationType.SwapUp"/>/<see cref="OperationType.SwapDown"/>
        /// operation that moves a component to an arbitrary position of its section (bring to front /
        /// send to back): its old and new values are the positions before and after the move. Swap
        /// operations without it are adjacent swaps at <see cref="ChangeObjectOperation.OldItemIndex"/>.
        /// </summary>
        public const string ItemIndexProperty = "itemIndex";

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
        /// to the redo stack. An operation is moved only after it has been applied: if one fails, the
        /// exception propagates, that operation stays the next one to undo and the ones of the group
        /// already undone are in the redo stack, so both stacks still match the report.
        /// </summary>
        /// <param name="report">The report to revert the operations on.</param>
        /// <returns>The list of operations that were undone, or <c>null</c> if there was nothing to undo.</returns>
        public List<ChangeObjectOperation> Undo(Report report)
        {
            if (UndoOperations.Count == 0) return null;

            var operations = new List<ChangeObjectOperation>();
            try
            {
                int gId = UndoOperations[UndoOperations.Count - 1].GroupId;
                while (UndoOperations.Count > 0 && UndoOperations[UndoOperations.Count - 1].GroupId == gId)
                {
                    var op = UndoOperations[UndoOperations.Count - 1];
                    try
                    {
                        ApplyOperation(op, true, report);
                    }
                    catch (Exception ex)
                    {
                        throw new InvalidOperationException("UndoCue: undo of " + OperationDescription(op) +
                            " failed: " + ex.Message, ex);
                    }
                    // Undone: move it to the redo stack
                    UndoOperations.RemoveAt(UndoOperations.Count - 1);
                    RedoOperations.Add(op);
                    operations.Add(op);
                }
            }
            finally
            {
                // Also after a failure: the operations already undone changed the report
                report.Modified = true;
            }

            return operations;
        }

        /// <summary>
        /// Reapplies the most recent group of undone operations, restoring them on the report and
        /// moving them back to the undo stack. An operation is moved only after it has been applied:
        /// if one fails, the exception propagates and that operation stays the next one to redo.
        /// </summary>
        /// <param name="report">The report to reapply the operations on.</param>
        /// <returns>The list of operations that were redone, or <c>null</c> if there was nothing to redo.</returns>
        public List<ChangeObjectOperation> Redo(Report report)
        {
            if (RedoOperations.Count == 0) return null;

            var operations = new List<ChangeObjectOperation>();
            try
            {
                int gId = RedoOperations[RedoOperations.Count - 1].GroupId;
                while (RedoOperations.Count > 0 && RedoOperations[RedoOperations.Count - 1].GroupId == gId)
                {
                    var op = RedoOperations[RedoOperations.Count - 1];
                    try
                    {
                        ApplyOperation(op, false, report);
                    }
                    catch (Exception ex)
                    {
                        throw new InvalidOperationException("UndoCue: redo of " + OperationDescription(op) +
                            " failed: " + ex.Message, ex);
                    }
                    // Redone: move it back to the undo stack
                    RedoOperations.RemoveAt(RedoOperations.Count - 1);
                    UndoOperations.Add(op);
                    operations.Add(op);
                }
            }
            finally
            {
                // Also after a failure: the operations already redone changed the report
                report.Modified = true;
            }

            return operations;
        }

        private static string OperationDescription(ChangeObjectOperation operation)
        {
            return operation.Operation.ToString() + " " + operation.ComponentClass + " " + operation.ComponentName;
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

        private Section GetParentSection(string parentName, Report report)
        {
            if (string.IsNullOrEmpty(parentName))
                throw new InvalidOperationException("UndoCue: parent section name required");
            var section = GetComponentByName(parentName, report) as Section;
            if (section == null)
                throw new InvalidOperationException("UndoCue: parent is not a section: " + parentName);
            return section;
        }

        private static void CheckSwapRange(string className, int oldIndex, int increment, int count)
        {
            if (oldIndex < 0 || oldIndex >= count || oldIndex + increment < 0 || oldIndex + increment >= count)
                throw new InvalidOperationException("UndoCue: swap of " + className + " from " +
                    oldIndex.ToString(CultureInfo.InvariantCulture) + " to " +
                    (oldIndex + increment).ToString(CultureInfo.InvariantCulture) + " out of range (count " +
                    count.ToString(CultureInfo.InvariantCulture) + ")");
        }

        private void ApplySwapOperation(string className, bool down, int oldIndex, Report report, string parentName = null)
        {
            int increment = down ? 1 : -1;
            // determine array
            switch (className)
            {
                case "TRPSUBREPORT":
                    CheckSwapRange(className, oldIndex, increment, report.SubReports.Count);
                    report.SubReports.Swap(oldIndex, oldIndex + increment);
                    break;
                case "TRPSECTION":
                    {
                        if (string.IsNullOrEmpty(parentName))
                            throw new Exception("Parent name required for TRPSECTION swap.");
                        var subreport = GetComponentByName(parentName, report) as SubReport;
                        if (subreport == null)
                            throw new Exception("Parent subreport not found for swap: " + parentName);
                        CheckSwapRange(className, oldIndex, increment, subreport.Sections.Count);
                        subreport.Sections.Swap(oldIndex, oldIndex + increment);
                    }
                    break;
                case "TRPLABEL":
                case "TRPEXPRESSION":
                case "TRPSHAPE":
                case "TRPIMAGE":
                case "TRPBARCODE":
                case "TRPCHART":
                    {
                        // Component reordered inside its section (z-order)
                        var section = GetParentSection(parentName, report);
                        CheckSwapRange(className, oldIndex, increment, section.Components.Count);
                        section.Components.Swap(oldIndex, oldIndex + increment);
                    }
                    break;
                case "TRPPARAM":
                    CheckSwapRange(className, oldIndex, increment, report.Params.Count);
                    report.Params.Swap(oldIndex, oldIndex + increment);
                    break;
                case "TRPDATAINFOITEM":
                    CheckSwapRange(className, oldIndex, increment, report.DataInfo.Count);
                    report.DataInfo.Swap(oldIndex, oldIndex + increment);
                    break;
                case "TRPDATABASEINFOITEM":
                    CheckSwapRange(className, oldIndex, increment, report.DatabaseInfo.Count);
                    report.DatabaseInfo.Swap(oldIndex, oldIndex + increment);
                    break;
                default:
                    throw new Exception("Swap not supported for className: " + className);
            }
        }

        private static ChangeOperationItem FindOperationProperty(ChangeObjectOperation operation, string propName)
        {
            foreach (var prop in operation.Properties)
            {
                if (string.Equals(prop.PropertyName, propName, StringComparison.OrdinalIgnoreCase))
                    return prop;
            }
            return null;
        }

        private void ApplySwap(ChangeObjectOperation operation, bool isUndo, Report report)
        {
            var indexProp = FindOperationProperty(operation, ItemIndexProperty);
            if (indexProp != null)
            {
                // Bring to front / send to back: the component goes back to (undo) or again to
                // (redo) its recorded position
                MoveComponentToIndex(operation, isUndo ? indexProp.OldValue : indexProp.NewValue, report);
                return;
            }
            // Bring to front / send to back recorded without positions (histories saved by older
            // versions, old item index -1): nothing can be restored
            if (!operation.OldItemIndex.HasValue || operation.OldItemIndex.Value < 0)
                return;
            // Adjacent swap: exchanging the item at OldItemIndex with its neighbour is its own
            // inverse, undo and redo do the same
            ApplySwapOperation(operation.ComponentClass, operation.Operation == OperationType.SwapDown,
                operation.OldItemIndex.Value, report, operation.ParentName);
        }

        private void MoveComponentToIndex(ChangeObjectOperation operation, object newIndex, Report report)
        {
            if (newIndex == null)
                throw new InvalidOperationException("UndoCue: no position recorded for " + OperationDescription(operation));
            int targetIndex = Convert.ToInt32(newIndex, CultureInfo.InvariantCulture);
            var section = GetParentSection(operation.ParentName, report);
            var target = GetComponentByName(operation.ComponentName, report) as PrintPosItem;
            if (target == null)
                throw new InvalidOperationException("UndoCue: " + operation.ComponentName + " is not a section component");
            int currentIndex = section.Components.IndexOf(target);
            if (currentIndex < 0)
                throw new InvalidOperationException("UndoCue: " + operation.ComponentName + " not found in section " +
                    operation.ParentName);
            if (targetIndex < 0 || targetIndex >= section.Components.Count)
                throw new InvalidOperationException("UndoCue: position " + targetIndex.ToString(CultureInfo.InvariantCulture) +
                    " out of range for " + operation.ComponentName + " (count " +
                    section.Components.Count.ToString(CultureInfo.InvariantCulture) + ")");
            section.Components.RemoveAt(currentIndex);
            section.Components.Insert(targetIndex, target);
        }

        // Index where an undo/redo inserts a recreated item: an index out of range appends it
        private static int ResolveInsertIndex(int? index, int count)
        {
            int value = index ?? 0;
            if (value < 0 || value > count)
                return count;
            return value;
        }

        // Removes an item recreated by an operation that failed afterwards, so the report is left as
        // it was before the operation and it can be retried (no duplicated or renamed item)
        private static void DiscardItem(ReportItem target, Report report)
        {
            var printPosItem = target as PrintPosItem;
            var section = target as Section;
            if (printPosItem != null || section != null)
            {
                foreach (SubReport subreport in report.SubReports)
                {
                    if (section != null)
                        subreport.Sections.RemoveAll(candidate => candidate == section);
                    if (printPosItem != null)
                    {
                        foreach (Section candidateSection in subreport.Sections)
                            candidateSection.Components.RemoveAll(candidate => candidate == printPosItem);
                    }
                }
            }
            var subReport = target as SubReport;
            if (subReport != null)
                report.SubReports.Remove(subReport);
            var dataInfo = target as DataInfo;
            if (dataInfo != null)
                report.DataInfo.Remove(dataInfo);
            var databaseInfo = target as DatabaseInfo;
            if (databaseInfo != null)
                report.DatabaseInfo.Remove(databaseInfo);
            var param = target as Param;
            if (param != null)
            {
                int index = report.Params.IndexOf(param);
                if (index >= 0)
                    report.Params.RemoveAt(index);
            }
            for (int i = report.Components.Count - 1; i >= 0; i--)
            {
                if (report.Components.Values[i] == target)
                    report.Components.RemoveAt(i);
            }
        }

        private void ApplyOperation(ChangeObjectOperation operation, bool isUndo, Report report)
        {
            ReportItem created = null;
            try
            {
                ApplyOperationItems(operation, isUndo, report, ref created);
            }
            catch
            {
                // Leave the report as it was before this operation: an item recreated by it is
                // discarded, so the operation can be retried
                if (created != null)
                    DiscardItem(created, report);
                throw;
            }
        }

        private void ApplyOperationItems(ChangeObjectOperation operation, bool isUndo, Report report, ref ReportItem created)
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
                    ApplySwap(operation, isUndo, report);
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
                        // Undo remove must create the new element. It is assigned to created as
                        // soon as it exists: ApplyOperation discards it if anything fails. An index
                        // out of range appends it
                        ReportItem parentCompo = null;
                        if (!string.IsNullOrEmpty(operation.ParentName))
                        {
                            parentCompo = GetComponentByName(operation.ParentName, report);
                            if (!(parentCompo is Section) && !(parentCompo is SubReport))
                                throw new InvalidOperationException("UndoCue: parent " + operation.ParentName +
                                    " is not a section or a subreport");
                        }
                        target = BaseReport.NewComponentByClassName(operation.ComponentClass);
                        created = target;
                        target.Report = report;
                        target.Name = operation.ComponentName;
                        if (parentCompo != null)
                        {
                            if (parentCompo is Section)
                            {
                                var parentSec = (Section)parentCompo;
                                var printPosItem = target as PrintPosItem;
                                if (printPosItem == null)
                                    throw new InvalidOperationException("UndoCue: " + operation.ComponentClass +
                                        " can not be placed in section " + operation.ParentName);
                                printPosItem.Section = parentSec;
                                parentSec.Components.Insert(ResolveInsertIndex(operation.OldItemIndex, parentSec.Components.Count), printPosItem);
                            }
                            else
                            {
                                var parentSub = (SubReport)parentCompo;
                                var targetSection = target as Section;
                                if (targetSection == null)
                                    throw new InvalidOperationException("UndoCue: " + operation.ComponentClass +
                                        " can not be placed in subreport " + operation.ParentName);
                                targetSection.SubReport = parentSub;
                                parentSub.Sections.Insert(ResolveInsertIndex(operation.OldItemIndex, parentSub.Sections.Count), targetSection);
                            }
                        }
                        else
                        {
                            // Add to report element array
                            switch (target.ClassName)
                            {
                                case "TRPDATAINFOITEM":
                                    report.DataInfo.Insert(ResolveInsertIndex(operation.OldItemIndex, report.DataInfo.Count), (DataInfo)target);
                                    break;
                                case "TRPDATABASEINFOITEM":
                                    report.DatabaseInfo.Insert(ResolveInsertIndex(operation.OldItemIndex, report.DatabaseInfo.Count), (DatabaseInfo)target);
                                    break;
                                case "TRPPARAM":
                                    report.Params.Insert(ResolveInsertIndex(operation.OldItemIndex, report.Params.Count), (Param)target);
                                    break;
                                case "TRPSUBREPORT":
                                    report.SubReports.Insert(ResolveInsertIndex(operation.OldItemIndex, report.SubReports.Count), (SubReport)target);
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
                    // Redo add = re-create (assigned to created as soon as it exists, see the undo
                    // of Remove)
                    target = BaseReport.NewComponentByClassName(operation.ComponentClass);
                    created = target;
                    target.Report = report;
                    target.Name = operation.ComponentName;
                    report.Components[target.Name] = target;
                    if (parentSection != null)
                    {
                        var targetPrintPosItem = target as PrintPosItem;
                        if (targetPrintPosItem == null)
                            throw new InvalidOperationException("UndoCue: " + operation.ComponentClass +
                                " can not be placed in section " + operation.ParentName);
                        parentSection.Components.Insert(ResolveInsertIndex(operation.OldItemIndex, parentSection.Components.Count), targetPrintPosItem);
                    }
                    else
                    {
                        if (parentSubreport != null)
                        {
                            var targetSection = target as Section;
                            if (targetSection == null)
                                throw new InvalidOperationException("UndoCue: " + operation.ComponentClass +
                                    " can not be placed in subreport " + operation.ParentName);
                            parentSubreport.Sections.Insert(ResolveInsertIndex(operation.OldItemIndex, parentSubreport.Sections.Count), targetSection);
                        }
                        else
                        {
                            switch (target.ClassName)
                            {
                                case "TRPPARAM":
                                    report.Params.Insert(ResolveInsertIndex(operation.OldItemIndex, report.Params.Count), (Param)target);
                                    break;
                                case "TRPDATAINFOITEM":
                                    report.DataInfo.Insert(ResolveInsertIndex(operation.OldItemIndex, report.DataInfo.Count), (DataInfo)target);
                                    break;
                                case "TRPDATABASEINFOITEM":
                                    report.DatabaseInfo.Insert(ResolveInsertIndex(operation.OldItemIndex, report.DatabaseInfo.Count), (DatabaseInfo)target);
                                    break;
                                case "TRPSUBREPORT":
                                    report.SubReports.Insert(ResolveInsertIndex(operation.OldItemIndex, report.SubReports.Count), (SubReport)target);
                                    break;
                                default:
                                    throw new Exception("Class not found: " + target.ClassName);
                            }
                        }
                    }
                }
            }

            // Parent change (move between sections). Deletes recorded by older versions set the old
            // parent equal to the parent: that is not a move, and moving the recreated component
            // would append it at the end of its section (reversed order)
            if (!string.IsNullOrEmpty(operation.ParentName) && !string.IsNullOrEmpty(operation.OldParentName) &&
                !string.Equals(operation.ParentName, operation.OldParentName, StringComparison.OrdinalIgnoreCase))
            {
                var newParentName = isUndo ? operation.OldParentName : operation.ParentName;
                var oldParentName = isUndo ? operation.ParentName : operation.OldParentName;
                var oldParentSection = GetComponentByName(oldParentName, report) as Section;
                var newParentSection = GetComponentByName(newParentName, report) as Section;
                if (oldParentSection == null || newParentSection == null) throw new Exception("Can not undo/redo");
                var movedItem = target as PrintPosItem;
                var indexOld = movedItem == null ? -1 : oldParentSection.Components.IndexOf(movedItem);
                if (indexOld < 0) throw new Exception("Component not found");
                oldParentSection.Components.RemoveAt(indexOld);
                newParentSection.Components.Add(movedItem);
                movedItem.Section = newParentSection;
            }

            ApplyPropertiesToObject(operation, (ReportItem)target, isUndo);
        }

        /// <summary>
        /// Applies the recorded property changes of an operation to the given report item, using the
        /// old values when undoing and the new values when redoing, by reflection over properties and fields.
        /// A value that can not be converted to the type of its member is skipped: histories saved by
        /// older designers may hold the text or units shown by the inspector instead of the model value.
        /// </summary>
        /// <param name="operation">The operation whose property changes are applied.</param>
        /// <param name="item">The report item to modify.</param>
        /// <param name="isUndo"><c>true</c> to apply the old values (undo); <c>false</c> to apply the new values (redo).</param>
        public void ApplyPropertiesToObject(ChangeObjectOperation operation, ReportItem item, bool isUndo)
        {
            var itemType = item.GetType();
            foreach (var prop in operation.Properties)
            {
                object value;
                if (isUndo && operation.Operation != OperationType.Remove)
                {
                    value = prop.OldValue;
                }
                else
                {
                    value = prop.NewValue;
                    // Remove keeps the removed values in NewValue, but some recorders (and the
                    // histories they saved in .rep files) put them in OldValue: without this
                    // fallback the item would be recreated empty
                    if (operation.Operation == OperationType.Remove && value == null)
                        value = prop.OldValue;
                }
                var propName = prop.PropertyName;
                if (string.IsNullOrEmpty(propName))
                    continue;
                object converted;
                // Try to set as property first
                var pi = FindUndoProperty(itemType, propName);
                if (pi != null && pi.CanWrite && TryConvertUndoValue(value, pi.PropertyType, out converted))
                {
                    try
                    {
                        pi.SetValue(item, converted);
                        continue;
                    }
                    catch
                    {
                        // ignore the error and try field
                    }
                }

                // Try to set as field. A property or field that is not found is ignored
                var fi = FindUndoField(itemType, propName);
                if (fi != null && !fi.IsInitOnly && TryConvertUndoValue(value, fi.FieldType, out converted))
                {
                    try
                    {
                        fi.SetValue(item, converted);
                    }
                    catch
                    {
                        // ignore the value, as for properties
                    }
                }
            }
        }

        // Public instance property by name, ignoring case: an exact match first, then the one
        // declared by the most derived type (a property hidden with "new" is not ambiguous)
        private static PropertyInfo FindUndoProperty(Type type, string name)
        {
            PropertyInfo found = null;
            foreach (var candidate in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                if (candidate.GetIndexParameters().Length > 0)
                    continue;
                if (!string.Equals(candidate.Name, name, StringComparison.OrdinalIgnoreCase))
                    continue;
                if (found == null)
                {
                    found = candidate;
                    continue;
                }
                bool candidateExact = string.Equals(candidate.Name, name, StringComparison.Ordinal);
                bool foundExact = string.Equals(found.Name, name, StringComparison.Ordinal);
                if ((candidateExact && !foundExact) ||
                    (candidateExact == foundExact && found.DeclaringType.IsAssignableFrom(candidate.DeclaringType)))
                    found = candidate;
            }
            return found;
        }

        private static FieldInfo FindUndoField(Type type, string name)
        {
            FieldInfo found = null;
            foreach (var candidate in type.GetFields(BindingFlags.Public | BindingFlags.Instance))
            {
                if (!string.Equals(candidate.Name, name, StringComparison.OrdinalIgnoreCase))
                    continue;
                if (found == null || string.Equals(candidate.Name, name, StringComparison.Ordinal))
                    found = candidate;
            }
            return found;
        }

        private static bool IsIntegralType(Type type)
        {
            return type.IsEnum || type == typeof(int) || type == typeof(long) || type == typeof(short) ||
                type == typeof(byte) || type == typeof(sbyte) || type == typeof(uint) || type == typeof(ulong) ||
                type == typeof(ushort);
        }

        private static bool IsFractionalNumber(object value)
        {
            if (value is double)
            {
                double d = (double)value;
                return !double.IsNaN(d) && !double.IsInfinity(d) && Math.Floor(d) != d;
            }
            if (value is float)
            {
                float f = (float)value;
                return !float.IsNaN(f) && !float.IsInfinity(f) && Math.Floor(f) != f;
            }
            if (value is decimal)
            {
                decimal m = (decimal)value;
                return decimal.Truncate(m) != m;
            }
            return false;
        }

        // Converts an undo value to the type of the member that receives it. Returns false when it
        // can not be converted, so the value is skipped instead of storing a wrong one: a null for a
        // value type (older inspectors recorded null when a multiple selection had different values),
        // a fractional number for an integer (units shown by the inspector, e.g. 2.54 cm for a width
        // in twips) or a text that does not parse ("Left", "2.540").
        private static bool TryConvertUndoValue(object value, Type targetType, out object converted)
        {
            converted = null;
            if (value == null)
                return !targetType.IsValueType || Nullable.GetUnderlyingType(targetType) != null;
            if (IsIntegralType(targetType) && IsFractionalNumber(value))
                return false;
            converted = ChangeTypeSafely(value, targetType);
            if (converted == null)
                return !targetType.IsValueType || Nullable.GetUnderlyingType(targetType) != null;
            return targetType.IsInstanceOfType(converted);
        }

        private static object ChangeTypeSafely(object value, Type targetType)
        {
            if (value == null) return null;

            var valueType = value.GetType();

            // A copy: sharing the recorded list with the item would let later edits of the item
            // change the value recorded in the operation
            if (targetType == typeof(Strings) && value is Strings)
                return ((Strings)value).Clone();

            // A Variant saved in the report history (json) is read back as an object with its
            // type and value
            if (targetType == typeof(Variant) && value is Newtonsoft.Json.Linq.JObject)
            {
                try
                {
                    return ((Newtonsoft.Json.Linq.JObject)value).ToObject<Variant>();
                }
                catch
                {
                    // fall back to the generic conversion
                }
            }

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
