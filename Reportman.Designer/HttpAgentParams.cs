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
 *  Copyright (c) 1994 - 2026 Toni Martir (toni@reportman.es)
 *  All Rights Reserved.
*/
#endregion

using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Reportman.Designer
{
    /// <summary>A Hub database reference (display name + hubDatabaseId).</summary>
    public sealed class HubDatabaseRef
    {
        public long Id;
        public string Name = "";
        public override string ToString() { return Name; }
        public override bool Equals(object obj)
        {
            HubDatabaseRef r = obj as HubDatabaseRef;
            return r != null && r.Id == Id;
        }
        public override int GetHashCode() { return Id.GetHashCode(); }
    }

    /// <summary>
    /// TypeConverter for the Hub database property: provides the dropdown values by
    /// querying the agent with the current API key when the list is expanded.
    /// </summary>
    public sealed class HubDatabaseConverter : TypeConverter
    {
        public override bool GetStandardValuesSupported(ITypeDescriptorContext context) { return true; }
        public override bool GetStandardValuesExclusive(ITypeDescriptorContext context) { return false; }

        public override StandardValuesCollection GetStandardValues(ITypeDescriptorContext context)
        {
            var list = new List<HubDatabaseRef>();
            HttpAgentParams inst = context != null ? context.Instance as HttpAgentParams : null;
            if (inst != null)
            {
                string apiKey = (inst.ApiKey ?? "").Trim();
                if (apiKey.Length > 0)
                {
                    Cursor old = Cursor.Current;
                    Cursor.Current = Cursors.WaitCursor;
                    try
                    {
                        // Run off the UI thread to avoid a SynchronizationContext deadlock.
                        List<string> raw = Task.Run(() =>
                            RpAuthManager.Instance.GetApiKeySchemasAsync(apiKey)).GetAwaiter().GetResult();
                        var seen = new HashSet<long>();
                        foreach (string s in raw)
                        {
                            int eq = s.LastIndexOf('=');
                            if (eq < 0) continue;
                            string name = s.Substring(0, eq);
                            string idpart = s.Substring(eq + 1);
                            int bar = idpart.IndexOf('|');
                            string idstr = bar >= 0 ? idpart.Substring(0, bar) : idpart;
                            long id;
                            long.TryParse(idstr.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out id);
                            if (id > 0 && seen.Add(id))
                                list.Add(new HubDatabaseRef { Id = id, Name = name });
                        }
                    }
                    catch (Exception ex)
                    {
                        System.Diagnostics.Debug.WriteLine("Hub database list error: " + ex.Message);
                    }
                    finally
                    {
                        Cursor.Current = old;
                    }
                }
                inst.LastList = list;
            }
            return new StandardValuesCollection(list);
        }

        public override bool CanConvertFrom(ITypeDescriptorContext context, Type sourceType)
        {
            return sourceType == typeof(string) || base.CanConvertFrom(context, sourceType);
        }
        public override bool CanConvertTo(ITypeDescriptorContext context, Type destinationType)
        {
            return destinationType == typeof(string) || base.CanConvertTo(context, destinationType);
        }
        public override object ConvertTo(ITypeDescriptorContext context, CultureInfo culture,
            object value, Type destinationType)
        {
            if (destinationType == typeof(string))
            {
                HubDatabaseRef r = value as HubDatabaseRef;
                return r != null ? r.Name : "";
            }
            return base.ConvertTo(context, culture, value, destinationType);
        }
        public override object ConvertFrom(ITypeDescriptorContext context, CultureInfo culture, object value)
        {
            string s = value as string;
            if (s != null)
            {
                HttpAgentParams inst = context != null ? context.Instance as HttpAgentParams : null;
                if (inst != null && inst.LastList != null)
                {
                    foreach (HubDatabaseRef r in inst.LastList)
                        if (string.Equals(r.Name, s, StringComparison.OrdinalIgnoreCase))
                            return r;
                }
                return new HubDatabaseRef { Id = 0, Name = s };
            }
            return base.ConvertFrom(context, culture, value);
        }
    }

    /// <summary>
    /// Object bound to the connection assistant PropertyGrid when the HTTP Agent
    /// "driver" is selected: the API key plus a live Hub-database selector.
    /// </summary>
    public sealed class HttpAgentParams
    {
        [Category("Agent")]
        [DisplayName("API key")]
        [Description("Reportman AI / DB Agent API key. Stored in dbxconnections.ini, not in the report.")]
        [PasswordPropertyText(true)]
        public string ApiKey { get; set; }

        // Base URL is environment-determined (DEBUG vs RELEASE build) and is NOT
        // user-configurable, so it is hidden from the grid and never written.
        [Browsable(false)]
        public string BaseUrl { get; set; }

        [Category("Agent")]
        [DisplayName("Database")]
        [Description("Hub database to use. Expand the list to query the agent with the API key above.")]
        [TypeConverter(typeof(HubDatabaseConverter))]
        public HubDatabaseRef Database { get; set; }

        [Browsable(false)]
        public List<HubDatabaseRef> LastList { get; set; }

        public HttpAgentParams()
        {
            ApiKey = "";
            BaseUrl = "";
            Database = new HubDatabaseRef();
            LastList = new List<HubDatabaseRef>();
        }
    }
}
