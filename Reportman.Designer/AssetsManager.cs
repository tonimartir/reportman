using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;

namespace Reportman.Designer
{
    public static class AssetsManager
    {
        private const string MonacoAssetsVersion = "3";
        private const string WebMarkdownAssetsVersion = "5";

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        private static extern IntPtr LoadLibrary(string lpFileName);

        /// <summary>
        /// Extracts Monaco Editor assets if the version has changed and returns the actual root path.
        /// </summary>
        public static string EnsureMonacoAssetsExtracted()
        {
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string basePath = Path.Combine(localAppData, "Reportman.Net", "Monaco", "MonacoEditor");
            string versionPath = Path.Combine(basePath, "assets.version");

            string actualRoot = FindMonacoActualRoot(basePath);

            if (!string.IsNullOrEmpty(actualRoot) &&
                File.Exists(versionPath) &&
                File.ReadAllText(versionPath).Trim() == MonacoAssetsVersion)
            {
                return actualRoot;
            }

            if (Directory.Exists(basePath))
            {
                Directory.Delete(basePath, true);
            }
            Directory.CreateDirectory(basePath);

            ExtractResourceZip("Reportman.Designer.Resources.MonacoEditor.zip", basePath);

            actualRoot = FindMonacoActualRoot(basePath);
            if (string.IsNullOrEmpty(actualRoot))
            {
                actualRoot = basePath;
            }

            File.WriteAllText(versionPath, MonacoAssetsVersion);

            return actualRoot;
        }

        private static string FindMonacoActualRoot(string basePath)
        {
            if (File.Exists(Path.Combine(basePath, "index.html")) || File.Exists(Path.Combine(basePath, "Index.html")))
                return basePath;
            
            string nested = Path.Combine(basePath, "MonacoEditor");
            if (File.Exists(Path.Combine(nested, "index.html")) || File.Exists(Path.Combine(nested, "Index.html")))
                return nested;
            
            return string.Empty;
        }

        /// <summary>
        /// Extracts Web Markdown assets if the version has changed and returns the base path.
        /// </summary>
        public static string EnsureWebMarkdownAssetsExtracted()
        {
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string basePath = Path.Combine(localAppData, "Reportman.Net", "WebMarkdown", "WebMarkdown");
            string versionPath = Path.Combine(basePath, "assets.version");

            if (File.Exists(Path.Combine(basePath, "index.html")) &&
                File.Exists(versionPath) &&
                File.ReadAllText(versionPath).Trim() == WebMarkdownAssetsVersion)
            {
                return basePath;
            }

            if (Directory.Exists(basePath))
            {
                Directory.Delete(basePath, true);
            }
            Directory.CreateDirectory(basePath);

            ExtractResourceZip("Reportman.Designer.Resources.WebMarkdown.zip", basePath);

            File.WriteAllText(versionPath, WebMarkdownAssetsVersion);

            return basePath;
        }

        private static void ExtractResourceZip(string resourceName, string destinationPath)
        {
            var assembly = Assembly.GetExecutingAssembly();
            using (Stream stream = assembly.GetManifestResourceStream(resourceName))
            {
                if (stream == null)
                    throw new FileNotFoundException($"Embedded resource '{resourceName}' not found.");

                using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    archive.ExtractToDirectory(destinationPath);
                }
            }
        }

        /// <summary>
        /// Preloads the WebView2Loader.dll from the extracted Monaco Editor path based on the process bitness.
        /// </summary>
        public static void TryPreloadWebView2Loader(string monacoRootPath)
        {
            string arch = Environment.Is64BitProcess ? "x64" : "x86";
            string dllPath = Path.Combine(monacoRootPath, arch, "WebView2Loader.dll");

            if (File.Exists(dllPath))
            {
                LoadLibrary(dllPath);
            }
        }
    }
}
