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

using Reportman.Drawing;
using Reportman.Reporting;
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Data.Common;
using System.Drawing;
using System.Windows.Forms;

namespace Reportman.Designer
{
    /// <summary>
    /// The parameters of a connection of this computer (a <c>DriverName=ADO.NET</c> section of dbxconnections.ini) in
    /// the property grid of the connection assistant, read-only: the designer chooses it, Reportman.Server or Reportman
    /// AI define it. Its passwords are shown masked, never in clear.
    /// </summary>
    internal sealed class LocalConnectionView : CustomTypeDescriptor
    {
        /// <summary>What a password shows.</summary>
        public const string Mask = "********";

        private readonly PropertyDescriptorCollection FProperties;

        public LocalConnectionView(DbxDirectConnection connection, string category)
        {
            List<PropertyDescriptor> properties = new List<PropertyDescriptor>();
            HashSet<string> names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (connection.Parameters.Count > 0)
            {
                foreach (KeyValuePair<string, string> pair in connection.Parameters)
                {
                    properties.Add(new ValueDescriptor(pair.Key,
                        DbxDirectConnections.IsPasswordName(pair.Key) ? Mask : pair.Value, category));
                    names.Add(pair.Key);
                }
            }
            else
            {
                // Only a connection string: its keywords
                try
                {
                    DbConnectionStringBuilder builder = new DbConnectionStringBuilder();
                    builder.ConnectionString = connection.ConnectionString ?? "";
                    foreach (string key in builder.Keys)
                    {
                        properties.Add(new ValueDescriptor(key,
                            DbxDirectConnections.IsPasswordName(key) ? Mask : Convert.ToString(builder[key]), category));
                        names.Add(key);
                    }
                }
                catch
                {
                    // A string the builder does not understand: the box below shows it
                }
            }
            foreach (KeyValuePair<string, string> pair in connection.Secrets)
                if (!names.Contains(pair.Key))
                    properties.Add(new ValueDescriptor(pair.Key, Mask, category));
            FProperties = new PropertyDescriptorCollection(properties.ToArray(), true);
        }

        public override PropertyDescriptorCollection GetProperties()
        {
            return FProperties;
        }

        public override PropertyDescriptorCollection GetProperties(Attribute[] attributes)
        {
            return FProperties;
        }

        public override object GetPropertyOwner(PropertyDescriptor pd)
        {
            return this;
        }

        private sealed class ValueDescriptor : PropertyDescriptor
        {
            private readonly string FValue;
            private readonly string FCategory;

            public ValueDescriptor(string name, string value, string category)
                : base(name, null)
            {
                FValue = value ?? "";
                FCategory = category ?? "";
            }

            public override bool IsReadOnly { get { return true; } }
            public override string Category { get { return FCategory; } }
            public override Type ComponentType { get { return typeof(LocalConnectionView); } }
            public override Type PropertyType { get { return typeof(string); } }
            public override bool CanResetValue(object component) { return false; }
            public override object GetValue(object component) { return FValue; }
            public override void ResetValue(object component) { }
            public override void SetValue(object component, object value) { }
            public override bool ShouldSerializeValue(object component) { return false; }
        }
    }

    /// <summary>
    /// The password of a connection of this computer that this Windows user cannot decipher (ciphered by another user,
    /// or written by a program that could not cipher it), asked the first time a report, the SQL editor or the
    /// connection test opens it (<see cref="DatabaseInfo.DirectConnectionPassword"/>). The engine saves it ciphered
    /// for this user in the same section once the connection opens with it, and it is not asked again.
    /// </summary>
    internal static class LocalConnectionPassword
    {
        /// <summary>Installs the dialog as the engine's way to ask, unless the host already installed its own.</summary>
        public static void Install()
        {
            if (DatabaseInfo.DirectConnectionPassword == null)
                DatabaseInfo.DirectConnectionPassword = Ask;
        }

        /// <summary>Asks the password of <paramref name="request"/>; null when the user cancels.</summary>
        public static string Ask(DbxPasswordRequest request)
        {
            Form owner = Form.ActiveForm;
            if (owner == null && Application.OpenForms.Count > 0)
                owner = Application.OpenForms[0];
            // A report may connect out of the user interface thread
            if (owner != null && owner.InvokeRequired)
                return (string)owner.Invoke(new Func<string>(() => Show(owner, request)));
            return Show(owner, request);
        }

        private static string Show(IWin32Window owner, DbxPasswordRequest request)
        {
            using (Form form = new Form())
            {
                form.Text = Translator.TranslateStr(1979);
                form.ShowIcon = false;
                form.ShowInTaskbar = false;
                form.MinimizeBox = false;
                form.MaximizeBox = false;
                form.FormBorderStyle = FormBorderStyle.FixedDialog;
                form.StartPosition = owner != null ? FormStartPosition.CenterParent : FormStartPosition.CenterScreen;
                form.AutoSize = true;
                form.AutoSizeMode = AutoSizeMode.GrowAndShrink;
                form.Padding = new Padding(12);

                TableLayoutPanel table = new TableLayoutPanel();
                table.AutoSize = true;
                table.ColumnCount = 1;
                table.Dock = DockStyle.Fill;
                int width = Convert.ToInt32(380 * Reportman.Drawing.Windows.GraphicUtils.DPIScale);

                Label prompt = new Label();
                prompt.AutoSize = true;
                prompt.MaximumSize = new Size(width, 0);
                prompt.Text = DesignerText.Tr(2073, "Password of the connection %s:").Replace("%s", request.Alias);
                TextBox password = new TextBox();
                password.UseSystemPasswordChar = true;
                password.Width = width;
                password.Margin = new Padding(3, 6, 3, 6);
                Label note = new Label();
                note.AutoSize = true;
                note.MaximumSize = new Size(width, 0);
                note.ForeColor = SystemColors.GrayText;
                note.Text = DesignerText.Tr(2074, "This Windows user cannot read the password stored for this connection. It " +
                    "will be saved ciphered for you in the connections file and it will not be asked again.");

                FlowLayoutPanel buttons = new FlowLayoutPanel();
                buttons.AutoSize = true;
                buttons.Dock = DockStyle.Fill;
                buttons.FlowDirection = FlowDirection.RightToLeft;
                buttons.Margin = new Padding(0, 10, 0, 0);
                Button cancel = new Button();
                cancel.Text = Translator.TranslateStr(94);
                cancel.AutoSize = true;
                cancel.DialogResult = DialogResult.Cancel;
                Button ok = new Button();
                ok.Text = Translator.TranslateStr(93);
                ok.AutoSize = true;
                ok.DialogResult = DialogResult.OK;
                buttons.Controls.Add(cancel);
                buttons.Controls.Add(ok);

                table.Controls.Add(prompt, 0, 0);
                table.Controls.Add(password, 0, 1);
                table.Controls.Add(note, 0, 2);
                table.Controls.Add(buttons, 0, 3);
                form.Controls.Add(table);
                form.AcceptButton = ok;
                form.CancelButton = cancel;

                DialogResult result = owner != null ? form.ShowDialog(owner) : form.ShowDialog();
                return result == DialogResult.OK ? password.Text : null;
            }
        }
    }
}
