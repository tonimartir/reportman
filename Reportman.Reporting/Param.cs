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

using Newtonsoft.Json;
using Reportman.Drawing;
using System;
using System.Data;

namespace Reportman.Reporting
{
    /// <summary>
    /// A report parameter prompted from the user, carrying its typed value, localized
    /// descriptions/hints/error messages, validation rule and optional list, lookup or
    /// search dataset that supplies selectable values.
    /// </summary>
    public class Param : ReportItem, ICloneable
    {
        private Variant FValue;
        /// <summary>
        /// Gets or sets the parameter's typed value. For a multiple-selection parameter
        /// the getter returns the comma-joined list of selected values.
        /// </summary>
        public Variant Value
        {
            get
            {
                if (ParamType == ParamType.Multiple)
                    return GetMultiValue();
                else

                    return FValue;
            }
            set
            {
                FValue = value;

            }
        }
        /// <summary>
        /// The kind of value this parameter holds (bool, date, string, expression, list,
        /// multiple, ...), which drives editing, validation and database typing.
        /// </summary>
        public ParamType ParamType;
        /// <summary>
        /// Alternative name used to reference this parameter, for example when binding it
        /// to a dataset parameter.
        /// </summary>
        public string Alias;
        /// <summary>
        /// Newline-separated list of the parameter's descriptions, one entry per report language.
        /// </summary>
        [JsonConverter(typeof(NewlineDelimitedStringConverter))]
        public string Descriptions;
        /// <summary>
        /// Gets or sets the description for the report's current language, stored within the
        /// newline-separated <see cref="Descriptions"/> list.
        /// </summary>
        public string Description
        {
            get
            {
                return Strings.GetStringByIndex(Descriptions, Report.Language);
            }
            set
            {
                if (Report != null)
                {
                    Descriptions = Strings.SetStringByIndex(Descriptions, value, Report.Language);
                }
            }
        }
        /// <summary>
        /// Newline-separated list of the parameter's hints, one entry per report language.
        /// </summary>
        [JsonConverter(typeof(NewlineDelimitedStringConverter))]
        public string Hints;
        /// <summary>
        /// Returns the serialization class identifier ("TRPPARAM") for this item.
        /// </summary>
        protected override string GetClassName()
        {
            return "TRPPARAM";
        }
        /// <summary>
        /// Gets whether the parameter should be shown to the user, i.e. it is visible and
        /// not marked as never visible.
        /// </summary>
        public bool UserVisible
        {
            get { return (Visible && (!NeverVisible)); }
        }
        /// <summary>
        /// Gets or sets the hint text for the report's current language, stored within the
        /// newline-separated <see cref="Hints"/> list.
        /// </summary>
        public string Hint
        {
            get
            {
                return Strings.GetStringByIndex(Hints, Report.Language);
            }
            set
            {
                if (Report != null)
                {
                    Hints = Strings.SetStringByIndex(Hints, value, Report.Language);
                }
            }
        }
        /// <summary>
        /// Newline-separated list of validation error messages, one entry per report language.
        /// </summary>
        [JsonConverter(typeof(NewlineDelimitedStringConverter))]
        public string ErrorMessages;
        /// <summary>
        /// Gets or sets the validation error message for the report's current language,
        /// falling back to the first entry when none exists for that language.
        /// </summary>
        public string ErrorMessage
        {
            get
            {
                if (ErrorMessages.Length > Report.Language)
                    return Strings.GetStringByIndex(ErrorMessages, Report.Language);
                else
                {
                    if (ErrorMessages.Length > 0)
                        return Strings.GetStringByIndex(ErrorMessages, 0);
                    else
                        return "";
                }
            }
            set
            {
                if (Report != null)
                {
                    ErrorMessages = Strings.SetStringByIndex(ErrorMessages, value, Report.Language);
                }
            }
        }
        /// <summary>
        /// Expression evaluated to validate the parameter's value; an empty string means no validation.
        /// </summary>
        public string Validation;
        /// <summary>
        /// Names of the lookup dataset, search dataset, search expression and search parameter
        /// used to supply or resolve the parameter's selectable values.
        /// </summary>
        public string LookupDataset, SearchDataset, Search, SearchParam;
        /// <summary>
        /// Display texts shown to the user for a list or multiple-selection parameter.
        /// </summary>
        public Strings Items;
        /// <summary>
        /// Underlying values or expressions matching each entry in <see cref="Items"/>.
        /// </summary>
        public Strings Values;
        /// <summary>
        /// Values currently selected for a multiple-selection parameter.
        /// </summary>
        public Strings Selected;
        /// <summary>
        /// Names of the datasets associated with this parameter.
        /// </summary>
        public Strings Datasets;
        private Variant FLastValue;
        /// <summary>
        /// Gets or sets the value used the last time the report ran, kept for defaulting
        /// and database typing.
        /// </summary>
        public Variant LastValue
        {
            get
            {
                return FLastValue;
            }
            set
            {

                FLastValue = value;
            }

        }
        /// <summary>
        /// Flags controlling parameter visibility, whether it is read-only, whether it is
        /// always hidden and whether a null value is allowed.
        /// </summary>
        public bool Visible, IsReadOnly, NeverVisible, AllowNulls;
        /// <summary>
        /// Initializes a new parameter with empty value, description, hint, error message,
        /// validation and dataset collections.
        /// </summary>
        public Param()
            : base()
        {
            Items = new Strings();
            Values = new Strings();
            Selected = new Strings();
            Datasets = new Strings();
            Descriptions = "";
            Hints = "";
            ErrorMessages = "";
            Validation = "";
            Alias = "";
            FValue = new Variant();
            LookupDataset = ""; SearchDataset = ""; Search = ""; SearchParam = "";
        }
        /// <summary>
        /// Returns the ADO.NET <see cref="DbType"/> that corresponds to this parameter's
        /// <see cref="ParamType"/>, using the last value's type for expression and list parameters.
        /// </summary>
        public DbType GetDbType()
        {
            DbType aresult = DbType.Object;
            switch (ParamType)
            {
                case ParamType.Bool:
                    aresult = DbType.Boolean;
                    break;
                case ParamType.Currency:
                    aresult = DbType.Currency;
                    break;
                case ParamType.Date:
                    aresult = DbType.Date;
                    break;
                case ParamType.Time:
                    aresult = DbType.Time;
                    break;
                case ParamType.DateTime:
                    aresult = DbType.DateTime;
                    break;
                case ParamType.Double:
                    aresult = DbType.Double;
                    break;
                case ParamType.String:
                    aresult = DbType.String;
                    break;
                case ParamType.ExpreA:
                case ParamType.ExpreB:
                case ParamType.List:
                case ParamType.SubsExpreList:
                case ParamType.Multiple:
                    aresult = LastValue.GetDbType();
                    break;
            }
            return aresult;
        }
        /// <summary>
        /// Returns the selected expression for a substitution-expression list parameter:
        /// the value at the current index when the value is an integer, otherwise the value itself.
        /// </summary>
        public string GetSubExpreValue()
        {
            if (FValue.IsInteger())
            {
                return Values[FValue];
            }
            else
                return FValue;
        }
        /// <summary>
        /// Returns the comma-separated list of selected values for a multiple-selection
        /// parameter, or an empty string for other parameter types.
        /// </summary>
        public string GetMultiValue()
        {
            int i;

            string aresult = "";
            if (ParamType != ParamType.Multiple)
                return aresult;
            for (i = 0; i < Selected.Count; i++)
            {
                /*				astring = Selected[i];
                                aindex = System.Convert.ToInt32(astring);
                                if (Values.Count > aindex)
                                {
                                    if (aresult.Length > 0)
                                        aresult = aresult + "," + Values[aindex];
                                    else
                                        aresult = Values[aindex];
                                }
                */
                if (aresult.Length > 0)
                    aresult = aresult + "," + Selected[i];
                else
                    aresult = Selected[i];
            }
            return aresult;
        }

        /// <summary>
        /// Gets the effective value of the parameter, resolving the selected option of a
        /// list, multiple or substitution-expression-list parameter into its evaluated value.
        /// </summary>
        public Variant ListValue
        {
            get
            {
                Variant aresult = new Variant();
                string aexpression;
                int aoption;
                if (!((ParamType == ParamType.List) ||
                    (ParamType == ParamType.Multiple) || (ParamType == ParamType.SubsExpreList)))
                    aresult = Value;
                else
                {
                    if (ParamType == ParamType.Multiple)
                        aresult = GetMultiValue();
                    else
                    {
                        aoption = 0;
                        if (Value.IsInteger())
                        {
                            aoption = Value;
                            if (aoption < 0)
                                aoption = 0;
                        }
                        else
                        {
                            if (Value.IsString())
                            {
                                aoption = Values.IndexOf(Value);
                                if (aoption < 0)
                                    aoption = 0;
                            }
                        }
                        if (aoption >= Values.Count)
                        {
                            aresult = Value;
                        }
                        else
                        {
                            aexpression = Values[aoption];
                            aresult = Report.Evaluator.EvaluateText(aexpression);
                        }
                    }
                }
                return aresult;
            }
        }
        /// <summary>
        /// Creates a deep copy of this parameter, cloning its item, value, selection and
        /// dataset collections. Returns the new <see cref="Param"/>.
        /// </summary>
        public object Clone()
        {
            Param p = new Param();
            p.Report = Report;
            p.AllowNulls = AllowNulls;
            p.Alias = Alias;
            p.Datasets = (Strings)Datasets.Clone();
            p.Descriptions = Descriptions;
            p.ErrorMessage = ErrorMessage;
            p.FValue = FValue;
            p.Hint = Hint;
            p.Hints = Hints;
            p.IsReadOnly = IsReadOnly;
            p.Items = (Strings)Items.Clone();
            p.LastValue = LastValue;
            p.LookupDataset = LookupDataset;
            p.Name = Name;
            p.NeverVisible = NeverVisible;
            p.ParamType = ParamType;
            p.Search = Search;
            p.SearchDataset = SearchDataset;
            p.SearchParam = SearchParam;
            p.Selected = (Strings)Selected.Clone();
            p.Validation = Validation;
            p.Values = (Strings)Values.Clone();
            p.Visible = Visible;
            return p;
        }
        /// <summary>
        /// Marks every available value as selected for a multiple-selection parameter.
        /// </summary>
        public void SelectAllValues()
        {
            Selected.Clear();
            foreach (string s in Values)
                Selected.Add(s);
        }
        /// <summary>
        /// Reloads the <see cref="Items"/> and <see cref="Values"/> collections from the
        /// configured lookup dataset, using its first column as the display text and, when
        /// present, its second column as the value.
        /// </summary>
        public void UpdateLookupValues()
        {
            if (LookupDataset.Length > 0)
            {
                Values.Clear();
                Items.Clear();
                DataInfo dinfo = Report.DataInfo[LookupDataset];
                dinfo.DisConnect();
                dinfo.Connect();
                try
                {
                    int indexvalue = 0;
                    if (dinfo.Data.Columns.Count > 1)
                        indexvalue = 1;
                    while (!dinfo.Data.Eof)
                    {
                        Items.Add(dinfo.Data.CurrentRow[0].ToString());
                        Values.Add(dinfo.Data.CurrentRow[indexvalue].ToString());
                        dinfo.Data.Next();
                    }
                }
                finally
                {
                    dinfo.DisConnect();
                }
            }
        }
    }
}

/// <summary>
/// JSON converter that serializes a newline-separated string as a JSON array of lines
/// and deserializes such an array back into a single newline-joined string.
/// </summary>
public class NewlineDelimitedStringConverter : JsonConverter
{
    /// <summary>
    /// Returns true when the converter can handle the given type, i.e. it is a string.
    /// </summary>
    public override bool CanConvert(Type objectType) => objectType == typeof(string);

    /// <summary>
    /// Writes the newline-separated string as a JSON array with one element per line.
    /// </summary>
    public override void WriteJson(JsonWriter writer, object value, JsonSerializer serializer)
    {
        var str = (string)value ?? "";
        var array = string.IsNullOrEmpty(str) ? new string[0] : str.Split('\n');
        serializer.Serialize(writer, array);
    }

    /// <summary>
    /// Reads a JSON array of lines back into a single newline-joined string, or returns
    /// the scalar token value as a string.
    /// </summary>
    public override object ReadJson(JsonReader reader, Type objectType, object existingValue, JsonSerializer serializer)
    {
        if (reader.TokenType == JsonToken.StartArray)
        {
            var array = serializer.Deserialize<string[]>(reader) ?? new string[0];
            return string.Join("\n", array);
        }
        return reader.Value?.ToString() ?? "";
    }
}
