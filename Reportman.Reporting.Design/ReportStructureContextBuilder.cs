using System.Collections.Generic;
using Reportman.Reporting;

namespace Reportman.Reporting.Design
{
    /// <summary>
    /// A single node in the tree that mirrors a report's structure, holding the
    /// element's name, class name and parent name plus its child nodes.
    /// </summary>
    public class ReportStructureContextNode
    {
        /// <summary>
        /// Gets or sets the name of the report component/element.
        /// </summary>
        public string Name { get; set; }
        /// <summary>
        /// Gets or sets the C# type class name of the report component/element.
        /// </summary>
        public string ClassName { get; set; }
        /// <summary>
        /// Gets or sets the name of the parent element containing this node.
        /// </summary>
        public string ParentName { get; set; }
        /// <summary>
        /// Gets the collection of child structure nodes.
        /// </summary>
        public List<ReportStructureContextNode> Children { get; } = new List<ReportStructureContextNode>();
    }

    /// <summary>
    /// Container for a report's structure tree, exposing the root node from which
    /// the full hierarchy of params, datasets, subreports and sections is reachable.
    /// </summary>
    public class ReportStructureContext
    {
        /// <summary>
        /// Gets or sets the root node representing the top-level report.
        /// </summary>
        public ReportStructureContextNode Root { get; set; }
    }

    /// <summary>
    /// Builds a <see cref="ReportStructureContext"/> tree from a report, walking its
    /// params, database and data infos, subreports, sections and components.
    /// </summary>
    public static class ReportStructureContextBuilder
    {
        /// <summary>
        /// Traverses the report definition and returns a tree of its elements and components.
        /// </summary>
        /// <param name="report">The report to analyze.</param>
        /// <returns>A built ReportStructureContext containing the tree hierarchy.</returns>
        public static ReportStructureContext Build(Report report)
        {
            var root = new ReportStructureContextNode
            {
                Name = "REPORT",
                ClassName = "REPORT"
            };

            foreach (Param parameter in report.Params)
            {
                root.Children.Add(new ReportStructureContextNode
                {
                    Name = parameter.Name,
                    ClassName = parameter.ClassName,
                    ParentName = root.Name
                });
            }

            foreach (DatabaseInfo databaseInfo in report.DatabaseInfo)
            {
                root.Children.Add(new ReportStructureContextNode
                {
                    Name = databaseInfo.Name,
                    ClassName = databaseInfo.ClassName,
                    ParentName = root.Name
                });
            }

            foreach (DataInfo dataInfo in report.DataInfo)
            {
                root.Children.Add(new ReportStructureContextNode
                {
                    Name = dataInfo.Name,
                    ClassName = dataInfo.ClassName,
                    ParentName = root.Name
                });
            }

            foreach (SubReport subReport in report.SubReports)
            {
                var subReportNode = new ReportStructureContextNode
                {
                    Name = subReport.Name,
                    ClassName = subReport.ClassName,
                    ParentName = root.Name
                };

                foreach (Section section in subReport.Sections)
                {
                    var sectionNode = new ReportStructureContextNode
                    {
                        Name = section.Name,
                        ClassName = section.ClassName,
                        ParentName = subReport.Name
                    };

                    foreach (PrintPosItem component in section.Components)
                    {
                        sectionNode.Children.Add(new ReportStructureContextNode
                        {
                            Name = component.Name,
                            ClassName = component.ClassName,
                            ParentName = section.Name
                        });
                    }

                    subReportNode.Children.Add(sectionNode);
                }

                root.Children.Add(subReportNode);
            }

            return new ReportStructureContext
            {
                Root = root
            };
        }
    }
}