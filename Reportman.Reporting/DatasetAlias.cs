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
using System.Collections;
#if REPMAN_DESIGN
using System.ComponentModel.Design.Serialization;
using System.Drawing;
#endif
using System.Data;


namespace Reportman.Reporting
{
    /// <summary>
    /// DatasetAlias is a component that can contain references to datasets for substitution
    /// in report dataset list or expression evaluator
    /// </summary>
#if REPMAN_DESIGN
	[ToolboxBitmapAttribute(typeof(DatasetAlias), "datasetalias.ico")]
#endif
    public class DatasetAlias : System.ComponentModel.Component
    {
        /// <summary>
        /// Required variable for designer
        /// </summary>
        private System.ComponentModel.Container components = null;


        private IdenField FIden;
        private AliasCollection FList;

        /// <summary>
        /// Gets the collection of alias entries, each pairing an alias name with a DataTable.
        /// </summary>
#if REPMAN_DESIGN
		[DesignerSerializationVisibility(DesignerSerializationVisibility.Content)]
#endif
        public AliasCollection List
        {
            get
            {
                return (FList);
            }
        }
        private void DoInit()
        {
            FList = new AliasCollection();
            FIden = new IdenField();
        }
        /// <summary>
        /// Initializes a new instance with an empty alias list.
        /// </summary>
        public DatasetAlias()
        {
            //
            // Required for the designer in Windows.Forms
            //
            InitializeComponent();
            //
            DoInit();
        }
        /// <summary>
        /// Initializes a new instance and adds it to the supplied container.
        /// </summary>
        /// <param name="container">The container that will own this component.</param>
        public DatasetAlias(System.ComponentModel.IContainer container)
        {
            //
            // Required for the designer in Windows.Forms
            //
#if REPMAN_DESIGN
			container.Add(this);
#endif
            InitializeComponent();

            //
            //
            DoInit();
        }
        /// <summary>
        /// Searches the alias list for a column matching <paramref name="fieldname"/>,
        /// optionally restricted to the alias named <paramref name="datasetname"/>.
        /// </summary>
        /// <param name="fieldname">The column name to look for.</param>
        /// <param name="datasetname">The alias to restrict the search to, or an empty string to search every alias.</param>
        /// <param name="duplicated">Set to true when the field name is found in more than one alias while searching all aliases.</param>
        /// <returns>An <see cref="EvalIdentifier"/> bound to the matching column, or null when no match is found.</returns>
        public EvalIdentifier FindField(string fieldname, string datasetname, ref bool duplicated)
        {
            duplicated = false;
            EvalIdentifier iden = null;
            DataTable adatatable;
            DataTable adata = null;
            string acolumn = null;
            int acurrentrow = 0;

            int i, index;

            if (datasetname.Length == 0)
            {
                for (i = 0; i < FList.Count; i++)
                {
                    adatatable = FList[i].Data;
                    if (adatatable != null)
                    {
                        index = adatatable.Columns.IndexOf(fieldname);
                        if (index >= 0)
                        {
                            if (acolumn != null)
                            {
                                duplicated = true;
                                break;
                            }
                            acolumn = fieldname;
                            adata = adatatable;
                            acurrentrow = FList[i].CurrentRow;
                        }

                    }
                    if (duplicated)
                        break;
                }
            }
            else
            {
                for (i = 0; i < FList.Count; i++)
                {
                    if (FList[i].Alias == datasetname)
                    {
                        adatatable = FList[i].Data;
                        if (adatatable != null)
                        {
                            index = adatatable.Columns.IndexOf(fieldname);
                            if (index >= 0)
                            {
                                adata = adatatable;
                                acolumn = fieldname;
                                acurrentrow = FList[i].CurrentRow;
                                break;
                            }

                        }
                    }
                    if (acolumn != null)
                        break;
                }
            }
            if (acolumn != null)
            {
                FIden.Field = acolumn;
                FIden.Data = adata;
                FIden.CurrentRow = acurrentrow;
                iden = FIden;
            }
            return (iden);
        }

        /// <summary>
        /// Releases the resources used by the component, disposing designer components when requested.
        /// </summary>
        /// <param name="disposing">True to release managed resources; false to release only unmanaged resources.</param>
        protected override void Dispose(bool disposing)
        {
            try
            {
                if (disposing)
                {
                    if (components != null)
                    {
                        components.Dispose();
                    }
                }
            }
            finally
            {
                base.Dispose(disposing);
            }
        }
        #region Generated code by Desginer
        /// <summary>
        /// Needed by Designer
        /// </summary>
        private void InitializeComponent()
        {

        }
        #endregion
    }
#if REPMAN_DESIGN
	internal class AliasCollectionItemConverter:TypeConverter
	{
		//If asked if we can convert to an
		//InstanceDescriptor then return "true".
		//Otherwise ask our base class.
		public override Boolean CanConvertTo(
			ITypeDescriptorContext context,
			Type destinationType)
		{
			if (destinationType == typeof(InstanceDescriptor))
				return true;
			return
				base.CanConvertTo(context,
				destinationType);
		}

		//Our converter is capable of performing
		//the conversion.
		public override object ConvertTo(
			ITypeDescriptorContext context,
			System.Globalization.CultureInfo culture,
			object value,
			Type destinationType)
		{
			if (destinationType == typeof(InstanceDescriptor)) 
			{
				Type valueType = value.GetType();
				ConstructorInfo ci = valueType.GetConstructor(System.Type.EmptyTypes);
				return new InstanceDescriptor(ci, null, false);
			}
			return base.ConvertTo(context,culture, value, destinationType);
		}
	}
	
	[TypeConverter(typeof(AliasCollectionItemConverter))]
#endif
    /// <summary>
    /// A single dataset alias entry, pairing an (upper-cased) alias name with the
    /// DataTable it refers to and tracking the current row used during evaluation.
    /// </summary>
    public class AliasCollectionItem
    {
        string FAlias;
        DataTable FData;
        /// <summary>
        /// The zero-based index of the row currently used when evaluating fields from this alias.
        /// </summary>
        public int CurrentRow;

        /// <summary>
        /// Gets or sets the DataTable this alias refers to.
        /// </summary>
        public DataTable Data
        {
            get
            {
                return (FData);
            }
            set
            {
                FData = value;
            }
        }
        /// <summary>
        /// Gets or sets the alias name; the value is stored upper-cased.
        /// </summary>
        public string Alias
        {
            get
            {
                return FAlias;
            }
            set
            {
                FAlias = value.ToUpper();
            }
        }
        /// <summary>
        /// Initializes a new, empty alias entry.
        /// </summary>
        public AliasCollectionItem()
        {
        }

    }
    /// <summary>
    /// Strongly typed collection of <see cref="AliasCollectionItem"/> entries held by a DatasetAlias component.
    /// </summary>
    public class AliasCollection : CollectionBase
    {
        /// <summary>
        /// Gets or sets the alias entry at the specified index.
        /// </summary>
        /// <param name="index">The zero-based index of the entry.</param>
        /// <returns>The alias entry at the given index.</returns>
        public AliasCollectionItem this[int index]
        {
            get
            {
                return ((AliasCollectionItem)List[index]);
            }
            set
            {
                List[index] = value;
            }
        }

        /// <summary>
        /// Adds an alias entry to the collection.
        /// </summary>
        /// <param name="value">The entry to add.</param>
        /// <returns>The index at which the entry was added.</returns>
        public int Add(AliasCollectionItem value)
        {
            return (List.Add(value));
        }

        /// <summary>
        /// Returns the index of the specified alias entry within the collection.
        /// </summary>
        /// <param name="value">The entry to locate.</param>
        /// <returns>The zero-based index of the entry, or -1 if it is not found.</returns>
        public int IndexOf(AliasCollectionItem value)
        {
            return (List.IndexOf(value));
        }

        /// <summary>
        /// Inserts an alias entry into the collection at the specified index.
        /// </summary>
        /// <param name="index">The zero-based index at which to insert the entry.</param>
        /// <param name="value">The entry to insert.</param>
        public void Insert(int index, AliasCollectionItem value)
        {
            List.Insert(index, value);
        }

        /// <summary>
        /// Removes the specified alias entry from the collection.
        /// </summary>
        /// <param name="value">The entry to remove.</param>
        public void Remove(AliasCollectionItem value)
        {
            List.Remove(value);
        }

        /// <summary>
        /// Determines whether the collection contains the specified alias entry.
        /// </summary>
        /// <param name="value">The entry to locate.</param>
        /// <returns>True if the entry is found; otherwise false.</returns>
        public bool Contains(AliasCollectionItem value)
        {
            // If value is not of type AliasCollectionItem, this will return false.
            return (List.Contains(value));
        }

        /// <summary>
        /// Validates that the value being inserted is an <see cref="AliasCollectionItem"/>.
        /// </summary>
        /// <param name="index">The zero-based index at which the value is inserted.</param>
        /// <param name="value">The value being inserted.</param>
        protected override void OnInsert(int index, Object value)
        {
            if (!(value is AliasCollectionItem))
                throw new ArgumentException("value must be of type AlliasCollectionItem.", "value");
        }

        /// <summary>
        /// Validates that the value being removed is an <see cref="AliasCollectionItem"/>.
        /// </summary>
        /// <param name="index">The zero-based index at which the value is removed.</param>
        /// <param name="value">The value being removed.</param>
        protected override void OnRemove(int index, Object value)
        {
            if (!(value is AliasCollectionItem))
                throw new ArgumentException("value must be of type AlliasCollectionItem.", "value");
        }

        /// <summary>
        /// Validates that the value being assigned is an <see cref="AliasCollectionItem"/>.
        /// </summary>
        /// <param name="index">The zero-based index at which the value is set.</param>
        /// <param name="oldValue">The value being replaced.</param>
        /// <param name="newValue">The value being assigned.</param>
        protected override void OnSet(int index, Object oldValue, Object newValue)
        {
            if (!(newValue is AliasCollectionItem))
                throw new ArgumentException("value must be of type AlliasCollectionItem.", "value");
        }

        /// <summary>
        /// Validates that the specified value is an <see cref="AliasCollectionItem"/>.
        /// </summary>
        /// <param name="value">The value to validate.</param>
        protected override void OnValidate(Object value)
        {
            if (!(value is AliasCollectionItem))
                throw new ArgumentException("value must be of type AlliasCollectionItem.", "value");
        }
        /// <summary>
        /// Copies the entries of the collection into the supplied array starting at the given index.
        /// </summary>
        /// <param name="array">The destination array.</param>
        /// <param name="index">The zero-based index in the array at which copying begins.</param>
        public void CopyTo(AliasCollectionItem[] array,
            int index)
        {
            List.CopyTo(array, index);
        }

    }


}
