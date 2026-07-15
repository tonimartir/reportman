using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;

namespace Reportman.Drawing
{
    /// <summary>
    /// Pairs a file's path (relative to a base folder) with its computed content hash.
    /// </summary>
    public class FileHash
    {
        /// <summary>
        /// The file path relative to the base folder.
        /// </summary>
        public string FullPath; // relativo a la carpeta base
        /// <summary>
        /// The computed SHA-256 hash string for the file.
        /// </summary>
        public string Hash;
    }

    /// <summary>
    /// A snapshot of file hashes for a folder tree, with the UTC timestamp at which it was generated.
    /// </summary>
    public class FileHashes
    {
        /// <summary>
        /// The list of computed file hashes.
        /// </summary>
        public List<FileHash> Hashes = new();
        /// <summary>
        /// The date and time (in UTC) when the snapshot was generated.
        /// </summary>
        public DateTime DateTimeCreatedUtc;
    }

    /// <summary>
    /// Computes SHA-256 hashes for every file under a folder and its subfolders.
    /// </summary>
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