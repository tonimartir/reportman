using System;
using System.IO;
using System.Text;
using System.Threading;

namespace Reportman.Drawing
{
    /// <summary>
    /// Printer configuration class to obtain default printer settigns
    /// </summary>
    public class PrinterConfig
    {
        /// <summary>
        /// Gets or sets a value indicating whether the configuration settings should persist.
        /// </summary>
        public static bool PersistentConfiguration = true;
        private static IniFile config = null;
        /// <summary>
        /// Lock object used to synchronize access to configuration loading operations.
        /// </summary>
        public static object flag = 0;
        /// <summary>
        /// Gets or sets a value indicating whether to force using the system-wide configuration file instead of user-specific one.
        /// </summary>
        public static bool ForceSystemConfig = false;
        private static string filename;
        private static void CheckLoaded()
        {
            Monitor.Enter(flag);
            try
            {
                if ((config == null) || (!PersistentConfiguration))
                {
                    filename = System.Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
                    filename = filename + Path.DirectorySeparatorChar + "reportman.ini";
                    if (!ForceSystemConfig)
                    {
                        FileInfo ninfo = new FileInfo(filename);
                        if (!ninfo.Exists)
                        {
                            filename = System.Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                            filename = filename + Path.DirectorySeparatorChar + "reportman.ini";
                        }
                    }
                    config = new IniFile(filename);
                }
            }
            finally
            {
                Monitor.Exit(flag);
            }

        }
        /// <summary>
        /// Returns the path to the loaded configuration file.
        /// </summary>
        /// <returns>A string representing the file path of the configuration file.</returns>
        public static string ConfigFile()
        {
            CheckLoaded();
            return filename;
        }
        /// <summary>
        /// Reloads the printer parameters from the configuration file.
        /// </summary>
        public static void ReloadParameters()
        {
            Monitor.Enter(flag);
            try
            {
                config = null;
            }
            finally
            {
                Monitor.Exit(flag);
            }
            CheckLoaded();
        }
        /// <summary>
        /// Gets the driver name associated with the specified printer selection type.
        /// </summary>
        /// <param name="printselect">The printer selection type.</param>
        /// <returns>A string representing the name of the printer driver.</returns>
        public static string GetDriverName(PrinterSelectType printselect)
        {
            string defvalue = "";
            switch (printselect)
            {
                case PrinterSelectType.Characterprinter:
                    defvalue = "EPSON";
                    break;
                case PrinterSelectType.PlainPrinter:
                    defvalue = "PLAIN";
                    break;
                case PrinterSelectType.PlainFullPrinter:
                    defvalue = "PLAINFULL";
                    break;
            }
            string valuename = "Printer" + ((int)printselect).ToString();
            CheckLoaded();
            return config.ReadString("PrinterDriver", valuename, defvalue);
        }
        /// <summary>
        /// Gets the configured printer name for the specified printer selection type.
        /// </summary>
        /// <param name="printselect">The printer selection type.</param>
        /// <returns>A string representing the name of the printer.</returns>
        public static string GetPrinterName(PrinterSelectType printselect)
        {
            string defvalue = "";
            string valuename = "Printer" + ((int)printselect).ToString();
            CheckLoaded();
            return config.ReadString("PrinterNames", valuename, defvalue);
        }
        /// <summary>
        /// Decodes a string containing escape characters (e.g. #27) into a standard string representation.
        /// </summary>
        /// <param name="source">The encoded escape string.</param>
        /// <returns>The decoded string containing literal character values.</returns>
        public static string DecodeEscapeString(string source)
        {
            string nresult = source;
            string newstring = "";
            int idx = 0;
            while (idx < nresult.Length)
            {
                char newchar = nresult[idx];
                if (newchar == '#')
                {
                    idx++;
                    string number = "";
                    while (idx < nresult.Length)
                    {
                        if (char.IsDigit(nresult[idx]))
                        {
                            number = number + nresult[idx];
                            idx++;
                        }
                        else
                            break;
                    }
                    if (number.Length > 0)
                    {
                        int idxchar = Convert.ToInt32(number);
                        char xchar = (char)idxchar;
                        newstring = newstring + xchar;
                    }
                }
                else
                {
                    newstring = newstring + nresult[idx];
                    idx++;
                }
            }
            return newstring;
        }
        /// <summary>
        /// Retrieves the escape command byte sequence for paper cutting.
        /// </summary>
        /// <param name="printselect">The printer selection type.</param>
        /// <returns>A byte array containing the command sequence.</returns>
        public static byte[] GetCutPaperOperation(PrinterSelectType printselect)
        {
            string defvalue = "";
            string valuename = "Printer" + ((int)printselect).ToString();
            CheckLoaded();
            string nresult = config.ReadString("CutPaper", valuename, defvalue);
            nresult = DecodeEscapeString(nresult);
            return Encoding.ASCII.GetBytes(nresult);
        }
        /// <summary>
        /// Gets whether the drawer opening option is enabled for the specified printer selection type.
        /// </summary>
        /// <param name="printselect">The printer selection type.</param>
        /// <returns>True if the drawer open option is enabled; otherwise, false.</returns>
        public static bool GetOpenDrawerOption(PrinterSelectType printselect)
        {
            string valuename = "Printer" + ((int)printselect).ToString();
            CheckLoaded();
            return config.ReadBool("OpenDrawerOn", valuename, false);
        }
        /// <summary>
        /// Gets whether the paper cutting option is enabled for the specified printer selection type.
        /// </summary>
        /// <param name="printselect">The printer selection type.</param>
        /// <returns>True if the paper cut option is enabled; otherwise, false.</returns>
        public static bool GetCutPaperOption(PrinterSelectType printselect)
        {
            string valuename = "Printer" + ((int)printselect).ToString();
            CheckLoaded();
            return config.ReadBool("CutPaperOn", valuename, false);
        }
        /// <summary>
        /// Retrieves the escape command byte sequence for opening the cash drawer.
        /// </summary>
        /// <param name="printselect">The printer selection type.</param>
        /// <returns>A byte array containing the command sequence.</returns>
        public static byte[] GetOpenDrawerOperation(PrinterSelectType printselect)
        {
            string defvalue = "";
            string valuename = "Printer" + ((int)printselect).ToString();
            CheckLoaded();
            string nresult = config.ReadString("OpenDrawer", valuename, defvalue);
            nresult = DecodeEscapeString(nresult);
            return Encoding.ASCII.GetBytes(nresult);
        }
        /// <summary>
        /// Gets whether OEM code page translation is enabled for the printer escape sequences.
        /// </summary>
        /// <param name="printselect">The printer selection type.</param>
        /// <returns>True if OEM conversion is enabled; otherwise, false.</returns>
        public static bool GetOEMConvert(PrinterSelectType printselect)
        {
            string valuename = "Printer" + ((int)printselect).ToString();
            CheckLoaded();
            return config.ReadBool("PrinterEscapeOem", valuename, true);
        }

        /// <summary>
        /// Returns a collection of supported text-only printer driver names.
        /// </summary>
        /// <returns>A <see cref="Strings"/> object containing the driver names.</returns>
        public static Strings GetTextOnlyPrintDrivers()
        {
            Strings drivernames = new Strings
            {
                " ",
                "PLAIN",
                "EPSON",
                "EPSON-MASTER",
                "EPSON-ESCP",
                "EPSON-ESCPQ",
                "IBMPROPRINTER",
                "EPSONTMU210",
                "EPSONTMU210CUT",
                "EPSONTM88IICUT",
                "EPSONTM88II",
                "HP-PCL",
                "VT100",
                "PLAINFULL"
            };
            return drivernames;
        }
        /// <summary>
        /// Returns a collection of names of configurable printers.
        /// </summary>
        /// <returns>A <see cref="Strings"/> object containing the names of configurable printers.</returns>
        public static Strings GetConfigurablePrinters()
        {
            Strings configs = new Strings
            {
                Translator.TranslateStr(467),
                Translator.TranslateStr(468),
                Translator.TranslateStr(469),
                Translator.TranslateStr(470),
                Translator.TranslateStr(471),
                Translator.TranslateStr(472),
                Translator.TranslateStr(473),
                Translator.TranslateStr(474),
                Translator.TranslateStr(475),
                Translator.TranslateStr(476),
                Translator.TranslateStr(477),
                Translator.TranslateStr(478),
                Translator.TranslateStr(479),
                Translator.TranslateStr(480),
                Translator.TranslateStr(481),
                Translator.TranslateStr(482),
                Translator.TranslateStr(1343),
                Translator.TranslateStr(1344)
            };

            // More configurable printers
            for (int i = 1; i <= 50; i++)
                configs.Add("Printer" + i.ToString());

            return configs;
        }
    }
}
