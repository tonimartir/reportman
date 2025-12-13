using ClosedXML.Excel;
using System;
using System.Collections.Generic;
using System.Data;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Reportman.Drawing.Excel
{
    public static class Helper
    {
        public static MemoryStream DataTablesToExcel(List<DataTable> dataTables)
        {
            var stream = new MemoryStream();
            using (var workbook = new XLWorkbook())
            {
                foreach (var table in dataTables)
                {
                    workbook.Worksheets.Add(table, table.TableName);
                }

                workbook.SaveAs(stream);
                stream.Position = 0;
            }
            return stream;
        }
    }
}
