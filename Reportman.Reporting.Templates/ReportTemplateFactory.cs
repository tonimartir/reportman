using System;
using Reportman.Drawing;
using Reportman.Reporting;
using Reportman.Reporting.Design;

namespace Reportman.Reporting.Templates
{
    public static class ReportTemplateFactory
    {
        private const string GroupName = "GROUP_CITY";
        private const string ConnectionAlias = "MAINCONNECTION";
        private const string DatasetAlias = "SALES";
        private const string ConnectionName = "TRPDATABASEINFOITEM1";
        private const string DataInfoName = "TRPDATAINFOITEM1";
        private const string SubReportName = "TRPSUBREPORT1";
        private const string DetailSectionName = "TRPSECTION1";
        private const string GroupHeaderSectionName = "TRPSECTION2";
        private const string GroupFooterSectionName = "TRPSECTION3";

        public static Report CreateBlankReport()
        {
            var report = new Report();
            report.CreateNew();
            report.UndoCue = new UndoCue();
            report.EnsureComponentNames();
            return report;
        }

        public static Report CreateGroupedReport()
        {
            var report = CreateBlankReport();
            var subReport = report.SubReports[0];
            subReport.Alias = DatasetAlias;

            var connection = AddDatabaseInfo(report);
            var dataInfo = AddDataInfo(report, connection);
            subReport.Alias = dataInfo.Alias;

            var detailSection = subReport.Sections[subReport.FirstDetail];
            detailSection.Height = 520;

            var groupHeader = subReport.AddGroup(GroupName);
            var groupFooter = FindGroupFooter(subReport, GroupName);
            groupHeader.ChangeExpression = DatasetAlias + ".CITY";
            groupHeader.Height = 720;
            groupFooter.Height = 720;

            AddGroupHeaderComponents(report, groupHeader);
            AddDetailComponents(report, detailSection);
            AddGroupFooterComponents(report, groupFooter);

            report.EnsureComponentNames();
            return report;
        }

        public static Report CreateGroupedReportUsingDesign()
        {
            var report = new Report();
            var editor = new ReportBatchEditor();

            Apply(editor, report, new ReportBatchOperation
            {
                Type = ReportBatchOperationType.CreateNewReport,
                OperationId = "create-new"
            });

            Apply(editor, report,
                Modify(SubReportName, "subreport-alias", new ReportBatchProperty { PropertyName = "Alias", Value = DatasetAlias }),
                Modify(DetailSectionName, "detail-height", new ReportBatchProperty { PropertyName = "Height", Value = 520 }),
                AddTopLevel("add-connection", ConnectionName, "TRPDATABASEINFOITEM",
                    new ReportBatchProperty { PropertyName = "Alias", Value = ConnectionAlias },
                    new ReportBatchProperty { PropertyName = "Driver", Value = DriverType.DotNet2 },
                    new ReportBatchProperty { PropertyName = "ProviderFactory", Value = "System.Data.SqlClient" },
                    new ReportBatchProperty { PropertyName = "ConnectionString", Value = "Server=(local);Database=NorthwindDemo;Trusted_Connection=True;" }),
                AddTopLevel("add-dataset", DataInfoName, "TRPDATAINFOITEM",
                    new ReportBatchProperty { PropertyName = "Alias", Value = DatasetAlias },
                    new ReportBatchProperty { PropertyName = "DatabaseAlias", Value = ConnectionAlias },
                    new ReportBatchProperty { PropertyName = "SQL", Value = "select City, CustomerName, OrderDate, TotalAmount from Sales order by City, CustomerName" }),
                AddSection("add-group-header", GroupHeaderSectionName, SubReportName, 0,
                    new ReportBatchProperty { PropertyName = "SectionType", Value = SectionType.GroupHeader },
                    new ReportBatchProperty { PropertyName = "GroupName", Value = GroupName },
                    new ReportBatchProperty { PropertyName = "ChangeExpression", Value = DatasetAlias + ".CITY" },
                    new ReportBatchProperty { PropertyName = "Height", Value = 720 }),
                AddSection("add-group-footer", GroupFooterSectionName, SubReportName, 2,
                    new ReportBatchProperty { PropertyName = "SectionType", Value = SectionType.GroupFooter },
                    new ReportBatchProperty { PropertyName = "GroupName", Value = GroupName },
                    new ReportBatchProperty { PropertyName = "Height", Value = 720 }));

            Apply(editor, report,
                AddLabelOperation("header-label-city", "TRPLABEL1", GroupHeaderSectionName, 120, 120, 1800, 320, "City"),
                AddExpressionOperation("header-expression-city", "TRPEXPRESSION1", GroupHeaderSectionName, 2040, 120, 3200, 320, DatasetAlias + ".CITY"),
                AddLabelOperation("header-label-title", "TRPLABEL2", GroupHeaderSectionName, 120, 420, 2200, 220, "Grouped report template"),
                AddExpressionOperation("detail-expression-customer", "TRPEXPRESSION2", DetailSectionName, 120, 100, 4800, 280, DatasetAlias + ".CUSTOMERNAME"),
                AddExpressionOperation("detail-expression-amount", "TRPEXPRESSION3", DetailSectionName, 5100, 100, 1800, 280, DatasetAlias + ".TOTALAMOUNT",
                    new ReportBatchProperty { PropertyName = "Alignment", Value = TextAlignType.Right },
                    new ReportBatchProperty { PropertyName = "DisplayFormat", Value = "#,##0.00" },
                    new ReportBatchProperty { PropertyName = "DataType", Value = ParamType.Double }));

            Apply(editor, report,
                AddLabelOperation("footer-label-rows", "TRPLABEL3", GroupFooterSectionName, 120, 120, 1800, 280, "Rows"),
                AddExpressionOperation("footer-expression-count", "TRPEXPRESSION4", GroupFooterSectionName, 2040, 120, 1200, 280, "1",
                    new ReportBatchProperty { PropertyName = "Aggregate", Value = Aggregate.Group },
                    new ReportBatchProperty { PropertyName = "GroupName", Value = GroupName },
                    new ReportBatchProperty { PropertyName = "AgType", Value = AggregateType.Summary },
                    new ReportBatchProperty { PropertyName = "Alignment", Value = TextAlignType.Right },
                    new ReportBatchProperty { PropertyName = "DataType", Value = ParamType.Integer }),
                AddLabelOperation("footer-label-total", "TRPLABEL4", GroupFooterSectionName, 3720, 120, 1800, 280, "Total amount"),
                AddExpressionOperation("footer-expression-sum", "TRPEXPRESSION5", GroupFooterSectionName, 5580, 120, 1800, 280, DatasetAlias + ".TOTALAMOUNT",
                    new ReportBatchProperty { PropertyName = "Aggregate", Value = Aggregate.Group },
                    new ReportBatchProperty { PropertyName = "GroupName", Value = GroupName },
                    new ReportBatchProperty { PropertyName = "AgType", Value = AggregateType.Summary },
                    new ReportBatchProperty { PropertyName = "Alignment", Value = TextAlignType.Right },
                    new ReportBatchProperty { PropertyName = "DisplayFormat", Value = "#,##0.00" },
                    new ReportBatchProperty { PropertyName = "DataType", Value = ParamType.Double }));

            NormalizeDesignBuiltTemplate(report);
            report.EnsureComponentNames();
            return report;
        }

        public static bool GroupedTemplatesAreEquivalent()
        {
            return ReportsAreEquivalent(CreateGroupedReport(), CreateGroupedReportUsingDesign());
        }

        private static DatabaseInfo AddDatabaseInfo(Report report)
        {
            var nameProbe = new DatabaseInfo();
            nameProbe.Report = report;
            var databaseInfo = new DatabaseInfo
            {
                Report = report,
                Alias = ConnectionAlias,
                Driver = DriverType.DotNet2,
                ProviderFactory = "System.Data.SqlClient",
                ConnectionString = "Server=(local);Database=NorthwindDemo;Trusted_Connection=True;",
                Name = report.FindNewName(nameProbe)
            };

            report.DatabaseInfo.Add(databaseInfo);
            report.AddComponent(databaseInfo);
            return databaseInfo;
        }

        private static DataInfo AddDataInfo(Report report, DatabaseInfo databaseInfo)
        {
            var nameProbe = new DataInfo();
            nameProbe.Report = report;
            var dataInfo = new DataInfo
            {
                Report = report,
                Alias = DatasetAlias,
                DatabaseAlias = databaseInfo.Alias,
                SQL = "select City, CustomerName, OrderDate, TotalAmount from Sales order by City, CustomerName",
                Name = report.FindNewName(nameProbe)
            };

            report.DataInfo.Add(dataInfo);
            report.AddComponent(dataInfo);
            return dataInfo;
        }

        private static Section FindGroupFooter(SubReport subReport, string groupName)
        {
            foreach (Section section in subReport.Sections)
            {
                if (section.SectionType == SectionType.GroupFooter && string.Equals(section.GroupName, groupName, StringComparison.OrdinalIgnoreCase))
                {
                    return section;
                }
            }

            throw new InvalidOperationException("Group footer not found for group '" + groupName + "'.");
        }

        private static void AddGroupHeaderComponents(Report report, Section groupHeader)
        {
            AddLabel(report, groupHeader, 120, 120, 1800, 320, "City");
            AddExpression(report, groupHeader, 2040, 120, 3200, 320, DatasetAlias + ".CITY");
            AddLabel(report, groupHeader, 120, 420, 2200, 220, "Grouped report template");
        }

        private static void AddDetailComponents(Report report, Section detailSection)
        {
            AddExpression(report, detailSection, 120, 100, 4800, 280, DatasetAlias + ".CUSTOMERNAME");

            var amount = AddExpression(report, detailSection, 5100, 100, 1800, 280, DatasetAlias + ".TOTALAMOUNT");
            amount.Alignment = TextAlignType.Right;
            amount.DisplayFormat = "#,##0.00";
            amount.DataType = ParamType.Double;
        }

        private static void AddGroupFooterComponents(Report report, Section groupFooter)
        {
            AddLabel(report, groupFooter, 120, 120, 1800, 280, "Rows");
            var countExpression = AddExpression(report, groupFooter, 2040, 120, 1200, 280, "1");
            countExpression.Aggregate = Aggregate.Group;
            countExpression.GroupName = GroupName;
            countExpression.AgType = AggregateType.Summary;
            countExpression.Alignment = TextAlignType.Right;
            countExpression.DataType = ParamType.Integer;

            AddLabel(report, groupFooter, 3720, 120, 1800, 280, "Total amount");
            var sumExpression = AddExpression(report, groupFooter, 5580, 120, 1800, 280, DatasetAlias + ".TOTALAMOUNT");
            sumExpression.Aggregate = Aggregate.Group;
            sumExpression.GroupName = GroupName;
            sumExpression.AgType = AggregateType.Summary;
            sumExpression.Alignment = TextAlignType.Right;
            sumExpression.DisplayFormat = "#,##0.00";
            sumExpression.DataType = ParamType.Double;
        }

        private static LabelItem AddLabel(Report report, Section section, int left, int top, int width, int height, string text)
        {
            var label = new LabelItem();
            ConfigureTextItem(report, section, label, left, top, width, height);
            label.Text = text;
            section.Components.Add(label);
            return label;
        }

        private static ExpressionItem AddExpression(Report report, Section section, int left, int top, int width, int height, string expression)
        {
            var expressionItem = new ExpressionItem();
            ConfigureTextItem(report, section, expressionItem, left, top, width, height);
            expressionItem.Expression = expression;
            section.Components.Add(expressionItem);
            return expressionItem;
        }

        private static void ConfigureTextItem(Report report, Section section, PrintItemText item, int left, int top, int width, int height)
        {
            item.Report = report;
            item.Section = section;
            item.PosX = left;
            item.PosY = top;
            item.Width = width;
            item.Height = height;
            item.Transparent = true;
            item.WordWrap = false;
            item.VAlignment = TextAlignVerticalType.Center;
            report.GenerateNewName(item);
        }

        private static void Apply(ReportBatchEditor editor, Report report, params ReportBatchOperation[] operations)
        {
            var result = editor.Apply(report, operations);
            if (result.Issues.Count > 0)
            {
                throw new InvalidOperationException(result.Issues[0].Message);
            }
        }

        private static ReportBatchOperation Modify(string targetName, string operationId, params ReportBatchProperty[] properties)
        {
            return new ReportBatchOperation
            {
                OperationId = operationId,
                Type = ReportBatchOperationType.ModifyProperties,
                TargetName = targetName,
                Properties = CreatePropertyList(properties)
            };
        }

        private static ReportBatchOperation AddTopLevel(string operationId, string targetName, string objectClass, params ReportBatchProperty[] properties)
        {
            return new ReportBatchOperation
            {
                OperationId = operationId,
                Type = ReportBatchOperationType.AddObject,
                TargetName = targetName,
                ObjectClass = objectClass,
                Properties = CreatePropertyList(properties)
            };
        }

        private static ReportBatchOperation AddSection(string operationId, string targetName, string parentName, int insertIndex, params ReportBatchProperty[] properties)
        {
            return new ReportBatchOperation
            {
                OperationId = operationId,
                Type = ReportBatchOperationType.AddObject,
                TargetName = targetName,
                ObjectClass = "TRPSECTION",
                ParentName = parentName,
                InsertIndex = insertIndex,
                Properties = CreatePropertyList(properties)
            };
        }

        private static ReportBatchOperation AddLabelOperation(string operationId, string targetName, string parentName, int left, int top, int width, int height, string text)
        {
            return new ReportBatchOperation
            {
                OperationId = operationId,
                Type = ReportBatchOperationType.AddObject,
                TargetName = targetName,
                ObjectClass = "TRPLABEL",
                ParentName = parentName,
                Properties = CreatePropertyList(
                    CreateTextItemProperties(left, top, width, height),
                    new[] { new ReportBatchProperty { PropertyName = "Text", Value = text } })
            };
        }

        private static ReportBatchOperation AddExpressionOperation(string operationId, string targetName, string parentName, int left, int top, int width, int height, string expression, params ReportBatchProperty[] extraProperties)
        {
            return new ReportBatchOperation
            {
                OperationId = operationId,
                Type = ReportBatchOperationType.AddObject,
                TargetName = targetName,
                ObjectClass = "TRPEXPRESSION",
                ParentName = parentName,
                Properties = CreatePropertyList(
                    CreateTextItemProperties(left, top, width, height),
                    new[] { new ReportBatchProperty { PropertyName = "Expression", Value = expression } },
                    extraProperties)
            };
        }

        private static ReportBatchProperty[] CreateTextItemProperties(int left, int top, int width, int height)
        {
            return new[]
            {
                new ReportBatchProperty { PropertyName = "PosX", Value = left },
                new ReportBatchProperty { PropertyName = "PosY", Value = top },
                new ReportBatchProperty { PropertyName = "Width", Value = width },
                new ReportBatchProperty { PropertyName = "Height", Value = height },
                new ReportBatchProperty { PropertyName = "Transparent", Value = true },
                new ReportBatchProperty { PropertyName = "WordWrap", Value = false },
                new ReportBatchProperty { PropertyName = "VAlignment", Value = TextAlignVerticalType.Center }
            };
        }

        private static System.Collections.Generic.List<ReportBatchProperty> CreatePropertyList(params ReportBatchProperty[][] propertyGroups)
        {
            var properties = new System.Collections.Generic.List<ReportBatchProperty>();
            foreach (var group in propertyGroups)
            {
                if (group == null)
                    continue;

                foreach (var property in group)
                {
                    if (property != null)
                    {
                        properties.Add(property);
                    }
                }
            }
            return properties;
        }

        private static bool ReportsAreEquivalent(Report left, Report right)
        {
            using (var leftStream = new System.IO.MemoryStream())
            using (var rightStream = new System.IO.MemoryStream())
            {
                left.SaveToStream(leftStream, StreamVersion.V2);
                right.SaveToStream(rightStream, StreamVersion.V2);
                return StreamUtil.CompareArrayContent(leftStream.ToArray(), rightStream.ToArray());
            }
        }

        private static void NormalizeDesignBuiltTemplate(Report report)
        {
            report.Modified = false;
            report.UndoCue = new UndoCue();

            foreach (SubReport subReport in report.SubReports)
            {
                foreach (Section section in subReport.Sections)
                {
                    section.SubReportName = "";
                }
            }
        }
    }
}