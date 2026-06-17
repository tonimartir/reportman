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
using System.Globalization;
using System.IO;
using System.Text;

namespace Reportman.Designer
{
    /// <summary>
    /// Reads/writes the shared <c>dbxconnections.ini</c> used by both the Delphi and
    /// the .Net designers to store connection definitions. For HTTP Agent connections
    /// it keeps the sensitive data (API key, selected Hub database) here instead of in
    /// the report, exactly like Delphi. Path resolution and section/key names are kept
    /// compatible with Delphi (see Reportman.Reporting.DatabaseInfo dbx config reader).
    /// </summary>
    public static class DbxConnections
    {
        /// <summary>Driver name written for agent connections (same literal Delphi uses).</summary>
        public const string AGENT_DRIVER_NAME = "Reportman AI Agent";

        /// <summary>Test-only override of the file path (used by the wizard self-test so the shared file is not touched).</summary>
        public static string OverridePath = null;

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

        private static string[] ReadLines(string path)
        {
            try
            {
                if (File.Exists(path))
                    return File.ReadAllLines(path);
            }
            catch { }
            return new string[0];
        }

        private static bool IsSectionHeader(string line, out string name)
        {
            name = "";
            string t = line.Trim();
            if (t.Length >= 2 && t[0] == '[' && t[t.Length - 1] == ']')
            {
                name = t.Substring(1, t.Length - 2).Trim();
                return true;
            }
            return false;
        }

        /// <summary>All connection (section) names in the file.</summary>
        public static List<string> GetConnectionNames()
        {
            var result = new List<string>();
            foreach (string line in ReadLines(ResolveExistingPath()))
            {
                string name;
                if (IsSectionHeader(line, out name) && name.Length > 0)
                    result.Add(name);
            }
            return result;
        }

        private static string GetValue(string[] lines, string section, string key, string def)
        {
            bool inSection = false;
            foreach (string line in lines)
            {
                string secName;
                if (IsSectionHeader(line, out secName))
                {
                    inSection = string.Equals(secName, section, StringComparison.OrdinalIgnoreCase);
                    continue;
                }
                if (!inSection)
                    continue;
                int eq = line.IndexOf('=');
                if (eq > 0)
                {
                    string k = line.Substring(0, eq).Trim();
                    if (string.Equals(k, key, StringComparison.OrdinalIgnoreCase))
                        return line.Substring(eq + 1).Trim();
                }
            }
            return def;
        }

        /// <summary>True if the section's DriverName is a Reportman agent driver.</summary>
        public static bool IsAgentConnection(string alias)
        {
            string driver = GetValue(ReadLines(ResolveExistingPath()), alias, "DriverName", "");
            return string.Equals(driver, AGENT_DRIVER_NAME, StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(driver, "Reportman Agent", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(driver, "Http Agent", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(driver, "HttpAgent", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>Read the HTTP Agent parameters stored for a connection alias.</summary>
        public static void ReadAgent(string alias, out string apiKey, out long hubDatabaseId, out string baseUrl)
        {
            string[] lines = ReadLines(ResolveExistingPath());
            apiKey = GetValue(lines, alias, "ApiKey", "");
            baseUrl = GetValue(lines, alias, "Url", "");
            if (baseUrl.Length == 0)
                baseUrl = GetValue(lines, alias, "HttpAgentBaseUrl", "");
            long.TryParse(GetValue(lines, alias, "HubDatabaseId", "0"), NumberStyles.Integer,
                CultureInfo.InvariantCulture, out hubDatabaseId);
        }

        /// <summary>
        /// Write/update the HTTP Agent parameters for a connection alias, preserving all
        /// other sections and lines (so a shared Delphi/.Net file stays intact).
        /// </summary>
        public static void WriteAgent(string alias, string apiKey, long hubDatabaseId, string baseUrl)
        {
            string path = ResolveWritePath();
            if (path.Length == 0)
                throw new Exception("No writable dbxconnections.ini location found.");

            var lines = new List<string>(ReadLines(path));
            SetKey(lines, alias, "DriverName", AGENT_DRIVER_NAME);
            SetKey(lines, alias, "ApiKey", apiKey ?? "");
            SetKey(lines, alias, "HubDatabaseId", hubDatabaseId.ToString(CultureInfo.InvariantCulture));
            // Note: the agent base URL is environment-determined (build) and not stored
            // here on purpose, so a shared file works for both dev and prod.

            string dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                Directory.CreateDirectory(dir);
            File.WriteAllLines(path, lines, new UTF8Encoding(false));
        }

        private static int FindSection(List<string> lines, string section)
        {
            for (int i = 0; i < lines.Count; i++)
            {
                string name;
                if (IsSectionHeader(lines[i], out name) &&
                    string.Equals(name, section, StringComparison.OrdinalIgnoreCase))
                    return i;
            }
            return -1;
        }

        private static void SetKey(List<string> lines, string section, string key, string value)
        {
            int secStart = FindSection(lines, section);
            if (secStart < 0)
            {
                if (lines.Count > 0 && lines[lines.Count - 1].Trim().Length > 0)
                    lines.Add("");
                lines.Add("[" + section + "]");
                lines.Add(key + "=" + value);
                return;
            }
            int secEnd = lines.Count;
            for (int i = secStart + 1; i < lines.Count; i++)
            {
                string ignore;
                if (IsSectionHeader(lines[i], out ignore))
                {
                    secEnd = i;
                    break;
                }
            }
            for (int i = secStart + 1; i < secEnd; i++)
            {
                int eq = lines[i].IndexOf('=');
                if (eq > 0)
                {
                    string k = lines[i].Substring(0, eq).Trim();
                    if (string.Equals(k, key, StringComparison.OrdinalIgnoreCase))
                    {
                        lines[i] = key + "=" + value;
                        return;
                    }
                }
            }
            // insert at the end of the section (skip trailing blank lines)
            int insertAt = secEnd;
            while (insertAt - 1 > secStart && lines[insertAt - 1].Trim().Length == 0)
                insertAt--;
            lines.Insert(insertAt, key + "=" + value);
        }
    }
}
