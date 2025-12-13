using System;
using System.IO;
using System.Collections.Generic;
using System.Security.Cryptography;

namespace Reportman.Drawing
{
    public class FileHash
    {
        public string FullPath; // relativo a la carpeta base
        public string Hash;
    }

    public class FileHashes
    {
        public List<FileHash> Hashes = new List<FileHash>();
        public DateTime DateTimeCreatedUtc;
    }

    public static class HashGenerator
    {
        /// <summary>
        /// Generate SHA256 hashes from files for folders and subfolders.
        /// </summary>
        /// <param name="baseFolder">Path</param>
        /// <returns>FileHashes</returns>
        public static FileHashes GenerateHashes(string baseFolder)
        {
            if (string.IsNullOrEmpty(baseFolder))
                throw new ArgumentNullException("baseFolder");

            if (!Directory.Exists(baseFolder))
                throw new DirectoryNotFoundException("Folder does not exists: " + baseFolder);

            var result = new FileHashes();
            result.DateTimeCreatedUtc = DateTime.UtcNow;

            string[] files = Directory.GetFiles(baseFolder, "*", SearchOption.AllDirectories);

            foreach (string file in files)
            {
                using (var sha256 = SHA256.Create())
                using (var stream = File.OpenRead(file))
                {
                    byte[] hashBytes = sha256.ComputeHash(stream);
                    string hashString = BitConverter.ToString(hashBytes).Replace("-", "").ToLowerInvariant();

                    string relativePath = file.Substring(baseFolder.Length).TrimStart(Path.DirectorySeparatorChar);

                    var fh = new FileHash();
                    fh.FullPath = relativePath.Replace("\\", "/"); // normalizamos separadores
                    fh.Hash = hashString;

                    result.Hashes.Add(fh);
                }
            }

            return result;
        }
    }
}