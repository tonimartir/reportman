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

using Reportman.Reporting;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;

namespace Reportman.Designer
{
    /// <summary>
    /// Reads/writes the shared <c>dbxconnections.ini</c> used by both the Delphi and
    /// the .Net designers to store connection definitions. For HTTP Agent connections
    /// it keeps the sensitive data (API key, selected Hub database) here instead of in
    /// the report, exactly like Delphi. Path resolution and section/key names are kept
    /// compatible with Delphi (see Reportman.Reporting.DatabaseInfo dbx config reader).
    /// The file is read and written by the rules of <see cref="DbxIniDocument"/> (UTF-8
    /// with its BOM, or the ANSI code page on Windows; only the lines that change are
    /// written again).
    /// </summary>
    public static class DbxConnections
    {
        /// <summary>Driver name written for agent connections (same literal Delphi uses).</summary>
        public const string AGENT_DRIVER_NAME = "Reportman AI Agent";

        /// <summary>
        /// Test-only override of the file path (used by the self-tests so the shared file is not touched). It is the
        /// engine's <see cref="Reportman.Reporting.DbxDirectConnections.OverridePath"/>: the reports run against the
        /// same file the designer writes.
        /// </summary>
        public static string OverridePath
        {
            get { return Reportman.Reporting.DbxDirectConnections.OverridePath; }
            set { Reportman.Reporting.DbxDirectConnections.OverridePath = value; }
        }

        /// <summary>
        /// The connections of this computer (<c>DriverName=ADO.NET</c> sections, written by Reportman.Server, the
        /// Reportman AI Desktop and the chat), in the order of the file. A report that uses one keeps only its alias.
        /// </summary>
        public static List<Reportman.Reporting.DbxDirectConnection> GetDirectConnections()
        {
            string path = ResolveExistingPath();
            if (path.Length == 0)
                return new List<Reportman.Reporting.DbxDirectConnection>();
            try
            {
                return Reportman.Reporting.DbxDirectConnections.ReadDirect(path);
            }
            catch
            {
                return new List<Reportman.Reporting.DbxDirectConnection>();
            }
        }

        /// <summary>The connection of this computer <paramref name="alias"/>, or null.</summary>
        public static Reportman.Reporting.DbxDirectConnection FindDirectConnection(string alias)
        {
            if (string.IsNullOrWhiteSpace(alias))
                return null;
            foreach (Reportman.Reporting.DbxDirectConnection connection in GetDirectConnections())
                if (string.Equals(connection.Alias, alias.Trim(), StringComparison.OrdinalIgnoreCase))
                    return connection;
            return null;
        }

        /// <summary>Candidate paths in the same order as DatabaseInfo's dbx config reader.</summary>
        public static IEnumerable<string> Candidates()
        {
            string pub = Environment.GetEnvironmentVariable("PUBLIC");
            if (!string.IsNullOrWhiteSpace(pub))
                yield return Path.Combine(pub, "dbxconnections.ini");

            string sysDrive = Environment.GetEnvironmentVariable("SystemDrive");
            if (!string.IsNullOrWhiteSpace(sysDrive))
                yield return Path.Combine(sysDrive + Path.DirectorySeparatorChar, "Users", "Public", "dbxconnections.ini");

            string commonData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
            if (!string.IsNullOrWhiteSpace(commonData))
                yield return Path.Combine(commonData, "dbxconnections.ini");

            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            if (!string.IsNullOrWhiteSpace(baseDir))
                yield return Path.Combine(baseDir, "dbxconnections.ini");
        }

        /// <summary>First existing dbxconnections.ini, or "" if none exists yet.</summary>
        public static string ResolveExistingPath()
        {
            if (!string.IsNullOrEmpty(OverridePath))
                return File.Exists(OverridePath) ? OverridePath : "";
            foreach (string c in Candidates())
                if (File.Exists(c))
                    return c;
            return "";
        }

        /// <summary>Path to write to: the existing file if any, otherwise the preferred default.</summary>
        public static string ResolveWritePath()
        {
            if (!string.IsNullOrEmpty(OverridePath))
                return OverridePath;
            string existing = ResolveExistingPath();
            if (existing.Length > 0)
                return existing;
            foreach (string c in Candidates())
                return c;
            return "";
        }

        /// <summary>Path shown to the user (existing or the one that would be created).</summary>
        public static string GetPath()
        {
            string p = ResolveWritePath();
            return p.Length == 0 ? "(not available)" : p;
        }

        // The file by the rule of the engine (DbxIniDocument): UTF-8 with its BOM, or the ANSI code page on Windows
        private static DbxIniDocument Read(string path)
        {
            try
            {
                if (!string.IsNullOrEmpty(path) && File.Exists(path))
                    return DbxIniDocument.Load(path);
            }
            catch { }
            return DbxIniDocument.Parse(new byte[0]);
        }

        /// <summary>All connection (section) names in the file.</summary>
        public static List<string> GetConnectionNames()
        {
            return Read(ResolveExistingPath()).SectionNames();
        }

        /// <summary>True if the section's DriverName is a Reportman agent driver.</summary>
        public static bool IsAgentConnection(string alias)
        {
            return IsAgentDriver(Read(ResolveExistingPath()).GetValue(alias, "DriverName", ""));
        }

        private static bool IsAgentDriver(string driver)
        {
            return string.Equals(driver, AGENT_DRIVER_NAME, StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(driver, "Reportman Agent", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(driver, "Http Agent", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(driver, "HttpAgent", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// The API keys of all the agent connections of the file, each once and in the file's order:
        /// the copilot lists the schemas of every one of them, as the Delphi designer does.
        /// </summary>
        public static List<string> GetAgentApiKeys()
        {
            var result = new List<string>();
            DbxIniDocument document = Read(ResolveExistingPath());
            foreach (string alias in document.SectionNames())
            {
                if (!IsAgentDriver(document.GetValue(alias, "DriverName", "")))
                    continue;
                string apiKey = document.GetValue(alias, "ApiKey", "").Trim();
                if (apiKey.Length > 0 && !result.Contains(apiKey))
                    result.Add(apiKey);
            }
            return result;
        }

        /// <summary>Read the HTTP Agent parameters stored for a connection alias.</summary>
        public static void ReadAgent(string alias, out string apiKey, out long hubDatabaseId, out string baseUrl)
        {
            DbxIniDocument document = Read(ResolveExistingPath());
            apiKey = document.GetValue(alias, "ApiKey", "");
            baseUrl = document.GetValue(alias, "Url", "");
            if (baseUrl.Length == 0)
                baseUrl = document.GetValue(alias, "HttpAgentBaseUrl", "");
            long.TryParse(document.GetValue(alias, "HubDatabaseId", "0"), NumberStyles.Integer,
                CultureInfo.InvariantCulture, out hubDatabaseId);
        }

        /// <summary>
        /// Write/update the HTTP Agent parameters for a connection alias, touching only its lines: the keys that
        /// change get their new value where they are, the missing ones are added at the end of the section, and a new
        /// section goes at the end of the file. Every other byte of the shared Delphi/.Net file stays as it was (its
        /// encoding and BOM, its line endings, the accents of the Delphi sections, the comments).
        /// </summary>
        public static void WriteAgent(string alias, string apiKey, long hubDatabaseId, string baseUrl)
        {
            string path = ResolveWritePath();
            if (path.Length == 0)
                throw new Exception("No writable dbxconnections.ini location found.");

            DbxIniDocument document = DbxIniDocument.Load(path);
            bool changed = document.SetValues(alias, new KeyValuePair<string, string>[]
            {
                new KeyValuePair<string, string>("DriverName", AGENT_DRIVER_NAME),
                new KeyValuePair<string, string>("ApiKey", apiKey ?? ""),
                new KeyValuePair<string, string>("HubDatabaseId", hubDatabaseId.ToString(CultureInfo.InvariantCulture))
            });
            // Note: the agent base URL is environment-determined (build) and not stored
            // here on purpose, so a shared file works for both dev and prod.
            if (changed || !File.Exists(path))
                document.Save(path);
        }
    }
}
