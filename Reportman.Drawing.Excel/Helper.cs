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
    /// <summary>
    /// Helper utilities for exporting tabular report data to Excel, writing each
    /// <see cref="System.Data.DataTable"/> as a worksheet in an XLSX workbook.
    /// </summary>
    public static class Helper
    {
        /// <summary>
        /// Converts a list of DataTables to an Excel workbook stored in a MemoryStream.
        /// Each DataTable is written to a separate worksheet named after the DataTable's TableName.
        /// </summary>
        /// <param name="dataTables">The list of DataTables to export.</param>
        /// <returns>A MemoryStream containing the generated XLSX workbook.</returns>
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
