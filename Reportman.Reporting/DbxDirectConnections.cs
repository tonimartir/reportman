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
using System.Data.Common;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace Reportman.Reporting
{
    /// <summary>
    /// A connection of THIS COMPUTER as Reportman.Server, the Reportman AI Desktop and the Reportman AI chat write it in
    /// the shared <c>dbxconnections.ini</c> (a section with <c>DriverName=ADO.NET</c>): the provider (the invariant
    /// names of the .Net designer: <c>SQLiteCore</c>, <c>FirebirdSql.Data.FirebirdClient</c>, <c>SQLServer</c>...), its
    /// parameters (<c>Param.Name</c>, the property names of the provider's connection string builder), the passwords
    /// ciphered for the Windows user (<c>Secret.Name=dpapi:...</c>), the connection string WITHOUT the password and the
    /// keys of other programs (<c>Delphi.*</c>, anything unknown), which are never touched.
    /// </summary>
    public sealed class DbxDirectConnection
    {
        /// <summary>The alias: the name of the section, as it is in the file.</summary>
        public string Alias { get; set; } = "";
        /// <summary>The provider factory (<c>ProviderFactory</c>).</summary>
        public string ProviderFactory { get; set; } = "";
        /// <summary>The parameters (<c>Param.Name=value</c>). A password another program wrote in clear is here.</summary>
        public Dictionary<string, string> Parameters { get; } = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        /// <summary>The ciphered passwords (<c>Secret.Name=dpapi:...</c>), as they are in the file.</summary>
        public Dictionary<string, string> Secrets { get; } = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        /// <summary>The connection string (<c>ConnectionString</c>), without the password.</summary>
        public string ConnectionString { get; set; } = "";
        /// <summary>The other keys of the section, in their order (Delphi's, anything unknown).</summary>
        public List<KeyValuePair<string, string>> Extra { get; } = new List<KeyValuePair<string, string>>();
        /// <summary>The file it was read from.</summary>
        public string FileName { get; set; } = "";
    }

    /// <summary>
    /// The password of a connection of this computer that cannot be deciphered here (ciphered by another Windows user,
    /// or outside Windows), asked to the host through <see cref="DatabaseInfo.DirectConnectionPassword"/>.
    /// </summary>
    public sealed class DbxPasswordRequest
    {
        /// <summary>The alias of the connection.</summary>
        public string Alias { get; set; } = "";
        /// <summary>The name of the parameter (normally <c>Password</c>).</summary>
        public string ParameterName { get; set; } = "";
        /// <summary>The provider factory of the connection.</summary>
        public string ProviderFactory { get; set; } = "";
        /// <summary>The connections file where it is saved, ciphered, once the connection opens with it.</summary>
        public string FileName { get; set; } = "";
    }

    /// <summary>
    /// THE CONNECTIONS OF THIS COMPUTER of the shared <c>dbxconnections.ini</c> (the <c>DriverName=ADO.NET</c> sections,
    /// Reportman.Server's format): where the file is, how they are read, the string that opens one (its password
    /// deciphered and added) and how a password asked to the user is saved ciphered in its own section without touching
    /// anything else of the file — the Delphi DBExpress connections and the Agent's live in the same file.
    /// <para>
    /// The passwords are never in clear (decided for the Reportman AI Desktop and chat, 19-11-2026): <c>Secret.Password=</c>
    /// <c>dpapi:</c> + base64 of Windows DPAPI for the current user, with the entropy «Reportman.dbxconnections», the same
    /// every program of the same Windows user deciphers. A password Reportman.Server or Delphi wrote in clear
    /// (<c>Param.Password</c>) is read as it is.
    /// </para>
    /// </summary>
    public static class DbxDirectConnections
    {
        /// <summary>The driver of a direct connection (Reportman.Server's).</summary>
        public const string DirectDriverName = "ADO.NET";
        /// <summary>The mark of a value ciphered with DPAPI.</summary>
        public const string DpapiPrefix = "dpapi:";

        private const string ParamPrefix = "Param.";
        private const string SecretPrefix = "Secret.";
        // The same in every program that reads it: not a secret, only a separator from other DPAPI blobs of the user
        private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("Reportman.dbxconnections");

        /// <summary>
        /// A connections file to use instead of the shared one, also by <see cref="DatabaseInfo"/> (the self-tests: a
        /// temporary folder, never the user's file). Null or empty: the shared one.
        /// </summary>
        public static string OverridePath { get; set; }

        /// <summary>
        /// Where the file is looked for, in the order of the designers: <c>%PUBLIC%</c>, <c>C:\Users\Public</c>, common
        /// application data and the folder of the program.
        /// </summary>
        public static IEnumerable<string> Candidates()
        {
            string publicProfile = Environment.GetEnvironmentVariable("PUBLIC");
            if (!string.IsNullOrWhiteSpace(publicProfile))
                yield return Path.Combine(publicProfile, "dbxconnections.ini");

            string systemDrive = Environment.GetEnvironmentVariable("SystemDrive");
            if (!string.IsNullOrWhiteSpace(systemDrive))
                yield return Path.Combine(systemDrive + Path.DirectorySeparatorChar, "Users", "Public", "dbxconnections.ini");

            string commonApplicationData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
            if (!string.IsNullOrWhiteSpace(commonApplicationData))
                yield return Path.Combine(commonApplicationData, "dbxconnections.ini");

            string baseDirectory = AppDomain.CurrentDomain.BaseDirectory;
            if (!string.IsNullOrWhiteSpace(baseDirectory))
                yield return Path.Combine(baseDirectory, "dbxconnections.ini");
        }

        /// <summary>The file there is (<see cref="OverridePath"/> first), or "" when there is none.</summary>
        public static string ExistingPath()
        {
            if (!string.IsNullOrEmpty(OverridePath))
                return File.Exists(OverridePath) ? OverridePath : "";
            foreach (string candidate in Candidates())
                if (File.Exists(candidate))
                    return candidate;
            return "";
        }

        /// <summary>Whether a parameter is a password.</summary>
        public static bool IsPasswordName(string name)
        {
            return !string.IsNullOrEmpty(name) &&
                (name.IndexOf("password", StringComparison.OrdinalIgnoreCase) >= 0 ||
                 string.Equals(name, "pwd", StringComparison.OrdinalIgnoreCase));
        }

        /// <summary>The connections of this computer (<c>DriverName=ADO.NET</c>) of the file, in its order.</summary>
        /// <param name="path">The file; null or empty for <see cref="ExistingPath"/>.</param>
        public static List<DbxDirectConnection> ReadDirect(string path = null)
        {
            if (string.IsNullOrEmpty(path))
                path = ExistingPath();
            List<DbxDirectConnection> result = new List<DbxDirectConnection>();
            if (string.IsNullOrEmpty(path) || !File.Exists(path))
                return result;
            // The encoding of the file by the rule of DbxIniDocument (UTF-8 with BOM, or ANSI on Windows)
            foreach (DbxIniSection section in DbxIniDocument.Load(path).Sections())
            {
                DbxDirectConnection current = new DbxDirectConnection { Alias = section.Name, FileName = path };
                bool direct = false;
                foreach (KeyValuePair<string, string> pair in section.Keys)
                {
                    string key = pair.Key;
                    string value = pair.Value;
                    if (string.Equals(key, "DriverName", StringComparison.OrdinalIgnoreCase))
                        direct = string.Equals(value, DirectDriverName, StringComparison.OrdinalIgnoreCase);
                    else if (string.Equals(key, "ProviderFactory", StringComparison.OrdinalIgnoreCase))
                        current.ProviderFactory = value;
                    else if (string.Equals(key, "ConnectionString", StringComparison.OrdinalIgnoreCase))
                        current.ConnectionString = value;
                    else if (key.StartsWith(ParamPrefix, StringComparison.OrdinalIgnoreCase))
                        current.Parameters[key.Substring(ParamPrefix.Length)] = value;
                    else if (key.StartsWith(SecretPrefix, StringComparison.OrdinalIgnoreCase))
                        current.Secrets[key.Substring(SecretPrefix.Length)] = value;
                    else
                        current.Extra.Add(new KeyValuePair<string, string>(key, value));
                }
                if (direct)
                    result.Add(current);
            }
            return result;
        }

        /// <summary>The connection of this computer <paramref name="alias"/>, or null.</summary>
        /// <param name="alias">The alias (the case does not matter).</param>
        /// <param name="path">The file; null or empty for <see cref="ExistingPath"/>.</param>
        public static DbxDirectConnection FindDirect(string alias, string path = null)
        {
            if (string.IsNullOrWhiteSpace(alias))
                return null;
            foreach (DbxDirectConnection connection in ReadDirect(path))
                if (string.Equals(connection.Alias, alias.Trim(), StringComparison.OrdinalIgnoreCase))
                    return connection;
            return null;
        }

        /// <summary>
        /// The string that opens <paramref name="connection"/>: its <c>ConnectionString</c> (or, without one, its
        /// <c>Param.*</c> through the builder of <paramref name="factory"/>), with the password another program wrote in
        /// clear when the string does not have it, and its ciphered passwords deciphered. A password that cannot be
        /// deciphered here is asked to <paramref name="askPassword"/> (the parameter name; null: it is left out). The
        /// string of a connection without passwords is returned as it is.
        /// </summary>
        public static string BuildConnectionString(DbxDirectConnection connection, DbProviderFactory factory,
            Func<string, string> askPassword)
        {
            string connectionString = connection.ConnectionString ?? "";
            if (connectionString.Trim().Length == 0)
                connectionString = FromParameters(connection, factory);
            bool clearPassword = false;
            foreach (KeyValuePair<string, string> pair in connection.Parameters)
                if (IsPasswordName(pair.Key) && pair.Value.Length > 0)
                    clearPassword = true;
            if (!clearPassword && connection.Secrets.Count == 0)
                return connectionString;

            DbConnectionStringBuilder builder = new DbConnectionStringBuilder();
            builder.ConnectionString = connectionString;
            bool changed = false;
            // In clear, written by Reportman.Server or Delphi: only when the string does not carry it
            foreach (KeyValuePair<string, string> pair in connection.Parameters)
            {
                if (!IsPasswordName(pair.Key) || pair.Value.Length == 0 || HasKey(builder, pair.Key))
                    continue;
                SetPassword(builder, pair.Key, pair.Value);
                changed = true;
            }
            foreach (KeyValuePair<string, string> pair in connection.Secrets)
            {
                string password = Unprotect(pair.Value);
                if (password == null && askPassword != null)
                    password = askPassword(pair.Key);
                if (password == null)
                    continue;
                SetPassword(builder, pair.Key, password);
                changed = true;
            }
            return changed ? builder.ConnectionString : connectionString;
        }

        // The Param.* through the provider's builder: they are its CLR property names (DataSource, UserID...)
        private static string FromParameters(DbxDirectConnection connection, DbProviderFactory factory)
        {
            DbConnectionStringBuilder builder = null;
            try
            {
                if (factory != null)
                    builder = factory.CreateConnectionStringBuilder();
            }
            catch
            {
                builder = null;
            }
            if (builder == null)
                builder = new DbConnectionStringBuilder();
            PropertyDescriptorCollection properties = TypeDescriptor.GetProperties(builder);
            foreach (KeyValuePair<string, string> pair in connection.Parameters)
            {
                try
                {
                    PropertyDescriptor property = properties.Find(pair.Key, true);
                    if (property != null && !property.IsReadOnly && property.Converter != null &&
                        property.Converter.CanConvertFrom(typeof(string)))
                        property.SetValue(builder, property.Converter.ConvertFromInvariantString(pair.Value));
                    else
                        builder[pair.Key] = pair.Value;
                }
                catch
                {
                    try { builder[pair.Key] = pair.Value; }
                    catch { /* a parameter the provider does not know: left out */ }
                }
            }
            return builder.ConnectionString;
        }

        private static bool HasKey(DbConnectionStringBuilder builder, string key)
        {
            if (builder.ContainsKey(key))
                return true;
            if (IsPasswordSynonym(key))
                return builder.ContainsKey("password") || builder.ContainsKey("pwd");
            return false;
        }

        private static bool IsPasswordSynonym(string key)
        {
            return string.Equals(key, "password", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(key, "pwd", StringComparison.OrdinalIgnoreCase);
        }

        private static void SetPassword(DbConnectionStringBuilder builder, string key, string value)
        {
            if (IsPasswordSynonym(key))
            {
                // One password in the string: «pwd» and «password» are the same keyword
                foreach (string synonym in new string[] { "password", "pwd" })
                    if (!string.Equals(synonym, key, StringComparison.OrdinalIgnoreCase) && builder.ContainsKey(synonym))
                        builder.Remove(synonym);
            }
            builder[key] = value;
        }

        /// <summary>
        /// Writes <c>Secret.<paramref name="name"/>=<paramref name="value"/></c> in the section <paramref name="alias"/>
        /// (it must be a <c>DriverName=ADO.NET</c> one): the line that has it gets the new value, or one is added after
        /// the last line of the section (<see cref="DbxIniDocument.SetValues"/>). EVERY OTHER BYTE OF THE FILE STAYS AS
        /// IT WAS: the other keys and sections, the comments, the blank lines, the line endings, the BOM and the
        /// encoding (an ANSI file of Delphi too).
        /// </summary>
        public static void WriteSecret(string path, string alias, string name, string value)
        {
            if (string.IsNullOrEmpty(path) || !File.Exists(path))
                throw new FileNotFoundException("Connections file not found", path);
            if (string.IsNullOrWhiteSpace(alias) || string.IsNullOrWhiteSpace(name) || value == null ||
                value.IndexOfAny(new char[] { '\r', '\n' }) >= 0)
                throw new ArgumentException("Invalid secret for the connection " + alias);
            DbxIniDocument document = DbxIniDocument.Load(path);
            if (!document.HasSection(alias))
                throw new InvalidOperationException("The connection " + alias + " is not in " + path);
            string driver = document.GetValue(alias, "DriverName", "");
            if (!string.Equals(driver, DirectDriverName, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("The connection " + alias + " is not a connection of this computer (" + DirectDriverName + ")");
            if (document.SetValues(alias, new KeyValuePair<string, string>[] { new KeyValuePair<string, string>(SecretPrefix + name, value) }))
                document.Save();
        }

        // ---- DPAPI (crypt32 directly: no package for the engine, the same blobs as ProtectedData) ----

        /// <summary>Whether this computer can cipher a password (Windows).</summary>
        public static bool CanProtect
        {
            get { return Environment.OSVersion.Platform == PlatformID.Win32NT; }
        }

        /// <summary><paramref name="plain"/> ciphered for this Windows user (<c>dpapi:BASE64</c>), or null outside Windows.</summary>
        public static string Protect(string plain)
        {
            if (plain == null || !CanProtect)
                return null;
            byte[] data = Dpapi(Encoding.UTF8.GetBytes(plain), true);
            return data == null ? null : DpapiPrefix + Convert.ToBase64String(data);
        }

        /// <summary>
        /// The password of a <c>dpapi:</c> value, or null when it is not this user's (another Windows user, another
        /// computer), it is not a <c>dpapi:</c> value or this is not Windows.
        /// </summary>
        public static string Unprotect(string stored)
        {
            if (string.IsNullOrEmpty(stored) || !stored.StartsWith(DpapiPrefix, StringComparison.Ordinal) || !CanProtect)
                return null;
            byte[] blob;
            try
            {
                blob = Convert.FromBase64String(stored.Substring(DpapiPrefix.Length).Trim());
            }
            catch (FormatException)
            {
                return null;
            }
            byte[] data = Dpapi(blob, false);
            if (data == null)
                return null;
            try
            {
                return Encoding.UTF8.GetString(data);
            }
            finally
            {
                Array.Clear(data, 0, data.Length);
            }
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct DataBlob
        {
            public int Size;
            public IntPtr Data;
        }

        private const int CRYPTPROTECT_UI_FORBIDDEN = 0x1;

        [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CryptProtectData(ref DataBlob dataIn, string description, ref DataBlob entropy,
            IntPtr reserved, IntPtr prompt, int flags, out DataBlob dataOut);

        [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CryptUnprotectData(ref DataBlob dataIn, IntPtr description, ref DataBlob entropy,
            IntPtr reserved, IntPtr prompt, int flags, out DataBlob dataOut);

        [DllImport("kernel32.dll")]
        private static extern IntPtr LocalFree(IntPtr memory);

        private static byte[] Dpapi(byte[] input, bool protect)
        {
            DataBlob dataIn = new DataBlob();
            DataBlob entropy = new DataBlob();
            DataBlob dataOut = new DataBlob();
            try
            {
                dataIn.Size = input.Length;
                dataIn.Data = Marshal.AllocHGlobal(Math.Max(input.Length, 1));
                Marshal.Copy(input, 0, dataIn.Data, input.Length);
                entropy.Size = Entropy.Length;
                entropy.Data = Marshal.AllocHGlobal(Entropy.Length);
                Marshal.Copy(Entropy, 0, entropy.Data, Entropy.Length);
                bool ok = protect
                    ? CryptProtectData(ref dataIn, "", ref entropy, IntPtr.Zero, IntPtr.Zero, CRYPTPROTECT_UI_FORBIDDEN, out dataOut)
                    : CryptUnprotectData(ref dataIn, IntPtr.Zero, ref entropy, IntPtr.Zero, IntPtr.Zero, CRYPTPROTECT_UI_FORBIDDEN, out dataOut);
                if (!ok || dataOut.Data == IntPtr.Zero)
                    return null;
                byte[] result = new byte[dataOut.Size];
                Marshal.Copy(dataOut.Data, result, 0, dataOut.Size);
                return result;
            }
            catch (DllNotFoundException)
            {
                return null;
            }
            catch (EntryPointNotFoundException)
            {
                return null;
            }
            finally
            {
                if (dataIn.Data != IntPtr.Zero)
                {
                    // The password in clear does not stay in memory
                    if (protect)
                        Marshal.Copy(new byte[input.Length], 0, dataIn.Data, input.Length);
                    Marshal.FreeHGlobal(dataIn.Data);
                }
                if (entropy.Data != IntPtr.Zero)
                    Marshal.FreeHGlobal(entropy.Data);
                if (dataOut.Data != IntPtr.Zero)
                {
                    if (!protect)
                        Marshal.Copy(new byte[dataOut.Size], 0, dataOut.Data, dataOut.Size);
                    LocalFree(dataOut.Data);
                }
            }
        }
    }
}
