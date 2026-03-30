using System.Collections.Generic;
using Reportman.Reporting;

namespace Reportman.Reporting.Design
{
    public class ReportStructureContextNode
    {
        public string Name { get; set; }
        public string ClassName { get; set; }
        public string ParentName { get; set; }
        public List<ReportStructureContextNode> Children { get; } = new List<ReportStructureContextNode>();
    }

    public class ReportStructureContext
    {
        public ReportStructureContextNode Root { get; set; }
    }

    public static class ReportStructureContextBuilder
    {
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