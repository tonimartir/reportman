#region Copyright
/*
 *  Report Manager:  Database Reporting tool for .Net and Mono
 *
 *     The contents of this file are subject to the MPL License
 *     with optional use of GPL or LGPL licenses.
 *     You may not use this file except in compliance with the
 *     Licenses. You may obtain copies of the Licenses at:
 *     http://reportman.sourceforge.net/license
 *
 *     Software is distributed on an "AS IS" basis,
 *     WITHOUT WARRANTY OF ANY KIND, either
 *     express or implied.  See the License for the specific
 *     language governing rights and limitations.
 *
 *  Copyright (c) 1994 - 2008 Toni Martir (toni@reportman.es)
 *  All Rights Reserved.
*/
#endregion

using System;
using System.Data;
#if REPMAN_DOTNET2
using System.Xml;
#endif

namespace Reportman.Reporting
{
    /// <summary>
    /// A <see cref="DataTable"/> that loads rows incrementally from an <see cref="IDataReader"/>
    /// in pages of <see cref="PageSize"/> records, tracking end-of-data and raising a change event.
    /// </summary>
    public class PagedDataTable : DataTable
    {
        private bool FEof;
        private bool FInternalEof;
        private IDataReader FCurrentReader;
        /// <summary>
        /// Occurs when a row is successfully appended to the table, raising the data change event.
        /// </summary>
        public event PagedDataChange OnDataChange;
        /// <summary>
        /// Gets or sets a value indicating whether table columns should be cleared and rebuilt on update.
        /// </summary>
        public bool UpdateColumns;
        /// <summary>
        /// Gets or sets the batch sizing limit for row chunks.
        /// </summary>
        public int PageSize;
        /// <summary>
        /// Gets a value indicating whether the data reader is currently active.
        /// </summary>
        public bool Active
        {
            get { return (FCurrentReader != null); }
        }
        /// <summary>
        /// Initializes a new instance of the PagedDataTable class.
        /// </summary>
        public PagedDataTable() : base()
        {
            PageSize = 500;
        }
        private void DoUpdateData()
        {
            if (UpdateColumns)
            {
                Clear();
                Columns.Clear();
            }
            Rows.Clear();
            BeginLoadData();
            FEof = false;
            FInternalEof = false;
            if (FCurrentReader == null)
            {
                FEof = true;
                FInternalEof = true;
                return;
            }
            int i;
            if (Columns.Count == 0)
            {
                DataTable adatatable = FCurrentReader.GetSchemaTable();
                DataColumn col;

                for (i = 0; i < adatatable.Rows.Count; i++)
                {
                    string acolname;
                    DataRow nrow = adatatable.Rows[i];
                    //					col=Columns.Add();
                    acolname = nrow["ColumnName"].ToString().ToUpper();
                    if (acolname.Length < 1)
                        acolname = "Column" + i.ToString();
                    //					col.ColumnName=acolname;
                    //					col.DataType=(Type)nrow["DataType"];
                    //					col.Caption=acolname;
                    //					col.Caption=acolname;
                    col = Columns.Add(acolname, (Type)nrow["DataType"]);
                    if (col.DataType.ToString() == "System.String")
                    {
                        int maxlength = (int)nrow["ColumnSize"];
                        col.MaxLength = maxlength;
                    }
                    col.Caption = acolname;
                }
            }
            int x = 0;
            while (x < PageSize)
            {
                x++;
                if (!Next())
                    break;
            }
        }
        /// <summary>
        /// Gets or sets the active reader source from which rows are incrementally loaded.
        /// </summary>
        public IDataReader CurrentReader
        {
            get
            {
                return FCurrentReader;
            }
            set
            {
                if (FCurrentReader != value)
                {
                    FCurrentReader = value;
                    DoUpdateData();
                }
            }
        }
        /// <summary>
        /// Gets a value indicating whether all records have been loaded from the reader.
        /// </summary>
        public bool Eof
        {
            get
            {
                return FInternalEof;
            }
        }
        /// <summary>
        /// Reads the next row from the data reader, inserts it into the table, and raises the change event.
        /// </summary>
        /// <returns>True if a record was successfully read; otherwise, false.</returns>
        public bool Next()
        {
            if (FCurrentReader == null)
                return false;
            if (FEof)
                return false;
            FEof = !FCurrentReader.Read();
            if (FEof)
            {
                FInternalEof = true;
                return false;
            }
            int i;
            DataRow arow;
            arow = NewRow();
            for (i = 0; i < Columns.Count; i++)
                arow[i] = FCurrentReader[i];
            Rows.Add(arow);
            if (OnDataChange != null)
                OnDataChange(this);
            return true;
        }
    }
    /// <summary>
    /// Callback raised by a <see cref="PagedDataTable"/> each time a new row is read and added,
    /// allowing observers to react to incremental data loading.
    /// </summary>
    public delegate void PagedDataChange(PagedDataTable Data);
}
