using System;
using System.Collections.Generic;
using System.Data;
using System.IO;
using System.Reflection;

namespace Reportman.Drawing
{
    /// <summary>
    /// Callback invoked during a file-copy/update operation to report progress for the current file
    /// and allow the handler to request cancellation via the <c>docancel</c> reference parameter.
    /// </summary>
    public delegate void CopyProgress(string filename, int file,
     int filecount, int position, int size, ref bool docancel);
    /// <summary>
    /// Helper for reading assembly and file version numbers and deciding whether one version
    /// supersedes another, used to determine when files require upgrading.
    /// </summary>
    public class VersionInfo
    {
#if PocketPC
#else
        /// <summary>
        /// Reads the assembly version stored in the metadata of the specified assembly file.
        /// </summary>
        /// <param name="filename">Path to the assembly file to inspect.</param>
        /// <returns>The <see cref="Version"/> declared by the assembly.</returns>
        public static Version GetAssemblyVersion(string filename)
        {

            Version xversion;
            AssemblyName nname = AssemblyName.GetAssemblyName(filename);
            xversion = nname.Version;



            return xversion;
        }
        /// <summary>
        /// Reads the file version from a file's version-information resource, which works even when the
        /// file targets a .NET version newer than the one that compiled this code.
        /// </summary>
        /// <param name="filename">Path to the file to inspect.</param>
        /// <returns>A <see cref="Version"/> built from the file's major, minor, build and private parts.</returns>
        public static Version GetFileVersion(string filename)
        {
            // To allow the open of any file including .Net versions newer than
            // the compiled version FileVersion is used instead
            System.Diagnostics.FileVersionInfo finfo = System.Diagnostics.FileVersionInfo.GetVersionInfo(filename);
            Version aversion = new Version(finfo.FileMajorPart, finfo.FileMinorPart, finfo.FileBuildPart, finfo.FilePrivatePart);

            return aversion;
        }
#endif
        /// <summary>
        /// Returns the version of the assembly that called this method.
        /// </summary>
        /// <returns>The <see cref="Version"/> of the calling assembly.</returns>
        public static Version GetAssemblyVersion()
        {
            return Assembly.GetCallingAssembly().GetName().Version;
        }
        /// <summary>
        /// Determines whether <paramref name="newversion"/> supersedes <paramref name="oldversion"/> by
        /// comparing the major, minor, build and revision components in order.
        /// </summary>
        /// <param name="oldversion">The currently installed version.</param>
        /// <param name="newversion">The candidate version to compare against.</param>
        /// <returns><c>true</c> if <paramref name="newversion"/> is greater than <paramref name="oldversion"/>; otherwise <c>false</c>.</returns>
        public static bool RequireUpgrade(Version oldversion, Version newversion)
        {
            if (newversion.Major > oldversion.Major)
                return true;
            if (newversion.Major < oldversion.Major)
                return false;
            if (newversion.Minor > oldversion.Minor)
                return true;
            if (newversion.Minor < oldversion.Minor)
                return false;

            if (newversion.Build > oldversion.Build)
                return true;
            if (newversion.Build < oldversion.Build)
                return false;
            if (newversion.Revision > oldversion.Revision)
                return true;
            if (newversion.Revision < oldversion.Revision)
                return false;
            return false;
        }
        /// <summary>
        /// Determines whether the assembly in <paramref name="newfilename"/> supersedes the one in
        /// <paramref name="oldfilename"/> by comparing their assembly versions.
        /// </summary>
        /// <param name="oldfilename">Path to the currently installed assembly file.</param>
        /// <param name="newfilename">Path to the candidate assembly file.</param>
        /// <returns><c>true</c> if the new file's version is greater than the old file's version; otherwise <c>false</c>.</returns>
        public static bool RequireUpgrade(string oldfilename, string newfilename)
        {
            Version oldversion = GetAssemblyVersion(oldfilename);
            Version newversion = GetAssemblyVersion(newfilename);
            return VersionInfo.RequireUpgrade(oldversion, newversion);
        }
    }
    /// <summary>
    /// Applies file updates to a target directory, scanning source folders, detecting modified files
    /// by hash or timestamp, optionally backing up existing files and reporting progress as content is written.
    /// </summary>
    public class Updater
    {
        string FFilePath;
        /// <summary>
        /// When <c>true</c>, existing files are moved into a timestamped backup folder before being overwritten.
        /// </summary>
        public bool PerformBackup;
        /// <summary>
        /// Optional callback invoked while files are being written so the caller can display progress and cancel.
        /// </summary>
        public CopyProgress OnProgress;
        /// <summary>
        /// When <c>true</c>, the currently executing assembly's file is skipped so it is not overwritten while in use.
        /// </summary>
        public bool ExcludeExecutingAssembly;
        /// <summary>
        /// Gets the target directory into which files are updated.
        /// </summary>
        public string FilePath
        {
            get { return FFilePath; }
        }
        /// <summary>
        /// Initializes a new <see cref="Updater"/> that writes files into the given target directory.
        /// </summary>
        /// <param name="fpath">The destination directory for updated files.</param>
        public Updater(string fpath)
        {
            FFilePath = fpath;
            PerformBackup = false;
            ExcludeExecutingAssembly = false;
        }
        /// <summary>
        /// Synchronously builds a table of the files that changed between two hash sets, optionally loading each
        /// changed file's content. This is a blocking wrapper around <see cref="GetModifiedFilesAsync"/>.
        /// </summary>
        /// <param name="files">Table describing the candidate files (as produced by <see cref="CreateFilesTable"/>).</param>
        /// <param name="filesdir">Root directory the file paths are relative to.</param>
        /// <param name="copycontent">When <c>true</c>, the content of each changed file is read into the STREAM column.</param>
        /// <param name="olderHashes">Hashes of the currently installed files, keyed by full path; may be <c>null</c>.</param>
        /// <param name="updatedHashes">Hashes of the candidate files, keyed by full path; may be <c>null</c>.</param>
        /// <returns>A new table containing only the rows whose files must be updated.</returns>
        public static DataTable GetModifiedFiles(DataTable files, string filesdir, bool copycontent,
            SortedList<string, FileHash> olderHashes, SortedList<string, FileHash> updatedHashes)
        {
            var tarea = GetModifiedFilesAsync(files, filesdir, copycontent, olderHashes, updatedHashes);
            tarea.Wait();
            if (tarea.Exception != null)
            {
                throw tarea.Exception;
            }
            return tarea.Result;
        }

        /// <summary>
        /// Asynchronously compares candidate files against installed ones (optionally using hash lookups) to decide which require updating.
        /// </summary>
        /// <param name="files">Table containing the candidate file rows.</param>
        /// <param name="filesdir">Root directory for resolving full paths.</param>
        /// <param name="copycontent">When true, reads file streams into the STREAM column.</param>
        /// <param name="olderHashes">Hashes of currently installed files.</param>
        /// <param name="updatedHashes">Hashes of candidate files.</param>
        /// <returns>A task representing the operation, returning the filtered DataTable.</returns>
        public static async System.Threading.Tasks.Task<DataTable> GetModifiedFilesAsync(DataTable files, string filesdir, 
            bool copycontent, SortedList<string, FileHash> olderHashes, SortedList<string, FileHash> updatedHashes)
        {
            DataTable xtable = CreateFilesTable();
            try
            {
                foreach (DataRow newrow in files.Rows)
                {
                    bool doupdate = false;
                    string fullPath = newrow["FULLPATH"].ToString();
                    if (olderHashes!= null && updatedHashes != null)
                    {
                        if (!olderHashes.ContainsKey(fullPath))
                        {
                            doupdate = true;
                        } else 
                        if (!updatedHashes.ContainsKey(fullPath))
                        {
                            doupdate = true;
                        } else
                        {
                            var oldHash = olderHashes[fullPath];
                            var newHash = updatedHashes[fullPath];
                            if (oldHash.Hash != newHash.Hash)
                            {
                                doupdate = true;
                            }
                        }
                    } else
                    {
                        doupdate = true;
                    }
                    if (doupdate)
                    {
                        DataRow xrow = xtable.NewRow();
                        foreach (DataColumn ncol in files.Columns)
                        {
                            xrow[ncol.ColumnName] = newrow[ncol.ColumnName];
                        }
                        if (copycontent)
                        {
                            string fullname = Path.Combine(filesdir, newrow["PATH"].ToString());
                            fullname = Path.Combine(fullname, newrow["FILE"].ToString());

                            using (var mstream = await StreamUtil.FileToMemoryStreamAsync(fullname))
                            {
                                xrow["STREAM"] = mstream.ToArray();
                            }
                        }
                        xtable.Rows.Add(xrow);
                    }
                }
            }
            catch
            {
                xtable.Dispose();
                throw;
            }
            return xtable;
        }
        /// <summary>
        /// Creates a new DataTable schema configured with columns for tracking file paths, streams, and modification dates.
        /// </summary>
        /// <returns>A configured DataTable instance.</returns>
        public static DataTable CreateFilesTable()
        {
            DataTable xtable = new DataTable();
            xtable.Columns.Add("FULLPATH", System.Type.GetType("System.String"));
            xtable.Columns.Add("PATH", System.Type.GetType("System.String"));
            xtable.Columns.Add("FILE", System.Type.GetType("System.String"));
            xtable.Columns.Add("STREAM", System.Type.GetType("System.Byte[]"));
            xtable.Columns.Add("MODIFIED", System.Type.GetType("System.DateTime"));
            xtable.Columns.Add("CREATED", System.Type.GetType("System.DateTime"));

            xtable.Constraints.Add("PRIMPATH", xtable.Columns[0], true);
            return xtable;
        }
        /// <summary>
        /// Recursively scans a source directory and populates the provided files table with file metadata.
        /// </summary>
        /// <param name="xtable">The target files table to populate.</param>
        /// <param name="sourcedir">The physical source folder to scan.</param>
        /// <param name="subdir">The relative subfolder prefix for file paths.</param>
        /// <param name="copycontent">If true, reads and stores the raw bytes of each scanned file.</param>
        public void FillFiles(DataTable xtable, string sourcedir, string subdir, bool copycontent)
        {
            string[] nfilescontent = Directory.GetFiles(sourcedir, "*.*", SearchOption.AllDirectories);

            foreach (string fname in nfilescontent)
            {
                FileInfo ninfo = new FileInfo(fname);
                if (System.IO.Path.GetFileName(fname).ToUpper() != "THUMBS.DB")
                {
                    DataRow xrow = xtable.NewRow();
                    //xrow["MODIFIED"] = ninfo.LastWriteTimeUtc;
                    xrow["MODIFIED"] = ninfo.LastWriteTime;
                    xrow["CREATED"] = ninfo.CreationTime;
                    string dirname = Path.GetDirectoryName(fname);
                    int findex = fname.IndexOf(sourcedir);
                    if (findex >= 0)
                    {
                        dirname = dirname.Substring(findex + sourcedir.Length, dirname.Length - findex - sourcedir.Length);
                    }
                    if (dirname == "\\")
                        dirname = "";
                    if (dirname.Length > 1)
                    {
                        if (dirname[0] == '\\')
                            dirname = dirname.Substring(1, dirname.Length - 1);
                    }

                    xrow["PATH"] = dirname;
                    xrow["FILE"] = Path.GetFileName(fname);
                    string fullpath = Path.Combine(dirname, xrow["FILE"].ToString()).ToUpper();
                    xrow["FULLPATH"] = fullpath;
                    if (copycontent)
                    {
                        using (FileStream fstream = new FileStream(fname, FileMode.Open, FileAccess.Read))
                        {
                            using (MemoryStream mstream = new MemoryStream())
                            {
                                const int BUFSIZE = 8192;
                                byte[] buf = new byte[BUFSIZE];
                                int readed;
                                do
                                {
                                    readed = fstream.Read(buf, 0, BUFSIZE);
                                    mstream.Write(buf, 0, readed);
                                } while (readed > 0);
                                xrow["STREAM"] = mstream.ToArray();
                            }
                        }
                    }
                    xtable.Rows.Add(xrow);
                }
            }
        }
        /// <summary>
        /// Scans a source directory and returns a files table containing metadata for all files found.
        /// </summary>
        /// <param name="sourcedir">The folder to scan.</param>
        /// <param name="copycontent">If true, reads and stores the raw bytes of each file.</param>
        /// <returns>A DataTable containing files metadata.</returns>
        public DataTable GetFiles(string sourcedir, bool copycontent)
        {
            DataTable xtable = CreateFilesTable();
            try
            {
                FillFiles(xtable, sourcedir, "", copycontent);
            }
            catch
            {
                xtable.Dispose();
                throw;
            }
            return xtable;
        }
        /// <summary>
        /// Replaces currently installed files with the update files specified in the table, optionally creating backups.
        /// </summary>
        /// <param name="files">A table containing the replacement files and their streams.</param>
        public void Update(DataTable files)
        {
            if (files == null)
                throw new Exception("No se actualizaron archivos porque no se proporcionaron");
            DateTime mmfirst = System.DateTime.Now;
            string excludefilename = "";
            if (ExcludeExecutingAssembly)
            {
                excludefilename = System.Reflection.Assembly.GetExecutingAssembly().Location;
                excludefilename = Path.GetFileName(excludefilename);
                excludefilename = excludefilename.ToUpper();
            }
            const int BUFSIZE = 8192;
            byte[] buf = new byte[BUFSIZE];

            string backpath = "";
            // Create temp dir
            if (PerformBackup)
            {
                backpath = FFilePath + "CC" + System.DateTime.Now.ToString("ddMMyyyyHH_mm_ss");
                Directory.CreateDirectory(backpath);
            }
            int countfile = 1;

            // Check if all the files are ready to upgrade
            foreach (DataRow frow in files.Rows)
            {
                DateTime datemodified = (DateTime)frow["MODIFIED"];
                string npath = Path.Combine(FFilePath, frow["PATH"].ToString());
                Directory.CreateDirectory(npath);
                string filename = npath + Path.DirectorySeparatorChar + frow["FILE"].ToString();
                FileInfo nfinfo = new FileInfo(filename);
                bool docancel = false;
                if (OnProgress != null)
                    OnProgress(filename, countfile, files.Rows.Count, 0, ((byte[])frow["STREAM"]).Length, ref docancel);
                bool requireupgrade = true;
                if (nfinfo.Exists)
                {
                    //              if (nfinfo.LastWriteTimeUtc >= datemodified)
                    if (nfinfo.LastWriteTime >= datemodified)
                        requireupgrade = false;
                }
                else
                    requireupgrade = false;

                if ((excludefilename.Length > 0) && requireupgrade)
                {
                    if (frow["FILE"].ToString().ToUpper() == excludefilename)
                        requireupgrade = false;
                }
                if (requireupgrade)
                {
                    if (StreamUtil.FileInUse(filename))
                    {
                        throw new Exception("File in use: " + filename);
                    }
                }
            }
            bool hasCreatedColumn = files.Columns.IndexOf("CREATED")>=0;
            foreach (DataRow xrow in files.Rows)
            {

                // Only update if version newer
                DateTime datemodified = (DateTime)xrow["MODIFIED"];
                DateTime dateCreated = datemodified;
                if (hasCreatedColumn)
                {
                    dateCreated = (DateTime)xrow["CREATED"];
                }
                string npath = Path.Combine(FFilePath, xrow["PATH"].ToString());
                Directory.CreateDirectory(npath);
                string filename = npath + Path.DirectorySeparatorChar + xrow["FILE"].ToString();
                FileInfo nfinfo = new FileInfo(filename);
                bool docancel = false;
                if (OnProgress != null)
                    OnProgress(filename, countfile, files.Rows.Count, 0, ((byte[])xrow["STREAM"]).Length, ref docancel);
                bool doupdate = true;
                if (excludefilename.Length > 0)
                {
                    if (xrow["FILE"].ToString().ToUpper() == excludefilename)
                        doupdate = false;
                }
                if (doupdate)
                {
                    // Backup file
                    //System.Threading.Thread.Sleep(1000);

                    if (PerformBackup)
                    {
                        string nbackpath = Path.Combine(backpath, xrow["PATH"].ToString());
                        Directory.CreateDirectory(nbackpath);
                        if (File.Exists(filename))
                            File.Move(filename, nbackpath + Path.DirectorySeparatorChar + xrow["FILE"].ToString());
                    }
                    DateTime mmlast;
                    TimeSpan difmilis;
                    byte[] original = (byte[])xrow["STREAM"];
                    using (FileStream fstream = new FileStream(filename, FileMode.Create, FileAccess.Write))
                    {
                        int index = 0;
                        int totalwritten = 0;
                        do
                        {
                            int towrite = BUFSIZE;
                            if ((original.Length - index) < BUFSIZE)
                                towrite = (original.Length - index);
                            fstream.Write(original, index, towrite);
                            totalwritten = totalwritten + towrite;
                            index = index + towrite;
                            if (OnProgress != null)
                            {

                                mmlast = System.DateTime.Now;
                                difmilis = mmlast - mmfirst;
                                if (difmilis.TotalMilliseconds > 500)
                                {
                                    OnProgress(filename, countfile, files.Rows.Count, totalwritten, original.Length, ref docancel);
                                    mmfirst = System.DateTime.Now;
                                }
                            }
                        } while (index < original.Length);
                    }
                    File.SetCreationTime(filename, dateCreated);
                    File.SetLastWriteTime(filename, datemodified);
                    OnProgress(filename, countfile, files.Rows.Count, original.Length, original.Length, ref docancel);

                    nfinfo = new FileInfo(filename);
#if PocketPC
          if (OnSetLastWriteTime != null)
              OnSetLastWriteTime(filename, datemodified);
          else
              throw new Exception("OnSetLastWriteTime event must be provided");
          //nfinfo.LastWriteTime = datemodified;
#else
                    //          nfinfo.LastWriteTimeUtc = datemodified;
                    nfinfo.LastWriteTime = datemodified;
#endif
                    countfile++;
                }
            }
        }
    }
}
