using System;
using Reportman.Drawing;
using Reportman.Reporting;

namespace Reportman.Reporting.Templates
{
    public static class ReportTemplateFactory
    {
        private const string GroupName = "GROUP_CITY";
        private const string ConnectionAlias = "MAINCONNECTION";
        private const string DatasetAlias = "SALES";

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
    }
}