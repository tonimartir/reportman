using Reportman.Drawing;
using System;
using System.Collections.Generic;
using System.IO;

namespace Reportman.Designer
{
    internal sealed class DelphiRecentFiles
    {
        private const string FilenameKey = "Filename";
        private const string SaveCountKey = "SaveCount";
        private const int DefaultHistoryCount = 7;
        private readonly List<string> entries = new List<string>();

        public int HistoryCount { get; set; } = DefaultHistoryCount;
        public int SaveIndex { get; set; }
        public IReadOnlyList<string> Entries => entries;

        public static string GetConfigFilename()
        {
            string configPath = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData, Environment.SpecialFolderOption.Create);
            return Path.Combine(configPath, "repmand.ini");
        }

        public void Load(string filename = null)
        {
            entries.Clear();
            IniFile inif = new IniFile(filename ?? GetConfigFilename());
            int count = inif.ReadInteger(GetSectionName(), SaveCountKey, 0);
            for (int index = 0; index < count; index++)
            {
                entries.Add(inif.ReadString(GetEntrySectionName(index), FilenameKey, string.Empty));
            }
            AdjustSize();
        }

        public void Save(string filename = null)
        {
            string configFilename = filename ?? GetConfigFilename();
            string directory = Path.GetDirectoryName(configFilename);
            if (!string.IsNullOrEmpty(directory) && !Directory.Exists(directory))
            {
                Directory.CreateDirectory(directory);
            }

            IniFile inif = new IniFile(configFilename);
            inif.WriteInteger(GetSectionName(), SaveCountKey, entries.Count);
            for (int index = 0; index < entries.Count; index++)
            {
                inif.WriteString(GetEntrySectionName(index), FilenameKey, entries[index]);
            }
            inif.SaveToFile(configFilename);
        }

        public void UseString(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return;
            }

            int existingIndex = entries.FindIndex(item => string.Equals(item, value, StringComparison.OrdinalIgnoreCase));
            if (existingIndex >= 0)
            {
                entries.RemoveAt(existingIndex);
            }

            entries.Insert(0, value);
            AdjustSize();
        }

        public static string ShortenForDisplay(string value, int width)
        {
            if (string.IsNullOrEmpty(value) || value.Length <= width || width <= 3)
            {
                return value;
            }

            return "..." + value.Substring(value.Length - (width - 3));
        }

        private void AdjustSize()
        {
            if (HistoryCount < 1)
            {
                HistoryCount = 1;
            }

            while (entries.Count > HistoryCount)
            {
                entries.RemoveAt(entries.Count - 1);
            }
        }

        private string GetSectionName()
        {
            return "LastUsed" + SaveIndex.ToString();
        }

        private string GetEntrySectionName(int index)
        {
            return GetSectionName() + "-" + index.ToString();
        }
    }
}